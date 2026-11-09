import { closeSync, constants, fstatSync, openSync } from 'node:fs';
import { ReadStream } from 'node:tty';
import { acquireKeyboardInput } from '../../src/terminal.js';

let original = -1;
let closes = 0;
const keyboard = acquireKeyboardInput(process.stdin, process.platform, {
  open() { original = openSync('/dev/tty', constants.O_RDONLY | constants.O_NOCTTY); return original; },
  createStream: (fd) => new ReadStream(fd),
  close(fd) { closes += 1; closeSync(fd); },
});
if (!keyboard?.owned) throw new Error('Fixture requires pipe stdin and a controlling terminal');
try {
  fstatSync(original);
  throw new Error('Original Node descriptor leaked');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'EBADF') throw error;
}
const replacement = openSync('/dev/null', constants.O_RDONLY);
try {
  if (replacement !== original) throw new Error('Fixture did not exercise fd reuse');
  keyboard.stream.setRawMode(true);
  const disposal = keyboard.dispose();
  if (keyboard.dispose() !== disposal) throw new Error('Disposal is not idempotent');
  await disposal;
  fstatSync(replacement); // Disposal must never close the replacement descriptor.
  if (closes !== 1) throw new Error('Original fd close count is wrong');
  process.stdout.write('FD_OWNERSHIP_OK\n');
} finally {
  closeSync(replacement);
  await keyboard.dispose();
}
