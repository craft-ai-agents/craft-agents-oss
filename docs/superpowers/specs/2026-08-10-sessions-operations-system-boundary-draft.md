# Sessions Operations and Work Control Plane — System-Boundary Draft

**Date:** 2026-08-10  
**Status:** Draft — architecture review required; no implementation authorization  
**Decision owner / approver:** User  
**Author:** User + architecture drafting agent  
**Required reviewers:** Sessions Operations owner; Project/Task Conductor owner; storage/migration owner; renderer/RPC owner  
**Supersedes:** selected assumptions in `2026-08-08-sessions-collection-linear-views-prd.md`; it does not alter that approved PRD until this draft is approved.  
**Scope:** system ontology, ownership, current-contract preservation, migration boundaries, and a proposed PRD amendment only.  
**Circle use:** presentation patterns only. No Circle code, persistence model, or issue-tracker ontology is imported.

> **Evidence convention.** **[OBSERVED]** claims are tied to the repository source cited inline. **[PROPOSED]** is a reviewable target decision, not current behavior. **[INFERENCE]** identifies a conservative conclusion from the cited surface. **[DEFERRED]** has no approved API, store, schema, or implementation authorization. A source absence is limited to the cited/reviewed surface, not a claim about the entire repository.

## 1. Context

The approved Sessions Collection PRD describes a dense triage surface and treats `rank`, `priority`, and `dueDate` as fields to introduce. The current source instead already persists those fields on `Session`, provides collection filter/sort value objects, and exposes task-specific execution records. [OBSERVED: `docs/superpowers/specs/2026-08-08-sessions-collection-linear-views-prd.md:24-39`; `packages/shared/src/protocol/dto.ts:45-49,119-140,464-540`; `packages/shared/src/sessions/types.ts:29-75`]

That mismatch creates a boundary risk: extending presentation work into generic work tracking, generic run history, or an attention queue could silently overload current Session, Project, Task Conductor, rank, and collection contracts. The current source also demonstrates distinct Project configuration, asset, prompt-context, and task-spec surfaces rather than one existing Project/Work record. [OBSERVED: `packages/shared/src/projects/types.ts:33-113`; `packages/shared/src/projects/storage.ts:4-10,60-68,94-139,145-245`; `packages/server-core/src/sessions/SessionManager.ts:4952-5001`]

This draft therefore unblocks one decision: whether future Portfolio, WorkItem, generic Run/Attempt, Attention, SavedView, and Collection work should be separate product-domain deliveries while the current Sessions screen remains a Session Operations Console. It does **not** authorize any such delivery, schema, API, or migration.

## 2. Decision summary and ownership boundary

[PROPOSED] Craft has two separate product surfaces:

```text
Portfolio / Project / WorkItem        Sessions Operations
             │                                  │
             └───────────────┐                  ├─ Session thread/context
                             ▼                  ├─ current operational metadata
                    Attention (cross-cutting)   └─ Task Conductor projections
```

1. **Sessions Operations** remains a console for session/thread execution and its independent operational metadata. List, board, and table remain alternate Session projections.
2. **Work Control Plane** is a separate future product domain for intentional outcomes represented by `WorkItem`; it is not inferred from Session status, rank, priority, timestamps, unread state, flags, or Task Conductor identifiers.
3. **Attention** is a separate future cross-cutting domain. It owns its subject relation, reasons, lifecycle, evidence, and scoped navigation. `WorkItem` is only one possible Attention subject.
4. **No total urgency score** is introduced. Status/lifecycle, priority, attention, activity, health/progress evidence, rank, unread state, flags, and Kanban placement remain independent dimensions.
5. **No timestamp-derived progress or health** is introduced. `lastMessageAt` remains a partial activity/order hint with legacy fallback behavior, not proof of a successful, fresh, blocked, or actionable Session.

### 2.1 Current owner boundary

| Concern | Current owner / evidence | Boundary this draft preserves |
|---|---|---|
| Session identity, thread/context, persisted operational metadata | [OBSERVED: `packages/shared/src/protocol/dto.ts:55-140`; `packages/shared/src/sessions/types.ts:29-75,116-247`] | `Session` remains the canonical current thread/context record. No WorkItem, Attention, generic Run, or generic Attempt is encoded in it before a separate approved delivery. |
| Project configuration | [OBSERVED: `ProjectConfig` is the scalar `config.json` configuration record (with config-specified Kanban definitions), containing identity/slug, display/configuration values, optional working directory, and archive marker; `packages/shared/src/projects/types.ts:33-57`; `packages/shared/src/projects/storage.ts:94-139`] | `ProjectConfig` is not an asset manifest, prompt-memory snapshot, WorkItem, Portfolio, or generic lifecycle record. |
| Project assets and prompt memory | [OBSERVED: `ProjectAsset` is resolved from `assets/`; `ProjectPromptContext` is a separate prompt projection; `packages/shared/src/projects/types.ts:60-113`; `packages/shared/src/projects/storage.ts:53-68,145-185`] | A migration preserves configuration, assets, `MEMORY.md`, and runtime prompt projection as separate surfaces; it must not serialize a prompt projection back into config. |
| Project location and workspace scope | [OBSERVED: project files live under `{workspaceRootPath}/projects/{projectSlug}` and `LoadedProject.workspaceId` is derived from the workspace-root basename; `packages/shared/src/projects/types.ts:4-10,84-96`; `packages/shared/src/projects/storage.ts:4-10,194-245`] | `id`, `slug`, folder path, derived workspace identity, config, assets, and prompt-memory require distinct migration entries. |
| Project archive and low-level deletion | [OBSERVED: `archivedAt` hides a Project from the sidebar while retaining it on disk; `deleteProject(workspaceRootPath, projectSlug)` recursively removes that Project folder and its assets, and its caller is responsible for unsetting referenced Session `projectId`; `packages/shared/src/projects/types.ts:51-56`; `packages/shared/src/projects/storage.ts:339-347`] | The low-level delete does not establish a complete referential-cleanup, revision, RPC, event, authorization, or lifecycle policy. Those remain future evidence gates. |
| Legacy Session project binding | [OBSERVED: `Session.projectId?: string`; `packages/shared/src/protocol/dto.ts:117-124`; `packages/shared/src/sessions/types.ts:224-237`] | This draft treats it as an optional compatibility scalar, not as a verified stored foreign key. Creation can inherit a parent binding and conditionally adopt a Project working directory; later mutation writes the scalar without a Project lookup and does not retroactively change the working directory. [OBSERVED: `packages/server-core/src/sessions/SessionManager.ts:3208-3237,8294-8317`] |
| Session rank | [OBSERVED: `rank?: string` persists per Session; `packages/shared/src/protocol/dto.ts:123-130`; `packages/shared/src/sessions/types.ts:60-75,226-247`] | `getSessions()` backfills a workspace-grouped sequence when a member lacks a valid rank, using `lastMessageAt` as ordering input. `reorderRank()` resolves neighbors from the manager map without a same-workspace check in the reviewed code. Its actual neighbor universe is therefore uncharacterized, not asserted workspace-global. [OBSERVED: `packages/server-core/src/sessions/SessionManager.ts:2907-2955,8377-8425`] |
| `lastMessageAt` | [OBSERVED: persisted field and runtime field; `packages/shared/src/sessions/types.ts:29-34,126-130`; `packages/shared/src/protocol/dto.ts:55-64`] | Hydration falls back to `lastUsedAt` or `Date.now()`, every persistence snapshot updates `lastUsedAt`, and one normal message path updates `lastMessageAt` only after a user message was persisted/emitted. It is consequently a partial activity/order hint with legacy provenance, not a reliable message clock or health signal. [OBSERVED: `packages/server-core/src/sessions/SessionManager.ts:1199-1209,2591-2611,6547-6593,6606-6707`] |
| Task Conductor task/run/node results and session adoption | [OBSERVED: task metadata is stored on Session; `packages/shared/src/protocol/dto.ts:125-140`; `TaskResultsDto` reads persisted run artifacts and survives restart; `packages/shared/src/protocol/dto.ts:345-379`] | Task-specific records stay Task Conductor-owned. A generated hidden orchestrator can be promoted in place rather than duplicated. [OBSERVED: `packages/shared/src/protocol/dto.ts:228-259`; `packages/server-core/src/sessions/SessionManager.ts:8467-8558`] |
| Task Project edge | [OBSERVED: task generation accepts `projectId` for Project context; `packages/shared/src/protocol/dto.ts:261-281`; `create_task` resolves explicit or invoking Session project and writes it as task-spec `project`; `packages/server-core/src/sessions/SessionManager.ts:4952-5001`] | Task-spec `project`, orchestrator/child Session `projectId`, and future `WorkItem.projectId` are separate values until reconciliation rules approve their relationship. |
| Collection types and display persistence | [OBSERVED: `CollectionDisplay`/`CollectionFilters` are pure value contracts; `packages/shared/src/sessions/collection-types.ts:1-102`; query is a pure caller-supplied filter/sort; `packages/shared/src/sessions/collection-query.ts:1-3,107-238`] | A verified display preference is stored at `{workspace}/collection/display.json`; its normalizer drops unknown fields and saving writes normalized values. [OBSERVED: `packages/shared/src/sessions/collection-display-storage.ts:1-128`] No SavedView field may be added there without a separately approved persistence model. |
| Current bulk command boundary | [OBSERVED: current DTO/handler/manager contracts in §5.4; `packages/shared/src/protocol/dto.ts:464-540`; `packages/server-core/src/handlers/rpc/sessions.ts:309-449`; `packages/server-core/src/sessions/SessionManager.ts:8067-8245`] | WorkItem and Attention fields do not enter `SessionCommand`, `BulkUpdateSessionsPatch`, or `SessionsBulkChangedEvent`. |

### 2.2 Presentation evidence limit

[OBSERVED] The reviewed collection query only filters and sorts metadata supplied by its caller; the reviewed bulk manager receives caller-supplied IDs. [OBSERVED: `packages/shared/src/sessions/collection-query.ts:226-238`; `packages/server-core/src/sessions/SessionManager.ts:8067-8101`]

Accordingly, visible-selection ordering, renderer optimism/rollback, drag behavior, group collapse, and return-navigation restoration are **preservation requirements**, not broad observed-renderer claims in this draft. Existing test files are evidence references for those required seams, not proof of every renderer behavior: `collection-bulk-optimistic.test.ts:16-111` and `kanban-selection.test.ts:21-62`.

## 3. Conceptual target ontology — proposed and gated

> **Status:** [PROPOSED] This is an ontology and relation proposal, not an approved physical data model. Exact field types, nullability, enum domains, foreign keys, revision representation, timestamps, evidence-reference storage, deletion semantics, writers, APIs, and migrations remain **N/A — DEFERRED** until Gates G-2 through G-7 (§12) are approved.

```text
Portfolio ──?── Project ──?── WorkItem ──?── Session
                                               │
                                               └── Task Conductor topology remains distinct

AttentionItem ── one subject ── (Portfolio | Project | WorkItem | Session | Run | Attempt)
AttentionItem ── many reasons ── AttentionReason
```

| Concept | Conceptual responsibility | Explicit non-ownership |
|---|---|---|
| `Portfolio` | [PROPOSED] Availability grouping for Projects. | It does not own Session lifecycle, Attention reasons, or Task Conductor records. |
| `Project` | [PROPOSED] Future product-domain Project relation while preserving the distinct current config/file/projection surfaces in §2.1. | It does not turn `ProjectConfig`, assets, prompt-memory, or the archive marker into one new record by implication. |
| `WorkItem` | [PROPOSED] Planned outcome, Work-owned lifecycle, explicit work priority, due commitment, and progress evidence. | It does not own Attention, Session status, Session rank, Session unread/flag, Kanban placement, generic Run/Attempt, or Task Conductor records. |
| `Session` | [OBSERVED current] Thread/context and independent operational metadata. [PROPOSED future] It may optionally point to a WorkItem after a gated migration. | Parent/branch topology, `taskSlug`, `taskRunId`, `taskNodeId`, and Session rank are never repurposed as WorkItem identity. |
| `Run` / `Attempt` | [PROPOSED] Potential generic execution model only after a separate boundary is defined. | They are not aliases for Task Conductor nodes, Task attempt counters, runtime `isProcessing`, or current status maps. |
| `AttentionItem` | [PROPOSED] The one deduplicated Attention aggregate for a subject in a workspace. | It does not live in Session metadata, WorkItem state, `CollectionSessionMeta`, `SessionCommand`, collection filters, rank, or normal comparator logic. |
| `AttentionReason` | [PROPOSED] The evidence-backed reason lifecycle under one AttentionItem. | It does not mutate a subject's priority, status, rank, due date, unread state, flag, Kanban placement, lifecycle, or ordinary Session position. |
| `Collection` | [PROPOSED] Named explicit Session membership only, if separately approved. | It is not a synonym for a SavedView. It cannot own rank until the rank-owner gate approves it. |
| `SavedView` | [PROPOSED] Named query/presentation snapshot only, if separately approved. | It has no implicit membership or manual rank universe. |

### 3.1 Proposed hierarchy cardinalities and compatibility rules

These are proposed decision inputs for **G-2 and G-3**, not current facts:

| Relation | Proposed min/max | Existing/unbound policy and constraint |
|---|---|---|
| Portfolio → Project | A Portfolio has `0..*` Projects; a Project has `0..1` Portfolio. | Existing Projects remain without a Portfolio unless an explicit future operation assigns one. |
| Project → WorkItem | A Project has `0..*` WorkItems; a WorkItem has **exactly `1`** Project. | A WorkItem cannot be created/linked until its Project resolves in the same workspace. |
| WorkItem → Session | A WorkItem has `0..*` Sessions; a Session has `0..1` WorkItem. | Every existing Session begins and may remain unbound. No blanket WorkItem backfill is permitted. A Work-bound Session has exactly one WorkItem. |
| Workspace consistency | Every relation endpoint must have the same `workspaceId`. | A cross-workspace reference is invalid even where legacy scalar data can currently contain it. |

`WorkItem.projectId` is the [PROPOSED] Work-domain Project relation. `Session.projectId` remains the [OBSERVED] optional compatibility scalar until G-3 approves a cutover. During coexistence, neither is a dual writer for the other:

1. Binding a Session to a WorkItem is allowed only when the WorkItem and Session are in the same workspace.
2. If the legacy `Session.projectId` resolves and differs from `WorkItem.projectId`, the bind is rejected as `project_conflict`; no value is silently overwritten.
3. If the legacy scalar is absent, a WorkItem bind may be approved without populating it; the bind must not change the Session working directory or assume prompt-context injection.
4. If the legacy scalar is dangling or resolves outside the workspace, the bind is blocked as `dangling_or_foreign_legacy_project` until explicit repair/unbind is recorded.
5. Parent inheritance is creation behavior, not a migration authority. A child Session inherits a parent project only in the observed creation path and only if the inherited Project resolves; migration must not synthesize a Project relation from topology alone. [OBSERVED: `packages/server-core/src/sessions/SessionManager.ts:3208-3237`]
6. Existing `setSessionProjectId` and bulk `projectId` mutation behavior remain preserved until cutover; neither retroactively changes `workingDirectory`. [OBSERVED: `packages/server-core/src/sessions/SessionManager.ts:8153-8158,8294-8317`]

### 3.2 Task-spec Project reconciliation

[PROPOSED] A hierarchy migration must inspect, but must not silently rewrite, all of these independent project references:

- Task spec `project`;
- persistent orchestrator and child Session `projectId` values;
- proposed `WorkItem.projectId`; and
- any Project reference used when the Task draft was generated.

The reconciliation policy is:

1. A non-null reference must resolve to a Project in the same workspace. A missing or foreign ID blocks that record as `dangling_or_foreign_project`; no WorkItem link, task rewrite, or Session mutation occurs.
2. When two or more resolved references are present, they must name the same Project for automatic binding. Otherwise the record is blocked as `project_conflict` and requires an explicit, auditable human decision.
3. A task spec with `project` may automatically link only to a WorkItem with the same resolved `projectId`. A missing task-spec project is not synthesized from a parent Session, timestamp, rank, or Task identifier.
4. Reconciliation preserves the existing task spec and the existing orchestrator Session identity. The draft-adoption path may promote the same Session in place; it must not duplicate an orchestrator merely to attach WorkItem metadata. [OBSERVED adoption behavior: `packages/shared/src/protocol/dto.ts:228-259`; `packages/server-core/src/sessions/SessionManager.ts:8467-8558`]
5. A future context producer/consumer must be named before any cutover claims that a WorkItem relation supplies Project prompt context. The reviewed direct prompt-context contract is Task generation's `projectId`, not a generic regular-Session guarantee. [OBSERVED: `packages/shared/src/protocol/dto.ts:261-281`]

### 3.3 Data models — N/A / deferred

No physical `Portfolio`, `WorkItem`, `AttentionItem`, `AttentionReason`, generic `Run`, generic `Attempt`, `Collection`, or `SavedView` data model is approved here. Before any durable schema, writer, reader, migration, or API is authorized, its dedicated specification must provide field/type/constraint tables, identity/revision semantics, index/query plan, authorization, evidence retention, archival/deletion behavior, and recovery/error rules. **Gate:** G-2 through G-7.

## 4. Contract boundaries

### 4.1 Current Session Operations contract

[OBSERVED] Current collection modes/types are Session-oriented: `CollectionViewMode` is list/board/table, filters are Session metadata filters, and sorting consumes `CollectionSessionMeta`. [OBSERVED: `packages/shared/src/sessions/collection-types.ts:10-102`; `packages/shared/src/sessions/collection-query.ts:16-31,107-238`]

[PROPOSED preservation requirements]

- Normal list, board, and table continue to operate on Sessions only. WorkItem, Portfolio, generic Run/Attempt, and Attention are reached only through explicit scoped navigation, never by injected normal Session rows or added normal row/drag/bulk schema.
- `sessionStatus`, `kanbanColumn`, `priority`, `rank`, `dueDate`, `hasUnread`, `isFlagged`, and `lastMessageAt` retain independent meanings. No reason transition may mutate any of them.
- Current scalar-rank behavior is preserved exactly until G-4 approves an owner/scope migration. The observed workspace-grouped backfill must not be relabeled an enforced global or membership-local rank contract.
- The verified `CollectionDisplay` persistence format remains a normalized current preference. No SavedView or Collection field is placed in `collection/display.json`; its normalizer drops unknown fields. [OBSERVED: `packages/shared/src/sessions/collection-display-storage.ts:56-128`]

### 4.2 Project and Task Conductor compatibility contract

[PROPOSED preservation requirements]

- Preserve Project config, directory/slug layout, resolved assets, `MEMORY.md`, and prompt projection as distinct data/projection surfaces (§2.1). Do not flatten them into a future Project record.
- Preserve the observed archive marker and low-level folder/asset deletion separately. The existing low-level delete assigns callers responsibility for unsetting referenced Session `projectId`; do not infer a complete referential, revisioning, event, authorization, or retention policy from it. G-3/G-7 must define that policy.
- Preserve `Session.projectId` as a compatibility scalar and preserve its working-directory decoupling. Do not present it as a current foreign key or generic prompt-context contract.
- Preserve Task Conductor `taskSlug`, `taskRunId`, `taskNodeId`, node output, result/verdict/repair records, and in-place generated-orchestrator adoption. A generic Run/Attempt delivery may adapt Task evidence only after G-5 and G-7; it cannot relabel or fabricate historical records.

### 4.3 Attention contract — proposed independent domain

#### Ownership and evidence

[PROPOSED] Attention exclusively owns:

- the `(workspaceId, subjectType, subjectId)` subject relation;
- reason source, reason code, severity, evidence references, timestamps, state, snooze return, and fingerprint;
- the aggregate effective state; and
- Attention-only query/navigation state and events.

A `WorkItem` is a possible subject, not the owner of the relation. The same is true of Portfolio, Project, Session, Run, and Attempt after their subject kinds are approved. No Attention transition may mutate any subject state.

[PROPOSED] A producer must be allowlisted by source, reason code, severity range, authorization rule, and stable evidence-reference format. Free-form error text, timestamp age, or a raw model message alone is insufficient. The concrete taxonomy and evidence retention policy are **DEFERRED — G-6**.

#### Reason lifecycle, predicates, and deduplication

[PROPOSED] `AttentionReason.state` has this complete allowed-transition set:

```text
create        -> open
open          -> acknowledged | snoozed | resolved
acknowledged  -> open | snoozed | resolved
snoozed       -> open | resolved
resolved      -> open (only through explicit evidenced reopen)
all other transitions are rejected
```

- **Active** means `open`, `acknowledged`, or `snoozed`: the reason is not resolved and remains in history/aggregation.
- **Actionable** means `open` or `acknowledged`: acknowledgement records that it was seen but does not declare the required action complete. `snoozed` is active but not actionable until it returns to `open`.
- A snooze requires `snoozedUntil`; its return must create exactly one idempotent `snoozed → open` transition when the clock threshold is reached, or an explicit manual resume may do so earlier. A resolved reason cannot auto-return from an old snooze.
- The aggregate `AttentionItem.effectiveState` is `actionable` when at least one reason is actionable; otherwise `snoozed` when at least one active reason is snoozed; otherwise `resolved`. This is the only aggregate state rule in this draft.
- At most one **active** reason may exist for `(workspaceId, subjectType, subjectId, source, fingerprint)`. A duplicate event for an active fingerprint must be idempotent: retain/merge allowed evidence according to the future source policy, but do not create a second reason or a second subject row. A resolved fingerprint can return only through an evidenced explicit reopen/recreate rule defined by G-6.

#### Scoped Attention navigation

[PROPOSED] Attention navigation uses an Attention-owned `AttentionScope`, not `CollectionFilters`:

```text
AttentionScope = {
  workspaceId,
  predicate: { effectiveStates?, reasonCodes?, sources?, subjectTypes? },
  invokedSubjectKeys?: readonly SubjectKey[],
  snapshotRevision?: string,
}
```

`predicate` may inspect Attention-owned fields and approved subject keys only. It must not consume, mutate, or broaden the originating Sessions filter. A badge/count invocation captures the scope and the subject keys counted at invocation. The destination renders the matching subject set for that scope; it must not silently substitute a global Attention view. A stale revision is surfaced as stale/updated under EC-AT-3, never widened.

The originating Session navigation snapshot is separately retained as `{ filters, display/order, group-collapse state, selectedIds }`. Returning from Attention restores that snapshot exactly; Attention's own selection and query never become ordinary Session filters.

### 4.4 View architecture

[PROPOSED] The following labels are boundaries, not promises of current implementation:

```text
Sessions / Operations (Session facts only)
- All
- Running — requires separately defined runtime refresh semantics
- Completed — Session terminal-status filter, preserving custom closed-status behavior

Attention (separate scoped domain)
- All actionable Attention
- Waiting for me — reasonCode = required_human_action only
- Snoozed Attention

Portfolio / Work (deferred; omit unsupported labels)
- WorkItem lists only after Work-owned lifecycle/evidence is approved
```

`Waiting for me` is deliberately **not** an ordinary Sessions filter. It is a reason-filtered Attention scope and does not create a new Session status. `At risk`, Work `Waiting`, Work `Blocked`, generic Session `Blocked`/`Failed`, and `Inactive` are omitted from this boundary until their own Work-owned or execution-evidence contracts are approved. An `Inactive` display can be proposed only after a separate eligible-idle contract; `lastMessageAt` alone never satisfies it.

### 4.5 Current API appendix — preserved, narrow, and actual

| Boundary | Actual reviewed contract | Preservation rule |
|---|---|---|
| `SessionCommand` / `sessions:command` | [OBSERVED] `SessionCommand` is the existing discriminated union covering current Session actions, including flag/archive/name/status/read state, working directory/sources/labels/project/Kanban/priority/due/rank, sharing, connection, pending-plan, annotations, and undo. The handler dispatches it as `(sessionId, command)` and has command-specific returns rather than a documented universal success envelope. [OBSERVED: `packages/shared/src/protocol/dto.ts:505-540`; `packages/server-core/src/handlers/rpc/sessions.ts:305-408`] | Preserve the union and command behavior. Do not add WorkItem, Attention, generic Run, or generic Attempt commands to it. |
| `sessions:bulkUpdate` input | [OBSERVED] `{ workspaceId, ids, patch }`; patch may change Session status, priority, due date, project scalar, labels, flag, archive, and Kanban column. It has **no `rank` field**. [OBSERVED: `packages/shared/src/protocol/dto.ts:464-488`] | Preserve this Session-only input shape and the 200-ID limit. |
| `BulkUpdateSessionsResult` | [OBSERVED] `{ ok: string[]; failed: Array<{ id: string; error: string }> }`. [OBSERVED: `packages/shared/src/protocol/dto.ts:490-493`] | Preserve partial-result reporting; do not replace it with Attention/Work result fields. |
| `sessions:bulkChanged` | [OBSERVED] `{ workspaceId, ids, patch }`. The RPC handler emits it only if `result.ok.length > 0`, with successful IDs and the original patch. [OBSERVED: `packages/shared/src/protocol/dto.ts:495-499`; `packages/server-core/src/handlers/rpc/sessions.ts:410-449`] | Preserve the event family and its successful-ID-only emission rule. |

**Observed named current outcomes.** The RPC throws `bulk_workspace_context_required` without a transport-bound workspace and `bulk_workspace_mismatch` for a caller/workspace mismatch. Empty IDs return `{ ok: [], failed: [] }`. The manager's all-or-none target preflight returns `not_found` or `foreign` for offending IDs and `preflight_aborted` for the remaining requested IDs; archive of a processing target may return per-target `busy`; persistence failure returns a per-target error string. Invalid rank is rejected, and a missing reorder neighbor throws `RANK_NEIGHBORS_STALE`. [OBSERVED: `packages/server-core/src/handlers/rpc/sessions.ts:414-449`; `packages/server-core/src/sessions/SessionManager.ts:8067-8245,8377-8425`]

**New APIs and physical models: N/A — DEFERRED.** No Attention, WorkItem, Portfolio, generic Run/Attempt, Collection, or SavedView RPC/event schema is specified here. Their API/data-model contracts require G-2 through G-7; this draft intentionally does not invent interfaces that do not exist.

## 5. Current-to-required migration map

| Current data or contract | Evidence-backed current disposition | [PROPOSED] migration boundary / gate |
|---|---|---|
| Session ID, workspace scope, transcript, configuration, archive/read/flag fields | [OBSERVED: `packages/shared/src/protocol/dto.ts:55-140`; `packages/shared/src/sessions/types.ts:29-75`] | Preserve Session as canonical thread/context. A future Work relation is additive and optional; no Session identity/topology field is repurposed. G-2/G-3. |
| `Session.projectId`, parent inheritance, working directory | [OBSERVED: optional scalar; creation and setters cited in §2.1] | Preserve scalar behavior. Apply §3.1 dangling/mismatch rules before optional WorkItem binding; never silently synchronize dual owners. G-3. |
| `ProjectConfig`, `id`, `slug`, folder, derived workspace identity | [OBSERVED: `packages/shared/src/projects/types.ts:33-96`; `packages/shared/src/projects/storage.ts:4-10,94-139,194-245`] | Preserve as config and storage identity. No automatic Portfolio backfill. G-2/G-3. |
| Project assets, `MEMORY.md`, `ProjectPromptContext` | [OBSERVED: `packages/shared/src/projects/types.ts:60-113`; `packages/shared/src/projects/storage.ts:53-68,145-185`] | Preserve separately; no projection-to-config serialization. Identify future context producer/consumer before cutover. G-3/G-5. |
| Project archive and low-level deletion | [OBSERVED: optional `archivedAt` retains disk data; low-level `deleteProject` removes the Project folder/assets and leaves callers responsible for referenced Session scalars; `packages/shared/src/projects/types.ts:51-56`; `packages/shared/src/projects/storage.ts:339-347`] | Preserve these observed behaviors without treating them as a complete cleanup policy. Archive/delete/referential policy requires G-3/G-7. |
| Session `sessionStatus`, `kanbanColumn`, priority, dueDate, unread, flag | [OBSERVED: distinct fields; `packages/shared/src/protocol/dto.ts:65-79,123-130`] | Preserve independent Session ownership. Do not infer Work lifecycle or Attention state. G-8 preservation evidence. |
| Session scalar rank | [OBSERVED: per-Session field; workspace-grouped backfill; uncharacterized neighbor check; `packages/server-core/src/sessions/SessionManager.ts:2907-2955,8377-8425`] | Retain scalar behavior until G-4. Any membership-local rank requires a distinct `CollectionMembership` design, legacy-write fencing, and resumable migration; SavedViews never gain rank by implication. |
| `lastMessageAt` and `lastUsedAt` | [OBSERVED: partial/fallback behavior in §2.1] | Preserve as activity/order data only. Do not derive progress/health/attention or backfill semantic work state. G-8. |
| Task spec `project`; `taskSlug`, `taskRunId`, `taskNodeId` | [OBSERVED: task Project mapping and Session metadata; `packages/server-core/src/sessions/SessionManager.ts:4952-5001`; `packages/shared/src/protocol/dto.ts:125-140`] | Inventory and reconcile under §3.2. Keep Task spec authoritative in its own domain; no synthetic/mutating repair. G-5. |
| Task results, node outputs, verdict/repair history; generated orchestrator adoption | [OBSERVED: storage-backed results and in-place adoption; `packages/shared/src/protocol/dto.ts:228-379`; `packages/server-core/src/sessions/SessionManager.ts:8467-8558`] | Preserve durable artifacts and Session identity. Generic Run/Attempt may be an adapter only after a dedicated evidence/mapping decision. G-5/G-7. |
| `CollectionDisplay`, `CollectionFilters`, display JSON | [OBSERVED: type/query/persistence in §2.1] | Preserve current normalized display preference. Store future SavedView/Collection data elsewhere and version it independently. G-7. |
| `SessionCommand`, `sessions:bulkUpdate`, result, event | [OBSERVED: §4.5] | Preserve current session-only contract and named outcomes. New domains receive independent API/event families only after G-7. |
| Portfolio, WorkItem, generic Run/Attempt, Attention, Collection membership, SavedView | [DEFERRED] | New durable domains require approved owner, physical model, migration journal, writers/readers, API/event contract, authorization, and EC coverage. G-2 through G-7. |

### 5.1 Rank-owner decision gate

Before a change from scalar Session rank to any membership-local rank, reviewers must approve evidence that:

1. traces every rank reader, writer, external-header reconciler, and display consumer;
2. characterizes neighbor scope using same-workspace and cross-workspace neighbor fixtures rather than assuming a workspace-global universe;
3. snapshots raw headers before `getSessions()` can backfill ranks;
4. selects one target owner: current scalar rank, or explicit Collection membership rank; and
5. if membership is selected, defines a versioned journal with immutable input digest, per-record checkpoints, idempotent replay, legacy-read/write fencing, rollback, and a rule preventing legacy scalar-rank resurrection.

## 6. Functional requirements

### 6.1 Sessions Operations preservation

- **FR-SO-1 — ordinary surface.** Normal Sessions list/table/board rows, drag payloads, and Session bulk payloads MUST remain Session-only; Work/Attention data is reachable only through explicit scoped navigation. **Criteria:** AC-SO-1a, AC-SO-1b.
- **FR-SO-2 — status independence.** Attention/Work changes MUST NOT mutate `sessionStatus`. **Criteria:** AC-SO-2.
- **FR-SO-3 — Kanban independence.** Attention/Work changes MUST NOT mutate `kanbanColumn`. **Criteria:** AC-SO-3.
- **FR-SO-4 — priority independence.** Attention/Work changes MUST NOT mutate explicit Session `priority`. **Criteria:** AC-SO-4.
- **FR-SO-5 — rank baseline.** Until G-4, current per-Session rank validation, stale-neighbor result, workspace-grouped backfill, and idempotent reload behavior MUST remain unchanged. **Criteria:** AC-SO-5a through AC-SO-5d.
- **FR-SO-6 — due-date independence.** Attention/Work changes MUST NOT mutate `dueDate`. **Criteria:** AC-SO-6.
- **FR-SO-7 — unread independence.** Attention/Work changes MUST NOT mutate `hasUnread` or `lastReadMessageId`. **Criteria:** AC-SO-7.
- **FR-SO-8 — flag independence.** Attention/Work changes MUST NOT mutate `isFlagged`. **Criteria:** AC-SO-8.
- **FR-SO-9 — activity semantics.** `lastMessageAt` MUST NOT create a progress, health, stale, blocked, stuck, inactive, or Attention claim. **Criteria:** AC-SO-9.
- **FR-SO-10 — selection and bulk preservation.** The current visible/eligible-selection and optimistic-reconciliation seams MUST remain independent of Work/Attention relations; server bulk outcomes MUST preserve preflight, partial-failure, successful-ID eventing, and field-safe rollback behavior. **Criteria:** AC-SO-10a through AC-SO-10d.
- **FR-SO-11 — normal query authority.** Attention scope MUST NOT inject, clear, broaden, or reorder normal Session query results. **Criteria:** AC-SO-11.

### 6.2 Future Attention requirements

- **FR-AT-1 — independent owner.** Attention MUST own subject relation, reasons, lifecycle, evidence, aggregate state, and its scoped query; WorkItem is only a possible subject. **Criteria:** AC-AT-1a, AC-AT-1b.
- **FR-AT-2 — lifecycle.** Attention MUST enforce the complete reason transition graph, including deterministic snooze return and invalid-transition rejection. **Criteria:** AC-AT-2a through AC-AT-2i.
- **FR-AT-3 — aggregate and fingerprint.** Attention MUST calculate effective state under §4.3 and enforce active reason-fingerprint uniqueness. **Criteria:** AC-AT-3a, AC-AT-3b.
- **FR-AT-4 — producer evidence.** An Attention reason MUST have an approved producer and evidence reference; raw text or age alone MUST NOT create one. **Criteria:** AC-AT-4.
- **FR-AT-5 — scoped destination and return.** An Attention badge/query MUST open its own exact Attention scope and return without altering the origin Session navigation state. **Criteria:** AC-AT-5a, AC-AT-5b.
- **FR-AT-6 — waiting-for-me boundary.** `Waiting for me` MUST be a separately scoped `required_human_action` Attention view, never an ordinary Session filter or Session-state mutation. **Criteria:** AC-AT-6.

### 6.3 Future Work Control Plane requirements

- **FR-WC-1 — WorkItem ownership.** WorkItem MUST own only Work lifecycle, Work priority, Work due commitment, and Work progress evidence; it MUST NOT own Attention or Session operational state. **Criteria:** AC-WC-1a, AC-WC-1b.
- **FR-WC-2 — optional binding and project integrity.** Session↔WorkItem binding MUST obey the proposed cardinality, same-workspace, unbound, and legacy-project reconciliation rules in §3.1. **Criteria:** AC-WC-2a through AC-WC-2c.
- **FR-WC-3 — Project and Task reconciliation.** A hierarchy delivery MUST preserve distinct Project surfaces and reconcile Session, WorkItem, and task-spec project references under §3.2 before mutation. **Criteria:** AC-WC-3a, AC-WC-3b.

## 7. Acceptance criteria

All criteria below are [PROPOSED] verification requirements. Current test paths are cited only where they supply a baseline fixture; no validation command is authorized by this document.

### 7.1 Sessions Operations

- **AC-SO-1a (FR-SO-1).** **Given** a fixture of normal Sessions and a captured normal list/table/board projection, **when** unrelated WorkItem or Attention records are created, updated, acknowledged, snoozed, or resolved, **then** the normal projection contains the same Session IDs and the same Session-only row fields.
- **AC-SO-1b (FR-SO-1).** **Given** every normal Session row, drag, `SessionCommand`, and `BulkUpdateSessionsPatch` serializer, **when** their shapes are inspected in a contract test, **then** none contains a WorkItem, Portfolio, Attention, generic Run, or generic Attempt field.
- **AC-SO-2 (FR-SO-2).** **Given** a Session with `sessionStatus='needs-review'`, **when** an Attention reason for that Session changes state, **then** persisted `sessionStatus` remains `needs-review`.
- **AC-SO-3 (FR-SO-3).** **Given** a Session with `kanbanColumn='in-progress'`, **when** a WorkItem relation is added or an Attention reason changes state, **then** persisted `kanbanColumn` remains `in-progress`.
- **AC-SO-4 (FR-SO-4).** **Given** a Session with `priority='urgent'`, **when** it has no Attention reason and then receives an actionable required-action reason, **then** persisted priority remains `urgent` in both states.
- **AC-SO-5a (FR-SO-5).** **Given** a Session, **when** `setRank('!!!')` is requested, **then** the operation rejects with an invalid-rank error and does not persist `!!!`. **Current baseline evidence:** `packages/server-core/src/sessions/session-collection-fields.test.ts:144-147`.
- **AC-SO-5b (FR-SO-5).** **Given** a ranked Session `s5` and missing `prevId='missing-prev'`, **when** `reorderRank` runs, **then** it rejects with `RANK_NEIGHBORS_STALE` and leaves the existing rank intact. **Current baseline evidence:** `packages/server-core/src/sessions/session-collection-fields.test.ts:157-160`.
- **AC-SO-5c (FR-SO-5).** **Given** one workspace fixture with missing ranks and `lastMessageAt` values `{ old: 1000, mid: 2000, new: 3000 }`, **when** `getSessions('ws_test')` backfills ranks, **then** rank ascending orders IDs exactly `[new, mid, old]`. **Current baseline evidence:** `packages/server-core/src/sessions/session-collection-fields.test.ts:174-188`.
- **AC-SO-5d (FR-SO-5).** **Given** the ranks produced by AC-SO-5c, **when** the same workspace is loaded again without rank edits, **then** every Session rank is byte-for-byte the first-load value. **Current baseline evidence:** `packages/server-core/src/sessions/session-collection-fields.test.ts:189-193`.
- **AC-SO-6 (FR-SO-6).** **Given** a Session with a non-null `dueDate`, **when** its Attention state or WorkItem lifecycle changes, **then** persisted `dueDate` is unchanged; a separate Session `setDueDate(null)` still clears only the due-date field and emits `dueDate: null`. **Current baseline evidence:** `packages/server-core/src/sessions/session-collection-fields.test.ts:134-142`.
- **AC-SO-7 (FR-SO-7).** **Given** a Session with `hasUnread=true` and a known `lastReadMessageId`, **when** an Attention reason changes state, **then** both persisted/read-projection values are unchanged.
- **AC-SO-8 (FR-SO-8).** **Given** a Session with `isFlagged=true`, **when** an Attention reason changes state, **then** persisted `isFlagged` remains true.
- **AC-SO-9 (FR-SO-9).** **Given** two otherwise identical Sessions whose only difference is `lastMessageAt`, including one hydrated from legacy `lastUsedAt`, **when** normal and Attention queries run, **then** neither receives a progress, health, blocked, inactive, stale, or Attention label solely from that timestamp.
- **AC-SO-10a (FR-SO-10).** **Given** selected IDs `{ hidden, b, a }` and visual eligible IDs `[b, a, b, visible]`, **when** the visible/eligible-selection snapshot is made, **then** it submits exactly `[b, a]` in that order with no duplicate or hidden ID. **Preservation evidence:** `apps/electron/src/renderer/components/app-shell/collection/__tests__/collection-bulk-optimistic.test.ts:16-24`.
- **AC-SO-10b (FR-SO-10).** **Given** a bulk request for `['valid', 'missing']`, **when** preflight finds `missing`, **then** the result is `ok: []`, `failed: [{ id: 'valid', error: 'preflight_aborted' }, { id: 'missing', error: 'not_found' }]`, and `valid` retains its old metadata. **Current baseline evidence:** `packages/server-core/src/sessions/session-collection-fields.test.ts:231-247`.
- **AC-SO-10c (FR-SO-10).** **Given** archive targets `free` and processing `busy`, **when** bulk archive runs, **then** `free` is the only successful ID, `busy` reports `busy`, and the bulk event carries only `free` with the original patch. **Current baseline evidence:** `packages/server-core/src/sessions/session-collection-fields.test.ts:249-263`; `packages/server-core/src/handlers/rpc/sessions-bulk.test.ts:69-121`.
- **AC-SO-10d (FR-SO-10).** **Given** an older optimistic bulk update to `priority='high'` is pending and a newer update to `priority='low'` succeeds, **when** the older persistence write fails, **then** rollback does not overwrite the newer `low` value. **Current baseline evidence:** `packages/server-core/src/sessions/session-collection-fields.test.ts:265-306`; renderer seam: `collection-bulk-optimistic.test.ts:26-84`.
- **AC-SO-11 (FR-SO-11).** **Given** a normal Session query whose filters exclude a subject with actionable Attention, **when** the Attention record is created or updated, **then** the normal query returns the same filtered Session ID sequence and never injects that subject.

### 7.2 Attention

- **AC-AT-1a (FR-AT-1).** **Given** an approved Session subject and an approved WorkItem subject, **when** one Attention reason is created for each, **then** each reason is stored under its own Attention-owned subject key and neither subject gains an Attention field or lifecycle mutation.
- **AC-AT-1b (FR-AT-1).** **Given** a WorkItem with a stable lifecycle value, **when** an Attention reason for it is acknowledged, snoozed, reopened, or resolved, **then** the WorkItem lifecycle, Work priority, Work due commitment, and Work progress evidence are unchanged.
- **AC-AT-2a (FR-AT-2).** **Given** an `open` Attention reason, **when** it is acknowledged with actor/evidence metadata, **then** its state becomes `acknowledged` and no Session or WorkItem field changes.
- **AC-AT-2b (FR-AT-2).** **Given** an `open` Attention reason, **when** it is snoozed with a valid future `snoozedUntil`, **then** its state becomes `snoozed` and it is active but not actionable.
- **AC-AT-2c (FR-AT-2).** **Given** a snoozed reason whose `snoozedUntil` has passed, **when** the return process runs twice, **then** it produces exactly one `snoozed → open` transition and the reason becomes actionable.
- **AC-AT-2d (FR-AT-2).** **Given** an `acknowledged` Attention reason, **when** it is explicitly resumed with actor/evidence metadata, **then** its state becomes `open` and no Session or WorkItem field changes.
- **AC-AT-2e (FR-AT-2).** **Given** an `acknowledged` Attention reason, **when** it is snoozed with a valid future `snoozedUntil`, **then** its state becomes `snoozed` and no Session or WorkItem field changes.
- **AC-AT-2f (FR-AT-2).** **Given** parameterized active reasons in each of `open`, `acknowledged`, and `snoozed` states, **when** each is resolved with actor/evidence metadata, **then** each reaches `resolved` and no Session or WorkItem field changes.
- **AC-AT-2g (FR-AT-2).** **Given** a resolved reason, **when** an authorized producer supplies explicit reopen evidence, **then** the reason becomes `open` and no subject field changes.
- **AC-AT-2h (FR-AT-2).** **Given** a resolved reason, **when** a producer requests reopen without explicit reopen evidence, **then** the request is rejected and the reason remains resolved.
- **AC-AT-2i (FR-AT-2).** **Given** a requested edge outside the allowed transition set, including `snoozed → acknowledged`, `resolved → acknowledged`, or `resolved → snoozed`, **when** it is submitted, **then** it is rejected and both the reason and its subject remain unchanged.
- **AC-AT-3a (FR-AT-3).** **Given** one subject with distinct `open`, `acknowledged`, and `snoozed` reasons, **when** its aggregate is computed, **then** one AttentionItem is rendered with `effectiveState='actionable'` and all three reason records visible on drill-in.
- **AC-AT-3b (FR-AT-3).** **Given** an active reason with `(workspaceId, subjectType, subjectId, source, fingerprint)`, **when** the same producer emits the same active fingerprint again, **then** there remains exactly one active reason and one AttentionItem for that subject.
- **AC-AT-4 (FR-AT-4).** **Given** an unallowlisted producer, a missing evidence reference, or only timestamp/raw-text input, **when** it attempts to create a reason, **then** it is rejected and no AttentionItem/Reason is written; **when** an allowlisted producer supplies an approved evidence reference, **then** the resulting reason retains that reference.
- **AC-AT-5a (FR-AT-5).** **Given** an Attention badge rendered from a captured `AttentionScope` whose subject keys are `[s1, s2]`, **when** the badge is opened, **then** the destination is an Attention-scoped view whose rendered subject IDs are exactly `[s1, s2]` for that snapshot, not an arbitrary global result.
- **AC-AT-5b (FR-AT-5).** **Given** an origin Session navigation snapshot with filters, display/order, group-collapse state, and selected IDs, **when** a user opens scoped Attention and returns, **then** the restored origin snapshot equals the captured snapshot and no Attention predicate becomes a Session filter.
- **AC-AT-6 (FR-AT-6).** **Given** an actionable reason with code `required_human_action`, **when** `Waiting for me` is opened, **then** it appears only in the corresponding Attention scope and the subject Session's status/filter membership remains unchanged.

### 7.3 Work Control Plane

- **AC-WC-1a (FR-WC-1).** **Given** a WorkItem linked to zero Sessions, **when** its Work lifecycle changes, **then** no Session status, Kanban placement, rank, priority, due date, unread state, flag, or Attention state changes.
- **AC-WC-1b (FR-WC-1).** **Given** an Attention transition for a WorkItem subject, **when** it persists, **then** no WorkItem lifecycle, priority, due commitment, or progress evidence changes.
- **AC-WC-2a (FR-WC-2).** **Given** an existing Session with no `workItemId`, **when** a hierarchy migration is evaluated without an explicit approved bind, **then** the Session remains unbound and its current Project scalar/working directory are unchanged.
- **AC-WC-2b (FR-WC-2).** **Given** a Session and WorkItem in the same workspace whose resolved legacy `Session.projectId` equals `WorkItem.projectId`, **when** the approved bind is applied, **then** the Session has exactly one WorkItem relation and neither Project scalar nor working directory is rewritten.
- **AC-WC-2c (FR-WC-2).** **Given** a cross-workspace, dangling, foreign, or different-Project legacy scalar, **when** a WorkItem bind is attempted, **then** it is blocked with the applicable reconciliation state and no relation/event/mutation is written.
- **AC-WC-3a (FR-WC-3).** **Given** a Project with config, asset files, `MEMORY.md`, and a prompt projection, **when** a future Project/Work migration runs, **then** each source remains recoverable in its original boundary and no prompt projection is serialized as ProjectConfig.
- **AC-WC-3b (FR-WC-3).** **Given** a task spec `project`, orchestrator/child Session project scalars, and a proposed WorkItem project, **when** all present values resolve in one workspace and agree, **then** binding preserves the task spec and existing orchestrator Session ID; **when** any value is dangling, foreign, or conflicts, **then** migration records a blocked outcome and performs no silent rewrite.

## 8. Non-functional requirements

| ID | Requirement | Measurable verification |
|---|---|---|
| **NFR-SO-1 — owner isolation** | Session, WorkItem, and Attention owners MUST remain separate. | For each AC-SO-2 through AC-SO-8 and AC-AT-1b/AC-WC-1b fixture, a deep comparison of non-owned fields before/after is identical. |
| **NFR-SO-2 — deterministic normal-surface preservation** | Attention/Work changes MUST NOT change normal Session query/output or current Session-only payload schemas. | AC-SO-1a and AC-SO-1b compare ordered IDs and serialized payload keys exactly; no added Work/Attention key is permitted. |
| **NFR-SO-3 — rank-scope honesty** | No migration MAY claim a global or membership-local rank scope until the neighbor universe is characterized. | G-4 evidence includes same-workspace and cross-workspace neighbor fixtures, raw-header snapshots, and the exact AC-SO-5 baseline. A missing fixture is a gate failure. |
| **NFR-SO-4 — scoped navigation integrity** | An Attention destination MUST be explainable and return without origin-state loss. | The invoked subject-key set equals the destination set at its captured scope/revision; returning produces byte-for-byte equal serialized origin navigation state (AC-AT-5a/b). |
| **NFR-SO-5 — migration recoverability** | A migration MUST be resumable, idempotent, and attributable to immutable input. | An interruption after any recorded checkpoint resumes with the same final relation set, no duplicate writes, a preserved input digest, and a per-record outcome (EC-MIG-1). |
| **NFR-SO-6 — Attention integrity** | Active reason deduplication and snooze return MUST be deterministic. | Duplicate active-fingerprint input leaves active-reason count at 1; two return passes yield exactly one `snoozed → open` transition (AC-AT-2c, AC-AT-3b). |
| **NFR-SO-7 — no timestamp-derived health** | Timestamp-only variation MUST NOT affect progress, health, or Attention state. | AC-SO-9 varies only `lastMessageAt`/legacy fallback provenance and asserts no resulting label, filter, order, or reason change. |

### 8.1 Quality categories explicitly N/A / deferred

| Category | Status | Gate/reason |
|---|---|---|
| Future Attention/Work API latency, throughput, and scalability | **N/A — DEFERRED** | No store, query shape, transport, or workload is approved. G-7 must set a measurable budget. |
| Authorization, tenancy, and abuse controls for Attention producers | **N/A — DEFERRED** | Producer/subject authorization is not approved. G-6/G-7 must define it before a writer exists. |
| Evidence retention, privacy, redaction, and deletion | **N/A — DEFERRED** | Evidence-reference format and retention policy are not approved. G-6/G-7 must define them before persistence. |
| Future renderer accessibility and interaction performance | **N/A — DEFERRED** | No Attention/Work renderer design is approved. G-8 must provide the relevant quality contract. |
| Migration recovery/durability | **Applicable now as a future prerequisite** | NFR-SO-5 and EC-MIG-1 are mandatory before any migration execution. |

## 9. Edge-case and error register

| ID | Boundary | Required outcome |
|---|---|---|
| **EC-SO-1** | Bulk call has no transport-bound workspace. | [OBSERVED] RPC rejects `bulk_workspace_context_required`; no manager mutation occurs. |
| **EC-SO-2** | Bulk input workspace differs from caller workspace. | [OBSERVED] RPC rejects `bulk_workspace_mismatch`; no manager mutation occurs. |
| **EC-SO-3** | Bulk target is missing or foreign. | [OBSERVED] all targets abort preflight: `ok=[]`; offending IDs report `not_found`/`foreign` and otherwise valid requested IDs report `preflight_aborted`. |
| **EC-SO-4** | Bulk archive includes a processing Session. | [OBSERVED] that target may report `busy` while eligible targets can succeed. |
| **EC-SO-5** | Per-target bulk persistence fails after optimistic mutation. | [OBSERVED] the target reports its error string; rollback restores only fields still owned by that operation and does not overwrite a later mutation. |
| **EC-SO-6** | Rank input is invalid or a neighbor is stale. | [OBSERVED] invalid rank is rejected; missing neighbor yields `RANK_NEIGHBORS_STALE`; no new rank scope is inferred. |
| **EC-AT-1** | A producer is unallowlisted, unauthorized, malformed, or lacks evidence. | [PROPOSED] reject with no Attention write and retain an auditable rejection outcome; exact API error schema is deferred to G-6/G-7. |
| **EC-AT-2** | A duplicate event/fingerprint arrives while its reason is active. | [PROPOSED] deduplicate idempotently: one active reason and one aggregate subject row remain. |
| **EC-AT-3** | A stale event/revision or stale badge scope arrives. | [PROPOSED] reject/mark stale according to the future revision policy; never apply a stale transition blindly or substitute a global Attention query. |
| **EC-AT-4** | Snooze return is retried, runs late, or races manual resume/resolve. | [PROPOSED] apply at most one valid return transition; resolved wins over an obsolete snooze return. |
| **EC-WC-1** | A Session/WorkItem/Project reference is dangling or cross-workspace. | [PROPOSED] block the record with a per-record reconciliation outcome; no link, implicit project repair, working-directory rewrite, or event is written. |
| **EC-WC-2** | Task-spec `project`, Session scalar, and WorkItem project disagree. | [PROPOSED] record `project_conflict`; retain all current values; require explicit auditable resolution. |
| **EC-MIG-1** | A hierarchy/rank migration is interrupted. | [PROPOSED] resume from a versioned journal/checkpoint and immutable input digest; replay is idempotent and cannot duplicate a link or resurrect legacy rank. |
| **EC-REF-1** | Project archive/deletion or subject cleanup would orphan Work/Attention references. | [PROPOSED] no silent cascade or rewrite. The dedicated future specification must choose and test retain/archive/block/explicit-detach behavior before the operation is authorized. |
| **EC-DISP-1** | Future SavedView/Collection fields are written to current display storage. | [OBSERVED normalizer behavior] unknown display fields are dropped; [PROPOSED] therefore reject this placement and require separate versioned storage. [OBSERVED: `packages/shared/src/sessions/collection-display-storage.ts:56-128`] |

## 10. Circle relevance

[OBSERVED] The approved 2026-08-08 PRD names Circle as Linear-style presentation inspiration and explicitly excludes its code and product information architecture. [OBSERVED: `docs/superpowers/specs/2026-08-08-sessions-collection-linear-views-prd.md:31,41-51,53-69`]

[PROPOSED] This boundary keeps only that presentation lesson: dense Session operations can use list/board/table, filter chips, display controls, explicit priority, due dates, and manual ordering. It explicitly rejects importing Circle's issue/initiative/team ontology, persistence assumptions, or code.

## 11. Proposed diff to the 2026-08-08 Sessions Collection PRD

| Existing PRD area | Proposed amendment after this draft is approved | Rationale |
|---|---|---|
| Metadata / context | Add this draft as an approved boundary amendment; retain the original PRD as the approved Sessions Collection presentation baseline. | The old document predates the current observed inventory and cannot authorize a different product domain. |
| §1.1 Problem | Replace “missing Session fields” language with the current inventory in §2; retain dense Session triage as the problem. | `rank`, `priority`, and `dueDate` already exist in reviewed source. |
| §1.2 Goals | Retain list/board/table and Session operations. Add FR-SO-1 through FR-SO-11 and NFR-SO-1 through NFR-SO-7. | Preserve a Session Operations Console rather than expanding it implicitly into Work/Attention. |
| §1.3 Non-goals | Add generic Portfolio/WorkItem implementation, generic Run/Attempt, Attention persistence, named SavedViews, explicit Collection membership, membership-local rank, total urgency score, timestamp-derived health/progress, and Circle ontology. | These are separate future domains or deliberately rejected in this boundary. |
| §1.4 decisions and rank narrative | State that current rank is a per-Session scalar with workspace-grouped backfill and uncharacterized neighbor scope; G-4 decides whether it stays scalar or moves to explicit Collection membership. | Prevent an unverified global-rank claim and avoid a SavedView rank universe. |
| Session field section | Convert field-introduction language to preservation/migration inventory. State `lastMessageAt` as partial activity/order input with legacy fallback, not health/progress. | Align with reviewed runtime behavior. |
| Project / task references | Add distinct config/assets/prompt-memory/slug/workspace mapping and task-spec `project` reconciliation rules. | Avoid conflating independent current owners. |
| Commands, bulk, display | Preserve the actual current `SessionCommand`, `sessions:bulkUpdate`, `BulkUpdateSessionsResult`, `sessions:bulkChanged`, and normalized display persistence boundary from §4.5. | Keep future fields out of Session transport/storage. |
| Acceptance criteria | Retain and strengthen current rank/bulk regression fixtures; add §7's atomic preservation criteria. Move future Attention/Work criteria into their dedicated specifications when gates approve the data owners. | Each criterion tests one observable contract. |
| API/data models | Keep current Session contracts. Mark future Attention/Work/Run/Collection/SavedView APIs and physical models N/A/deferred. | Prevent invented interfaces or accidental implementation authorization. |
| Delivery slices | Freeze any scope expansion pending this review. Future Work, Attention, Run/Attempt, SavedView, and Collection/rank deliveries require independent approved specifications. | Separates migration authority and reduces owner conflation. |

## 12. Decision gates before implementation

| Gate | Required decision/evidence | Blocks |
|---|---|---|
| **G-1 — evidence scope** | Approve this observed/proposed evidence boundary and source map; resolve factual disputes before a future spec treats them as current behavior. | All future domain work. |
| **G-2 — hierarchy cardinality** | Approve/revise Portfolio↔Project, Project↔WorkItem, WorkItem↔Session min/max, unbound Session policy, subject kinds, and same-workspace rule. | WorkItem schema, relation writer, migration. |
| **G-3 — Project compatibility** | Approve `WorkItem.projectId` interaction with legacy `Session.projectId`, dangling/foreign policy, working-directory behavior, project archive/deletion policy, and named context producer/consumer. | Project/Session/Work cutover. |
| **G-4 — rank owner and scope** | Characterize neighbor scope, select scalar versus explicit Collection membership rank, and approve legacy fencing/journal semantics. | Any rank-owner/schema/migration change. |
| **G-5 — Task Conductor mapping** | Approve task-spec `project` reconciliation, adapter/evidence boundaries for task results, and generated-orchestrator adoption preservation. | Work/Run/Attempt adaptation. |
| **G-6 — Attention taxonomy and lifecycle** | Approve subject kinds, producer allowlist, reason codes/severity, evidence format/retention, fingerprint/reopen semantics, authorization, stale-event behavior, and snooze scheduler semantics. | Attention writer, API, event, notification, or store. |
| **G-7 — physical data/API/migration authority** | Approve field/type/constraint models, stores, writers/readers, revision/event contracts, authorization, EC outcomes, journal/checkpoint/retry/rollback, and referential cleanup. | Any durable domain data or transport. |
| **G-8 — presentation and navigation authority** | Map each approved view through renderer state, navigation scope/return, filter/selection preservation, accessibility/performance requirements, and acceptance evidence. | Any Attention/Work UI integration. |

## 13. Evidence and verification map

This is a specification evidence map, not a request to run the listed tests now.

| Boundary | Source evidence / preservation fixture |
|---|---|
| Current Session, task, bulk DTOs | `packages/shared/src/protocol/dto.ts:45-140,228-379,464-540` |
| Session persistence | `packages/shared/src/sessions/types.ts:29-75,116-247` |
| Project config/assets/prompt projections/storage | `packages/shared/src/projects/types.ts:33-113`; `packages/shared/src/projects/storage.ts:4-10,53-68,94-139,145-245` |
| Collection types/query/display persistence | `packages/shared/src/sessions/collection-types.ts:1-102`; `packages/shared/src/sessions/collection-query.ts:16-31,107-238`; `packages/shared/src/sessions/collection-display-storage.ts:1-128` |
| Session lifecycle, project binding, rank, timestamps, task adoption, bulk | `packages/server-core/src/sessions/SessionManager.ts:1199-1209,2591-2611,2907-2955,3208-3237,4952-5001,6547-6707,8067-8245,8294-8317,8377-8425,8467-8558` |
| Current command/bulk RPC/event boundary | `packages/server-core/src/handlers/rpc/sessions.ts:305-449` |
| Rank and manager-bulk baseline fixtures | `packages/server-core/src/sessions/session-collection-fields.test.ts:123-306` |
| RPC bulk event fixture | `packages/server-core/src/handlers/rpc/sessions-bulk.test.ts:69-162` |
| Selection/optimistic and Kanban ordering preservation seams | `apps/electron/src/renderer/components/app-shell/collection/__tests__/collection-bulk-optimistic.test.ts:16-111`; `apps/electron/src/renderer/components/app-shell/kanban/__tests__/kanban-selection.test.ts:21-62` |
| Approved prior presentation PRD | `docs/superpowers/specs/2026-08-08-sessions-collection-linear-views-prd.md:13-69,89-114` |

## 14. Review request

Reviewers should approve or revise the proposed hierarchy cardinalities, legacy Project reconciliation, rank-owner decision, Task Conductor mapping, Attention taxonomy/lifecycle, and the deferred API/data-model boundaries before any implementation or migration begins. This single draft remains a system-boundary specification; it is not an implementation plan and does not resume product work.
