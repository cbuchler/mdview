import type { RenderedDocument, RenderLine } from './types.js'
import { sanitizeDisplayText } from './utils.js'

export const RENDER_TIMEOUT_MS = 5000
export const MAX_RENDER_WIRE_BYTES = 16 * 1024 * 1024
export const MAX_RENDER_TEXT_BYTES = 8 * 1024 * 1024
export const MAX_RENDER_LINES = 50_000
export const MAX_RENDER_SEGMENTS = 100_000
export const MAX_RENDER_HEADER_BYTES = 16 * 1024
export const MAX_RENDER_LABEL_BYTES = 4096

export interface RenderOptions {
  width: number
  padding: number
  wrap: boolean
  theme: string
  syntaxTheme: string
  sourceName: string
}

export function frame(data: Buffer): Buffer {
  const header = Buffer.allocUnsafe(8)
  header.writeBigUInt64BE(BigInt(data.length))
  return Buffer.concat([header, data])
}

// Copy each frame once. Repeated concatenation can make a slow stream quadratic.
export class FrameReader {
  private header = Buffer.alloc(8)
  private headerOffset = 0
  private body: Buffer | undefined
  private bodyOffset = 0

  constructor(private limit: () => number, private accept: (body: Buffer) => void) {}

  get atBoundary(): boolean { return this.headerOffset === 0 && !this.body }

  push(chunk: Buffer): void {
    let offset = 0
    while (offset < chunk.length) {
      if (!this.body) {
        const count = Math.min(8 - this.headerOffset, chunk.length - offset)
        chunk.copy(this.header, this.headerOffset, offset, offset + count)
        offset += count
        this.headerOffset += count
        if (this.headerOffset !== 8) continue
        const length = Number(this.header.readBigUInt64BE())
        if (!Number.isSafeInteger(length) || length === 0 || length > this.limit()) throw new Error('Render protocol frame exceeds its limit')
        this.body = Buffer.allocUnsafe(length)
        this.bodyOffset = 0
      }
      const count = Math.min(this.body.length - this.bodyOffset, chunk.length - offset)
      chunk.copy(this.body, this.bodyOffset, offset, offset + count)
      offset += count
      this.bodyOffset += count
      if (this.bodyOffset === this.body.length) {
        const body = this.body
        this.body = undefined
        this.headerOffset = 0
        this.accept(body)
      }
    }
  }
}

export function decodeFrame(body: Buffer): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid render response')
  return value as Record<string, unknown>
}

export function displayString(value: unknown, maxBytes: number): string {
  if (typeof value !== 'string' || Buffer.byteLength(value) > maxBytes || sanitizeDisplayText(value) !== value || /[\u0080-\u009f]/.test(value)) {
    throw new Error('Invalid text in render response')
  }
  return value
}

export class DocumentReceiver {
  private document: RenderedDocument | undefined
  private textBytes = 0
  private segments = 0
  private finished = false

  accept(value: Record<string, unknown>): RenderedDocument | undefined {
    if (this.finished) throw new Error('Unexpected render response after completion')
    if (value.type === 'start' && !this.document) {
      const title = displayString(value.title, MAX_RENDER_LABEL_BYTES)
      if (typeof value.parseMs !== 'number' || !Number.isFinite(value.parseMs) || value.parseMs < 0) throw new Error('Invalid render duration')
      this.document = { title, parseMs: value.parseMs, lines: [], lineCount: 0 }
    } else if (value.type === 'line' && this.document) {
      if (!Array.isArray(value.line) || this.document.lines.length >= MAX_RENDER_LINES) throw new Error('Rendered output exceeds line limit')
      const line: RenderLine = []
      for (const item of value.line) {
        if (++this.segments > MAX_RENDER_SEGMENTS) throw new Error('Rendered output exceeds segment limit')
        const segment = record(item)
        const text = displayString(segment.text, MAX_RENDER_TEXT_BYTES - this.textBytes)
        this.textBytes += Buffer.byteLength(text)
        if (segment.style !== undefined) {
          const style = record(segment.style)
          for (const [key, entry] of Object.entries(style)) {
            if (key === 'color' || key === 'backgroundColor') {
              if (typeof entry !== 'string' || !/^#[a-f\d]{6}$/i.test(entry)) throw new Error('Invalid render color')
            } else if (!['bold', 'italic', 'underline', 'dimColor'].includes(key) || typeof entry !== 'boolean') {
              throw new Error('Invalid render style')
            }
          }
        }
        if (Object.keys(segment).some((key) => key !== 'text' && key !== 'style')) throw new Error('Invalid render segment')
        line.push({ text, style: segment.style as RenderLine[number]['style'] })
      }
      this.document.lines.push(line)
    } else if (value.type === 'end' && this.document) {
      this.finished = true
      this.document.lineCount = this.document.lines.length
      return this.document
    } else {
      throw new Error('Invalid render response order')
    }
    return undefined
  }
}
