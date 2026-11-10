import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { ReadingAnchor, ResolvedSource } from './types.js'
import { sanitizeDisplayText } from './utils.js'
import { parseReadingAnchor } from './reading-anchor.js'

export interface HistoryEntry {
  kind: 'file' | 'url'
  location: string
  title: string
  openedAt: number
  anchor?: ReadingAnchor
}

const maxEntries = 200
const maxBytes = 4 * 1024 * 1024
const safeText = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit &&
  sanitizeDisplayText(value) === value && !/[\u0000-\u001f\u007f-\u009f]/.test(value)

export function historyDirectory(): string {
  const state = process.env.XDG_STATE_HOME
  return path.join(state && path.isAbsolute(state) ? state : path.join(os.homedir(), '.local', 'state'), 'mdview')
}

export async function historyIdentity(source: ResolvedSource): Promise<{ kind: 'file' | 'url'; location: string } | undefined> {
  if (source.kind === 'stdin') return undefined
  const location = source.kind === 'file' ? await realpath(source.input) : new URL(source.input).href
  if (!safeText(location, 8192)) throw new Error('This location cannot be saved in history.')
  if (source.kind === 'url') {
    const url = new URL(location)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('History excludes URLs with credentials, queries, or fragments.')
    }
  }
  return { kind: source.kind, location }
}

function parseEntry(value: unknown): HistoryEntry {
  if (!value || typeof value !== 'object') throw new Error('Invalid history entry')
  const entry = value as Record<string, unknown>
  if (!safeText(entry.location, 8192) || !entry.location || !safeText(entry.title, 512) ||
      !Number.isSafeInteger(entry.openedAt) || (entry.openedAt as number) < 0) throw new Error('Invalid history entry')
  if (entry.kind === 'file') {
    if (!path.isAbsolute(entry.location)) throw new Error('Invalid history file location')
  } else if (entry.kind === 'url') {
    const url = new URL(entry.location)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Unsafe history URL')
  } else throw new Error('Invalid history source kind')
  return {
    kind: entry.kind, location: entry.location, title: entry.title, openedAt: entry.openedAt as number,
    anchor: entry.anchor === undefined ? undefined : parseReadingAnchor(entry.anchor),
  }
}

export class HistoryStore {
  private queue: Promise<void> = Promise.resolve()
  private positions = new Map<string, ReadingAnchor | undefined>()
  private timer: ReturnType<typeof setTimeout> | undefined
  onWarning: (message: string) => void = () => {}

  constructor(readonly directory = historyDirectory()) {}

  private async checkDirectory(create = false): Promise<void> {
    if (create) await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const info = await lstat(this.directory)
    if (!info.isDirectory() || (process.getuid && info.uid !== process.getuid()) || (info.mode & 0o077)) {
      throw new Error('History directory must be an owned, private directory (0700).')
    }
  }

  private async connect(create: boolean): Promise<DatabaseSync> {
    await this.checkDirectory(create)
    const file = path.join(this.directory, 'history.sqlite3')
    const handle = await open(file, constants.O_RDWR | constants.O_NONBLOCK | constants.O_NOFOLLOW | (create ? constants.O_CREAT : 0), 0o600)
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > maxBytes || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid())) throw new Error('Unsafe history database')
    } finally { await handle.close() }
    for (const suffix of ['-wal', '-shm', '-journal']) {
      try {
        const info = await lstat(file + suffix)
        if (!info.isFile() || info.size > maxBytes * 2 || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid())) throw new Error('Unsafe history journal')
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    const { DatabaseSync } = await import('node:sqlite')
    const database = new DatabaseSync(file)
    try {
      database.exec('PRAGMA busy_timeout = 0; PRAGMA trusted_schema = OFF; PRAGMA secure_delete = ON; PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 32; PRAGMA journal_size_limit = 262144')
      const pageSize = Number(database.prepare('PRAGMA page_size').get()?.page_size)
      database.exec(`PRAGMA max_page_count = ${Math.floor(maxBytes / pageSize)}`)
      const version = Number(database.prepare('PRAGMA user_version').get()?.user_version)
      if (version === 0) {
        database.exec(`BEGIN IMMEDIATE;
          CREATE TABLE IF NOT EXISTS history (
            location TEXT PRIMARY KEY CHECK(length(location) <= 8192),
            kind TEXT NOT NULL CHECK(kind IN ('file', 'url')),
            title TEXT NOT NULL CHECK(length(title) <= 512),
            opened_at INTEGER NOT NULL CHECK(opened_at >= 0),
            anchor TEXT CHECK(anchor IS NULL OR length(anchor) <= 2048)
          ) STRICT;
          PRAGMA user_version = 1;
          COMMIT`)
      } else if (version !== 1) throw new Error('Unsupported history schema')
      return database
    } catch (error) { database.close(); throw error }
  }

  private async access<T>(write: boolean, operation: (database: DatabaseSync) => T): Promise<T> {
    const deadline = Date.now() + 1500
    while (true) {
      let database: DatabaseSync | undefined
      try {
        database = await this.connect(write)
        if (write) database.exec('BEGIN IMMEDIATE')
        const result = operation(database)
        if (write) database.exec('COMMIT')
        return result
      } catch (error) {
        const failure = error as { code?: string; errcode?: number; message?: string }
        const busy = failure.code === 'SQLITE_BUSY' || failure.code === 'SQLITE_LOCKED' ||
          failure.errcode === 5 || failure.errcode === 6
        if (!busy) throw error
        if (Date.now() >= deadline) throw new Error('History is busy. Reading can continue; try history again shortly.')
      } finally { database?.close() }
      // SQLite's synchronous busy handler would freeze keyboard input.
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  async read(): Promise<HistoryEntry[]> {
    try {
      return await this.access(false, (database) => {
        const rows = database.prepare('SELECT location, kind, title, opened_at AS openedAt, anchor FROM history ORDER BY opened_at DESC LIMIT 201').all()
        if (rows.length > maxEntries) throw new Error('History exceeds its entry limit')
        return rows.map((row) => parseEntry({ ...row, anchor: row.anchor === null ? undefined : JSON.parse(String(row.anchor)) }))
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new Error('History cannot be read. Check its permissions or move the state directory aside after closing all mdview sessions.', { cause: error })
    }
  }

  private change(operation: (database: DatabaseSync) => void): Promise<void> {
    const result = this.queue.then(() => this.access(true, operation))
    this.queue = result.catch(() => {})
    return result
  }

  async remember(entry: HistoryEntry): Promise<void> {
    const clean = parseEntry({ ...entry, title: sanitizeDisplayText(entry.title).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 512) })
    return this.change((database) => {
      database.prepare(`INSERT INTO history (location, kind, title, opened_at, anchor) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(location) DO UPDATE SET
        title = CASE WHEN excluded.opened_at >= history.opened_at THEN excluded.title ELSE history.title END,
        opened_at = max(history.opened_at, excluded.opened_at),
        anchor = coalesce(excluded.anchor, history.anchor)`).run(clean.location, clean.kind, clean.title, clean.openedAt, clean.anchor ? JSON.stringify(clean.anchor) : null)
      database.exec('DELETE FROM history WHERE location NOT IN (SELECT location FROM history ORDER BY opened_at DESC LIMIT 200)')
    })
  }

  position(location: string, anchor: ReadingAnchor | undefined): void {
    this.positions.set(location, anchor)
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.flush().catch((error: unknown) => this.onWarning(error instanceof Error ? error.message : String(error))) }, 250)
    this.timer.unref()
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer)
    if (this.positions.size) {
      const positions = this.positions
      this.positions = new Map()
      await this.change((database) => {
        const update = database.prepare('UPDATE history SET anchor = ? WHERE location = ?')
        for (const [location, anchor] of positions) update.run(anchor ? JSON.stringify(parseReadingAnchor(anchor)) : null, location)
      })
    }
    await this.queue
  }

  async remove(location: string): Promise<void> {
    await this.flush()
    await this.change((database) => { database.prepare('DELETE FROM history WHERE location = ?').run(location) })
  }

  async clear(): Promise<void> {
    this.positions.clear()
    clearTimeout(this.timer)
    await this.change((database) => { database.exec('DELETE FROM history') })
  }
}
