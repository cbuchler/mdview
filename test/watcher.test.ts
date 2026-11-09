import chokidar, { FSWatcher } from 'chokidar'
import { afterEach, expect, it, vi } from 'vitest'
import { watchMarkdownFile } from '../src/watcher.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('coalesces reloads and cancels pending work when disposed', () => {
  vi.useFakeTimers()
  const watcher = new FSWatcher()
  vi.spyOn(chokidar, 'watch').mockReturnValue(watcher)
  vi.spyOn(watcher, 'close').mockResolvedValue()
  const reload = vi.fn()
  const removed = vi.fn()
  const dispose = watchMarkdownFile('README.md', 100, reload, removed)

  watcher.emit('change', 'README.md')
  watcher.emit('add', 'README.md')
  vi.advanceTimersByTime(100)
  expect(reload).toHaveBeenCalledOnce()

  reload.mockClear()
  watcher.emit('change', 'README.md')
  dispose()
  vi.advanceTimersByTime(100)
  expect(reload).not.toHaveBeenCalled()

  watcher.emit('change', 'README.md')
  watcher.emit('unlink', 'README.md')
  watcher.emit('error', new Error('late watcher error'))
  vi.advanceTimersByTime(100)
  expect(reload).not.toHaveBeenCalled()
  expect(removed).not.toHaveBeenCalled()
})
