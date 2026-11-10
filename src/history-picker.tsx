import React, { useEffect, useState } from 'react'
import { Box, Text, useInput, useStdout, useApp } from 'ink'
import os from 'node:os'
import { stat } from 'node:fs/promises'
import type { HistoryEntry, HistoryStore } from './history.js'
import { graphemes, sanitizeDisplayText } from './utils.js'
import { resolveTheme } from './theme.js'
import type { ThemeName } from './types.js'

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

export function HistoryPicker({ store, onOpen, onClose, notice, theme: themeName, canGoBack }: {
  store?: HistoryStore
  onOpen: (entry: HistoryEntry) => void
  onClose: () => void
  notice?: string
  theme: ThemeName
  canGoBack: boolean
}): React.JSX.Element {
  const { stdout } = useStdout()
  const { exit } = useApp()
  const theme = resolveTheme(themeName)
  const [size, setSize] = useState({ columns: stdout.columns || 80, rows: stdout.rows || 24 })
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [unavailable, setUnavailable] = useState(new Set<string>())
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [confirm, setConfirm] = useState(false)
  const [help, setHelp] = useState(false)
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
  const message = error ?? notice ?? (!store ? 'History is disabled for this invocation.' : busy ? 'Loading history…' : undefined)
  const framed = size.rows >= 10 && size.columns >= 10
  const barHeight = framed ? 3 : 1
  const pageSize = Math.max(1, Math.floor((size.rows - 2 * barHeight - 1 - (message ? 1 : 0)) / 2))
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
      else if (help) setHelp(false)
      else onClose()
      return
    }
    if (busy) return
    if (confirm) {
      setConfirm(false)
      if (input.toLowerCase() === 'y' && store) {
        setHelp(false)
        mutate(() => store.clear())
      }
      return
    }
    if (key.tab) { setHelp((value) => !value); return }
    if (key.ctrl && input === 'd') {
      if (store && matches[index]) { setHelp(false); mutate(() => store.remove(matches[index].location)) }
      return
    }
    if (key.ctrl && input === 'x') { if (store && entries.length) setConfirm(true); return }
    if (help) return
    if (key.downArrow || (key.ctrl && input === 'n')) { setSelected(Math.max(0, Math.min(index + 1, matches.length - 1))); return }
    if (key.upArrow || (key.ctrl && input === 'p')) { setSelected(Math.max(0, index - 1)); return }
    if (key.pageDown) { setSelected(Math.max(0, Math.min(index + pageSize, matches.length - 1))); return }
    if (key.pageUp) { setSelected(Math.max(0, index - pageSize)); return }
    if (key.return) { if (matches[index]) onOpen(matches[index]); return }
    if (key.backspace || key.delete) { setQuery(graphemes(query).slice(0, -1).join('')); setSelected(0); return }
    if (!key.ctrl && !key.meta) {
      setQuery((value) => (value + sanitizeDisplayText(input).replace(/[\u0000-\u001f\u007f-\u009f]/g, '')).slice(0, 256))
      setSelected(0)
    }
  })
  const start = Math.floor(index / pageSize) * pageSize
  const location = (entry: HistoryEntry) => entry.location.startsWith(os.homedir() + '/') ? '~' + entry.location.slice(os.homedir().length) : entry.location
  const back = canGoBack ? 'back' : 'quit'
  const hints = confirm ? 'y clear · any other key cancels' : help ? 'Tab or Esc back · Ctrl+C quit' :
    size.columns >= 65 ? `↑↓ select · Enter open · Tab help · Esc ${back}` : size.columns >= 40 ? 'Enter open · Tab help' : 'Enter · Tab help'
  return <Box flexDirection="column" width={size.columns} height={size.rows} overflow="hidden">
    <Box borderStyle={framed ? 'round' : undefined} borderColor={theme.border} paddingX={1} height={barHeight} flexShrink={0} overflow="hidden">
      <Text color={theme.heading} bold wrap="truncate-end">{confirm ? 'Clear history' : help ? 'History help' : `Recent documents · ${matches.length}`}</Text>
    </Box>
    <Box flexDirection="column" paddingX={1} flexGrow={1} overflow="hidden">
      {confirm ? <>
        <Text color={theme.warning} bold>Clear all {entries.length} recent documents?</Text>
        <Text>This removes the saved history and reading positions. Your files stay on disk.</Text>
      </> : help ? <>
        <Text wrap="truncate-end">Type to search · Backspace edits</Text>
        <Text wrap="truncate-end">↑/↓ select · PgUp/PgDn page</Text>
        <Text wrap="truncate-end">Ctrl+D remove selected entry</Text>
        <Text wrap="truncate-end">Ctrl+X clear history (confirms)</Text>
      </> : <>
        <Box height={1} flexShrink={0}>
          <Text color={theme.accent} wrap="truncate-end">Search: <Text color={query ? theme.foreground : theme.muted}>{query || 'type to filter…'}</Text></Text>
        </Box>
        {message ? <Text color={error ? theme.error : theme.warning} wrap="truncate-end">{sanitizeDisplayText(message)}</Text> : null}
        {!busy && !matches.length ? <Text>{entries.length ? 'No matching documents. Backspace edits your search.' : 'No recent documents. Open one with mdview PATH or mdview URL.'}</Text> : null}
        {matches.slice(start, start + pageSize).map((entry, offset) => <Box key={entry.location} flexDirection="column" flexShrink={0}>
          <Box columnGap={1} justifyContent="space-between" height={1}>
            <Box flexDirection="column" flexGrow={1} flexBasis={0} minWidth={0}>
              <Text inverse={start + offset === index} wrap="truncate-end">{start + offset === index ? '› ' : '  '}{unavailable.has(entry.location) ? '[missing] ' : ''}{sanitizeDisplayText(entry.title || entry.location)}</Text>
            </Box>
            {size.columns >= 40 ? <Box flexShrink={0}><Text color={theme.muted}>{new Date(entry.openedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</Text></Box> : null}
          </Box>
          <Text color={theme.muted} wrap="truncate-middle">  {sanitizeDisplayText(location(entry))}</Text>
        </Box>)}
      </>}
    </Box>
    <Box borderStyle={framed ? 'round' : undefined} borderColor={theme.border} paddingX={1} columnGap={1} justifyContent="space-between" height={barHeight} flexShrink={0} overflow="hidden">
      <Box flexDirection="column" flexGrow={1} flexBasis={0} minWidth={0}><Text color={theme.muted} wrap="truncate-end">{hints}</Text></Box>
      {!help && !confirm && matches.length ? <Box flexShrink={0}><Text color={theme.muted}>{index + 1}/{matches.length}</Text></Box> : null}
    </Box>
  </Box>
}
