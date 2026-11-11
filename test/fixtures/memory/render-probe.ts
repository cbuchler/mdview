import { readFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { RenderSupervisor } from '../../../src/render-supervisor.js'

const options = { width: 80, padding: 1, wrap: true, theme: 'github', syntaxTheme: 'dracula', sourceName: 'probe' }
const documents = [await readFile('README.md', 'utf8'), '# Unicode\n\nCafé 日本語 👩‍💻\n\n| A | B |\n|---|---|\n| One | Two |']
const commands = [
  [process.execPath, path.resolve('dist/main.js'), '--internal-render-worker'],
  [process.env.MDVIEW_BUN!, path.resolve('src/main.ts'), '--internal-render-worker'],
  [path.resolve('release/mdview'), '--internal-render-worker'],
]
for (const command of commands) {
  const baseline = new RenderSupervisor({ sandbox: false, command })
  const limited = new RenderSupervisor({ sandbox: false, command: ['/tmp/mdview-memory-probe', 'spawn', 'command', ...command] })
  try {
    for (const input of documents) {
      const expected = await baseline.render(input, options, 2 * 1024 * 1024)
      const actual = await limited.render(input, options, 2 * 1024 * 1024)
      assert.deepEqual({ ...actual, parseMs: 0 }, { ...expected, parseMs: 0 })
    }
    console.log(JSON.stringify({ command, rendered: true, outputMatches: true }))
  } finally {
    await baseline.dispose()
    await limited.dispose()
  }
}
