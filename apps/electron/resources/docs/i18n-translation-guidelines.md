# Frontend Translation Guidelines

This project supports localized UI copy with contextual terminology rules.

## Locked Terms (Do Not Translate)

Keep these terms in English when they refer to product/feature names:

- `Skills`
- `Codex`
- `Claude Code`
- `MCP`
- `OAuth`
- `API`
- `OpenAI`
- `Anthropic`
- `G4 OS`

## Context Matters

- Use context-specific keys instead of generic keys for ambiguous words.
- Example: use a key for the `Skills` feature label, not a generic "skills" word key.
- Add translator notes on keys when a term can be misinterpreted.

## Key Writing Rules

- Prefer stable keys by area: `menu.*`, `settings.*`, `sidebar.*`, `content.*`.
- Keep values concise and UI-oriented.
- Use interpolation placeholders for dynamic values, e.g. `{{version}}`.

