import { execFile, spawn } from 'node:child_process'
import { openSync, closeSync, statSync, existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import dgram from 'node:dgram'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it, vi } from 'vitest'
import * as sandbox from '../src/render-sandbox.js'
import { RenderSupervisor } from '../src/render-supervisor.js'

const runFile = promisify(execFile)

it.skipIf(!['linux', 'darwin'].includes(process.platform))('denies host files, sockets, network, processes, secrets and inherited descriptors in the real sandbox', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-sandbox-'))
  const secret = path.join(directory, 'secret')
  const socket = path.join(directory, 'socket')
  await writeFile(secret, 'host sentinel')
  const fd = openSync(secret, 'r')
  const tcp = net.createServer((connection) => connection.end())
  const unix = net.createServer((connection) => connection.end())
  const udp = dgram.createSocket('udp4')
  const received: string[] = []
  let launch: sandbox.RenderLaunch | undefined
  const listen = (server: net.Server, address: string | number) => new Promise<void>((resolve) => {
    if (typeof address === 'string') server.listen(address, resolve)
    else server.listen(address, '127.0.0.1', resolve)
  })
  const connect = (address: net.NetConnectOpts) => new Promise<void>((resolve, reject) => {
    const connection = net.connect(address)
    connection.on('connect', () => { connection.destroy(); resolve() })
    connection.on('error', reject)
  })
  try {
    await listen(tcp, 0)
    await listen(unix, socket)
    await new Promise<void>((resolve) => udp.bind(0, '127.0.0.1', resolve))
    const port = (tcp.address() as net.AddressInfo).port
    const udpPort = udp.address().port
    await new Promise<void>((resolve, reject) => {
      udp.once('message', () => resolve())
      udp.send('baseline', udpPort, '127.0.0.1', (error) => { if (error) reject(error) })
    })
    udp.on('message', (message) => received.push(message.toString()))
    expect(await readFile(secret, 'utf8')).toBe('host sentinel')
    await connect({ port, host: '127.0.0.1' })
    await connect({ path: socket })
    const code = `
      const fs = require('node:fs'), net = require('node:net')
      const denied = fn => { try { fn(); return false } catch { return true } }
      const cannotConnect = options => new Promise(resolve => {
        const c = net.connect(options)
        c.once('connect', () => { c.destroy(); resolve(false) })
        c.once('error', () => resolve(true))
        c.setTimeout(500, () => { c.destroy(); resolve(true) })
      })
      ;(async () => {
        const udp = require('node:dgram').createSocket('udp4')
        udp.on('error', () => {})
        try { udp.send('escaped', ${udpPort}, '127.0.0.1', () => {}) } catch {}
        const results = {
          read: denied(() => fs.readFileSync(${JSON.stringify(secret)})),
          write: denied(() => fs.writeFileSync(${JSON.stringify(secret)}, 'changed')),
          rootWrite: denied(() => fs.writeFileSync(${JSON.stringify(path.join(directory, 'escaped'))}, 'changed')),
          environment: process.env.MDVIEW_TEST_SECRET === undefined && process.env.NODE_OPTIONS === undefined,
          descriptor: !Array.from({length: 256}, (_, i) => i + 3).some(fd => {
            try { const s = fs.fstatSync(fd); return s.ino === ${JSON.stringify(statSync(secret).ino)} && s.dev === ${JSON.stringify(statSync(secret).dev)} }
            catch { return false }
          }),
          process: denied(() => process.kill(${process.pid}, 0)),
          tcp: await cannotConnect({ host: '127.0.0.1', port: ${port} }),
          unix: await cannotConnect({ path: ${JSON.stringify(socket)} }),
          descendant: (() => { const result = require('node:child_process').spawnSync(process.execPath, ['-e',
            'try { require("node:fs").readFileSync(' + ${JSON.stringify(JSON.stringify(secret))} + '); process.exit(2) } catch { process.exit(0) }'
          ]); return process.platform === 'darwin' ? result.error?.code === 'EPERM' : result.status === 0 })(),
        }
        if (process.platform === 'linux') {
          const status = fs.readFileSync('/proc/self/status', 'utf8')
          results.privileges = /^NoNewPrivs:\\s+1$/m.test(status) && /^CapEff:\\s+0+$/m.test(status)
        }
        const temporary = require('node:path').join(process.env.TMPDIR, 'private')
        fs.writeFileSync(temporary, 'private')
        results.privateTemporaryFile = fs.readFileSync(temporary, 'utf8') === 'private'
        await new Promise(resolve => setTimeout(resolve, 300))
        try { udp.close() } catch {}
        process.stdout.write(JSON.stringify(results))
      })()
    `
    launch = await sandbox.sandboxLaunch([process.execPath, '-e', code])
    const prepared = launch
    const output = await new Promise<string>((resolve, reject) => {
      const child = sandbox.spawnRenderProcess({ ...prepared,
        env: { ...prepared.env, MDVIEW_TEST_SECRET: 'private', NODE_OPTIONS: '--title=sentinel' },
      })
      let stdout = '', stderr = ''
      const timer = setTimeout(() => { sandbox.stopRenderProcess(child, true); reject(new Error('Sandbox probe timed out')) }, 8000)
      child.stdout!.on('data', (data) => { stdout += data })
      child.stderr!.on('data', (data) => { stderr += data })
      child.on('error', reject)
      child.on('close', (status) => {
        clearTimeout(timer)
        if (status === 0) resolve(stdout)
        else reject(new Error(`Sandbox probe failed: ${stderr}`))
      })
      child.stdin!.end()
    })
    expect(JSON.parse(output)).toEqual({
      read: true, write: true, rootWrite: true, environment: true, descriptor: true,
      process: true, ...(process.platform === 'linux' ? { privileges: true } : {}), tcp: true, unix: true, privateTemporaryFile: true,
      descendant: true,
    })
    expect(await readFile(secret, 'utf8')).toBe('host sentinel')
    expect(received).toEqual([])
  } finally {
    closeSync(fd)
    tcp.close()
    unix.close()
    udp.close()
    await launch?.cleanup?.()
    await rm(directory, { recursive: true, force: true })
  }
}, 10000)

it('refuses unsupported platforms by default and permits only an explicit override', async () => {
  const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  const options = { width: 80, padding: 0, wrap: true, theme: 'github', syntaxTheme: 'dracula', sourceName: 'test' }
  const required = new RenderSupervisor()
  const unrestricted = new RenderSupervisor({ sandbox: false })
  try {
    await expect(required.render('# Must refuse', options, 1000)).rejects.toThrow('--no-sandbox')
    expect((await unrestricted.render('# Explicit override', options, 1000)).title).toBe('Explicit override')
  } finally {
    platform.mockRestore()
    await required.dispose()
    await unrestricted.dispose()
  }
})

it('never retries a missing or failing sandbox launcher without protection', async () => {
  const prepare = vi.spyOn(sandbox, 'sandboxLaunch')
  try {
    for (const command of ['/absent-bwrap', process.execPath]) {
      prepare.mockResolvedValue({ command, args: ['-e', 'process.exit(1)'], env: {} })
      const renderer = new RenderSupervisor()
      try {
        await expect(renderer.render('This renders if protection is bypassed', {
          width: 80, padding: 0, wrap: true, theme: 'github', syntaxTheme: 'dracula', sourceName: 'test',
        }, 1000)).rejects.toThrow('--no-sandbox')
      } finally { await renderer.dispose() }
    }
  } finally { prepare.mockRestore() }
})

it('accepts the explicit CLI override and rejects misleading assigned values', async () => {
  const { stdout } = await runFile(process.execPath, ['--import', 'tsx', 'src/main.ts', '--help'])
  expect(stdout).toContain('--no-sandbox')
  const { parseCliArgs } = await import('../src/config.js')
  expect(parseCliArgs(['--no-sandbox', 'document.md']).noSandbox).toBe(true)
  expect(() => parseCliArgs(['--no-sandbox=false'])).toThrow('does not take a value')
})

it.skipIf(process.platform !== 'linux')('filters Linux socket and namespace syscalls while permitting anonymous runtime pipes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-seccomp-probe-'))
  let launch: sandbox.RenderLaunch | undefined
  try {
    const binary = path.join(directory, 'probe')
    await runFile('cc', ['test/fixtures/seccomp-probe.c', '-o', binary])
    // An unfiltered execution must fail this probe, or it cannot establish enforcement.
    await expect(runFile(binary)).rejects.toThrow()
    launch = await sandbox.sandboxLaunch([binary])
    await runFile(launch.command, launch.args, { env: launch.env, cwd: launch.cwd, timeout: 8000 })
  } finally {
    await launch?.cleanup?.()
    await rm(directory, { recursive: true, force: true })
  }
}, 10000)

it.skipIf(!['linux', 'darwin'].includes(process.platform)).each([undefined, ...(existsSync('release/mdview') ? [path.resolve('release/mdview')] : [])])('cleans up a busy sandbox when its UI parent is killed (%s)', async (launcher) => {
  const parent = spawn(process.execPath, ['--import', 'tsx', 'test/fixtures/sandbox-parent.ts'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MDVIEW_TEST_LAUNCHER: launcher } })
  let info: { pid: number, directory: string } | undefined
  try {
    let output = ''
    let diagnostics = ''
    parent.stderr.on('data', (chunk) => { diagnostics += chunk })
    info = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Parent readiness timeout: ' + diagnostics)), 8000)
      parent.stdout.on('data', (chunk) => {
        output += chunk
        if (output.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(output.trim())) }
      })
      parent.once('error', reject)
    })
    const closed = new Promise((resolve) => parent.once('close', resolve))
    parent.kill('SIGKILL')
    await closed
    await vi.waitFor(() => {
      expect(() => statSync(info!.directory)).toThrow()
      expect(() => process.kill(-info!.pid, 0)).toThrow()
    }, { timeout: 5000 })
  } finally {
    parent.kill('SIGKILL')
    if (info) {
      try { process.kill(-info.pid, 'SIGKILL') } catch {}
      await rm(info.directory, { recursive: true, force: true })
    }
  }
}, 15000)


it.skipIf(!['linux', 'darwin'].includes(process.platform)).each([process.execPath, ...(process.env.MDVIEW_TEST_BUN ? [process.env.MDVIEW_TEST_BUN] : [])])('stops retained external allocations and permits a later render (%s)', async (runtime) => {
  // Bound the baseline too: a broken limit must not turn this probe into host exhaustion.
  const code = `
    console.log('allocation-started')
    const retained = []
    for (let i = 0; i < 384; i++) {
      const buffer = Buffer.alloc(1024 * 1024, 1)
      retained.push(buffer)
    }
    console.log('allocation-completed')
  `
  expect((await runFile(runtime, ['-e', code])).stdout).toContain('allocation-completed')
  const launch = await sandbox.sandboxLaunch([runtime, '-e', code])
  try {
    const result = await new Promise<{ output: string, error: string, status: number | null }>((resolve, reject) => {
      const child = sandbox.spawnRenderProcess(launch)
      let output = '', error = ''
      const timer = setTimeout(() => { sandbox.stopRenderProcess(child, true); reject(new Error('Memory probe timed out')) }, 8000)
      child.stdout.on('data', (chunk) => { output += chunk })
      child.stderr.on('data', (chunk) => { error += chunk })
      child.once('error', reject)
      child.once('close', (status) => { clearTimeout(timer); resolve({ output, error, status }) })
      child.stdin.end()
    })
    expect(result.output, result.error).toContain('allocation-started')
    expect(result.output).not.toContain('allocation-completed')
    expect(result.status).not.toBe(0)
    const renderer = new RenderSupervisor()
    try {
      expect((await renderer.render('# Recovered after memory pressure', {
        width: 80, padding: 0, wrap: true, theme: 'github', syntaxTheme: 'dracula', sourceName: 'test',
      }, 1000)).title).toBe('Recovered after memory pressure')
    } finally { await renderer.dispose() }
  } finally { await launch.cleanup?.() }
}, 15000)

it.skipIf(process.platform !== 'darwin')('rejects a macOS executable that does not load the memory guard', async () => {
  // Apple platform executables discard DYLD injection. A clean exit is not readiness.
  const launch = await sandbox.sandboxLaunch(['/usr/bin/true'])
  try {
    await expect(runFile(launch.command, launch.args, {
      env: launch.env, cwd: launch.cwd, timeout: 8000,
    })).rejects.toThrow('Memory protection readiness was not verified')
  } finally { await launch.cleanup?.() }
}, 10000)
