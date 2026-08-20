# A0 Live Preflight (R-026) — 2026-08-13

READ-ONLY probe. No Hermes/OMP/Tailscale mutations. No secret values recorded.

## Timestamp

| Field | Value |
|-------|-------|
| UTC | `2026-08-13T08:13:05Z` (probe start) |
| UTC (close) | `2026-08-13T08:16:03Z` |
| Hermes | `v0.20.0 (2026.8.3)` · upstream `c0106e50` · install method `git` |
| Hermes version exit | `0` |
| Note | 1 commit behind upstream (update available) |

## Doctor

| Metric | Count |
|--------|------:|
| OK (✓ lines) | 72 |
| Warnings (⚠ lines) | 17 |
| Fails (✗/FAIL lines) | 0 |
| Output lines | 143 |
| Exit code | `0` |

Notable warning classes (names only, no secrets): optional package missing (`discord.py`); config version outdated (v33→v34); auth not logged in (Nous Portal, MiniMax OAuth); connectivity HTTP 403 (gemini, xai endpoints in connectivity batch); system dependency not met for several optional tool plugins (bfl, browser, browser-cdp, google_meet, hermes-yuanbao, homeassistant, image_gen, spotify).

## Config getback

| Key | Value | Exit |
|-----|-------|-----:|
| `approvals.mode` | `off` | 0 |
| `security.redact_secrets` | `true` | 0 |
| `security.tirith_enabled` | `true` | 0 |
| `security.tirith_fail_open` | `true` | 0 |
| `security.allow_private_urls` | `true` | 0 |
| `skills.write_approval` | `false` | 0 |
| `memory.write_approval` | `false` | 0 |

## Gateway

| Field | Value |
|-------|-------|
| Supervised by launchd | yes (PID present) |
| Service definition | stale relative to current Hermes install (status warns to run `hermes gateway start`) |
| `gateway_state` | `running` |
| Platform count | 3 |
| Connected (state file) | 3 |
| Disconnected (state file) | 0 |
| Exit code (`hermes gateway status`) | `0` |

### Connected / disconnected by channel name (state file)

| Channel | State | error_code |
|---------|-------|------------|
| Telegram | connected | none |
| Feishu | connected | none |
| Buzz | connected | none |

### Directory entry counts (names only; no IDs)

| Channel | Entries |
|---------|--------:|
| Telegram | 3 |
| Feishu | 5 |
| Buzz | 1 |

### Deep status note (non-secret)

`--deep` log sample showed Telegram network timeouts / reconnect attempts and Buzz WebSocket disconnect retries around probe time, while `gateway_state.json` still reported all three platforms `connected`. Counts above use the state-file snapshot, not log heuristics.

## Syncthing

| Check | Result |
|-------|--------|
| `which syncthing` | not found (exit 1) |
| `command -v syncthing` | not found (exit 1) |
| `brew list syncthing` | cask metadata present for `syncthing-app` 2.0.14-1 (app bundle path under Caskroom); CLI binary not on PATH |
| Started | **no** (hard stop honored) |

## Tailscale (counts)

| Field | Value |
|-------|-------|
| BackendState | `Running` |
| Self.HostName | `tb` |
| Self.Online | `true` |
| Peer count | `600` |
| IPs / keys / peer name list | **not recorded** |

## File modes

| Path (basename only where sensitive) | Exists | Mode (`%Lp`) |
|--------------------------------------|--------|--------------|
| `~/.hermes/state/tskey-api.secret` | yes | `600` |
| `~/.hermes/.env.backup.telegram_home.20260708_103002` | yes | `644` |
| `~/.hermes/.env.backup.20260708_100905` | yes | `644` |

Contents not read. Modes only.

## Cron error counts

| Metric | Count |
|--------|------:|
| Jobs listed | 18 |
| Last status `ok` | 16 |
| Last status `error` | 2 |
| Last status unknown | 0 |
| `hermes cron list` exit | `0` |

### Jobs with last status (name + status only)

| Last status | Job name |
|-------------|----------|
| ok | Hermes doctor watchdog → Telegram |
| ok | Hermes disk watchdog → Telegram |
| ok | Hermes self-health watchdog → Telegram |
| ok | Hermes credential watchdog → Telegram |
| ok | Hermes daily advanced brief → Telegram |
| error | Hermes weekly surface diff → Telegram |
| ok | Hermes safe smoke-test → Telegram |
| ok | Hermes post-update startup optimizer → Telegram |
| ok | Things 3 → Lark Tasks mirror |
| ok | Daily Lark morning brief |
| ok | Daily Hermes automation audit → Lark |
| ok | Hermes OPEN session janitor |
| ok | Hermes dirty active-work resume ping |
| ok | cmux inventory → state file |
| ok | cmux inventory → Lark DM |
| ok | Codex 401 auth watchdog |
| ok | ROX surfaces health → Telegram |
| error | omniroute-gcs-snapshot-3h |

Error class summary (no secrets): one billing/credits RuntimeError (HTTP 403 personal-team spending limit); one script exit code 1 (GCS snapshot PERMISSION_DENIED / billing).

## Surface counts if any

| Field | Value |
|-------|-------|
| `discover_surface.py` path present | yes |
| Invoked | yes (read-only intent: `--home`, `--audit-root`, `--output /tmp/hma-a0-preflight-surface`) |
| Exit | `1` |
| Project count | **unavailable** |
| Classification A/B/C/D counts | **unavailable** |
| Failure | First run: `NameError: name 're' is not defined`. `import re` added to the audit helper. Full `$HOME` walk **not** re-run in this session (too broad; would write path lists). Counts still unavailable. |

No secret paths copied. Surface counts not obtained.

## Target identity verdict (FAIL CLOSED)

| Field | Verdict |
|-------|---------|
| Exact source node | **unresolved** |
| Exact target node | **unresolved** |
| ACL / source-target diff | **not computed** |
| APPLY token | **not issued** |
| Verdict | **FAIL CLOSED** — do not invent a node; migration apply blocked until target identity is explicitly resolved and APPLY is issued |

## Mutations performed

**none**

- No `hermes config set`
- No `hermes pause` / gateway stop
- No chmod on secrets
- No age encrypt
- No `~/.hermes-migration-apply`
- Syncthing not started
- Only write: this report file under `Projects/craft-agents/docs/security/`
- Optional `/tmp/hma-a0-preflight-surface` not produced (script failed before write)

## Exit code rollup

| Command | Exit |
|---------|-----:|
| `date -u` | 0 |
| `hermes version` | 0 |
| `hermes doctor` | 0 |
| `hermes config get` (×7) | 0 each |
| `hermes gateway status` | 0 |
| `hermes cron list` | 0 |
| `which syncthing` | 1 |
| `command -v syncthing` | 1 |
| `brew list syncthing` | 0 (cask listing) |
| `tailscale status --json` parse | 0 |
| `discover_surface.py` | 1 |

## Live reconfirm (goal verification)

| Field | Value |
|---|---|
| UTC | `2026-08-13T08:51:30Z` |
| `approvals.mode` | `off` — matches table above; APPLY + `APPROVE A2 HERMES SMART` did not occur |
| `security.redact_secrets` | `true` |
| `security.tirith_enabled` | `true` |
| `security.tirith_fail_open` | `true` |
| `security.allow_private_urls` | `true` |
| `skills.write_approval` | `false` |
| `memory.write_approval` | `false` |
| `~/.hermes-migration-apply/HMA-20260809-A1/apply.log` | **ABSENT** |
| Syncthing CLI | ABSENT |
| env-backup modes | both `644` |
| Tailscale | Running / `tb` / PeerCount `600` |
| Target | still **FAIL CLOSED** |
