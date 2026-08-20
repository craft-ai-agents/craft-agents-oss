# EXECUTION PROMPT — ROX / Hermes post-research program

Copy everything below the line into a new agent session. Do not start until the owner names the program.

---

You are executing a gated program of work after a Partial deep-research snapshot (2026-08-13) of `https://github.com/rox-one/rox-one` and `https://github.com/agisota/craft-agents-oss`, plus local evidence in `/Users/marklindgreen/Projects/craft-agents` and `/Users/marklindgreen/hermes-migration-audit-20260809-121222`.

## Goal

Close the highest-severity proven gaps without mixing ops mutation, product security, and parked product work. Deliver evidence, not another narrative audit.

Owner-selected program for this session: **[A | B | C | A then stop after A3]**  
If this placeholder is still `[A | B | C | A then stop after A3]`, STOP and ask. Do not guess.

## Required skills (invoke before acting; follow each SKILL.md)

Process (in this order):
1. `using-superpowers` — skill check first
2. `spec-driven-workflow` + `spec-driven-development` — no code without an approved spec for that slice
3. `planning-and-task-breakdown` — vertical slices, S/M tasks, checkpoints
4. `writing-plans` — if a slice needs a new implementation plan, write it under `docs/superpowers/plans/`
5. `improve-codebase-architecture` + `codebase-design` — Program B only; HTML to `$TMPDIR`; use module/interface/seam/depth; then `grilling` on the chosen candidate
6. `understand` + `understand-dashboard` — only when entering an unknown product module
7. `verification-before-completion` — no “done” without commands and output
8. `systematic-debugging` — before any fix of unexpected behavior
9. `test-driven-development` — for product code
10. `subagent-driven-development` — one fresh worker per task after the plan exists
11. `security-and-hardening` — any auth, path, share, credential, TLS, or sandbox change
12. `verification-gate` or adversarial review — before claiming a gate PASS

Do not load the entire skill library. Do not start `brainstorming` unless the owner reopens product behavior.

## Authoritative sources (read before changing anything)

- Spec: `Projects/craft-agents/docs/superpowers/specs/2026-08-13-post-research-program.md`
- Plan: `Projects/craft-agents/docs/superpowers/plans/2026-08-13-post-research-program-plan.md`
- Tasks: `Projects/craft-agents/tasks/plan.md`, `Projects/craft-agents/tasks/todo.md`
- Hermes apply: `~/hermes-migration-audit-20260809-121222/{00-executive-summary.md,09-risk-register.md,11-apply-plan.md}`
- Product blocks: `docs/specs/2026-08-07-siyuan-integration/g2-decision-record.md`, `g1-metrics.md`, `docs/specs/2026-08-10-rox-notes-root-imports-design.md`, `docs/superpowers/plans/2026-08-10-rox-notes-root-imports-plan.md`, `docs/superpowers/plans/2026-08-11-security-external-access-implementation-plan.md`, `docs/specs/2026-08-11-rox-connection-fabric/00-decision.md`

## Hard stop conditions

- No Stage C mutation without exact owner string `АПPLY HMA-20260809-A1`, then the named gate string from `11-apply-plan.md`.
- Never restore `approvals.mode=off`. Never `--yolo`. Never Funnel/public ingress. Never SQLite-over-network.
- Never start SiYuan `mode: managed` or vendor/download a kernel while G2 is OPEN or G1 thresholds are TBD.
- Never implement ROX Notes in the same session as Hermes apply.
- Never print, delete, or rotate the Tailscale API secret, channel tokens, `.env` values, or Keychain secrets.
- Fail closed if the migration target node is ambiguous.
- Preserve unrelated dirty git trees. Stage only the current task.
- Research snapshot may be stale (R-026). Re-probe live state before acting on 2026-08-09 numbers.

## Program A — Hermes Stage C

Expected results:
1. A0 preflight directory with surface manifest, doctor counts, live `approvals.mode`, Tirith fail-open, Syncthing presence, cron error counts, proposed exact source/target/ACL diff — or an explicit FAIL CLOSED.
2. After `APPROVE A1 BACKUP`: encrypted source rollback (`*.tar.age` + sha256 + manifest), plaintext destroyed, network-denied restore drill evidence.
3. After `APPROVE A2 HERMES SMART`: `approvals.mode=smart`, Tirith fail-closed, private URLs still on, skill/memory write approvals still off. Config getback recorded.
4. After `APPROVE A3 PERMISSIONS`: former `0644` env backups and Hermes/OMP DB/dirs are owner-only; gateway resumed.
5. Apply log at `~/.hermes-migration-apply/HMA-20260809-A1/apply.log` with timestamp/gate/PASS-FAIL/counts/checksums only.
6. If the owner said “stop after A3”, stop. Otherwise continue existing B0–I0 gates without rewriting the apply plan.

## Program B — product security seams

Expected results:
1. `docs/security/external-access-deployment-contract.md` with real Gate 0 facts, or a written block naming the missing owner/store/image.
2. Architecture HTML at `$TMPDIR/architecture-review-<timestamp>.html` covering at least: `packages/shared/src/config/paths.ts` (module-eval root), Notes RPC remote-eligible local-path (`knowledge:migrateNotes`), generic Sources index as agent-context ingress, credential/path policy. Each candidate: files, problem, deepening, locality/leverage, before/after, strength.
3. If the owner picks a candidate: grilled decision + CONTEXT.md/ADR update, then a slice-sized implementation spec — not a rewrite.
4. At most CF-1 (versioned envelopes + `CredentialRef` metadata, legacy read remains). No CF-3/CF-4 in this session unless the owner names them after CF-1 verification.

## Program C — parked product completion

Expected results:
1. One-page branding charter: Craft vs Rox, clone URL, `agents.rox.one` vs `agents.craft.do` / `lukilabs/craft-agents-oss`.
2. Leftover remotes: rebase-or-abandon decision for `feat/shell-ext-activate2` and `fix/sandbox-env-strip` with ahead/behind evidence. No merge of 535-behind branches.
3. Maturity note for `apps/ios`, `apps/cloud-gateway`, `apps/modal-gateway`: production / experimental / dead, with file evidence.
4. Explicit “still blocked” record for Notes + managed kernel (G2 OPEN, G1 TBD). Zero implementation.

## Definition of done for this session

Write a completion block:

```text
BLUF: done | blocked | partial
Program: A | B | C
Changed: ...
Verified: command + result
Risks / gaps: ...
Next exact owner string required: ...
```

Status is PARTIAL if live state was not re-probed, a required confirmation was missing, or evidence is narrative-only.

## First action

Read the spec and the owner-selected program’s source files. Then execute Task 1 of that program only.
