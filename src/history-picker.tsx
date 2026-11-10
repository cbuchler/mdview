import React, { useEffect, useState } from 'react'
import { Box, Text, useInput, useStdout, useApp } from 'ink'
import os from 'node:os'
import { stat } from 'node:fs/promises'
import type { HistoryEntry, HistoryStore } from './history.js'
import { graphemes, sanitizeDisplayText } from './utils.js'

export function filterHistory(entries: HistoryEntry[], query: string): HistoryEntry[] {
  const points = Array.from(query.normalize('NFKC').toLowerCase())
  return entries.filter((entry) => {
    let index = 0
    for (const point of `${entry.title} ${entry.location}`.normalize('NFKC').toLowerCase()) {
      if (point === points[index]) index++
    }
    return index === points.length
  })
}

export function HistoryPicker({ store, onOpen, onClose, notice }: {
  store?: HistoryStore
  onOpen: (entry: HistoryEntry) => void
  onClose: () => void
  notice?: string
}): React.JSX.Element {
  const { stdout } = useStdout()
  const { exit } = useApp()
  const [size, setSize] = useState({ columns: stdout.columns || 80, rows: stdout.rows || 24 })
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [unavailable, setUnavailable] = useState(new Set<string>())
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const resize = () => setSize({ columns: stdout.columns || 80, rows: stdout.rows || 24 })
    stdout.on('resize', resize)
    return () => { stdout.off('resize', resize) }
  }, [stdout])
  useEffect(() => {
    let current = true
    setBusy(true)
    void (async () => {
      try {
        await store?.flush()
        const next = await store?.read() ?? []
        const missing = await Promise.all(next.map(async (entry) => {
          if (entry.kind !== 'file') return undefined
          try { if ((await stat(entry.location)).isFile()) return undefined } catch {}
          return entry.location
        }))
        if (current) {
          setError(undefined)
          setEntries(next)
          setUnavailable(new Set(missing.filter((value): value is string => value !== undefined)))
        }
      } catch (failure) {
        if (current) setError(failure instanceof Error ? failure.message : String(failure))
      } finally { if (current) setBusy(false) }
    })()
    return () => { current = false }
  }, [store, revision])
  const matches = filterHistory(entries, query)
  const index = Math.min(selected, Math.max(0, matches.length - 1))
  const mutate = (action: () => Promise<void>) => {
    setBusy(true)
    void action().then(() => {
      setError(undefined)
      setSelected(0)
      setRevision((value) => value + 1)
    }).catch((failure: unknown) => {
      setError(failure instanceof Error ? failure.message : String(failure))
      setBusy(false)
    })
  }
  useInput((input, key) => {
    if (key.ctrl && input === 'c') { exit(); return }
    if (key.escape) {
      if (confirm) setConfirm(false)
      else onClose()
      return
    }
    if (busy) return
    if (confirm) {
      setConfirm(false)
      if (input.toLowerCase() === 'y' && store) mutate(() => store.clear())
      return
    }
    if (key.downArrow || (key.ctrl && input === 'n')) { setSelected(Math.max(0, Math.min(index + 1, matches.length - 1))); return }
    if (key.upArrow || (key.ctrl && input === 'p')) { setSelected(Math.max(0, index - 1)); return }
    if (key.return) { if (matches[index]) onOpen(matches[index]); return }
    if (key.ctrl && input === 'd') { if (store && matches[index]) mutate(() => store.remove(matches[index].location)); return }
    if (key.ctrl && input === 'x') { if (store) setConfirm(true); return }
    if (key.backspace || key.delete) { setQuery(graphemes(query).slice(0, -1).join('')); setSelected(0); return }
    if (!key.ctrl && !key.meta) {
      setQuery((value) => (value + sanitizeDisplayText(input).replace(/[\u0000-\u001f\u007f-\u009f]/g, '')).slice(0, 256))
      setSelected(0)
    }
  })
  const pageSize = Math.max(1, Math.floor((size.rows - 5) / 2))
  const start = Math.floor(index / pageSize) * pageSize
  const message = confirm ? 'Clear all history? y confirms; any other key cancels.' : error ?? notice ??
    (!store ? 'History is disabled for this invocation.' : busy ? 'Loading history…' : entries.length === 0 ? 'No recent documents. Open one with mdview PATH or mdview URL.' : matches.length === 0 ? 'No matching documents.' : `${matches.length} recent documents`)
  const location = (entry: HistoryEntry) => entry.location.startsWith(os.homedir() + '/') ? '~' + entry.location.slice(os.homedir().length) : entry.location
  return <Box flexDirection="column" width={size.columns} height={size.rows} overflow="hidden">
    <Text bold wrap="truncate-end">Recent documents</Text>
    <Text wrap="truncate-end">Search: {query}</Text>
    <Text color={error ? 'red' : undefined} wrap="truncate-end">{sanitizeDisplayText(message)}</Text>
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {matches.slice(start, start + pageSize).map((entry, offset) => <Box key={entry.location} flexDirection="column" flexShrink={0}>
        <Text inverse={start + offset === index} wrap="truncate-end">{start + offset === index ? '› ' : '  '}{unavailable.has(entry.location) ? '[missing] ' : ''}{sanitizeDisplayText(entry.title || entry.location)}</Text>
        <Text dimColor wrap="truncate-middle">  {sanitizeDisplayText(location(entry))} · {new Date(entry.openedAt).toLocaleString()}</Text>
      </Box>)}
    </Box>
    <Text wrap="truncate-end">↑/↓ select · Enter open · Esc back</Text>
    <Text wrap="truncate-end">Ctrl+D remove · Ctrl+X clear · type to search</Text>
  </Box>
}
