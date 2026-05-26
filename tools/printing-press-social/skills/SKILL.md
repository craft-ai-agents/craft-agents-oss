---
name: social-cli-harness
description: CLI-Anything-style root harness for routing agent social commands to platform-specific direct browser CLIs.
---

# Social CLI Harness

Use this skill when an agent needs to operate supported social platforms through deterministic commands.

## Always Use JSON

```bash
social registry --json
social doctor --json
social post instagram --profile artist01 --text "caption" --media image.jpg --dry-run --json
social post tiktok --profile creator01 --text "caption" --media video.mp4 --dry-run --json
social post x --profile artist01 --text "post text" --dry-run --json
social post youtube --profile channel01 --post-type short --text "Short title" --media short.mp4 --dry-run --json
```

## Platform Skills

Read the platform skill before live execution:

- `instagram-cli/skills/SKILL.md`
- `tiktok-cli/skills/SKILL.md`
- `x-cli/skills/SKILL.md`
- `youtube-cli/skills/SKILL.md`

## Safety Rules

- New profiles default to `autorun`; do not ask the user to toggle confirmation repeatedly.
- Run `social doctor --json` before using a freshly installed harness.
- Run `social doctor --live --json` after profile login to verify sessions.
- Default to `runner-cdp` inside RunnerOS. Treat dry-run JSON as the action contract and execute with Runner browser/CDP tools.
- Use `--confirm no` or set profile policy to `require-confirm` only when the user asks for a brake.
- Use valid media paths in dry-runs; dry-run validates obvious impossible inputs.
- Do not operate browser sessions directly when a `social` command exists.
