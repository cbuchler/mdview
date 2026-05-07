import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('install:binary helper', () => {
  it('copies the compiled binary into the requested directory', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mdview-install-'));
    const env = {
      ...process.env,
      MDVIEW_INSTALL_DIR: tempDir,
    };

    await execFileAsync('node', ['scripts/install-binary.mjs'], {
      cwd: process.cwd(),
      env,
    });

    const installed = path.join(tempDir, 'mdview');
    await expect(stat(installed)).resolves.toBeDefined();
    await expect(readFile(installed)).resolves.toBeDefined();
    await rm(tempDir, { recursive: true, force: true });
  });
});
