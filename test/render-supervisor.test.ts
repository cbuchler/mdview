import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { RenderCancelledError, RenderSupervisor } from '../src/render-supervisor.js'
import { DocumentReceiver, MAX_RENDER_LINES, MAX_RENDER_SEGMENTS, MAX_RENDER_TEXT_BYTES } from '../src/render-protocol.js'

const options = { width: 80, padding: 0, wrap: true, theme: 'github', syntaxTheme: 'dracula', sourceName: 'test.md' }
const maxBytes = 2 * 1024 * 1024
const fixture = path.join(import.meta.dirname, 'fixtures/render-worker.mjs')
const gone = (pid: number) => {
  try { process.kill(pid, 0); return false } catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' }
}

it('renders and reflows in the real worker, and recovers after invalid Markdown', async () => {
  const renderer = new RenderSupervisor()
  try {
    const markdown = '# Title\n\n' + '界 👩‍💻 content '.repeat(30)
    const wide = await renderer.render(markdown, options, maxBytes)
    const narrow = await renderer.render(markdown, { ...options, width: 20 }, maxBytes)
    expect(wide.title).toBe('Title')
    expect((await renderer.render('Safe body', { ...options, sourceName: 'file\u001b[31m\u009b.md' }, maxBytes)).title).toBe('file.md')
    expect(narrow.lines.length).toBeGreaterThan(wide.lines.length)
    await expect(renderer.render('> '.repeat(2000) + 'x', options, maxBytes)).rejects.toThrow('Markdown nesting exceeds')
    expect((await renderer.render('# Recovered', options, maxBytes)).title).toBe('Recovered')
    // A configured input limit above the default also applies across the protocol.
    expect((await renderer.render('x'.repeat(maxBytes + 1), { ...options, wrap: false }, maxBytes + 1)).lines[0][0].text.length).toBe(maxBytes + 1)
  } finally {
    await renderer.dispose()
  }
}, 15000)

it('times out a CPU-bound child, reaps it, and starts a healthy replacement', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-worker-'))
  const pidFile = path.join(directory, 'pid')
  const renderer = new RenderSupervisor({ command: [process.execPath, fixture, 'normal', pidFile], timeoutMs: 300 })
  try {
    await expect(renderer.render('busy', options, maxBytes)).rejects.toThrow('deadline')
    const pid = Number(await readFile(pidFile, 'utf8'))
    await vi.waitFor(() => expect(gone(pid)).toBe(true))
    const recovered = await renderer.render('healthy', options, maxBytes)
    expect(recovered.lines[0][0].text).toBe('healthy')
    expect(Number(recovered.title)).not.toBe(pid)
  } finally {
    await renderer.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

it('supersedes busy work without letting old requests overwrite the latest, and awaits disposal', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-cancel-'))
  const pidFile = path.join(directory, 'pid')
  const renderer = new RenderSupervisor({ command: [process.execPath, fixture, 'normal', pidFile] })
  try {
    const first = renderer.render('busy', options, maxBytes)
    const cancelled = expect(first).rejects.toBeInstanceOf(RenderCancelledError)
    await vi.waitFor(async () => expect(Number(await readFile(pidFile, 'utf8'))).toBeGreaterThan(0))
    const firstPid = Number(await readFile(pidFile, 'utf8'))
    const obsolete = renderer.render('obsolete', options, maxBytes)
    const obsoleteRejected = expect(obsolete).rejects.toBeInstanceOf(RenderCancelledError)
    const latest = await renderer.render('latest', options, maxBytes)
    await cancelled
    await obsoleteRejected
    expect(latest.lines[0][0].text).toBe('latest')
    expect(gone(firstPid)).toBe(true)
    const latestPid = Number(latest.title)
    expect((await renderer.render('idle reuse', options, maxBytes)).title).toBe(latest.title)
    const busy = renderer.render('busy', options, maxBytes)
    const disposed = expect(busy).rejects.toBeInstanceOf(RenderCancelledError)
    await new Promise((resolve) => setTimeout(resolve, 30))
    await renderer.dispose()
    await disposed
    expect(gone(latestPid)).toBe(true)
    await expect(renderer.render('after disposal', options, maxBytes)).rejects.toBeInstanceOf(RenderCancelledError)
  } finally {
    await renderer.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

it.each([
  ['oversized', 'frame exceeds'],
  ['diagnostics', 'diagnostic limit'],
  ['malformed', 'encoded data'],
  ['controls', 'Invalid text'],
  ['style', 'Invalid render color'],
  ['exit', 'exited before completion'],
  ['trailing', 'Trailing partial'],
])('rejects %s worker output and reaps the child', async (mode, message) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-bad-worker-'))
  const pidFile = path.join(directory, 'pid')
  const renderer = new RenderSupervisor({ command: [process.execPath, fixture, mode, pidFile], timeoutMs: 1000 })
  try {
    await expect(renderer.render('input', options, maxBytes)).rejects.toThrow(message)
    const pid = Number(await readFile(pidFile, 'utf8'))
    await renderer.dispose()
    expect(gone(pid)).toBe(true)
  } finally {
    await renderer.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

it('bounds decoded lines, segments, and text even when individual records fit the wire budget', () => {
  const receiver = () => {
    const result = new DocumentReceiver()
    result.accept({ type: 'start', title: 'Title', parseMs: 0 })
    return result
  }
  const lines = receiver()
  for (let index = 0; index < MAX_RENDER_LINES; ++index) lines.accept({ type: 'line', line: [] })
  expect(() => lines.accept({ type: 'line', line: [] })).toThrow('line limit')
  const segments = receiver()
  expect(() => segments.accept({ type: 'line', line: Array.from({ length: MAX_RENDER_SEGMENTS + 1 }, () => ({ text: '' })) })).toThrow('segment limit')
  expect(() => receiver().accept({ type: 'line', line: [{ text: 'x'.repeat(MAX_RENDER_TEXT_BYTES + 1) }] })).toThrow('Invalid text')
})

it('reports worker startup failure without waiting for the render deadline', async () => {
  const renderer = new RenderSupervisor({ command: ['/nonexistent/mdview-render-worker'] })
  try {
    await expect(renderer.render('input', options, maxBytes)).rejects.toThrow('Cannot start render worker')
  } finally {
    await renderer.dispose()
  }
})
