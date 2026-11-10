#!/usr/bin/env node
import React from 'react'
import { initConfigFile, loadConfig, parseCliArgs, printConfigTemplate, printHelp } from './config.js'
import { App } from './app.js'
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

  if (!cli.input && process.stdin.isTTY) {
    process.stderr.write(`${printHelp()}\n`)
    process.exitCode = 1
    return
  }

  const config = await loadConfig(cli)
  const source = resolveSource(cli.input)

  // An explicit '-' with terminal stdin is canonical document input until EOF.
  const keyboard = process.stdout.isTTY && !(source.kind === 'stdin' && process.stdin.isTTY)
    ? acquireKeyboardInput()
    : undefined

  const renderer = new RenderSupervisor()
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
      const result = await loadSource(source, {
        timeoutMs: config.timeoutMs,
        maxInputBytes: config.maxInputBytes,
      })
      const plain = await renderPlainText(result.text, result.displayName, config, process.stdout.columns ?? 80, renderer)
      process.stdout.write(`${plain}\n`)
      if (result.warning) process.stderr.write(`${sanitizeDisplayText(result.warning)}\n`)
      return
    }

    await runTerminalApp(React.createElement(App, { source, config, renderer }), keyboard, () => {
      // Stop only our document read when q arrives before the producer reaches EOF.
      if (source.kind === 'stdin' && !process.stdin.isTTY && !process.stdin.destroyed) {
        process.stdin.destroy()
      }
    }, undefined, interruption.signal)
  } catch (error) {
    if (!receivedSignal) throw error
    process.exitCode = signalStatus()
  } finally {
    for (const { signal, handler } of signalHandlers) process.off(signal, handler)
    await renderer.dispose()
  }
}

const run = process.argv[2] === '--internal-render-worker'
  ? import('./render-worker.js').then(({ runRenderWorker }) => runRenderWorker())
  : main()

run.catch((error) => {
  process.stderr.write(`${formatCliError(error)}\n`)
  process.exitCode = 1
})
