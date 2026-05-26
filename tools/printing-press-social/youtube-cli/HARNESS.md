# Social CLI Harness

Current scope: direct YouTube MVP.

The harness exposes deterministic commands for agents. Agents should emit content and action intent; this CLI owns validation, profile lookup, dry-run output, and adapter execution.

## Commands

Root package binary is `social`. Standalone package binary is `youtube-social` with the same arguments.

```bash
social profile add youtube --profile channel01 --json
social profile set-policy youtube --profile channel01 --confirm-policy require-confirm --json
social profile login youtube --profile channel01
social profile list --json
social profile status youtube --profile channel01 --live --json
social post youtube --profile channel01 --post-type video --text "Full video title" --description "description" --media video.mp4 --visibility public --dry-run --json
social post youtube --profile channel01 --post-type short --text "Short title" --media short.mp4 --visibility public --dry-run --json
social comment youtube --profile channel01 --url "https://www.youtube.com/watch?v=..." --text "comment" --dry-run --json
social comment youtube --profile channel01 --url "https://www.youtube.com/watch?v=..." --text "comment" --json
```

## Adapter

Phase 1 uses direct browser automation against YouTube web.

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
~/.config/printing-press-clis/youtube/profiles.json
~/.config/printing-press-clis/youtube/sessions/youtube/<profile>
```

Use `SOCIAL_HOME` to move the store for tests or isolated runs.

## Live Limits

- Upload supports one video file per command.
- `--post-type video` is for full YouTube videos.
- `--post-type short` / `shorts` marks the upload intent as a Short. YouTube still decides eligibility from the actual video format/duration.
- `--visibility` supports `private`, `unlisted`, or `public`; default is `private`.
- Comments need a YouTube video URL.
- YouTube DMs are not exposed because YouTube does not provide a normal creator DM surface.

## Confirm Policy

Default is `autorun`.

```bash
social profile set-policy youtube --profile channel01 --confirm-policy require-confirm --json
```

Per-command override:

```bash
--confirm no
--confirm yes
```
