# Codex CLI Plugin

This plugin lets Craft Agents run a session through `codex exec --json` and translate Codex JSON events back into the host chat event model.

Current scope:

- backend contribution id: `codex-cli`
- helper entrypoint: `main.mjs`
- supported flows: session chat, session resume, mini completion, abort

Notes:

- The helper only uses documented `codex exec`, `codex exec resume`, `--json`, `--skip-git-repo-check`, and `--model` surfaces.
- Startup readiness does not require the `codex` binary to be invoked, so plugin discovery/activation can succeed before the first session turn.
- Richer routing, settings, and trust surfaces stay host-owned in later phases.
