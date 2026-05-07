import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { AppConfig, CliOptions } from './types.js';
import { parseBoolean, parseBytes, parseDurationMs } from './utils.js';
import { listThemeNames, parseThemeName } from './theme.js';
import YAML from 'yaml';

export const DEFAULT_CONFIG: AppConfig = {
  theme: 'tempus-rift',
  syntaxTheme: 'dracula',
  wrap: true,
  padding: 1,
  refreshIntervalMs: 150,
  timeoutMs: 8000,
  maxInputBytes: 2_097_152,
  watch: true,
};

export function defaultConfigPath(): string {
  return path.join(os.homedir(), '.config', 'mdview', 'config.yml');
}

export function defaultConfigPaths(): string[] {
  return [
    path.join(os.homedir(), '.config', 'mdview', 'config.yml'),
    path.join(os.homedir(), '.config', 'mdview', 'config.yaml'),
  ];
}

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }

    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    const takeValue = (): string => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }
      index += 1;
      if (index >= argv.length) {
        throw new Error(`Missing value for ${flag}`);
      }
      return argv[index];
    };

    switch (flag) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--version':
        options.version = true;
        break;
      case '--print-config':
        options.printConfig = true;
        break;
      case '--init-config':
        options.initConfig = true;
        break;
      case '--theme':
        options.theme = parseThemeOption(takeValue(), flag);
        break;
      case '--syntax-theme':
        options.syntaxTheme = parseThemeOption(takeValue(), flag);
        break;
      case '--refresh':
      case '--refresh-interval':
        options.refreshIntervalMs = parseDurationOption(takeValue(), flag);
        break;
      case '--timeout':
        options.timeoutMs = parseDurationOption(takeValue(), flag);
        break;
      case '--max-bytes':
        options.maxInputBytes = parseBytesOption(takeValue(), flag);
        break;
      case '--padding':
        options.padding = parseIntegerOption(takeValue(), flag, 0, 100);
        break;
      case '--wrap':
        options.wrap = parseBooleanOption(takeValue(), flag);
        break;
      case '--no-wrap':
        options.wrap = false;
        break;
      case '--watch':
        options.watch = true;
        break;
      case '--no-watch':
        options.watch = false;
        break;
      case '--config':
        options.configPath = takeValue();
        break;
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }

  if (positionals.length > 0) {
    options.input = positionals[0];
  }

  return options;
}

function readConfigValue<T>(value: unknown, fallback: T): T {
  return value === undefined ? fallback : (value as T);
}

export async function loadConfig(cli: CliOptions): Promise<AppConfig> {
  const configPath = cli.configPath ?? defaultConfigPath();
  const fileConfig = await readConfigFile(configPath);
  const merged: AppConfig = {
    theme: readConfigValue(fileConfig.theme, DEFAULT_CONFIG.theme),
    syntaxTheme: readConfigValue(fileConfig.syntaxTheme, DEFAULT_CONFIG.syntaxTheme),
    wrap: readConfigValue(fileConfig.wrap, DEFAULT_CONFIG.wrap),
    padding: readConfigValue(fileConfig.padding, DEFAULT_CONFIG.padding),
    refreshIntervalMs: readConfigValue(fileConfig.refreshIntervalMs, DEFAULT_CONFIG.refreshIntervalMs),
    timeoutMs: readConfigValue(fileConfig.timeoutMs, DEFAULT_CONFIG.timeoutMs),
    maxInputBytes: readConfigValue(fileConfig.maxInputBytes, DEFAULT_CONFIG.maxInputBytes),
    watch: readConfigValue(fileConfig.watch, DEFAULT_CONFIG.watch),
  };

  return {
    ...DEFAULT_CONFIG,
    ...merged,
    ...omitUndefined(cli),
    wrap: cli.wrap ?? merged.wrap,
    theme: cli.theme ?? merged.theme,
    syntaxTheme: cli.syntaxTheme ?? merged.syntaxTheme,
    padding: cli.padding ?? merged.padding,
    refreshIntervalMs: cli.refreshIntervalMs ?? merged.refreshIntervalMs,
    timeoutMs: cli.timeoutMs ?? merged.timeoutMs,
    maxInputBytes: cli.maxInputBytes ?? merged.maxInputBytes,
    watch: cli.watch ?? merged.watch,
  };
}

function omitUndefined(cli: CliOptions): Partial<AppConfig> {
  const result: Partial<AppConfig> = {};
  if (cli.theme) {
    result.theme = cli.theme;
  }
  if (cli.syntaxTheme) {
    result.syntaxTheme = cli.syntaxTheme;
  }
  if (cli.wrap !== undefined) {
    result.wrap = cli.wrap;
  }
  if (cli.padding !== undefined) {
    result.padding = cli.padding;
  }
  if (cli.refreshIntervalMs !== undefined) {
    result.refreshIntervalMs = cli.refreshIntervalMs;
  }
  if (cli.timeoutMs !== undefined) {
    result.timeoutMs = cli.timeoutMs;
  }
  if (cli.maxInputBytes !== undefined) {
    result.maxInputBytes = cli.maxInputBytes;
  }
  if (cli.watch !== undefined) {
    result.watch = cli.watch;
  }
  return result;
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number: ${value}`);
  }
  return parsed;
}

async function readConfigFile(configPath: string): Promise<Partial<AppConfig>> {
  const candidate = await readExistingConfigPath(configPath);
  if (!candidate) {
    return {};
  }

  const raw = await readFile(candidate, 'utf8');
  const parsed = parseYamlConfig(candidate, raw);
  return validateConfigShape(candidate, parsed);
}

export function printHelp(): string {
  return [
    'Usage:',
    '  mdview [path|url]',
    '  cat README.md | mdview',
    '',
    'Input detection:',
    '  - stdin when data is piped in',
    '  - URL when the argument starts with http:// or https://',
    '  - file path otherwise',
    '',
    'Options:',
    '  --theme <name>',
    '  --syntax-theme <name>',
    '  --refresh <ms|1s|1m>',
    '  --timeout <ms|1s|1m>',
    '  --max-bytes <bytes|1mb|2mb>',
    '  --padding <number>',
    '  --wrap / --no-wrap',
    '  --watch / --no-watch',
    '  --config <path>',
    '  --print-config',
    '  --init-config',
    '  -h, --help',
    '  --version',
    '',
    'Config: ~/.config/mdview/config.yml',
    `Themes: ${listThemeNames().join(', ')}`,
    '',
    'Examples:',
    '  mdview README.md',
    '  mdview https://example.com/readme.md',
    '  mdview README.md --theme tempus-rift --refresh 150ms',
    '  mdview --print-config',
    '  mdview --init-config',
  ].join('\n');
}

export function printConfigTemplate(): string {
  return buildConfigTemplate();
}

export async function initConfigFile(targetPath = defaultConfigPath()): Promise<string> {
  const candidate = await readExistingConfigPath(targetPath);
  if (candidate) {
    throw new Error(`Config file already exists: ${candidate}`);
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await writeFile(targetPath, `${buildConfigTemplate()}\n`, { flag: 'wx', encoding: 'utf8' });
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Config file already exists: ${targetPath}`);
    }
    throw error;
  }
  return targetPath;
}

function buildConfigTemplate(): string {
  return [
    '# mdview configuration',
    `# Default config path: ${defaultConfigPath()}`,
    '',
    '# Visual theme for the viewer and status bars.',
    `theme: ${DEFAULT_CONFIG.theme}`,
    '',
    '# Theme used for code blocks and other syntax-adjacent surfaces.',
    `syntaxTheme: ${DEFAULT_CONFIG.syntaxTheme}`,
    '',
    '# Whether lines wrap in the viewport.',
    `wrap: ${DEFAULT_CONFIG.wrap}`,
    '',
    '# Horizontal padding around rendered content.',
    `padding: ${DEFAULT_CONFIG.padding}`,
    '',
    '# File watch debounce in milliseconds.',
    `refreshIntervalMs: ${DEFAULT_CONFIG.refreshIntervalMs}`,
    '',
    '# Network timeout in milliseconds for URL input.',
    `timeoutMs: ${DEFAULT_CONFIG.timeoutMs}`,
    '',
    '# Maximum bytes to load before truncating.',
    `maxInputBytes: ${DEFAULT_CONFIG.maxInputBytes}`,
    '',
    '# Enable live reload for local files.',
    `watch: ${DEFAULT_CONFIG.watch}`,
    '',
    `# Supported themes: ${listThemeNames().join(', ')}`,
  ].join('\n');
}

const ALLOWED_CONFIG_KEYS = new Set([
  'theme',
  'syntaxTheme',
  'wrap',
  'padding',
  'refreshIntervalMs',
  'timeoutMs',
  'maxInputBytes',
  'watch',
]);

function readExistingConfigPath(configPath: string): Promise<string | undefined> {
  if (existsSync(configPath)) {
    return Promise.resolve(configPath);
  }

  if (configPath.endsWith('.yml')) {
    const yamlPath = configPath.replace(/\.yml$/, '.yaml');
    if (existsSync(yamlPath)) {
      return Promise.resolve(yamlPath);
    }
  } else if (configPath.endsWith('.yaml')) {
    const ymlPath = configPath.replace(/\.yaml$/, '.yml');
    if (existsSync(ymlPath)) {
      return Promise.resolve(ymlPath);
    }
  }

  return Promise.resolve(undefined);
}

function parseYamlConfig(configPath: string, raw: string): unknown {
  try {
    return YAML.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid YAML in ${configPath}: ${message}`);
  }
}

function validateConfigShape(configPath: string, value: unknown): Partial<AppConfig> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Config error in ${configPath}: expected a YAML mapping`);
  }

  const raw = value as Record<string, unknown>;
  const config: Partial<AppConfig> = {};
  const errors: string[] = [];

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_CONFIG_KEYS.has(key)) {
      errors.push(`unknown key ${key}`);
    }
  }

  if (raw.theme !== undefined) {
    collectConfigValue('theme', () => parseThemeConfigValue(raw.theme, configPath, 'theme'), configPath, errors, (value) => {
      config.theme = value;
    });
  }
  if (raw.syntaxTheme !== undefined) {
    collectConfigValue('syntaxTheme', () => parseThemeConfigValue(raw.syntaxTheme, configPath, 'syntaxTheme'), configPath, errors, (value) => {
      config.syntaxTheme = value;
    });
  }
  if (raw.wrap !== undefined) {
    collectConfigValue('wrap', () => assertBoolean(raw.wrap, configPath, 'wrap'), configPath, errors, (value) => {
      config.wrap = value;
    });
  }
  if (raw.padding !== undefined) {
    collectConfigValue('padding', () => assertInteger(raw.padding, configPath, 'padding', 0, 100), configPath, errors, (value) => {
      config.padding = value;
    });
  }
  if (raw.refreshIntervalMs !== undefined) {
    collectConfigValue('refreshIntervalMs', () => assertInteger(raw.refreshIntervalMs, configPath, 'refreshIntervalMs', 0, 24 * 60 * 60 * 1000), configPath, errors, (value) => {
      config.refreshIntervalMs = value;
    });
  }
  if (raw.timeoutMs !== undefined) {
    collectConfigValue('timeoutMs', () => assertInteger(raw.timeoutMs, configPath, 'timeoutMs', 1, 24 * 60 * 60 * 1000), configPath, errors, (value) => {
      config.timeoutMs = value;
    });
  }
  if (raw.maxInputBytes !== undefined) {
    collectConfigValue('maxInputBytes', () => assertInteger(raw.maxInputBytes, configPath, 'maxInputBytes', 1, Number.MAX_SAFE_INTEGER), configPath, errors, (value) => {
      config.maxInputBytes = value;
    });
  }
  if (raw.watch !== undefined) {
    collectConfigValue('watch', () => assertBoolean(raw.watch, configPath, 'watch'), configPath, errors, (value) => {
      config.watch = value;
    });
  }

  if (errors.length > 0) {
    throw new Error(`Config error in ${configPath}:\n${errors.map((entry) => `- ${entry}`).join('\n')}`);
  }

  return config;
}

function assertString(value: unknown, configPath: string, key: string): string {
  if (typeof value !== 'string') {
    throw configError(configPath, key, 'expected a string');
  }
  return value;
}

function assertBoolean(value: unknown, configPath: string, key: string): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    try {
      return parseBoolean(value) as boolean;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw configError(configPath, key, `expected a boolean (${message})`);
    }
  }
  throw configError(configPath, key, 'expected a boolean');
}

function assertInteger(value: unknown, configPath: string, key: string, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw configError(configPath, key, `expected an integer between ${min} and ${max}`);
  }
  return parsed;
}

function parseThemeOption(value: string, flag: string): AppConfig['theme'] {
  try {
    return parseThemeName(value, flag);
  } catch (error) {
    throw contextualOptionError(flag, value, error);
  }
}

function parseDurationOption(value: string, flag: string): number {
  try {
    const parsed = parseDurationMs(value);
    if (parsed === undefined) {
      throw new Error('missing value');
    }
    return parsed;
  } catch (error) {
    throw contextualOptionError(flag, value, error);
  }
}

function parseBytesOption(value: string, flag: string): number {
  try {
    const parsed = parseBytes(value);
    if (parsed === undefined) {
      throw new Error('missing value');
    }
    return parsed;
  } catch (error) {
    throw contextualOptionError(flag, value, error);
  }
}

function parseBooleanOption(value: string, flag: string): boolean {
  try {
    return parseBoolean(value) as boolean;
  } catch (error) {
    throw contextualOptionError(flag, value, error);
  }
}

function parseIntegerOption(value: string, flag: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid value for ${flag}: ${value}. Expected an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function parseThemeConfigValue(value: unknown, configPath: string, key: string): AppConfig['theme'] {
  if (typeof value !== 'string') {
    throw configError(configPath, key, 'expected a string');
  }

  try {
    return parseThemeName(value, key);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw configError(configPath, key, message.replace(/^Unknown theme for [^:]+:\s*/, 'unknown theme: '));
  }
}

function contextualOptionError(flag: string, value: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Invalid value for ${flag}: ${value}. ${message}`);
}

function configError(configPath: string, key: string, detail: string): Error {
  return new Error(`Config error in ${configPath}: ${key} ${detail}`);
}

function collectConfigValue<T>(
  key: string,
  thunk: () => T,
  configPath: string,
  errors: string[],
  assign: (value: T) => void,
): void {
  try {
    assign(thunk());
  } catch (error) {
    const detail = extractConfigDetail(error, configPath, key);
    errors.push(`${key}: ${detail}`);
  }
}

function extractConfigDetail(error: unknown, configPath: string, key: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const prefix = `Config error in ${configPath}: `;
  const stripped = message.startsWith(prefix) ? message.slice(prefix.length) : message;
  const keyPrefix = `${key} `;
  return stripped.startsWith(keyPrefix) ? stripped.slice(keyPrefix.length) : stripped;
}
