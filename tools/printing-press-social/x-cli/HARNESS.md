# Social CLI Harness

Current scope: direct X MVP.

The harness exposes deterministic commands for agents. Agents should emit content and action intent; this CLI owns validation, profile lookup, dry-run output, and adapter execution.

## Commands

Root package binary is `social`. Standalone package binary is `x-social` with the same arguments.

```bash
social profile add x --profile artist01 --json
social profile set-policy x --profile artist01 --confirm-policy require-confirm --json
social profile login x --profile artist01
social profile list --json
social profile status x --profile artist01 --live --json
social post x --profile artist01 --text "post text" --dry-run --json
social post x --profile artist01 --text "post text" --media image.jpg --json
social comment x --profile artist01 --url "https://x.com/user/status/123" --text "reply" --dry-run --json
social comment x --profile artist01 --url "https://x.com/user/status/123" --text "reply" --json
social dm x --profile artist01 --to username --text "message" --dry-run --json
social dm x --profile artist01 --to username --text "message" --json
```

## Adapter

Phase 1 uses direct browser automation against X web.

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
~/.config/printing-press-clis/x/profiles.json
~/.config/printing-press-clis/x/sessions/x/<profile>
```

Use `SOCIAL_HOME` to move the store for tests or isolated runs.

## Live Limits

- Posts can be text-only or media-backed.
- Image posts support up to 4 image files.
- Video posts support one video file.
- The MVP does not mix image and video media in one post.
- Replies need an X status URL.
- DMs depend on account messaging permissions and may fail even with a valid session.

## Confirm Policy

Default is `autorun`.

```bash
social profile set-policy x --profile artist01 --confirm-policy require-confirm --json
```

Per-command override:

```bash
--confirm no
--confirm yes
```
