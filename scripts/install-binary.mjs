import { copyFile, lstat, mkdir, mkdtemp, realpath, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const source = path.resolve('release', 'mdview')
const targetDir = process.env.MDVIEW_INSTALL_DIR || path.join(os.homedir(), '.local', 'bin')

async function main() {
  if (!(await stat(source)).isFile()) throw new Error('Build output is not a regular file')
  await mkdir(targetDir, { recursive: true })
  const directory = await realpath(targetDir)
  if (directory.split(path.sep).some((part) => ['Cellar', 'Caskroom', 'Homebrew'].includes(part))) {
    throw new Error('Use Homebrew to update this installation')
  }
  const target = path.join(directory, 'mdview')
  const existing = await lstat(target).catch((error) => {
    if (error.code !== 'ENOENT') throw error
  })
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('Use the package manager for this install target')
  const staged = await mkdtemp(path.join(directory, '.mdview-'))
  try {
    await copyFile(source, path.join(staged, 'mdview'))
    await rename(path.join(staged, 'mdview'), target)
  } finally {
    await rm(staged, { recursive: true, force: true })
  }
  process.stdout.write(`Installed mdview to ${target}\n`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Install failed: ${message}\n`)
  process.exitCode = 1
})
