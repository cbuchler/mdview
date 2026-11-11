import { execFile } from 'node:child_process'
import { openSync, closeSync, statSync } from 'node:fs'
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
          descendant: require('node:child_process').spawnSync(process.execPath, ['-e',
            'try { require("node:fs").readFileSync(' + ${JSON.stringify(JSON.stringify(secret))} + '); process.exit(2) } catch { process.exit(0) }'
          ]).status === 0,
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
