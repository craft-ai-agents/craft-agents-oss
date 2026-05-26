# Printing Press Social

Printing Press Social is bundled with RunnerOS at `tools/printing-press-social` and exposes direct-browser social media CLIs for agent-operated channel work.

## Scope

- Treat this as a local CLI harness, not an MCP server and not a platform API wrapper.
- RunnerOS exposes this source through source context plus Bash permissions. Use the Bash tool for documented `social` commands; do not expect an `mcp__printing-press-social__...` tool.
- Primary command from the repo: `node src/social.mjs`
- Preferred working directory: `tools/printing-press-social`
- Supported platforms: `instagram`, `tiktok`, `x`, `youtube`
- Default browser engine inside RunnerOS: `runner-cdp`
- Optional engines: `chrome-devtools`, `stagehand`, `cloakbrowser`, `playwright`
- Browser sessions live under `~/.config/printing-press-clis/<platform>/`.
- Never commit browser profiles, cookies, `.social/`, or session folders.

## Commands

- Registry: `node src/social.mjs registry --json`
- Doctor: `node src/social.mjs doctor --json`
- Live doctor: `node src/social.mjs doctor --live --json`
- Instagram dry-run post: `node src/social.mjs post instagram --profile <profile> --text "<caption>" --media <image> --dry-run --json`
- Instagram dry-run comment: `node src/social.mjs comment instagram --profile <profile> --url "<url>" --text "<comment>" --dry-run --json`
- Instagram dry-run DM: `node src/social.mjs dm instagram --profile <profile> --to <username> --text "<message>" --dry-run --json`
- TikTok dry-run post: `node src/social.mjs post tiktok --profile <profile> --text "<caption>" --media <video> --dry-run --json`
- TikTok dry-run comment: `node src/social.mjs comment tiktok --profile <profile> --url "<url>" --text "<comment>" --dry-run --json`
- TikTok dry-run DM: `node src/social.mjs dm tiktok --profile <profile> --to <username> --text "<message>" --dry-run --json`
- X dry-run post: `node src/social.mjs post x --profile <profile> --text "<post>" --dry-run --json`
- X dry-run reply: `node src/social.mjs comment x --profile <profile> --url "<url>" --text "<reply>" --dry-run --json`
- X dry-run DM: `node src/social.mjs dm x --profile <profile> --to <username> --text "<message>" --dry-run --json`
- YouTube dry-run video: `node src/social.mjs post youtube --profile <profile> --post-type video --text "<title>" --media <video> --visibility public --dry-run --json`
- YouTube dry-run Short: `node src/social.mjs post youtube --profile <profile> --post-type short --text "<title>" --media <video> --visibility public --dry-run --json`
- YouTube dry-run comment: `node src/social.mjs comment youtube --profile <profile> --url "<url>" --text "<comment>" --dry-run --json`

## Guidelines

- Use the built-in `@social-publisher` agent as the single front door for posting across Instagram, TikTok, X, and YouTube.
- Do not create one posting agent per platform by default. Keep platform differences in CLI/browser playbooks unless a dedicated strategy/review agent is needed later.
- Run `node src/social.mjs doctor --json` before any channel work.
- Use `node src/social.mjs doctor --live --json` before claiming a profile is ready for live execution.
- Use `--json` and parse structured output instead of scraping text.
- Dry-run every post, comment, or DM before live execution.
- With `runner-cdp`, treat CLI output as the action contract/plan and execute through Runner's native browser tools.
- Do not run a live post, comment, or DM unless the user has explicitly approved the exact platform, profile, payload, and target URL/recipient.
- Do not default to Computer Use. These CLIs already automate browser execution directly.
- Use Playwright only when explicitly running the standalone fallback engine outside Runner.

## Validation

Use:

```bash
cd tools/printing-press-social && node src/social.mjs registry --json
cd tools/printing-press-social && node src/social.mjs doctor --json
cd tools/printing-press-social && npm test
```
