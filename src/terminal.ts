import { closeSync, constants, openSync } from 'node:fs';
import { ReadStream } from 'node:tty';
import type { ReactNode } from 'react';
import { render } from 'ink';

interface TerminalIO {
  open: () => number;
  createStream: (fd: number) => NodeJS.ReadStream;
  close: (fd: number) => void;
}

const terminalIO: TerminalIO = {
  open: () => openSync('/dev/tty', constants.O_RDONLY | constants.O_NOCTTY),
  createStream: (fd) => new ReadStream(fd),
  close: closeSync,
};

export interface KeyboardInput {
  stream: NodeJS.ReadStream;
  owned: boolean;
  dispose: () => Promise<void>;
}

/** Select keyboard input without reading or changing document stdin. */
export function acquireKeyboardInput(
  stdin: NodeJS.ReadStream = process.stdin,
  platform: NodeJS.Platform = process.platform,
  io: TerminalIO = terminalIO,
  runtime: 'node' | 'bun' = process.versions.bun ? 'bun' : 'node',
): KeyboardInput | undefined {
  let stream = stdin;
  const owned = !stdin.isTTY;
  if (owned) {
    // Bun's independent TTY reader is fs-backed and cannot cancel a pending
    // read on exit. Keep its borrowed process.stdin path, but use plain output
    // when a separate keyboard would be needed.
    if (platform === 'win32' || runtime === 'bun') return undefined;
    let fd: number;
    try {
      fd = io.open();
    } catch {
      // A redirected stdout can be a PTY even without a controlling terminal.
      return undefined;
    }
    try {
      stream = io.createStream(fd);
    } catch {
      io.close(fd);
      return undefined;
    }
    // Node/libuv duplicates the TTY fd. Close our original while its ownership
    // is certain, before fd reuse is possible; the stream keeps its own handle.
    try {
      io.close(fd);
    } catch (error) {
      stream.destroy();
      throw error;
    }
  }

  const wasRaw = Boolean(stream.isRaw);
  let disposal: Promise<void> | undefined;
  return {
    stream,
    owned,
    dispose() {
      disposal ??= (async () => {
        let failure: unknown;
        const captureError = (error: Error) => { failure ??= error; };
        stream.on('error', captureError);
        try {
          try {
            stream.setRawMode(wasRaw);
          } catch (error) {
            failure ??= error;
          }
          if (owned && !stream.closed) {
            try {
              await new Promise<void>((resolve, reject) => {
                const closed = () => resolve();
                stream.once('close', closed);
                try {
                  stream.destroy();
                } catch (error) {
                  stream.off('close', closed);
                  reject(error);
                }
              });
            } catch (error) {
              failure ??= error;
            }
          }
        } finally {
          stream.off('error', captureError);
        }
        if (failure) throw failure;
      })();
      return disposal;
    },
  };
}

/** Observe Ink's exit before mounting code that can fail or immediately exit. */
export async function runTerminalApp(
  node: ReactNode,
  keyboard: KeyboardInput,
  onExit: () => void = () => {},
  renderApp: typeof render = render,
  signal?: AbortSignal,
): Promise<void> {
  let instance: ReturnType<typeof render> | undefined;
  let failed = false;
  let inputError: Error | undefined;
  let onError!: (error: Error) => void;
  const inputFailure = new Promise<never>((_resolve, reject) => {
    onError = (error) => { inputError ??= error; reject(error); };
  });
  // Also observe errors if construction itself throws before the exit race exists.
  void inputFailure.catch(() => {});
  keyboard.stream.on('error', onError);
  const onAbort = () => onError(new Error('Terminal session interrupted'))
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) onAbort()
  try {
    instance = renderApp(null, { stdin: keyboard.stream, exitOnCtrlC: false });
    const completion = Promise.race([instance.waitUntilExit(), inputFailure]);
    // rerender may throw synchronously instead of rejecting Ink's exit promise.
    void completion.catch(() => {});
    instance.rerender(node);
    await completion;
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    let cleanupError: unknown;
    for (const cleanup of [
      () => instance?.unmount(),
      () => instance?.cleanup(),
      onExit,
      keyboard.dispose,
    ]) {
      try {
        await cleanup();
      } catch (error) {
        cleanupError ??= error;
      }
    }
    keyboard.stream.off('error', onError);
    signal?.removeEventListener('abort', onAbort)
    if (!failed && (cleanupError ?? inputError)) throw cleanupError ?? inputError;
  }
}
