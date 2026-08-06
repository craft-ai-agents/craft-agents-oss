#!/usr/bin/env node
// Floods stderr forever but never reads stdin or completes the MCP
// `initialize` handshake. The idle watchdog keeps getting reset by the noise,
// so the ceiling timer is what must eventually stop the validation. Used to
// pin the worst-case connect-phase wall-clock cost.
//
// We pad each line so the OS pipe flushes promptly under Node's
// non-TTY stderr buffering. Without padding, the small ~25-byte ticks can
// sit in the pipe's write buffer for many seconds before the parent sees
// them, which makes the connect-phase watchdog test wildly flaky.

const pad = ' '.repeat(512)

process.stderr.write(`startup ${Date.now()}${pad}\n`)
setInterval(() => {
  process.stderr.write(`tick ${Date.now()}${pad}\n`)
}, 250)
