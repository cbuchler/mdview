import { execFile, spawn } from 'node:child_process'
import { access, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { SandboxManager, type SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime'

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
  }
  for (const binary of executables) {
    if (process.platform !== 'linux') continue
    try {
      const { stdout } = await runFile('/usr/bin/ldd', [binary], { env: {}, timeout: 1000, maxBuffer: 65536 })
      if (stdout.includes('not found')) throw new Error(`Missing runtime library for ${binary}`)
      for (const library of stdout.match(/\/[^\s()]+/g) ?? []) {
        files.add(library)
        files.add(await realpath(library))
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

export async function runSandboxLauncher(command: string[], directory: string): Promise<void> {
  await mkdir(path.join(directory, 'work'), { mode: 0o700, recursive: true })
  const work = await realpath(path.join(directory, 'work'))
  process.chdir(work)
  const runtime = await realpath(command[0])
  const shell = '/bin/bash'
  const env = await executable('env')
  const binaries = [runtime, shell, env]
  let seccomp: string | undefined
  let socat: string | undefined
  if (process.platform === 'linux') {
    socat = await executable('socat')
    const embedded = (globalThis as typeof globalThis & { mdviewSeccomp?: string }).mdviewSeccomp
    if (embedded) {
      seccomp = path.join(directory, 'apply-seccomp')
      await rm(seccomp, { force: true })
      await writeFile(seccomp, Buffer.from(embedded, 'base64'), { mode: 0o500, flag: 'wx' })
    } else {
      const entry = fileURLToPath(import.meta.resolve('@anthropic-ai/sandbox-runtime'))
      seccomp = path.resolve(path.dirname(entry), '../vendor/seccomp', process.arch, 'apply-seccomp')
    }
    await access(seccomp, constants.X_OK)
    binaries.push(socat, seccomp)
  }
  const read = await runtimeFiles(binaries)
  const bun = globalThis as typeof globalThis & { Bun?: { isStandaloneExecutable?: boolean } }
  if (!bun.Bun?.isStandaloneExecutable) {
    const modules = path.dirname(fileURLToPath(import.meta.url))
    const root = path.dirname(modules)
    // Bun enumerates the module directory when resolving source files on macOS.
    if (process.platform === 'darwin' && process.versions.bun) read.push(modules)
    for (const name of await readdir(modules)) {
      if (/\.(?:js|ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) read.push(path.join(modules, name))
    }
    read.push(path.join(root, 'package.json'), path.join(root, 'node_modules'))
  }
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
    ...(seccomp ? { seccomp: { applyPath: seccomp } } : {}),
    ...(socat ? { socatPath: socat } : {}),
  }
  try {
    await SandboxManager.initialize(config, undefined, false)
    const dependencies = await SandboxManager.checkDependenciesAsync()
    if (dependencies.errors.length || dependencies.warnings.length) {
      throw new Error([...dependencies.errors, ...dependencies.warnings].join('; '))
    }
    // Remove proxy variables and runtime startup hooks from the parser environment.
    const invocation = [env, '-i', 'HOME=/nonexistent', 'PATH=/nonexistent', 'LANG=C.UTF-8',
      'NODE_NO_WARNINGS=1', 'TSX_DISABLE_CACHE=1', `TMPDIR=${work}`, runtime, ...command.slice(1)]
    const wrapped = await SandboxManager.wrapWithSandboxArgv('exec ' + invocation.map(quote).join(' '), shell)
    const child = spawn(wrapped.argv[0], wrapped.argv.slice(1), { env: wrapped.env, stdio: 'inherit' })
    const status = await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => resolve(code ?? 1))
    })
    process.exitCode = status
  } finally {
    SandboxManager.cleanupAfterCommand()
    await SandboxManager.reset()
  }
}
