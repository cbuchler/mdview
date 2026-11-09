import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..');

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

  it('keeps wrap optional while config and theme arguments remain required', async () => {
    const zsh = await readFile(path.join(repoRoot, 'completions', 'zsh', '_mdview'), 'utf8');
    const fish = await readFile(path.join(repoRoot, 'completions', 'fish', 'mdview.fish'), 'utf8');
    const fishWrap = fish.split('\n').find((line) => /-l wrap\b/.test(line));
    expect(fishWrap).toBeDefined();
    expect(fishWrap).not.toMatch(/\s-r(?:\s|$)/);
    expect(fish).toMatch(/-l config -r /);
    expect(fish).toMatch(/-l theme -r /);
    expect(zsh).toMatch(/'--wrap\[[^\]]*\]'\s*\\/);
    expect(zsh).toContain('--config=[config file path]:file:_files');
    expect(zsh).toContain('--theme=[select viewer theme]:theme:');
  });

  it('offers files and following flags after bare wrap in Bash', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-completion-'));
    await writeFile(path.join(directory, 'README.md'), 'fixture');
    const completion = path.join(repoRoot, 'completions', 'bash', 'mdview');
    try {
      const script = [
        'source "$1"', 'cd "$2"',
        'COMP_WORDS=(mdview --wrap "$3")', 'COMP_CWORD=2',
        '_mdview_complete', 'printf "%s\\n" "${COMPREPLY[@]}"',
      ].join('\n');
      const complete = (prefix: string) => execFileSync('bash', [
        '-c', script, 'mdview-completion-test', completion, directory, prefix,
      ], { encoding: 'utf8', timeout: 2000, maxBuffer: 16_384 }).trim().split('\n');
      expect(complete('READ')).toContain('README.md');
      expect(complete('--th')).toContain('--theme');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
