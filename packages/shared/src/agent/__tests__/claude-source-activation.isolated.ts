import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Options, SDKMessage, SyncHookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '@craft-agent/core/types';

// Isolated because options.ts normally repairs the user's ~/.claude.json.
mock.module('../options.ts', () => ({
  getDefaultOptions: () => ({}),
  getTextCompletionOptions: () => ({}),
  resetClaudeConfigCheck: () => {},
}));
const configDir = mkdtempSync(join(tmpdir(), 'craft-source-activation-'));
const previousConfigDir = process.env.CRAFT_CONFIG_DIR;
process.env.CRAFT_CONFIG_DIR = configDir;
const { ClaudeAgent } = await import('../claude-agent.ts');
const { AbortReason } = await import('../backend/types.ts');
const { createMockWorkspace, createMockSession, createMockSource } = await import('./test-utils.ts');
const { ensureConfigDir } = await import('../../config/storage.ts');
ensureConfigDir();

afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR;
  else process.env.CRAFT_CONFIG_DIR = previousConfigDir;
  rmSync(configDir, { recursive: true, force: true });
});

let agent: InstanceType<typeof ClaudeAgent>;
afterEach(() => agent?.dispose());

async function runActivation(
  activate: ((slug: string) => Promise<boolean>) | undefined,
  { exists = true, slugs = ['calendar'] } = {},
) {
  const workspace = createMockWorkspace({ rootPath: configDir });
  const session = createMockSession({ workspaceRootPath: configDir, permissionMode: 'allow-all' });
  agent = new ClaudeAgent({ workspace, session, model: 'test-model', isHeadless: true });
  agent.setAllSources(exists ? slugs.map(slug => createMockSource({ slug })) : []);
  const internal = agent as any;
  agent.onSourceActivationRequest = activate ? async slug => {
    const activated = await activate(slug);
    if (activated) internal.sourceManager.updateActiveState([...internal.sourceManager.getActiveSlugs(), slug], []);
    return activated;
  } : null;
  internal.keepBackgroundTasksAlive = true;
  internal.setCurrentTurnUserMessage('Check my calendar');
  const abort = mock((_reason: string) => {});
  internal.forceAbort = abort;
  const outputs: SyncHookJSONOutput[] = [];
  const calls = [...slugs.map((slug, i) => ({
    type: 'tool_use' as const, id: `source-${i}`, name: `mcp__${slug}__list_events`, input: {},
  })), { type: 'tool_use' as const, id: 'sibling', name: 'Bash', input: { command: 'pwd' } }];

  // Replace only the SDK transport; exercise the production hook, checks,
  // event adapter and drain loop without a model, credentials or MCP server.
  internal.beginPersistentTurn = async (_message: unknown, options: Options) => {
    const hook = options.hooks!.PreToolUse![0]!.hooks[0]!;
    return (async function* (): AsyncGenerator<SDKMessage> {
      yield {
        type: 'assistant', parent_tool_use_id: null,
        message: { id: 'turn-1', content: calls, usage: { input_tokens: 1, output_tokens: 1 } },
      } as SDKMessage;
      outputs.push(...await Promise.all(slugs.map((slug, i) => hook({
        hook_event_name: 'PreToolUse', session_id: session.id, transcript_path: '', cwd: configDir,
        tool_name: `mcp__${slug}__list_events`, tool_use_id: `source-${i}`, tool_input: {},
      }, `source-${i}`, { signal: new AbortController().signal }) as Promise<SyncHookJSONOutput>)));
      yield {
        type: 'user', parent_tool_use_id: null,
        message: { role: 'user', content: calls.map((call, i) => ({
          type: 'tool_result', tool_use_id: call.id,
          content: outputs[i]?.reason ?? 'working directory', is_error: i < slugs.length,
        })) },
      } as SDKMessage;
      if (outputs.some(output => output.continue === false)) return;
      yield {
        type: 'assistant', parent_tool_use_id: null,
        message: { id: 'turn-2', content: [{ type: 'text', text: 'Please check the source configuration.' }] },
      } as SDKMessage;
      yield { type: 'result', subtype: 'success', is_error: false, num_turns: 1, usage: {}, total_cost_usd: 0 } as SDKMessage;
    })();
  };
  const events: AgentEvent[] = [];
  for await (const event of internal.chatImpl('Check my calendar\n<turn_context>host guidance</turn_context>')) {
    events.push(event);
  }
  return { outputs, events, abort };
}

describe('Claude inactive-source PreToolUse recovery', () => {
  it.each([{ slugs: ['calendar'] }, { slugs: ['calendar', 'mail'] }])('drains sibling results before one restart ($slugs)', async ({ slugs }) => {
    const activate = mock(async (_slug: string) => true);
    const { outputs, events, abort } = await runActivation(activate, { slugs: [...slugs] });
    expect(activate.mock.calls.map(([slug]) => slug)).toEqual([...slugs]);
    expect(outputs.every(output => output.continue === true && output.decision === 'block')).toBe(true);
    expect(outputs.every(output => !output.reason?.includes('send their request again'))).toBe(true);
    expect(events.filter(event => event.type === 'tool_result').map(event => event.toolUseId))
      .toEqual([...slugs.map((_, i) => `source-${i}`), 'sibling']);
    expect(events.filter(event => event.type === 'source_activated')).toEqual([{
      type: 'source_activated', sourceSlug: slugs[0]!, originalMessage: 'Check my calendar',
    }]);
    expect(events.at(-1)?.type).toBe('source_activated');
    expect(events.some(event => event.type === 'complete' || event.type === 'text_complete')).toBe(false);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledWith(AbortReason.SourceActivated);
    expect(agent.consumePendingSourceActivationRestart()).toBeNull();
  });

  it.each([
    { name: 'activation rejected', activate: async () => false, reason: 'could not be activated', exists: true },
    { name: 'activation throws', activate: async () => { throw new Error('connection failed'); }, reason: 'connection failed', exists: true },
    { name: 'non-Error rejection', activate: async () => { throw 'offline'; }, reason: 'Unknown error', exists: true },
    { name: 'no callback', activate: undefined, reason: 'not enabled', exists: true },
    { name: 'unknown source', activate: async () => true, reason: 'could not be connected', exists: false },
  ])('keeps the model turn alive after $name', async ({ activate, reason, exists }) => {
    const { outputs, events, abort } = await runActivation(activate, { exists });
    expect(outputs[0]).toMatchObject({ continue: true, decision: 'block' });
    expect(outputs[0]!.reason).toContain(reason);
    expect(events.some(event => event.type === 'source_activated')).toBe(false);
    expect(events.find(event => event.type === 'text_complete')).toMatchObject({
      text: 'Please check the source configuration.',
    });
    expect(abort).not.toHaveBeenCalled();
    expect(agent.consumePendingSourceActivationRestart()).toBeNull();
  });
});
