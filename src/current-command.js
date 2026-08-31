/**
 * Tracks which command is currently executing, so telemetry.js can
 * attribute events without every command file needing to pass this through
 * manually — see the preAction hook in program.js, which is what actually
 * calls setCurrentCommand() on every invocation.
 *
 * Split out from telemetry.js on purpose: program.js needs to call
 * setCurrentCommand() on every single invocation (including --help,
 * --version, and telemetry-disabled runs), so it must not have to load
 * telemetry.js's Segment SDK import (and the top-level await that comes
 * with it) just to reach two trivial accessor functions.
 */
let _currentCommand = '';

export function setCurrentCommand(path) {
  _currentCommand = path;
}

export function getCurrentCommand() {
  return _currentCommand;
}
