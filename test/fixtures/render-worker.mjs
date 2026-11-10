import { writeFileSync } from 'node:fs'

const [mode, pidFile] = process.argv.slice(2)
if (pidFile) writeFileSync(pidFile, String(process.pid))
const frame = (value) => {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))
  const header = Buffer.alloc(8)
  header.writeBigUInt64BE(BigInt(body.length))
  return Buffer.concat([header, body])
}
let buffered = Buffer.alloc(0)
let metadata
process.stdin.on('data', (chunk) => {
  buffered = Buffer.concat([buffered, chunk])
  while (buffered.length >= 8) {
    const length = Number(buffered.readBigUInt64BE())
    if (buffered.length < length + 8) return
    const body = buffered.subarray(8, length + 8)
    buffered = buffered.subarray(length + 8)
    if (!metadata) {
      metadata = JSON.parse(body.toString())
      continue
    }
    const id = metadata.id
    metadata = undefined
    const response = (value) => frame({ version: 2, id, ...value })
    if (body.toString() === 'busy') { while (true) {} }
    if (mode === 'oversized') {
      const header = Buffer.alloc(8)
      header.writeBigUInt64BE(100_000_000n)
      process.stdout.write(header)
    } else if (mode === 'diagnostics') {
      process.stderr.write(Buffer.alloc(9000, 'x'))
    } else if (mode === 'malformed') {
      process.stdout.write(frame(Buffer.from([0xff])))
    } else if (mode === 'controls') {
      process.stdout.write(response({ type: 'start', title: '\u001b[31mUnsafe', parseMs: 1 }))
    } else if (mode === 'exit') {
      process.exit(2)
    } else if (mode === 'source') {
      process.stdout.write(Buffer.concat([
        response({ type: 'start', title: 'Title', parseMs: 1 }),
        response({ type: 'line', line: [{ text: 'Body' }], source: { block: 0, offset: 0 } }),
      ]))
    } else if (mode === 'style') {
      process.stdout.write(Buffer.concat([
        response({ type: 'start', title: 'Title', parseMs: 1 }),
        response({ type: 'line', line: [{ text: 'Body', style: { color: 'red\u001b' } }] }),
      ]))
    } else {
      process.stdout.write(Buffer.concat([
        response({ type: 'start', title: String(process.pid), parseMs: 1 }),
        response({ type: 'line', line: [{ text: body.toString() }] }),
        response({ type: 'end' }),
        ...(mode === 'trailing' ? [Buffer.from([0, 0])] : []),
      ]))
    }
  }
})
