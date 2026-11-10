import { resolveTheme } from './theme.js'
import { renderDocumentAsPlainText } from './render-text.js'
import { RenderSupervisor } from './render-supervisor.js'
import type { AppConfig, RenderedDocument } from './types.js'

export async function renderPlainText(markdown: string, sourceName: string, config: Pick<AppConfig, 'theme' | 'syntaxTheme' | 'wrap' | 'padding' | 'maxInputBytes'>, width: number, renderer: RenderSupervisor, onDocument?: (document: RenderedDocument) => void): Promise<string> {
  const document = await renderer.render(markdown, {
    width,
    theme: resolveTheme(config.theme).name,
    wrap: config.wrap,
    padding: config.padding,
    syntaxTheme: resolveTheme(config.syntaxTheme).name,
    sourceName,
  }, config.maxInputBytes)
  onDocument?.(document)
  return renderDocumentAsPlainText(document)
}
