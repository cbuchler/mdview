import stringWidth from 'string-width';

const graphemeSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function stripControlChars(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

export function sanitizeMarkdownText(input: string): string {
  return stripControlChars(input);
}

export function sanitizeDisplayText(input: string): string {
  return stripControlChars(input);
}

export function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}`);
}

export function parseDurationMs(value: string | number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  const trimmed = String(value).trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const match = /^(\d+(?:\.\d+)?)(ms|s|m)$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid duration: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === 'ms') {
    return Math.round(amount);
  }
  if (unit === 's') {
    return Math.round(amount * 1000);
  }
  return Math.round(amount * 60_000);
}

export function parseBytes(value: string | number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  const trimmed = String(value).trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const match = /^(\d+(?:\.\d+)?)(b|kb|mb|gb)$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid size: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const factor = unit === 'b' ? 1 : unit === 'kb' ? 1024 : unit === 'mb' ? 1024 ** 2 : 1024 ** 3;
  return Math.round(amount * factor);
}

export function graphemes(input: string): string[] {
  if (!input) {
    return [];
  }

  if (!graphemeSegmenter) {
    return Array.from(input);
  }

  return Array.from(graphemeSegmenter.segment(input), (segment) => segment.segment);
}

export function widthOf(input: string): number {
  return stringWidth(input);
}

export function splitWords(input: string): string[] {
  return input.match(/\s+|[^\s]+/g) ?? [];
}

export function repeatSpace(count: number): string {
  return count <= 0 ? '' : ' '.repeat(count);
}

export function truncateText(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, Math.max(0, maxLength - 1))}…`;
}
