# Post-research program — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `planning-and-task-breakdown` then `subagent-driven-development` or `executing-plans`. Do not start Stage C, Notes, or managed-engine code from this plan alone.

**Goal:** Convert the 2026-08-13 Partial research into three gated programs with stop conditions, then execute only the owner-chosen program.

**Architecture:** Keep ops mutation (Hermes/OMP/Tailscale/Syncthing) on the HMA apply-tool seam. Keep product mutation on craft-agents packages behind existing specs. Do not share a writer across those seams.

**Tech Stack:** Existing Hermes apply-tools; Bun/TypeScript monorepo; Tailscale; optional Syncthing only after D1 identities.

## Global Constraints

- Exact start token for Program A: `АПPLY HMA-20260809-A1`
- Never restore `approvals.mode=off`
- Never start SiYuan `mode: managed` while G2 is OPEN
- Preserve unrelated dirty trees; stage only the current task
- Log counts/checksums only; never credentials, channel IDs, or auth errors

---

## Program A — Hermes Stage C (sequential, owner-gated)

### Task A0: Live drift + target discovery

**Description:** Re-probe live Hermes/OMP/Tailscale/Syncthing against the 2026-08-09 snapshot. Propose exact source/target identities. Fail closed if target is ambiguous.

**Acceptance criteria:**
- [ ] `hermes doctor` and gateway/channel status captured as counts, not raw dumps
- [ ] `approvals.mode`, Tirith fail-open, Syncthing presence, cron last-error counts recorded
- [ ] Exact source node, target node, Syncthing port, ACL diff proposed or explicitly blocked

**Verification:** Compare against `09-risk-register.md`. No mutation.

**Dependencies:** Exact `АПPLY HMA-20260809-A1`

**Files likely touched:** `~/.hermes-migration-apply/HMA-20260809-A1/preflight-surface/*`

**Estimated scope:** S (tools already exist)

### Task A1: Encrypted source rollback

**Description:** Quiesce writers, build Secure State Vault, encrypt with `age`, keep indefinitely.

**Acceptance:** Encrypted archive + sha256 + manifest; plaintext tar destroyed; SQLite `quick_check` on drill restore.

**Dependencies:** A0. Confirmation: `APPROVE A1 BACKUP`

### Task A2: Hermes security floor

**Description:** Set `approvals.mode=smart`, Tirith fail-closed, keep private URLs and automatic skill/memory writes.

**Acceptance:** Config getback matches the A2 block in `11-apply-plan.md`. Rollback path never restores `off`.

**Dependencies:** A1. Confirmation: `APPROVE A2 HERMES SMART`

### Task A3: Owner-only file modes

**Description:** Fix `0644` `.env` backups and broad Hermes/OMP DB/dir modes.

**Dependencies:** A2. Confirmation: `APPROVE A3 PERMISSIONS`

### Checkpoint A: Security floor live
- [ ] P0 closed (R-001)
- [ ] Encrypted rollback retained
- [ ] Source resumed only after A3
- [ ] Human review before B/C/D gates

Then continue existing gates B0–I0 from `11-apply-plan.md` without rewriting them.

---

## Program B — Product security seams (craft-agents)

### Task B0: Gate 0 deployment contract

**Description:** Fill `docs/security/external-access-deployment-contract.md` with real datastore, capability issuer, microVM image digest, and origin ownership. No code substitute.

**Acceptance:** Operator-reviewed worksheet; no in-memory/R2-metadata/shared-password store.

**Dependencies:** Owner picks Program B. Confirmation required for any cloud resource.

### Task B1: Architecture deepening report

**Description:** Run `improve-codebase-architecture` on hot paths: `packages/shared/src/config/paths.ts`, Notes RPC/routing, Sources index, credential/path policy. HTML to `$TMPDIR`, not the repo.

**Acceptance:** Candidates use module/interface/seam/depth; top recommendation named.

**Dependencies:** None (read-only)

### Task B2: Connection Fabric CF-1

**Description:** Versioned credential envelopes + `CredentialRef` metadata only. Legacy read path stays.

**Acceptance:** Codec/property tests; no payload in metadata.

**Dependencies:** CF-0 already approved; do not start CF-3/CF-4 in the same session.

### Checkpoint B
- [ ] Gate 0 facts exist or are explicitly blocked
- [ ] Architecture candidate chosen or deferred
- [ ] CF-1 landed or explicitly not started

---

## Program C — Product completion (blocked slices)

### Task C0: Branding and clone-path reconciliation

**Description:** One charter: Craft vs Rox names, clone URL, `agents.rox.one` vs `agents.craft.do`. Docs only until product owner signs.

### Task C1: Leftover remotes triage

**Description:** Decide rebase/abandon for `feat/shell-ext-activate2` and `fix/sandbox-env-strip`. Do not merge stale 535-behind branches.

### Task C2: Maturity evidence for ios / cloud-gateway / modal-gateway

**Description:** Read-only classify each app as production / experimental / dead. No feature work.

### Task C3: Notes/SiYuan stay parked

**Description:** Record that G2 OPEN + G1 TBD still block P7 and Notes engine work. Do not implement the Notes plan.

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Mixing Stage C with Notes/CF code | High | Separate programs; separate sessions |
| Stale 2026-08-09 snapshot | High | A0 live preflight first |
| Ambiguous Tailscale target | Critical | Fail closed; no guessed node |
| Invented G1 numbers | High | Legal/release owner only |
| Local dirty trees | Medium | Stage only current-task files |

## Open Questions

- Exact APPLY for Program A?
- Exact migration target device (A0/D0)?
- G2 variant B, C, or stay on A?
- Gate 0 datastore and microVM owner?
- Is `rox-one` an org rename or an independent product?
