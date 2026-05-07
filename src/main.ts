#!/usr/bin/env node
import { render } from 'ink';
import React from 'react';
import { initConfigFile, loadConfig, parseCliArgs, printConfigTemplate, printHelp } from './config.js';
import { App } from './app.js';
import { resolveSource, loadSource } from './source.js';
import { renderPlainText } from './plain.js';
import { sanitizeDisplayText } from './utils.js';
import { VERSION } from './version.js';
import { formatCliError } from './errors.js';

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.help) {
    process.stdout.write(`${printHelp()}\n`);
    return;
  }
  if (cli.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (cli.printConfig && cli.initConfig) {
    throw new Error('Cannot combine --print-config and --init-config.');
  }
  if (cli.printConfig) {
    process.stdout.write(`${printConfigTemplate()}\n`);
    return;
  }
  if (cli.initConfig) {
    const createdPath = await initConfigFile(cli.configPath);
    process.stdout.write(`Created config file at ${createdPath}\n`);
    return;
  }

  if (!cli.input && process.stdin.isTTY) {
    process.stderr.write(`${printHelp()}\n`);
    process.exitCode = 1;
    return;
  }

  const config = await loadConfig(cli);
  const source = resolveSource(cli.input);

  if (!process.stdout.isTTY) {
    const result = await loadSource(source, {
      timeoutMs: config.timeoutMs,
      maxInputBytes: config.maxInputBytes,
    });
    const plain = renderPlainText(result.text, result.displayName, config, process.stdout.columns ?? 80);
    process.stdout.write(`${plain}\n`);
    if (result.warning) {
      process.stderr.write(`${sanitizeDisplayText(result.warning)}\n`);
    }
    return;
  }

  render(React.createElement(App, { source, config }), {
    exitOnCtrlC: false,
  });
}

main().catch((error) => {
  process.stderr.write(`${formatCliError(error)}\n`);
  process.exitCode = 1;
});
