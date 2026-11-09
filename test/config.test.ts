import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os';
import path from 'node:path';
import { initConfigFile, loadConfig, parseCliArgs, defaultConfigPath } from '../src/config.js'
import { listThemeNames, normalizeThemeName } from '../src/theme.js';

const directories: string[] = []

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-config-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('parseCliArgs', () => {
  it('parses flags and positionals', () => {
    const args = parseCliArgs(['README.md', '--theme', 'dracula', '--refresh', '200ms', '--wrap', 'false']);
    expect(args.input).toBe('README.md');
    expect(args.theme).toBe('dracula');
    expect(args.refreshIntervalMs).toBe(200);
    expect(args.wrap).toBe(false);
  });

  it('parses version', () => {
    const args = parseCliArgs(['--version']);
    expect(args.version).toBe(true);
  });

  it('parses print-config', () => {
    const args = parseCliArgs(['--print-config']);
    expect(args.printConfig).toBe(true);
  });

  it('parses init-config', () => {
    const args = parseCliArgs(['--init-config']);
    expect(args.initConfig).toBe(true);
  });

  it('rejects unknown themes with a clear message', () => {
    expect(() => parseCliArgs(['--theme', 'does-not-exist'])).toThrow(/Unknown theme for --theme/i);
  });

  it('rejects malformed values with flag context', () => {
    expect(() => parseCliArgs(['--wrap=maybe'])).toThrow(/Invalid value for --wrap/i);
    expect(() => parseCliArgs(['--wrap='])).toThrow(/Invalid value for --wrap/i);
    expect(() => parseCliArgs(['--padding', 'abc'])).toThrow(/Invalid value for --padding/i);
  });

  it.each([
    ['true', true], ['1', true], ['yes', true], ['on', true],
    ['false', false], ['0', false], ['no', false], ['off', false],
    ['  TrUe  ', true], ['  OFF  ', false],
  ] as const)('accepts inline and separated wrap boolean %j', (value, expected) => {
    expect(parseCliArgs([`--wrap=${value}`, 'README.md'])).toEqual({ wrap: expected, input: 'README.md' });
    expect(parseCliArgs(['--wrap', value, 'README.md'])).toEqual({ wrap: expected, input: 'README.md' });
  });

  it.each([
    [['--wrap'], { wrap: true }],
    [['--wrap', 'README.md'], { wrap: true, input: 'README.md' }],
    [['--wrap', 'maybe'], { wrap: true, input: 'maybe' }],
    [['--wrap', './false'], { wrap: true, input: './false' }],
    [['false', '--wrap'], { wrap: true, input: 'false' }],
    [['--wrap', '--theme', 'dracula'], { wrap: true, theme: 'dracula' }],
    [['--wrap', '--no-wrap'], { wrap: false }],
    [['--no-wrap', '--wrap'], { wrap: true }],
  ])('handles optional wrap values and repeated switches: %j', (argv, expected) => {
    expect(parseCliArgs(argv as string[])).toEqual(expected);
  });

  it.each([
    [['-'], { input: '-' }],
    [['-', '--theme', 'dracula'], { input: '-', theme: 'dracula' }],
    [['--no-wrap', '-'], { input: '-', wrap: false }],
    [['--wrap', '-'], { input: '-', wrap: true }],
  ])('accepts the explicit stdin sentinel among flags: %j', (argv, expected) => {
    expect(parseCliArgs(argv as string[])).toEqual(expected);
  });

  it('continues rejecting unknown options and requiring values for other flags', () => {
    expect(() => parseCliArgs(['--unknown'])).toThrow('Unknown flag: --unknown');
    expect(() => parseCliArgs(['--wrap', '--unknown'])).toThrow('Unknown flag: --unknown');
    expect(() => parseCliArgs(['--'])).toThrow('Unknown flag: --');
    expect(() => parseCliArgs(['--theme'])).toThrow('Missing value for --theme');
    expect(() => parseCliArgs(['--padding'])).toThrow('Missing value for --padding');
  });
});

describe('themes', () => {
  it('includes tempus rift and other built-ins', () => {
    expect(listThemeNames()).toContain('tempus-rift');
    expect(normalizeThemeName('tempus rift')).toBe('tempus-rift');
  });
});

describe('yaml config', () => {
  it('loads yaml config files and theme aliases', async () => {
    const dir = await temporaryDirectory()
    const configPath = path.join(dir, 'config.yml');
    await writeFile(
      configPath,
      [
        'theme: tempus rift',
        'syntaxTheme: dracula',
        'wrap: false',
        'padding: 3',
        'refreshIntervalMs: 250',
        'timeoutMs: 9000',
        'maxInputBytes: 12345',
        'watch: false',
      ].join('\n'),
      'utf8',
    );

    const config = await loadConfig({ configPath });
    expect(config.theme).toBe('tempus-rift');
    expect(config.syntaxTheme).toBe('dracula');
    expect(config.wrap).toBe(false);
    expect(config.padding).toBe(3);
    expect(config.refreshIntervalMs).toBe(250);
    expect(config.timeoutMs).toBe(9000);
    expect(config.maxInputBytes).toBe(12345);
    expect(config.watch).toBe(false);

    const overrides = await loadConfig({ configPath, padding: 0, refreshIntervalMs: 0, wrap: true, watch: true })
    expect(overrides).toMatchObject({ padding: 0, refreshIntervalMs: 0, wrap: true, watch: true, theme: 'tempus-rift', maxInputBytes: 12345 })
    await writeFile(configPath, 'wrap: true\nwatch: true\n')
    expect(await loadConfig({ configPath, wrap: false, watch: false })).toMatchObject({ wrap: false, watch: false })
  });

  it('uses config.yml as the default config path', () => {
    expect(defaultConfigPath().endsWith(path.join('.config', 'mdview', 'config.yml'))).toBe(true);
  });
});

describe('yaml validation', () => {
  it('falls back from a missing config.yml to config.yaml', async () => {
    const dir = await temporaryDirectory()
    const configPath = path.join(dir, 'config.yaml');
    await writeFile(
      configPath,
      [
        'theme: paper',
        'wrap: true',
      ].join('\n'),
      'utf8',
    );

    const config = await loadConfig({ configPath: path.join(dir, 'config.yml') })
    expect(config.theme).toBe('paper');
    expect(config.wrap).toBe(true);
  });

  it('fails with a clear error for invalid YAML values', async () => {
    const dir = await temporaryDirectory()
    const configPath = path.join(dir, 'config.yml');
    await writeFile(
      configPath,
      [
        'theme: nope',
        'wrap: maybe',
        'padding: nope',
      ].join('\n'),
      'utf8',
    );

    await expect(loadConfig({ configPath })).rejects.toThrow(/Config error in .*config\.yml/i);
    await expect(loadConfig({ configPath })).rejects.toThrow(/- theme:/i);
    await expect(loadConfig({ configPath })).rejects.toThrow(/- wrap:/i);
    await expect(loadConfig({ configPath })).rejects.toThrow(/- padding:/i);
  });

  it('rejects unknown config keys', async () => {
    const dir = await temporaryDirectory()
    const configPath = path.join(dir, 'config.yml');
    await writeFile(
      configPath,
      [
        'theme: github',
        'theem: dracula',
      ].join('\n'),
      'utf8',
    );

    await expect(loadConfig({ configPath })).rejects.toThrow(/unknown key theem/i);
  });
});

describe('config init', () => {
  it('writes a template config file once', async () => {
    const dir = await temporaryDirectory()
    const configPath = path.join(dir, 'config.yml');

    const createdPath = await initConfigFile(configPath);
    expect(createdPath).toBe(configPath);

    const contents = await readFile(configPath, 'utf8');
    expect(contents).toContain('mdview configuration');
    expect(contents).toContain('theme: tempus-rift');
    expect(contents).toContain('watch: true');
  });

  it('refuses to overwrite an existing config file', async () => {
    const dir = await temporaryDirectory()
    const configPath = path.join(dir, 'config.yml');
    await writeFile(configPath, 'theme: dracula\n', 'utf8');

    await expect(initConfigFile(configPath)).rejects.toThrow(/Config file already exists/i);
  });
});
