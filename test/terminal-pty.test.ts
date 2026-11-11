import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, it } from 'vitest';

it.skipIf(process.platform !== 'linux')('separates real document stdin and controlling-terminal keyboard input through the CLI', () => {
  const child = spawnSync('python3', [
    path.join(import.meta.dirname, 'fixtures/terminal-pty.py'),
    path.resolve(import.meta.dirname, '..'), process.execPath,
  ], {
    // Each Node and Bun session now starts an OS sandbox; keep per-interaction deadlines in the fixture.
    encoding: 'utf8', timeout: 90_000, maxBuffer: 1_000_000,
  });
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  const cases = JSON.parse(child.stdout) as Array<{ case: string }>;
  expect(cases.length).toBeGreaterThanOrEqual(15);
  expect(cases.some((entry) => entry.case === 'q before producer EOF')).toBe(true);
}, 95_000)
