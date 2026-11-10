import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import http from 'node:http'
import path from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import { render } from 'ink'
import { expect, it, vi } from 'vitest'
import { Navigation } from '../src/navigation.js'
import { HistoryStore } from '../src/history.js'
import { filterHistory } from '../src/history-picker.js'
import { RenderSupervisor } from '../src/render-supervisor.js'
import { DEFAULT_CONFIG } from '../src/config.js'
import { resolveSource } from '../src/source.js'
import { widthOf } from '../src/utils.js'

it('filters Unicode titles and path subsequences while retaining recency order', () => {
  const entries = [
    { kind: 'file' as const, location: '/projects/notes.md', title: 'Café 開発 Ｇuide', openedAt: 2 },
    { kind: 'url' as const, location: 'https://example.com/readme', title: 'Other', openedAt: 1 },
  ]
  expect(filterHistory(entries, 'café開g')).toEqual([entries[0]])
  expect(filterHistory(entries, 'prjnts')).toEqual([entries[0]])
  expect(filterHistory(entries, '')).toEqual(entries)
  expect(filterHistory(entries, 'absent')).toEqual([])
})

it('preserves the passage through history navigation and cancels abandoned URL reads', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mdview-history-ui-'))
  const file = path.join(root, 'reading.md')
  await writeFile(file, Array.from({ length: 40 }, (_, index) => `Passage${index} has enough words to wrap across several lines in a narrow terminal.`).join('\n\n'))
  let requested = false
  let closed = false
  const server = http.createServer((_request, response) => {
    requested = true
    response.on('close', () => { closed = true })
    response.writeHead(200)
    response.write('Partial body without EOF')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP server')
  const pendingUrl = `http://127.0.0.1:${address.port}/pending`
  const history = new HistoryStore(path.join(root, 'state'))
  await history.remember({ kind: 'url', location: pendingUrl, title: 'Pending remote', openedAt: 1 })
  const renderer = new RenderSupervisor()
  let frame = ''
  const stdout = Object.assign(new Writable({ write(chunk, _encoding, done) { frame = stripVTControlCharacters(chunk.toString()); done() } }), { columns: 100, rows: 12, isTTY: true })
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} })
  const app = render(<Navigation source={resolveSource(file)} config={DEFAULT_CONFIG} renderer={renderer} history={history} />, {
    stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true, patchConsole: false, exitOnCtrlC: false,
  })
  const top = () => frame.split('\n')[3]?.trim()
  try {
    await vi.waitFor(() => expect(top()).toContain('Passage0'), { timeout: 3000 })
    for (let index = 0; index < 20; index++) { stdin.write('j'); await new Promise((resolve) => setTimeout(resolve, 5)) }
    await vi.waitFor(() => expect(top()).toContain('Passage10'))
    stdin.write('h')
    await vi.waitFor(() => expect(frame).toContain('Recent documents · 2'))
    stdin.write('qhjkb')
    await vi.waitFor(() => {
      expect(frame).toContain('Search: qhjkb')
      expect(frame).toContain('No matching documents')
    })
    stdin.write('\u001b')
    await vi.waitFor(() => expect(top()).toContain('Passage10'))
    stdin.write('h')
    await vi.waitFor(() => expect(frame).toContain('Recent documents · 2'))
    stdout.columns = 30
    stdout.emit('resize')
    stdin.write('\r')
    await vi.waitFor(() => {
      expect(top()).toContain('Passage10')
      expect(frame).toContain('a narrow terminal.')
    }, { timeout: 3000 })
    await history.flush()
    expect((await history.read())[0].anchor).toBeDefined()
    stdin.write('h')
    await vi.waitFor(() => expect(frame).toContain('Recent documents · 2'))
    stdin.write('Pending remote')
    await vi.waitFor(() => expect(frame).toContain('Recent documents · 1'))
    stdin.write('\r')
    await vi.waitFor(() => expect(requested).toBe(true))
    stdin.write('h')
    await vi.waitFor(() => expect(frame).toContain('Recent documents · 2'))
    stdin.write('reading.md')
    await vi.waitFor(() => expect(frame).toContain('Recent documents · 1'))
    stdin.write('\r')
    await vi.waitFor(() => {
      expect(closed).toBe(true)
      expect(top()).toContain('Passage10')
    })
    expect((await history.read()).find((entry) => entry.location === pendingUrl)?.openedAt).toBe(1)
  } finally {
    app.unmount()
    app.cleanup()
    await renderer.dispose()
    await history.flush()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    stdin.destroy()
    stdout.destroy()
    await rm(root, { recursive: true, force: true })
  }
}, 10000)

it('marks missing files, removes entries, and requires confirmation to clear history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mdview-history-picker-'))
  const history = new HistoryStore(path.join(root, 'state'))
  await history.remember({ kind: 'file', location: path.join(root, 'missing.md'), title: 'Missing', openedAt: 2 })
  await history.remember({ kind: 'url', location: 'https://example.com/doc', title: 'Remote', openedAt: 1 })
  const renderer = new RenderSupervisor()
  let frame = ''
  const stdout = Object.assign(new Writable({ write(chunk, _encoding, done) { frame = stripVTControlCharacters(chunk.toString()); done() } }), { columns: 80, rows: 12, isTTY: true })
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} })
  const app = render(<Navigation config={DEFAULT_CONFIG} renderer={renderer} history={history} />, {
    stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true, patchConsole: false, exitOnCtrlC: false,
  })
  try {
    await vi.waitFor(() => expect(frame).toContain('[missing] Missing'))
    const lines = frame.split('\n')
    expect(lines).toHaveLength(12)
    expect(lines[0]).toContain('Recent documents · 2')
    expect(lines[1]).toContain('Search: type to filter')
    expect(lines[11]).toContain('Enter open · Tab help · Esc quit')
    expect(lines.every((line) => widthOf(line) <= 80)).toBe(true)
    expect(frame).not.toContain('Ctrl+D')
    stdout.rows = 6
    stdout.emit('resize')
    stdin.write('\u001b[6~')
    await vi.waitFor(() => expect(frame).toContain('› Remote'))
    expect(frame).not.toContain('[missing] Missing')
    expect(frame).toContain('2/2')
    stdin.write('\t')
    await vi.waitFor(() => {
      expect(frame.split('\n')).toHaveLength(6)
      expect(frame).not.toContain('╭')
      expect(frame).toContain('History help')
      expect(frame).toContain('Ctrl+D remove')
      expect(frame).toContain('Ctrl+X clear')
    })
    stdin.write('\u001b')
    await vi.waitFor(() => expect(frame).toContain('› Remote'))
    stdin.write('\u001b[5~')
    await vi.waitFor(() => expect(frame).toContain('› [missing] Missing'))
    stdout.rows = 12
    stdout.emit('resize')
    stdin.write('\r')
    await vi.waitFor(() => expect(frame).toContain('ENOENT'))
    expect(await history.read()).toHaveLength(2)
    stdin.write('h')
    await vi.waitFor(() => expect(frame).toContain('[missing] Missing'))
    stdin.write('\u0004')
    await vi.waitFor(() => { expect(frame).toContain('Recent documents · 1'); expect(frame).not.toContain('Missing') })
    stdin.write('\u0018')
    await vi.waitFor(() => expect(frame).toContain('Clear all 1 recent documents?'))
    expect(frame).toContain('Your files stay on disk')
    expect(frame).not.toContain('Search:')
    expect(frame).not.toContain('Enter open')
    stdin.write('n')
    await vi.waitFor(() => expect(frame).toContain('Remote'))
    expect(await history.read()).toHaveLength(1)
    stdin.write('\u0018')
    await vi.waitFor(() => expect(frame).toContain('Clear all 1 recent documents?'))
    stdin.write('y')
    await vi.waitFor(() => expect(frame).toContain('No recent documents'))
    expect(await history.read()).toEqual([])
  } finally {
    app.unmount()
    app.cleanup()
    await renderer.dispose()
    await history.flush()
    stdin.destroy()
    stdout.destroy()
    await rm(root, { recursive: true, force: true })
  }
}, 10000)
