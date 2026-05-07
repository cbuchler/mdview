import type { ThemeName } from './types.js';

export interface Theme {
  name: ThemeName;
  foreground: string;
  muted: string;
  accent: string;
  heading: string;
  quote: string;
  codeForeground: string;
  codeBackground: string;
  border: string;
  warning: string;
  error: string;
  link: string;
}

export const THEMES: Record<ThemeName, Theme> = {
  github: {
    name: 'github',
    foreground: '#24292f',
    muted: '#57606a',
    accent: '#0969da',
    heading: '#1f2328',
    quote: '#6e7781',
    codeForeground: '#24292f',
    codeBackground: '#f6f8fa',
    border: '#d0d7de',
    warning: '#9a6700',
    error: '#cf222e',
    link: '#0969da',
  },
  dracula: {
    name: 'dracula',
    foreground: '#f8f8f2',
    muted: '#bfbfbf',
    accent: '#bd93f9',
    heading: '#f8f8f2',
    quote: '#6272a4',
    codeForeground: '#f8f8f2',
    codeBackground: '#282a36',
    border: '#44475a',
    warning: '#f1fa8c',
    error: '#ff5555',
    link: '#8be9fd',
  },
  solarized: {
    name: 'solarized',
    foreground: '#839496',
    muted: '#657b83',
    accent: '#268bd2',
    heading: '#073642',
    quote: '#586e75',
    codeForeground: '#eee8d5',
    codeBackground: '#073642',
    border: '#93a1a1',
    warning: '#b58900',
    error: '#dc322f',
    link: '#268bd2',
  },
  'tempus-rift': {
    name: 'tempus-rift',
    foreground: '#f4efe8',
    muted: '#b7aa9c',
    accent: '#7fd1b9',
    heading: '#fdf6e3',
    quote: '#9aa7b1',
    codeForeground: '#f4efe8',
    codeBackground: '#1c1f2b',
    border: '#44506a',
    warning: '#ffd166',
    error: '#ff6b6b',
    link: '#89dceb',
  },
  midnight: {
    name: 'midnight',
    foreground: '#dde7f2',
    muted: '#8ca1b3',
    accent: '#7c9cff',
    heading: '#f5f7ff',
    quote: '#6f7f95',
    codeForeground: '#e8eef7',
    codeBackground: '#111827',
    border: '#273244',
    warning: '#f4b860',
    error: '#ff7b7b',
    link: '#8bd3ff',
  },
  paper: {
    name: 'paper',
    foreground: '#2b2623',
    muted: '#6e625a',
    accent: '#8b5e3c',
    heading: '#1f1a17',
    quote: '#7a6c61',
    codeForeground: '#2b2623',
    codeBackground: '#f4ede4',
    border: '#d6c8ba',
    warning: '#9a6a2f',
    error: '#b63d2d',
    link: '#a14f2d',
  },
};

const THEME_ALIASES: Record<string, ThemeName> = {
  'tempus rift': 'tempus-rift',
  tempusrift: 'tempus-rift',
};

const THEME_NAMES: ThemeName[] = ['github', 'dracula', 'solarized', 'tempus-rift', 'midnight', 'paper'];

export function normalizeThemeName(value: string | undefined): ThemeName {
  if (!value) {
    return 'github';
  }

  const normalized = value.trim().toLowerCase();
  return (THEME_ALIASES[normalized] ?? normalized) as ThemeName;
}

export function resolveTheme(name: string | ThemeName): Theme {
  const normalized = normalizeThemeName(name);
  return THEMES[normalized] ?? THEMES.github;
}

export function listThemeNames(): ThemeName[] {
  return [...THEME_NAMES];
}

export function parseThemeName(value: string, optionLabel = '--theme'): ThemeName {
  const normalized = normalizeThemeName(value);
  if (normalized in THEMES) {
    return normalized as ThemeName;
  }

  throw new Error(`Unknown theme for ${optionLabel}: ${value}. Available themes: ${THEME_NAMES.join(', ')}`);
}
