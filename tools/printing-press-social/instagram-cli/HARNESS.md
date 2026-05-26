# Social CLI Harness

Current scope: direct Instagram MVP.

The harness exposes deterministic commands for agents. Agents should emit content and action intent; this CLI owns validation, profile lookup, dry-run output, and adapter execution.

## Commands

Root package binary is `social`. Standalone package binary is `instagram-social` with the same arguments.

```bash
social profile add instagram --profile artist01 --json
social profile set-policy instagram --profile artist01 --confirm-policy require-confirm --json
social profile login instagram --profile artist01
social profile list --json
social profile status instagram --profile artist01 --live --json
social post instagram --profile artist01 --text "caption" --media image.jpg --dry-run --json
social post instagram --profile artist01 --text "caption" --media image.jpg --json
social comment instagram --profile artist01 --url "https://www.instagram.com/p/..." --text "comment" --dry-run --json
social comment instagram --profile artist01 --url "https://www.instagram.com/p/..." --text "comment" --json
social dm instagram --profile artist01 --to username --text "message" --dry-run --json
social dm instagram --profile artist01 --to username --text "message" --json
```

## Adapter

Phase 1 uses direct browser automation against Instagram web.

No Postiz. No MCP-first execution. No API wrapper.

The harness keeps the browser engine swappable:

- `runner-cdp`: default inside RunnerOS; use Runner native browser/CDP tools for execution.
- `chrome-devtools`: external Chrome DevTools/CDP lane for real Chrome sessions.
- `stagehand`: optional adaptive AI-browser lane for messy pages.
- `cloakbrowser`: optional local engine only. Do not bundle it in a sellable product.
- `playwright`: legacy standalone fallback only.

## Storage

Profiles are stored in:

```text
~/.config/printing-press-clis/instagram/profiles.json
~/.config/printing-press-clis/instagram/sessions/instagram/<profile>
```

Use `SOCIAL_HOME` to move the store for tests or isolated runs.

## Confirm Policy

Default is `autorun`.

```bash
social profile set-policy instagram --profile artist01 --confirm-policy require-confirm --json
```

Per-command override:

```bash
--confirm no
--confirm yes
```
