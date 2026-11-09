import chokidar from 'chokidar';
import path from 'node:path';

export function watchMarkdownFile(
  filePath: string,
  refreshIntervalMs: number,
  onChange: () => void,
  onUnlink: () => void,
): () => void {
  const watcher = chokidar.watch(filePath, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: Math.max(100, refreshIntervalMs),
      pollInterval: Math.max(25, Math.floor(refreshIntervalMs / 2)),
    },
    ignored: (candidate) => /(^|[\\/])(\.|#.*#|.*~|.*\.swp)$/.test(path.basename(candidate)),
  })

  let disposed = false
  let timer: NodeJS.Timeout | undefined
  const schedule = () => {
    if (disposed) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      onChange()
    }, refreshIntervalMs)
  }
  watcher.on('add', schedule)
  watcher.on('change', schedule)
  watcher.on('unlink', () => { if (!disposed) onUnlink() })
  watcher.on('error', () => { if (!disposed) onChange() })

  return () => {
    disposed = true
    clearTimeout(timer)
    void watcher.close()
  }
}
