import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..');

function runCli(args: string[], configPath: string, input: string, endInput = true) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(process.execPath, [
      '--max-old-space-size=96', '--import', 'tsx', path.join(repoRoot, 'src', 'main.ts'),
      '--config', configPath, '--padding', '0', ...args,
    ], {
      cwd: repoRoot, env: { ...process.env, NODE_NO_WARNINGS: '1' },
      encoding: 'utf8', timeout: 5000, maxBuffer: 100_000,
    }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') reject(error);
      else resolve({ code: error ? error.code as number : 0, stdout, stderr });
    });
    if (endInput) child.stdin?.end(input);
    else child.stdin?.write(input);
  });
}

describe('CLI input and optional wrap parsing', () => {
  it.each([[], ['-'], ['--wrap', '-'], ['-', '--theme', 'dracula']])('renders piped stdin once with %j', async (...args) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-cli-parser-'));
    try {
      const result = await runCli(args, path.join(directory, 'missing.yml'), 'stdin 界 👩‍💻 document');
      expect(result).toEqual({ code: 0, stdout: 'stdin 界 👩‍💻 document\n', stderr: '' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('reads explicit stdin redirected from a file', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-cli-redirect-'));
    const fixture = path.join(directory, 'stdin.md');
    await writeFile(fixture, 'redirected document');
    try {
      // The shell redirects fixture bytes to fd 0 exactly as `mdview - < fixture.md`.
      const result = await new Promise<string>((resolve, reject) => {
        execFile('bash', ['-c', 'exec "$1" --max-old-space-size=96 --import tsx "$2" --config "$3" - < "$4"',
          'mdview-redirect-test', process.execPath, path.join(repoRoot, 'src', 'main.ts'),
          path.join(directory, 'missing.yml'), fixture,
        ], {
          cwd: repoRoot, env: { ...process.env, NODE_NO_WARNINGS: '1' },
          timeout: 5000, maxBuffer: 100_000, encoding: 'utf8',
        }, (error, stdout, stderr) => {
          if (error) reject(error);
          else if (stderr) reject(new Error(stderr));
          else resolve(stdout);
        });
      });
      expect(result).toBe('redirected document\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('leaves a filename after bare wrap and prefers it over an unfinished pipe', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-cli-file-'));
    const file = path.join(directory, 'README.md');
    await writeFile(file, 'file document wins');
    try {
      const result = await runCli(['--wrap', file], path.join(directory, 'missing.yml'), 'ignored pipe', false);
      expect(result).toEqual({ code: 0, stdout: 'file document wins\n', stderr: '' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('prefers an explicit URL over an unfinished pipe', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-cli-url-'));
    const server = http.createServer((_request, response) => response.end('URL document wins'));
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
      const result = await runCli([`http://127.0.0.1:${address.port}/document`],
        path.join(directory, 'missing.yml'), 'ignored pipe', false);
      expect(result).toEqual({ code: 0, stdout: 'URL document wins\n', stderr: '' });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    [['--unknown'], 'Unknown flag: --unknown'],
    [['--wrap=maybe'], 'Invalid value for --wrap'],
    [['--wrap='], 'Invalid value for --wrap'],
  ])('still rejects invalid arguments %j', async (args, message) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-cli-errors-'));
    try {
      const result = await runCli(args as string[], path.join(directory, 'missing.yml'), 'ignored');
      expect(result.code).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(message);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
