# Handoff: RunnerOS General Continuation

## Mission
RunnerOS is a local Electron/Bun/TypeScript agent workspace app forked from Craft Agents. The current product direction is an operator-style desktop app where HNIC/Concierge can create agents, workflows, automations, sources/tools, and run multi-step workflows across multiple workspaces. The immediate goal is to keep workflow/runtime reliability tight, avoid breaking workspace/global-library semantics, and continue with small verified product improvements.

## Current State
- Repo: `/Users/michaelb.williams/RunnerOS`
- Branch: `main`
- Working tree should be clean after the latest handoff/UI commit. Verify with `git status --short`.
- App was relaunched successfully with `bun run electron:start` after a top-bar icon change. Build completed; Electron is running.
- User’s product rule: workflow steps may use global agents, but those agents must not silently lose declared skills/sources/tools in a workspace. If a global agent depends on a source/tool that is not active/authenticated/usable in the current workspace, fail clearly before the workflow starts.

## Tech Stack
- Monorepo: Bun workspaces, TypeScript, React, Electron, Vite.
- Backend/runtime: `packages/server-core`, `packages/session-tools-core`, `packages/shared`.
- UI: `apps/electron/src/renderer`.
- Agent/workflow/source storage is mostly filesystem-backed under user config dirs.
- Main verification commands: `bun test ...`, `bun run typecheck:all`, `bun run typecheck:electron`, `bun run electron:start`.

## Key Files To Read First
- `/Users/michaelb.williams/RunnerOS/packages/server-core/src/workflows/runner.ts` — workflow run lifecycle, preflight hook, rerun path.
- `/Users/michaelb.williams/RunnerOS/packages/server-core/src/sessions/SessionManager.ts` — workflow runner wiring, agent option resolution, Pulse dispatch.
- `/Users/michaelb.williams/RunnerOS/packages/server-core/src/handlers/rpc/workflow-runs.ts` — manual start/resume RPC guards.
- `/Users/michaelb.williams/RunnerOS/packages/server-core/src/pulses/PulseExecutor.ts` — Pulse kick_workflow failure reporting.
- `/Users/michaelb.williams/RunnerOS/packages/server-core/src/workflows/runner.test.ts` — focused workflow tests.
- `/Users/michaelb.williams/RunnerOS/packages/server-core/src/pulses/PulseExecutor.test.ts` — focused Pulse tests.
- `/Users/michaelb.williams/RunnerOS/docs/creator-skills/04-workflow-creator.md` — updated docs for live `create_workflow` behavior.
- `/Users/michaelb.williams/RunnerOS/apps/electron/src/renderer/components/app-shell/TopBar.tsx` — recent UI tweak: Craft menu icon changed from Craft symbol to plus.

## Recent Accomplishments
- Committed and pushed before this handoff:
  - `30052d7 Harden workflow creation and activation`
  - `74d50c9 Fix global source enabled state`
  - `502d3aa Add Field Theory source`
  - `a9bdd29 Use icon-only response actions`
  - `6f4db1c Fix dev app root resolution`
- Current session workflow reliability work committed as `40317eb Harden workflow run preflight`:
  - Workflow start now preflights step agents before persisting a `running` run.
  - Rerun/resume now preflights rerun step agents before persisting.
  - RPC resume now re-checks workspace activation and current trigger input validity before rerun.
  - Pulse `kick_workflow` now reports concrete dispatch failure reasons instead of always saying the workflow vanished.
  - `SessionManager.resolveAgentSessionOptions()` now fails loudly if a global agent’s declared skills or sources cannot resolve/use in the current workspace.
  - `preflightStepAgent` now uses the full agent session resolution path, so missing skills/sources are caught before workflow start.
- Current session doc/UI work:
  - Workflow creator doc now reflects the real draft-confirm-save `create_workflow` flow. This is included in `40317eb`.
  - Top nav Craft `C` icon was replaced with a plus icon.

## Next Best Actions
1. Review `SessionManager.resolveAgentSessionOptions()` in the latest committed workflow preflight work. Confirm fail-loud behavior is acceptable for all agent launches or only workflow-spawned launches. If too broad, split strict workflow preflight from normal chat session resolution.
2. Add/adjust tests for missing/unusable skill/source preflight. Current runner tests cover missing agent via injected preflight, but not the real `SessionManager` resolver path.
3. Run full verification again after any changes: focused workflow/Pulse tests, `bun run typecheck:all`, and optionally `bun run electron:build`.
4. Commit only new coherent work; the workflow reliability batch is already committed.

## Major Risks / Watchouts
- Do not require workflow step agents to be workspace-active. User explicitly said global agents are fine.
- Do require declared skills/sources/tools to be available in the current workspace. Silent degradation is the bug to prevent.
- The strict missing skill/source check currently lives inside `resolveAgentSessionOptions()`, which is shared by workflow runner step spawning and Pulse driver spawning. Verify it does not accidentally break normal agent chat creation or agents with optional dormant sources.
- Preserve unrelated user/agent changes if new dirty files appear. Do not revert or overwrite unrelated changes.
- `bun run electron:start` is currently a long-running process. Do not leave duplicate Electron instances around if relaunching.
- Root `AGENTS.md` does not exist in the repo, but the user supplied in-thread rules: ultra direct, verify current state, preserve unrelated changes, use `apply_patch`, and keep context tight.

## Commands / Verification
- Already run successfully after the committed workflow backend changes:
  - `bun test packages/server-core/src/workflows/runner.test.ts`
  - `bun test packages/server-core/src/pulses/PulseExecutor.test.ts`
  - `bun run typecheck:all`
- Already run successfully after top-bar UI tweak:
  - `bun run typecheck:electron`
  - `bun run electron:start` rebuilt and relaunched the app.
- First commands for next agent:
  - `git status --short`
  - `git diff --stat`
  - `git diff -- packages/server-core/src/workflows/runner.ts packages/server-core/src/sessions/SessionManager.ts packages/server-core/src/handlers/rpc/workflow-runs.ts packages/server-core/src/pulses/PulseExecutor.ts`
  - `bun test packages/server-core/src/workflows/runner.test.ts packages/server-core/src/pulses/PulseExecutor.test.ts`
  - `bun run typecheck:all`

## Working Rules For The Next Agent
- Be concise and factual. User wants direct execution, not a long advisory essay.
- Read current files before assuming prior chat context is still true.
- Preserve user/agent dirty work unless explicitly asked to revert it.
- Use `rg` for search and `apply_patch` for manual edits.
- Do not make workflow semantics stricter than the user chose: global library agents are valid; missing workspace tool/source readiness is not.
- Prefer small reliability patches over broad architecture rewrites.

## Unknowns
- Whether strict skill/source resolution should apply only to workflow-spawned agents or all hidden agent sessions.
- Whether there are agents with intentionally optional sources that should warn instead of fail.
- Whether strict skill/source resolution should become a workflow-only preflight rather than shared agent-session resolution.
- Whether starter workflow additions should be done next.
