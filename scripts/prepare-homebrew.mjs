import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const [revision, checksum, destination = path.join(root, 'release/homebrew-tap')] = process.argv.slice(2)
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
if (!revision || !(revision === `v${version}` || /^[a-f0-9]{40}$/.test(revision))) {
  throw new Error('Use the matching release tag or an immutable CI commit')
}
if (!/^[a-f0-9]{64}$/.test(checksum ?? '')) throw new Error('Supply the source archive SHA-256 checksum')
const template = await readFile(path.join(root, 'packaging/homebrew/mdview.rb.in'), 'utf8')
await mkdir(path.join(destination, 'Formula'), { recursive: true })
await writeFile(path.join(destination, 'Formula/mdview.rb'), template
  .replace('  version "@VERSION@"\n', revision === `v${version}` ? '' : `  version "${version}"\n`)
  .replaceAll('@REF@', revision).replaceAll('@VERSION@', version).replaceAll('@SHA256@', checksum))
console.log(path.join(destination, 'Formula/mdview.rb'))
