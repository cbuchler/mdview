import { createHash } from 'node:crypto'
import { unified } from 'unified';
import type { Nodes, Root, Table } from 'mdast'
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { stripControlChars, graphemes, repeatSpace, splitWords, widthOf } from './utils.js';
import type { RenderLine, RenderedDocument, RenderSegment, RenderSegmentStyle, SourceBlock } from './types.js'
import type { Theme } from './theme.js';
import { markdownDepthError, validateMarkdownDepth } from './markdown-depth.js';

// Keep layout provenance out of styled segments sent to the terminal.
const sourceOffsets = new WeakMap<RenderSegment, number>()

const inlineParser = unified().use(remarkParse).use(remarkGfm);
// Resize changes layout, not source. Retain only the latest validated tree.
let lastParsed: {
  markdown: string
  tree: Root
  blocks: SourceBlock[]
} | undefined

export function renderMarkdownDocument(
  markdown: string,
  options: {
    width: number
    theme: Theme
    wrap: boolean
    padding: number
    syntaxTheme: Theme
    sourceName: string
  },
): RenderedDocument {
  const started = performance.now()
  let tree: Root
  if (lastParsed?.markdown === markdown) {
    tree = lastParsed.tree
  } else {
    try {
      tree = inlineParser.parse(markdown)
    } catch (error) {
      // A parser stack overflow happens before there is an AST to validate.
      if (error instanceof RangeError && /maximum call stack|too much recursion/i.test(error.message)) {
        throw markdownDepthError()
      }
      throw error
    }
    validateMarkdownDepth(tree)
    const headingPath: string[] = []
    const blocks = tree.children.map((node) => {
      const start = node.position?.start.offset ?? 0
      const end = node.position?.end.offset ?? start
      const fingerprint = createHash('sha256').update(markdown.slice(start, end)).digest('hex')
      if (node.type === 'heading') {
        headingPath.length = node.depth - 1
        headingPath[node.depth - 1] = fingerprint
      }
      return { start, end, kind: node.type, fingerprint, headingPath: headingPath.filter(Boolean) }
    })
    lastParsed = { markdown, tree, blocks }
  }
  const title = inferTitle(tree, options.sourceName)
  const body = renderBlocks(tree.children ?? [], {
    width: Math.max(1, options.width - options.padding * 2),
    theme: options.theme,
    wrap: options.wrap,
    padding: options.padding,
    syntaxTheme: options.syntaxTheme,
    listDepth: 0,
    markdown,
  })

  const lines = body.length === 0 ? [[segment('No markdown content found.', { color: options.theme.muted })]] : body
  const blocks = lastParsed.blocks
  const lineSources = lines.map((line) => {
    const offset = line.map((part) => sourceOffsets.get(part)).find((value) => value !== undefined)
    if (offset === undefined) return undefined
    let low = 0
    let high = blocks.length
    while (low < high) {
      const mid = Math.floor((low + high) / 2)
      if (blocks[mid].start <= offset) low = mid + 1
      else high = mid
    }
    const block = low - 1
    if (block < 0 || offset > blocks[block].end) return undefined
    return { block, offset: offset - blocks[block].start }
  })
  return {
    title,
    blocks,
    lineSources,
    lines,
    parseMs: performance.now() - started,
    lineCount: lines.length,
  }
}

export { renderDocumentAsPlainText } from './render-text.js'

function renderBlocks(
  nodes: Nodes[],
  context: {
    width: number
    theme: Theme
    wrap: boolean
    padding: number
    syntaxTheme: Theme
    listDepth: number
    markdown: string
  },
): RenderLine[] {
  const lines: RenderLine[] = []

  for (const node of nodes) {
    switch (node.type) {
      case 'heading': {
        const headingStyle: RenderSegmentStyle = {
          color: context.theme.heading,
          bold: true,
        }
        const prefix = `${'#'.repeat(node.depth)} `
        lines.push(...wrapSegments([segment(prefix, headingStyle), ...renderInline(node.children ?? [], headingStyle, context.theme)], context.width, context.wrap))
        lines.push([])
        break
      }
      case 'paragraph': {
        lines.push(...wrapSegments(renderInline(node.children ?? [], undefined, context.theme), context.width, context.wrap))
        lines.push([])
        break
      }
      case 'blockquote': {
        const nested = renderBlocks(node.children ?? [], {
          ...context,
          width: Math.max(1, context.width - 2),
        })
        for (const line of nested) {
          lines.push(prefixLine(line, [segment('│ ', { color: context.theme.quote, dimColor: true })]))
        }
        lines.push([])
        break
      }
      case 'list': {
        const ordered = Boolean(node.ordered)
        const start = node.start ?? 1
        node.children.forEach((item, index) => {
          const bullet = item.checked === true ? '[x] ' : item.checked === false ? '[ ] ' : ordered ? `${start + index}. ` : '• '
          const bulletStyle: RenderSegmentStyle = { color: context.theme.accent, bold: true }
          const continuation = repeatSpace(widthOf(bullet))
          const itemLines = renderBlocks(item.children ?? [], {
            ...context,
            width: Math.max(1, context.width - widthOf(bullet)),
            listDepth: context.listDepth + 1,
          })
          if (itemLines.length === 0) {
            lines.push([segment(bullet, bulletStyle)])
            return
          }
          lines.push(prefixLine(itemLines[0], [segment(bullet, bulletStyle)]))
          for (let i = 1; i < itemLines.length; i += 1) {
            lines.push(prefixLine(itemLines[i], [segment(continuation, { color: context.theme.muted })]))
          }
        })
        lines.push([])
        break
      }
      case 'code': {
        const lang = typeof node.lang === 'string' ? node.lang : ''
        const fenceColor = context.syntaxTheme.border
        const baseCodeStyle: RenderSegmentStyle = {
          color: context.syntaxTheme.codeForeground,
          backgroundColor: context.syntaxTheme.codeBackground,
        }
        const headerWidth = Math.max(0, context.width - 1)
        let headerLabel = ''
        for (const part of graphemes(lang ? ` ${lang} ` : ' code ')) {
          if (widthOf(headerLabel + part) > headerWidth) break
          headerLabel += part
        }
        lines.push([segment(`┌${headerLabel}${'─'.repeat(headerWidth - widthOf(headerLabel))}`, { color: fenceColor, bold: true })])
        const rawLines = String(node.value ?? '').split('\n')
        let cursor = node.position?.start.offset ?? 0
        if (/^(?:`{3,}|~{3,})/.test(context.markdown.slice(cursor))) {
          cursor = context.markdown.indexOf('\n', cursor) + 1
        }
        for (const rawLine of rawLines) {
          const highlighted = highlightCodeLine(stripControlChars(rawLine), lang, context.syntaxTheme, baseCodeStyle)
          const newline = context.markdown.indexOf('\n', cursor)
          const end = newline < 0 ? context.markdown.length : newline
          const found = context.markdown.slice(cursor, end).indexOf(rawLine)
          let offset = cursor + Math.max(0, found)
          for (const part of highlighted) {
            sourceOffsets.set(part, offset)
            offset += part.text.length
          }
          cursor = newline < 0 ? end : newline + 1
          const wrapped = wrapSegments(highlighted.length > 0 ? highlighted : [segment('', baseCodeStyle)], Math.max(1, context.width - 2), true)
          for (const piece of wrapped.length > 0 ? wrapped : [[]]) {
            lines.push([
              segment('│ ', { color: fenceColor }),
              ...piece,
            ])
          }
        }
        lines.push([segment(`└${'─'.repeat(headerWidth)}`, { color: fenceColor, bold: true })])
        lines.push([])
        break
      }
      case 'thematicBreak': {
        lines.push([segment('─'.repeat(Math.max(1, context.width)), { color: context.theme.border })])
        lines.push([])
        break
      }
      case 'table': {
        lines.push(...renderTable(node, context))
        lines.push([])
        break
      }
      case 'html': {
        break
      }
      default: {
        const fallback = renderInline('children' in node ? node.children : [], undefined, context.theme)
        if (fallback.length > 0) {
          lines.push(...wrapSegments(fallback, context.width, context.wrap))
          lines.push([])
        }
        break
      }
    }
  }

  return trimTrailingBlankLines(lines)
}

function renderTable(node: Table, context: { width: number; theme: Theme; wrap: boolean; padding: number; syntaxTheme: Theme }): RenderLine[] {
  const headingStyle = { color: context.theme.heading, bold: true }
  const rows = node.children.map((row, index) => row.children.map((cell) =>
    renderInline(cell.children, index === 0 ? headingStyle : undefined, context.theme),
  ))

  if (rows.length === 0) {
    return []
  }

  const columnCount = Math.max(...rows.map((row) => row.length))
  // Each column needs two padding cells and a border, plus the left border.
  const available = context.width - (3 * columnCount + 1)
  if (available < columnCount * 3) {
    // Keep all cells readable when even a compact grid cannot fit.
    const stacked: RenderLine[] = []
    const records = rows.length > 1 ? rows.slice(1) : rows
    records.forEach((row, rowIndex) => {
      if (rowIndex > 0) stacked.push([])
      for (let column = 0; column < columnCount; column += 1) {
        const label = rows[0][column] ?? []
        stacked.push(...wrapSegments([
          ...(rows.length > 1 ? [
            ...(plainText(label) ? label.map((part) => segment(part.text, part.style)) : [segment(`Column ${column + 1}`, headingStyle)]),
            segment(': ', headingStyle),
          ] : []),
          ...(row[column] ?? []),
        ], context.width, true))
      }
    })
    return stacked
  }
  const naturalWidths = new Array(columnCount).fill(0).map((_, column) =>
    Math.max(3, ...rows.map((row) => widthOf(plainText(row[column] ?? [])))),
  )

  const widths = new Array<number>(columnCount).fill(3)
  let remaining = available - columnCount * 3
  // Distribute the budget without letting minimum column widths cause overflow.
  while (remaining > 0) {
    const expandable = widths.map((_, column) => column).filter((column) => widths[column] < naturalWidths[column])
    if (expandable.length === 0) break
    for (const column of expandable) {
      if (remaining === 0) break
      widths[column] += 1
      remaining -= 1
    }
  }

  const header: RenderLine[] = []
  const separator = `├${widths.map((value) => '─'.repeat(value + 2)).join('┼')}┤`
  header.push([segment(`┌${widths.map((value) => '─'.repeat(value + 2)).join('┬')}┐`, { color: context.theme.border })])
  rows.forEach((row, rowIndex) => {
    const wrappedCells = row.map((cell, column) => wrapSegments(cell, widths[column] ?? 3, true))
    const rowHeight = Math.max(...wrappedCells.map((cellLines) => cellLines.length), 1)
    for (let lineIndex = 0; lineIndex < rowHeight; lineIndex += 1) {
      const line: RenderLine = [segment('│', { color: context.theme.border })]
      for (let column = 0; column < columnCount; column += 1) {
        const value = wrappedCells[column]?.[lineIndex] ?? []
        const padding = repeatSpace((widths[column] ?? 3) - widthOf(plainText(value)))
        const style = rowIndex === 0 ? headingStyle : undefined
        line.push(segment(' ', style), ...value, segment(`${padding} `, style))
        line.push(segment('│', { color: context.theme.border }))
      }
      header.push(line)
    }
    if (rowIndex === 0) {
      header.push([segment(separator, { color: context.theme.border })])
    }
  })
  header.push([segment(`└${widths.map((value) => '─'.repeat(value + 2)).join('┴')}┘`, { color: context.theme.border })])
  return header
}

function renderInline(nodes: Nodes[], inheritedStyle: RenderSegmentStyle | undefined, theme: Theme): RenderSegment[] {
  const segments: RenderSegment[] = []
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        segments.push(segment(node.value ?? '', inheritedStyle, node.position?.start.offset))
        break
      case 'strong':
        segments.push(...renderInline(node.children ?? [], { ...inheritedStyle, bold: true }, theme))
        break
      case 'emphasis':
        segments.push(...renderInline(node.children ?? [], { ...inheritedStyle, italic: true }, theme))
        break
      case 'inlineCode':
        segments.push(segment(node.value ?? '', {
          color: theme.codeForeground,
          backgroundColor: theme.codeBackground,
        }, node.position?.start.offset))
        break
      case 'link':
        segments.push(...renderInline(node.children ?? [], { ...inheritedStyle, color: theme.link, underline: true }, theme))
        break
      case 'delete':
        segments.push(...renderInline(node.children ?? [], { ...inheritedStyle, dimColor: true }, theme))
        break
      case 'break':
        segments.push(segment('\n', inheritedStyle, node.position?.start.offset))
        break
      case 'html':
        break
      default:
        segments.push(...renderInline('children' in node ? node.children : [], inheritedStyle, theme))
        break
    }
  }
  return segments
}

function highlightCodeLine(line: string, language: string, syntaxTheme: Theme, baseStyle: RenderSegmentStyle): RenderSegment[] {
  if (!line) {
    return [];
  }

  const regex = createCodeTokenRegex(language);
  const segments: RenderSegment[] = [];
  let index = 0;

  while (index < line.length) {
    regex.lastIndex = index;
    const match = regex.exec(line);
    if (!match || match.index !== index) {
      segments.push(segment(line[index] ?? '', baseStyle));
      index += 1;
      continue;
    }

    const text = match[0];
    const style = syntaxStyleForToken(match.groups ?? {}, syntaxTheme, baseStyle);
    segments.push(segment(text, style));
    index += text.length;
  }

  return segments;
}

function syntaxStyleForToken(
  groups: Record<string, string | undefined>,
  syntaxTheme: Theme,
  baseStyle: RenderSegmentStyle,
): RenderSegmentStyle {
  if (groups.comment) {
    return { ...baseStyle, color: syntaxTheme.muted, dimColor: true };
  }
  if (groups.string) {
    return { ...baseStyle, color: syntaxTheme.warning };
  }
  if (groups.keyword) {
    return { ...baseStyle, color: syntaxTheme.accent, bold: true };
  }
  if (groups.property) {
    return { ...baseStyle, color: syntaxTheme.heading, bold: true };
  }
  if (groups.number) {
    return { ...baseStyle, color: syntaxTheme.link };
  }
  if (groups.function) {
    return { ...baseStyle, color: syntaxTheme.link, bold: true };
  }
  if (groups.constant) {
    return { ...baseStyle, color: syntaxTheme.warning, bold: true };
  }
  if (groups.identifier) {
    return baseStyle;
  }
  return baseStyle;
}

function createCodeTokenRegex(language: string): RegExp {
  const normalized = normalizeCodeLanguage(language);
  const keywordPattern = buildKeywordPattern(normalized);
  const commentPattern = buildCommentPattern(normalized);
  const propertyPattern = normalized === 'yaml' || normalized === 'json' || normalized === 'jsonc'
    ? String.raw`(?<property>"[^"]+"|'[^']+'|[A-Za-z0-9_-]+)(?=\s*:)`
    : normalized === 'javascript' || normalized === 'typescript' || normalized === 'tsx' || normalized === 'jsx'
      ? String.raw`(?<property>[A-Za-z_$][\w$]*)(?=\s*:)`
      : normalized === 'css'
        ? String.raw`(?<property>[.#]?[A-Za-z_-][\w-]*)(?=\s*:)`
        : '';
  const functionPattern = normalized === 'shell' || normalized === 'bash' || normalized === 'zsh'
    ? String.raw`(?<function>[A-Za-z_$][\w$-]*)(?=\()`
    : String.raw`(?<function>[A-Za-z_$][\w$]*)(?=\()`;
  const source = [
    String.raw`(?<whitespace>\s+)`,
    commentPattern,
    String.raw`(?<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|` + '`(?:[^`\\\\]|\\\\.)*`' + `)`,
    propertyPattern,
    keywordPattern,
    String.raw`(?<number>\b-?(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b)`,
    functionPattern,
    String.raw`(?<identifier>[A-Za-z_$][\w$-]*)`,
    String.raw`(?<punct>.)`,
  ]
    .filter(Boolean)
    .join('|');

  return new RegExp(source, 'gy');
}

function buildCommentPattern(language: string): string {
  if (language === 'shell' || language === 'bash' || language === 'zsh' || language === 'yaml' || language === 'python') {
    return String.raw`(?<comment>#.*$)`;
  }
  if (language === 'sql') {
    return String.raw`(?<comment>--.*$)`;
  }
  return String.raw`(?<comment>//.*$|/\*.*?\*/|#.*$|--.*$)`;
}

function buildKeywordPattern(language: string): string {
  const keywords = new Set<string>([
    'if',
    'else',
    'for',
    'while',
    'switch',
    'case',
    'break',
    'continue',
    'return',
    'function',
    'const',
    'let',
    'var',
    'class',
    'import',
    'from',
    'export',
    'default',
    'async',
    'await',
    'try',
    'catch',
    'finally',
    'throw',
    'new',
    'true',
    'false',
    'null',
    'undefined',
    'in',
    'of',
    'as',
  ]);

  if (language === 'python') {
    for (const keyword of ['def', 'elif', 'except', 'lambda', 'pass', 'yield', 'with', 'and', 'or', 'not', 'is', 'None', 'self']) {
      keywords.add(keyword);
    }
  } else if (language === 'shell' || language === 'bash' || language === 'zsh') {
    for (const keyword of ['do', 'done', 'then', 'fi', 'esac', 'until', 'select', 'local', 'readonly', 'source', 'return']) {
      keywords.add(keyword);
    }
  } else if (language === 'sql') {
    for (const keyword of ['select', 'insert', 'update', 'delete', 'create', 'table', 'values', 'join', 'left', 'right', 'inner', 'outer', 'group', 'order', 'by', 'limit', 'offset', 'where', 'into', 'set', 'on', 'case', 'when', 'then', 'end']) {
      keywords.add(keyword);
    }
  } else if (language === 'yaml' || language === 'json' || language === 'jsonc') {
    for (const keyword of ['true', 'false', 'null', 'yes', 'no', 'on', 'off', '~']) {
      keywords.add(keyword);
    }
  } else if (language === 'css') {
    for (const keyword of ['@media', '@import', 'display', 'flex', 'grid', 'var']) {
      keywords.add(keyword);
    }
  }

  const pattern = Array.from(keywords)
    .sort((a, b) => b.length - a.length)
    .map((keyword) => escapeRegExp(keyword))
    .join('|');

  return pattern ? String.raw`(?<keyword>\b(?:${pattern})\b)` : '';
}

function normalizeCodeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (['js', 'mjs', 'cjs', 'javascript', 'ecmascript', 'node'].includes(normalized)) {
    return 'javascript';
  }
  if (['ts', 'tsx', 'typescript'].includes(normalized)) {
    return 'typescript';
  }
  if (['jsx'].includes(normalized)) {
    return 'jsx';
  }
  if (['sh', 'bash', 'zsh', 'shell', 'console'].includes(normalized)) {
    return 'shell';
  }
  if (['yml', 'yaml'].includes(normalized)) {
    return 'yaml';
  }
  if (['json', 'jsonc'].includes(normalized)) {
    return normalized;
  }
  if (['py', 'python'].includes(normalized)) {
    return 'python';
  }
  if (['sql'].includes(normalized)) {
    return 'sql';
  }
  if (['css'].includes(normalized)) {
    return 'css';
  }
  if (['html', 'htm'].includes(normalized)) {
    return 'html';
  }
  return normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function segment(text: string, style?: RenderSegmentStyle, offset?: number): RenderSegment {
  const result = { text, style }
  if (offset !== undefined) sourceOffsets.set(result, offset)
  return result
}

function wrapSegments(segments: RenderSegment[], width: number, wrap: boolean): RenderLine[] {
  const lines: RenderLine[] = []
  let current: RenderLine = []
  let currentWidth = 0
  const pushCurrent = () => {
    lines.push(current)
    current = []
    currentWidth = 0
  }
  for (const source of segments) {
    let offset = sourceOffsets.get(source)
    const append = (text: string) => {
      current.push(segment(text, source.style, offset))
      currentWidth += widthOf(text)
      if (offset !== undefined) offset += text.length
    }
    const pieces = source.text.split('\n')
    pieces.forEach((piece, index) => {
      for (const token of wrap ? splitWords(piece) : [piece]) {
        if (!token) continue
        const tokenWidth = widthOf(token)
        if (wrap && currentWidth > 0 && currentWidth + tokenWidth > width) pushCurrent()
        if (wrap && tokenWidth > width) {
          let buffer = ''
          for (const part of graphemes(token)) {
            if (widthOf(buffer + part) > width && buffer) {
              append(buffer)
              pushCurrent()
              buffer = ''
            }
            buffer += part
          }
          if (buffer) append(buffer)
        } else append(token)
      }
      if (index < pieces.length - 1) {
        pushCurrent()
        if (offset !== undefined) offset++
      }
    })
  }
  if (current.length > 0 || lines.length === 0) lines.push(current)
  return lines
}

function plainText(segments: RenderSegment[]): string {
  return segments.map((segment) => segment.text).join('');
}

function prefixLine(line: RenderLine, prefix: RenderLine): RenderLine {
  return [...prefix, ...line];
}

function trimTrailingBlankLines(lines: RenderLine[]): RenderLine[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1].length === 0) {
    end -= 1;
  }
  return lines.slice(0, end);
}

function inferTitle(tree: Root, sourceName: string): string {
  for (const node of tree.children ?? []) {
    if (node.type === 'heading' && node.depth === 1) {
      return stripControlChars(plainText(renderInline(node.children ?? [], undefined, {
        foreground: '',
        muted: '',
        accent: '',
        heading: '',
        quote: '',
        codeForeground: '',
        codeBackground: '',
        border: '',
        warning: '',
        error: '',
        link: '',
        name: 'github',
      })))
    }
  }
  return sourceName
}
