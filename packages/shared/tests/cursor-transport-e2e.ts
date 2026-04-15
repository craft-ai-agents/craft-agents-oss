/**
 * End-to-end test: StdioAcpTransport + AcpAgent with real cursor-agent acp process.
 * Cursor Agent's native ACP mode (`cursor-agent acp`) speaks standard JSON-RPC 2.0.
 * Run: bun run tests/cursor-transport-e2e.ts
 */

import { StdioAcpTransport } from '../src/agent/acp-transport';
import { AcpAgent } from '../src/agent/acp-agent';
import type { AgentEvent } from '@craft-agent/core/types';

async function main() {
  console.log('=== cursor-agent acp E2E Test (native ACP mode) ===\n');

  // 1. Create transport using cursor-agent's native ACP mode
  const transport = new StdioAcpTransport(
    ['cursor-agent', 'acp'],
    undefined,
  );
  console.log('[OK] StdioAcpTransport created with cursor-agent acp');

  // 2. Test initialize
  const initResult = await transport.sendRequest('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: false } },
    clientInfo: { name: 'test', version: '1.0.0' },
  });
  console.log('[OK] initialize:', JSON.stringify(initResult));

  // 3. Test session/new
  const sessionResult = await transport.sendRequest('session/new', {
    cwd: process.cwd(),
    mcpServers: [],
  });
  console.log('[OK] session/new:', JSON.stringify(sessionResult));

  // 4. Set up notification listener
  const receivedNotifications: any[] = [];
  transport.onNotification((method, params) => {
    receivedNotifications.push({ method, params });
    console.log(`[NOTIFICATION] ${method}:`, JSON.stringify(params).slice(0, 200));
  });

  // 5. Test session/prompt
  console.log('\n--- Sending prompt: "Say hello in one word" ---');
  const promptResult = await transport.sendRequest('session/prompt', {
    sessionId: (sessionResult as any).sessionId,
    prompt: [{ type: 'text', text: 'Say hello in one word' }],
  });
  console.log('[OK] session/prompt result:', JSON.stringify(promptResult));

  // 6. Check notifications
  console.log(`\n--- Received ${receivedNotifications.length} notifications ---`);
  for (const n of receivedNotifications) {
    console.log(`  ${n.method}: status=${n.params?.status}, update=${n.params?.update?.sessionUpdate}`);
  }

  await transport.dispose();

  // 7. Now test with AcpAgent
  console.log('\n=== Testing with AcpAgent ===\n');
  const transport2 = new StdioAcpTransport(
    ['cursor-agent', 'acp'],
    undefined,
  );

  const config = {
    provider: 'acp' as const,
    workspace: { id: 'test', name: 'Test', slug: 'test', rootPath: '/tmp/test', createdAt: 0 },
    session: { id: 'test-session', workspaceRootPath: '/tmp/test', createdAt: 0, lastUsedAt: 0 },
    isHeadless: true,
    model: '',
    miniModel: '',
  } as any;

  const agent = new AcpAgent(config, transport2);

  console.log('--- Calling agent.chat("What is 2+2? Answer in one word") ---');
  const events: AgentEvent[] = [];
  const timeout = setTimeout(() => {
    console.error('[TIMEOUT] Agent chat did not complete in 30s');
    process.exit(1);
  }, 30000);

  for await (const event of agent.chat('What is 2+2? Answer in one word')) {
    events.push(event);
    console.log(`[EVENT] ${event.type}`, 'text' in event ? `text="${(event as any).text?.slice(0, 100)}"` : '');
  }
  clearTimeout(timeout);

  console.log(`\n--- Total events: ${events.length} ---`);
  const types = events.map(e => e.type);
  console.log('Types:', types.join(', '));

  const hasTextComplete = types.includes('text_complete');
  const hasComplete = types.includes('complete');

  console.log(`\ntext_complete: ${hasTextComplete ? 'PASS' : 'FAIL'}`);
  console.log(`complete: ${hasComplete ? 'PASS' : 'FAIL'}`);

  if (hasTextComplete) {
    const tc = events.find(e => e.type === 'text_complete') as any;
    console.log(`\nFinal text: "${tc?.text}"`);
  }

  agent.destroy();

  if (hasTextComplete && hasComplete) {
    console.log('\nE2E TEST PASSED');
    process.exit(0);
  } else {
    console.log('\nE2E TEST FAILED — missing required events');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
