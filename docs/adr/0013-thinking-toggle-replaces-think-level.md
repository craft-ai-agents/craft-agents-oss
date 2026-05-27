# Thinking Toggle Replaces Six-Tier Think Level

The six-tier thinking level system (`off/low/medium/high/xhigh/max`) is replaced by a simple boolean **Thinking Toggle** because the model served on the Pi/OpenLLM path does not accept effort or token-budget parameters — it controls reasoning via `chat_template_kwargs: { enable_thinking: true }` at the top level of the OpenAI-compatible request body. A six-tier scale with no meaningful variation between tiers is misleading UI.

## Decision

The `ThinkingLevel` type, all derived constants, and the tier dropdown are removed. In their place:

- `thinkingEnabled: boolean` on session and workspace records (default `true`).
- **Pi/OpenLLM connections**: when on, inject `chat_template_kwargs: { enable_thinking: true }` as a top-level field in the request body alongside `model` and `stream`.
- **Anthropic/Claude connections**: when on, use `thinking: { type: 'adaptive', effort: 'xhigh' }` — Anthropic's recommended level for agentic/coding work. The abstraction boundary keeps per-backend translation out of the UI.
- Migration: legacy `thinkingLevel: 'off'` → `false`; any other persisted value → `true`.

## Considered Options

**Keep six tiers, map to a fixed internal value for Pi** — rejected because it would expose a control with no effect to the user, creating false precision.

**Always-on thinking, remove toggle entirely** — rejected because users need a way to skip reasoning for fast/cheap turns.

## Consequences

The `thinking-levels.ts` module and all references to `ThinkingLevel`, `THINKING_LEVELS`, `THINKING_LEVEL_IDS`, `THINKING_TO_EFFORT`, `getThinkingTokens`, and `normalizeThinkingLevel` are deleted. The `FreeFormInput` tier picker becomes an icon toggle. The turn card gains a **Thinking Block** that streams live then collapses.
