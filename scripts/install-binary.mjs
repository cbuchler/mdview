import { access, copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const source = path.resolve('release', 'mdview');
const targetDir = process.env.MDVIEW_INSTALL_DIR || path.join(os.homedir(), '.local', 'bin');
const target = path.join(targetDir, 'mdview');

async function main() {
  await stat(source);
  await mkdir(targetDir, { recursive: true });
  await copyFile(source, target);
  await access(target);
  process.stdout.write(`Installed mdview to ${target}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Install failed: ${message}\n`);
  process.exitCode = 1;
});
