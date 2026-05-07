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
  });

  const schedule = debounce(onChange, refreshIntervalMs);
  watcher.on('add', schedule);
  watcher.on('change', schedule);
  watcher.on('unlink', onUnlink);
  watcher.on('error', onChange);

  return () => {
    void watcher.close();
  };
}

function debounce(fn: () => void, delayMs: number): () => void {
  let timer: NodeJS.Timeout | undefined;
  return () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      fn();
    }, delayMs);
  };
}
