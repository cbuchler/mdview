import { Box, Text, useApp, useInput, useStdout } from 'ink';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AppConfig, LoadResult, ResolvedSource, RenderedDocument } from './types.js';
import { clamp, sanitizeDisplayText } from './utils.js';
import { resolveTheme } from './theme.js';
import { loadSource } from './source.js';
import { renderMarkdownDocument } from './markdown.js';
import { watchMarkdownFile } from './watcher.js';

interface AppProps {
  source: ResolvedSource;
  config: AppConfig;
}

type LoadState =
  | { phase: 'loading'; message?: string; note?: string; result?: LoadResult }
  | { phase: 'ready'; result: LoadResult }
  | { phase: 'error'; error: string; note?: string; result?: LoadResult };

interface RenderedSource {
  result: LoadResult;
  document: RenderedDocument;
}

export function App({ source, config }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const theme = resolveTheme(config.theme);
  const syntaxTheme = resolveTheme(config.syntaxTheme);
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
  const [scrollOffset, setScrollOffset] = useState(0);
  const [state, setState] = useState<LoadState>({ phase: 'loading', message: `Loading ${source.displayName}...` });
  const activeRequest = useRef(0);
  const lastGood = useRef<RenderedSource | undefined>(undefined);
  const fileWatcher = useRef<(() => void) | undefined>(undefined);

  const load = useMemo(
    () => async (reason?: string): Promise<void> => {
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
    [config.maxInputBytes, config.timeoutMs, source],
  );

  useEffect(() => {
    void load();
  }, [load]);

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
        setState({
          phase: 'error',
          error: `${source.displayName} was removed`,
          result: lastGood.current?.result,
        });
      },
    );

    fileWatcher.current = dispose;
    return () => {
      dispose();
      fileWatcher.current = undefined;
    };
  }, [config.refreshIntervalMs, config.watch, load, source]);

  const rendered = useMemo<{ good?: RenderedSource; document?: RenderedDocument; error?: string }>(() => {
    if (!state.result) {
      return {};
    }
    const options = {
      width: columns,
      theme,
      wrap: config.wrap,
      padding,
      syntaxTheme,
      sourceName: state.result.displayName,
    };
    try {
      const document = renderMarkdownDocument(state.result.text, options);
      return { good: { result: state.result, document }, document };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const previous = lastGood.current;
      if (previous && previous.result !== state.result) {
        try {
          // Reflow only validated content, without loading the source again.
          const document = renderMarkdownDocument(previous.result.text, { ...options, sourceName: previous.result.displayName });
          return { document, error: message };
        } catch {
          // A failed reflow must not discard the last successful frame.
        }
      }
      return { document: previous?.document, error: message };
    }
  }, [columns, padding, config.wrap, source.displayName, state.result, syntaxTheme, theme]);

  useEffect(() => {
    if (rendered.good) {
      lastGood.current = rendered.good;
    }
  }, [rendered]);

  const document = rendered.document;
  const renderError = rendered.error;
  const isError = Boolean(renderError) || state.phase === 'error';
  const loadingMessage = state.phase === 'loading' ? state.message : undefined;
  const note = renderError ?? (state.phase === 'error' ? state.error : loadingMessage ?? state.result?.warning);
  const contentHeight = Math.max(1, rows - 2 - (note ? 1 : 0));

  const availableLines = document?.lines ?? [];
  const maxScroll = Math.max(0, availableLines.length - contentHeight);

  useEffect(() => {
    setScrollOffset((offset) => Math.min(offset, maxScroll));
  }, [maxScroll]);

  useInput((input: string, key: { ctrl?: boolean; downArrow?: boolean; upArrow?: boolean; pageDown?: boolean; pageUp?: boolean }) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
      return;
    }
    if (input === 'j' || key.downArrow) {
      setScrollOffset((offset) => clamp(offset + 1, 0, maxScroll));
      return;
    }
    if (input === 'k' || key.upArrow) {
      setScrollOffset((offset) => clamp(offset - 1, 0, maxScroll));
      return;
    }
    if (input === 'g') {
      setScrollOffset(0);
      return;
    }
    if (input === 'G') {
      setScrollOffset(maxScroll);
      return;
    }
    if (input === ' ' || key.pageDown) {
      setScrollOffset((offset) => clamp(offset + contentHeight, 0, maxScroll));
      return;
    }
    if (input === 'b' || key.pageUp) {
      setScrollOffset((offset) => clamp(offset - contentHeight, 0, maxScroll));
      return;
    }
  });

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
      <Box paddingX={padding} columnGap={1} justifyContent="space-between" height={1} flexShrink={0} overflow="hidden">
        <Text color={theme.heading} bold wrap="truncate-end">
          {sanitizeDisplayText(title)}
        </Text>
        <Text color={theme.muted} wrap="truncate-end">
          {sanitizeDisplayText(`${source.displayName} · ${progress} · ${sourceStatus} · ${parseStatus}`)}
        </Text>
      </Box>
      <Box flexDirection="column" height={Math.max(1, rows - 2)} flexShrink={0} paddingX={padding} overflow="hidden">
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
      <Box paddingX={padding} height={1} flexShrink={0} overflow="hidden">
        <Text color={theme.muted} wrap="truncate-end">
          q quit · j/k scroll · arrows · g top · G bottom · space page down · b page up
        </Text>
      </Box>
    </Box>
  );
}
