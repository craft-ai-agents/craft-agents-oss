# Entity Mind Map Views — дизайн

Дата: 2026-08-08. Статус: утверждён пользователем (решения ниже).  
Референс UX: [KMind Zen](https://kmind.app/) (табы 导图/分屏/大纲, zen, 缩略图/minimap, floating chrome).  
Репо-контекст на момент дизайна: `feat/p4-siyuan-surfaces`, уже есть `SessionViewTabs` (Standard | Graph | Mind map | Team chat), где Graph/Mind map = embedded SiYuan docks на `notebook/__full__`, не session-scoped.

## Проблема

1. У session «Mind map» не показывает структуру сессии — открывает глобальный SiYuan graph dock.
2. Notes и knowledge не имеют переключаемого spatial/outline вида над панелью.
3. Нет Craft-owned projection entity → дерево/карта, нет pin layout, zen, minimap.
4. KMind-класс UX (mode triad, overview, distraction-free) отсутствует как first-party.

Пользователь хочет: **авто-ментальные карты по session / note / knowledge entity**, переключение **табом над текущей панелью**, с возможностью pin и (позже) материализации в knowledge-файл.

## Цели

1. Единый `EntityViewTabs` над content panel для **session, note, knowledge doc|block**.
2. Таб **Map** = авто-проекция структуры entity (outline-first), без обязательного SiYuan.
3. Таб **Outline** = та же иерархия списком.
4. **Live + pin**: по умолчанию live; pin сохраняет structure+layout отдельным артефактом **без writeback** в source entity.
5. **AI enrich** — opt-in действие, не default path.
6. **Pluggable engine**: shell/chrome наши; v1 = Craft SVG tree; later optional adapters.
7. KMind-inspired chrome в map host: Map|Split, zen, minimap, fit/zoom, in-map search.
8. **Не ломать** существующие SiYuan Graph / Mind map tabs — они остаются рядом с новым Map на переходный период.

## Утверждённые решения

| Тема | Решение |
|---|---|
| Природа карты | Гибрид **live + pin** |
| Entity scope v1 | **session + notes + knowledge** (не весь NavigationState) |
| Derive | **Outline first + optional AI enrich** |
| Edit/writeback | Pin = **layout + structure, без writeback** в entity |
| Renderer | **Hybrid host + pluggable engine**; Craft SVG v1 |
| Tabs | Единый **EntityViewTabs** |
| Approach | **A projection-first + later B** (pin → knowledge file) |
| SiYuan legacy | **Оставить** Graph и старый Mind map (SiYuan) рядом; новый таб = Craft Map |

## Нецели (v1)

- Writeback rename/move/reparent с карты в session/note/SiYuan.
- Полный parity KMind (themes designer, cloze, formulas, multi-root freeform, relationship-line editor, .kmindz).
- Tabs для source / skill / automation / cloud-run / memory.
- Real-time collab на pinned maps.
- Удаление SiYuan graph/mindmap tabs в том же PR, что вводит Craft Map (отдельное решение позже).
- Materialize pin as knowledge file — фаза P5, не блокер v1.

## Текущее состояние (факты)

### KMind (референс, web app + README plugin)

- Mode tabs: 导图 (map) / 分屏 (split map+outline) / 大纲 (outline).
- Chrome: project, expand/zen, search, 缩略图 (thumbnail/minimap entry), tools.
- Shared editor core; SiYuan doc-tree maps, block/doc cards; portable `.kmindz`.
- Visual: dark zen, floating capsules, low chrome.

### Craft

| Кусок | Путь | Заметка |
|---|---|---|
| Session tabs | `apps/electron/src/renderer/components/app-shell/SessionViewTabs.tsx` | `standard \| graph \| mindmap \| teamchat` |
| Mount | `ChatPage.tsx` | graph→`global-graph`, mindmap→`graph` на `SIYUAN_FULL_SURFACE_ID` |
| Knowledge surface | `KnowledgeSurfacePage.tsx`, `siyuan-url.ts` | modes outline/backlinks/graph/global-graph/… |
| Context data | `packages/core/src/knowledge/context.ts` | `ContextPayload`: children, backlinks, content, contentHash |
| Outline parse | `apps/electron/src/renderer/knowledge/outline-parser.ts` | ATX H1–H6 |
| Notes | `NotesPage.tsx` + notes RPC | folder tree, wikilinks, backlinks |
| Panel split | `atoms/panel-stack.ts` | multi-panel, не map\|outline |
| Surface tabs | `platform/SurfaceTabs.tsx` | browser-like panel strip — **не** путать с EntityViewTabs |

Native mind-map/canvas engine: **нет**.

---

## Архитектура

```
Entity (session | note | knowledge)
        │
        ▼
 MindMapSource adapter  ──►  deriveOutlineTree()  ──►  MindMapGraph
        │                         │
        │                    optional enrichMindMap() (AI)
        │                         │
        └──── PinnedMap store ◄───┘
                    │
                    ▼
            MindMapHost (chrome: mode/zen/minimap/pin)
                    │
                    ▼
            MindMapEngine (SVG v1 | future adapters)
```

### Слои и пути

| Слой | Расположение |
|---|---|
| Types, derive, hash, pin IO | `packages/core/src/mindmap/*`, export `./mindmap` |
| AI enrich | RPC `mindmap.enrich` (server-core) + core pure apply |
| EntityViewTabs, Host, default engine | `apps/electron/src/renderer/mindmap/*` |
| Session wire | `ChatPage` + обобщение `SessionViewTabs` |
| Notes wire | `NotesPage` под header |
| Knowledge wire | Craft-side tabs around knowledge doc host (не внутри SiYuan iframe chrome) |

### Канонические типы

```ts
type MindMapEntityRef =
  | { type: 'session'; sessionId: string }
  | { type: 'note'; noteId: string }
  | { type: 'knowledge'; ref: KnowledgeRef }

type MindMapNodeId = string

interface MindMapNode {
  id: MindMapNodeId
  label: string
  kind: 'root' | 'heading' | 'block' | 'message' | 'tool' | 'backlink' | 'link' | 'section'
  level: number
  source?: { kind: string; id: string } // click-through into Standard
  children: MindMapNodeId[]
  collapsed?: boolean
  meta?: Record<string, string | number | boolean>
}

interface MindMapEdge {
  id: string
  from: MindMapNodeId
  to: MindMapNodeId
  kind: 'parent' | 'backlink' | 'wikilink' | 'mention' | 'followup'
}

interface MindMapGraph {
  entity: MindMapEntityRef
  rootId: MindMapNodeId
  nodes: Record<MindMapNodeId, MindMapNode>
  edges: MindMapEdge[]
  contentHash: string
  derivedAt: number
  derivation: 'outline' | 'outline+ai' | 'pinned'
}

interface MindMapLayout {
  positions: Record<MindMapNodeId, { x: number; y: number }>
  collapsed: MindMapNodeId[]
  viewport?: { x: number; y: number; zoom: number }
}

interface PinnedMap {
  id: string
  entity: MindMapEntityRef
  graph: MindMapGraph
  layout: MindMapLayout
  sourceContentHash: string
  createdAt: number
  updatedAt: number
}
```

Stable node ids (примеры):

- session: `root`, `turn:<userMessageId>`, `msg:<id>`, `tool:<callId>`, `heading:<msgId>:<index>`
- note: `root`, `h:<line>:<slug>`, `backlink:<noteId>`
- knowledge: `root`, `block:<blockId>`, `backlink:<kind>:<id>`

### Source adapters

| Entity | Input | Tree | Secondary edges |
|---|---|---|---|
| session | ordered messages (+ title) | root=title; child per user turn; assistant+tool under turn; optional split assistant by md headings | followups if present |
| note | markdown + meta | root=title; `parseOutline` nested by level; body without headings → synthetic `section:body` | wikilink/backlink nodes or edges |
| knowledge | `knowledge.get` / `getContext` | prefer `children[]`; else outline(`content`) | `backlinks[]` as `kind:backlink` |

`contentHash` = hash(normalized structural inputs: labels + parent relations + source ids). Live mode пересчитывает graph при смене hash. LLM **не** вызывается на каждый keystroke.

### Pin / live / re-sync

- Default Map = **live** (`derivation: 'outline'`), layout = auto (engine), collapse ephemeral unless pinned.
- **Pin** → persist `PinnedMap` under workspace config, e.g. `{workspace}/mindmaps/<type>_<id>.json` (точный path в implementation plan; не `~` hardcode).
- После pin: badge `Pinned`; structure edits (rename label, reparent, add/remove node in pin) + layout persist; **source entity immutable via map**.
- **Re-sync v1**: если `sourceContentHash !== currentHash` → banner; actions **Keep pin** | **Rebuild from source** (discard pin structure, keep nothing / optional keep viewport only). Merge — out of v1.
- Entity deleted → on open pin, GC or show “source missing”.

### AI enrich

- Action “Improve map…” on host toolbar.
- Input: current `MindMapGraph` (+ optional truncated source text).
- Output: new `MindMapGraph` draft (`derivation: 'outline+ai'`) overlay.
- Accept → write/update pin; Discard → back to previous live/pin.
- Failure → toast; keep prior graph.
- Requires existing model/runtime; offline → disable action with reason.

### Engine port

```ts
interface MindMapEngine {
  mount(el: HTMLElement, props: EngineProps): EngineHandle
}

interface EngineHandle {
  update(props: Partial<EngineProps>): void
  destroy(): void
  fitView(): void
}

interface EngineProps {
  graph: MindMapGraph
  layout: MindMapLayout | 'auto'
  mode: 'map' | 'outline' | 'split'
  zen: boolean
  readOnlyStructure: boolean // true live; false pinned
  onLayoutChange(layout: MindMapLayout): void
  onGraphChange?(graph: MindMapGraph): void
  onNavigate(source: NonNullable<MindMapNode['source']>): void
  onSelect(nodeId: MindMapNodeId | null): void
}
```

**V1 Craft SVG engine**

- Horizontal (or logical) tree layout, bezier parent edges.
- Secondary edges (backlink) distinct stroke (dashed).
- Pan (empty drag), wheel zoom, pinch if easy.
- Collapse chevron; Fit; zoom ±.
- Minimap bottom-right; hide if `nodeCount < 12`.
- HTML/SVG foreignObject labels (Craft tokens).
- Outline mode = virtualized list sharing selection with map in split.

**Future adapters** (not v1): `KmindEngineAdapter`, `SiyuanGraphAdapter` — same `MindMapEngine` interface.

---

## UI

### EntityViewTabs

Размещение: **под** `PanelHeader`, **над** body (как сейчас SessionViewTabs).  
Не использовать `SurfaceTabs` (это stack open panels).

```
┌ PanelHeader ─────────────────────────────────────┐
│ EntityViewTabs …                                  │
├───────────────────────────────────────────────────┤
│ Standard | Map host | Outline list | SiYuan …     │
└───────────────────────────────────────────────────┘
```

**Tab ids (target):**

```ts
type EntityViewId =
  | 'standard'
  | 'map'           // NEW Craft mind map
  | 'outline'       // NEW full-page outline of same graph
  | 'graph'         // EXISTING SiYuan graph (session/knowledge when available)
  | 'mindmap'       // EXISTING SiYuan mindmap/graph dock — keep during transition
  | 'teamchat'      // placeholder, session only
```

**Availability matrix**

| Tab | Session | Note | Knowledge |
|---|---|---|---|
| standard | ChatDisplay | TipTap | SiYuan surface / home |
| map | Craft MindMapHost | Craft MindMapHost | Craft MindMapHost |
| outline | Craft outline | Craft outline | Craft outline |
| graph | SiYuan if connected | hidden | SiYuan if connected |
| mindmap (legacy) | SiYuan if connected | hidden | optional / hidden if redundant |
| teamchat | placeholder | hidden | hidden |

**Persistence:** `localStorage` key `entityViewMode:<type>:<id>` (session keeps backward compat: read old `sessionViewMode` / `mindmap` values; write new scheme).

**Migration SessionViewTabs**

1. Extract generic `EntityViewTabs` + `useEntityView(ref, capabilities)`.
2. Session wrapper passes capabilities including legacy `graph` + `mindmap`.
3. i18n: add `entityView.map` (“Map” / «Карта»); keep `sessionView.mindmap` label for legacy SiYuan tab (e.g. “SiYuan map” / «Карта SiYuan») to avoid two identical labels.
4. Clean cutover of component implementation; no permanent duplicate tab strip code paths.

### MindMapHost chrome (когда active view = map)

| Control | Behavior |
|---|---|
| Submode | **Map \| Split** (outline-only full page = Entity tab Outline, not third submode required). Split = map + outline sash. |
| Zen | Hides app left sidebar, navigator, right sidebar, heavy header actions; keeps EntityViewTabs + compact “Exit zen”. Window-level state, not per-entity. |
| Minimap | BR overlay; viewport rect; drag/click pan. Auto-hide small graphs. |
| Pin | Live→Pin; Pinned badge; menu Re-sync |
| Enrich | Improve map… |
| Search | In-map label filter + highlight |
| Fit / zoom | Fit all, ±, 100% |
| Status | Live \| Pinned \| Enriching \| Stale source |

**Click-through (v1):** node with `source` → switch Entity tab to **standard** + focus:

- session → scroll/highlight message  
- note → editor cursor to heading/block  
- knowledge → focus block in surface / open ref  

Split-peek without leaving Map — v2.

### Visual

- Craft design tokens; not pixel-copy KMind.
- Low-chrome canvas; clear mode strip + status (the “aviation” cue = instrument clarity, not skeuomorphism).

### Empty / errors

- No structure → empty state + short tips (add headings / continue chat).
- Knowledge provider down → error + retry; **never** silently open `notebook/__full__`.
- Legacy SiYuan tabs keep their own error paths.

---

## Интеграционные точки

### Session (`ChatPage`)

```
EntityViewTabs
  standard → ChatDisplay (current)
  map      → MindMapHost(entity=session)
  outline  → MindMapOutline(entity=session)
  graph    → KnowledgeSurfacePage global-graph (UNCHANGED)
  mindmap  → KnowledgeSurfacePage graph (UNCHANGED legacy)
  teamchat → placeholder
```

Derive input: session messages from existing session atoms/store (same source ChatDisplay uses).

### Notes (`NotesPage`)

- Insert EntityViewTabs under note title/header when a note is open.
- standard → current editor+inspector  
- map/outline → MindMapHost/Outline from note markdown + backlinks RPC  

### Knowledge

- For opened document/block (not only KnowledgeHome hub): Craft tabs above or beside surface.
- standard → current KnowledgeSurface editor mode  
- map/outline → derive via `knowledge.getContext` / get + backlinks  
- graph → existing surface mode (unchanged)  

Avoid fighting SiYuan internal docks for Craft Map — Map is Craft React tree, not dock inject.

### Panel-stack

Entity views are **per panel content**, not global. Each session panel has its own `useEntityView`. Zen may collapse shell chrome globally while any map zen is on (define single zen owner in impl plan).

---

## Фазы

| Phase | Deliverable | Exit criteria |
|---|---|---|
| **P0** | core types + derive(session/note/knowledge) + contentHash + unit tests | fixtures green; stable ids |
| **P1** | EntityViewTabs on 3 surfaces; Map = simple auto tree or rich outline; legacy SiYuan tabs preserved | session Map ≠ SiYuan full notebook; note/knowledge have tabs |
| **P2** | SVG engine pan/zoom/collapse/minimap/fit; click-through standard | manual smoke + unit layout/collapse |
| **P3** | Split map\|outline; Zen; Pin store + Re-sync Keep\|Rebuild | pin survives reload; stale banner works |
| **P4** | AI enrich RPC + Accept→pin | fail-soft offline |
| **P5** | Materialize pin → knowledge file (B); optional engine adapter | export/open path documented |

Recommended ship slices: P0+P1 minimal useful; P2/P3 UX parity with KMind-inspired chrome; P4/P5 incremental.

---

## Тестирование

Observable contracts (не source-text asserts):

1. **derive session**: N user turns → N turn-nodes under root; tools nested under assistant parent.
2. **derive note**: nested ATX headings → parent/child by level; fence-safe (reuse outline-parser rules).
3. **derive knowledge**: children[] blocks become tree; backlinks → edges or leaf nodes with ids.
4. **contentHash**: identical structure → same hash; label/parent change → different hash.
5. **pin IO**: save/load round-trip; entity key isolation.
6. **no writeback**: pin graph edit does not call notes.update / knowledge mutate / session message edit APIs.
7. **tabs**: storage migrate old session `mindmap` selection does not crash; legacy tab still mounts SiYuan surface.
8. **engine**: collapse hides descendant render; minimap mapping invertible for pan.
9. **click-through**: onNavigate receives expected source descriptor for fixture nodes.

Integration: one test per entity type mounting Host with fixture graph (no real SiYuan required for Craft Map).

---

## Риски и митигации

| Risk | Mitigation |
|---|---|
| Huge sessions | Cap turns in derive (configurable, e.g. last 200); cluster older; virtualize outline |
| Two “map” tabs confuse users | Distinct labels: “Map” vs “SiYuan map”; tooltip explains |
| Zen fights board/session layouts | Zen only when Map active; restore chrome on tab leave |
| Pin orphans | GC on missing entity; don’t block UI |
| Scope creep to KMind clone | Hard non-goals list; P5+ only with new approval |
| SiYuan connection absent | Craft Map still works; legacy tabs hidden/disabled |
| Double outline (entity tab vs split) | Documented: Entity Outline = full page; Split outline = companion |

---

## Open points (решить в implementation plan, не блокеры дизайна)

1. Exact pin filesystem path + whether pins sync via workspace backup.
2. Default tree direction (LR vs TB) and density token.
3. Session turn collapsing rules when assistant has multiple tool rounds.
4. Whether knowledge Map uses live-reference context or snapshot-only.
5. When to drop legacy `mindmap` SiYuan tab (separate ADR after usage data).

---

## Success metrics (qualitative)

- User opens session Map and sees **that session’s** structure without SiYuan.
- Same tab chrome on note and knowledge doc.
- Pin → quit → reopen → layout/structure restored; source note text unchanged.
- Legacy Graph/SiYuan map still reachable in one click.

---

## Appendix — Mapping KMind → Craft

| KMind | Craft v1 |
|---|---|
| 导图 | Entity tab Map + host submode Map |
| 大纲 | Entity tab Outline |
| 分屏 | Host submode Split |
| 缩略图 | Minimap overlay |
| Zen / expand UI | Zen toggle |
| .kmindz file | P5 materialize (not v1) |
| Editable map = source | Pin artifact only; no writeback |
| SiYuan plugin host | Legacy tabs + knowledge standard surface |
