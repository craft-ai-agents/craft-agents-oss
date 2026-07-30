# Rebrand 2026: Commit Strategy Comparison

> **Date:** 2026-07-29
> **Base:** `redesign/owner-agent` (`3cfbca29`)
> **Scope:** Craft Agents → ARCHstudio rebrand + 8 functional change sets (189 files across 8 areas)

## The squash-merge message we *didn't* use

If we'd kept the original single-commit strategy, the entire stack would have landed as one squash with this body:

```
feat: ARCHstudio rebrand + functional split across protocol, server-core, shell, and electron

Rebrand "Craft Agents" to "ARCHstudio" across all docs, build config,
HTML shells, and package manifests. Simultaneously lands functional
changes spanning protocol channels, git-status backend, Recent Changes
rail, renderer test infrastructure, electron dependency updates,
BrowserPaneManager mock coverage fixes, and the owner-features rewrite
(settings/memory/providers panels + onboarding mural + chrome refresh).

Affected areas:
  - packages/shared/src/protocol/     (channels, dto, events, routing, types)
  - packages/server-core/             (git-status parser, session manager, transport)
  - apps/electron/src/renderer/shell/ (LayoutShell, context rail, changes rail)
  - apps/electron/src/main/           (handlers, browser pane, menu, window manager)
  - apps/electron/src/transport/      (channel-map, routed-client)
  - packages/shared/src/agent/        (claude-agent, pi-agent, session-scoped-tools)
  - packages/shared/src/config/       (storage, theme, models-pi)
  - packages/shared/src/prompts/      (owner compiler, system prompt)
  - packages/shared/src/memory/       (repository, obsidian-sync, database)
  - packages/ui/                      (UserMessageBubble, TurnCard, code-viewer)
  - Bunfig, test-setup, build scripts, icon assets

189 files changed
```

## Why we split instead

### The split: 8 branches, 189 files total

| # | Branch | Files | Scope | Risk if reverted |
|---|--------|-------|-------|------------------|
| 1 | `pr/protocol-channels` | 7 | IPC channel definitions + routing | Everything downstream breaks |
| 2 | `pr/git-status-backend` | 3 | Server-side git-status parser | Changes rail has no data |
| 3 | `pr/recent-changes-rail` | 3 | UI rail wired to git-status | No visual regression risk |
| 4 | `pr/renderer-test-infra` | 2 | bun:test + happy-dom setup | Future tests can't run |
| 5 | `pr/electron-deps-scripts` | 5 | react-window, icon scripts | Cosmetic, low coupling |
| 6 | `pr/electron-main-fixes` | 16 | BrowserPaneManager mocks | Electron won't load |
| 7 | `pr/owner-features` | 152 | Settings/memory/providers/onboarding | Largest blast radius |
| 8 | `pr/iconography-and-dockerfile` | 1 | Test coverage for thumbnails | Zero coupling |

### Trade-off matrix

| Dimension | Squash (1 commit) | Split (8 commits) |
|-----------|-------------------|-------------------|
| **Review granularity** | One 189-file wall — reviewers must context-switch within a single PR | 8 focused PRs, each scannable in < 5 minutes |
| **Bisect precision** | `git bisect` can't narrow past the single commit — "somewhere in 189 files" | Bisect lands on the exact commit that broke the build |
| **Revert safety** | Reverting the squash reverts *everything* — rebrand + functional fixes + new features | Revert one PR at a time; protocol can land independently of UI |
| **CI feedback** | Single pass/fail — if tests fail, you don't know which change caused it | Each branch runs tests independently; failures are attributable |
| **Merge conflicts** | All 189 files are one merge target — conflicts accumulate during review | Smaller PRs merge faster, less conflict surface |
| **Rollback speed** | Roll back = revert one commit, re-do all work | Roll back = revert one PR, other PRs stay merged |
| **Git history** | Clean single entry, but opaque | Linear stack shows the dependency chain |

### When squash wins

- **Small changes** (< 20 files, single concern): squash is cleaner
- **Feature branches** with no internal dependency chain: squash avoids intermediate broken states
- **Short-lived PRs** merged same-day: the split overhead isn't worth it

### When split wins

- **Cross-cutting changes** touching 5+ domains (protocol, server, UI, tests, build)
- **Long-lived branches** reviewed over days/weeks: smaller PRs stay reviewable
- **Stacked dependencies** where commit N+1 requires commit N (protocol → backend → UI)
- **Rollback scenarios** where you need surgical revert without losing unrelated work
- **`git bisect`** needs to be useful post-merge

### The dependency chain

```
protocol-channels (7 files)
  └─→ git-status-backend (3 files)
        └─→ recent-changes-rail (3 files)

renderer-test-infra (2 files)   ← independent, can merge anytime
  └─→ electron-main-fixes (16 files)
        └─→ owner-features (152 files)

electron-deps-scripts (5 files) ← independent, cosmetic deps
iconography-and-dockerfile (1 file) ← independent, test coverage
```

A single squash commit would have made `git bisect` useless, reverted the rebrand alongside functional fixes, and forced reviewers to context-switch between IPC protocol definitions and onboarding mural CSS in the same PR.

The split preserves the ability to:
- Review the protocol layer in isolation (7 files)
- Verify the git-status parser before wiring the UI (3 files)
- Test the renderer infrastructure before depending on it (2 files)
- Revert the owner-features rewrite (152 files) without touching the protocol

**The per-file split was the right call for a change of this magnitude and cross-domain scope.**

## Appendix: Generated squash message

This is the conventional-commit message that `git merge --squash` would produce if the 8 branches were collapsed:

```
feat: ARCHstudio rebrand + full-stack functional split

BREAKING CHANGE: Protocol channels renamed, IPC surface expanded,
owner prompt compiler promoted to stable API, renderer test
infrastructure added, electron BrowserPaneManager mock coverage
completed.

Use this as the squash message if you ever need to collapse the stack for a release branch.
