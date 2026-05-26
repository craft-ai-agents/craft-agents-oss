---
name: social-x
description: Agent-native X CLI harness for deterministic direct browser profile, dry-run, and posting commands.
---

# Social X

Use this skill when an agent needs to operate X through deterministic commands instead of controlling the browser itself.

Use `social` when the root package is installed. Use `x-social` when only the standalone X package is installed.

## Required Pattern

Always dry-run before live execution:

```bash
social post x --profile artist01 --text "post text" --dry-run --json
social post x --profile artist01 --text "post text" --media image.jpg --dry-run --json
```

Then execute live. Profiles default to `autorun`.

```bash
social post x --profile artist01 --text "post text" --json
```

## Profile Setup

```bash
social profile add x --profile artist01 --json
social profile set-policy x --profile artist01 --confirm-policy require-confirm --json
social profile login x --profile artist01
social profile status x --profile artist01 --live --json
```

## Comments And DMs

```bash
social comment x --profile artist01 --url "https://x.com/user/status/123" --text "reply" --dry-run --json
social dm x --profile artist01 --to username --text "message" --dry-run --json
```

## Notes

- Current bundled implementation uses Playwright as the OSS baseline.
- CloakBrowser is optional local-only because its binary cannot be bundled into a sellable product without extra licensing.
- Browser harness/CDP should be the long-term clean engine.
- New profiles default to `autorun`.
- Use `--confirm no` or `require-confirm` only when the user asks for a brake.
- X posts can be text-only or media-backed.
- Image posts support up to 4 images; video posts support one video.
- The MVP does not mix image and video media in one post.
- X DMs depend on account messaging permissions.
- JSON output is the stable contract for agents.
