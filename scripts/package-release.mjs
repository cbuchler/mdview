import { spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
const source = await readFile(path.join(root, 'src/version.ts'), 'utf8')
const tag = process.env.MDVIEW_RELEASE_TAG ?? `v${pkg.version}`
if (tag !== `v${pkg.version}` || lock.version !== pkg.version || lock.packages[''].version !== pkg.version ||
    !source.includes(`export const VERSION = '${pkg.version}'`)) throw new Error('Release versions do not match')
if (!['linux', 'darwin'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch)) throw new Error('Unsupported release platform')
const name = `mdview-${tag}-${process.platform}-${process.arch}`
const output = path.join(root, 'release')
const staged = path.join(output, name)
await rm(staged, { recursive: true, force: true })
await mkdir(staged, { recursive: true })
try {
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'completions']) {
    await cp(path.join(root, file), path.join(staged, file), { recursive: true })
  }
  await cp(path.join(output, 'mdview'), path.join(staged, 'mdview'))
  const archive = `${name}.tar.gz`
  const result = spawnSync('tar', ['-czf', path.join(output, archive), '-C', output, name], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Archive creation failed')
  const hash = createHash('sha256').update(await readFile(path.join(output, archive))).digest('hex')
  await writeFile(path.join(output, `${archive}.sha256`), `${hash}  ${archive}\n`)
  console.log(path.join(output, archive))
} finally {
  await rm(staged, { recursive: true, force: true })
}
