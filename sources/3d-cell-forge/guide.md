# 3DCellForge

3DCellForge is installed locally at `/Users/michaelb.williams/Creative Gen/3DCellForge` and should be operated through its CLI JSON interface.

## Scope

- Treat this as a local creative-generation CLI tool, not an MCP server and not a provider SDK.
- RunnerOS exposes this source through source context plus Bash permissions. Use the Bash tool for the documented `3d` commands; do not expect an `mcp__3d-cell-forge__...` tool.
- Primary command: `3d`
- Fallback command: `node "/Users/michaelb.williams/Creative Gen/3DCellForge/bin/3d.mjs"`
- Keep provider keys in `/Users/michaelb.williams/Creative Gen/3DCellForge/.env.local`.
- Do not put provider keys in RunnerOS source config, frontend code, or committed files.

## Commands

- Help: `3d help`
- Backend: `3d api`
- Frontend: `3d dev`
- Health: `3d health --json`
- Generate: `3d generate --image <path> --provider rodin --json`
- Status: `3d status --task <taskId> --provider rodin --json`
- Import model: `3d import --model <path.glb> --json`
- Test: `3d test`
- Build: `3d build`

## Guidelines

- Use `3d health --json` before generation work.
- If health fails because the backend is down, start it with `3d api`, then rerun `3d health --json`.
- Start the backend with `3d api` when API commands need the local server.
- Start the frontend with `3d dev` only when the user needs the UI.
- Use `--json` commands for automation and parse structured output instead of scraping text.
- Generation may call paid or quota-limited providers, and import mutates local project state. Confirm before running `3d generate` or `3d import` unless the user already asked for that exact action.
- If `3d` is missing from PATH, run `cd "/Users/michaelb.williams/Creative Gen/3DCellForge" && npm run cli:install` or use the direct fallback command.

## Validation

Use:

```bash
3d help
3d health --json
cd "/Users/michaelb.williams/Creative Gen/3DCellForge" && npm run test && npm run build
```
