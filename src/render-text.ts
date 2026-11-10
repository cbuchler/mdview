import type { RenderedDocument } from './types.js'

export function renderDocumentAsPlainText(document: RenderedDocument): string {
  return document.lines
    .map((line) => line.map((segment) => segment.text).join(''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}
