import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { sandboxLaunch, spawnRenderProcess, stopRenderProcess, renderWorkerCommand, SANDBOX_FAILURE } from './render-sandbox.js'
import type { RenderLaunch } from './render-sandbox.js'
import { RENDER_PROTOCOL_VERSION, DocumentReceiver, FrameReader, frame, record, displayString, decodeFrame, RENDER_TIMEOUT_MS, MAX_RENDER_HEADER_BYTES, MAX_RENDER_WIRE_BYTES, MAX_RENDER_LABEL_BYTES } from './render-protocol.js'
import type { RenderOptions } from './render-protocol.js'
import type { RenderedDocument } from './types.js'
import { sanitizeDisplayText } from './utils.js'

export class RenderCancelledError extends Error {
  constructor() { super('Render cancelled') }
}

interface Worker {
  child: ChildProcessWithoutNullStreams
  closed: Promise<void>
  isolated: boolean
}

interface Pending {
  id: number
  worker: Worker
  reject: (error: Error) => void
  resolve: (document: RenderedDocument) => void
  timer: ReturnType<typeof setTimeout>
  receiver: DocumentReceiver
  reader: FrameReader
  bytes: number
  completed?: RenderedDocument
}

export class RenderSupervisor {
  private worker: Worker | undefined
  private stopping: Promise<void> = Promise.resolve()
  private pending: Pending | undefined
  private generation = 0
  private disposed = false
  private launch: Promise<RenderLaunch> | undefined
  private exitHandler = () => { if (this.worker) stopRenderProcess(this.worker.child, this.worker.isolated) }

  constructor(private options: { timeoutMs?: number; command?: string[]; sandbox?: boolean } = {}) {
    process.once('exit', this.exitHandler)
  }

  async render(markdown: string, options: RenderOptions, maxInputBytes: number): Promise<RenderedDocument> {
    const startedAt = Date.now()
    const id = ++this.generation
    if (this.disposed) throw new RenderCancelledError()
    if (this.pending) this.fail(new RenderCancelledError())
    await this.stopping
    if (this.disposed || id !== this.generation) throw new RenderCancelledError()
    const input = Buffer.from(markdown || '\n')
    if (input.length > maxInputBytes && markdown !== '') throw new Error('Render input exceeds configured byte limit')
    const metadata = Buffer.from(JSON.stringify({ version: RENDER_PROTOCOL_VERSION, id, bytes: input.length, options }))
    if (metadata.length > MAX_RENDER_HEADER_BYTES) throw new Error('Render request header exceeds byte limit')
    if (!this.launch) {
      const [command, ...args] = this.options.command ?? renderWorkerCommand()
      this.launch = this.options.sandbox === false
        ? Promise.resolve({ command, args })
        : sandboxLaunch([command, ...args])
    }
    const launch = await this.launch
    if (this.disposed || id !== this.generation) throw new RenderCancelledError()
    const remainingMs = (this.options.timeoutMs ?? RENDER_TIMEOUT_MS) - (Date.now() - startedAt)
    if (remainingMs <= 0) throw new Error('Markdown rendering exceeded its startup deadline')
    const worker = this.worker ?? this.start(launch)
    return new Promise<RenderedDocument>((resolve, reject) => {
      const pending: Pending = {
        id, worker, resolve, reject, bytes: 0, receiver: new DocumentReceiver(markdown.length),
        reader: new FrameReader(() => MAX_RENDER_WIRE_BYTES, (body) => {
          const value = record(decodeFrame(body))
          if (value.version !== RENDER_PROTOCOL_VERSION || value.id !== id) throw new Error('Invalid render response identity')
          if (value.type === 'error') throw new Error(displayString(value.message, MAX_RENDER_LABEL_BYTES))
          const document = pending.receiver.accept(value)
          if (document) pending.completed = document
        }),
        timer: setTimeout(() => this.fail(new Error(`Markdown rendering exceeded the ${this.options.timeoutMs ?? RENDER_TIMEOUT_MS}ms deadline`)), remainingMs),
      }
      this.pending = pending
      worker.child.stdin.write(frame(metadata))
      // Keep the source out of JSON and avoid a second full-size frame copy.
      const length = Buffer.allocUnsafe(8)
      length.writeBigUInt64BE(BigInt(input.length))
      worker.child.stdin.write(length)
      worker.child.stdin.write(input)
    })
  }

  cancel(): void {
    ++this.generation
    if (this.pending) this.fail(new RenderCancelledError())
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.cancel()
    this.fail(new RenderCancelledError())
    process.off('exit', this.exitHandler)
    await this.stopping
    const launch = await this.launch?.catch(() => undefined)
    await launch?.cleanup?.()
  }

  private fail(error: Error): void {
    const pending = this.pending
    this.pending = undefined
    if (pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    const worker = this.worker
    this.worker = undefined
    if (worker) {
      stopRenderProcess(worker.child, worker.isolated)
      this.stopping = worker.closed
    }
  }

  private start(launch: RenderLaunch): Worker {
    const child = spawnRenderProcess(launch)
    const worker = { child, isolated: launch.isolated ?? false, closed: new Promise<void>((resolve) => child.once('close', () => resolve())) }
    this.worker = worker
    let diagnostics = 0
    let diagnosticText = ''
    const failure = (message: string) => new Error(this.options.sandbox === false ? message : `${message}. ${SANDBOX_FAILURE}`)
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        const pending = this.pending
        if (!pending || pending.worker !== worker) throw new Error('Unexpected render response')
        pending.bytes += chunk.length
        if (pending.bytes > MAX_RENDER_WIRE_BYTES) throw new Error('Rendered output exceeds byte limit')
        pending.reader.push(chunk)
        if (pending.completed) {
          if (!pending.reader.atBoundary) throw new Error('Trailing partial render response')
          this.pending = undefined
          clearTimeout(pending.timer)
          pending.resolve(pending.completed)
        }
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostics += chunk.length
      if (diagnostics > 8192) this.fail(new Error('Render worker exceeded diagnostic limit'))
      else diagnosticText += chunk.toString('utf8')
    })
    child.stdin.on('error', () => {
      if (this.worker === worker) this.fail(failure('Render worker input closed'))
    })
    child.once('error', () => {
      if (this.worker === worker) this.fail(failure('Cannot start render worker'))
    })
    child.once('close', () => {
      if (this.worker === worker) this.fail(failure('Render worker exited before completion' +
        (diagnosticText.trim() ? `: ${sanitizeDisplayText(diagnosticText.trim())}` : '')))
    })
    return worker
  }
}
