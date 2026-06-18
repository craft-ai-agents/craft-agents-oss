import type { AgentSession } from '@mariozechner/pi-coding-agent';

/**
 * Force a system prompt onto a Pi AgentSession.
 *
 * Pi SDK 0.72.1 has no public per-turn system-prompt API. Setting
 * `state.systemPrompt` directly is wiped on every `session.prompt()` call
 * (agent-session.js ~L796: `state.systemPrompt = _baseSystemPrompt`), and
 * `_baseSystemPrompt` itself can be regenerated from the SDK's resource loader
 * when tools change (`setActiveToolsByName`) or extensions reload.
 *
 * This stamps all three internals — `state.systemPrompt`, `_baseSystemPrompt`,
 * and `_rebuildSystemPrompt` — so our prompt survives every reset path.
 *
 * Pattern matches OpenClaw's `applySystemPromptOverrideToSession` (same SDK,
 * same constraint): https://github.com/openclaw/openclaw/blob/main/src/agents/pi-embedded-runner/system-prompt.ts
 *
 * Remove once the SDK exposes a public per-turn system-prompt API.
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
