# Entity Mind Map Views — Implementation Plan

> **For agentic workers:** Execute task-by-task. Checkboxes track progress. Spec: `docs/superpowers/specs/2026-08-08-entity-mindmap-views-design.md`.  
> Do **not** run full monorepo test/typecheck mid-flight across parallel agents — verify per-task scoped commands only; one final gate at the end.

**Goal:** Auto mind maps for session / note / knowledge via `EntityViewTabs` (Standard | Map | Outline + legacy SiYuan Graph/Mind map), outline-first derive in `@craft-agent/core/mindmap`, Craft SVG engine, live+pin without writeback.

**Architecture:** Pure derive in `packages/core/src/mindmap` → renderer `MindMapHost` + pluggable `MindMapEngine` → wire three surfaces. Legacy SiYuan tabs stay; new Craft tab id = `map`.

**Tech stack:** TypeScript, bun:test, React, existing local-storage + i18n (10 locale JSONs — **single owner per batch**).

**Branch context:** work on feature branch off current craft-agents HEAD (likely `feat/p4-siyuan-surfaces` or fresh branch from main per user). Do not touch unrelated WIP.

---

## Global constraints

- **No writeback** from map edits into session/note/knowledge mutate APIs.
- **No** deleting SiYuan `graph` / legacy `mindmap` tabs in P0–P3.
- **i18n:** one agent owns all `packages/shared/src/i18n/locales/*.json` updates in a batch.
- **Electron channel tests:** if new IPC/RPC channels added (P4 enrich), bump `ipc-channels` / parity lists.
- **core tsconfig:** new bun:test files need `"types": ["bun"]` if not already (knowledge lesson).
- Export: add `"./mindmap"` + `"./mindmap/*"` to `packages/core/package.json` like knowledge.
- Prefer moving `parseOutline` logic into core or shared import path used by derive — avoid duplicating fence-safe ATX rules (`apps/electron/.../outline-parser.ts`).
- Session messages: `StoredMessage` (`packages/core/src/types/message.ts`) — `id`, `type` (role), `content`, `toolName`, `toolUseId`, `parentToolUseId`, `turnId`.
- Current ChatPage: only `graph` special-cased; `mindmap` is placeholder (`available: false` in SessionViewTabs). Plan introduces `map` as Craft engine and may re-enable legacy `mindmap` as SiYuan surface with distinct label.

### Verified contracts (repo scout 2026-08-08)

| Concern | Fact | Path |
|---|---|---|
| Session messages | Flat `Message[]` / `StoredMessage`; tool nesting via `parentToolUseId` (+ `turnId`) | `packages/core/src/types/message.ts` |
| Turn grouping reference | `groupMessagesByTurn` in UI — prefer align derive grouping with this | `packages/ui/src/components/chat/turn-utils.ts` |
| Session title | `getSessionTitle`: name > first user msg > preview > i18n default | `apps/electron/src/renderer/utils/session.ts` |
| Messages load | Lazy `ensureSessionMessagesLoadedAtom` / `getSessionMessages` — Map tab MUST trigger load if empty | `atoms/sessions.ts`, ChatPage |
| Notes | `readNote` → `NoteDocument` (`content`, id, title) + backlinks | NotesPage, `protocol/dto.ts` |
| Knowledge renderer | `knowledge.get` + `getBacklinks` used in KnowledgeInspector; **`getContext` typed in channel-map but no renderer callsite yet** — Map wire is first consumer or use get+backlinks | KnowledgeInspector, channel-map |
| ContextPayload | `children[]`, `backlinks[]`, `content`, `contentHash` | `packages/core/src/knowledge/context.ts` |
| focusMode today | Hides sidebar+navigator only (CMD+.) — **not** full zen (header/right rail); P3 zen extends | AppShell |
| Session tabs now | `mindmap` `available: false` placeholder; only `graph` mounts SiYuan | SessionViewTabs, ChatPage |

**deriveSession note:** Reuse semantics of `groupMessagesByTurn` where practical (import from shared/ui only if core can depend; else reimplement minimal equivalent in core without UI deps).


---

## Phase P0 — Core mindmap module

### Task 0.1: Types + package export

**Files:**
- Create: `packages/core/src/mindmap/types.ts`
- Create: `packages/core/src/mindmap/index.ts`
- Modify: `packages/core/package.json` (exports)
- Modify: `packages/core/tsconfig.json` only if bun types missing

**Types (must match design):** `MindMapEntityRef`, `MindMapNodeId`, `MindMapNode`, `MindMapEdge`, `MindMapGraph`, `MindMapLayout`, `PinnedMap`, node `kind` union, edge `kind` union, `derivation` union.

- [ ] **Step 1:** Add `types.ts` + barrel `export * from './types.ts'`
- [ ] **Step 2:** Add package exports `"./mindmap"` → `./src/mindmap/index.ts`, `"./mindmap/*"` → `./src/mindmap/*`
- [ ] **Step 3:** `cd packages/core && bunx tsc --noEmit -p tsconfig.json` (or repo’s core typecheck script) — expect clean for new files
- [ ] **Step 4:** Commit `feat(mindmap): core types and package export`

### Task 0.2: contentHash + graph builder helpers

**Files:**
- Create: `packages/core/src/mindmap/hash.ts`
- Create: `packages/core/src/mindmap/graph.ts`
- Create: `packages/core/src/mindmap/__tests__/hash.test.ts`

**Behavior:**
- `hashMindMapSource(parts: string[]): string` — stable sha256 hex of joined normalized parts (or existing repo hash util if present).
- `createEmptyGraph(entity, rootLabel): MindMapGraph` with root node id `root`.
- `addChild(graph, parentId, node): void` maintains `children[]` + parent edge `kind:'parent'`.
- Finalize sets `contentHash`, `derivedAt`, `derivation`.

- [ ] **Step 1:** Failing tests — same inputs → same hash; child order affects hash; label change affects hash
- [ ] **Step 2:** Implement helpers
- [ ] **Step 3:** `bun test packages/core/src/mindmap` — pass
- [ ] **Step 4:** Commit `feat(mindmap): hash and graph builders`

### Task 0.3: Outline parse in core (shared)

**Files:**
- Create: `packages/core/src/mindmap/outline.ts` (port fence-safe ATX rules from electron `outline-parser.ts`)
- Create: `packages/core/src/mindmap/__tests__/outline.test.ts`
- Optional later: electron outline-parser re-exports core (clean cutover in Task 1.x if low risk)

- [ ] **Step 1:** Tests — nested H1/H2/H3; ignore fenced `#`; strip trailing `#`
- [ ] **Step 2:** Implement `parseOutlineHeadings(markdown) => {level,text,line}[]`
- [ ] **Step 3:** `headingsToTree(headings, rootId)` → nodes/edges structure used by note/knowledge derive
- [ ] **Step 4:** bun test — pass; commit `feat(mindmap): core outline parser`

### Task 0.4: deriveSession

**Files:**
- Create: `packages/core/src/mindmap/derive-session.ts`
- Create: `packages/core/src/mindmap/__tests__/derive-session.test.ts`

**Input type (minimal, no electron deps):**

```ts
export interface MindMapSessionInput {
  sessionId: string
  title: string
  messages: Array<{
    id: string
    type: string // MessageRole
    content: string
    toolName?: string
    toolUseId?: string
    parentToolUseId?: string
    turnId?: string
  }>
  /** default 200 */
  maxTurns?: number
}
```

**Rules:**
- root = title or `"Session"`
- Group by user message turns (prefer `turnId` when present; else sequential user→following non-user until next user)
- Under each turn: user node `msg:<id>`; assistant `msg:<id>` (label = first line / 80 chars); tools `tool:<toolUseId|id>` under assistant or by parentToolUseId
- Cap: keep last `maxTurns` user turns; set `meta.truncated` on root if truncated
- If assistant content has ATX headings, optional children `heading:<msgId>:<i>` (nice-to-have in P0; required if cheap)
- Ignore pure status/info roles if they clutter (document which roles skipped: e.g. statusType compaction)

- [ ] **Step 1:** Fixture with 2 user turns, assistant, 2 tools — assert tree shape + stable ids
- [ ] **Step 2:** Truncation test maxTurns=1
- [ ] **Step 3:** Implement `deriveSessionMindMap(input): MindMapGraph`
- [ ] **Step 4:** bun test; commit `feat(mindmap): derive session outline tree`

### Task 0.5: deriveNote + deriveKnowledge

**Files:**
- Create: `packages/core/src/mindmap/derive-note.ts`
- Create: `packages/core/src/mindmap/derive-knowledge.ts`
- Create: `packages/core/src/mindmap/__tests__/derive-note.test.ts`
- Create: `packages/core/src/mindmap/__tests__/derive-knowledge.test.ts`
- Modify: `packages/core/src/mindmap/index.ts` exports

**Note input:** `{ noteId, title, markdown, backlinks?: { id, title }[] }`  
**Knowledge input:** `{ ref: KnowledgeRef, title, content?, children?: {blockId,content}[], backlinks?: {ref,title}[] }` (mirror ContextPayload fields needed)

**Rules:**
- Note: outline tree; no headings → single `section:body` with truncated body label; backlinks as leaf nodes `backlink:<id>` under root or edges `kind:'backlink'`
- Knowledge: if children non-empty, tree from children (label = first line of content); else outline(content); backlinks secondary

- [ ] **Step 1–2:** Tests + implement both
- [ ] **Step 3:** Export `deriveSessionMindMap`, `deriveNoteMindMap`, `deriveKnowledgeMindMap`, types, outline helpers from index
- [ ] **Step 4:** bun test packages/core mindmap; commit `feat(mindmap): derive note and knowledge`

### Task 0.6: Pin store (core pure + path helper)

**Files:**
- Create: `packages/core/src/mindmap/pin.ts`
- Create: `packages/core/src/mindmap/__tests__/pin.test.ts`

**API (filesystem injected):**

```ts
export function entityPinKey(entity: MindMapEntityRef): string
export function serializePinnedMap(pin: PinnedMap): string
export function parsePinnedMap(json: string): PinnedMap
export async function loadPinnedMap(io: { read(path: string): Promise<string | null> }, dir: string, entity: MindMapEntityRef): Promise<PinnedMap | null>
export async function savePinnedMap(io: { write(path: string, data: string): Promise<void> }, dir: string, pin: PinnedMap): Promise<void>
```

- Pin filename: `session_<id>.json` / `note_<id>.json` / `knowledge_<kind>_<id>.json` (sanitize ids)
- Round-trip test with in-memory io
- `isStale(pin, currentHash)` helper

- [ ] Implement + test + commit `feat(mindmap): pinned map serialization`

**P0 exit:** `bun test packages/core/src/mindmap` all green; package export resolves.

---

## Phase P1 — EntityViewTabs + wire surfaces (Map = outline list MVP)

### Task 1.1: EntityViewTabs component

**Files:**
- Create: `apps/electron/src/renderer/components/app-shell/EntityViewTabs.tsx`
- Modify: `apps/electron/src/renderer/components/app-shell/SessionViewTabs.tsx` → thin wrapper OR delete and update imports
- Modify: `apps/electron/src/renderer/lib/local-storage.ts` — add `entityViewMode: 'entity-view-mode'` (keep `sessionViewMode` read-fallback)

**API:**

```ts
export type EntityViewId = 'standard' | 'map' | 'outline' | 'graph' | 'mindmap' | 'teamchat'

export type EntityViewCapability = {
  id: EntityViewId
  available: boolean
  labelKey: string
  icon: LucideIcon
}

export function useEntityView(
  scopeKey: string, // e.g. `session:${id}`
  capabilities: EntityViewCapability[],
  defaultId?: EntityViewId
): [EntityViewId, (id: EntityViewId) => void]
```

- Persist with `KEYS.entityViewMode` + scopeKey suffix
- Session migrate: if new key empty, read `KEYS.sessionViewMode` + sessionId; map unknown → standard
- Session capabilities default: standard, map (true), outline (true), graph (true if siyuan connected else false), mindmap legacy (true if siyuan — label SiYuan map), teamchat false
- For P1 if SiYuan detect hard: graph available true as today; mindmap legacy available false until Task 1.3

- [ ] Implement tabs UI clone of SessionViewTabs styling
- [ ] Unit/smoke: migrate storage (optional small test if storage mockable)
- [ ] Commit `feat(ui): EntityViewTabs with storage migrate`

### Task 1.2: i18n keys (single owner)

**Files:** all `packages/shared/src/i18n/locales/{en,ru,de,es,fr,hu,ja,pl,zh-Hans,zh-Hant}.json`

Keys to add (flat):
- `entityView.tabsLabel`
- `entityView.standard` (or reuse sessionView.standard)
- `entityView.map` — "Map" / "Карта"
- `entityView.outline` — "Outline" / "Оглавление"
- `entityView.graph` — can alias sessionView.graph
- `entityView.mindmapSiyuan` — "SiYuan map" / "Карта SiYuan"
- `entityView.teamChat`
- `entityView.comingSoon`
- `mindmap.empty`
- `mindmap.live` / `mindmap.pinned` / `mindmap.pin` / `mindmap.resync` / `mindmap.zen` / `mindmap.fit` / `mindmap.split` / `mindmap.enrich` (can stub unused until P2–P4)

- [ ] Update en + ru fully; other locales: en text OK as interim **or** proper translations if agent can
- [ ] Commit `i18n: entity view and mindmap strings`

### Task 1.3: MindMapOutline + Host shell (no SVG yet)

**Files:**
- Create: `apps/electron/src/renderer/mindmap/MindMapOutline.tsx` — virtualized/simple nested list from `MindMapGraph`
- Create: `apps/electron/src/renderer/mindmap/MindMapHost.tsx` — loads graph via props, shows status Live, empty state, outline as body for P1
- Create: `apps/electron/src/renderer/mindmap/useMindMapGraph.ts` — picks live derive vs pin later

P1 Host props:

```ts
{
  entity: MindMapEntityRef
  graph: MindMapGraph | null
  loading?: boolean
  error?: string | null
  onNavigate?: (source: ...) => void
  onSelect?: (id: string | null) => void
}
```

- [ ] Outline renders tree; click node calls onNavigate/onSelect
- [ ] Commit `feat(mindmap): host shell and outline list`

### Task 1.4: Wire ChatPage (session)

**Files:**
- Modify: `apps/electron/src/renderer/pages/ChatPage.tsx`

**Behavior:**
- Replace SessionViewTabs with EntityViewTabs capabilities
- `map` | `outline` → MindMapHost/Outline with `deriveSessionMindMap({ sessionId, title: displayTitle, messages: session.messages })`
- `graph` → existing KnowledgeSurface global-graph
- `mindmap` legacy → optional KnowledgeSurface graph (if available) **or** keep placeholder until SiYuan label ready — prefer wire same as old design (`mode="graph"`) when available=true
- `standard` → ChatDisplay
- Both skeleton and loaded branches (duplicate mount today ~849 and ~933) — extract small render helper to avoid drift

Click-through P1: `onNavigate` for `msg:*` → setView('standard') + optional scroll if ChatDisplay exposes imperative handle (if not, just switch tab in P1)

- [ ] Manual mental check: map never mounts SIYUAN_FULL for Craft map
- [ ] Commit `feat(session): craft map and outline tabs`

### Task 1.5: Wire NotesPage

**Files:**
- Modify: `apps/electron/src/renderer/pages/NotesPage.tsx` (and note header component if split)

- When note open: EntityViewTabs standard | map | outline
- deriveNoteMindMap from current note markdown/title/id + backlinks if already loaded
- standard = existing editor

- [ ] Commit `feat(notes): entity map and outline tabs`

### Task 1.6: Wire Knowledge doc surface

**Files:**
- Modify: knowledge doc host — likely wrapper around `KnowledgeSurfacePage` usage in MainContentPanel / knowledge routes
- Create thin `KnowledgeEntityViews.tsx` if needed

- Tabs when details = document/block: standard | map | outline | graph (siyuan)
- Map data: call existing knowledge RPC `getContext` or `get`+children (reuse inspector patterns in `KnowledgeInspector.tsx`)
- Fail: error card, no silent full-notebook fallback

- [ ] Commit `feat(knowledge): entity map and outline tabs`

**P1 exit:** User can open Map on session/note/knowledge and see outline tree of that entity; SiYuan graph still works on session.

---

## Phase P2 — SVG engine + minimap + click-through

### Task 2.1: layout algorithm

**Files:**
- Create: `packages/core/src/mindmap/layout.ts` OR renderer-only `apps/electron/.../mindmap/layout.ts`
- Prefer core pure function `autoLayout(graph, opts): MindMapLayout` for testability

- Horizontal tree: root left, children to the right; spacing constants; respect collapsed
- Tests: root at origin-ish; children monotonic x; collapsed skips descendants

- [ ] Commit `feat(mindmap): auto layout`

### Task 2.2: SvgMindMapEngine

**Files:**
- Create: `apps/electron/src/renderer/mindmap/engine/types.ts` (MindMapEngine port)
- Create: `apps/electron/src/renderer/mindmap/engine/svg-engine.tsx`
- Create: `apps/electron/src/renderer/mindmap/engine/minimap.tsx`

**Must:**
- mount/update/destroy
- pan (pointer on background), wheel zoom (ctrl/meta or plain — match app conventions)
- node chips with label; collapse toggle
- parent edges bezier; backlink edges dashed
- fitView()
- minimap BR; hidden if nodeCount < 12
- selection highlight
- `readOnlyStructure` true → no reparent UI

- [ ] Basic component test or layout interaction test if feasible in jsdom; else manual smoke checklist in PR
- [ ] Commit `feat(mindmap): svg engine and minimap`

### Task 2.3: Host uses engine; Map submode

**Files:**
- Modify: `MindMapHost.tsx` — mode map renders engine; outline tab still list; toolbar Fit/Zoom/Search filter

- [ ] Search filters labels (dim non-matches)
- [ ] Commit `feat(mindmap): host map mode with engine`

### Task 2.4: Click-through hardening

**Session:** ChatDisplay ref scroll to message id if exists; else tab switch only  
**Note:** editor command scroll to heading line from `source`  
**Knowledge:** open/focus block via existing navigation helpers

- [ ] Commit `feat(mindmap): navigate to source in standard view`

**P2 exit:** Spatial map usable; minimap; fit; navigate back to content.

---

## Phase P3 — Split, Zen, Pin

### Task 3.1: Split map | outline

**Files:** MindMapHost — sash using existing resize patterns (`useResizablePanels` or panel sash)

- Selection synced
- Submode toggle Map | Split in host toolbar (not EntityViewTabs)

- [ ] Commit `feat(mindmap): split map and outline`

### Task 3.2: Zen mode

**Files:**
- Reuse `focusModeEnabled` / sidebar hide machinery in AppShell if sufficient; else `mindmapZenAtom` that sets same hide flags
- Exit control visible on map
- Leaving map tab clears zen

- [ ] Commit `feat(mindmap): zen mode`

### Task 3.3: Pin persistence (electron IO)

**Files:**
- Create: main or preload path helper for `{workspaceRoot}/mindmaps/` OR config dir under workspace — **match existing workspace file patterns** (grep knowledge snapshots path)
- RPC or existing file bridge: read/write pin JSON
- Host: Pin button; badge; stale banner Keep | Rebuild
- Live collapse ephemeral; pinned collapse in layout

**Tests:**
- core pin already unit-tested; add integration with temp dir if easy
- **Assert no calls** to notes/knowledge mutate on pin edit (spy in host test if any)

- [ ] Commit `feat(mindmap): pin and resync`

**P3 exit:** Pin survives reload; zen/split work; no writeback.

---

## Phase P4 — AI enrich

### Task 4.1: RPC mindmap.enrich

**Files:**
- `packages/server-core` handler + channel registration
- core: `applyEnrichedOutline(graph, enrichment): MindMapGraph` pure merge
- electron IPC parity tests bump

**Contract:**

```ts
// request
{ entity: MindMapEntityRef, graph: MindMapGraph, sourceExcerpt?: string }
// response
{ graph: MindMapGraph } | { error: string }
```

- Use existing agent/LLM invocation patterns (do not invent new provider stack)
- Timeout + fail-soft

- [ ] Commit `feat(mindmap): enrich RPC`

### Task 4.2: UI Accept/Discard draft

- Host overlay draft graph; Accept → save pin; Discard → restore

- [ ] Commit `feat(mindmap): enrich UI`

---

## Phase P5 — Materialize pin + adapters (later)

### Task 5.1: Export pin → knowledge document (design B)

- Create knowledge doc from pinned graph markdown outline
- Link provenance attributes

### Task 5.2: Optional MindMapEngine adapter stub

- Interface-only documentation + no-op second engine for compile-time proof

*(Detailed steps when starting P5; not required for Map v1 ship.)*

---

## Final verification gate (once per ship slice)

After P1:
```bash
bun test packages/core/src/mindmap
# electron scoped if exists:
bun test apps/electron --grep mindmap  # or path-based
bun run typecheck:all   # if affordable; else packages/core + apps/electron typecheck
```

After P2/P3: manual smoke
1. Session with 3 turns → Map shows turns; click → Standard  
2. Note with headings → Map tree  
3. Knowledge doc with children → Map  
4. Graph tab still SiYuan  
5. Pin → restart → restored  
6. Zen hides chrome  

---

## Task order & parallelism

```
P0.1 → P0.2 → P0.3 → (P0.4 ∥ P0.5) → P0.6
P1.1 → P1.2 (i18n alone) → P1.3 → (P1.4 ∥ P1.5 ∥ P1.6)
P2.1 → P2.2 → P2.3 → P2.4
P3.1 ∥ P3.2 → P3.3
P4.1 → P4.2
P5 last
```

Cross-slice contracts frozen in design types — do not redefine `MindMapGraph` in renderer.

---

## Out of plan (do not implement)

- Writeback to entity
- Remove SiYuan tabs
- .kmindz / KMind bundle
- cloud-run/skill/automation maps
- Full KMind theme/cloze/formula parity

---

## Open points resolved at implement time

| Point | Default if unspecified |
|---|---|
| Pin directory | `{workspaceRoot}/mindmaps/` if workspace root exists; else config dir `mindmaps/` |
| Tree direction | LR horizontal |
| maxTurns | 200 |
| Knowledge context mode | prefer live getContext; fallback get+markdown |
| Legacy mindmap tab | available when SiYuan connected; label `entityView.mindmapSiyuan` |
