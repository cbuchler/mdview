import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const installer = fileURLToPath(new URL('../scripts/install-binary.mjs', import.meta.url));

async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mdview-install-'));
  const workspace = path.join(root, 'workspace');
  const destination = path.join(root, 'destination', 'bin');
  try {
    await mkdir(workspace);
    return { root, workspace, destination, installed: path.join(destination, 'mdview') };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

describe('install:binary helper', () => {
  it('copies the fixture executable bytes and mode into the requested directory', async () => {
    const fixture = await makeFixture();
    try {
      const source = path.join(fixture.workspace, 'release', 'mdview');
      const content = Buffer.from('#!/bin/sh\nprintf "%s\\n" "mdview installer fixture"\n');
      await mkdir(path.dirname(source));
      await writeFile(source, content);
      await chmod(source, 0o755);

      const result = await execFileAsync(process.execPath, [installer], {
        cwd: fixture.workspace,
        env: { ...process.env, MDVIEW_INSTALL_DIR: fixture.destination },
        timeout: 5000,
        maxBuffer: 8192,
      });

      expect(result.stdout).toBe(`Installed mdview to ${fixture.installed}\n`);
      expect(result.stderr).toBe('');
      expect(await readFile(fixture.installed)).toEqual(content);
      const installedStat = await stat(fixture.installed);
      expect(installedStat.isFile()).toBe(true);
      if (process.platform !== 'win32') {
        expect(installedStat.mode & 0o777).toBe(0o755);
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('fails clearly without creating a target when the fixture binary is missing', async () => {
    const fixture = await makeFixture();
    try {
      await expect(execFileAsync(process.execPath, [installer], {
        cwd: fixture.workspace,
        env: { ...process.env, MDVIEW_INSTALL_DIR: fixture.destination },
        timeout: 5000,
        maxBuffer: 8192,
      })).rejects.toMatchObject({
        code: 1,
        stdout: '',
        stderr: expect.stringMatching(/Install failed:.*ENOENT/s),
      });
      await expect(stat(fixture.installed)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(fixture.destination)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
