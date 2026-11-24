/**
 * A Claude session whose connection credentials can't be resolved fails closed:
 * the turn ends with an error card instead of starting the CLI, which would sign
 * in with whatever it finds (craft-agents-oss#1129).
 *
 * The agent is built with Object.create, so nothing reads config.json, the
 * credential store or preferences. What a turn or a completion reads right after
 * the auth check throws, so a regression fails the test instead of starting the CLI.
 */
import { describe, expect, it, mock } from 'bun:test';
import { ClaudeAgent } from '../claude-agent.ts';
import { authFailureError, type ClaudeAuthFailure } from '../backend/claude/auth-failure.ts';

const signInFailed: ClaudeAuthFailure = { kind: 'oauth', warning: 'Failed to get OAuth token for: claude-max' };

/** A ClaudeAgent with `failure` recorded, whose postInit() leaves it as it is or clears it. */
function agentWith(failure: ClaudeAuthFailure | null, postInitClears = false) {
  const agent = Object.create(ClaudeAgent.prototype) as any;
  agent.authFailure = failure;
  agent.postInit = mock(async () => {
    if (postInitClears) agent.authFailure = null;
    return { authInjected: postInitClears };
  });
  agent.turnEnded = false;
  agent.config = {
    miniModel: 'claude-haiku-5-5',
    // A turn reads its session first thing after the auth check (and again in its
    // finally block, once it has ended).
    get session(): undefined {
      if (!agent.turnEnded) throw new Error('the turn went past the auth check');
      return undefined;
    },
    get envOverrides(): never {
      throw new Error('the completion went past the auth check');
    },
  };
  return agent;
}

async function runTurn(agent: any) {
  const events: any[] = [];
  for await (const event of agent.chatTurn('hello')) {
    events.push(event);
    if (event.type === 'complete') agent.turnEnded = true;
  }
  return events;
}

describe('ClaudeAgent without its connection credentials', () => {
  it('ends the turn with the error card after one more try, without starting the CLI', async () => {
    const agent = agentWith(signInFailed);

    const events = await runTurn(agent);

    expect(agent.postInit).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toEqual(['typed_error', 'complete']);
    expect(events[0].error.code).toBe('expired_oauth_token');
    expect(events[0].error.originalError).toBe(signInFailed.warning);
  });

  it('goes on with the turn when the second try resolves the credentials', async () => {
    const agent = agentWith(signInFailed, true);

    const events = await runTurn(agent);

    expect(agent.postInit).toHaveBeenCalledTimes(1);
    expect(events[0]).toEqual({ type: 'error', message: 'the turn went past the auth check' });
  });

  it('does not try again when nothing failed', async () => {
    const agent = agentWith(null);

    expect(await agent.recheckAuthFailure()).toBeNull();
    expect(agent.postInit).not.toHaveBeenCalled();
  });

  it('refuses titles, summaries and call_llm without starting the CLI', async () => {
    const agent = agentWith(signInFailed);

    await expect(agent.runMiniCompletion('Title?')).rejects.toThrow(signInFailed.warning);
    await expect(agent.queryLlm({ prompt: 'Hi' })).rejects.toThrow(signInFailed.warning);
  });

  it('records a session without a connection as a failure', async () => {
    const agent = Object.create(ClaudeAgent.prototype) as any;
    agent.config = {};

    const result = await agent.postInit();

    expect(result).toEqual({ authInjected: false, authWarning: 'No connection slug available', authWarningLevel: 'error' });
    expect(agent.authFailure).toEqual({ kind: 'connection', warning: 'No connection slug available' });
  });
});

describe('authFailureError', () => {
  it.each([
    ['oauth', 'expired_oauth_token'],
    ['api_key', 'invalid_api_key'],
    ['connection', 'invalid_credentials'],
  ] as const)('reports missing %s credentials as %s', (kind, code) => {
    const error = authFailureError({ kind, warning: 'No credentials' });

    expect(error.code).toBe(code);
    expect(error.originalError).toBe('No credentials');
  });

  it('offers Re-authenticate when the Claude sign-in is gone', () => {
    expect(authFailureError(signInFailed).actions.map((action) => action.action)).toContain('reauth');
  });

  it('offers Retry, not a sign-in, when the credentials could not be read', () => {
    const warning = 'Could not resolve credentials for claude-max: No writable credential backend available';
    const error = authFailureError({ kind: 'unavailable', warning });

    expect(error.code).toBe('unknown_error');
    expect(error.canRetry).toBe(true);
    expect(error.actions.map((action) => action.action)).toEqual(['retry']);
    expect(error.details).toEqual([warning]);
  });

  it.each([
    ['fetch failed', 'network_error'],
    ['The operation timed out.', 'network_error'],
    ['Token refresh failed: 503 - Service Unavailable', 'service_error'],
    ['Token refresh failed: 429 - rate_limit_error', 'rate_limited'],
  ] as const)('reports a kept sign-in whose refresh failed with %s as a retryable %s', (refreshError, code) => {
    const error = authFailureError({ ...signInFailed, transientRefreshError: refreshError });

    expect(error.code).toBe(code);
    expect(error.canRetry).toBe(true);
    expect(error.details).toEqual([signInFailed.warning]);
  });
});
