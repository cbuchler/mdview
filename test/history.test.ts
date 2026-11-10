import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { HistoryStore, historyIdentity } from '../src/history.js'
import { resolveSource } from '../src/source.js'
import { captureReadingAnchor } from '../src/reading-anchor.js'
import { renderMarkdownDocument } from '../src/markdown.js'
import { resolveTheme } from '../src/theme.js'

const directories: string[] = []
const fixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mdview-history-'))
  directories.push(root)
  return { root, store: new HistoryStore(path.join(root, 'state')) }
}
const entry = (location: string, openedAt = 1) => ({ kind: 'file' as const, location, title: path.basename(location), openedAt })
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

it('canonicalizes aliases, updates one visit, and prunes the oldest entries in a private SQLite store', async () => {
  const { root, store } = await fixture()
  const file = path.join(root, 'doc.md')
  const alias = path.join(root, 'alias.md')
  await writeFile(file, 'content')
  await symlink(file, alias)
  expect(await historyIdentity(resolveSource(alias))).toEqual(await historyIdentity(resolveSource(file)))
  await store.remember(entry(file))
  await store.remember({ ...entry(file, 2), title: 'New title' })
  await store.remember({ ...entry(file, 1), title: 'Delayed older visit' })
  expect(await store.read()).toMatchObject([{ location: file, openedAt: 2, title: 'New title' }])
  const database = new DatabaseSync(path.join(store.directory, 'history.sqlite3'))
  try {
    const insert = database.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)')
    database.exec('BEGIN')
    for (let index = 0; index < 199; index++) insert.run(`/file-${index}`, 'file', 'Title', index + 3, null)
    database.exec('COMMIT')
  } finally { database.close() }
  await store.remember(entry('/newest', 1000))
  const rows = await store.read()
  expect(rows).toHaveLength(200)
  expect(rows[0].location).toBe('/newest')
  expect(rows.some((item) => item.location === file)).toBe(false)
  expect((await stat(store.directory)).mode & 0o777).toBe(0o700)
  expect((await stat(path.join(store.directory, 'history.sqlite3'))).mode & 0o777).toBe(0o600)
  expect((await readFile(path.join(store.directory, 'history.sqlite3'))).subarray(0, 15).toString()).toBe('SQLite format 3')
})

it('excludes stdin and sensitive URL forms without returning their secrets', async () => {
  expect(await historyIdentity(resolveSource('-'))).toBeUndefined()
  for (const url of ['https://user:secret@example.com/doc', 'https://example.com/doc?token=secret', 'https://example.com/doc#secret']) {
    await expect(historyIdentity(resolveSource(url))).rejects.toThrow('History excludes URLs')
  }
  expect(await historyIdentity(resolveSource('https://EXAMPLE.com:443/doc'))).toEqual({ kind: 'url', location: 'https://example.com/doc' })
})

it('merges real concurrent processes and retries a held SQLite lock without blocking timers', async () => {
  const { store } = await fixture()
  const run = promisify(execFile)
  await Promise.all(['first', 'second'].map((name) => run(process.execPath, ['--import', 'tsx', 'test/fixtures/history-writer.ts', store.directory, name], { timeout: 10000 })))
  expect((await store.read()).map((item) => item.location).sort()).toEqual(
    ['first', 'second'].flatMap((name) => Array.from({ length: 10 }, (_, index) => `/${name}-${index}`)).sort(),
  )
  const database = new DatabaseSync(path.join(store.directory, 'history.sqlite3'))
  try {
    database.exec('BEGIN IMMEDIATE')
    const pending = store.remember(entry('/after-lock'))
    await new Promise<void>((resolve) => setTimeout(() => { database.exec('COMMIT'); resolve() }, 100))
    await pending
    expect((await store.read()).some((item) => item.location === '/after-lock')).toBe(true)
    database.exec('BEGIN IMMEDIATE')
    await expect(store.remember(entry('/blocked'))).rejects.toThrow('busy')
    database.exec('ROLLBACK')
  } finally { database.close() }
}, 15000)

it('stores validated anchors and does not recreate removed or cleared entries from pending positions', async () => {
  const { store } = await fixture()
  const document = renderMarkdownDocument('# Private text\n\nA private passage', {
    width: 40, padding: 0, wrap: true, theme: resolveTheme('github'), syntaxTheme: resolveTheme('github'), sourceName: 'doc',
  })
  const anchor = captureReadingAnchor(document, 2)!
  await store.remember(entry('/doc'))
  store.position('/doc', anchor)
  await store.flush()
  expect((await store.read())[0].anchor).toEqual(anchor)
  expect(JSON.stringify((await store.read())[0].anchor)).not.toContain('private passage')
  await store.remember(entry('/doc', 2))
  expect((await store.read())[0].anchor).toEqual(anchor)
  await store.remove('/doc')
  store.position('/doc', anchor)
  await store.flush()
  expect(await store.read()).toEqual([])
  await store.remember(entry('/again'))
  store.position('/again', anchor)
  await store.clear()
  await store.flush()
  expect(await store.read()).toEqual([])
  await expect(store.remember({ ...entry('/invalid'), anchor: { ...anchor, offset: -1 } })).rejects.toThrow('Invalid reading anchor')
})

it('preserves corrupt or unsafe storage and rejects malformed persisted anchors', async () => {
  const { root, store } = await fixture()
  await mkdir(store.directory, { mode: 0o700 })
  const file = path.join(store.directory, 'history.sqlite3')
  await writeFile(file, 'broken database', { mode: 0o600 })
  await expect(store.read()).rejects.toThrow('History cannot be read')
  await expect(store.remember(entry('/doc'))).rejects.toThrow()
  expect(await readFile(file, 'utf8')).toBe('broken database')
  await rm(file)
  const target = path.join(root, 'unrelated')
  await writeFile(target, 'untouched')
  await symlink(target, file)
  await expect(store.remember(entry('/doc'))).rejects.toThrow()
  expect(await readFile(target, 'utf8')).toBe('untouched')
  await rm(file)
  await store.remember(entry('/doc'))
  const database = new DatabaseSync(file)
  database.exec("UPDATE history SET anchor = '{}'")
  database.close()
  await expect(store.read()).rejects.toThrow('History cannot be read')
  await store.clear()
  expect(await store.read()).toEqual([])
  const blocked = new HistoryStore(target)
  await expect(blocked.remember(entry('/doc'))).rejects.toThrow()
})
