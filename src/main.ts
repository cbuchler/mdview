#!/usr/bin/env node
import React from 'react'
import { initConfigFile, loadConfig, parseCliArgs, printConfigTemplate, printHelp } from './config.js'
import { Navigation } from './navigation.js'
import { HistoryStore, historyIdentity } from './history.js'
import { resolveSource, loadSource } from './source.js'
import { renderPlainText } from './plain.js'
import { sanitizeDisplayText } from './utils.js'
import { VERSION } from './version.js'
import { formatCliError } from './errors.js'
import { acquireKeyboardInput, runTerminalApp } from './terminal.js'
import { RenderSupervisor } from './render-supervisor.js'

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2))
  if (cli.help) {
    process.stdout.write(`${printHelp()}\n`)
    return
  }
  if (cli.version) {
    process.stdout.write(`${VERSION}\n`)
    return
  }
  if (cli.printConfig && cli.initConfig) {
    throw new Error('Cannot combine --print-config and --init-config.')
  }
  if (cli.printConfig) {
    process.stdout.write(`${printConfigTemplate()}\n`)
    return
  }
  if (cli.initConfig) {
    const createdPath = await initConfigFile(cli.configPath)
    process.stdout.write(`Created config file at ${createdPath}\n`)
    return
  }

  if (cli.history && (cli.input || cli.noHistory)) throw new Error('--history cannot be combined with an input or --no-history.')
  const showHistory = Boolean(cli.history || (!cli.input && process.stdin.isTTY))
  if (showHistory && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('--history needs terminal input and output.')
  const config = await loadConfig(cli)
  const source = showHistory ? undefined : resolveSource(cli.input)
  const history = cli.noHistory ? undefined : new HistoryStore()

  // An explicit '-' with terminal stdin is canonical document input until EOF.
  const keyboard = process.stdout.isTTY && !(source?.kind === 'stdin' && process.stdin.isTTY)
    ? acquireKeyboardInput()
    : undefined

  const renderer = new RenderSupervisor({ sandbox: !cli.noSandbox })
  const interruption = new AbortController()
  let receivedSignal: NodeJS.Signals | undefined
  const signalStatus = () => receivedSignal === 'SIGINT' ? 130 : receivedSignal === 'SIGHUP' ? 129 : 143
  const terminate = (signal: NodeJS.Signals) => {
    if (receivedSignal) return
    receivedSignal = signal
    interruption.abort()
    renderer.cancel()
    if (!keyboard) void renderer.dispose().finally(() => process.exit(signalStatus()))
  }
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
  const signalHandlers = signals.map((signal) => ({ signal, handler: () => terminate(signal) }))
  // Ink's signal-exit hook must still see our handler during signal delivery.
  for (const { signal, handler } of signalHandlers) process.on(signal, handler)
  try {
    if (!keyboard) {
      if (!source) throw new Error('History needs a usable terminal keyboard.')
      const result = await loadSource(source, {
        timeoutMs: config.timeoutMs,
        maxInputBytes: config.maxInputBytes,
      })
      let title = result.displayName
      const plain = await renderPlainText(result.text, result.displayName, config, process.stdout.columns ?? 80, renderer, (document) => { title = document.title })
      process.stdout.write(`${plain}\n`)
      if (result.warning) process.stderr.write(`${sanitizeDisplayText(result.warning)}\n`)
      if (history) {
        try {
          const identity = await historyIdentity(source)
          if (identity) await history.remember({ ...identity, title, openedAt: Date.now() })
        } catch (error) { process.stderr.write(`${formatCliError(error)}\n`) }
      }
      return
    }

    await runTerminalApp(React.createElement(Navigation, { source, config, renderer, history }), keyboard, () => {
      // Stop only our document read when q arrives before the producer reaches EOF.
      if (source?.kind === 'stdin' && !process.stdin.isTTY && !process.stdin.destroyed) {
        process.stdin.destroy()
      }
    }, undefined, interruption.signal)
  } catch (error) {
    if (!receivedSignal) throw error
    process.exitCode = signalStatus()
  } finally {
    for (const { signal, handler } of signalHandlers) process.off(signal, handler)
    await renderer.dispose()
    try { await history?.flush() } catch (error) { process.stderr.write(`${formatCliError(error)}\n`) }
  }
}

const run = process.argv[2] === '--internal-render-worker'
  ? import('./render-worker.js').then(({ runRenderWorker }) => runRenderWorker())
  : main()

run.catch((error) => {
  process.stderr.write(`${formatCliError(error)}\n`)
  process.exitCode = 1
})
