# Handoff: RunnerOS Concierge Self-Edit Capability Vet

## Mission
RunnerOS is the local Electron/Bun/TypeScript fork of Craft Agents. The current goal is to make Concierge able to guide safe edits to RunnerOS itself through a configured local repo path, without assuming every user has the repo in the same place. The next agent's first job is not to extend the feature; it is to thoroughly vet the self-edit implementation for correctness, blast radius, UX gaps, and security/safety issues.

## Current State
- Repo path: `/Users/michaelb.williams/RunnerOS`
- Branch: `main`
- Working tree is dirty from several recent feature/UI waves. Do not assume every changed file belongs to the self-edit feature.
- Self-edit V1 is backend/shared only. There is no Settings UI yet.
- The feature currently provides:
  - Config shape for `developer.selfEdit`.
  - Pure resolver for global vs workspace self-edit config.
  - Repo validator that checks whether a path looks like RunnerOS.
  - Hidden baked-in `runneros-self-edit` skill.
  - Concierge-only starter metadata for the self-edit skill.
  - Runtime prompt injection with resolved target path, enabled flag, command hints, and validation status when `runneros-self-edit` is active.
- Focused tests and full typecheck passed after this work, but there has not been a fresh adversarial review.

## Tech Stack
- Runtime: Bun, TypeScript, Electron, Vite, React.
- Monorepo workspaces under `packages/*` and `apps/*`.
- Core app areas touched here:
  - `packages/shared` for config, skill, agent runtime, tests.
  - `packages/server-core` for startup seeding/migration.
  - `apps/electron` has unrelated UI/theme work in the dirty tree.
- Build/test tools:
  - `bun test`
  - `bun run typecheck:all`
  - `bun run electron:dev`

## Key Files To Read First
- `/Users/michaelb.williams/RunnerOS/packages/shared/src/config/self-edit.ts` — new resolver and repo validator.
- `/Users/michaelb.williams/RunnerOS/packages/shared/src/agent/base-agent.ts` — injects self-edit target context into the model turn.
- `/Users/michaelb.williams/RunnerOS/packages/shared/src/skills/system.ts` — defines creator/system skill groups and marks `runneros-self-edit` as system-hidden.
- `/Users/michaelb.williams/RunnerOS/packages/shared/src/skills/starter-templates.ts` — embeds the new `RunnerOS Self Edit` SKILL.md.
- `/Users/michaelb.williams/RunnerOS/packages/shared/src/agent-definitions/starter-templates.ts` — gives Concierge the full system skill set; Orchestrator only creator/meta skills.
- `/Users/michaelb.williams/RunnerOS/packages/shared/src/agent-definitions/storage.ts` — adds targeted built-in-agent skill migration helper.
- `/Users/michaelb.williams/RunnerOS/packages/server-core/src/sessions/SessionManager.ts` — startup seeding and migration for built-in skills.
- `/Users/michaelb.williams/RunnerOS/packages/shared/src/config/__tests__/self-edit.test.ts` — current test coverage for resolver/validator.

## Recent Accomplishments
- Added `SelfEditTargetConfig` and `DeveloperConfig` types.
- Added `resolveSelfEditTarget(globalConfig, workspaceConfig)`:
  - Workspace config overrides global config.
  - `enabled` is only true when explicitly `true`.
  - Path is expanded/resolved with existing path utilities.
- Added `validateSelfEditRepo(repoPath)`:
  - Fails on missing path, non-directory, invalid/missing `package.json`, missing `.git`, missing `apps/electron`, or missing `packages/shared`.
  - Warns if no obvious dev/typecheck scripts are present.
- Added `developer?: DeveloperConfig` to stored app config and workspace config types.
- Added Zod validation for `developer.selfEdit` in config validation.
- Added hidden starter skill `runneros-self-edit` with instructions for safe self-edit behavior.
- Split system skill groups:
  - `CREATOR_SYSTEM_SKILL_SLUGS`
  - `CONCIERGE_SYSTEM_SKILL_SLUGS`
  - `SYSTEM_GLOBAL_SKILL_SLUGS`
- Updated starter agents:
  - Concierge gets `CONCIERGE_SYSTEM_SKILL_SLUGS`.
  - Orchestrator gets only `CREATOR_SYSTEM_SKILL_SLUGS`.
- Added `ensureBuiltInAgentSkillsForSlug()` so startup can migrate Concierge without forcing self-edit onto Orchestrator.
- Runtime now appends a “RunnerOS self-edit target” block to the turn when `runneros-self-edit` is one of the loaded skill paths.

## Next Best Actions
1. Do a cold, adversarial vet of the self-edit feature. Confirm whether the runtime actually loads the skill for existing Concierge sessions, whether disabled config is respected strongly enough, and whether prompt injection is scoped tightly enough.
2. Verify startup migration behavior on existing `~/.agents/agents/concierge/AGENT.md` and `orchestrator/AGENT.md` without overwriting user-customized prompts.
3. Check if `developer.selfEdit` needs persistence helpers or a Settings UI before it can be considered usable by non-dev users.
4. Add any missing tests only after identifying real gaps. Avoid broad refactors.

## Major Risks / Watchouts
- Current implementation tells the model when `enabled: false`, but does not enforce a hard runtime block beyond instructions. Decide whether that is acceptable for V1 or needs stricter gating.
- `runneros-self-edit` is hidden from generic skills because it is in `SYSTEM_GLOBAL_SKILL_SLUGS`. Confirm this does not create missing-reference weirdness in UI/session creation.
- Existing user-customized Concierge files may not receive updated prompt wording if migration pattern misses them. Migration should preserve user edits, but stale contradictory guidance is possible.
- Validator checks repo shape, not git remote identity. A different monorepo with `apps/electron` and `packages/shared` could pass.
- No UI exists yet to set `developer.selfEdit.repoPath`; manual config is still required.
- Dirty worktree contains unrelated global-source, baked-in system skill, automation UI, and Haze theme changes. Do not revert or stage unrelated files blindly.
- Untracked theme assets exist:
  - `/Users/michaelb.williams/RunnerOS/apps/electron/resources/themes/haze-bg.jpeg`
  - `/Users/michaelb.williams/RunnerOS/apps/electron/resources/themes/haze-bg.png`

## Commands / Verification
- Already run successfully after self-edit work:
  - `bun test packages/shared/src/config/__tests__/self-edit.test.ts packages/shared/src/skills/__tests__/starter-templates.test.ts packages/shared/src/agent-definitions/storage.test.ts packages/shared/src/skills/__tests__/storage.test.ts`
  - `bun run typecheck:all`
  - `bun -e "import { validateSelfEditRepo } from './packages/shared/src/config/self-edit.ts'; console.log(JSON.stringify(validateSelfEditRepo(process.cwd()), null, 2))"` returned valid for `/Users/michaelb.williams/RunnerOS`.
- First vet commands to rerun:
  - `git status --short`
  - `git diff -- packages/shared/src/config/self-edit.ts packages/shared/src/agent/base-agent.ts packages/shared/src/skills/system.ts packages/shared/src/skills/starter-templates.ts packages/shared/src/agent-definitions/starter-templates.ts packages/shared/src/agent-definitions/storage.ts packages/server-core/src/sessions/SessionManager.ts`
  - Same focused `bun test ...` command above.
  - `bun run typecheck:all`

## Working Rules For The Next Agent
- Follow the user's preference: ultra-direct, practical, no giant status dumps.
- First job is review/vetting. Do not immediately add UI or broaden scope unless the audit proves the base is sound.
- Preserve unrelated working tree changes. Do not run destructive git commands.
- Use `apply_patch` for manual file edits.
- Treat existing indexes/source-of-truth rules from the prompt as active; this repo has no `AGENTS.md` file at root, but the user supplied those instructions in-thread.
- If fixing issues, keep changes scoped to self-edit config/runtime/skill wiring unless a directly related test needs adjustment.

## Unknowns
- Whether existing local Concierge already has stale/customized frontmatter that will affect migration.
- Whether the current app config has any `developer.selfEdit` value set.
- Whether the self-edit target should eventually be a real tool/RPC with hard permissions rather than prompt context.
- Whether Settings UI should live under global app settings, workspace settings, or both.
- Whether the feature should support multiple app repos/forks or exactly one RunnerOS repo path.
