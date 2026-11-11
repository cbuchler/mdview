import { spawnSync } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-build-'))
try {
  let prelude = ''
  if (process.platform === 'linux') {
    const helper = path.join(root, 'node_modules/@anthropic-ai/sandbox-runtime/vendor/seccomp', process.arch, 'apply-seccomp')
    prelude = `globalThis.mdviewSeccomp = ${JSON.stringify((await readFile(helper)).toString('base64'))}\n`
  }
  const entry = path.join(directory, 'entry.mjs')
  await writeFile(entry, prelude + `await import(${JSON.stringify(path.join(root, 'src/main.ts'))})\n`)
  const result = spawnSync('bun', ['build', entry, '--compile', '--no-compile-autoload-dotenv', '--no-compile-autoload-bunfig',
    '--no-compile-autoload-tsconfig', '--no-compile-autoload-package-json', '--outfile', path.join(root, 'release/mdview')], { stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
  if (result.status === 0) await copyFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(root, 'release/THIRD_PARTY_NOTICES.md'))
} finally {
  await rm(directory, { recursive: true, force: true })
}
