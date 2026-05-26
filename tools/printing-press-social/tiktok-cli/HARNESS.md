# Social CLI Harness

Current scope: direct TikTok MVP.

The harness exposes deterministic commands for agents. Agents should emit content and action intent; this CLI owns validation, profile lookup, dry-run output, and adapter execution.

## Commands

Root package binary is `social`. Standalone package binary is `tiktok-social` with the same arguments.

```bash
social profile add tiktok --profile artist01 --json
social profile set-policy tiktok --profile artist01 --confirm-policy require-confirm --json
social profile login tiktok --profile artist01
social profile list --json
social profile status tiktok --profile artist01 --live --json
social post tiktok --profile artist01 --text "caption" --media video.mp4 --dry-run --json
social post tiktok --profile artist01 --text "caption" --media video.mp4 --json
social comment tiktok --profile artist01 --url "https://www.tiktok.com/@user/video/123" --text "comment" --dry-run --json
social comment tiktok --profile artist01 --url "https://www.tiktok.com/@user/video/123" --text "comment" --json
social dm tiktok --profile artist01 --to username --text "message" --dry-run --json
social dm tiktok --profile artist01 --to username --text "message" --json
```

## Adapter

Phase 1 uses direct browser automation against TikTok web.

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
~/.config/printing-press-clis/tiktok/profiles.json
~/.config/printing-press-clis/tiktok/sessions/tiktok/<profile>
```

Use `SOCIAL_HOME` to move the store for tests or isolated runs.

## Live Limits

- Posting supports one video file per command.
- Comments need a TikTok video URL.
- DMs depend on account messaging permissions and may fail even with a valid session.

## Confirm Policy

Default is `autorun`.

```bash
social profile set-policy tiktok --profile artist01 --confirm-policy require-confirm --json
```

Per-command override:

```bash
--confirm no
--confirm yes
```
