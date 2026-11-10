import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import { App } from './app.js'
import { HistoryPicker } from './history-picker.js'
import { historyIdentity } from './history.js'
import type { HistoryEntry, HistoryStore } from './history.js'
import type { AppConfig, ReadingAnchor, ResolvedSource } from './types.js'
import type { RenderSupervisor } from './render-supervisor.js'
import { resolveSource } from './source.js'

interface Session {
  id: number
  source: ResolvedSource
  identity?: Pick<HistoryEntry, 'kind' | 'location'>
  anchor?: ReadingAnchor
}

export function Navigation({ source, config, renderer, history }: {
  source?: ResolvedSource
  config: AppConfig
  renderer: RenderSupervisor
  history?: HistoryStore
}): React.JSX.Element {
  const { exit } = useApp()
  const [session, setSession] = useState<Session>()
  const [picker, setPicker] = useState(!source)
  const [notice, setNotice] = useState<string>()
  useInput((input, key) => { if (input === 'q' || (key.ctrl && input === 'c')) exit() }, { isActive: !session && !picker })
  const nextId = useRef(0)
  const remembered = useRef<number>()
  const warn = useCallback((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)), [])
  useEffect(() => {
    if (history) history.onWarning = warn
    return () => { if (history) history.onWarning = () => {} }
  }, [history, warn])
  useEffect(() => {
    if (!source) return
    let current = true
    void (async () => {
      let identity: Session['identity']
      let anchor: ReadingAnchor | undefined
      try {
        if (history) {
          identity = await historyIdentity(source)
          if (identity) anchor = (await history.read()).find((entry) => entry.location === identity?.location)?.anchor
        }
      } catch (error) { if (current) warn(error) }
      if (current) setSession({ id: ++nextId.current, source, identity, anchor })
    })()
    return () => { current = false }
  }, [source, history, warn])
  const record = (title: string, anchor?: ReadingAnchor) => {
    if (!session || !history || session.source.kind === 'stdin') return
    if (remembered.current !== session.id) {
      remembered.current = session.id
      void (async () => {
        const identity = session.identity ?? await historyIdentity(session.source)
        if (!identity) return
        if (!session.identity) setSession((current) => current?.id === session.id ? { ...current, identity } : current)
        const saved = history.remember({ ...identity, title, openedAt: Date.now(), anchor })
        history.position(identity.location, anchor)
        await saved
      })().catch(warn)
    } else if (session.identity) history.position(session.identity.location, anchor)
  }
  const open = (entry: HistoryEntry) => {
    setNotice(undefined)
    setSession({ id: ++nextId.current, source: resolveSource(entry.location), identity: entry, anchor: entry.anchor })
    setPicker(false)
  }
  return <>
    {session ? <Box display={picker ? 'none' : 'flex'}>
      <App key={session.id} source={session.source} config={config} renderer={renderer} active={!picker}
        initialAnchor={session.anchor} notice={notice}
        onHistory={() => setPicker(true)} onDocument={(document, anchor) => record(document.title, anchor)}
        onPosition={(anchor) => { if (session.identity && history && remembered.current === session.id) history.position(session.identity.location, anchor) }} />
    </Box> : !picker ? <Text>Loading document…</Text> : null}
    {picker ? <HistoryPicker store={history} theme={config.theme} notice={notice} onOpen={open} onClose={() => session ? setPicker(false) : exit()} /> : null}
  </>
}
