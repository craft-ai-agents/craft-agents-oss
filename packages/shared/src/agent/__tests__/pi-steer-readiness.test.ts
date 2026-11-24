import { afterEach, describe, expect, it } from 'bun:test';
import { PiAgent } from '../pi-agent.ts';

const agents: PiAgent[] = [];
function makeAgent(): any {
  const agent = new PiAgent({
    provider: 'pi', isHeadless: true,
    workspace: { id: 'pi-steer-test', name: 'Test', rootPath: '/tmp/pi-steer-test' } as any,
  });
  agents.push(agent);
  (agent as any).ensureSubprocess = async () => {};
  (agent as any).subprocess = { kill() {} };
  return agent;
}
afterEach(() => { for (const agent of agents.splice(0)) agent.destroy(); });

describe('Pi steering readiness', () => {
  it("takes a steer only while the turn's agent run is active", async () => {
    const agent = makeAgent();
    const sent: any[] = [];
    let promptSent!: () => void;
    const prompted = new Promise<void>((resolve) => { promptSent = resolve; });
    agent.send = (msg: any) => { sent.push(msg); if (msg.type === 'prompt') promptSent(); };

    const done = (async () => { for await (const _ of agent.chatImpl('hello')) { /* drain */ } })();
    await prompted;
    // The prompt is sent, but pi-agent-server may still be creating the Pi session it handles it
    // with, and drops a steer that arrives before ("Steer ignored — no active session").
    expect(agent.isProcessing()).toBe(true);
    expect(agent.canSteerNow()).toBe(false);

    agent.handleSubprocessEvent({ type: 'agent_start' });
    expect(agent.canSteerNow()).toBe(true);
    expect(agent.redirect('also this')).toBe(true);
    expect(sent.at(-1)).toEqual({ type: 'steer', message: 'also this' });

    agent.handleSubprocessEvent({ type: 'agent_end', messages: [], willRetry: false });
    expect(agent.canSteerNow()).toBe(false);
    await done;
    expect(agent.canSteerNow()).toBe(false);
  });

  it('ignores an agent_start that arrives outside a turn', () => {
    const agent = makeAgent();
    agent.handleSubprocessEvent({ type: 'agent_start' });
    expect(agent.canSteerNow()).toBe(false);
  });
});
