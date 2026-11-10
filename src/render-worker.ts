import { once } from 'node:events'
import { renderMarkdownDocument } from './markdown.js'
import { resolveTheme } from './theme.js'
import { sanitizeDisplayText } from './utils.js'
import { DocumentReceiver, FrameReader, frame, record, decodeFrame, MAX_RENDER_HEADER_BYTES, MAX_RENDER_WIRE_BYTES, MAX_RENDER_LABEL_BYTES } from './render-protocol.js'
import type { RenderOptions } from './render-protocol.js'

export async function runRenderWorker(): Promise<void> {
  let metadata: Record<string, unknown> | undefined
  let input: Buffer | undefined
  const reader = new FrameReader(
    () => metadata ? metadata.bytes as number : MAX_RENDER_HEADER_BYTES,
    (body) => {
      if (metadata) {
        if (input || body.length !== metadata.bytes) throw new Error('Invalid render input')
        input = body
      } else {
        metadata = record(decodeFrame(body))
        if (metadata.version !== 1 || !Number.isSafeInteger(metadata.id) || !Number.isSafeInteger(metadata.bytes) || (metadata.bytes as number) < 1) throw new Error('Invalid render request')
      }
    },
  )
  // EOF can stop an idle worker. A busy synchronous parser needs its owner's signal.
  for await (const chunk of process.stdin) {
    reader.push(Buffer.from(chunk))
    if (!metadata || !input) continue
    const request = metadata
    const markdown = input.toString('utf8')
    metadata = undefined
    input = undefined
    let sentBytes = 0
    const send = async (value: Record<string, unknown>) => {
      const bytes = Buffer.from(JSON.stringify({ ...value, version: 1, id: request.id }))
      sentBytes += bytes.length + 8
      if (sentBytes > MAX_RENDER_WIRE_BYTES) throw new Error('Rendered output exceeds byte limit')
      if (!process.stdout.write(frame(bytes))) await once(process.stdout, 'drain')
    }
    try {
      const options = record(request.options) as unknown as RenderOptions
      if (!Number.isSafeInteger(options.width) || options.width < 1 || !Number.isSafeInteger(options.padding) || options.padding < 0 || typeof options.wrap !== 'boolean' || typeof options.sourceName !== 'string') throw new Error('Invalid render options')
      const document = renderMarkdownDocument(markdown, {
        ...options, theme: resolveTheme(options.theme), syntaxTheme: resolveTheme(options.syntaxTheme),
      })
      const validator = new DocumentReceiver()
      const title = sanitizeDisplayText(document.title).replace(/[\u0080-\u009f]/g, '')
      const start = { type: 'start', title, parseMs: document.parseMs }
      validator.accept(start)
      await send(start)
      for (const line of document.lines) {
        const value = { type: 'line', line }
        validator.accept(value)
        await send(value)
      }
      await send({ type: 'end' })
    } catch (error) {
      const message = sanitizeDisplayText(error instanceof Error ? error.message : String(error))
      const failure = Buffer.from(JSON.stringify({ version: 1, id: request.id, type: 'error', message: message.slice(0, MAX_RENDER_LABEL_BYTES / 4) }))
      if (!process.stdout.write(frame(failure))) await once(process.stdout, 'drain')
    }
  }
}
