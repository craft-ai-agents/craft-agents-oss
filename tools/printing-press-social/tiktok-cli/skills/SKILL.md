---
name: social-tiktok
description: Agent-native TikTok CLI harness for deterministic direct browser profile, dry-run, and posting commands.
---

# Social TikTok

Use this skill when an agent needs to operate TikTok through deterministic commands instead of controlling the browser itself.

Use `social` when the root package is installed. Use `tiktok-social` when only the standalone TikTok package is installed.

## Required Pattern

Always dry-run before live execution:

```bash
social post tiktok --profile artist01 --text "caption" --media video.mp4 --dry-run --json
```

Then execute live. Profiles default to `autorun`.

```bash
social post tiktok --profile artist01 --text "caption" --media video.mp4 --json
```

## Profile Setup

```bash
social profile add tiktok --profile artist01 --json
social profile set-policy tiktok --profile artist01 --confirm-policy require-confirm --json
social profile login tiktok --profile artist01
social profile status tiktok --profile artist01 --live --json
```

## Comments And DMs

```bash
social comment tiktok --profile artist01 --url "https://www.tiktok.com/@user/video/123" --text "comment" --dry-run --json
social dm tiktok --profile artist01 --to username --text "message" --dry-run --json
```

## Notes

- Current bundled implementation uses Playwright as the OSS baseline.
- CloakBrowser is optional local-only because its binary cannot be bundled into a sellable product without extra licensing.
- Browser harness/CDP should be the long-term clean engine.
- New profiles default to `autorun`.
- Use `--confirm no` or `require-confirm` only when the user asks for a brake.
- Live TikTok posts require media.
- Live TikTok posts currently support one video file.
- TikTok DMs depend on account messaging permissions.
- JSON output is the stable contract for agents.
