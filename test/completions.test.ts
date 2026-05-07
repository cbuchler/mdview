import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(process.cwd());

describe('shell completions', () => {
  it('include the current cli flags and themes', async () => {
    const bash = await readFile(path.join(repoRoot, 'completions', 'bash', 'mdview'), 'utf8');
    const zsh = await readFile(path.join(repoRoot, 'completions', 'zsh', '_mdview'), 'utf8');
    const fish = await readFile(path.join(repoRoot, 'completions', 'fish', 'mdview.fish'), 'utf8');

    expect(bash).toContain('tempus-rift');
    expect(bash).toContain('--print-config');
    expect(bash).toContain('--init-config');
    expect(bash).toContain('--version');

    expect(zsh).toContain('tempus-rift');
    expect(zsh).toContain('--print-config');
    expect(zsh).toContain('--init-config');
    expect(zsh).toContain('--version');

    expect(fish).toContain('tempus-rift');
    expect(fish).toContain('-l print-config');
    expect(fish).toContain('-l init-config');
    expect(fish).toContain('-l version');
  });
});
