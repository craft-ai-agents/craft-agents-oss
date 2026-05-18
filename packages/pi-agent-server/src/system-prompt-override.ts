import type { AgentSession } from '@mariozechner/pi-coding-agent';

/**
 * Pi resets `state.systemPrompt` from private base prompt fields during prompt
 * and tool rebuild paths. Stamp all known fields so Craft's runtime prompt
 * survives until the SDK exposes a public override API.
 */
export function applySystemPromptOverride(session: AgentSession, prompt: string): void {
  session.agent.state.systemPrompt = prompt;
  const mutable = session as unknown as {
    _baseSystemPrompt?: string;
    _rebuildSystemPrompt?: (toolNames: string[]) => string;
  };
  mutable._baseSystemPrompt = prompt;
  mutable._rebuildSystemPrompt = () => prompt;
}
