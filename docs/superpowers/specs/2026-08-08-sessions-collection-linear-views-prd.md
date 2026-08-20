# Sessions Collection Linear Views — PRD / Spec

**Date:** 2026-08-08  
**Status:** Approved (2026-08-08)
**Author:** agent + user (brainstorming session)  
**Reviewers:** user  
**Inspiration (patterns only, MIT):** [ln-dev7/circle](https://github.com/ln-dev7/circle) — Linear-style PM UI template. **No Circle source is vendored.**  
**Repo checkout at design time:** local `craft-agents` (fork of agisota/craft-agents-oss).  
**Delivery architecture:** Approach **B — foundation-first horizontal layers** (B0–B6).

---

## 1. Context

### 1.1 Problem

Craft session collection today exposes two modes:

| Mode | Switcher | Mount |
|------|----------|--------|
| List | `BoardListToggle` value `list` | `SessionList` in navigator |
| Board | value `board` | `KanbanBoardContainer` via `MainContentPanel` |

Both are useful, but:

1. **No dense multi-field triage surface** — list is chat-oriented; board is stage-oriented. Neither matches Linear-style issue-line density (status · priority · project · labels · due · updated in one scannable row).
2. **Closed view unions** — `BoardListValue` and `SessionsNavigationState.viewMode` are `'list' | 'board'` only; routes special-case `board`. A third mode requires coordinated route + toggle + host changes.
3. **Parallel ops models** — list uses `viewFilters` / grouping; board uses `KanbanBoardConfig` + separate atoms. Users learn two filter/display languages.
4. **Missing session fields** for issue-tracker triage: no `priority`, no `dueDate`, no stable manual `rank` (LexoRank-style).

Circle is **not** a radial/circular layout. It is a pure front-end Linear clone (list/board, Display popover, filter chips, LexoRank). Craft already has list+board; the valuable takeaway is **ops chrome + dense table + rank/priority/due semantics**, reimplemented on Craft primitives (Electron renderer, jotai, session RPC).

### 1.2 Goals

1. Add a third collection view: **dense table / issue-line** (`table`).
2. Introduce a **unified collection ops model** (view toggle + filter chips + Display popover) shared by **list, board, and table**.
3. Extend Session with **`rank`**, **`priority`**, **`dueDate`**.
4. Support **inline** status/flag/priority/due edits, **multi-select bulk** updates, and **LexoRank reorder**.
5. Deliver via **B0–B6 slices** so each layer is independently smoke-testable; PRD describes full end-state.

### 1.3 Non-goals

- Vendoring or embedding Circle / Next.js / Zustand from Circle.
- Circle product IA: teams directory, cycles, initiatives, reviews, inbox, agent mock, projects timeline as in Circle.
- Changes to **EntityViewTabs** (per-open-session standard/map/outline/graph) — orthogonal system.
- Radial / force-graph **collection** view.
- `dueDate`-driven agent auto-run or SLA automation.
- Collaborative OT on ranks; multi-tenant real-time conflict resolution beyond last-write-wins + events.
- Mobile-specific table layout.
- Saved Display presets marketplace / cross-workspace sharing beyond workspace file.
- Replacing `kanbanColumn` with pure `sessionStatus` grouping (independence preserved).

### 1.4 Approved decisions

| Topic | Decision |
|-------|----------|
| Third view | Dense table / issue-line |
| Chrome | Display popover + filter chips |
| Breadth | Unified across list + table + board |
| V1 interactions | Open + inline status/flag (+ priority/due) + multi-select bulk + LexoRank reorder |
| New fields | `rank` + `priority` + `dueDate` |
| Port strategy | Reimplement patterns only |
| Delivery | Approach B (B0–B6) |
| Board columns | Keep `KanbanBoardConfig`; Display does not delete column model |
| Label groupBy | Session in **first** label group by `localeCompare(id)` (not “Multiple” bucket) |
| dueDate storage | UTC noon for picked calendar day |
| Filters persistence | Workspace/local structured filters; optional shareable serialize later OK |
| Default table orderBy | `rank` + `orderDir=asc` (backfill assigns ranks so asc ≈ lastMessageAt desc) |

### 1.5 Current integration surface (facts)

| Piece | Path |
|-------|------|
| List | `apps/electron/src/renderer/components/app-shell/SessionList.tsx` |
| Board | `.../kanban/KanbanBoardContainer.tsx`, `BoardListToggle.tsx` |
| Toggle | `BoardListValue = 'list' \| 'board'` |
| Host | `MainContentPanel.tsx` — `viewMode === 'board'` → kanban |
| Nav types | `apps/electron/src/shared/types.ts` — `viewMode?: 'list' \| 'board'` |
| Routes | `routes.view.board()`, `route-parser` `first === 'board'` |
| Session DTO | `packages/shared/src/protocol/dto.ts` |
| Kanban config | `packages/shared/src/kanban/*`, workspace `kanban/config.json` |
| Meta atoms | `apps/electron/src/renderer/atoms/sessions.ts` |
| Status UI | `session-status-config.tsx`, dynamic workspace statuses |
| i18n | `packages/shared/src/i18n/locales/*.json` — single owner per batch |
| Entity tabs | `EntityViewTabs.tsx` — **out of scope** |

---

## 2. Functional requirements

### 2.1 Collection view mode

- **FR-1.** The system MUST support `CollectionViewMode = 'list' | 'board' | 'table'`.
- **FR-2.** The UI MUST provide a toggle control (evolving `BoardListToggle` → `CollectionViewToggle`) that switches between the three modes without losing workspace or session selection context beyond intentional navigation rules below.
- **FR-3.** Routes MUST resolve:
  - `board` → sessions navigator, `viewMode: 'board'` (backward compatible).
  - `table` → sessions navigator, `viewMode: 'table'`.
  - Other existing session collection routes → `viewMode: 'list'` (default).
- **FR-4.** Unknown / legacy clients MUST fall back unknown leading segments safely (table unknown → list behavior).
- **FR-5.** Switching to `board` or `table` MUST show the corresponding main-content host; list MUST keep the navigator list behavior consistent with today (board may collapse navigator as today).

### 2.2 Unified ops bar

- **FR-6.** When the sessions collection is active, the shell MUST show a **CollectionOpsBar** containing: view toggle, filter chips region, Display popover entry.
- **FR-7.** **CollectionFilters** MUST support AND-across-dimensions, OR-within-dimension chips for at least: `status[]`, `priority[]`, `projectId[]`, `labels[]`, `dueRange`, `flagged`, `hasUnread`, `model[]`.
- **FR-8.** The same `filterSessionMeta(meta, filters, displayShowCompleted)` function MUST drive list, board, and table visible sets (`showCompleted` participates in filtering per EC-5).
- **FR-9.** Sidebar smart views (`ViewConfig` / filtrex) MUST remain an outer predicate ANDed with CollectionFilters.
- **FR-10.** **CollectionDisplay** MUST include:
  - `groupBy`: `'none' | 'status' | 'priority' | 'project' | 'dueDate' | 'label'`
  - `orderBy`: `'rank' | 'priority' | 'dueDate' | 'lastMessageAt' | 'createdAt' | 'name'`
  - `orderDir`: `'asc' | 'desc'`
  - `visibleProperties`: subset of `'status' | 'priority' | 'project' | 'labels' | 'dueDate' | 'model' | 'updated' | 'created' | 'flag'`
  - `showEmptyGroups: boolean`
  - `showCompleted: boolean` (hides terminal done/cancelled unless an explicit status chip includes them — see EC-5)
- **FR-11.** CollectionDisplay MUST persist per workspace (RPC load/save). Filters MUST persist per navigator filter key (migrating today’s `viewFilters` shape).
- **FR-12.** Display popover MUST explain board semantics: board columns still come from board settings; order applies inside columns.

### 2.3 Session fields

- **FR-13.** Session MUST gain optional persisted fields:
  - `rank?: string` (LexoRank)
  - `priority?: 'none' | 'urgent' | 'high' | 'medium' | 'low'` (default `'none'`)
  - `dueDate?: number | null` (epoch ms; default `null`)
- **FR-14.** On read, missing `priority` / `dueDate` MUST coerce to defaults without requiring rewrite.
- **FR-15.** On workspace session load, if any session lacks `rank`, the system MUST backfill ranks ordered by `lastMessageAt` desc, tie-break `id` asc, idempotently.
- **FR-16.** `dueDate` calendar picks MUST store **UTC noon** of the chosen calendar day.
- **FR-17.** Overdue styling MUST apply when `dueDate < startOfLocalToday` AND status is not terminal (`done` / `cancelled`).

### 2.4 Session table view

- **FR-18.** `viewMode === 'table'` MUST render a virtualized dense table over the filtered+sorted session set.
- **FR-19.** Table columns MUST honor `visibleProperties`; title column and selection checkbox MUST always be available when bulk is enabled.
- **FR-20.** Primary activation on title / row body MUST open the session (same navigation as list open).
- **FR-21.** Status, priority, and flag controls on the row MUST edit inline without opening the session.
- **FR-22.** When `groupBy !== 'none'`, table MUST show group headers with counts; empty groups obey `showEmptyGroups`; collapse state SHOULD persist similarly to kanban group collapse.
- **FR-23.** dueDate groupBy buckets MUST be: Overdue · Today · This week · Later · No date.
- **FR-24.** Label groupBy MUST place a session in the group of its **first** label by `localeCompare` on label id.
- **FR-25.** Empty filtered set MUST show empty state with affordance to clear collection filters.

### 2.5 List and board adapters

- **FR-26.** List MUST consume CollectionFilters and CollectionDisplay for grouping/ordering/visibility where applicable (chat-oriented row may show a subset of properties).
- **FR-27.** Board column placement MUST remain `kanbanColumn ?? statusToColumn(sessionStatus)` (independence preserved).
- **FR-28.** Board MUST apply CollectionFilters before column bucketing.
- **FR-29.** Board card order within a column MUST use `compareSessions` with Display `orderBy` / `orderDir`.
- **FR-30.** Board Display `groupBy`: if `none` or `status`, no extra swimlanes; otherwise v1 MUST support secondary subsection headers inside each column for `project` and `priority` at minimum.
- **FR-31.** End-state (B6): list and board MUST NOT depend on a parallel filter-only path that disagrees with CollectionFilters.

### 2.6 Inline commands

- **FR-32.** The system MUST support session commands: `setPriority`, `setDueDate`, `setRank`, `reorderRank` (plus existing status/flag/archive/labels/project/kanbanColumn).
- **FR-33.** `reorderRank` MUST accept `sessionId` + optional `prevId` / `nextId`, compute LexoRank between neighbors server-side, persist, and emit metadata events.
- **FR-34.** Optimistic UI MUST revert on command failure with a toast.

### 2.7 Multi-select bulk

- **FR-35.** Table and list MUST support multi-select via checkbox + shift-click range over current visible order.
- **FR-36.** Selection MUST clear on view mode change, collection filter change, or Escape.
- **FR-37.** Header “select all” MUST select all **visible** rows only (current filter, expanded groups).
- **FR-38.** When `selectedCount > 0`, a bulk bar MUST offer: set status, set priority, set project, add/remove labels, set due date, flag/unflag, archive, clear selection.
- **FR-39.** Bulk MUST NOT include rank changes.
- **FR-40.** `bulkUpdateSessions` MUST accept `{ workspaceId, ids, patch }` where `patch` excludes `rank`, return `{ ok, failed[] }`, enforce max **200** ids (`BULK_LIMIT`).
- **FR-41.** Bulk archive MUST confirm when count > 1 OR any selected session is processing; processing targets MUST be skipped with `failed` reason `busy` (EC-1).
- **FR-42.** If any id is missing or outside workspace, the request MUST fail entirely (EC-2).
- **FR-43.** Successful bulk MUST emit a coalesced `sessions_bulk_changed` (or equivalent) so UI does not thrash on N single events.

### 2.8 LexoRank reorder

- **FR-44.** When `orderBy === 'rank'`, table MUST show a drag grip and allow reorder among peers in the same group bucket.
- **FR-45.** List MUST allow rank drag under the same `orderBy === 'rank'` rule.
- **FR-46.** Board card drop within/across columns MUST update `kanbanColumn` (± status) as today AND re-rank among destination visible siblings when `orderBy === 'rank'`.
- **FR-47.** Cross-group drag MUST update the writable group field (status/priority/project) and re-rank in target; cross-group drag MUST be **disabled** for `groupBy === 'label'`.
- **FR-48.** On `RANK_NEIGHBORS_STALE`, client MUST refetch sibling ranks once, retry once, then toast and reload order.
- **FR-49.** Corrupt/equal rank sets MUST be repairable via backfill repair path.

### 2.9 i18n and a11y

- **FR-50.** New user-visible strings MUST go through i18n keys (`collection.*`, `priority.*`, bulk/due strings) with **one locale-file owner** per implementation batch.
- **FR-51.** Existing `kanban.list` / `kanban.board` keys MUST either alias to `collection.view.*` or migrate in the same i18n-owned change (no permanent divergent labels).
- **FR-52.** Table MUST expose row/checkbox accessible names; chip buttons MUST have accessible names.

### 2.10 Non-functional

- **NFR-1.** Table MUST virtualize; scrolling 1k sessions SHOULD remain interactive on M1-class hardware (no full DOM mount of all rows).
- **NFR-2.** Filter + sort pure functions MUST be unit-tested and deterministic (stable `id` tie-break).
- **NFR-3.** Rank strings MUST validate LexoRank format; reject oversized arbitrary strings.
- **NFR-4.** No Circle packages in `package.json`; no Circle files under repo source.
- **NFR-5.** EntityViewTabs behavior MUST remain unchanged by this work.
- **NFR-6.** `kanbanColumn` vs `sessionStatus` independence MUST hold in all views.
- **NFR-7.** Implementation tests that touch network MUST use electronAPI/fetch seams — not process-global `mock.module` on shared modules (craft test hygiene).

---

## 3. Acceptance criteria

Format: Given / When / Then. Each maps to FR/NFR.

### View mode

- **AC-1.** (FR-1, FR-2, FR-3)  
  **Given** sessions navigator on list  
  **When** user selects Table in the collection toggle  
  **Then** route resolves to table mode and main content shows the table host (not kanban, not only empty chat).

- **AC-2.** (FR-3)  
  **Given** app at board route  
  **When** user selects List  
  **Then** behavior matches pre-change list navigation (allSessions or last list filter policy as implemented consistently).

- **AC-3.** (FR-4)  
  **Given** a build that does not know `table`  
  **When** parser sees unknown mode  
  **Then** user lands on safe list collection (no crash).

### Filters & display

- **AC-4.** (FR-7, FR-8)  
  **Given** chips status=`in-progress` AND priority=`urgent`  
  **When** user switches list → table → board  
  **Then** all three show the same session id set (board still buckets by kanban column).

- **AC-5.** (FR-9)  
  **Given** a sidebar smart view active  
  **When** user adds a label chip  
  **Then** visible sessions satisfy smart view AND chip.

- **AC-6.** (FR-10, FR-11)  
  **Given** user sets groupBy=priority, orderBy=dueDate, hides model column  
  **When** user restarts app and reopens workspace  
  **Then** Display settings are restored from workspace persistence.

- **AC-7.** (FR-10, EC-5)  
  **Given** `showCompleted=false`  
  **When** no status chip includes `done`  
  **Then** done/cancelled sessions are hidden;  
  **When** status chip includes `done`  
  **Then** those done sessions appear.

### Fields & migration

- **AC-8.** (FR-13–FR-15)  
  **Given** a workspace with sessions lacking rank  
  **When** sessions are loaded  
  **Then** every session has a rank string; sorting by `orderBy=rank` + `orderDir=asc` matches prior `lastMessageAt` desc order for that backfill pass; a second load MUST NOT reshuffle ranks that were already valid.

- **AC-9.** (FR-16, FR-17, FR-32)  
  **Given** a session with dueDate yesterday and status `todo`  
  **When** table renders due cell  
  **Then** it shows overdue styling; setting status `done` removes overdue styling.

- **AC-10.** (FR-32)  
  **Given** inline priority menu on a row  
  **When** user picks `high`  
  **Then** `setPriority` persists and other windows/atoms receive metadata update showing `high`.

### Table UX

- **AC-11.** (FR-18–FR-21)  
  **Given** table mode with sessions  
  **When** user clicks title  
  **Then** session opens;  
  **When** user changes status on the row control  
  **Then** session does not navigate away and status updates.

- **AC-12.** (FR-22–FR-24)  
  **Given** groupBy=label and a session with labels `[b,a]`  
  **When** table groups  
  **Then** session appears under the first id by `localeCompare` (not duplicated per label).

- **AC-13.** (FR-25)  
  **Given** filters match zero sessions  
  **When** table renders  
  **Then** empty state offers clearing collection filters.

### Bulk

- **AC-14.** (FR-35–FR-38, FR-40)  
  **Given** 5 visible rows selected  
  **When** bulk set priority=`low`  
  **Then** all 5 ok paths show `low` and RPC patch excluded rank.

- **AC-15.** (FR-40, EC-12)  
  **Given** 201 selected ids  
  **When** bulk invoked  
  **Then** RPC returns `BULK_LIMIT` and UI does not claim success.

- **AC-16.** (FR-41, EC-1)  
  **Given** selection includes a processing session  
  **When** bulk archive confirmed  
  **Then** processing id is in `failed` with `busy`; others archive.

- **AC-17.** (FR-39)  
  **Given** bulk bar visible  
  **When** inspecting actions  
  **Then** no bulk “reorder” / rank action exists.

### Rank

- **AC-18.** (FR-44, FR-33)  
  **Given** orderBy=rank in table  
  **When** user drags session between A and B  
  **Then** persisted rank is strictly between A and B ranks and order survives reload.

- **AC-19.** (FR-47)  
  **Given** groupBy=label  
  **When** user attempts cross-group drag  
  **Then** drop is rejected (no label rewrite via drag).

- **AC-20.** (FR-46, NFR-6)  
  **Given** board drop to another column with orderBy=rank  
  **When** drop completes  
  **Then** `kanbanColumn` updates per existing rules and rank is among destination siblings; `sessionStatus` only changes if column dropStatus rules say so.

- **AC-21.** (FR-48)  
  **Given** stale neighbor ids  
  **When** reorderRank returns `RANK_NEIGHBORS_STALE`  
  **Then** client retries once after refetch; second failure toasts without silent success.

### Board / list unification

- **AC-22.** (FR-27–FR-30)  
  **Given** board + filters + orderBy=priority  
  **When** cards render in a column  
  **Then** order follows priority weights; column membership ignores Display groupBy status.

- **AC-23.** (FR-31, B6)  
  **Given** end-state build  
  **When** changing a chip  
  **Then** list and board update from the same filter store (no divergent legacy-only filter atom as source of truth).

### Constraints

- **AC-24.** (NFR-4)  
  **Given** repository dependency manifests  
  **When** inspected after implementation  
  **Then** no Circle package name or vendored Circle app tree is required at runtime.

- **AC-25.** (NFR-5)  
  **Given** an open session  
  **When** EntityViewTabs are used  
  **Then** standard/map/outline/graph behavior matches pre-feature baselines (no regression from this PRD).

---

## 4. Edge cases

| ID | Case | Behavior |
|----|------|----------|
| EC-1 | Processing session in bulk archive | Skip; `failed` reason `busy` |
| EC-2 | Foreign/missing ids in bulk | Reject entire request |
| EC-3 | Stale rank neighbors | `RANK_NEIGHBORS_STALE` → refetch+retry once → toast |
| EC-4 | Corrupt/equal ranks | Backfill repair for subset/workspace |
| EC-5 | showCompleted vs explicit done chip | Explicit status chip wins (include) |
| EC-6 | Open session from table without messages loaded | Navigate open; load messages as today |
| EC-7 | Empty group + showEmptyGroups=false | Hide header |
| EC-8 | Multi-label groupBy | First label by `localeCompare(id)` only |
| EC-9 | dueDate timezone | Store UTC noon; display local |
| EC-10 | Concurrent bulk + single edit | Last-write-wins; events reconcile |
| EC-11 | Old client + table route | Safe list fallback |
| EC-12 | Bulk ids > 200 | `BULK_LIMIT` |
| EC-13 | Select-all with collapsed groups | Only visible (expanded) rows |
| EC-14 | Rank drag when orderBy≠rank | Grip hidden/disabled; DnD does not change rank |
| EC-15 | Terminal status + dueDate | No overdue style |

---

## 5. API contracts

```ts
// --- View / nav ---
type CollectionViewMode = 'list' | 'board' | 'table'

interface SessionsNavigationState {
  navigator: 'sessions'
  filter: SessionFilter
  details: { type: 'session'; sessionId: string } | null
  viewMode?: CollectionViewMode
}

// --- Display / filters ---
type CollectionGroupBy = 'none' | 'status' | 'priority' | 'project' | 'dueDate' | 'label'
type CollectionOrderBy = 'rank' | 'priority' | 'dueDate' | 'lastMessageAt' | 'createdAt' | 'name'
type CollectionProperty =
  | 'status' | 'priority' | 'project' | 'labels' | 'dueDate'
  | 'model' | 'updated' | 'created' | 'flag'

interface CollectionDisplay {
  groupBy: CollectionGroupBy
  orderBy: CollectionOrderBy
  orderDir: 'asc' | 'desc'
  visibleProperties: CollectionProperty[]
  showEmptyGroups: boolean
  showCompleted: boolean
}

type DueRange =
  | { type: 'none' }
  | { type: 'overdue' }
  | { type: 'today' }
  | { type: 'next_n_days'; days: number }
  | { type: 'range'; start: number; end: number }

interface CollectionFilters {
  status?: string[]
  priority?: Array<'none' | 'urgent' | 'high' | 'medium' | 'low'>
  projectId?: string[]
  labels?: string[]
  due?: DueRange
  flagged?: boolean
  hasUnread?: boolean
  model?: string[]
}

// --- Session fields (additions on existing Session DTO) ---
type SessionPriority = 'none' | 'urgent' | 'high' | 'medium' | 'low'

interface SessionFieldAdditions {
  rank?: string
  priority?: SessionPriority
  dueDate?: number | null
}

// --- Commands ---
type SessionCommand =
  | { type: 'setPriority'; sessionId: string; priority: SessionPriority }
  | { type: 'setDueDate'; sessionId: string; dueDate: number | null }
  | { type: 'setRank'; sessionId: string; rank: string }
  | { type: 'reorderRank'; sessionId: string; prevId?: string; nextId?: string }
  // …existing commands unchanged

interface BulkUpdateSessionsInput {
  workspaceId: string
  ids: string[] // max 200
  patch: {
    sessionStatus?: string
    priority?: SessionPriority
    dueDate?: number | null
    projectId?: string | null
    labels?: string[]
    // or structured addLabels/removeLabels if existing label ops prefer
    isFlagged?: boolean
    isArchived?: boolean
    kanbanColumn?: string
  }
}

interface BulkUpdateSessionsResult {
  ok: string[]
  failed: Array<{ id: string; error: string }>
}

// RPC
// getCollectionDisplay(workspaceId): CollectionDisplay
// setCollectionDisplay(workspaceId, display): void
// bulkUpdateSessions(input): BulkUpdateSessionsResult

// Events
// session_metadata_changed includes priority?, dueDate?, rank?
// sessions_bulk_changed: { workspaceId, ids, patch }

type RankErrorCode = 'RANK_NEIGHBORS_STALE' | 'RANK_INVALID'
type BulkErrorCode = 'BULK_LIMIT' | 'BULK_FOREIGN_ID' | 'BULK_BUSY'
```

### Pure helpers (testable)

```ts
function filterSessionMeta(meta: SessionMeta, f: CollectionFilters, display: Pick<CollectionDisplay, 'showCompleted'>): boolean

function compareSessions(
  a: SessionMeta,
  b: SessionMeta,
  orderBy: CollectionOrderBy,
  orderDir: 'asc' | 'desc',
): number // stable tie-break id asc; dueDate nulls last on asc / nulls first on desc

function priorityWeight(p: SessionPriority): number
// urgent > high > medium > low > none

function dueBucket(dueDate: number | null, now: number, localTz: string): 'overdue' | 'today' | 'this_week' | 'later' | 'none'

function backfillRanks(sessions: Array<{ id: string; lastMessageAt: number }>): Array<{ id: string; rank: string }>
```

---

## 6. Data models

### 6.1 Session (additive)

| Field | Type | Constraints | Default |
|-------|------|-------------|---------|
| rank | string | LexoRank format; required after backfill | backfilled |
| priority | enum | none\|urgent\|high\|medium\|low | none |
| dueDate | number \| null | epoch ms UTC noon for date-only picks | null |

Existing fields unchanged, including `sessionStatus`, `kanbanColumn`, `labels`, `projectId`, `isFlagged`, `isArchived`, `lastMessageAt`, etc.

### 6.2 CollectionDisplay file

| Field | Type | Notes |
|-------|------|-------|
| version | 1 | schema version |
| groupBy, orderBy, orderDir, visibleProperties, showEmptyGroups, showCompleted | see API | workspace-scoped |

Suggested path: `{workspace}/collection/display.json` (exact path in implementation plan).

### 6.3 Filters persistence

Migrate `KEYS.viewFilters` → structured `CollectionFilters` per session filter key; keep backward read of legacy maps (statuses/labels/projects/groupingMode).

---

## 7. UI specification (summary)

### CollectionOpsBar

```
[ List | Board | Table ]   [ + Filter ▾ ] [chip] [chip] …    [ Display ▾ ]
```

Bulk bar (when selection non-empty):

```
N selected  | Status ▾ | Priority ▾ | Project ▾ | Labels ▾ | Due ▾ | Flag | Archive | Clear
```

### Table row (logical columns)

Select · Grip(rank) · Status · Priority · Title · Project · Labels · Due · Model · Updated · Created · Flag

### Board adapter note (in Display)

> Board columns still come from board settings. Ordering applies inside columns. Group-by adds subsections for project/priority when selected.

---

## 8. Delivery slices (Approach B)

| Slice | Scope | Smoke gate |
|-------|--------|------------|
| **B0** | `CollectionViewMode`, routes, toggle, empty `SessionTable` host | Toggle list/board/table; board unbroken |
| **B1** | DTO fields, persistence, backfill, setPriority/DueDate/Rank/reorderRank, events | Round-trip fields; idempotent backfill |
| **B2** | CollectionDisplay + CollectionFilters + OpsBar; wire **list** first | Chips+Display filter list; persist reload |
| **B3** | Full SessionTable: columns, group/sort, open, inline status/flag/priority/due | AC-11–13 |
| **B4** | Selection model + bulk bar + `bulkUpdateSessions` | AC-14–17 |
| **B5** | LexoRank drag table → list → board constraints | AC-18–21 |
| **B6** | Board+list fully on unified ops; remove divergent sources of truth; secondary board subsections | AC-4, AC-22–23 |

**Rule:** No slice implements out-of-scope Circle IA. Each slice gets its own implementation plan after this PRD is Approved.  
**Rule:** i18n — one owner per batch.  
**Rule:** Skip repo-wide test suites inside parallel subagents; parent runs targeted verification per slice.

---

## 9. Testing strategy

| Layer | What |
|-------|------|
| Unit | `filterSessionMeta`, `compareSessions`, `priorityWeight`, `dueBucket`, LexoRank between, `backfillRanks` idempotence |
| Integration | sessionCommand new types; bulk limit/foreign/busy; reorderRank stale; display load/save; migration backfill |
| Renderer | route parse/build for table; toggle; table open+inline (electronAPI seam); bulk bar calls; selection clear rules |
| Regression | kanban column≠status; smart views AND chips; EntityViewTabs untouched |
| Forbidden | `mock.module` on shared session modules in combo suites |

Every AC-* above MUST map to at least one automated or explicit smoke check before slice Done.

---

## 10. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Board unification regressions | B6 last; keep KanbanBoardConfig; adapter tests |
| Rank backfill surprises users | Order = lastMessageAt desc (familiar); manual re-rank available |
| Scope creep toward Circle IA | Non-goals section; slice gates |
| i18n merge conflicts | Single locale owner |
| Test pollution | fetch/electronAPI seams only |
| Bulk event storms | Coalesced bulk event |
| Secondary swimlanes complexity | Minimum project+priority inside column; document if deferred only with PRD amendment |

---

## 11. Success criteria (product)

1. User can triage sessions in Linear-like density (status, priority, due, project, labels) without opening each session.
2. One ops bar drives list, board, and table without three filter mental models.
3. Bulk update of ≥10 sessions works with clear per-id failure reporting.
4. Manual rank order survives restart and multi-window metadata events.
5. No regression on kanban column≠status, smart views, or EntityViewTabs.

---

## 12. Out of scope (explicit)

See §1.3. Additionally deferred unless new PRD:

- Shareable URL serialization for chips (nuqs-style) as hard requirement
- Bulk rank compaction UI
- Custom priority taxonomies beyond 5-level enum
- dueDate time-of-day precision
- Table column resize/reorder persistence beyond Display visible set
- CSV export

---

## 13. Open questions (non-blocking defaults)

| # | Question | Default if unanswered |
|---|----------|------------------------|
| Q1 | Exact workspace path for display.json | `{workspace}/collection/display.json` |
| Q2 | Last-used view mode restore on app launch | Optional localStorage; deep links win |
| Q3 | Label bulk = replace vs add/remove | Prefer add/remove ops matching existing label commands |
| Q4 | Board secondary swimlanes for dueDate/label | Not required in v1; project+priority only |

---

## 14. Spec self-review checklist

- [x] No TBD placeholders in normative requirements
- [x] FR/NFR numbered; AC trace to FR/NFR
- [x] Edge cases for bulk, rank, filters, TZ
- [x] API + data models cover new entities
- [x] Out of scope explicit
- [x] Slice plan prevents big-bang-only delivery
- [x] EntityViewTabs / Circle vendor exclusion consistent across sections
- [x] Board kanbanColumn independence stated in FR + AC + risks

---

## 15. Approval gate

**Status: Approved (2026-08-08).**

Implementation proceeds slice-by-slice starting at **B0** (see `docs/superpowers/plans/2026-08-08-sessions-collection-linear-views-plan.md`).

---

## Appendix A — Mapping Circle → Craft (patterns only)

| Circle | Craft target |
|--------|----------------|
| Issue line / list | SessionTable row |
| Board grid | Existing kanban (adapted order/filter) |
| Display popover | CollectionDisplay popover |
| Filter chips (bazza/ui idea) | CollectionFilters chips (craft UI) |
| LexoRank `rank` | Session.rank + reorderRank |
| Issue priority | Session.priority |
| Issue dueDate | Session.dueDate |
| Zustand issues-store | sessionMetaMapAtom + sessionCommand |
| Next routes | Electron route-parser + routes.view |
| mock-data | Real Session DTO / RPC |

## Appendix B — Key file touch list (implementation hint, non-normative)

- `apps/electron/src/shared/types.ts`, `routes.ts`, `route-parser.ts`
- `BoardListToggle.tsx` → collection toggle
- `MainContentPanel.tsx`, `AppShell.tsx`
- New `.../collection/` or `.../session-table/` under app-shell
- `packages/shared/src/protocol/dto.ts` + session commands + RPC channels
- server-core session handlers + persistence migration
- `packages/shared/src/i18n/locales/*`
- atoms: sessions, new collection-display/filters atoms
- ipc-channels / channel-map-parity / registration tests bump when channels added
