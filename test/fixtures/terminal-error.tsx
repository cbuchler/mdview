import React from 'react';
import { acquireKeyboardInput, runTerminalApp } from '../../src/terminal.js';

function InitialFailure(): React.JSX.Element {
  throw new Error('Injected initial mount failure');
}

const keyboard = acquireKeyboardInput();
if (!keyboard) throw new Error('Fixture requires a controlling terminal');
runTerminalApp(<InitialFailure />, keyboard).catch((error) => {
  process.stderr.write(`LIFECYCLE_ERROR: ${error.message}\n`);
  process.exitCode = 1;
});
