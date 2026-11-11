import { execFile, spawn } from 'node:child_process'
import { access, copyFile, mkdir, open, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { constants, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { SandboxManager, type SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime'

import { MEMORY_READY, RENDER_MEMORY_BYTES, RENDER_MEMORY_MIB, VERIFY_MEMORY_SCOPE } from './render-memory.js'

import { linuxSeccomp } from './linux-seccomp.js'

const runFile = promisify(execFile)
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"

async function executable(name: string): Promise<string> {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue
    const candidate = path.join(directory, name)
    try {
      await access(candidate, constants.X_OK)
      return await realpath(candidate)
    } catch { continue }
  }
  throw new Error(`Required sandbox executable missing: ${name}`)
}

async function runtimeFiles(executables: string[]): Promise<string[]> {
  const files = new Set(executables)
  const directories = new Set<string>()
  if (process.platform === 'linux') {
    // Loader aliases must survive SRT's canonicalized file grants.
    for (const directory of ['/usr/lib', '/usr/lib64', '/lib', '/lib64']) {
      try { directories.add(await realpath(directory)) } catch { continue }
    }
  }
  for (const binary of executables) {
    const cellar = binary.indexOf('/Cellar/')
    if (cellar !== -1) {
      const prefix = binary.slice(0, cellar)
      for (const name of ['lib', 'opt']) directories.add(path.join(prefix, name))
      if (process.platform === 'darwin') directories.add(path.join(prefix, 'Cellar'))
    }
  }
  if (process.platform === 'darwin') {
    // The shared cache is an OS runtime asset, not a document or user directory.
    directories.add('/System/Library')
    directories.add('/usr/lib')
    directories.add('/usr/share/icu')
  }
  for (const binary of executables) {
    if (process.platform !== 'linux') continue
    try {
      const { stdout } = await runFile('/usr/bin/ldd', [binary], { env: {}, timeout: 1000, maxBuffer: 65536 })
      if (stdout.includes('not found')) throw new Error(`Missing runtime library for ${binary}`)
      for (const library of stdout.match(/\/[^\s()]+/g) ?? []) {
        files.add(library)
        files.add(await realpath(library))
        directories.add(path.dirname(await realpath(library)))
      }
    } catch (error) {
      const output = (error as { stderr?: string }).stderr ?? ''
      if (!output.includes('not a dynamic executable') && !output.includes('statically linked')) throw error
    }
  }
  const roots = [...directories]
  const result = [...roots]
  for (const file of files) {
    const resolved = await realpath(file)
    if (!roots.some((root) => file.startsWith(root + '/') || resolved.startsWith(root + '/'))) result.push(file)
  }
  return result
}

async function launchSandbox(command: string[], directory: string): Promise<void> {
  await mkdir(path.join(directory, 'work'), { mode: 0o700, recursive: true })
  const work = await realpath(path.join(directory, 'work'))
  process.chdir(work)
  const runtime = await realpath(command[0])
  const shell = '/bin/bash'
  const env = process.platform === 'darwin' ? await executable('env') : '/usr/bin/env'
  const binaries = [runtime, shell, env]
  const read = await runtimeFiles(process.platform === 'linux' ? [runtime] : binaries)
  let workerArgs = command.slice(1)
  const bun = globalThis as typeof globalThis & { Bun?: { isStandaloneExecutable?: boolean } }
  if (!bun.Bun?.isStandaloneExecutable) {
    let modules = path.dirname(fileURLToPath(import.meta.url))
    if (process.platform === 'darwin' && !process.versions.bun && modules.endsWith('/src')) {
      modules = path.resolve(modules, '../dist')
    }
    const root = path.dirname(modules)
    const names = (await readdir(modules)).filter((name) => /\.(?:js|ts|tsx)$/.test(name) && !name.endsWith('.d.ts'))
    if (process.platform === 'darwin' && process.versions.bun) {
      // Bun scans module ancestors. Stage only application assets to keep the checkout unreadable.
      const app = path.join(await realpath(directory), 'app')
      const stagedModules = path.join(app, path.basename(modules))
      await rm(app, { recursive: true, force: true })
      await mkdir(stagedModules, { mode: 0o700, recursive: true })
      for (const name of names) await copyFile(path.join(modules, name), path.join(stagedModules, name))
      await copyFile(path.join(root, 'package.json'), path.join(app, 'package.json'))
      await symlink(path.join(root, 'node_modules'), path.join(app, 'node_modules'))
      workerArgs = workerArgs.map((arg) => arg.startsWith(root + '/') ? app + arg.slice(root.length) : arg)
      workerArgs.unshift('--preserve-symlinks')
      read.push(app)
    } else {
      read.push(...names.map((name) => path.join(modules, name)), path.join(root, 'package.json'))
    }
    read.push(path.join(root, 'node_modules'))
  }
  if (process.platform === 'linux') {
    const filterPath = path.join(directory, 'filter.bpf')
    await rm(filterPath, { force: true })
    await writeFile(filterPath, linuxSeccomp(), { mode: 0o600, flag: 'wx' })
    const filter = await open(filterPath, 'r')
    try {
      // The launcher already has a detached session. Keep its process group so quit kills PID 1 too.
      const args = [
        '--unshare-all', '--unshare-user', '--disable-userns', '--assert-userns-disabled',
        '--as-pid-1', '--die-with-parent', '--cap-drop', 'ALL', '--clearenv',
        '--setenv', 'HOME', '/nonexistent', '--setenv', 'PATH', '/nonexistent',
        '--setenv', 'LANG', 'C.UTF-8', '--setenv', 'NODE_NO_WARNINGS', '1',
        '--setenv', 'TSX_DISABLE_CACHE', '1', '--setenv', 'TMPDIR', work,
        '--proc', '/proc', '--remount-ro', '/proc', '--dev', '/dev',
      ]
      for (const alias of ['/lib', '/lib64']) {
        const target = await realpath(alias).catch(() => undefined)
        if (target && target !== alias) args.push('--symlink', target, alias)
      }
      for (const file of read) args.push('--ro-bind', file, file)
      args.push('--bind', work, work, '--chdir', work, '--remount-ro', '/',
        '--seccomp', '3', '--', runtime, ...workerArgs)
      const scopeArgs = ['--user', '--scope', '--quiet', '--collect',
        `--unit=${path.basename(directory)}`,
        '-p', `MemoryMax=${RENDER_MEMORY_BYTES}`, '-p', 'MemorySwapMax=0',
        '-p', 'OOMPolicy=kill', '-p', 'TasksMax=64',
        '/bin/sh', '-c', VERIFY_MEMORY_SCOPE, 'sh', await executable('bwrap'), ...args]
      const child = spawn(await executable('systemd-run'), scopeArgs, {
        env: { XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR, DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS }, stdio: ['inherit', 'inherit', 'inherit', filter.fd],
      })
      process.exitCode = await new Promise<number>((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', (code) => resolve(code ?? 1))
      })
    } finally {
      await filter.close()
    }
    return
  }
  const assets = (globalThis as typeof globalThis & { mdviewNativeAssets?: Record<string, string> }).mdviewNativeAssets
  let nativeDirectory = fileURLToPath(new URL('../dist/native/', import.meta.url))
  if (assets) {
    nativeDirectory = path.join(directory, 'native')
    await rm(nativeDirectory, { recursive: true, force: true })
    await mkdir(nativeDirectory, { mode: 0o700 })
    for (const name of ['mdview-memory', 'mdview-memory-guard.dylib']) {
      if (!assets[name]) throw new Error('Missing bundled memory protection asset')
      await writeFile(path.join(nativeDirectory, name), Buffer.from(assets[name], 'base64'), { mode: 0o500, flag: 'wx' })
    }
  }
  const memoryHelper = await realpath(path.join(nativeDirectory, 'mdview-memory'))
  const memoryGuard = await realpath(path.join(nativeDirectory, 'mdview-memory-guard.dylib'))
  read.push(memoryHelper, memoryGuard)
  const literal = (value: string) => ({ path: value, literal: true as const })
  const config: SandboxRuntimeConfig = {
    network: {
      allowedDomains: [], deniedDomains: [], strictAllowlist: true,
      allowAllUnixSockets: false, allowLocalBinding: false,
    },
    filesystem: {
      denyRead: ['/'], allowRead: [...read, work].map(literal), allowWrite: [literal(work)],
      denyWrite: ['/tmp/claude', '/private/tmp/claude', '/dev/tty', '/dev/dtracehelper', '/dev/autofs_nowait'],
    },
    allowPty: false, allowAppleEvents: false, enableWeakerNetworkIsolation: false,
    enableWeakerNestedSandbox: false, allowNestedUserNamespaces: false,
  }
  try {
    await SandboxManager.initialize(config, undefined, false)
    const dependencies = await SandboxManager.checkDependenciesAsync()
    if (dependencies.errors.length || dependencies.warnings.length) {
      throw new Error([...dependencies.errors, ...dependencies.warnings].join('; '))
    }
    // Remove proxy variables and runtime startup hooks from the parser environment.
    const invocation = [env, '-i', 'HOME=/nonexistent', 'PATH=/nonexistent', 'LANG=C.UTF-8',
      'NODE_NO_WARNINGS=1', 'TSX_DISABLE_CACHE=1', `TMPDIR=${work}`, memoryHelper, memoryGuard, String(RENDER_MEMORY_MIB), runtime, ...workerArgs]
    const wrapped = await SandboxManager.wrapWithSandboxArgv('exec ' + invocation.map(quote).join(' '), shell)
    const child = spawn(wrapped.argv[0], wrapped.argv.slice(1), {
      env: wrapped.env, stdio: ['pipe', 'inherit', 'inherit', 'pipe'],
    })
    const ready = child.stdio[3] as import('node:stream').Readable
    let handshake = ''
    ready.on('data', (chunk: Buffer) => {
      handshake += chunk.toString('utf8')
      if (!MEMORY_READY.startsWith(handshake)) child.kill('SIGKILL')
    })
    ready.once('end', () => {
      if (handshake === MEMORY_READY) process.stdin.pipe(child.stdin!)
      else child.kill('SIGKILL')
    })
    child.stdin!.on('error', () => {})
    const status = await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => resolve(code ?? 1))
    })
    process.stdin.unpipe(child.stdin!)
    if (handshake !== MEMORY_READY) throw new Error('Memory protection readiness was not verified')
    process.exitCode = status
  } finally {
    SandboxManager.cleanupAfterCommand()
    await SandboxManager.reset()
  }
}

export async function runSandboxLauncher(command: string[], directory: string): Promise<void> {
  const owner = Number(process.env.MDVIEW_PARENT_PID)
  if (!Number.isSafeInteger(owner) || owner <= 1) throw new Error('Missing sandbox parent identity')
  const parentLost = () => {
    try { rmSync(directory, { recursive: true, force: true }) } finally {
      process.kill(-process.pid, 'SIGKILL')
    }
  }
  // Reparenting detects owner death without relying on the busy parser's event loop.
  const monitor = setInterval(() => {
    if (process.ppid !== owner) parentLost()
  }, 50)
  try {
    if (process.ppid !== owner) parentLost()
    await launchSandbox(command, directory)
  } finally {
    clearInterval(monitor)
  }
}
