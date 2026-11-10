import { captureReadingAnchor, restoreReadingAnchor } from './reading-anchor.js'
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AppConfig, LoadResult, ResolvedSource, RenderedDocument, ReadingAnchor } from './types.js'
import { clamp, sanitizeDisplayText } from './utils.js';
import { resolveTheme } from './theme.js';
import { loadSource } from './source.js';
import { RenderSupervisor, RenderCancelledError } from './render-supervisor.js'
import { watchMarkdownFile } from './watcher.js';

interface AppProps {
  source: ResolvedSource;
  config: AppConfig;
  renderer?: RenderSupervisor
  active?: boolean
  initialAnchor?: ReadingAnchor
  notice?: string
  onHistory?: () => void
  onDocument?: (document: RenderedDocument, anchor?: ReadingAnchor) => void
  onPosition?: (anchor?: ReadingAnchor) => void
}

type LoadState =
  | { phase: 'loading'; message?: string; note?: string; result?: LoadResult }
  | { phase: 'ready'; result: LoadResult }
  | { phase: 'error'; error: string; note?: string; result?: LoadResult };

interface RenderedSource {
  result: LoadResult;
  document: RenderedDocument;
}

export function App({ source, config, renderer: suppliedRenderer, active = true, initialAnchor, notice, onHistory, onDocument, onPosition }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const theme = resolveTheme(config.theme);
  const renderer = useMemo(() => suppliedRenderer ?? new RenderSupervisor(), [suppliedRenderer])
  const renderRequest = useRef(0)
  const [document, setDocument] = useState<RenderedDocument | undefined>()
  const [{ columns, rows }, setDimensions] = useState(() => ({
    columns: stdout.columns || 80,
    rows: stdout.rows || 24,
  }));
  useEffect(() => {
    const resize = () => setDimensions({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
    stdout.on('resize', resize);
    resize();
    return () => { stdout.off('resize', resize); };
  }, [stdout]);
  const padding = Math.min(config.padding, Math.max(0, Math.floor((columns - 4) / 2)));
  const framed = rows >= 9 && columns >= 10
  const barHeight = framed ? 3 : 1
  const bodyHeight = Math.max(1, rows - 2 * barHeight)
  const [scrollOffset, setScrollOffset] = useState(0)
  const scroll = useRef(0)
  const viewportHeight = useRef(bodyHeight)
  const readingAnchor = useRef<ReadingAnchor | undefined>(initialAnchor)
  const callbacks = useRef({ onDocument, onPosition })
  callbacks.current = { onDocument, onPosition }
  const [state, setState] = useState<LoadState>({ phase: 'loading', message: `Loading ${source.displayName}...` });
  const activeRequest = useRef(0)
  const sourceRead = useRef<AbortController>()
  const lastGood = useRef<RenderedSource | undefined>(undefined);

  const load = useMemo(
    () => async (reason?: string): Promise<void> => {
      sourceRead.current?.abort()
      const controller = new AbortController()
      sourceRead.current = controller
      renderer.cancel()
      ++renderRequest.current
      const requestId = activeRequest.current + 1;
      activeRequest.current = requestId;
      setState((current) => ({
        phase: 'loading',
        message: reason ?? `Loading ${source.displayName}...`,
        result: lastGood.current?.result,
        note: current.phase === 'ready' ? 'Refreshing' : undefined,
      }));

      try {
        const result = await loadSource(source, {
          timeoutMs: config.timeoutMs,
          maxInputBytes: config.maxInputBytes,
          signal: controller.signal,
        });
        if (activeRequest.current !== requestId) {
          return;
        }
        setState({ phase: 'ready', result });
      } catch (error) {
        if (activeRequest.current !== requestId) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        if (lastGood.current) {
          setState({
            phase: 'error',
            error: message,
            note: 'Using last known content',
            result: lastGood.current.result,
          });
        } else {
          setState({ phase: 'error', error: message });
        }
      }
    },
    [config.maxInputBytes, config.timeoutMs, source, renderer],
  );

  useEffect(() => {
    void load();
    return () => {
      ++activeRequest.current
      sourceRead.current?.abort()
      ++renderRequest.current
      renderer.cancel()
    }
  }, [load, renderer]);

  useEffect(() => () => { if (!suppliedRenderer) void renderer.dispose() }, [renderer, suppliedRenderer])

  useEffect(() => {
    if (!source.canWatch || !config.watch) {
      return undefined;
    }

    const dispose = watchMarkdownFile(
      source.input,
      config.refreshIntervalMs,
      () => {
        void load(`Reloading ${source.displayName}...`);
      },
      () => {
        ++activeRequest.current
        ++renderRequest.current
        renderer.cancel()
        setState({
          phase: 'error',
          error: `${source.displayName} was removed`,
          result: lastGood.current?.result,
        });
      },
    );

    return () => {
      dispose();
    };
  }, [config.refreshIntervalMs, config.watch, load, source]);

  useEffect(() => {
    const result = state.result
    if (!result) return
    const requestId = ++renderRequest.current
    let mounted = true
    void renderer.render(result.text, {
      width: columns,
      theme: config.theme,
      wrap: config.wrap,
      padding,
      syntaxTheme: config.syntaxTheme,
      sourceName: result.displayName,
    }, config.maxInputBytes).then((nextDocument) => {
      if (!mounted || renderRequest.current !== requestId) return
      const anchor = readingAnchor.current
      const restored = anchor ? restoreReadingAnchor(nextDocument, anchor) : { line: 0 }
      readingAnchor.current = restored.anchor
      scroll.current = clamp(restored.line, 0, Math.max(0, nextDocument.lines.length - viewportHeight.current))
      setScrollOffset(scroll.current)
      lastGood.current = { result, document: nextDocument }
      setDocument(nextDocument)
      callbacks.current.onDocument?.(nextDocument, readingAnchor.current)
    }).catch((error: unknown) => {
      if (!mounted || renderRequest.current !== requestId || error instanceof RenderCancelledError) return
      const message = error instanceof Error ? error.message : String(error)
      setState({ phase: 'error', error: message, result: lastGood.current?.result })
    })
    return () => { mounted = false }
  }, [columns, padding, config.wrap, config.theme, config.syntaxTheme, config.maxInputBytes, state.result, renderer])

  const isError = state.phase === 'error';
  const loadingMessage = state.phase === 'loading' ? state.message : undefined;
  const note = state.phase === 'error' ? state.error : loadingMessage ?? state.result?.warning ?? notice;
  const contentHeight = Math.max(1, bodyHeight - (note ? 1 : 0))

  viewportHeight.current = contentHeight

  const availableLines = document?.lines ?? [];
  const maxScroll = Math.max(0, availableLines.length - contentHeight);

  useEffect(() => {
    scroll.current = Math.min(scroll.current, maxScroll)
    setScrollOffset(scroll.current)
  }, [maxScroll]);

  const moveTo = (offset: number) => {
    scroll.current = clamp(offset, 0, maxScroll)
    readingAnchor.current = document && scroll.current > 0 ? captureReadingAnchor(document, scroll.current) : undefined
    setScrollOffset(scroll.current)
    callbacks.current.onPosition?.(readingAnchor.current)
  }

  useInput((input: string, key: { ctrl?: boolean; downArrow?: boolean; upArrow?: boolean; pageDown?: boolean; pageUp?: boolean }) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
      return;
    }
    if (input === 'h' && onHistory) { onHistory(); return }
    if (input === 'j' || key.downArrow) {
      moveTo(scroll.current + 1)
      return;
    }
    if (input === 'k' || key.upArrow) {
      moveTo(scroll.current - 1)
      return;
    }
    if (input === 'g') {
      moveTo(0)
      return;
    }
    if (input === 'G') {
      moveTo(maxScroll)
      return;
    }
    if (input === ' ' || key.pageDown) {
      moveTo(scroll.current + contentHeight)
      return;
    }
    if (input === 'b' || key.pageUp) {
      moveTo(scroll.current - contentHeight)
      return;
    }
  }, { isActive: active })

  const slice = availableLines.slice(scrollOffset, scrollOffset + contentHeight);
  while (slice.length < contentHeight) {
    slice.push([]);
  }

  const percent = availableLines.length === 0 ? 0 : Math.min(100, Math.round(((scrollOffset + contentHeight) / availableLines.length) * 100));
  const sourceStatus = source.canWatch && config.watch ? 'watching' : 'static';
  const progress = isError && !document ? 'error' : state.phase === 'loading' ? 'loading' : `${percent}%`;
  const parseStatus = document ? `parsed in ${document.parseMs.toFixed(0)}ms` : 'parsing...';
  const title = document?.title ?? source.displayName;

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box borderStyle={framed ? 'round' : undefined} borderColor={theme.border} paddingX={framed ? 1 : padding} columnGap={1} justifyContent="space-between" height={barHeight} flexShrink={0} overflow="hidden">
        <Text color={theme.heading} bold wrap="truncate-end">
          {sanitizeDisplayText(title)}
        </Text>
        <Text color={theme.muted} wrap="truncate-end">
          {sanitizeDisplayText(`${source.displayName} · ${progress} · ${sourceStatus} · ${parseStatus}`)}
        </Text>
      </Box>
      <Box flexDirection="column" height={bodyHeight} flexShrink={0} paddingX={padding} overflow="hidden">
        {note ? (
          <Box height={1} flexShrink={0}>
            <Text color={isError ? theme.error : theme.warning} bold wrap="truncate-end">
              {sanitizeDisplayText(note)}
            </Text>
          </Box>
        ) : null}
        {slice.map((line, index) => (
          <Text key={index} wrap="truncate-end">
            {line.length === 0
              ? ' '
              : line.map((segment, segmentIndex) => (
                  <Text key={segmentIndex} {...segment.style}>
                    {segment.text}
                  </Text>
                ))}
          </Text>
        ))}
      </Box>
      <Box borderStyle={framed ? 'round' : undefined} borderColor={theme.border} paddingX={framed ? 1 : padding} height={barHeight} flexShrink={0} overflow="hidden">
        <Text color={theme.muted} wrap="truncate-end">
          q quit{onHistory ? ' · h history' : ''} · j/k scroll · arrows · g top · G bottom · space page down · b page up
        </Text>
      </Box>
    </Box>
  );
}
