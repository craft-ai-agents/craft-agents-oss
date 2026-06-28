# Audit: Agents, Connections & Auth Wiring — RunnerOS (creator-command-center)

**Date:** 2026-06-28
**Scope (as requested):** agent definitions/runtime, tool & source connections, auth/OAuth wiring + secrets. Full live vet.
**Method:** static code trace (ripgrep + read) → independent re-verification of every headline claim → live checks (typecheck, unit/integration tests, dependency audit, build-artifact inspection). Three parallel specialist passes, then an adversarial review pass.

> Honesty note up front: a *true* end-to-end GUI run (launch the Electron app, click through an OAuth flow, fire a real agent against a live source) was **not possible in this sandbox** — there is no display and no real credentials. "Live vet" here means: code paths traced to ground truth, the test suite run, the dependency tree audited, and the actual built artifact grepped. Where I could only infer, I say so. Nothing below is asserted as "works" unless I traced it or a test exercised it.

---

## Verdict

The architecture is sound and more mature than the existing `TECH_DEBT_AUDIT.md` implies — the agent → source → backend dispatch path is clean, the credential manager is real (not a doc), token refresh is implemented, and the core packages typecheck clean. But there are **five high-severity wiring/security issues** that will bite real users and one of which (secret baking) is a genuine secret-disclosure risk for any distributed build. There is also **1 failing test** and **49 dependency vulnerabilities (1 critical, 13 high)** in a clean checkout.

This is not "broken," but it is **not safe to ship a public/distributable build as-is**, and two starter agents are wired to capabilities that don't exist.

---

## Findings (severity-ranked)

| ID | Sev | Area | One-line | Evidence |
|---|---|---|---|---|
| SEC-1 | **High** | Secrets | OAuth `client_secret`s (Google/Slack/Microsoft) baked into shipped main bundle at build time | `apps/electron/package.json:19`; `scripts/electron-build-main.ts:54-65`; verified in `apps/electron/dist/main.cjs` |
| SEC-2 | **High** | Secrets | At-rest credential encryption key derived from machine hardware UUID (locally readable); no OS keychain | `packages/shared/src/credentials/backends/secure-storage.ts:7-10,61-99,307-320` |
| AG-1 | **High** | Agents | `hypermotion-agent` (force-loaded every startup) references a skill that doesn't exist (`remotion-production`) | `starter-templates.ts:249`; no such bundled skill; `SessionManager.ts:2415` |
| WIRE-1 | **High** | Agents/Sources | Fail-loud is inconsistent: chat path warns & continues on missing skill-sources; workflows hard-fail | `SessionManager.ts:7011-7013` vs `:2038-2056` + `workflows/runner.ts:351-362` |
| SRC-1 | **High** | Sources | `meta-ads` referenced by a starter agent but not registered as a builtin and never loaded → agent silently has no Meta Ads | `starter-templates.ts:499`; `builtin-sources.ts:1076-1089` |
| DEP-1 | **Med** | Deps | 49 vulnerabilities (1 critical `shell-quote`, 13 high incl. `ws`, `undici`×3, `vite`, `lodash`, `form-data`, `hono`, `tmp`) | `bun audit` (run 2026-06-28) |
| SRC-2 | **Med** | Sources | YouTube source reports `connectionStatus: 'failed'` due to cwd-dependent tool path resolution; failing test in clean checkout | `builtin-sources.ts:156-168,664`; `sources/__tests__/storage.test.ts:609-619` |
| AUTH-1 | **Med** | Auth | Slack OAuth hard-requires an undocumented Cloudflare relay (`RUNNER_SLACK_OAUTH_RELAY_BASE_URL`); throws if unset; not in `.env.example` | `auth/slack-oauth.ts:267-272,361-365` |
| AUTH-2 | **Med** | Auth | Canva: config surface exists (env + Secrets UI) but no OAuth module, source, or consumer → dead integration | `SecretsSettingsPage.tsx:416-427,587`; no `auth/`/`sources/` impl |
| SEC-3 | **Med** | Security | `shell.openExternal` sanitizer is a blocklist, not an allowlist → arbitrary custom URL schemes pass through | `packages/shared/src/utils/url-safety.ts:16-22` |
| SRC-3 | **Med** | Sources | `3d-cell-forge` source hard-codes an absolute personal path; orphaned & non-portable | `sources/3d-cell-forge/config.json:11-12` |
| SRC-4 | **Med** | Sources | `notebooklm` source is valid but fully orphaned (registered nowhere, referenced by nothing) | `sources/notebooklm/config.json` |
| ARCH-1 | **Med** | Sources | Repo-root `sources/` is **not a registry** — 5 of 8 entries silently duplicate builtins and are never loaded | `sources/storage.ts:425-445`; `build-server.ts:120-181` |
| SEC-4 | **Low** | Secrets | Server bearer token printed to stdout at bootstrap | `packages/server/src/index.ts:45,360` |
| BUILD-1 | **Low** | Build | Two divergent main-build scripts with inconsistent secret-baking and a misleading comment | `apps/electron/package.json:19` vs `scripts/electron-build-main.ts:51` |
| SRC-5 | **Low** | Sources | `api` metadata on `local`-type builtins is never acted on (implies wiring that doesn't exist) | `builtin-sources.ts:594-601,886-890,972-975` |
| SRC-6 | **Low** | Sources | Slug/dir mismatch: source `open-slide` vs tool dir `open-slide-export` | `builtin-sources.ts:72-84` |
| AG-2 | **Low** | Agents | Dead slugs in Launchpad sort-priority list (`content-genius`, `3d-agent`, `gaygent-master`, …) | `AgentsLaunchpad.tsx:1334-1349` |

---

## How the system actually works (verified)

**Agents.** Two distinct concepts, deliberately separated (`agent-definitions/types.ts:13-15`): *definitions* (personas as `AGENT.md` = YAML frontmatter + prompt, stored at `~/.agents/agents/<slug>/`) and *runtime executors* (`packages/shared/src/agent/`). Schema `AgentMetadata` (`types.ts:31-91`) — agents reference `skills[]` and `sources[]` (validated at runtime), never nested sub-agents. ~25 starter agents ship in code (`starter-templates.ts`). `SessionManager` seeds the library on startup (`SessionManager.ts:2402`) and force-ensures a load-bearing subset (`:2410-2426`).

**Backend dispatch is clean.** `agent/backend/factory.ts:132-144` switches on provider: `anthropic` → `ClaudeAgent` (Claude Agent SDK), `pi` → `PiAgent` (Pi SDK), else throws. Provider derived from the LLM connection's `providerType` (`factory.ts:251-266`), default anthropic. No issues here.

**Sources vs tools.** A *source* (slug + auth model + guide) has three forms via `config.type`: `mcp` (spawns/connects MCP server), `api` (in-process API tool server with refreshing token getter), `local` (a CLI in `tools/<name>/` the agent drives via the Bash tool, gated by `permissions.json`). The **real registry is hard-coded** in `builtin-sources.ts` (`isBuiltinSource()` allow-list, `:1076-1089` — 12 builtins). Workspace/global sources load from the runtime workspace dir (`~/.craft-agent/...`, `sources/storage.ts:425-445`), **not** the repo-root `sources/` folder. Session wiring: `getSourcesBySlugs()` → `buildServersFromSources()` → `SourceServerBuilder.buildAll()` (`server-builder.ts:299-331`), which dispatches `mcp`/`api` and **skips `local`** (local tools reach the agent only via guide text + Bash).

**Credentials are real.** AES-256-GCM encrypted file at `~/.craft-agent/credentials.enc` (mode 0600). Backend precedence: encrypted store (priority 100) > env var fallback (priority 10, read-only). Per-provider OAuth with PKCE for Google & Microsoft, token refresh with in-flight dedup to survive Microsoft refresh-token rotation. The zero-secrets "vault" spec is genuinely implemented (`credentials/manager.ts:196-254`, masked previews, tests in `credentials/user-secrets.test.ts`).

---

## Detail on the high-severity findings

### SEC-1 — OAuth secrets baked into the build (High)
Two build paths inject secrets into the **main-process** bundle via esbuild `--define`:
- `apps/electron/package.json:19` bakes `GOOGLE_OAUTH_CLIENT_SECRET` **and** `SLACK_OAUTH_CLIENT_SECRET` (+ IDs).
- `scripts/electron-build-main.ts:54-65` bakes `SLACK_OAUTH_CLIENT_SECRET` **and** `MICROSOFT_OAUTH_CLIENT_SECRET`.

Proven in the actual artifact — `apps/electron/dist/main.cjs` contains the literal string `GOOGLE_OAUTH_CLIENT_SECRET="YOUR_CLIENT_SECRET"`. The current artifact holds only the `.env` *placeholder*, so **no real secret leaks today** — but the mechanism embeds whatever `.env` contains as a string constant. Any signed distributable built with real secrets ships those secrets, extractable by unpacking the asar and grepping. This is the main process (not the renderer — renderer/preload bundles were verified clean), so it's not XSS-exposed, but for a public desktop app a confidential `client_secret` in the binary is still a disclosure.
**Fix:** never bake confidential secrets client-side. Use public client IDs in-app; move secret-bearing token exchange to the OAuth relay/server, or require per-source user-provided secrets only. Remove the secret `--define`s from both paths and add a CI assertion that the bundle contains no `*_SECRET=`.

### SEC-2 — Weak at-rest key derivation (High)
`secure-storage.ts` derives the encryption key as `PBKDF2(SHA-256(hardware-UUID + "craft-agent-v2"), salt, 100k)` (`:307-320`), where the "secret" is the machine's hardware UUID (`IOPlatformUUID` / Windows `MachineGuid` / `/etc/machine-id`) — **readable by any local process or user**, and the salt is stored in the same file. There is **no `safeStorage`/keychain usage anywhere** (grep: zero hits). Net: protects against off-box file theft, not against any code/user on the same machine. A weaker `username+homedir` fallback exists (`:98`).
**Fix:** use Electron `safeStorage` (Keychain / DPAPI / libsecret) as the primary key source; fall back to the current scheme only when unavailable.

### AG-1 — Force-loaded agent references a non-existent skill (High)
`hypermotion-agent` declares `skills: ['hyperframes', 'remotion-production']` (`starter-templates.ts:249`) and is force-ensured on every startup (`SessionManager.ts:2410-2426`). The bundled-skill set has `hyperframes` but **no `remotion-production`** (verified: `ls packages/shared/src/skills/bundled/` — 39 skills, not present). Worse, a test *asserts* the dangling reference rather than catching it (`agent-definitions/storage.test.ts`, the hypermotion case passes). Combined with WIRE-1: launching this agent from a workflow throws "references unavailable skills"; from chat it silently drops the skill. Either way the advertised capability never exists.
**Fix:** add the `remotion-production` skill or remove it from the agent (fold into `hyperframes`); update the test to validate skill existence.

### WIRE-1 — Inconsistent fail-loud (High)
The stated product invariant (HANDOFF.md) is "missing required sources/skills should fail before execution." Workflows honor it: `resolveAgentSessionOptions` runs `strict` and throws on missing skills (`SessionManager.ts:2038-2040`) or sources (`:2050-2056`), called as preflight by the workflow runner (`workflows/runner.ts:351-362`). But the **interactive chat** path never calls that strict resolver — it computes skill-required sources inline and, for missing/unauthenticated ones, only logs a warning and proceeds (`SessionManager.ts:7011-7013`). The `referenceMode:'lenient'` escape hatch exists but no caller uses it, so this asymmetry is accidental, not a design choice. Same agent config → clean failure in a workflow, silent degradation in chat.
**Fix:** route interactive launches through the same preflight; make required-capability failures non-downgradeable regardless of launch origin.

### SRC-1 — `meta-ads` orphaned but referenced (High)
A growth/ads starter agent declares `sources: ['meta-ads', 'google-ads']` (`starter-templates.ts:499`). `google-ads` resolves via builtin; `meta-ads` is **not** in `isBuiltinSource()` and the repo-root `sources/meta-ads/` triad is never loaded (repo-root `sources/` is not a registry — see ARCH-1). The agent silently gets no Meta Ads source unless the user hand-creates it in their workspace.
**Fix:** promote `meta-ads` to a builtin (factory + allow-list entry), or seed it into new workspaces, or drop it from the template.

---

## Live check results (run 2026-06-28)

**Typecheck (`tsc --noEmit`) — clean** on every core package audited:
`packages/shared` ✓ · `packages/core` ✓ · `packages/session-tools-core` ✓ · `packages/server-core` ✓ (0 errors each).
Not run this pass: `server`, `pi-agent-server`, `apps/electron`, `packages/ui`, `viewer`, `webui` (time/scope).

**Tests (`bun test`):**
- `agent-definitions/storage.test.ts` — **46/46 pass**.
- `credentials` + `auth` + `sources` — **344 pass, 1 fail**.
  - Failure: `getSourcesBySlugs > marks saved youtube-research key as untested until runtime validation` — expects `connectionStatus: 'untested'`, gets `'failed'`. Root cause (traced): tool path resolves via `CRAFT_RESOURCES_BASE`/`CRAFT_APP_ROOT`/`process.cwd()` (`builtin-sources.ts:156-168`); under `bun test` cwd is `packages/shared`, so `existsSync(toolPath)` is false → `'failed'` (`:664`). This is SRC-2: a brittle contract where local sources falsely report "failed" whenever the process cwd/env isn't the app root. In dev/packaged builds it usually resolves, but the test is red in a clean checkout and the fragility is real.

**Dependency audit (`bun audit`): 49 vulnerabilities — 1 critical, 13 high, 28 moderate, 7 low** (DEP-1). Improved from the 136 in the May audit, but still: critical `shell-quote` (newline escaping), high `ws` (DoS), `undici` ×3 (TLS bypass / DoS / proxy routing), `vite` (`server.fs.deny` bypass), `lodash` (`_.template` code injection), `form-data` (CRLF injection), `hono` (CORS wildcard+credentials), `tmp` (path traversal), `protobufjs`, `linkify-it`.
**Fix:** `bun update` for compatible bumps; manually bump `ws`, `undici`, `vite`, `lodash`, `shell-quote` to patched majors and re-audit as a CI gate.

---

## What I could NOT verify (and why)
- **True GUI end-to-end** (launch app, complete a real OAuth consent, run an agent against a live source) — no display/credentials in this environment. Verified by code trace + tests + artifact grep instead.
- **Whether the release pipeline injects real secrets** into builds (SEC-1) — no CI secrets visible in-repo; the risk is mechanism-proven, the live exposure is inferred.
- **Slack OAuth relay server** (external Cloudflare worker) — not in this repo; can't audit how it handles the code/secret.
- **Functional `doctor` runs of each tool CLI** — bins verified present on disk; not all executed.
- **Zero CLI install/wallet RPCs** — the `user_secret` vault core is verified; the Zero-CLI install path was not traced end-to-end.

---

## Recommended remediation order
1. **SEC-1** stop baking OAuth secrets into the build (blocks safe distribution).
2. **AG-1 + SRC-1** fix the two starter agents wired to non-existent capabilities (`remotion-production`, `meta-ads`) — users hit these immediately.
3. **WIRE-1** unify fail-loud across chat and workflow launches.
4. **SEC-2** move to OS keychain via `safeStorage`.
5. **DEP-1** patch the critical/high dependencies and gate `bun audit` in CI.
6. **SRC-2 / AUTH-1 / AUTH-2** fix the brittle tool-path contract, document the Slack relay var, and either implement or remove Canva.
7. Low items (SEC-3/4, BUILD-1, SRC-3/4/5/6, AG-2, ARCH-1) as cleanup.
