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

export interface RenderedDocument {
  title: string;
  lines: RenderLine[];
  parseMs: number;
  lineCount: number;
}
