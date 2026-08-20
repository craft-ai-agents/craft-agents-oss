# Spec: Post-research program of work (ROX + Hermes)

- **Status:** Draft — awaiting owner program choice
- **Date:** 2026-08-13
- **Author:** Grok research synthesis
- **Reviewers:** Product owner; security reviewer; legal/release owner
- **Sources:** deep-research workflow `wf_019ff9c10ef4752080d9a3a06d9bb196` (Partial); `HMA-20260809-A1`; local craft-agents specs/plans
- **Does not authorize:** Stage C mutation, managed-engine start, ACL/Funnel changes, secret print/rotate, or code land without a later approved implementation spec

## Objective

Turn the 2026-08-13 research snapshot into three separately gated programs instead of one mixed backlog:

1. **Ops security floor + Hermes Stage C** (`HMA-20260809-A1`) — live runtime risk.
2. **ROX product security and identity** — Security/External Access Gate 0, Connection Fabric CF-1, path/Notes seams.
3. **ROX product completion** — branding, leftover remotes, iOS/gateway maturity, Notes/SiYuan only after legal gates.

Success is not another audit. Success is a ranked, authorized, evidence-backed execution sequence with stop conditions.

## Assumptions to correct now

1. `rox-one/rox-one` and `agisota/craft-agents-oss` are the same product line at tip `5797f431` (0/0). Identity as “mirror vs future product fork” is inferred, not chartered.
2. Hermes audit snapshot is 2026-08-09. Live `approvals.mode`, Syncthing, cron, and skill paths may have drifted (R-026).
3. Sessions B0–B6 are done on mainline. They are not the next bottleneck.
4. `Projects/GAP_REPORT.md` (2026-05-02) is a different workspace and is out of this program unless the owner re-includes it.
5. Stage C starts only on exact `АПPLY HMA-20260809-A1`. This spec does not count as that token.

## Tech stack and commands

- Product: Bun monorepo `craft-agent` 0.11.5, Apache-2.0, workspaces `packages/*` + `apps/*`
- Ops: Hermes 0.20.0, OMH 1.0.3, OMP 17.2.11, Tailscale 1.102.2
- Product checks (from existing plans): `bun test` scoped files; do not invent a root `mise` task
- Hermes apply helpers: `$HOME/hermes-migration-audit-20260809-121222/apply-tools/*`
- Apply log: `~/.hermes-migration-apply/HMA-20260809-A1/apply.log` (`0700`/`0600`)

## Project structure that matters

```text
Projects/craft-agents/          → product monorepo (local HEAD may diverge)
  apps/{cli,cloud-gateway,electron,ios,modal-gateway,viewer,webui}
  packages/{core,server,server-core,shared,ui,...}
  docs/specs/                   → SiYuan, ROX Notes, Connection Fabric
  docs/superpowers/{specs,plans}
hermes-migration-audit-20260809-121222/  → Stage C evidence + apply tools
~/.hermes  ~/.omp/agent        → live credential/state surfaces
```

## Boundaries

- **Always:** evidence before claims; no secrets in logs/chat; fail closed on ambiguous target identity; one vertical slice per session; preserve unrelated dirty trees.
- **Ask first:** any Stage C gate after A0; G2 licensing; Gate 0 datastore/microVM; CF-1 start; public share/CI credentials; rebasing leftover remotes.
- **Never:** `approvals.mode=off` restore; `--yolo`; Funnel/public ingress; SQLite-over-network; managed SiYuan start while G2 OPEN; print/rotate Tailscale API secret; delete credentials automatically; mix Notes implementation with Stage C.

## Success criteria

- [ ] Owner has chosen Program A, B, C, or a named subset — not “do everything”.
- [ ] Live A0 drift preflight exists if Program A is chosen (or an explicit refuse if APPLY is absent).
- [ ] Every P0/P1 item has a gate, owner, and stop condition.
- [ ] Product architecture candidates are written as deepening opportunities (module/interface/seam/depth), not a rewrite.
- [ ] Out-of-scope items stay out of scope.

## Out of scope

- Upstream merge into `craft-ai-agents/craft-agents-oss`
- Filling G1 numeric thresholds from invented production data
- Implementing ROX Notes or managed kernel before security + G1/G2
- Private Git publication (separate future gate)
- WorkOS/Fibery lab and 2026-05-02 GAP_REPORT follow-ups
