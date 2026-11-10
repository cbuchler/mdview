export type SourceKind = 'file' | 'stdin' | 'url';

export type ThemeName = 'github' | 'dracula' | 'solarized' | 'tempus-rift' | 'midnight' | 'paper';

export interface CliOptions {
  input?: string;
  theme?: ThemeName;
  syntaxTheme?: ThemeName;
  wrap?: boolean;
  padding?: number;
  refreshIntervalMs?: number;
  timeoutMs?: number;
  maxInputBytes?: number;
  watch?: boolean;
  configPath?: string;
  history?: boolean
  noHistory?: boolean
  help?: boolean;
  version?: boolean;
  printConfig?: boolean;
  initConfig?: boolean;
}

export interface AppConfig {
  theme: ThemeName;
  syntaxTheme: ThemeName;
  wrap: boolean;
  padding: number;
  refreshIntervalMs: number;
  timeoutMs: number;
  maxInputBytes: number;
  watch: boolean;
}

export interface ResolvedSource {
  kind: SourceKind;
  input: string;
  displayName: string;
  canWatch: boolean;
}

export interface LoadResult {
  text: string;
  displayName: string;
  warning?: string;
  /** Source bytes admitted before sanitization; excludes the truncation lookahead. */
  bytesRead: number;
}

export interface RenderSegmentStyle {
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dimColor?: boolean;
}

export interface RenderSegment {
  text: string;
  style?: RenderSegmentStyle;
}

export type RenderLine = RenderSegment[];

export interface SourceBlock {
  start: number
  end: number
  kind: string
  fingerprint: string
  headingPath: string[]
}

export interface SourceLocation {
  block: number
  offset: number
}

export interface ReadingAnchor {
  version: 1
  block: SourceBlock
  offset: number
  before?: string
  after?: string
}

export interface RenderedDocument {
  blocks: SourceBlock[]
  lineSources: (SourceLocation | undefined)[]
  title: string;
  lines: RenderLine[];
  parseMs: number;
  lineCount: number;
}
