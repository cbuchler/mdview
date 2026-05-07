import { renderMarkdownDocument, renderDocumentAsPlainText } from './markdown.js';
import { resolveTheme } from './theme.js';
import type { AppConfig } from './types.js';

export function renderPlainText(markdown: string, sourceName: string, config: Pick<AppConfig, 'theme' | 'syntaxTheme' | 'wrap' | 'padding'>, width: number): string {
  const document = renderMarkdownDocument(markdown, {
    width,
    theme: resolveTheme(config.theme),
    wrap: config.wrap,
    padding: config.padding,
    syntaxTheme: resolveTheme(config.syntaxTheme),
    sourceName,
  });
  return renderDocumentAsPlainText(document);
}
