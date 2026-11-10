import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DocumentReceiver, FrameReader, frame, record, displayString, decodeFrame, RENDER_TIMEOUT_MS, MAX_RENDER_HEADER_BYTES, MAX_RENDER_WIRE_BYTES, MAX_RENDER_LABEL_BYTES } from './render-protocol.js'
import type { RenderOptions } from './render-protocol.js'
import type { RenderedDocument } from './types.js'

export class RenderCancelledError extends Error {
  constructor() { super('Render cancelled') }
}

interface Worker {
  child: ChildProcessWithoutNullStreams
  closed: Promise<void>
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

export function renderWorkerCommand(): string[] {
  const bun = globalThis as typeof globalThis & { Bun?: { isStandaloneExecutable?: boolean } }
  if (bun.Bun?.isStandaloneExecutable) return [process.execPath, '--internal-render-worker']
  const entry = fileURLToPath(new URL('./main' + (import.meta.url.endsWith('.ts') ? '.ts' : '.js'), import.meta.url))
  return process.versions.bun
    ? [process.execPath, entry, '--internal-render-worker']
    : [process.execPath, ...(entry.endsWith('.ts') ? ['--import', import.meta.resolve('tsx')] : []), entry, '--internal-render-worker']
}

export class RenderSupervisor {
  private worker: Worker | undefined
  private stopping: Promise<void> = Promise.resolve()
  private pending: Pending | undefined
  private generation = 0
  private disposed = false
  private exitHandler = () => { this.worker?.child.kill('SIGKILL') }

  constructor(private options: { timeoutMs?: number; command?: string[] } = {}) {
    process.once('exit', this.exitHandler)
  }

  async render(markdown: string, options: RenderOptions, maxInputBytes: number): Promise<RenderedDocument> {
    const id = ++this.generation
    if (this.disposed) throw new RenderCancelledError()
    if (this.pending) this.fail(new RenderCancelledError())
    await this.stopping
    if (this.disposed || id !== this.generation) throw new RenderCancelledError()
    const input = Buffer.from(markdown || '\n')
    if (input.length > maxInputBytes && markdown !== '') throw new Error('Render input exceeds configured byte limit')
    const metadata = Buffer.from(JSON.stringify({ version: 1, id, bytes: input.length, options }))
    if (metadata.length > MAX_RENDER_HEADER_BYTES) throw new Error('Render request header exceeds byte limit')
    const worker = this.worker ?? this.start()
    return new Promise<RenderedDocument>((resolve, reject) => {
      const pending: Pending = {
        id, worker, resolve, reject, bytes: 0, receiver: new DocumentReceiver(),
        reader: new FrameReader(() => MAX_RENDER_WIRE_BYTES, (body) => {
          const value = record(decodeFrame(body))
          if (value.version !== 1 || value.id !== id) throw new Error('Invalid render response identity')
          if (value.type === 'error') throw new Error(displayString(value.message, MAX_RENDER_LABEL_BYTES))
          const document = pending.receiver.accept(value)
          if (document) pending.completed = document
        }),
        timer: setTimeout(() => this.fail(new Error(`Markdown rendering exceeded the ${this.options.timeoutMs ?? RENDER_TIMEOUT_MS}ms deadline`)), this.options.timeoutMs ?? RENDER_TIMEOUT_MS),
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
      worker.child.kill('SIGKILL')
      this.stopping = worker.closed
    }
  }

  private start(): Worker {
    const [command, ...args] = this.options.command ?? renderWorkerCommand()
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const worker = { child, closed: new Promise<void>((resolve) => child.once('close', () => resolve())) }
    this.worker = worker
    let diagnostics = 0
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
    })
    child.stdin.on('error', () => {
      if (this.worker === worker) this.fail(new Error('Render worker input closed'))
    })
    child.once('error', () => {
      if (this.worker === worker) this.fail(new Error('Cannot start render worker'))
    })
    child.once('close', () => {
      if (this.worker === worker) this.fail(new Error('Render worker exited before completion'))
    })
    return worker
  }
}
