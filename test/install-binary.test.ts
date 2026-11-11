import { createHash } from 'node:crypto'
import { chmod, symlink, realpath, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

      expect(result.stdout).toBe(`Installed mdview to ${await realpath(fixture.installed)}\n`);
      expect(result.stderr).toBe('');
      expect(await readFile(fixture.installed)).toEqual(content);
      const installedStat = await stat(fixture.installed);
      expect(installedStat.isFile()).toBe(true);
      if (process.platform !== 'win32') {
        expect(installedStat.mode & 0o777).toBe(0o755);
      }
      await rm(fixture.installed)
      await symlink(source, fixture.installed)
      await expect(execFileAsync(process.execPath, [installer], {
        cwd: fixture.workspace, env: { ...process.env, MDVIEW_INSTALL_DIR: fixture.destination },
      })).rejects.toThrow('Use the package manager')
      expect(await readFile(source)).toEqual(content)

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


const downloader = fileURLToPath(new URL('../scripts/install-release.sh', import.meta.url))

async function downloadFixture() {
  const fixture = await makeFixture()
  const tools = path.join(fixture.root, 'tools')
  const name = `mdview-v0.2.1-${process.platform}-${process.arch}`
  const archive = `${name}.tar.gz`
  await mkdir(tools)
  await mkdir(path.join(fixture.workspace, name))
  await writeFile(path.join(fixture.workspace, name, 'mdview'), '#!/bin/sh\nprintf "0.2.1\\n"\n', { mode: 0o755 })
  await execFileAsync('tar', ['-czf', path.join(fixture.workspace, archive), '-C', fixture.workspace, name])
  const hash = createHash('sha256').update(await readFile(path.join(fixture.workspace, archive))).digest('hex')
  await writeFile(path.join(fixture.workspace, 'SHA256SUMS'), `${hash}  ${archive}\n`)
  await writeFile(path.join(tools, 'curl'), `#!/bin/sh
set -eu
url= out=
while [ "$#" -gt 0 ]; do
  case "$1" in -o) out=$2; shift ;; https:*) url=$1 ;; esac
  shift
done
case "$url" in
  */latest) printf 'https://github.com/cbuchler/mdview/releases/tag/v0.2.1' ;;
  *) cp "$MDVIEW_FIXTURE/\${url##*/}" "$out" ;;
esac
`, { mode: 0o755 })
  const env = { ...process.env, PATH: tools + path.delimiter + process.env.PATH, MDVIEW_FIXTURE: fixture.workspace }
  const run = () => execFileAsync('/bin/sh', [downloader, '--install-dir', fixture.destination], { env, timeout: 10000 })
  return { ...fixture, tools, archive, env, run }
}

describe('release downloader', () => {
  it('selects the latest stable archive, verifies it, and replaces an existing installation', async () => {
    const fixture = await downloadFixture()
    try {
      await mkdir(fixture.destination, { recursive: true })
      await writeFile(fixture.installed, 'old binary')
      await fixture.run()
      expect((await execFileAsync(fixture.installed, ['--version'])).stdout.trim()).toBe('0.2.1')
      expect((await stat(fixture.installed)).mode & 0o777).toBe(0o755)
    } finally { await rm(fixture.root, { recursive: true, force: true }) }
  })

  it.each(['checksum', 'download'])('preserves the installed bytes after a %s failure', async (failure) => {
    const fixture = await downloadFixture()
    try {
      await mkdir(fixture.destination, { recursive: true })
      await writeFile(fixture.installed, 'keep this binary')
      if (failure === 'checksum') await writeFile(path.join(fixture.workspace, fixture.archive), 'corrupt archive')
      else await rm(path.join(fixture.workspace, fixture.archive))
      await expect(fixture.run()).rejects.toThrow(failure === 'checksum' ? 'checksum mismatch' : 'Cannot download')
      expect(await readFile(fixture.installed, 'utf8')).toBe('keep this binary')
    } finally { await rm(fixture.root, { recursive: true, force: true }) }
  })

  it('refuses managed symlinks and unsupported platforms before installation', async () => {
    const fixture = await downloadFixture()
    try {
      await mkdir(fixture.destination, { recursive: true })
      const managed = path.join(fixture.root, 'managed')
      await writeFile(managed, 'managed binary')
      await symlink(managed, fixture.installed)
      await expect(fixture.run()).rejects.toThrow('Refusing to replace a symlink')
      expect(await readFile(managed, 'utf8')).toBe('managed binary')
      await writeFile(path.join(fixture.tools, 'uname'), '#!/bin/sh\necho Unsupported\n', { mode: 0o755 })
      await expect(fixture.run()).rejects.toThrow('Supported platforms')
      expect(await readFile(managed, 'utf8')).toBe('managed binary')
    } finally { await rm(fixture.root, { recursive: true, force: true }) }
  })
})
