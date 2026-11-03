import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';

/**
 * The subprocess builds its Pi session again when its tools change (at the next prompt) and when
 * it restarts. Drives src/index.ts over its JSONL protocol, offline: creating a session makes no
 * model call, and a prompt without credentials fails after the session is built.
 */

const serverPath = join(import.meta.dir, 'index.ts');
const blockNetworkPreloadPath = join(import.meta.dir, 'test-fixtures', 'block-network.ts');
const WAIT_MS = 20_000;

let scratchDir: string;
let servers: Server[] = [];

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'pi-session-rebuild-'));
  mkdirSync(join(scratchDir, 'plans'), { recursive: true });
});

afterEach(() => {
  for (const server of servers) server.stop();
  servers = [];
  rmSync(scratchDir, { recursive: true, force: true });
});

class Server {
  private child: ChildProcessWithoutNullStreams;
  output = '';

  constructor() {
    this.child = spawn(process.execPath, ['--preload', blockNetworkPreloadPath, serverPath], {
      cwd: scratchDir,
      env: { PATH: process.env.PATH, HOME: scratchDir, TMPDIR: scratchDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.on('data', (chunk: Buffer) => { this.output += chunk.toString(); });
    this.child.stderr.on('data', (chunk: Buffer) => { this.output += chunk.toString(); });
    servers.push(this);
  }

  send(message: object): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  /** Wait until the output (from `from` on) contains `text`, and return the index after it. */
  async waitFor(text: string, from = 0): Promise<number> {
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      const index = this.output.indexOf(text, from);
      if (index !== -1) return index + text.length;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`timed out waiting for "${text}"; output:\n${this.output.slice(-3000)}`);
  }

  stop(): void {
    this.child.kill();
  }
}

function init(sessionPath: string, branch?: { fromSessionPath: string; turnId?: string }) {
  return {
    type: 'init',
    apiKey: '',
    cwd: scratchDir,
    thinkingLevel: 'off',
    workspaceRootPath: scratchDir,
    sessionId: 'session-rebuild-test',
    sessionPath,
    workingDirectory: scratchDir,
    plansFolderPath: join(scratchDir, 'plans'),
    providerType: 'pi',
    branchFromSessionPath: branch?.fromSessionPath,
    branchFromSdkTurnId: branch?.turnId,
  };
}

const tool = (name: string) => ({ name, description: `Tool ${name}`, inputSchema: { type: 'object', properties: {} } });

/** The texts of the messages the model gets when the session in `sessionPath` is opened. */
function contextTexts(sessionPath: string): string[] {
  const manager = SessionManager.continueRecent(scratchDir, join(sessionPath, '.pi-sessions'));
  return manager.buildSessionContext().messages.map((message: any) => message.content?.[0]?.text ?? message.role);
}

describe('Pi session rebuilds', () => {
  it('builds the session again without the tools the main process no longer sends', async () => {
    const server = new Server();
    server.send(init(join(scratchDir, 'session')));
    await server.waitFor('"type":"ready"');
    server.send({ type: 'register_tools', tools: [tool('mcp__linear__list_issues'), tool('mcp__linear__create_issue')] });
    server.send({ type: 'ensure_session_ready', id: 'e1' });
    let at = await server.waitFor('"type":"ensure_session_ready_result"');
    const created = server.output.match(/Created Pi session: \S+ \((\d+) tools\)/);
    const toolsAtStart = Number(created?.[1]);

    // The same set again changes nothing
    server.send({ type: 'register_tools', tools: [tool('mcp__linear__list_issues'), tool('mcp__linear__create_issue')] });
    at = await server.waitFor('Registered 2 proxy tools (unchanged)', at);

    // A set without the source's tools replaces the old one at the next prompt
    server.send({ type: 'register_tools', tools: [] });
    server.send({ type: 'prompt', id: 'p1', message: 'hi', systemPrompt: 'You are a test.' });
    at = await server.waitFor('Recreating session due to tool changes', at);
    await server.waitFor(`(${toolsAtStart - 2} tools)`, at);
  }, WAIT_MS * 2);

  it('forks a branch from its parent once, and keeps the cutoff when it is opened again', async () => {
    const parentPath = join(scratchDir, 'parent');
    const parent = SessionManager.continueRecent(scratchDir, join(parentPath, '.pi-sessions'));
    const user = (text: string) => ({ role: 'user' as const, content: [{ type: 'text' as const, text }], timestamp: Date.now() });
    const assistant = (text: string) => ({
      role: 'assistant' as const, content: [{ type: 'text' as const, text }], api: 'anthropic-messages', provider: 'anthropic', model: 'm',
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop' as const, timestamp: Date.now(),
    });
    parent.appendMessage(user('Parent question'));
    const anchor = parent.appendMessage(assistant('Answer the branch starts from') as never);
    parent.appendMessage(user('Later parent question'));
    parent.appendMessage(assistant('Later parent answer') as never);

    // Branch creation: the subprocess forks the parent's file up to the anchor
    const branchPath = join(scratchDir, 'branch');
    const first = new Server();
    first.send(init(branchPath, { fromSessionPath: parentPath, turnId: anchor }));
    first.send({ type: 'ensure_session_ready', id: 'e1' });
    await first.waitFor('"type":"ensure_session_ready_result"');
    first.stop();
    expect(contextTexts(branchPath)).toEqual(['Parent question', 'Answer the branch starts from']);

    // The app restarted: SessionManager retired the turn id but still names the parent
    const second = new Server();
    second.send(init(branchPath, { fromSessionPath: parentPath }));
    second.send({ type: 'ensure_session_ready', id: 'e2' });
    await second.waitFor('"type":"ensure_session_ready_result"');
    second.stop();

    expect(readdirSync(join(branchPath, '.pi-sessions'))).toHaveLength(1);
    expect(contextTexts(branchPath)).toEqual(['Parent question', 'Answer the branch starts from']);
  }, WAIT_MS * 3);
});
