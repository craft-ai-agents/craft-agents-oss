#!/usr/bin/env node
// Simulates a slow cold-cache install (e.g. `uv tool run mcp-server-time` on
// first launch): emits stderr "Installing …" lines every 500ms for ~12s, then
// starts responding to MCP requests. The connect-phase watchdog should treat
// the stderr noise as activity and keep resetting the idle timer, so
// validation should succeed.
//
// `readline` is created up-front (not after the install loop) so any
// `initialize` request that the client writes during the "install" phase is
// consumed and queued — otherwise stdin would buffer in the OS pipe and Node
// can drop early requests if the consumer is attached too late.

import readline from 'node:readline'

const packages = ['anyio', 'pydantic-core', 'mcp', 'click', 'h11', 'idna']
let i = 0
let installing = true
const pendingLines = []

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (installing) {
    pendingLines.push(line)
  } else {
    handleLine(line)
  }
})

const installInterval = setInterval(() => {
  if (i >= packages.length * 4) {
    clearInterval(installInterval)
    process.stderr.write('Installed packages in 31ms\n')
    installing = false
    while (pendingLines.length > 0) {
      handleLine(pendingLines.shift())
    }
    return
  }
  process.stderr.write(
    `Installing ${packages[i % packages.length]} (${(Math.random() * 2).toFixed(1)} MiB)\n`,
  )
  i++
}, 500)

function handleLine(line) {
  let req
  try {
    req = JSON.parse(line)
  } catch {
    return
  }
  if (req.method === 'initialize') {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: req.id,
        result: {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'mcp-server-slow', version: '1.0.0' },
        },
      }) + '\n',
    )
    return
  }
  if (req.method === 'notifications/initialized') return
  if (req.method === 'tools/list') {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: req.id,
        result: {
          tools: [
            {
              name: 'ping',
              description: 'ping',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        },
      }) + '\n',
    )
  }
}
