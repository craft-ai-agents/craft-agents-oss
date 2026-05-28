/**
 * Verifies that `spawn_session` forwards `thinkingEnabled` through the
 * `SpawnSessionRequest` object so `SessionManager.onSpawnSession` can
 * pass it along to `createSession()`.
 *
 * Pairs with the corresponding fix in SessionManager.createSession that
 * reads `options?.thinkingEnabled` as the first-precedence source (before
 * workspace default and global default). Without that fix, this field
 * on the request would be silently dropped.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import type { SpawnSessionRequest, SpawnSessionResult } from '../base-agent.ts';
import { TestAgent, createMockBackendConfig } from './test-utils.ts';

class SpawnTestAgent extends TestAgent {
  public invokeSpawn(input: Record<string, unknown>) {
    return this.preExecuteSpawnSession(input);
  }
}

function setup() {
  const agent = new SpawnTestAgent(createMockBackendConfig());
  const captured: SpawnSessionRequest[] = [];
  agent.onSpawnSession = async (request) => {
    captured.push(request);
    const result: SpawnSessionResult = {
      sessionId: 'spawned-id',
      name: 'spawned',
      status: 'started',
    };
    return result;
  };
  return { agent, captured };
}

describe('spawn_session thinkingEnabled forwarding', () => {
  let agent: SpawnTestAgent;
  let captured: SpawnSessionRequest[];

  beforeEach(() => {
    ({ agent, captured } = setup());
  });

  it('forwards an explicit thinkingEnabled to onSpawnSession', async () => {
    await agent.invokeSpawn({ prompt: 'hi', thinkingEnabled: false });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.thinkingEnabled).toBe(false);
  });

  it('forwards each valid thinking toggle unchanged', async () => {
    const values = [true, false] as const;
    for (const value of values) {
      const { agent: a, captured: c } = setup();
      await a.invokeSpawn({ prompt: 'hi', thinkingEnabled: value });
      expect(c[0]?.thinkingEnabled).toBe(value);
    }
  });

  it('passes through undefined when thinkingEnabled is omitted', async () => {
    await agent.invokeSpawn({ prompt: 'hi' });
    expect(captured[0]?.thinkingEnabled).toBeUndefined();
  });

  it('does not drop thinkingEnabled when other optional fields are also set', async () => {
    await agent.invokeSpawn({
      prompt: 'hi',
      thinkingEnabled: true,
      permissionMode: 'ask',
      model: 'claude-opus-4-7',
      labels: ['test'],
    });
    expect(captured[0]?.thinkingEnabled).toBe(true);
    expect(captured[0]?.permissionMode).toBe('ask');
    expect(captured[0]?.model).toBe('claude-opus-4-7');
    expect(captured[0]?.labels).toEqual(['test']);
  });
});
