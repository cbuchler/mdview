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

export function App({ source, config }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const stdout = useStdout();
  const theme = resolveTheme(config.theme);
  const syntaxTheme = resolveTheme(config.syntaxTheme);
  const columns = Math.max(20, stdout.stdout.columns || 80);
  const rows = Math.max(10, stdout.stdout.rows || 24);
  const contentHeight = Math.max(1, rows - 2);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [state, setState] = useState<LoadState>({ phase: 'loading', message: `Loading ${source.displayName}...` });
  const activeRequest = useRef(0);
  const lastGood = useRef<LoadResult | undefined>(undefined);
  const fileWatcher = useRef<(() => void) | undefined>(undefined);

  const load = useMemo(
    () => async (reason?: string): Promise<void> => {
      const requestId = activeRequest.current + 1;
      activeRequest.current = requestId;
      setState((current) => ({
        phase: current.phase === 'ready' ? 'loading' : 'loading',
        message: reason ?? `Loading ${source.displayName}...`,
        result: current.result ?? lastGood.current,
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
        lastGood.current = result;
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
            result: lastGood.current,
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
        setState((current) => ({
          phase: 'error',
          error: `${source.displayName} was removed`,
          result: current.result ?? lastGood.current,
        }));
      },
    );

    fileWatcher.current = dispose;
    setState((current) => ({
      phase: current.phase === 'error' ? 'error' : 'loading',
      message: source.canWatch ? 'Watching for changes...' : current.phase === 'loading' ? current.message : undefined,
      result: current.result,
    }) as LoadState);
    return () => {
      dispose();
      fileWatcher.current = undefined;
    };
  }, [config.refreshIntervalMs, config.watch, load, source]);

  const document = useMemo<RenderedDocument | undefined>(() => {
    if (!state.result) {
      return undefined;
    }
    return renderMarkdownDocument(state.result.text, {
      width: columns,
      theme,
      wrap: config.wrap,
      padding: config.padding,
      syntaxTheme,
      sourceName: state.result.displayName,
    });
  }, [columns, config.padding, config.wrap, source.displayName, state.result, syntaxTheme, theme]);

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
  const progress = state.phase === 'error' && !state.result ? 'error' : state.phase === 'loading' ? 'loading' : `${percent}%`;
  const parseStatus = document ? `parsed in ${document.parseMs.toFixed(0)}ms` : 'parsing...';
  const loadingMessage = state.phase === 'loading' ? state.message : undefined;
  const note = state.phase === 'error' ? state.error : loadingMessage ?? state.result?.warning;
  const title = document?.title ?? source.displayName;

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box paddingX={config.padding} justifyContent="space-between">
        <Text color={theme.heading} bold>
          {sanitizeDisplayText(title)}
        </Text>
        <Text color={theme.muted}>
          {sanitizeDisplayText(`${source.displayName} · ${progress} · ${sourceStatus} · ${parseStatus}`)}
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} paddingX={config.padding}>
        {note ? (
          <Box marginBottom={1}>
            <Text color={state.phase === 'error' ? theme.error : theme.warning} bold>
              {sanitizeDisplayText(note)}
            </Text>
          </Box>
        ) : null}
        {slice.map((line, index) => (
          <Text key={index}>
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
      <Box paddingX={config.padding}>
        <Text color={theme.muted}>
          q quit · j/k scroll · arrows · g top · G bottom · space page down · b page up
        </Text>
      </Box>
    </Box>
  );
}
