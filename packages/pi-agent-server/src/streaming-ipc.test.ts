import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const packageDir = dirname(import.meta.dir);
const preload = join(import.meta.dir, 'test-fixtures', 'streaming-ipc-provider.ts');
const pipeRelay = join(import.meta.dir, 'test-fixtures', 'streaming-ipc-pipe-relay.mjs');
let scratch: string;
let bundle: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'pi-streaming-ipc-'));
  bundle = join(scratch, 'server.js');
  const built = spawnSync(process.execPath, ['build', 'src/index.ts', '--target=bun', '--format=esm', '--external', 'koffi', '--outfile', bundle], {
    cwd: packageDir, encoding: 'utf8', timeout: 120_000,
  });
  if (built.status !== 0) throw new Error(built.stderr || built.stdout);
});

afterAll(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });

type Wire = Record<string, any>;

function startClient(relayCommand = 'node') {
  const sessionPath = mkdtempSync(join(scratch, 'session-'));
  const child = spawn(relayCommand, [pipeRelay, process.execPath, '--preload', preload, bundle], {
    cwd: sessionPath,
    env: { PATH: process.env.PATH, CRAFT_CONFIG_DIR: sessionPath, TMPDIR: sessionPath },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const messages: Wire[] = [];
  const writes: Array<{ count: number; blocked: number }> = [];
  let stderr = '';
  let pending = '';
  let updateBytes = 0;
  let failure: Error | undefined;
  let closed = false;
  const terminated = new Promise<void>(resolve => {
    child.once('error', error => { failure = error; resolve(); });
    child.once('close', () => { closed = true; resolve(); });
  });
  child.stdin.on('error', error => { failure ??= error; });
  const send = (message: Wire) => child.stdin.write(`${JSON.stringify(message)}\n`);
  child.stdout.on('data', (chunk: Buffer) => {
    pending += chunk.toString();
    for (let end; (end = pending.indexOf('\n')) >= 0;) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      messages.push(message);
      if (message.event?.type === 'message_update') updateBytes += Buffer.byteLength(line);
      if (message.type === 'pre_tool_use_request') send({ type: 'pre_tool_use_response', requestId: message.requestId, action: 'allow' });
      if (message.type === 'tool_execute_request') send({ type: 'tool_execute_response', requestId: message.requestId, result: { content: 'echo accepted', isError: false } });
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
    for (const match of chunk.toString().matchAll(/IPC_WRITES:(\d+):(\d+)/g)) writes.push({ count: Number(match[1]), blocked: Number(match[2]) });
  });
  const wait = async (predicate: () => boolean) => {
    const deadline = Date.now() + 12_000;
    while (!predicate()) {
      if (failure) throw failure;
      if (closed || child.exitCode !== null || child.signalCode !== null || Date.now() > deadline) {
        throw new Error(`Bundle did not reach expected state: ${stderr.slice(-3000)}`);
      }
      await Bun.sleep(5);
    }
  };
  const init = {
    type: 'init', apiKey: 'offline-only', model: 'pi/offline-ipc', cwd: sessionPath,
    thinkingLevel: 'off', workspaceRootPath: sessionPath, sessionId: 'streaming-ipc', sessionPath,
    workingDirectory: sessionPath, plansFolderPath: join(sessionPath, 'plans'), agentDir: join(sessionPath, '.agent'),
    baseUrl: 'https://streaming-ipc.invalid/v1', customEndpoint: { api: 'openai-completions' }, customModels: ['offline-ipc'],
  };
  const register = { type: 'register_tools', tools: [{
    name: 'mcp__offline__echo', description: 'Offline echo', inputSchema: {
      type: 'object', properties: { payload: { type: 'string' } }, required: ['payload'],
    },
  }] };
  send(init);
  send(register);
  return {
    child, messages, writes, sessionPath, send, wait, init, register,
    get updateBytes() { return updateBytes; },
    get stderr() { return stderr; },
    async stop() {
      if (closed) return;
      if (!failure && child.exitCode === null && child.signalCode === null) {
        send({ type: '__resume_reader__' });
        send({ type: 'shutdown' });
      }
      const gracefulTimeout = setTimeout(() => child.kill('SIGTERM'), 1000);
      let forceTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          terminated,
          new Promise<void>(resolve => {
            forceTimeout = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2000);
          }),
        ]);
      } finally {
        clearTimeout(gracefulTimeout);
        clearTimeout(forceTimeout);
      }
    },
  };
}

describe('Pi streaming IPC through the built SDK bundle', () => {
  it('cleans up after the relay has already exited from a signal', async () => {
    const client = startClient();
    try {
      await client.wait(() => client.messages.some(message => message.type === 'ready'));
      const closed = new Promise<void>(resolve => client.child.once('close', () => resolve()));
      client.child.kill('SIGKILL');
      await closed;
      await client.stop();
    } finally { await client.stop(); }
  }, 15_000);

  it('reports relay spawn failure and still finishes cleanup', async () => {
    const client = startClient(join(scratch, 'missing-node-executable'));
    try {
      await expect(client.wait(() => false)).rejects.toThrow();
    } finally { await client.stop(); }
  }, 5000);

  it('sends linear delta payloads and preserves complete messages, tools, usage and journal entries', async () => {
    const bytes: number[] = [];
    for (const size of [2048, 8192]) {
      const client = startClient();
      try {
        await client.wait(() => client.messages.some(message => message.type === 'ready'));
        client.send({ type: 'prompt', id: `linear-${size}`, message: `linear:${size}`, systemPrompt: 'Offline test.' });
        await client.wait(() => client.messages.some(message => message.event?.type === 'agent_end'));
        const updates = client.messages.filter(message => message.event?.type === 'message_update');
        expect(updates.length).toBeGreaterThan(size / 32);
        for (const { event } of updates) {
          expect(event).not.toHaveProperty('message');
          expect(event.assistantMessageEvent).not.toHaveProperty('partial');
        }
        const tool = client.messages.find(message => message.type === 'tool_execute_request');
        expect(tool?.args.payload).toBe('a'.repeat(size));
        const toolStart = updates.find(message => message.event.assistantMessageEvent.type === 'toolcall_start');
        expect(toolStart?.event.assistantMessageEvent).toMatchObject({ id: 'offline-tool', toolName: 'mcp__offline__echo' });
        const ended = client.messages.filter(message => message.event?.type === 'message_end' && message.event.message.role === 'assistant');
        expect(ended).toHaveLength(2);
        expect(ended[0]!.event.message.content).toContainEqual(expect.objectContaining({ type: 'thinking', thinking: 'r'.repeat(size) }));
        expect(ended[0]!.event.message.content).toContainEqual(expect.objectContaining({ type: 'text', text: 't'.repeat(size) }));
        expect(ended[1]!.event.message.content).toContainEqual(expect.objectContaining({ type: 'text', text: 'completed' }));
        expect(ended[1]!.event.message.usage).toMatchObject({ input: 11, output: 7, totalTokens: 18 });
        const anchors = client.messages.filter(message => message.event?.type === 'pi_turn_anchor');
        const journalDir = join(client.sessionPath, '.pi-sessions');
        const entries = readdirSync(journalDir).filter(name => name.endsWith('.jsonl')).flatMap(name =>
          readFileSync(join(journalDir, name), 'utf8').trim().split('\n').map(line => JSON.parse(line)));
        const persisted = entries.filter(entry => entry.type === 'message' && entry.message.role === 'assistant');
        expect(persisted).toHaveLength(ended.length);
        for (const message of ended) {
          expect(persisted.some(entry => JSON.stringify(entry.message) === JSON.stringify(message.event.message))).toBe(true);
        }
        for (const anchor of anchors) {
          expect(entries.some(entry => entry.id === anchor.event.sdkTurnAnchor)).toBe(true);
          expect(ended.some(message => message.event.sdkMessageId === anchor.event.sdkMessageId)).toBe(true);
        }
        expect(client.stderr).not.toContain('OFFLINE_FETCH_BLOCKED');
        bytes.push(client.updateBytes);
      } finally { await client.stop(); }
    }
    // Four times as much generated content must not produce quadratic IPC bytes.
    expect(bytes[1]!).toBeLessThan(bytes[0]! * 5);
  }, 40_000);

  it('bounds the pipe queue for a slow reader, aborts, and accepts another prompt', async () => {
    const client = startClient();
    try {
      await client.wait(() => client.messages.some(message => message.type === 'ready'));
      client.send({ type: '__pause_reader__' });
      client.send({ type: 'prompt', id: 'slow', message: 'slow-reader', systemPrompt: 'Offline test.' });
      // One false write may be followed by more drain/progress before the pipe
      // fills. Require five consecutive samples of a blocked, stable producer.
      await client.wait(() => {
        const recent = client.writes.slice(-5);
        return recent.length === 5 && recent.every(sample =>
          sample.blocked > 0 && sample.count === recent[0]!.count);
      });
      const pausedWrites = client.writes.at(-1)!.count;
      // Finishing all 1024 provider deltas is also stable, but is not backpressure.
      expect(pausedWrites).toBeLessThan(256);
      await Bun.sleep(200);
      expect(client.writes.at(-1)!.count).toBe(pausedWrites);
      client.send({ type: 'abort' });
      await client.wait(() => client.stderr.includes('IPC_PROVIDER_ABORTED'));
      client.send({ type: '__resume_reader__' });
      await client.wait(() => client.messages.some(message => message.event?.type === 'agent_end'));
      const completed = client.messages.filter(message => message.event?.type === 'agent_end').length;
      client.send({ type: 'prompt', id: 'after-abort', message: 'simple', systemPrompt: 'Offline test.' });
      await client.wait(() => client.messages.filter(message => message.event?.type === 'agent_end').length > completed);
      const final = client.messages.filter(message => message.event?.type === 'message_end' && message.event.message.role === 'assistant').at(-1);
      expect(final?.event.message.stopReason).toBe('stop');
      expect(final?.event.message.content).toContainEqual(expect.objectContaining({ type: 'text', text: 'completed' }));
    } finally { await client.stop(); }
  }, 25_000);

  it('does not duplicate events after tool recreation or reinitialization', async () => {
    const client = startClient();
    try {
      await client.wait(() => client.messages.some(message => message.type === 'ready'));
      for (let turn = 0; turn < 3; turn++) {
        if (turn === 1) client.send(client.register);
        if (turn === 2) {
          client.send(client.init);
          await client.wait(() => client.messages.filter(message => message.type === 'ready').length === 2);
        }
        const from = client.messages.length;
        client.send({ type: 'prompt', id: `turn-${turn}`, message: 'simple', systemPrompt: 'Offline test.' });
        await client.wait(() => client.messages.slice(from).some(message => message.event?.type === 'agent_end'));
        const events = client.messages.slice(from).map(message => message.event).filter(Boolean);
        expect(events.filter(event => event.type === 'agent_end')).toHaveLength(1);
        expect(events.filter(event => event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta')).toHaveLength(1);
        expect(events.filter(event => event.type === 'message_end' && event.message.role === 'assistant')).toHaveLength(1);
      }
    } finally { await client.stop(); }
  }, 25_000);
});
