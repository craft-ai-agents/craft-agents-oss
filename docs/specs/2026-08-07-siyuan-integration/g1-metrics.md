# G1 — Knowledge usage metrics gate (P7-prep)

> **Status:** instrumentation landed; thresholds **TBD**  
> **Date:** 2026-08-08  
> **Related:** [08-licensing.md](./08-licensing.md), [g2-decision-record.md](./g2-decision-record.md), [11-roadmap.md](./11-roadmap.md)

## 1. Purpose of the G1 gate

Full **P7 managed kernel** (Craft ships and/or spawns a SiYuan binary) is blocked until **both**:

1. **G1** — production usage metrics show the Knowledge surface is used enough to justify the cost/risk of managed mode (thresholds below).
2. **G2** — legal/commercial decision on AGPL boundary is **ACCEPTED** with variant B or C ([g2-decision-record.md](./g2-decision-record.md)).

Until then:

- Production mode remains **A (external-local)** only.
- Craft **does not** download, vendor, bundle, or spawn a SiYuan kernel.
- This document only defines **instrumentation + how to read it**.

## 2. Storage

Path: `{workspaceRoot}/knowledge/metrics.json`

- Atomic rewrite: tmp + rename in the same directory.
- Fail-soft read: missing/corrupt → zeroed snapshot.
- RPC: `knowledge:metricsGet` (**REMOTE_ELIGIBLE** — workspace data on the workspace-owning server).

Wire shape (`KnowledgeMetricsSnapshot`):

```ts
interface KnowledgeMetricsSnapshot {
  version: 1
  updatedAt: string
  counters: {
    connectionsActive: number      // derived on read from connections store
    publicationsTotal: number      // increment on publish finalize success
    publicationsLast7d: number     // recomputed from publications store
    automationProposalsTotal: number // increment on automation propose success
    automationRunsTriggered: number  // increment on cloud_run.submit from automation
    knowledgeSurfaceOpens: number    // increment on first open of a durable surface
    viewRunsTotal: number
    watchTicksTotal: number
  }
  daily?: Record<string, {
    publications?: number
    automationProposals?: number
    viewRuns?: number
  }> // YYYY-MM-DD UTC
}
```

## 3. Counter definitions

| Counter | When incremented | Notes |
|---|---|---|
| `connectionsActive` | Derived on read | Count of records in global `connections.json` |
| `publicationsTotal` | Publish finalize creates a new publication | Idempotent re-finalize does **not** double-count |
| `publicationsLast7d` | Derived on read | From `publications.jsonl` `createdAt` ≥ now−7d |
| `automationProposalsTotal` | Automation executor `bridge.propose` success | After loop-guard `noteWrite` |
| `automationRunsTriggered` | Automation `cloud_run.submit` returns ok+runId | Includes intent-only synthetic fallback |
| `knowledgeSurfaceOpens` | `siyuan:createEmbedded` first open of a durable key | Dedup re-opens do not increment |
| `viewRunsTotal` | `knowledge:viewRun` success | Daily bucket `viewRuns` |
| `watchTicksTotal` | End of a successful watcher `runTick` | Light counter; one per poll cycle |

## 4. Threshold table

| Metric (suggested) | Threshold | Status |
|---|---|---|
| Active installs with ≥1 connection | TBD | **TBD — not yet met / awaiting N weeks production data** |
| Publications / week (aggregate) | TBD | **TBD — not yet met / awaiting N weeks production data** |
| Automation proposals / week | TBD | **TBD — not yet met / awaiting N weeks production data** |
| Knowledge surface opens / week | TBD | **TBD — not yet met / awaiting N weeks production data** |
| View runs / week | TBD | **TBD — not yet met / awaiting N weeks production data** |

> **P7 managed is blocked** until this table is filled with accepted numeric thresholds **and** G2 status is `ACCEPTED` (variant B or C).

## 5. How to read metrics

### RPC

```ts
const snap = await window.electronAPI.knowledge.metricsGet({ workspaceId })
// snap.counters.publicationsTotal, …
```

Channel: `knowledge:metricsGet` (REMOTE_ELIGIBLE).

### Settings UI

**Settings → Knowledge → Usage (G1)** shows the key counters with a Refresh action. Copy explicitly states that managed mode remains blocked.

### On disk

```bash
cat "$WORKSPACE_ROOT/knowledge/metrics.json"
```

## 6. Explicit residual

- **Full P7 managed kernel is NOT shipped** in this prep work.
- No process manager, no binary download, no installer bundling of SiYuan.
- Residual blockers: G1 thresholds filled + accepted; G2 decision record `Status: ACCEPTED` with variant B or C.
