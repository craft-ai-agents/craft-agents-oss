/**
 * ACP Protocol Probe — sends ACP handshake to a real process and logs every line.
 * Usage: bun run tests/acp-probe.ts -- <command> [args...]
 * Example: bun run tests/acp-probe.ts -- cursor agent --print
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const dashIdx = args.indexOf('--');
const command = dashIdx >= 0 ? args.slice(dashIdx + 1) : args;

if (!command.length) {
  console.error('Usage: bun run tests/acp-probe.ts -- <command> [args...]');
  process.exit(1);
}

console.log(`[probe] Spawning: ${command.join(' ')}`);
const child = spawn(command[0]!, command.slice(1), {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env },
});

// Log ALL stderr
child.stderr?.on('data', (chunk: Buffer) => {
  const text = chunk.toString().trim();
  if (text) console.log(`[stderr] ${text}`);
});

// Log ALL stdout lines
const rl = createInterface({ input: child.stdout! });
rl.on('line', (line: string) => {
  console.log(`[stdout] ${line}`);

  // Try to parse as JSON-RPC
  try {
    const msg = JSON.parse(line);
    console.log(`[parsed] ${JSON.stringify(msg, null, 2)}`);
  } catch {
    // Not JSON — raw output
  }
});

child.on('exit', (code) => {
  console.log(`[probe] Process exited with code ${code}`);
  process.exit(0);
});

child.on('error', (err) => {
  console.log(`[probe] Spawn error: ${err.message}`);
  process.exit(1);
});

// Wait 2s for process to start, then send ACP handshake
let nextId = 1;
function send(method: string, params?: unknown) {
  const msg: any = { jsonrpc: '2.0', method, id: nextId++ };
  if (params !== undefined) msg.params = params;
  const line = JSON.stringify(msg);
  console.log(`[send] ${line}`);
  child.stdin!.write(line + '\n');
}

setTimeout(() => {
  console.log('\n=== Sending initialize ===');
  send('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: false } },
    clientInfo: { name: 'acp-probe', version: '1.0.0' },
  });
}, 2000);

setTimeout(() => {
  console.log('\n=== Sending session/new ===');
  send('session/new', {
    cwd: process.cwd(),
    mcpServers: [],
  });
}, 4000);

setTimeout(() => {
  console.log('\n=== Sending session/prompt ===');
  send('session/prompt', {
    sessionId: 'probe-session',
    prompt: [{ type: 'text', text: 'Say hello in one word' }],
  });
}, 6000);

// Timeout: kill after 30s
setTimeout(() => {
  console.log('\n[probe] Timeout — killing process');
  child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1000);
}, 30000);
