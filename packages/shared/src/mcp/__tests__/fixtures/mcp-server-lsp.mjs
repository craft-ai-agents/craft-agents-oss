#!/usr/bin/env node
// Buggy MCP server that uses LSP-style Content-Length framing instead of MCP's
// newline-delimited JSON-RPC. Reproduces the reporter's failure mode from
// craft-agents-oss#787. The MCP client should fail fast with a framing hint.

import readline from 'node:readline'

const rl = readline.createInterface({ input: process.stdin })

const sendLsp = (msg) => {
  const json = JSON.stringify(msg)
  const bytes = Buffer.byteLength(json, 'utf8')
  process.stdout.write(`Content-Length: ${bytes}\r\n\r\n${json}`)
}

// Log to stderr so the validator surfaces it.
process.stderr.write('mcp-server-lsp: starting with LSP-style framing\n')

rl.on('line', (line) => {
  let req
  try {
    req = JSON.parse(line)
  } catch {
    return
  }
  if (req.method === 'initialize') {
    sendLsp({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'mcp-server-lsp', version: '1.0.0' },
      },
    })
  }
})
