# Sessions Collection Linear Views — Implementation Plan

> Spec (approved): `docs/superpowers/specs/2026-08-08-sessions-collection-linear-views-prd.md`  
> Branch: `feat/sessions-collection-linear-views`  
> No Circle source. Scoped tests only mid-flight. One i18n owner per batch.

**Goal:** Table collection view + unified Display/Filters + `rank`/`priority`/`dueDate` + bulk + LexoRank — slices B0–B6.

---

## Status

| Slice | Status | Evidence |
|-------|--------|----------|
| **B0** | **Done** | `9f8ff55ce` routes · `91406d8c1` toggle+i18n · `f3a2c709c` SessionTableHost |
| **B1** | **Done** | `c8c28c118` DTO · `43775fb6f` lexorank · `2e297c7d3` SessionManager+RPC · test harness |
| **B0/B1 audit** | **Done** | `08c795229` table navigator collapse + rank max length + auto-select skip |
| **B2** | **Done** | `8e96ece13` display RPC, pure query, OpsBar/Display popover, i18n |
| **B3** | **Done** | `1930ad180` dense SessionTable + OpsBar + groups + inline edits |
| **B4** | **Done** | `4cf33b035` sessions:bulkUpdate RPC + CollectionBulkBar |
| **B5** | **Done** | `e2e4ec9ac` table drag reorder + board append re-rank |
| **B6** | **Done** | `53028baca` shared collectionFiltersAtom on board+table |
| **Audit r1+r2** | **Done** | selection APIs, parity channel, board orderBy/groupBy, bulk RPC loop |
| **B6 residual** | **Done** | `50b5ad7ee` priority subsections (Display.groupBy=priority → pseudo groups + drag→setPriority) |

### Verification (B0+B1)

```bash
bun test apps/electron/src/shared/__tests__/route-surfaces.test.ts
bun test packages/shared/src/sessions/__tests__/lexorank.test.ts
bun test packages/shared/src/sessions/__tests__/collection-fields.test.ts
bun test packages/server-core/src/sessions/session-collection-fields.test.ts
# 77 pass / 0 fail (combined)
```

### B0 delivered
- `CollectionViewMode = 'list'|'board'|'table'`
- `routes.view.table()`, parser/serialize, route-surfaces coverage
- `CollectionViewToggle` (3-segment) + 10 locales `collection.view.*` / `collection.table.*`
- `SessionTableHost` placeholder; `MainContentPanel` table branch
- `isBoardView` remains board-only (navigator stays for table)

### B1 delivered
- `SessionPriority`, `rank`/`priority`/`dueDate` on Session DTO + persistent fields + SessionMeta
- Commands: `setPriority` | `setDueDate` | `setRank` | `reorderRank` via existing `sessions:command`
- In-repo `lexorank.ts` (`lexorankValidate/Between/N`, `backfillRanks`)
- `getSessions` workspace-grouped rank backfill when any missing/invalid
- `session_metadata_changed` carries new fields
- Server tests with flush stubbed by default (no PersistenceQueue vs rmSync races)

---

## Remaining slices (summary)

### B2 — Display + Filters + OpsBar
1. `collection-types.ts` + `collection-query.ts` pure filter/sort + tests  
2. Workspace `collection/display.json` + RPC get/set (new channels → bump ipc tests)  
3. Renderer atoms; migrate `viewFilters` → `CollectionFilters`  
4. `CollectionOpsBar` on list (chips + Display popover); i18n owner batch  

### B3 — SessionTable
Virtualized dense rows, visibleProperties, group headers, open + inline status/priority/flag/due, OpsBar on host.

### B4 — Bulk
`bulkUpdateSessions` (max 200), selection model, bulk bar, coalesced event, IPC bumps.

### B5 — Rank drag
Grip when `orderBy==='rank'`; table/list/board; stale neighbor retry.

### B6 — Unify
Board uses CollectionFilters + `compareSessions`; secondary project/priority subsections; retire divergent filter sources.

### Dependency
```
B0✓ → B3
B1✓ → B3,B4,B5
B2 → B3,B6
B3 → B4,B5
B4 ∥ B5
B6 needs B2
```

---

## Ops note
Keep this branch free of mindmap/p4 WIP. Concurrent agents have repeatedly checked out / committed foreign work onto this tip — verify `git branch --show-current` and `git log -5` before every commit batch.
