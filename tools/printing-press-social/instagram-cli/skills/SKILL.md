---
name: social-instagram
description: Agent-native Instagram CLI harness for deterministic direct browser profile, dry-run, and posting commands.
---

# Social Instagram

Use this skill when an agent needs to operate Instagram through deterministic commands instead of controlling the browser itself.

Use `social` when the root package is installed. Use `instagram-social` when only the standalone Instagram package is installed.

## Required Pattern

Always dry-run before live execution:

```bash
social post instagram --profile artist01 --text "caption" --media image.jpg --dry-run --json
```

Then execute live. Profiles default to `autorun`.

```bash
social post instagram --profile artist01 --text "caption" --media image.jpg --json
```

## Profile Setup

```bash
social profile add instagram --profile artist01 --json
social profile set-policy instagram --profile artist01 --confirm-policy require-confirm --json
social profile login instagram --profile artist01
social profile status instagram --profile artist01 --live --json
```

## Comments And DMs

```bash
social comment instagram --profile artist01 --url "https://www.instagram.com/p/..." --text "comment" --dry-run --json
social dm instagram --profile artist01 --to username --text "message" --dry-run --json
```

## Notes

- Current bundled implementation uses Playwright as the OSS baseline.
- CloakBrowser is optional local-only because its binary cannot be bundled into a sellable product without extra licensing.
- Browser harness/CDP should be the long-term clean engine.
- New profiles default to `autorun`.
- Use `--confirm no` or `require-confirm` only when the user asks for a brake.
- Live Instagram posts require media.
- JSON output is the stable contract for agents.
