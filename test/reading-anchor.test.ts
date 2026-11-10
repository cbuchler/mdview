import { expect, it } from 'vitest'
import { renderMarkdownDocument } from '../src/markdown.js'
import { captureReadingAnchor, restoreReadingAnchor } from '../src/reading-anchor.js'
import { resolveTheme } from '../src/theme.js'
import type { RenderedDocument } from '../src/types.js'

const render = (markdown: string, width = 40) => renderMarkdownDocument(markdown, {
  width, padding: 0, wrap: true, theme: resolveTheme('github'), syntaxTheme: resolveTheme('github'), sourceName: 'anchor.md',
})
const textAt = (document: RenderedDocument, line: number) => document.lines[line].map(({ text }) => text).join('')
const lineOf = (document: RenderedDocument, text: string) => document.lines.findIndex((_, index) => textAt(document, index).includes(text))
const words = Array.from({ length: 80 }, (_, index) => `word${index}`).join(' ')

it.each([
  ['Unicode prose', `界 👩‍💻 é **intro** ${words}`],
  ['nested code', `> \`\`\`text\n> first line\n> ${words}\n> \`\`\``],
  ['table grid and stacked cells', `| Key | Value |\n|---|---|\n| first | before |\n| second | ${words} |\n| third | after |`],
])('retains a logical point within %s through repeated layout changes', (_name, markdown) => {
  const original = render(markdown, 26)
  const line = lineOf(original, 'word40')
  expect(line).toBeGreaterThan(0)
  let anchor = captureReadingAnchor(original, line)!
  const firstWord = textAt(original, line).match(/word\d+/)![0]
  for (const width of [90, 12, 55, 26]) {
    const next = render(markdown, width)
    const restored = restoreReadingAnchor(next, anchor)
    expect(textAt(next, restored.line)).toContain(firstWord)
    anchor = restored.anchor!
  }
  const back = restoreReadingAnchor(original, anchor)
  expect(back.line).toBe(line)
})

it('uses neighbors to distinguish identical passages under duplicate headings after insertions and removals', () => {
  const section = (label: string) => `## Same\n\nBefore ${label}\n\nRepeated passage\n\nAfter ${label}`
  const markdown = section('A') + '\n\n' + section('B')
  const original = render(markdown)
  const target = original.lines.map((_, index) => textAt(original, index)).lastIndexOf('Repeated passage')
  let anchor = captureReadingAnchor(original, target)!
  for (const source of ['Inserted '.repeat(80) + '\n\n' + markdown, section('B')]) {
    const next = render(source)
    const restored = restoreReadingAnchor(next, anchor)
    expect(textAt(next, restored.line)).toBe('Repeated passage')
    expect(textAt(next, restored.line + 2)).toBe('After B')
    anchor = restored.anchor!
  }
})

it('falls forward when the current passage is deleted, then backward, and handles an empty document', () => {
  const original = render('Before\n\nCurrent passage\n\nAfter')
  const anchor = captureReadingAnchor(original, lineOf(original, 'Current'))!
  const edited = render('Before\n\nCurrent passage edited\n\nAfter')
  expect(textAt(edited, restoreReadingAnchor(edited, anchor).line)).toBe('Current passage edited')
  const next = render('Before\n\nAfter')
  expect(textAt(next, restoreReadingAnchor(next, anchor).line)).toBe('After')
  const previous = render('Before')
  expect(textAt(previous, restoreReadingAnchor(previous, anchor).line)).toBe('Before')
  expect(restoreReadingAnchor(render(''), anchor)).toEqual({ line: 0 })
})
