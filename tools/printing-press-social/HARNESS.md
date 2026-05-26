# Printing Press Social Harness

CLI-Anything-style root harness for agent-operated social platforms.

## Core Contract

Agents call one stable root command:

```bash
social <verb> <platform> [flags]
```

The root dispatcher reads `registry.json`, routes to the platform harness, and preserves JSON output.

## Browser Engine Policy

Default engine is `runner-cdp`.

- `runner-cdp`: RunnerOS native browser/CDP execution. CLI dry-runs return the structured action and browser plan.
- `chrome-devtools`: external Chrome DevTools/CDP adapter lane.
- `stagehand`: optional adaptive AI-browser lane.
- `cloakbrowser`: optional local stealth lane.
- `playwright`: legacy standalone fallback only.

## Registry

```bash
social registry --json
social doctor --json
social doctor --live --json
social repl
```

Source of truth:

- `registry.json`
- `schemas/action.schema.json`
- `schemas/result.schema.json`
- `<platform>-cli/HARNESS.md`
- `<platform>-cli/skills/SKILL.md`

## Current Commands

```bash
social post instagram --profile artist01 --text "caption" --media image.jpg --dry-run --json
social comment instagram --profile artist01 --url "https://www.instagram.com/p/..." --text "comment" --dry-run --json
social dm instagram --profile artist01 --to username --text "message" --dry-run --json

social post tiktok --profile creator01 --text "caption" --media video.mp4 --dry-run --json
social comment tiktok --profile creator01 --url "https://www.tiktok.com/@user/video/123" --text "comment" --dry-run --json
social dm tiktok --profile creator01 --to username --text "message" --dry-run --json

social post x --profile artist01 --text "post text" --dry-run --json
social comment x --profile artist01 --url "https://x.com/user/status/123" --text "reply" --dry-run --json
social dm x --profile artist01 --to username --text "message" --dry-run --json

social post youtube --profile channel01 --post-type video --text "Full video title" --media video.mp4 --visibility public --dry-run --json
social post youtube --profile channel01 --post-type short --text "Short title" --media short.mp4 --visibility public --dry-run --json
social comment youtube --profile channel01 --url "https://www.youtube.com/watch?v=..." --text "comment" --dry-run --json
```

## Storage Rule

Sessions default to user config:

```text
~/.config/printing-press-clis/<platform>/
```

Never commit `.social/`, browser profiles, cookies, or session folders.
