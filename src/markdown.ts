import { unified } from 'unified';
import type { Nodes, Root, Table } from 'mdast'
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { stripControlChars, graphemes, repeatSpace, splitWords, widthOf } from './utils.js';
import type { RenderLine, RenderedDocument, RenderSegment, RenderSegmentStyle } from './types.js';
import type { Theme } from './theme.js';
import { markdownDepthError, validateMarkdownDepth } from './markdown-depth.js';

const inlineParser = unified().use(remarkParse).use(remarkGfm);
// Resize changes layout, not source. Retain only the latest validated tree.
let lastParsed: {
  markdown: string
  tree: Root
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
    lastParsed = { markdown, tree }
  }
  const title = inferTitle(tree, options.sourceName)
  const body = renderBlocks(tree.children ?? [], {
    width: Math.max(1, options.width - options.padding * 2),
    theme: options.theme,
    wrap: options.wrap,
    padding: options.padding,
    syntaxTheme: options.syntaxTheme,
    listDepth: 0,
  })

  const lines = body.length === 0 ? [[segment('No markdown content found.', { color: options.theme.muted })]] : body
  return {
    title,
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
        for (const rawLine of rawLines) {
          const highlighted = highlightCodeLine(stripControlChars(rawLine), lang, context.syntaxTheme, baseCodeStyle)
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
  const rows: string[][] = []
  for (const row of node.children ?? []) {
    rows.push((row.children ?? []).map((cell) => plainText(renderInline(cell.children ?? [], undefined, context.theme))))
  }

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
        const label = rows.length > 1 ? `${rows[0][column] || `Column ${column + 1}`}: ` : ''
        stacked.push(...wrapSegments([
          segment(label, { color: context.theme.heading, bold: true }),
          segment(row[column] ?? ''),
        ], context.width, true))
      }
    })
    return stacked
  }
  const naturalWidths = new Array(columnCount).fill(0).map((_, column) =>
    Math.max(3, ...rows.map((row) => widthOf(row[column] ?? ''))),
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
    const wrappedCells = row.map((cell, column) => wrapPlainText(cell, widths[column] ?? 3))
    const rowHeight = Math.max(...wrappedCells.map((cellLines) => cellLines.length), 1)
    for (let lineIndex = 0; lineIndex < rowHeight; lineIndex += 1) {
      const line: RenderLine = [segment('│', { color: context.theme.border })]
      for (let column = 0; column < columnCount; column += 1) {
        const cellLines = wrappedCells[column] ?? ['']
        const value = cellLines[lineIndex] ?? ''
        const padded = value + repeatSpace((widths[column] ?? 3) - widthOf(value))
        line.push(segment(` ${padded} `, rowIndex === 0 ? { color: context.theme.heading, bold: true } : undefined))
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
        segments.push(segment(node.value ?? '', inheritedStyle))
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
        }))
        break
      case 'link':
        segments.push(...renderInline(node.children ?? [], { ...inheritedStyle, color: theme.link, underline: true }, theme))
        break
      case 'delete':
        segments.push(...renderInline(node.children ?? [], { ...inheritedStyle, dimColor: true }, theme))
        break
      case 'break':
        segments.push(segment('\n', inheritedStyle))
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

function segment(text: string, style?: RenderSegmentStyle): RenderSegment {
  return {
    text,
    style,
  };
}

function wrapSegments(segments: RenderSegment[], width: number, wrap: boolean): RenderLine[] {
  const lines: RenderLine[] = [];
  let current: RenderLine = [];

  if (!wrap) {
    for (const source of segments) {
      const pieces = source.text.split('\n');
      pieces.forEach((piece, index) => {
        if (piece) current.push(segment(piece, source.style));
        if (index < pieces.length - 1) {
          lines.push(current);
          current = [];
        }
      });
    }
    if (current.length > 0 || lines.length === 0) lines.push(current);
    return lines;
  }

  let currentWidth = 0;

  const pushCurrent = () => {
    lines.push(current);
    current = [];
    currentWidth = 0;
  };

  for (const source of segments) {
    const pieces = source.text.split('\n');
    pieces.forEach((piece, index) => {
      const tokens = splitWords(piece);
      if (tokens.length === 0) {
        if (index < pieces.length - 1) {
          pushCurrent();
        }
        return;
      }
      for (const token of tokens) {
        const tokenWidth = widthOf(token);
        if (token === '\n') {
          pushCurrent();
          continue;
        }
        if (wrap && currentWidth > 0 && currentWidth + tokenWidth > width) {
          pushCurrent();
        }
        if (tokenWidth > width && wrap) {
          const graphemeParts = graphemes(token);
          let buffer = '';
          for (const part of graphemeParts) {
            if (widthOf(buffer + part) > width && buffer) {
              current.push(segment(buffer, source.style));
              pushCurrent();
              buffer = part;
            } else {
              buffer += part;
            }
          }
          if (buffer) {
            current.push(segment(buffer, source.style));
            currentWidth += widthOf(buffer);
          }
          continue;
        }
        current.push(segment(token, source.style));
        currentWidth += tokenWidth;
      }
      if (index < pieces.length - 1) {
        pushCurrent();
      }
    });
  }

  if (current.length > 0 || lines.length === 0) {
    lines.push(current);
  }

  return lines;
}

function wrapPlainText(text: string, width: number): string[] {
  const clean = stripControlChars(text);
  if (width <= 0) {
    return [clean];
  }

  const words = splitWords(clean);
  const lines: string[] = [];
  let current = '';
  let currentWidth = 0;

  const push = () => {
    lines.push(current.trimEnd());
    current = '';
    currentWidth = 0;
  };

  for (const word of words) {
    const wordWidth = widthOf(word);
    if (word === '\n') {
      push();
      continue;
    }
    if (currentWidth > 0 && currentWidth + wordWidth > width) {
      push();
    }
    if (wordWidth > width) {
      const graphemeParts = graphemes(word);
      let buffer = '';
      for (const part of graphemeParts) {
        if (widthOf(buffer + part) > width && buffer) {
          lines.push(buffer);
          buffer = part;
        } else {
          buffer += part;
        }
      }
      if (buffer) {
        lines.push(buffer);
      }
      continue;
    }
    current += word;
    currentWidth += wordWidth;
  }

  if (current || lines.length === 0) {
    lines.push(current.trimEnd());
  }
  return lines;
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
