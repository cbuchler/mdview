import { sanitizeDisplayText } from './utils.js';

export function formatCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cleanMessage = sanitizeDisplayText(message);
  const usageHint = 'Run `mdview --help` for usage.';

  if (isUsageLikeError(cleanMessage)) {
    return `Error: ${cleanMessage}\n${usageHint}`;
  }

  return `Error: ${cleanMessage}`;
}

function isUsageLikeError(message: string): boolean {
  return (
    message.startsWith('Unknown flag:') ||
    message.startsWith('Missing value for') ||
    message.startsWith('Invalid value for') ||
    message.startsWith('Cannot combine') ||
    message.startsWith('Config error in') ||
    message.startsWith('Invalid YAML in') ||
    message.startsWith('Unknown theme for')
  );
}
