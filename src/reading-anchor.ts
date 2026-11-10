import type { ReadingAnchor, RenderedDocument, SourceLocation } from './types.js'

function anchorAt(document: RenderedDocument, location: SourceLocation): ReadingAnchor {
  return {
    version: 1,
    block: document.blocks[location.block],
    offset: location.offset,
    before: document.blocks[location.block - 1]?.fingerprint,
    after: document.blocks[location.block + 1]?.fingerprint,
  }
}

export function captureReadingAnchor(document: RenderedDocument, line: number): ReadingAnchor | undefined {
  const locations = document.lineSources
  for (let index = line; index < locations.length; index++) {
    const location = locations[index]
    if (location) return anchorAt(document, location)
  }
  for (let index = Math.min(line - 1, locations.length - 1); index >= 0; index--) {
    const location = locations[index]
    if (location) return anchorAt(document, location)
  }
  return undefined
}

export function restoreReadingAnchor(document: RenderedDocument, anchor: ReadingAnchor): { line: number; anchor?: ReadingAnchor } {
  const { blocks, lineSources } = document
  const visible = new Set(lineSources.flatMap((location) => location ? [location.block] : []))
  const sameHeading = (index: number) => blocks[index].headingPath.join('/') === anchor.block.headingPath.join('/')
  const contextScore = (index: number) =>
    Number(sameHeading(index)) * 4 +
    Number(anchor.before !== undefined && blocks[index - 1]?.fingerprint === anchor.before) * 2 +
    Number(anchor.after !== undefined && blocks[index + 1]?.fingerprint === anchor.after) * 2
  const best = (matches: (index: number) => boolean) => {
    let selected: number | undefined
    for (const index of visible) {
      if (!matches(index)) continue
      if (selected === undefined || contextScore(index) > contextScore(selected) ||
          (contextScore(index) === contextScore(selected) && Math.abs(blocks[index].start - anchor.block.start) < Math.abs(blocks[selected].start - anchor.block.start))) {
        selected = index
      }
    }
    return selected
  }
  let block = best((index) => blocks[index].fingerprint === anchor.block.fingerprint)
  let offset = anchor.offset
  if (block === undefined && anchor.before && anchor.after) {
    block = best((index) => blocks[index].kind === anchor.block.kind && sameHeading(index) &&
      blocks[index - 1]?.fingerprint === anchor.before && blocks[index + 1]?.fingerprint === anchor.after)
  }
  if (block === undefined) {
    block = best((index) => blocks[index].fingerprint === anchor.after)
    offset = 0
    if (block === undefined) {
      block = best((index) => blocks[index].fingerprint === anchor.before)
      if (block !== undefined) offset = blocks[block].end - blocks[block].start
    }
    if (block === undefined) {
      for (const index of visible) {
        if (block === undefined || Math.abs(blocks[index].start - anchor.block.start) < Math.abs(blocks[block].start - anchor.block.start)) block = index
      }
    }
  }
  if (block === undefined) return { line: 0 }
  offset = Math.min(offset, blocks[block].end - blocks[block].start)
  let line = 0
  let distance = Infinity
  // Prefer the line that starts before the point. Table cell order can run backwards.
  for (let index = 0; index < lineSources.length; index++) {
    const location = lineSources[index]
    if (location?.block !== block) continue
    const delta = offset - location.offset
    const nextDistance = delta >= 0 ? delta : -delta + blocks[block].end - blocks[block].start + 1
    if (nextDistance < distance) {
      line = index
      distance = nextDistance
    }
  }
  // Retain the logical point, not the new line start, to avoid drift on repeated resize.
  return { line, anchor: anchorAt(document, { block, offset }) }
}
