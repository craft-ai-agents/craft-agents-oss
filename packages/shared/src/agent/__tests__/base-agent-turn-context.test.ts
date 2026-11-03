import { describe, expect, it } from 'bun:test';
import { TestAgent, createMockBackendConfig } from './test-utils.ts';

async function drain(iterator: AsyncGenerator<unknown>): Promise<void> {
  for await (const _ of iterator) { /* consume */ }
}

describe('BaseAgent.chat host context', () => {
  it('appends host guidance after the message for this turn only', async () => {
    const agent = new TestAgent(createMockBackendConfig());
    const capturedDuringTurn: Array<string | null> = [];
    const originalChatImpl = agent['chatImpl'].bind(agent);
    agent['chatImpl'] = async function* (message, attachments, options) {
      capturedDuringTurn.push(agent.getCurrentTurnUserMessage());
      yield* originalChatImpl(message, attachments, options);
    };

    await drain(agent.chat('fix the login bug', undefined, { turnContext: '<system-reminder>hint</system-reminder>' }));
    expect(agent.chatCalls[0]!.message).toBe('fix the login bug\n\n<system-reminder>hint</system-reminder>');
    // The message resent after a source activation stays what the user typed.
    expect(capturedDuringTurn).toEqual(['fix the login bug']);

    await drain(agent.chat('next message'));
    expect(agent.chatCalls[1]!.message).toBe('next message');
  });

  it('puts session context before the message and turn guidance after it', async () => {
    const agent = new TestAgent(createMockBackendConfig());
    const capturedDuringTurn: Array<string | null> = [];
    const originalChatImpl = agent['chatImpl'].bind(agent);
    agent['chatImpl'] = async function* (message, attachments, options) {
      capturedDuringTurn.push(agent.getCurrentTurnUserMessage());
      yield* originalChatImpl(message, attachments, options);
    };

    await drain(agent.chat('do the task', undefined, {
      sessionContext: '<task_context>Goal: ship it</task_context>',
      turnContext: '<system-reminder>hint</system-reminder>',
    }));
    expect(agent.chatCalls[0]!.message).toBe('<task_context>Goal: ship it</task_context>\n\ndo the task\n\n<system-reminder>hint</system-reminder>');
    expect(capturedDuringTurn).toEqual(['do the task']);
  });
});
