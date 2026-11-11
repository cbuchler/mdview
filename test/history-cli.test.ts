import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { expect, it } from 'vitest'
import { HistoryStore } from '../src/history.js'

it('keeps stdin and failed opens out of history, records successful plain output, and enforces opt-out and terminal-only history', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mdview-history-cli-')))
  const state = path.join(root, 'state')
  const history = new HistoryStore(path.join(state, 'mdview'))
  const file = path.join(root, 'document.md')
  await writeFile(file, '# Plain title\n\nBody')
  const run = (args: string[], input = '') => new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(process.execPath, ['--import', 'tsx', 'src/main.ts', '--config', path.join(root, 'missing.yml'), ...args], {
      env: { ...process.env, XDG_STATE_HOME: state, NODE_NO_WARNINGS: '1' }, timeout: 5000, maxBuffer: 100_000,
    }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') reject(error)
      else resolve({ code: error ? Number(error.code) : 0, stdout, stderr })
    })
    child.stdin?.end(input)
  })
  try {
    expect((await run([], 'Piped content')).stdout).toContain('Piped content')
    expect(await history.read()).toEqual([])
    expect((await run([path.join(root, 'absent.md')])).code).toBe(1)
    expect(await history.read()).toEqual([])
    const plain = await run([file])
    expect(plain.code).toBe(0)
    expect(plain.stdout).toContain('Plain title')
    expect((await history.read())[0]).toMatchObject({ title: 'Plain title', location: file })
    expect((await run(['--history'])).stderr).toContain('terminal input and output')
    expect((await run(['--history', file])).stderr).toContain('cannot be combined')
    await rm(history.directory, { recursive: true })
    await mkdir(history.directory, { mode: 0o700 })
    const database = path.join(history.directory, 'history.sqlite3')
    await writeFile(database, 'corrupt sentinel', { mode: 0o600 })
    const disabled = await run(['--no-history', file])
    expect(disabled.code).toBe(0)
    expect(disabled.stderr).toBe('')
    expect(disabled.stdout).toContain('Body')
    expect(await readFile(database, 'utf8')).toBe('corrupt sentinel')
    const degraded = await run([file])
    expect(degraded.code).toBe(0)
    expect(degraded.stdout).toContain('Body')
    expect(degraded.stderr).not.toBe('')
  } finally { await history.flush(); await rm(root, { recursive: true, force: true }) }
}, 15000)
