# Remote branch triage

- **Date:** 2026-08-13
- **Local HEAD:** `fix/sessions-fr38-fr47` @ `99cd5ea9e`
- **Action taken:** none. No merge, no rebase.

## Named leftovers

| Branch | vs `origin/main` (research 2026-08-13) | Decision |
|---|---|---|
| `origin/feat/shell-ext-activate2` | 1 ahead / 44 behind | **Rebase-or-abandon after owner.** Do not merge as-is. |
| `origin/fix/sandbox-env-strip` | 2 ahead / 535 behind | **Abandon-unless-cherry-pick.** Do not rebase the whole branch onto main. |

Local copies of both names exist. Other dirty/worktree branches (`feat/voice-dictation*`, `fix/electron-renderer-node-shims*`, `recovery/security-external-access-20260811`) are out of this triage.

## Local vs merged sessions work

Remote `fix/sessions-fr38-fr47` was merged via agisota PR #64. Local `99cd5ea9e` still carries unmerged security design/plan docs after a reset dropped a TLS-pin persist commit. Do not force-reset.

Local `HEAD` vs `origin/main` (`5797f4314`): **2 ahead / 7 behind**. No merge performed.
