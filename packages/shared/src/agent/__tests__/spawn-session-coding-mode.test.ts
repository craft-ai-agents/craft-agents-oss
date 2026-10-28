/**
 * spawn_session must forward codingMode through SpawnSessionRequest so
 * SessionManager can pass it to createSession before the first message fixes
 * the session's prompt and tool profile.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import type { SpawnSessionRequest, SpawnSessionResult } from '../base-agent.ts';
import { createSpawnSessionTool } from '../spawn-session-tool.ts';
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

describe('spawn_session codingMode forwarding', () => {
  let agent: SpawnTestAgent;
  let captured: SpawnSessionRequest[];

  beforeEach(() => {
    ({ agent, captured } = setup());
  });

  it('forwards codingMode=true to onSpawnSession', async () => {
    await agent.invokeSpawn({ prompt: 'edit the code', codingMode: true });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.codingMode).toBe(true);
  });

  it('forwards an explicit false so callers can override a workspace default', async () => {
    await agent.invokeSpawn({ prompt: 'review the code', codingMode: false });
    expect(captured[0]?.codingMode).toBe(false);
  });

  it('leaves codingMode undefined when omitted so the workspace default applies', async () => {
    await agent.invokeSpawn({ prompt: 'hi' });
    expect(captured[0]?.codingMode).toBeUndefined();
  });
});

describe('spawn_session Claude schema', () => {
  const tool = createSpawnSessionTool({
    sessionId: 'parent-id',
    getSpawnSessionFn: () => undefined,
  });

  it('exposes codingMode as an optional boolean', () => {
    const codingMode = tool.inputSchema.codingMode;
    expect(codingMode.safeParse(undefined).success).toBe(true);
    expect(codingMode.safeParse(true).success).toBe(true);
    expect(codingMode.safeParse(false).success).toBe(true);
    expect(codingMode.safeParse('yes').success).toBe(false);
  });
});
