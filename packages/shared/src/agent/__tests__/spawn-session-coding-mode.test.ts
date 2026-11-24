import { describe, it, expect, beforeEach } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SpawnSessionSchema } from '@craft-agent/session-tools-core';
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
    const result: SpawnSessionResult = { sessionId: 'spawned-id', name: 'spawned', status: 'started' };
    return result;
  };
  return { agent, captured };
}

describe('preExecuteSpawnSession Coding mode and worktree', () => {
  let agent: SpawnTestAgent;
  let captured: SpawnSessionRequest[];

  beforeEach(() => {
    ({ agent, captured } = setup());
  });

  it('forwards an explicit codingMode either way', async () => {
    await agent.invokeSpawn({ prompt: 'hi', codingMode: true });
    await agent.invokeSpawn({ prompt: 'hi', codingMode: false });
    expect(captured.map((request) => request.codingMode)).toEqual([true, false]);
  });

  it('leaves codingMode to inheritance when omitted or not a boolean', async () => {
    await agent.invokeSpawn({ prompt: 'hi' });
    await agent.invokeSpawn({ prompt: 'hi', codingMode: 'yes' });
    expect(captured.map((request) => request.codingMode)).toEqual([undefined, undefined]);
  });

  it('expands worktreePath like workingDirectory', async () => {
    await agent.invokeSpawn({ prompt: 'hi', worktreePath: '~/repos/app-feature' });
    expect(captured[0]?.worktreePath).toBe(join(homedir(), 'repos/app-feature'));
    expect(captured[0]?.workingDirectory).toBeUndefined();
  });

  it('treats an empty worktreePath as omitted', async () => {
    await agent.invokeSpawn({ prompt: 'hi', worktreePath: '' });
    expect(captured[0]?.worktreePath).toBeUndefined();
  });
});

describe('SpawnSessionSchema', () => {
  it('accepts the Coding mode, worktree and project fields on both backends', () => {
    const parsed = SpawnSessionSchema.parse({
      prompt: 'hi',
      codingMode: true,
      worktreePath: '/repos/app-feature',
      projectId: 'app',
    });
    expect(parsed).toMatchObject({ codingMode: true, worktreePath: '/repos/app-feature', projectId: 'app' });
  });
});
