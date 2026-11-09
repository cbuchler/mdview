import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { render } from 'ink';
import { acquireKeyboardInput, runTerminalApp } from '../src/terminal.js';

function input(isTTY: boolean, isRaw = false) {
  const stream = Object.assign(new PassThrough(), {
    isTTY, isRaw,
    setRawMode: vi.fn((raw: boolean) => { stream.isRaw = raw; return stream; }),
  });
  return stream as unknown as NodeJS.ReadStream;
}

describe('keyboard ownership', () => {
  it('borrows terminal stdin, restores its original raw state, and never closes it', async () => {
    const stdin = input(true, true);
    const destroy = vi.spyOn(stdin, 'destroy');
    const io = { open: vi.fn(), createStream: vi.fn(), close: vi.fn() };
    const keyboard = acquireKeyboardInput(stdin, 'linux', io)!;
    expect(keyboard.owned).toBe(false);
    stdin.setRawMode(false); // Ink restores canonical mode when unmounting.
    await keyboard.dispose();
    await keyboard.dispose();
    expect(stdin.isRaw).toBe(true);
    expect(stdin.setRawMode).toHaveBeenCalledTimes(2);
    expect(destroy).not.toHaveBeenCalled();
    expect(io.open).not.toHaveBeenCalled();
  });

  it('creates an independent owned keyboard without touching document input', async () => {
    const stdin = input(false);
    const read = vi.spyOn(stdin, 'read');
    const encoding = vi.spyOn(stdin, 'setEncoding');
    const keyboardStream = input(true);
    const destroy = vi.spyOn(keyboardStream, 'destroy');
    const io = { open: vi.fn(() => 42), createStream: vi.fn(() => keyboardStream), close: vi.fn() };
    const keyboard = acquireKeyboardInput(stdin, 'linux', io)!;
    expect(keyboard.stream).toBe(keyboardStream);
    expect(keyboard.owned).toBe(true);
    expect(io.createStream).toHaveBeenCalledWith(42);
    expect(read).not.toHaveBeenCalled();
    expect(encoding).not.toHaveBeenCalled();
    expect(stdin.listenerCount('data')).toBe(0);
    keyboardStream.setRawMode(true);
    const disposal = keyboard.dispose();
    expect(keyboard.dispose()).toBe(disposal);
    await disposal;
    expect(keyboardStream.isRaw).toBe(false);
    expect(destroy).toHaveBeenCalledTimes(1);
    // Node duplicates the fd, so the original closes immediately, exactly once.
    expect(io.close).toHaveBeenCalledExactlyOnceWith(42);
  });

  it('closes the raw fd exactly once when constructing its TTY stream fails', () => {
    const io = {
      open: vi.fn(() => 42),
      createStream: vi.fn(() => { throw new Error('TTY construction failed'); }),
      close: vi.fn(),
    };
    expect(acquireKeyboardInput(input(false), 'linux', io)).toBeUndefined();
    expect(io.close).toHaveBeenCalledExactlyOnceWith(42);
  });

  it('falls back without consuming stdin if /dev/tty is unavailable or platform is unsupported', () => {
    const stdin = input(false);
    const read = vi.spyOn(stdin, 'read');
    const io = {
      open: vi.fn(() => { throw new Error('No controlling terminal'); }),
      createStream: vi.fn(), close: vi.fn(),
    };
    expect(acquireKeyboardInput(stdin, 'linux', io)).toBeUndefined();
    expect(acquireKeyboardInput(stdin, 'win32', io)).toBeUndefined();
    expect(acquireKeyboardInput(stdin, 'linux', io, 'bun')).toBeUndefined();
    expect(io.open).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    expect(stdin.listenerCount('data')).toBe(0);
  });

  it('keeps borrowed terminal stdin interactive under Bun', async () => {
    const stdin = input(true);
    const io = { open: vi.fn(), createStream: vi.fn(), close: vi.fn() };
    const keyboard = acquireKeyboardInput(stdin, 'linux', io, 'bun')!;
    expect(keyboard.stream).toBe(stdin);
    expect(keyboard.owned).toBe(false);
    expect(io.open).not.toHaveBeenCalled();
    await keyboard.dispose();
  });
});

describe('Ink lifetime', () => {
  function session(action: 'exit' | 'startup-error' | 'runtime-error' | 'rerender-throw' | 'input-error') {
    const stream = input(true, true);
    const keyboard = acquireKeyboardInput(stream)!;
    let resolveExit!: () => void;
    let rejectExit!: (error: Error) => void;
    const failure = new Error(`${action} failure`);
    const instance = {
      waitUntilExit: vi.fn(() => new Promise<void>((resolve, reject) => { resolveExit = resolve; rejectExit = reject; })),
      rerender: vi.fn(() => {
        expect(instance.waitUntilExit).toHaveBeenCalledTimes(1);
        stream.setRawMode(false);
        if (action === 'rerender-throw') throw failure;
        if (action === 'startup-error') rejectExit(failure);
        if (action === 'runtime-error') queueMicrotask(() => rejectExit(failure));
        if (action === 'input-error') queueMicrotask(() => stream.emit('error', failure));
        if (action === 'exit') resolveExit();
      }),
      unmount: vi.fn(() => resolveExit()), cleanup: vi.fn(), clear: vi.fn(),
    };
    const renderApp = vi.fn((node, options) => {
      expect(node).toBeNull();
      expect(options.stdin).toBe(stream);
      return instance;
    }) as unknown as typeof render;
    const onExit = vi.fn();
    return { keyboard, stream, failure, instance, onExit, renderApp };
  }

  it('registers the exit observer before the real mount, cleans up, and preserves borrowed stdin', async () => {
    const test = session('exit');
    const destroy = vi.spyOn(test.stream, 'destroy');
    await runTerminalApp('app', test.keyboard, test.onExit, test.renderApp);
    expect(test.instance.unmount).toHaveBeenCalledTimes(1);
    expect(test.instance.cleanup).toHaveBeenCalledTimes(1);
    expect(test.onExit).toHaveBeenCalledTimes(1);
    expect(test.stream.isRaw).toBe(true);
    expect(destroy).not.toHaveBeenCalled();
    expect(test.stream.listenerCount('error')).toBe(0);
  });

  it.each(['startup-error', 'runtime-error', 'rerender-throw', 'input-error'] as const)('propagates %s and restores raw mode', async (action) => {
    const test = session(action);
    await expect(runTerminalApp('app', test.keyboard, test.onExit, test.renderApp)).rejects.toBe(test.failure);
    expect(test.stream.isRaw).toBe(true);
    expect(test.instance.unmount).toHaveBeenCalledTimes(1);
    expect(test.onExit).toHaveBeenCalledTimes(1);
    expect(test.stream.listenerCount('error')).toBe(0);
  });

  it('cleans up after render construction throws and preserves the primary error over cleanup failure', async () => {
    const stream = input(true);
    const keyboard = acquireKeyboardInput(stream)!;
    const failure = new Error('Initial render constructor failed');
    const renderApp = (() => { throw failure; }) as typeof render;
    await expect(runTerminalApp(null, keyboard, () => { throw new Error('Cleanup failed'); }, renderApp)).rejects.toBe(failure);
    expect(stream.isRaw).toBe(false);
    expect(stream.listenerCount('error')).toBe(0);
  });

  it('reports cleanup failures on an otherwise successful exit', async () => {
    const test = session('exit');
    await expect(runTerminalApp('app', test.keyboard, () => { throw new Error('Cleanup failed'); }, test.renderApp)).rejects.toThrow('Cleanup failed');
    expect(test.stream.isRaw).toBe(true);
    expect(test.stream.listenerCount('error')).toBe(0);
  });

  it('closes owned keyboard input once and removes its scoped error listener after close', async () => {
    const stream = input(true);
    const destroy = vi.spyOn(stream, 'destroy');
    const keyboard = acquireKeyboardInput(input(false), 'linux', {
      open: () => 42, createStream: () => stream, close: vi.fn(),
    })!;
    const instance = { waitUntilExit: () => Promise.resolve(), rerender() {}, unmount() {}, cleanup() {}, clear() {} };
    await runTerminalApp(null, keyboard, undefined, (() => instance) as unknown as typeof render);
    await keyboard.dispose();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(stream.listenerCount('error')).toBe(0);
  });

  it('propagates an error emitted by raw-mode restoration after a successful Ink exit', async () => {
    const stream = input(true);
    const keyboard = acquireKeyboardInput(stream)!;
    const failure = new Error('Raw restoration failed');
    vi.mocked(stream.setRawMode).mockImplementation(() => {
      stream.emit('error', failure);
      return stream;
    });
    const instance = { waitUntilExit: () => Promise.resolve(), rerender() {}, unmount() {}, cleanup() {}, clear() {} };
    await expect(runTerminalApp(null, keyboard, undefined, (() => instance) as unknown as typeof render)).rejects.toBe(failure);
    expect(stream.listenerCount('error')).toBe(0);
  });

  it('observes asynchronous owned-stream close errors and still closes exactly once', async () => {
    const stream = input(true);
    const failure = new Error('TTY close failed');
    stream._destroy = (_error, callback) => { queueMicrotask(() => callback(failure)); };
    const destroy = vi.spyOn(stream, 'destroy');
    const io = { open: () => 42, createStream: () => stream, close: vi.fn() };
    const keyboard = acquireKeyboardInput(input(false), 'linux', io)!;
    const instance = { waitUntilExit: () => Promise.resolve(), rerender() {}, unmount() {}, cleanup() {}, clear() {} };
    await expect(runTerminalApp(null, keyboard, undefined, (() => instance) as unknown as typeof render)).rejects.toBe(failure);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(io.close).toHaveBeenCalledExactlyOnceWith(42);
    expect(stream.listenerCount('error')).toBe(0);
  });

  it('preserves a primary Ink failure when restoring raw mode also emits an error', async () => {
    const stream = input(true);
    const keyboard = acquireKeyboardInput(stream)!;
    const primary = new Error('Primary Ink failure');
    vi.mocked(stream.setRawMode).mockImplementation(() => {
      stream.emit('error', new Error('Cleanup input failure'));
      return stream;
    });
    const instance = { waitUntilExit: () => Promise.reject(primary), rerender() {}, unmount() {}, cleanup() {}, clear() {} };
    await expect(runTerminalApp(null, keyboard, undefined, (() => instance) as unknown as typeof render)).rejects.toBe(primary);
    expect(stream.listenerCount('error')).toBe(0);
  });
});
