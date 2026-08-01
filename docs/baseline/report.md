# ARCHstudio OSS — Milestone A Baseline

**Captured:** 2026-07-24 04:36:46 NZST  
**Repository:** `D:\craft-agents-oss`  
**Branch:** `redesign/owner-agent`  
**Upstream commit:** `a60ebc1a5a7cb0a6af7a77d5eed0512c5fc07658` (`v0.11.2`)

## Acceptance summary

| Check | Result |
|---|---|
| Repository is physically on D: | PASS |
| Accidental C: clones removed | PASS |
| Bun installed | PASS — `1.3.10`, matching `.github/workflows/validate*.yml` |
| Dependencies materialized | PASS — 1,650 packages using `bun install --no-save` |
| Tracked lockfile unchanged | PASS |
| Initial Electron build | PASS |
| Vite renderer | PASS — ready on `http://localhost:5173/` |
| Embedded Craft RPC server | PASS — listening on loopback |
| Electron initialization | PASS — `App initialized successfully` |
| Renderer connected to RPC | PASS |
| Visible native window | PASS — owner confirmed the application is open and running |
| Configured provider authentication | PASS |
| Real model response | PASS — Ollama Cloud `glm-5.2`, HTTP 200, exact response `ARCHSTUDIO_BASELINE_OK` |
| Shared targeted tests | PASS — 108 passed, 0 failed |
| Full validation | BASELINE FAILURES — detailed below |

## Runtime evidence

The untouched application completed its development build and remained running under the Hermes-managed background process. Startup logs confirmed:

- bundled `uv.exe` downloaded, checksum-verified, and installed under `apps/electron/resources/bin/win32-x64/`;
- session MCP server built;
- Pi agent server built after Bun was supplied explicitly on `PATH`;
- Vite became ready;
- Craft Agent server listened on loopback;
- an Electron window was created for `My Workspace`;
- renderer WebSocket RPC connected;
- encrypted credential storage loaded the existing `pi-api-key` credential;
- scheduler and persistence remained operational.

The owner independently confirmed the native window was visible and running.

## Provider smoke test

Existing configuration:

- connection: `Ollama Cloud`
- provider type: `pi_compat`
- endpoint: `https://ollama.com/v1`
- model: `glm-5.2`
- credential source: Craft encrypted credential manager

A live chat-completions request returned:

```text
HTTP 200
MODEL glm-5.2
RESPONSE ARCHSTUDIO_BASELINE_OK
```

No credential was printed or written to this repository.

## Dependency installation note

`bun install --frozen-lockfile` failed with both Bun `1.3.14` and the repository CI-pinned Bun `1.3.10` because Bun reported that the lockfile would change on this Windows checkout. Per the two-failure stop rule, that route was abandoned.

Alternative used:

```bash
bun install --no-save
```

This installed dependencies without modifying `bun.lock` or `package.json`.

## Passing tests

`bun run test:shared:all`:

- 20 `llm-connections` tests passed;
- 5 `models-pi` tests passed;
- 83 shared configuration/migration/default-thinking tests passed;
- total: **108 passed, 0 failed**.

`bun run lint:i18n:parity` passed with six locales and 1,640 keys each.

## Baseline validation defects

These defects exist at the untouched upstream commit and were not introduced by redesign work.

### 1. Missing `tsconfig.base.json`

`bun run typecheck:all` fails because multiple tracked package configs extend an untracked/nonexistent root file:

```text
error TS5083: Cannot read file 'D:/craft-agents-oss/tsconfig.base.json'.
```

The missing target also causes fallback compiler settings and secondary errors in dependency declarations, regex target level, Set iteration, and one discriminated-union access.

The Electron dev build tolerates this as an esbuild warning and still runs.

### 2. Document test launcher assumes `python3`

The repository script invokes `python3`, which is unavailable under this Windows Git Bash PATH. Installed interpreters are available as `python` (3.11.15) and `py -3` (3.14.6).

Running the suite manually with `python -m unittest` reached the tests but produced five failures and one setup error:

- Pillow `_imaging` import contamination from the Hermes virtual environment;
- PPTX/image tests inherit the same Pillow issue;
- DOCX smoke fixture invokes a create command without the now-required output option.

This path was stopped after two failures and is recorded for a dedicated compatibility fix.

### 3. Locale sorting drift

`bun run lint:i18n:sorted` reports seven unsorted locale files:

- `de.json`
- `en.json`
- `es.json`
- `hu.json`
- `ja.json`
- `pl.json`
- `zh-Hans.json`

No locale files were auto-rewritten during baseline capture.

### 4. Missing i18n coverage script

`bun run lint:i18n:coverage` references `scripts/check-i18n-coverage.ts`, which is absent from this upstream checkout.

## Working-tree integrity

At baseline completion:

- no product source files were changed;
- `bun.lock` remained unchanged;
- `node_modules` is ignored;
- only `.hermes/plans/` and this `docs/baseline/report.md` are new tracked candidates.

## Milestone A verdict

**PASS for runtime acceptance.** The untouched application builds, launches, connects its renderer/server, loads encrypted provider credentials, and receives a real model response.

**Known upstream validation debt is explicitly baselined** and must be repaired before broad production-code redesign begins so later quality gates can distinguish inherited failures from regressions.
