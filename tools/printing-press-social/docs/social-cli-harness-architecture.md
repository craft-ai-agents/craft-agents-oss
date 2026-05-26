---
status: current
owner: agent
last_verified: 2026-05-21
source_of_truth: true
---

# Social CLI Harness Architecture

## Verdict

Do not start from zero.

Use these as source material, but do not depend on Postiz for execution:

- CLI-Anything: harness/SKILL.md/registry pattern, JSON-first commands, REPL, installable CLI shape.
- Postiz Agent: useful reference for command UX/provider settings, not the runtime.
- Social Poster: useful browser-auth/session/selectors pattern, but smaller and less mature.
- Posta: OpenClaw social skill already positioned as terminal social posting.
- XActions: reusable X/Twitter automation ideas, mostly platform-specific.

No ready-made CLI-Anything social harness was found in CLI-Anything's current skill list. Current slices are direct Instagram, TikTok, X, and YouTube browser harnesses with swappable engines.

## Research Summary

| Project | What It Solves | Reuse | Caution |
|---|---|---|---|
| CLI-Anything | Agent-native CLI harness pattern, generated SKILL.md, REPL, JSON mode, installable commands | Copy architecture style | No major social harness found |
| Postiz Agent | API-backed agent CLI for 28+ platforms, auth, uploads, provider settings, scheduling | Reference only | Not used for this project because execution must be direct |
| Postiz App | Open-source scheduler/API backend | Reference only | AGPL license; not direct platform execution |
| Social Poster | Puppeteer social CLI with sessions, dry-run, multi-platform posting | Reuse browser/session/selector patterns | Low maturity, brittle selectors, not enough queue/profile architecture |
| CloakBrowser | Stealth Chromium, persistent profiles, humanized actions, Playwright-compatible API | Optional local-only engine | Binary is free for internal use but cannot be bundled into a sellable product without extra licensing |
| Obscura | Lightweight Rust headless browser with CDP and stealth positioning | Candidate worker engine | Needs hands-on validation before live social posting |
| Posta | OpenClaw skill for terminal social posting | Study command UX | Appears API-service dependent |
| Juicy | MCP social tools across platforms | Competitive/reference only | MCP-first, not our desired CLI runtime |
| XActions | X automation CLI/MCP/browser scripts | Reuse X primitives ideas | Single-platform and automation-risk heavy |

## Recommended Architecture

Build `social`, an agent-native CLI runtime.

Agents produce action plans. The CLI executes deterministic commands.

Core layers:

1. CLI command runtime
2. profile/session store
3. action schema validator
4. direct browser engine adapters
5. execution workers
6. queue/scheduler
7. structured logs and artifacts

Keep adapters thin. Put orchestration in the runtime, not inside platform workers.

## Command Runtime Design

Command shape:

```bash
social <verb> <platform> [flags]
```

Required global flags:

```bash
--profile <id>
--mode api|browser|hybrid
--json
--dry-run
--queue
--idempotency-key <key>
```

Initial verbs:

```bash
social profile add|list|status|login|logout
social post x|linkedin|facebook|instagram
social upload youtube|tiktok|instagram|facebook
social draft create|validate|preview
social job enqueue|run|status|cancel|retry
social logs tail|show
```

## Social Harness Structure

```text
<platform>-cli/
  package.json
  src/
    cli.ts
    runtime/
      command-registry.ts
      action-schema.ts
      result-schema.ts
      logger.ts
      config.ts
    profiles/
      profile-store.ts
      session-store.ts
      proxy-store.ts
    queue/
      queue.ts
      scheduler.ts
      worker.ts
    adapters/
      browser/
        runner-cdp/
        chrome-devtools/
        stagehand/
        cloakbrowser/
        playwright/
    platforms/
      x/
      youtube/
      tiktok/
      instagram/
      facebook/
      linkedin/
    schemas/
      action.schema.json
      result.schema.json
    skills/
      SKILL.md
    HARNESS.md
```

## Profile And Session Architecture

Profile is the unit of identity.

```json
{
  "id": "artist01",
  "platform": "x",
  "modePreference": "browser",
  "proxyId": "proxy-us-1",
  "sessionRef": "encrypted-session-id",
  "ratePolicy": "normal"
}
```

Store:

- MVP: JSON profile store plus persistent browser sessions under user config.
- Sessions: persistent browser profile per social profile, never project-local by default.
- Secrets: OS keychain when possible.
- Never store plaintext passwords.

## Action Schema

Every executable action should compile to this shape:

```json
{
  "actionId": "act_123",
  "verb": "post",
  "platform": "x",
  "profile": "artist01",
  "mode": "hybrid",
  "payload": {
    "text": "new drop tonight",
    "media": []
  },
  "options": {
    "dryRun": false,
    "scheduledAt": null,
    "idempotencyKey": "artist01-x-20260521-001"
  }
}
```

## Browser Worker Design

Use a browser-engine abstraction. `runner-cdp` is the RunnerOS default: the CLI emits a structured action contract and Runner executes through native browser/CDP tools. `chrome-devtools` and `stagehand` are forward lanes. `playwright` is legacy standalone fallback only. CloakBrowser stays optional/local-only.

Worker responsibilities:

- load profile storage state
- open isolated browser context
- execute one primitive
- capture screenshot/trace on failure
- return structured result

Supported primitives:

```bash
login
post-text
upload-video
upload-image
comment
like
follow
read-notifications
```

Browser fallback should be scoped to owned accounts and human-approved workflows. Rate limits and platform rules belong in policy, not prompts.

## API Worker Design

No API worker in the Instagram MVP.

Reason: user wants direct execution. Use Playwright persistent sessions first. Official APIs can be added later only where they are truly first-party and useful.

## Command Examples

```bash
social profile add instagram --profile artist01 --json
social profile login instagram --profile artist01
social profile status instagram --profile artist01 --live --json
social post instagram --profile artist01 --text "new drop tonight" --media image.jpg --dry-run --json
social comment instagram --profile artist01 --url "https://www.instagram.com/p/..." --text "comment" --dry-run --json
social dm instagram --profile artist01 --to username --text "message" --dry-run --json

social profile add tiktok --profile creator01 --json
social profile login tiktok --profile creator01
social post tiktok --profile creator01 --text "new clip" --media video.mp4 --dry-run --json
social comment tiktok --profile creator01 --url "https://www.tiktok.com/@user/video/123" --text "comment" --dry-run --json
social dm tiktok --profile creator01 --to username --text "message" --dry-run --json

social profile add x --profile artist01 --json
social profile login x --profile artist01
social post x --profile artist01 --text "post text" --dry-run --json
social comment x --profile artist01 --url "https://x.com/user/status/123" --text "reply" --dry-run --json
social dm x --profile artist01 --to username --text "message" --dry-run --json

social profile add youtube --profile channel01 --json
social profile login youtube --profile channel01
social post youtube --profile channel01 --post-type video --text "Full video title" --media video.mp4 --visibility public --dry-run --json
social post youtube --profile channel01 --post-type short --text "Short title" --media short.mp4 --visibility public --dry-run --json
social comment youtube --profile channel01 --url "https://www.youtube.com/watch?v=..." --text "comment" --dry-run --json
```

## Queue System Design

MVP:

- SQLite `jobs` table
- single local worker
- retries with exponential backoff
- idempotency key required for publish actions

Later:

- Redis + BullMQ
- distributed browser workers
- per-profile concurrency locks
- dead-letter queue

Job statuses:

```text
queued -> running -> succeeded
queued -> running -> retrying -> failed
queued -> cancelled
```

## Scheduling Design

MVP:

- `run_at` timestamp in SQLite
- `social worker run` polls due jobs
- scheduler is local and inspectable

Later:

- cron-like schedules
- campaign batches
- approval gates
- local browser-worker scheduling

## Logging And Telemetry

Every command writes:

- JSON result to stdout with `--json`
- JSONL event log under `.social/logs/`
- screenshots/traces for browser failures
- input action snapshot for replay

Result schema:

```json
{
  "ok": true,
  "actionId": "act_123",
  "jobId": null,
  "platform": "x",
  "profile": "artist01",
  "mode": "browser",
  "status": "succeeded",
  "externalId": "platform-post-id",
  "artifacts": []
}
```

## Recommended Stack

- Language: TypeScript
- CLI: `commander` or `yargs`
- Validation: `zod`
- Browser: Playwright
- Storage: SQLite
- Queue MVP: SQLite worker
- Queue later: BullMQ + Redis
- Logs: JSONL
- Tests: Vitest + Playwright traces
- Packaging: npm global binary first; CLI-Anything-style SKILL.md/HARNESS.md included

## MVP Roadmap

### Phase 1

Build runtime only:

- `social` CLI shell
- command registry
- action/result schemas
- profile store
- JSON output
- dry-run
- SQLite job table
- direct Instagram browser adapter
- direct TikTok browser adapter

### Phase 2

Browser foundation:

- Playwright worker
- per-profile storage state
- screenshots/traces
- X text post primitive
- LinkedIn text post primitive

### Phase 3

Media platforms:

- add direct browser adapters platform by platform
- use official APIs later only when they improve reliability without losing direct control

### Phase 4

Agent usability:

- generate `HARNESS.md`
- generate `SKILL.md`
- examples library
- REPL mode
- command discovery

## Immediate Build Order

1. Create TypeScript CLI package.
2. Implement schemas and `--json`.
3. Implement direct per-platform login/session store.
4. Implement direct per-platform dry-runs.
5. Implement direct per-platform post/comment/DM primitives.
6. Add queue table and local worker.

## Sources

- CLI-Anything: https://github.com/HKUDS/CLI-Anything
- Postiz Agent: https://github.com/gitroomhq/postiz-agent
- Postiz App: https://github.com/gitroomhq/postiz-app
- Social Poster: https://github.com/profullstack/social-poster
- Posta: https://clawhub.ai/stgime/posta
- Juicy: https://juicy.sh/
- XActions: https://github.com/nirholas/XActions
