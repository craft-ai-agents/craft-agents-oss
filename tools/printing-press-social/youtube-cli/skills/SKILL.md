---
name: social-youtube
description: Agent-native YouTube CLI harness for deterministic direct browser profile, dry-run, and posting commands.
---

# Social YouTube

Use this skill when an agent needs to operate YouTube through deterministic commands instead of controlling the browser itself.

Use `social` when the root package is installed. Use `youtube-social` when only the standalone YouTube package is installed.

## Required Pattern

Always dry-run before live execution:

```bash
social post youtube --profile channel01 --post-type video --text "Full video title" --description "description" --media video.mp4 --visibility public --dry-run --json
social post youtube --profile channel01 --post-type short --text "Short title" --media short.mp4 --visibility public --dry-run --json
```

Then execute live. Profiles default to `autorun`.

```bash
social post youtube --profile channel01 --post-type video --text "Full video title" --media video.mp4 --visibility public --json
```

## Profile Setup

```bash
social profile add youtube --profile channel01 --json
social profile set-policy youtube --profile channel01 --confirm-policy require-confirm --json
social profile login youtube --profile channel01
social profile status youtube --profile channel01 --live --json
```

## Comments

```bash
social comment youtube --profile channel01 --url "https://www.youtube.com/watch?v=..." --text "comment" --dry-run --json
```

## Notes

- Current bundled implementation uses Playwright as the OSS baseline.
- CloakBrowser is optional local-only because its binary cannot be bundled into a sellable product without extra licensing.
- Browser harness/CDP should be the long-term clean engine.
- New profiles default to `autorun`.
- Use `--confirm no` or `require-confirm` only when the user asks for a brake.
- Live YouTube uploads require one video file.
- Use `--post-type video` for full videos and `--post-type short` for Shorts.
- `--visibility` defaults to `private`; set `public` when the user wants it published publicly.
- YouTube DMs are not exposed because YouTube does not provide a normal creator DM surface.
- JSON output is the stable contract for agents.
