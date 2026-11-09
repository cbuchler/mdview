import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os';
import { existsSync } from 'node:fs'
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..');

describe('shell completions', () => {
  const available = (shell: string) => (process.env.PATH ?? '').split(path.delimiter)
    .some((directory) => existsSync(path.join(directory, shell)))

  it.skipIf(!available('zsh'))('completes files and flags after bare wrap in a real Zsh editor', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-zsh-completion-'))
    try {
      await writeFile(path.join(directory, 'README.md'), 'fixture')
      const output = execFileSync('zsh', ['-df', path.join(repoRoot, 'test/fixtures/zsh-completion.zsh')], {
        env: { ...process.env, MDVIEW_COMPLETIONS: path.join(repoRoot, 'completions/zsh'), MDVIEW_FIXTURE: directory },
        encoding: 'utf8', timeout: 5000, maxBuffer: 32_768,
      })
      expect(output).toContain('RESULT:mdview --wrap README.md')
      expect(output).toContain('RESULT:mdview --wrap --theme=')
      expect(output).toContain('RESULT:mdview --config README.md')
      expect(output).toContain('RESULT:mdview --theme dracula')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }, 7000)

  it.skipIf(!available('fish'))('completes optional wrap and required arguments in Fish', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-fish-completion-'))
    try {
      await writeFile(path.join(directory, 'README.md'), 'fixture')
      const complete = (query: string) => execFileSync('fish', [
        '--no-config', '-c', 'complete --erase --command mdview; source "$argv[1]"; cd "$argv[2]"; complete --do-complete "$argv[3]"',
        path.join(repoRoot, 'completions/fish/mdview.fish'), directory, query,
      ], { encoding: 'utf8', timeout: 3000, maxBuffer: 16_384 })
        .trim().split('\n').map((line) => line.split('\t')[0])
      expect(complete('mdview --wrap READ')).toContain('README.md')
      expect(complete('mdview --wrap --th')).toContain('--theme')
      expect(complete('mdview --config READ')).toContain('README.md')
      expect(complete('mdview --theme dra')).toContain('dracula')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
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
