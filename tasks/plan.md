# Implementation Plan: Post-research program A+B+C

## Overview

Owner selected **A+B+C end-to-end**. Hard stops still apply. This session delivers live A0 evidence, Gate 0 block, architecture HTML, CF-1 verification, and Program C docs. Hermes A1–I0 stay blocked.

## Architecture Decisions

- Ops mutation only after exact APPLY + named gates.
- CF-1 is already in tree; verify, do not rewrite.
- Notes/P7 remain parked.

## Task List

### Phase A (ops)
- [x] Live read-only preflight (unauthorized A0)
- [ ] Official A0 apply.log — **blocked** (no `АПPLY HMA-20260809-A1`)
- [ ] A1–I0 — **blocked**

### Phase B (product security)
- [x] Gate 0 contract written as BLOCK
- [x] Architecture HTML in $TMPDIR
- [x] CF-1 tests re-run (11 pass)
- [x] Slice spec for top candidate (not implemented; no owner pick/grill)
- [x] Increment B Task 4 — public-inbox / owner-control / disabled
- [x] Increment B Task 5 — public-inbox holds sessions/tools
- [x] Increment B Task 6 — settings UI labels
- [x] migrateNotes LOCAL_ONLY (host FS not remote-driven)
- [x] OwnedRootPolicy adapter + lazy getConfigDir (default still ~/.craft-agent)
- [x] CF-4.1 InProcessCredentialBroker (deny/allow/perform/revoke)
- [x] CF-4.2 grant store + repair revalidation + delivery registry
- [x] CF-5 WorkGraph connections + closure (already in tree)
- [x] CF-6.1 list/get/create RPC + wave-gated nav
- [x] CF-6.2 connections route + ConnectionsPage + MainContentPanel
- [x] CF-6.3 workgraph ElectronAPI + live metadata list
- [x] CF-7.1 GitHub env import → brokered /user → revoke
- [x] CF-5 schema v2 + metadata Connection/bindings
- [x] CF-5.2 revoke → closure → revalidate (no RPC/UI)

### Phase C (parked product)
- [x] Branding charter (draft)
- [x] Remote triage (no merge)
- [x] App maturity note
- [x] Notes/SiYuan still-blocked record

## Open Questions

Exact APPLY; Gate 0 store/microVM owner; branding sign-off; G2 variant.
