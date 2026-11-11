import { spawnSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform === 'darwin') {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  const output = path.join(root, 'dist/native')
  await mkdir(output, { recursive: true })
  for (const [source, name, flags] of [
    ['macos-memory.c', 'mdview-memory', []],
    ['macos-memory-guard.c', 'mdview-memory-guard.dylib', ['-dynamiclib']],
  ]) {
    const result = spawnSync('cc', ['-O2', '-Wall', '-Wextra', ...flags, path.join(root, 'native', source), '-o', path.join(output, name)], { stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
}
