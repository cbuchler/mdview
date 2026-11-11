// Apply the filter before exec so no unfiltered helper shares the parser's PID namespace.
export function linuxSeccomp(): Buffer {
  const x64 = process.arch === 'x64'
  if (!x64 && process.arch !== 'arm64') throw new Error('Unsupported Linux sandbox architecture')
  const instructions: number[][] = []
  const emit = (code: number, jt: number, jf: number, value: number) => instructions.push([code, jt, jf, value])
  const load = (offset: number) => emit(0x20, 0, 0, offset)
  const ret = (value: number) => emit(0x06, 0, 0, value)
  const deny = (syscall: number, errno = 1) => {
    emit(0x15, 0, 1, syscall)
    ret(0x50000 | errno)
  }
  load(4)
  emit(0x15, 1, 0, x64 ? 0xc000003e : 0xc00000b7)
  ret(0x80000000)
  load(0)
  if (x64) {
    emit(0x45, 0, 1, 0x40000000)
    ret(0x80000000)
  }
  // Anonymous socket pairs support runtime subprocess pipes without reaching host sockets.
  for (const syscall of x64
    ? [41, 165, 166, 155, 272, 308]
    : [198, 40, 39, 41, 97, 268]) deny(syscall)
  for (const syscall of [425, 426, 427, 428, 429, 430, 431, 432, 433, 442, 467]) deny(syscall)
  deny(435, 38) // ENOSYS lets libc create ordinary threads through clone.
  emit(0x15, 0, 3, x64 ? 56 : 220)
  load(16)
  emit(0x45, 0, 1, 0x7e020080)
  ret(0x50001)
  ret(0x7fff0000)
  const result = Buffer.alloc(instructions.length * 8)
  instructions.forEach(([code, jt, jf, value], index) => {
    result.writeUInt16LE(code, index * 8)
    result[index * 8 + 2] = jt
    result[index * 8 + 3] = jf
    result.writeUInt32LE(value, index * 8 + 4)
  })
  return result
}
