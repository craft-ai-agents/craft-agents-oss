# G2 — Licensing decision record (managed kernel)

> **Status: OPEN — blocked on legal/commercial decision**  
> **Date:** 2026-08-08  
> **Parent:** [08-licensing.md](./08-licensing.md) (K-08)

## Recommendation order

1. **C (OEM)** — commercial/OEM permission from SiYuan rightsholder (preferred for managed).
2. **B (AGPL-compatible open product)** — controlled fallback if product strategy accepts AGPL-compatible publication of the combined volume.
3. **Stay on A (external-local)** — default and current production mode; no SiYuan distribution.

## Hard rule until Status = ACCEPTED with variant B or C

- **No** SiYuan source or binary in the monorepo or installer.
- **No** managed spawn that ships or downloads a kernel.
- Runtime `mode: 'managed'` is **fail-closed** (`CAPABILITY_DISABLED` / `engineStatus.running: false` + reason citing G2).

## Current production mode

**A (external-local) only.**

User installs SiYuan themselves; Craft talks HTTP API only. Detection assist (`knowledge:detectEngine`) probes install paths + `127.0.0.1:6806` and links to official install docs — never downloads.

## Acceptance criteria to flip Status → ACCEPTED

- [ ] Written legal/commercial decision choosing **B** or **C** (or explicit permanent stay on A).
- [ ] If C: signed OEM/commercial terms covering versions/platforms needed for managed.
- [ ] If B: source-offer + NOTICE process and channel compatibility (§3.7 in 08-licensing).
- [ ] ADR update + this record `Status: ACCEPTED` with chosen variant.
- [ ] G1 metrics thresholds filled and accepted ([g1-metrics.md](./g1-metrics.md)).

Until then, **P7 managed does not start.**
