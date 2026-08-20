# S-02 · SurfaceRegistry и единые вкладки

> Документ: `S-02`, сьют `2026-08-07-unified-shell`
> Статус: draft
> Дата: 2026-08-07
> Входные документы: вердикт архитектуры интеграции (`att1`, §2.4, §3.2, §3.3, §4.2, §16), документ единой оболочки (`att2`, §2 «Верхняя система вкладок», §9, §17-W1, §18), скаут кодовой базы `SurfacesBrowser` (craft-agents main @ 961c1f450).
> Связанные: [README](./README.md), [слоты оболочки](./01-shell-slots.md), [панели и рейлы](./03-panels-rails.md), [Omnibox](./04-omnibox.md), [контракт Knowledge Provider](../2026-08-07-siyuan-integration/03-knowledge-provider-contract.md), [контур записи](../2026-08-07-siyuan-integration/05-mutation-safety.md), [roadmap](./09-roadmap-waves.md).

## 1. Цель

Превратить центральную рабочую область Craft из жёстко прошитого набора веток навигации в **реестр поверхностей с едиными вкладками**: любая рабочая сущность (сессия, документ SiYuan, база знаний, браузерный таб, облачный запуск, diff предложения записи, view расширения) открывается как вкладка одного хоста, сериализуется в layout и переживает перезапуск.

Конкретные результаты документа:

- нормативная модель `SurfaceTab` (вербатим из `att2` §2) и её согласование с `SurfaceDescriptor` из `att1` §3.2;
- контракт `WorkspaceSurfaceHost` (`att1` §3.2): `open / close / focus / split / restore / serializeLayout / manageBounds`;
- привязка каждого решения к существующему коду: `panel-stack.ts`, `NavigationContext.tsx`, `routes.ts`, `route-parser.ts`, `MainContentPanel.tsx`, `BrowserPanelPage.tsx`, `BrowserPaneManager`;
- план миграции закрытого union `PanelType` к реестру без регрессий существующих Sessions (волна W1 из `att1` §17 и `att2` §17).

## 2. Контекст и мотивация

### 2.1 Что уже есть в кодовой базе

Центральная область сегодня — это **panel-stack** (VS Code-подобные editor groups), а не компонент `WorkspaceView` (такого символа в craft-agents нет). Точки входа:

| Механизм | Файл | Факт |
|---|---|---|
| Модель стопки панелей | `apps/electron/src/renderer/atoms/panel-stack.ts` | `PanelStackEntry { id, route, proportion, panelType, laneId }`; атомы `pushPanelAtom`, `closePanelAtom`, `resizePanelsAtom`, `reconcilePanelStackAtom` (key-preserving, :185), `focusedPanelIdAtom`, `visibleSessionIdsAtom` (:132), `parseSessionIdFromRoute` (:110) |
| Закрытый union типов | `apps/electron/src/renderer/atoms/panel-stack.ts:16` | `PanelType = 'session' \| 'source' \| 'settings' \| 'skills' \| 'browser' \| 'other'` — **ровно 6 значений, закрытый** |
| Lane-заготовка | `apps/electron/src/renderer/atoms/panel-stack.ts:17-26` + `__tests__/panel-stack-lanes.test.ts` | `PanelLaneId = 'main'` (единственная живая), `PanelLanePolicy { order, allowedTypes, locked, singleton }`, `OpenIntent = 'implicit' \| 'explicit'` — scaffolding под multi-lane, не включён |
| Маппинг route → тип | `apps/electron/src/renderer/atoms/panel-stack.ts:65` | `getPanelTypeFromRoute(route: ViewRoute)` через `parseRouteToNavigationState`; нераспознанное → `'other'` |
| URL — источник истины | `apps/electron/src/renderer/contexts/NavigationContext.tsx` (1309 LOC) | `syncUrl` (ws/route/panels/fi/sidebar), `reconcileFromUrlParams`, восстановление при смене workspace, deep links, слушатель `NAVIGATE_EVENT` |
| Построители маршрутов | `apps/electron/src/shared/routes.ts` | `view.allSessions(sessionId?)` (:97), `view.browser(instanceId)` → `` `browser/instance/${encodeURIComponent(instanceId)}` `` (:202), `action.newSession()` |
| Парсер маршрутов | `apps/electron/src/shared/route-parser.ts` (~1018 LOC) | route → `NavigationState { filters, details: session/source/skill/note/project/automation/browser }` |
| Ветвление рендера | `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx` | цепочка `is*Navigation`-guard'ов (`isSettingsNavigation`, `isSourcesNavigation`, `isSkillsNavigation`, `isMemoryNavigation`, `isAutomationsNavigation`, `isProjectsNavigation`, `isBrowserNavigation` (:399), `isNotesNavigation`, `isSessionsNavigation`) → страницы |
| Dedup-фокус | `apps/electron/src/renderer/components/app-shell/AppShell.tsx:640-646` | `navigateToSessionInPanel`: если `parseSessionIdFromRoute(entry.route) === sessionId` уже в стопке — фокус на существующую панель вместо открытия дубликата |
| Хранилище ключей | `apps/electron/src/renderer/lib/local-storage.ts` | `KEYS.panelLayout = 'panel-layout'` (используемый, :36), `KEYS.tabs = 'tabs'` workspace-scoped `tabs-${workspaceId}` — **объявлен, но мёртв** (:39), `KEYS.workspaceUrl = 'workspace-url'` — полный URL search string для восстановления панелей/фокуса/sidebar (:64) |
| Host-surface шаблон | `apps/electron/src/renderer/pages/BrowserPanelPage.tsx` + `apps/electron/src/main/browser-pane-manager.ts` | rect-reporter div + `ResizeObserver` + rAF position watcher → `syncBounds(instanceId, rect \| null)`; `createEmbeddedInstance(input?)` возвращает `browser-embedded-${++instanceCounter}` (:2158-2159) |
| Экземпляры браузера | `apps/electron/src/main/browser-pane-manager.ts` (4014 LOC) | `Map<string, BrowserInstance>`, embedded = композит из 3 `WebContentsView` (toolbar + page + overlay, partition `persist:browser-pane`) |

### 2.2 Почему текущее не масштабируется

Добавление нового вида поверхности (Knowledge, Cloud Run, Diff) сегодня означает правку **шести разрозненных мест**: union `PanelType`, `getPanelTypeFromRoute`, построитель в `routes.ts`, ветку в `route-parser.ts`, новый guard в `NavigationContext`, новую ветку в `MainContentPanel.tsx`. Это ровно тот «огромный AppShell», который `att2` §9 запрещает наращивать. При этом:

- `KEYS.tabs` мёртв — вкладки как сущность не сериализуются; сериализуется только URL целиком (`KEYS.workspaceUrl`) и пропорции через `useResizablePanels` → `panel-layout:<key>`. Единого снимка layout поверхностей нет.
- Lane-механика (`PanelLanePolicy.allowedTypes/locked`, `navigate(route, { newPanel, targetLaneId })` в `apps/electron/src/renderer/lib/navigate.ts`) готова, но не включена: вкладки не имеют модели «куда открывать».
- Browser-поверхность доказала host-surface паттерн (встраивание чужого web-приложения через bounds-синхронизацию), но паттерн не выделен в контракт — knowledge surface предстоит строить по нему «вручную».

Вывод: регрессионно безопасный путь — **обернуть panel-stack в реестр**, не ломая URL-истину и существующие ветки, а затем свести ветки к contributions.

## 3. Решение

### 3.1 Модель вкладки: `SurfaceTab` (нормативно, вербатим из `att2` §2)

```typescript
type SurfaceTab =
  | { kind: "session"; sessionId: string }
  | { kind: "knowledge"; ref: KnowledgeRef }
  | { kind: "browser"; tabId: string }
  | { kind: "database"; ref: KnowledgeRef }
  | { kind: "cloud-run"; runId: string }
  | { kind: "extension"; extensionId: string; viewId: string }
  | { kind: "diff"; proposalId: string };
```

Семь видов. `KnowledgeRef` — по контракту [Knowledge Provider](../2026-08-07-siyuan-integration/03-knowledge-provider-contract.md) (`{ scheme: "siyuan"; kind: "notebook" | "document" | "block" | "database" | "asset"; id: string }`, `att1` §3.3). `proposalId` связывает diff-вкладку с предложением записи из [контура записи](../2026-08-07-siyuan-integration/05-mutation-safety.md).

Ключевое требование `att2`: «Переключение не уничтожает контекст» — см. §3.9.

### 3.2 `SurfaceDescriptor`: согласование двух union'ов

`att1` §3.2 задаёт внутренний дескриптор хоста:

```typescript
type SurfaceDescriptor =
  | { kind: "chat"; sessionId: string }
  | { kind: "browser"; tabId: string }
  | { kind: "knowledge"; ref: KnowledgeRef }
  | { kind: "cloud-run"; runId: string }
  | { kind: "diff"; proposalId: string };
```

Расхождение нормативно разрешается так (новое правило, «новый компонент»):

- `SurfaceTab` — **UI-уровень** (что видит пользователь в полосе вкладок), 7 видов;
- `SurfaceDescriptor` — **host-уровень** (что реально монтирует хост), 5 видов;
- правила понижения: `tab.kind === "session"` → descriptor `"chat"`; `"database"` → descriptor `"knowledge"` с `ref.kind === "database"`; `"extension"` → descriptor-specific view, рендеримый через sandbox-bridge ([plugin bridge](./06-plugin-bridge.md)), для host'а это extension-surface;
- обратная подъёмка из descriptor в tab всегда однозначна по сохранённому tab ref.

`att1` §2.4 называет тот же набор `SurfaceManager { ChatSurface, BrowserSurface, KnowledgeSurface, RunSurface, DiffSurface }` — эти классы становятся **реализациями** contributions реестра (см. §3.3), а не новым иерархическим слоем.

### 3.3 SurfaceRegistry (новый компонент)

```typescript
interface SurfaceContribution {
  kind: SurfaceTab["kind"];
  /** Извлечь tab из NavigationState/route; null — роут не наш. */
  match(navState: NavigationState): SurfaceTab | null;
  /** Построить ViewRoute для tab (обратно к routes.view.*). */
  buildRoute(tab: SurfaceTab): ViewRoute;
  title(tab: SurfaceTab): string;
  icon(tab: SurfaceTab): string;
  /** Политика открытия: lane, singleton-поведение, dedup-ключ. */
  policy: { singletonPer: (tab: SurfaceTab) => string; preferredLane?: PanelLaneId };
  render: (tab: SurfaceTab, ctx: SurfaceRenderContext) => ReactNode;
  /** Нужен ли host-frame с manageBounds (embedded webContents). */
  hostKind: "dom" | "bounds-managed";
}

interface SurfaceRegistry {
  register(contribution: SurfaceContribution): Disposable;
  resolve(navState: NavigationState): SurfaceContribution | null;   // registry → legacy fallback
  tabs(): SurfaceTab[];                                              // текущая стопка как вкладки
}
```

Реестр живёт в renderer рядом с `atoms/panel-stack.ts` (по принципу `att1` §16 «НЕ создавать сразу 8 новых пакетов»: сначала `apps/electron/src/renderer/platform/SurfaceTabs.tsx` + `surfaces/`, выделение пакета — только когда модуль понадобится server/CLI/web). `PanelRegistry` для боковых слотов — отдельный документ [03-panels-rails](./03-panels-rails.md); здесь реестр только центральных поверхностей.

### 3.4 `WorkspaceSurfaceHost` — API (нормативный набор из `att1` §3.2)

```typescript
interface WorkspaceSurfaceHost {
  open(tab: SurfaceTab, opts?: { newPanel?: boolean; targetLaneId?: PanelLaneId; focus?: boolean }): string; // → panelId
  close(panelId: string): void;
  focus(panelId: string): void;
  split(panelId: string, direction: "right" | "down", proportion?: number): string; // → новый panelId
  restore(snapshot: SurfaceLayoutSnapshot): Promise<void>;   // см. §3.10
  serializeLayout(): SurfaceLayoutSnapshot;
  /** Bounds-контракт для bounds-managed поверхностей (обобщение browserPane.syncBounds). */
  manageBounds(panelId: string, rect: { x: number; y: number; width: number; height: number } | null): void;
}
```

Семантика по методам:

- `open` — единственная точка создания. Внутри: dedup по `policy.singletonPer` (обобщение проверки из `AppShell.tsx:640-646`), затем `pushPanelAtom` либо навигация существующей панели. `opts.targetLaneId` пробрасывается в `navigate(route, { newPanel, targetLaneId })` (`lib/navigate.ts`) — сегодня bubble через `NAVIGATE_EVENT` в `NavigationContext`.
- `close` / `focus` — тонкие делегаты к `closePanelAtom` / `focusedPanelIdAtom`; `Cmd+W` уже ведёт на `closePanelAtom(focused)` через `useWindowCloseHandler` (`hooks/useWindowCloseHandler.ts`).
- `split` — `pushPanelAtom` с пропорцией; ресайз как сейчас через `PanelResizeSash` → `resizePanelsAtom` (dbl-click equalize).
- `manageBounds` — прямой аналог `window.electronAPI.browserPane.syncBounds(instanceId, rectOrNull)`; `null` = скрыть/припарковать webContents. Подробности в §3.8.
- `serializeLayout` / `restore` — §3.10.

Host — **адаптер над panel-stack**, не замена: вся URL-истина `NavigationContext` сохраняется.

### 3.5 Маппинг SurfaceTab.kind → существующий код

| `SurfaceTab.kind` | Сегодняшний `PanelType` (:16) | Маршрут сегодня | Ветка `MainContentPanel` | Реализация W1+ |
|---|---|---|---|---|
| `session` | `'session'` | `view.allSessions(sessionId)` (:97) | `isSessionsNavigation` → `ChatPage` (`pages/ChatPage.tsx`, `React.memo({sessionId})`) | contribution `chat`, `singletonPer: t => t.sessionId` |
| `browser` | `'browser'` | `view.browser(instanceId)` (:202) | `isBrowserNavigation` (:399) → `BrowserPanelPage` | contribution `browser`, bounds-managed |
| `knowledge` | — (нет) | `view.siyuan(...)` — **новый маршрут** (§3.6) | новая ветка → `KnowledgeSurface` (новый компонент) | contribution `knowledge`, bounds-managed |
| `database` | — | `view.siyuan(ref)` с `ref.kind='database'` | та же ветка knowledge | descriptor-понижение §3.2 |
| `cloud-run` | — (сейчас run — диалог/просмотр внутри sessions) | `view.cloudRun(runId)` — **новый** | новая ветка → RunSurface (новый компонент; live-лог уже есть в контуре cloud-runs) | W2+ |
| `diff` | — | `view.proposal(proposalId)` — **новый** | новая ветка → `KnowledgeDiff` (компонент из `att1` §8, новый) | по мере [контура записи](../2026-08-07-siyuan-integration/05-mutation-safety.md) |
| `extension` | — | `view.extension(extensionId, viewId)` — **новый** | sandbox-view ветка | с [plugin bridge](./06-plugin-bridge.md), W6 |
| (settings/source/skills…) | `'settings' \| 'source' \| 'skills' \| 'other'` | существующие `view.settings()` и пр. | существующие ветки | остаются legacy-ветками до фазы M3 (§3.11); вкладками **не** становятся — это навигаторные представления |

### 3.6 Маршрутизация: построитель + парсер + guard + ветка

Все четыре шага повторяют существующий шаблон `browser`:

1. **Построитель** — по образцу `routes.ts:202`:
   `view.siyuan = (ref: KnowledgeRef) => \`knowledge/${ref.kind}/${encodeURIComponent(ref.id)}\` as const` — **новый маршрут** (имя `routes.view.siyuan` фиксируем как нормативное).
2. **Парсер** — `route-parser.ts`: новый `details: { type: 'knowledge', ref }`, зеркаля `details.type === 'browser'` (который сейчас читается в `MainContentPanel.tsx:400` как `navState.details?.type === 'browser' ? navState.details.id : null`).
3. **Guard** — `isKnowledgeNavigation(navState)` в `NavigationContext` (новый, по образцу `isBrowserNavigation`, импортируемого в `MainContentPanel.tsx:37`).
4. **Ветка** — `MainContentPanel.tsx`: новый `if (isKnowledgeNavigation(navState))` → `KnowledgeSurface` (новый компонент), до фазы M3 — рядом с существующими ветками.

URL остаётся источником истины: открытие вкладки = изменение URL → `syncUrl` → атомы. Deep link `craft://knowledge/document/<id>` работает сразу, потому что механизм deep links уже в `NavigationContext`.

### 3.7 Идентификаторы: эфемерные instance ids vs durable refs

Нормативное правило («новый компонент» — политика, код частично существует):

- **Durable ref** — то, что сериализуется и переживает рестарт: `sessionId`, `runId`, `KnowledgeRef` (notebook/doc-keyed: `siyuan://document/<id>`, `siyuan://database/<id>`), `proposalId`, `extensionId+viewId`. Виден в URL, попадает в снимок layout.
- **Эфемерный instance id** — рабочий идентификатор живого процесса/вью: у браузера это `browser-embedded-${++instanceCounter}` (`browser-pane-manager.ts:2159`), привязанный к `Map<string, BrowserInstance>`; он **не сериализуется** (сегодня route несёт именно его — это известное ограничение, см. Открытые вопросы), у knowledge surface instance id = `knowledge-instance-${n}`, выдаётся `KnowledgeSurfaceManager` (новый компонент main-процесса, по именованию `att1` §8 `knowledge-surface-manager.ts`).
- Соотношение: `SurfaceTab` несёт durable ref; host выделяет instance id лениво при первом монтировании; `singletonPer` реестра обязан работать по durable ref, как сейчас `parseSessionIdFromRoute` работает по `sessionId` (`panel-stack.ts:110`).

### 3.8 Host-surface: `manageBounds` по шаблону BrowserPanelPage

Существующий шаблон (`BrowserPanelPage.tsx`, верифицировано по коду):

```
[renderer] rect-reporter div (пустой, full-size)
  ├─ ResizeObserver.observe(el) + window resize  → scheduleSync()        (:61-63)
  ├─ rAF position watcher: poll getBoundingClientRect кадр за кадром,
  │    сравнение сигнатуры с последней — IPC пропускается, если равны   (:73-94)
  └─ syncBounds(instanceId, rect | null):                                (:33-43)
       !isFocused || removed → null  (скрыть webContents)                (:35-37)
       unmount → syncBounds(null) best-effort                            (:120)
[main]     BrowserPaneManager: композит из 3 WebContentsView
           (toolbarView + pageView + overlayView, partition persist:browser-pane)
```

Обобщение в контракт host'а (изменения минимальны, все «новый компонент»):

- `HostSurfaceFrame` — переиспользуемый renderer-компонент: rect-reporter + `ResizeObserver` + rAF watcher (вынести из `BrowserPanelPage.tsx` без изменения поведения); канал — `manageBounds(panelId, rect | null)` → main.
- Knowledge surface: main-side `KnowledgeSurfaceManager` создаёт встроенный SiYuan-вью по той же схеме композита (toolbar — нет, page — SiYuan web, overlay — да); SiYuan editor **не переписывается и не DOM-портируется** (`att1` §4.2, §5; `att2` §18).
- JSX-DOM поверхности (`session`, `diff`, `cloud-run`) — `hostKind: "dom"`, `manageBounds` не вызывается.

### 3.9 Кэширование: переключение не уничтожает контекст

Требование `att2` §2 реализуется тем, что panel-stack уже держит **все панели смонтированными** (split view), а в не-сплит режиме скрытие — это `syncBounds(null)`, не destroy. Норматив:

- вкладка вне фокуса: состояние mounted сохраняется; bounds-managed поверхность получает `rect = null` (поведение `BrowserPanelPage.tsx:35-37`); DOM-поверхность остаётся в дереве (как сейчас `ChatPage` — `React.memo({sessionId})`, контекст сессии не пересоздаётся);
- закрытие вкладки: `close(panelId)` → unmount → `syncBounds(null)` best-effort → destroy instance (поведение `BrowserPanelPage.tsx:120` + `destroyForSession`-контур `BrowserPaneManager`);
- видимость считается через `visibleSurfaceIdsAtom` (**новый атом**, обобщение `visibleSessionIdsAtom`, `panel-stack.ts:132`): iterate стопки → по дешёкодированию route через registry; потребители — prefetch, keep-warm, heartbeat сессий (сейчас все потребляют `visibleSessionIdsAtom`, ломать нельзя — старый атом остаётся алиасом фильтра нового по `kind==='session'` до M4).

### 3.10 Сериализация layout: формат и восстановление

Сегодня: `KEYS.workspaceUrl` хранит полный URL search string (`local-storage.ts:64`, восстановление при переключении workspace в `NavigationContext`), пропорции — `KEYS.panelLayout` (:36), `KEYS.tabs` объявлен под `tabs-${workspaceId}`, но мёртв (:39).

Спецификация (**новый компонент**, ключ — воскрешаем `KEYS.tabs`, переименовывать не требуется):

```typescript
interface SurfaceLayoutSnapshot {
  version: 1;
  workspaceId: string;
  lanes: Array<{ laneId: PanelLaneId; locked: boolean }>;       // W1: всегда [{main, locked:false}]
  tabs: Array<{
    panelId: string;
    laneId: PanelLaneId;
    tab: SurfaceTab;              // TОЛЬКО durable ref (§3.7), никаких instance ids
    proportion: number;
    scrollState?: unknown;        // опционально, surface-specific
  }>;
  focusedIndex: number;
  savedAt: number;
}
```

Семантика записи: `serializeLayout()` дергается на закрытие окна / смену workspace (там же, где сейчас `KEYS.workspaceUrl`), плюс debounce на `resizePanelsAtom`. `KEYS.workspaceUrl` остаётся рабочим каналом URL-истины; снимок — производный, при конфликте **URL выигрывает**.

Семантика восстановления (`restore(snapshot)`):

1. reconcile через существующий `reconcilePanelStackAtom` (key-preserving, `panel-stack.ts:185`): вход = `{ route, proportion }[]` из `buildRoute(tab)` каждой вкладки — ids панелей сохраняются, пересоздания сессий не происходит.
2. Ленивость: bounds-managed вкладки (`browser`, `knowledge`) монтируют instance только при первом фокусе; `scrollState` применяется после первого `manageBounds`.
3. Битые refs (удалённый документ, отключённый SiYuan): вкладка рендерится как error-card с действиями retry/close (аналог empty-state embedded-браузера — `browser-empty-state.tsx`), стопка не падает.

### 3.11 План миграции: closed union → registry

| Фаза | Изменение | Критерий выхода |
|---|---|---|
| **M1. Обёртка** (W1) | `SurfaceRegistry` + `WorkspaceSurfaceHost` как адаптеры над `panel-stack.ts`/`NavigationContext`; builtin contributions `session`+`browser`; `PanelType` не трогаем; `VisibleSurfaceIds` алиас | Sessions открываются как surface без единой регрессии (критерий W1 из `att1`/`att2` §17); `BrowserPanelPage` работает как раньше, но bounds идут через `host.manageBounds` |
| **M2. Generic surface** | `PanelType` расширяется значением `'surface'` (вместо 6 — 7, обратно-совместимо: `'other'` живёт); `getPanelTypeFromRoute` (:65) спрашивает registry до fallback; маршруты `view.siyuan`, `view.cloudRun`, `view.proposal`; ветка knowledge в `MainContentPanel` | Document открывается вкладкой; URL round-trip; dedup-фокус по durable ref |
| **M3. Legacy → contributions** | Ветки `settings/source/skills/notes/projects/automations` переведены на contributions; в `MainContentPanel` остаётся один dispatch `registry.resolve(navState)` + fallback | Список guard'ов `is*Navigation` не растёт; новый вид поверхности = 1 файл contribution |
| **M4. Размыкание union** | `PanelType` заменён на `string` (registry-keyed), lane-policies включаются реально (`PanelLanePolicy.allowedTypes` по видам), `visibleSessionIdsAtom` читается из `visibleSurfaceIdsAtom` | Удалён список из 6 литералов; тесты `panel-stack-lanes.test.ts` зелёные на multi-lane конфиге |

## 4. Границы / что НЕ делаем

- **НЕ переписываем SiYuan editor.** Knowledge surface — управляемый embed (host-surface, §3.8), editor и kernel принадлежат SiYuan (`att1` §4.2, §5; `att2` §18 «переписывать SiYuan editor»). Никакого DOM-port редактора и автопереноса DOM любого SiYuan-плагина (`att2` §18).
- НЕ второй shell/второй ряд вкладок: SiYuan-вкладки внутри editor surface скрываются, верхняя полоса — только Craft (`att2` §2 «Editor tabs → Unified Surface Tabs», §5).
- НЕ ломаем URL-истину `NavigationContext`: реестр не вносит второго state-of-truth; `KEYS.workspaceUrl` остаётся, снимок производный.
- НЕ включаем multi-lane в W1: живёт только lane `'main'` (`panel-stack.ts:17`); политики — M4 и Открытые вопросы.
- НЕ делаем destroy-on-switch: запрещено требованием вкладок (`att2` §2) — см. §3.9.
- НЕ перемещаем код в отдельные пакеты: сначала `apps/electron/src/renderer/platform/` + `apps/electron/src/main/knowledge-surface-manager.ts` (`att1` §16); `packages/ui-collections` (`att1` §3.1) — отдельная история представлений, не вкладок.
- НЕ меняем конкурентную модель `BrowserPaneManager` (3-вью композит, partition) — его API лишь обобщается под `manageBounds`.
- Сторонние расширения НЕ получают `manageBounds`/webContents в Electron main (`att2` §8, §18): extension-surface — только sandboxed renderer.

## 5. Критерии приёмки

- [ ] `SurfaceTab` в коде — дословно 7-вариантный union из §3.1; `SurfaceDescriptor` — 5-вариантный из §3.2; правило понижения задокументировано в типе.
- [ ] `WorkspaceSurfaceHost` экспортирует все 7 методов из §3.4; `open` дедуплицирует по `singletonPer` — повторное открытие той же сессии фокусирует существующую панель (поведение `AppShell.tsx:640-646` сохранено).
- [ ] Каждый `kind` из таблицы §3.5 имеет contribution; добавление нового вида не трогает `MainContentPanel.tsx` после M3.
- [ ] `routes.view.siyuan(ref)` строится и парсится обратно: `buildRoute(tab)` → `match(parse(route))` — round-trip; deep link открывает вкладку без кликов по навигации.
- [ ] Bounds-контракт: уход фокуса с knowledge/browser вкладки шлёт `manageBounds(panelId, null)`; возврат фокуса восстанавливает контент без пересоздания instance (наблюдаемо по отсутствию перезагрузки webContents).
- [ ] `serializeLayout()` → рестарт → `restore(snapshot)`: порядок вкладок, `proportion` и `focusedIndex` восстановлены; сессии не пересозданы (`reconcilePanelStackAtom` key-preserving); instance ids в снимке отсутствуют.
- [ ] `KEYS.tabs` (`tabs-${workspaceId}`) наконец записывается; `KEYS.workspaceUrl` по-прежнему источник истины URL.
- [ ] `visibleSurfaceIdsAtom` ⊇ `visibleSessionIdsAtom` (старый атом — фильтр-алиас, потребители не сломаны).
- [ ] Панель команд `Cmd+W`, middle-click «open in new panel» (`SessionItem.tsx`), `openInNewPanel` (`useSessionMenuActions.ts`) работают на новых вкладках без исключений.

## 6. Открытые вопросы

1. **Multi-lane включение.** `PanelLanePolicy { allowedTypes, locked, singleton }` и тесты `panel-stack-lanes.test.ts` — заготовка; не решено: какие виды в какие lanes по умолчанию (например `diff` всегда в правый lane?), что делает `targetLaneId` при `locked: true`, UX переноса вкладки между lanes. Кандидат на M4 + документ [03-panels-rails](./03-panels-rails.md).
2. **Sleep/wake `visibleSurfaceIdsAtom`.** Дорогие поверхности (browser partition, SiYuan web) при долгом unfocus: выгружать ли webContents с «сном» (как discarded tabs), и как тогда восстанавливать scroll/undo after wake? Влияет на память при 10+ вкладках; требует замера.
3. **Эфемерность browser route.** Сегодня `view.browser(instanceId)` несёт эфемерный id — вкладка браузера не восстановима из снимка. Нужен durable `browserTabRef` (URL+title key?) или смена маршрута; владелец — Waves W1/W2.
4. **Лимит вкладок и eviction.** Есть ли максимум на workspace, и какая политика вытеснения кэша (LRU по последнему `manageBounds`?) — к [01-shell-slots](./01-shell-slots.md).
5. **Конфликт restore при смене workspace.** `KEYS.workspaceUrl` и снимок `KEYS.tabs` пишутся в разных точках; race при быстром переключении workspace → окно с чужим layout. Нужен порядок «сначала снимок, потом URL» или единая транзакция — решить в M1.
6. **`scrollState` формат.** Surface-specific (`unknown`) — унифицировать контракт или оставить per-kind blob; влияет на shareability снимков между машинами.
