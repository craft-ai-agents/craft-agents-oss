# K-02 · Системная граница интеграции Craft × SiYuan

> **ID документа:** K-02
> **Статус:** draft
> **Дата:** 2026-08-07
> **Владелец:** команда форка `agisota/craft-agents-oss`
> **Входные документы:** архитектурный вердикт «Craft — магистраль, SiYuan — присоединяемый орган» (покрываются §§1–6 вердикта); scout-отчёты по репозиторию `craft-agents` @ main: RepoMap, AppShell, SessionsViews, SurfacesBrowser, SkillsCloud.
> **Связанные документы:** [K-00 Обзор интеграции](./00-overview.md), [K-01 ADR](./01-adrs.md), [K-03 Контракт KnowledgeProvider](./03-knowledge-provider-contract.md), [K-05 Контур записи и mutation safety](./05-mutation-safety.md), [K-06 Публикация сессий](./06-publication-pipeline.md), [K-07 Режимы подключения](./07-connection-modes.md), [K-08 Лицензирование](./08-licensing.md), [K-09 Движок коллекционных представлений](./09-collection-view-engine.md), [K-10 Skills и автоматизации](./10-skills-automations.md). Соседний сьют: [S-01 Слоты оболочки](../2026-08-07-unified-shell/01-shell-slots.md), [S-02 Реестр поверхностей и вкладки](../2026-08-07-unified-shell/02-surface-registry-tabs.md).

---

## 1. Цель

Зафиксировать единственную системную границу между тремя слоями продукта — оболочкой Craft, слоем интеграции знаний (Knowledge Integration Layer) и движком SiYuan — и раздать владение каждым контуром ровно один раз:

- что остаётся **Craft-owned** навсегда (с обоснованием и текущим местом жительства в репозитории);
- что **поглощается** из SiYuan и в какой форме;
- что из SiYuan **скрывается или не переносится** вовсе;
- как разделяются два типа метаданных, чтобы не вырасти в «магическую двустороннюю синхронизацию».

Документ — опорный для всего сьюта K: споры «чей это контур» разрешаются здесь, а не в прикладных спеках.

## 2. Контекст и мотивация

Форк `agisota/craft-agents-oss` — самостоятельная магистраль: 347 коммитов вперёд и 1 позади исходного Craft, собственные контуры `packages/cloud-runner` и `packages/messaging-discord-worker`. SiYuan — зрелый блочный движок знаний (kernel, блоки, backlinks, атрибуты, SQL, database views, редактор) на ядре, которое бессмысленно переписывать.

Архитектурный вердикт: **ничего из Craft в SiYuan не переносим; Craft остаётся главным приложением, продуктовым интерфейсом и исполнительным ядром; SiYuan поглощается как специализированный движок знаний** ([ADR-001](./01-adrs.md), [ADR-002](./01-adrs.md)). Craft — магистраль, SiYuan — присоединяемый орган.

Без явной карты владения интеграция неминуемо выродится в один из провальных сценариев: «интерфейс внутри интерфейса» (два shell), «двойная правда» (два источника labels/statuses), «неконтролируемая запись» (агент портит знания) или «общая Entity-БД» (слияние канонических моделей — запрещено [ADR-003](./01-adrs.md)). Этот документ пресекает все четыре на уровне границы.

## 3. Решение

### 3.1 Целевая системная граница

```
┌──────────────────────────────────────────────────────────────┐
│                  AGISOTA CRAFT — ПРОДУКТ                     │
│  App shell │ Sessions │ Labels │ Views │ Browser │ Settings │
│  Skills    │ Sources  │ Automations │ Cloud Runs │ Memory   │
│  (весь существующий код: apps/electron, packages/shared,     │
│   packages/server-core, packages/cloud-runner, …)            │
└────────────────────────────┬─────────────────────────────────┘
┌────────────────────────────▼─────────────────────────────────┐
│              KNOWLEDGE INTEGRATION LAYER (bridge)            │
│  KnowledgeProvider / Context snapshots / Cross-links /       │
│  Search adapter / Mutation proposals / Diff approval /       │
│  Rollback / Publication history                              │
│  (новые компоненты — packages/knowledge-core,                │
│   packages/knowledge-siyuan; контракт — K-03)                │
└────────────────────────────┬─────────────────────────────────┘
                             │ HTTP / process boundary
                             │ (SiYuan Kernel API, localhost:6806
                             │  в режиме external-local; см. K-07)
┌────────────────────────────▼─────────────────────────────────┐
│                   SIYUAN KNOWLEDGE ENGINE                    │
│  Notebooks │ Documents │ Blocks │ Backlinks │ Attributes    │
│  Database views │ SQL │ Search │ Assets │ Import / Export   │
│  Full block editor (встраивается как поверхность)            │
└──────────────────────────────────────────────────────────────┘
```

Распределение ответственности:

| Слой | Ответственность | Формулировка вердикта |
|---|---|---|
| Craft (продукт) | Работа, исполнение, взаимодействие, управление агентами; вся навигация верхнего уровня | «работа, исполнение, взаимодействие, управление агентами» |
| Knowledge Integration Layer | Безопасное движение контекста и результатов между слоями; единственное место, где живут refs, snapshots, proposals, publications | «безопасное движение контекста и результатов между ними» |
| SiYuan (движок) | Структурированное долговечное знание: хранение, индексы, backlinks, атрибуты, базы, редактор | «структурированное долговечное знание» |

Два железных следствия границы:

1. **Канонические базы не объединяются.** Единая поверхность отображения ≠ единая каноническая модель данных ([ADR-003](./01-adrs.md)). Bridge хранит только интеграционное состояние (слайды таблиц — [K-04 Хранилище bridge](./04-bridge-storage.md)).
2. **Вся запись в SiYuan идёт через proposal/diff/approval** — ни один кодовый путь Craft не вызывает `updateBlock`-эквивалент напрямую ([ADR-004](./01-adrs.md), детали в [K-05](./05-mutation-safety.md)).

### 3.2 Карта владения: контуры, которые остаются Craft-owned

Каждый контур ниже: (а) обоснование, почему владелец — Craft; (б) где живёт сегодня в `craft-agents` @ main; (в) что, если вообще, меняется при интеграции. Всё, чего нет в репозитории, помечено «новый компонент».

#### 3.2.1 Оболочка приложения: окно, навигация, настройки, локализация

**Обоснование.** SiYuan не определяет верхнеуровневую навигацию продукта: окно, lifecycle, workspaces, вкладки, горячие клавиши, темы, настройки, уведомления, обновления и восстановление UI-состояния — имущество хоста. Два shell в одном окне = «интерфейс внутри интерфейса», против чего направлена таблица скрытия (§3.4).

**Где живёт сегодня.**

| Подконтур | Путь в репозитории |
|---|---|
| Точка входа renderer, i18n bootstrap | `apps/electron/src/renderer/main.tsx`, `packages/shared/src/i18n/setupI18n.ts` (RU-first), `packages/shared/src/i18n/registry.ts`, `packages/shared/src/i18n/locales/*.json` (10 локалей) |
| Мега-shell и компоновка | `apps/electron/src/renderer/components/app-shell/AppShell.tsx` (~4007 LOC), `LeftSidebar.tsx`, `MainContentPanel.tsx`, `TopBar.tsx`, `PanelStackContainer.tsx`, `PanelSlot.tsx` |
| Стек панелей (центральный хост) | `apps/electron/src/renderer/atoms/panel-stack.ts` (`panelStackAtom`, `pushPanelAtom`, `closePanelAtom`) |
| Навигация и URL | `apps/electron/src/renderer/contexts/NavigationContext.tsx` (~1309 LOC), `apps/electron/src/shared/types.ts` (union `NavigationState`, 10 навигаторов), `apps/electron/src/shared/routes.ts`, `apps/electron/src/shared/route-parser.ts` (~1018 LOC) |
| Настройки | `apps/electron/src/shared/settings-registry.ts` (`SETTINGS_PAGES`, 15 подстраниц), `apps/electron/src/renderer/pages/settings/settings-pages.ts` |
| Команды и горячие клавиши | `apps/electron/src/renderer/actions/{definitions.ts,registry.tsx,keybinding-context.ts}`, `apps/electron/src/shared/menu-schema.ts` |
| Персистентность chrome | `apps/electron/src/renderer/lib/local-storage.ts` (реестр `KEYS`) |
| Фичефлаги | `packages/shared/src/feature-flags.ts` (`CRAFT_FEATURE_*`) |

**Что меняется.** Ровно одно расширение: новый навигатор Knowledge добавляется по существующему рецепту (элемент в `links[]` модели AppShell + `NavigationState` + route + рендер-ветка в `MainContentPanel`) — без второго shell. Детали слотовой модели — в сьюте S ([S-01](../2026-08-07-unified-shell/01-shell-slots.md)).

#### 3.2.2 Сессии и чаты — семантика Session ≠ Document

**Обоснование.** Craft — канонический владелец Session: messages, turns, tool calls, streaming, model/provider, permission mode, status, labels, flags, archive, unread, execution links, timestamps. История чатов в SiYuan **не переносится**: Session — это *процесс работы*, Document — *принятый результат работы*. Связь односторонняя и явная: `Session → linked knowledge blocks / generated artifacts / published document` (контур публикации — [K-06](./06-publication-pipeline.md)). Никогда не «Session == SiYuan Document» ([ADR-006](./01-adrs.md)).

**Где живёт сегодня.**

| Подконтур | Путь в репозитории |
|---|---|
| Модель сессии | `packages/shared/src/sessions/types.ts` — `SessionConfig` (persisted через `SESSION_PERSISTENT_FIELDS`: `isFlagged`, `isArchived/archivedAt`, `hidden`, `hasUnread`, `labels`, `sessionStatus`, `projectId`, `parentSessionId`, `kanbanColumn`, `branchFromSessionId`, …), `SessionMetadata`, `SessionHeader` (JSONL line 1) |
| Хранение | `packages/shared/src/sessions/storage.ts` — `sessions/{id}/session.jsonl` |
| RPC-мутации | `packages/server-core/src/handlers/rpc/sessions.ts` — flag/archive/rename/setSessionStatus/setLabels/markRead/share/import/export (canonical блок @301–390), контентный SEARCH (@434) |
| Авторитетные мутации | `packages/server-core/src/sessions/SessionManager.ts` |
| Публичный просмотр shared-сессий | `apps/viewer/` |

**Что меняется.** Ничего в модели сессии. Добавляются только *ссылки наружу*: `knowledge_links` в хранилище bridge (новый компонент, [K-04](./04-bridge-storage.md)) и метка «Published to: …» в метаданных публикации — физически в bridge, не в `session.jsonl`.

#### 3.2.3 Labels, статусы, группировки и сохранённые представления

**Обоснование.** Операционные метаданные (status, labels, flags, grouping, sorting, filtering, saved views, bulk actions) — механика *работы*, а не *знания*; их канонический владелец — Craft. Второй источник labels/statuses из SiYuan автоматически не синхронизируется (§3.4, §3.5). При этом UI-механика уже достаточно родовая, чтобы её выделить в переиспользуемый движок представлений — для Sessions, Knowledge и Runs по одному UI-языку, поверх **трёх независимых доменов хранения**.

**Где живёт сегодня.**

| Подконтур | Путь в репозитории |
|---|---|
| Labels (дерево, типы значений, фильтрация) | `packages/shared/src/labels/types.ts` (`LabelConfig`, `valueType: string\|number\|date\|link`), `packages/shared/src/labels/values.ts` (`::`-разделитель, вывод ISO-date/decimal), `packages/shared/src/labels/filter.ts` (`matchesLabelFilter` — единый предикат) |
| Statuses (config + CRUD + иконки) | `packages/shared/src/statuses/{types.ts,crud.ts,storage.ts,default-icons.ts}`, RPC `packages/server-core/src/handlers/rpc/statuses.ts` |
| Saved views engine (filtrex) | `packages/shared/src/views/evaluator.ts` (`compileView`/`evaluateViews`), `packages/shared/src/views/functions.ts` (`VIEW_FUNCTIONS`: `daysSince`, `contains`, …), `packages/shared/src/views/storage.ts` (`views.json` на workspace), `packages/shared/src/views/defaults.ts`, `packages/shared/src/views/validation.ts` |
| Цвета сущностей | `packages/shared/src/colors/` (`resolveEntityColor`, `getDefaultStatusColor`) |
| Фильтр-UI списка сессий | `apps/electron/src/renderer/components/app-shell/AppShell.tsx` (владелец `ViewFiltersMap`, @681–870; десктопный filter-builder @~2840–3500), `CompactSessionListFilter.tsx` |
| Список и строки (уже generic) | `apps/electron/src/renderer/components/app-shell/SessionList.tsx` (~983 LOC), `components/ui/entity-list.tsx` (`EntityList<T>`), `components/ui/entity-row.tsx`, `components/ui/entity-list-label-badge.tsx` |
| Выделение и интеракции (generic) | `apps/electron/src/renderer/hooks/useMultiSelect.ts`, `hooks/useEntityListInteractions.ts`; bulk — `components/app-shell/MultiSelectPanel.tsx`, `BatchSessionMenu.tsx` |
| Kanban | `apps/electron/src/renderer/components/app-shell/kanban/` (`KanbanBoard.tsx`, `BoardListToggle.tsx`) |
| Хуки данных | `apps/electron/src/renderer/hooks/{useViews.ts,useStatuses.ts,useLabels.ts,useProjects.ts}` |

**Что меняется.** Существующие session-specific куски (filter-builder из AppShell, grouping/sorting/saved views) выделяются в **Collection View Engine — новый компонент** (`packages/ui-collections/`: `projections.ts`, `filters.ts`, `grouping.ts`, `sorting.ts`, `saved-views.ts`, `labels.ts`, `statuses.ts`, `components/`), обслуживающий три проекции; детальный дизайн и миграция — [K-09](./09-collection-view-engine.md). Контракт проекции:

```typescript
interface ListProjection {
  key: string; title: string; subtitle?: string; icon?: string;
  labels: Array<{ id: string; title: string }>;
  status?: { id: string; title: string };
  updatedAt: number;
  open(): void;
}
class SessionListProjection implements ListProjection {}    // данные: Craft storage
class KnowledgeListProjection implements ListProjection {}  // данные: SiYuan attributes/search (через K-03)
class CloudRunListProjection implements ListProjection {}   // данные: Craft cloud-runner
```

БД не объединяются: движок — чисто UI-слой; `KnowledgeListProjection` ходит в SiYuan только через KnowledgeProvider.

#### 3.2.4 Встроенный браузер

**Обоснование.** Браузер — исполнительный контур агента (user/agent navigation, auth state, tabs, screenshots, extraction, automation) и самый зрелый образец «чужая веб-поверхность внутри Craft хоста». SiYuan-редактор будет встраиваться по этому же шаблону; переносить браузер куда-либо бессмысленно.

**Где живёт сегодня.**

| Подконтур | Путь в репозитории |
|---|---|
| Менеджер панелей | `apps/electron/src/main/browser-pane-manager.ts` (~4014 LOC): `createInstance`, `createEmbeddedInstance` (композит из 3 BrowserView: toolbar+page+overlay, partition `persist:browser-pane`), `createForSession`/`destroyForSession`, `setAgentControl`, CDP screenshot/console/network/downloads |
| CDP-обёртка | `apps/electron/src/main/browser-cdp.ts` |
| RPC/IPС | `apps/electron/src/main/handlers/browser.ts` (`browserPane.*`), `apps/electron/src/preload/bootstrap.ts` (~24 invoke + `__browser:invoke`), `apps/electron/src/shared/types.ts` (~L873: `ElectronAPI.browserPane`) |
| Хост-страница (шаблон встраивания) | `apps/electron/src/renderer/pages/BrowserPanelPage.tsx`: rect-reporter div, `ResizeObserver` + rAF `syncBounds(instanceId, rect\|null)`, unmount → destroy |
| Renderer-зеркало | `apps/electron/src/renderer/atoms/browser-pane.ts` |

**Что меняется.** Механизм поверхностей обобщается до **WorkspaceSurfaceHost — нового компонента** (`open/close/focus/split/restore/serializeLayout/manageBounds`) с дескриптором:

```typescript
type SurfaceDescriptor =
  | { kind: "chat"; sessionId: string }
  | { kind: "browser"; tabId: string }
  | { kind: "knowledge"; ref: KnowledgeRef }
  | { kind: "cloud-run"; runId: string }
  | { kind: "diff"; proposalId: string };
```

`BrowserPanelPage` — эталон реализации для `KnowledgeSurface` (события выбранного блока/документа идут в Craft inspector и agent actions). Реестр поверхностей и вкладки — [S-02](../2026-08-07-unified-shell/02-surface-registry-tabs.md).

#### 3.2.5 Skills

**Обоснование.** Skills — исполнительные пакеты Craft (instructions, files, references, tools, permissions, triggers, output contract) с 4-уровневым разрешением (project `.agents/skills` > workspace `skills/` > global `~/.agents/skills` > OMP-discovery) и готовым жизненным циклом: mention → `[skill:slug]` → resolve пути → принудительное прочтение → auto-enable `requiredSources`. SiYuan здесь не владелец, а *поставщик capabilities*.

**Где живёт сегодня:** `packages/shared/src/skills/types.ts` (`SkillMetadata{name,description,globs?,alwaysAllow?,icon?,requiredSources?}`), `packages/shared/src/skills/storage.ts` (`loadAllSkills`, merge global<workspace<project), `packages/shared/src/skills/omp-discovery.ts`, `packages/shared/src/skills/bundled.ts`, RPC `packages/server-core/src/handlers/rpc/skills.ts` (+ usage-ledger `packages/server-core/src/memory/skill-usage.ts`), разрешение путей `packages/shared/src/agent/base-agent.ts` (`extractSkillPaths` ~L919) + `PrerequisiteManager`, auto-enable источников `packages/server-core/src/sessions/SessionManager.ts` (~L6424–6445), marketplace `packages/shared/src/marketplace/catalog.ts`.

**Что меняется.** SiYuan добавляет skill-capabilities `knowledge.search / knowledge.read / knowledge.get_backlinks / knowledge.create_document / knowledge.propose_update / knowledge.publish / knowledge.set_attribute` — новые инструменты, описанные в [K-10](./10-skills-automations.md). Их gating едет по существующему слоистому движку разрешений (§3.2.7 sources + `permissions.json`), а skill-контракт `SkillMetadata` меняется только добавочно. Пример целевого skill:

```yaml
name: research-and-publish
input:
  knowledge_ref: siyuan://blocks/…
capabilities: [web.search, browser.navigate, knowledge.read, knowledge.propose_update]
output: { type: siyuan_document, destination: /Research/Reports }
```

#### 3.2.6 Sources, MCP и credentials

**Обоснование.** Подключения к внешним системам (mcp|api|local), их credentials и OAuth-жизненный цикл уже Craft-owned; SiYuan kernel — просто ещё одно внешнее подключение, ничем не особенное на этом уровне.

**Где живёт сегодня:** `packages/shared/src/sources/types.ts` (`SourceType: mcp|api|local`, `McpSourceConfig`, `ApiSourceConfig`, `LocalSourceConfig`), `packages/shared/src/sources/server-builder.ts` (`SourceServerBuilder`), RPC `packages/server-core/src/handlers/rpc/sources.ts` — включая прецедент `ensureNotesSource()`: встроенный managed-источник, по образу которого SiYuan получает собственное подключение; credentials `packages/shared/src/credentials/{types.ts,manager.ts}` (AES-256-GCM, ключ `{type}::{scope}`), OAuth `packages/server-core/src/handlers/rpc/oauth.ts`, `TokenRefreshManager` в `packages/shared/src/sources/index.ts`.

**Что меняется.** Регистрация SiYuan-подключения (режимы — [K-07](./07-connection-modes.md)) и namespace `knowledge.*` в `packages/shared/src/protocol/channels.ts` (+ классификация в `routing.ts`, по модели `memory-io`/`skills`/`cloudRuns`) — добавочно. MCP **не является** основой интеграции: KnowledgeProvider — системная поверхность; MCP — только агентная грань над ней ([K-03](./03-knowledge-provider-contract.md)).

#### 3.2.7 Automations

**Обоснование.** Расписания, триггеры, история запусков и их UI — механика исполнения Craft. SiYuan выступает источником *событий* и адресатом *действий*, но движок автоматизаций не дублируется.

**Где живёт сегодня:** RPC `packages/server-core/src/handlers/rpc/automations.ts`; навигация и страницы — автоматизации как навигатор AppShell (`AutomationInfoPage` в `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx`, маршруты в `apps/electron/src/shared/routes.ts`); запуск ранов — через cloud-runs контур (§3.2.8).

**Что меняется.** Новые триггеры (`knowledge.document.created/updated`, `knowledge.attribute.changed`, `knowledge.database.row.changed`, `knowledge.document.stale`) и действия (`knowledge.create_document`, `knowledge.append_block`, `knowledge.propose_patch`, `knowledge.set_attribute`, `knowledge.link_session`, `knowledge.publish_run`) — все write-действия неизбежно проходят контур записи [K-05](./05-mutation-safety.md). Детализация — [K-10](./10-skills-automations.md). Эталонный сценарий:

```
WHEN  SiYuan attribute status = "needs-research"
THEN  create cloud run (skill = deep-research)
ON SUCCESS  create SiYuan report document → link to row → set status = "review"
```

#### 3.2.8 Агентный и исполнительный runtime (включая cloud-runner)

**Обоснование.** Модели/провайдеры, подключения, OAuth/API-конфиги, адаптеры агентов, инструменты, разрешения, локальный и удалённый серверы, cloud runs, resume/retry/cancel/streaming, публичные ссылки, мессенджерные шлюзы, sandbox — это «исполнительное ядро» из вердикта. **cloud-runner особенно не выносится наружу**: это собственный контур форка с conformance-suite и двумя живыми облачными шлюзами.

**Где живёт сегодня.**

| Подконтур | Путь в репозитории |
|---|---|
| Identity = LLM-подключения | `packages/shared/src/config/llm-connections.ts` (`LlmConnection`, sessions lock to connection) |
| Разрешения | `packages/shared/src/agent/permissions-config.ts`, `packages/shared/src/agent/mode-types.ts` (`PermissionsConfigSchema`: `blockedTools`, `allowedBashPatterns`, `allowedWritePaths`, …; layered default < workspace < per-source) |
| Агентные мосты | `packages/pi-agent-server`, `packages/session-mcp-server`, `packages/session-tools-core` |
| Headless server / клиенты | `packages/server`, `apps/cli`, `apps/webui` |
| Cloud Runs runner | `packages/cloud-runner` (`src/types.ts`: `CloudRunProvider`, `RunSpec`, `RunLimits` 30min/2M tokens/25MB, `assertSafeArtifactPath`; conformance suite в `src/index.ts`) |
| Cloud Runs RPC и шлюзы | `packages/server-core/src/handlers/rpc/cloud-runs.ts`, `apps/cloud-gateway` (CF Worker + RunDO + контейнер), `apps/modal-gateway` (FastAPI) |
| Мессенджеры | `packages/messaging-gateway`, `packages/messaging-whatsapp-worker`, `packages/messaging-discord-worker` |

**Что меняется.** Ничего структурно: cloud runs становятся ещё и *исполнительной ногой* knowledge-автоматизаций (§3.2.7) и RunProjection (§3.2.3). AI chat и настройки моделей самого SiYuan при этом выключены (§3.4): модели принадлежат Craft.

#### 3.2.9 Память Craft: Craft Memory ≠ SiYuan Knowledge

**Обоснование.** Два разных вида «памяти», и их слияние — классическая ошибка: Craft Memory — рабочая, эпизодическая (предпочтения, история выполнений, checkpoints, инсайты сессий); SiYuan Knowledge — долговечные принятые материалы (документы, справочники, базы сущностей). Поток строго односторонний и рецензируемый:

```
Session/Run → Craft memory → distillation (skill) → review → SiYuan knowledge
```

Никакого «автовываливания» каждого наблюдения в базу знаний — публикация инициируется пользователем или явной автоматизацией ([K-06](./06-publication-pipeline.md), [K-10](./10-skills-automations.md)).

**Где живёт сегодня:** `packages/shared/src/memory/types.ts`, RPC-контур памяти `packages/server-core/src/handlers/rpc/memory.ts`, `memory-io.ts`, `memory-insights.ts` (плюс `skill-usage.ts` как ledger использования скиллов).

**Что меняется.** Ничего в самой памяти; добавляется одна точка выхода — distill/publish в bridge.

### 3.3 Что поглощаем из SiYuan

**3.3.1 Knowledge kernel (ядро).** Notebook tree, document tree, стабильные block IDs, иерархия блоков, block references, backlinks, индексы и поиск, атрибуты, SQL, database views, assets, import/export. Craft **не пишет** своё блочное хранилище и свой граф обратных ссылок — весь available-запас знаний читается и адресуется через KnowledgeProvider ([K-03](./03-knowledge-provider-contract.md)).

**3.3.2 Полноценный блочный редактор — как поверхность.** Редактор SiYuan **не переписывается**; он встраивается как управляемая `KnowledgeSurface` (новый компонент: `knowledge-surface-manager` в main-процессе + `KnowledgeSurface.tsx` в renderer) по шаблону хоста `BrowserPanelPage` (§3.2.4):

```
Craft navigation → KnowledgeSurfaceManager → SiYuan editor surface
                 → selected block/document events → Craft inspector / agent actions
```

Центр окна может принадлежать SiYuan; всё вокруг (слоты, панели, инспектор) остаётся Craft ([S-01](../2026-08-07-unified-shell/01-shell-slots.md)).

**3.3.3 Базы знаний и свойства.** SiYuan database/attribute views — канонический слой предметных сущностей (Books / Companies / People / Projects / Research questions / Sources / Reports). Craft добавляет рабочие действия поверх строк: Run skill / Create session / Research selected rows / Summarize / Verify / Publish / Schedule refresh — это KnowledgeProjection (§3.2.3) и actions [K-10](./10-skills-automations.md), а не новый storage.

**3.3.4 Синхронизация и мобильные клиенты — опционально.** Экосистема SiYuan (мобильное чтение/редактирование, hosted sync, экспорт) подключается как опция поверх тех же данных; на первом этапе мобильный SiYuan показывает только *опубликованные* знания — этого достаточно. Решение о включении отложено в roadmap ([K-11](./11-roadmap.md), P7-зона) и зависит от лицензии ([K-08](./08-licensing.md)).

### 3.4 Что из SiYuan не переносим и скрываем

Каждая строка — с решением и причиной; «хозяин взамен» указывает Craft-контур из §3.2.

| Компонент SiYuan | Решение | Причина / хозяин взамен |
|---|---|---|
| Верхнеуровневая оболочка приложения | **Скрыть** | Хозяин — Craft app shell (§3.2.1); два shell = интерфейс в интерфейсе |
| Основная боковая навигация | **Заменить** Craft-навигацией | Иначе — двойная навигация; Knowledge-секция встраивается в `LeftSidebar`/`NavigationState` (§3.2.1) |
| Переключение workspace | **Контролирует Craft** | Workspace — единица Craft (`workspace.ts` handlers, per-workspace restore в `NavigationContext`) |
| AI chat SiYuan | **Не использовать** | Дублирует Craft agent runtime (§3.2.8) |
| Настройка моделей | **Не использовать** | Модели принадлежат Craft: `llm-connections.ts` (§3.2.8) |
| Автоматизации через плагины | **Не основной механизм** | Автоматизации — Craft-owned (§3.2.7); SiYuan даёт события и действия, не движок |
| Глобальная палитра команд | **Скрыть или проксировать** | Командная механика уже есть: `actions/` registry + menu-schema (§3.2.1) |
| Второй механизм разрешений | **Адаптировать, не показывать отдельно** | Разрешения живут в layered `permissions.json` (`PermissionsConfigSchema`); SiYuan-ограничения выражаются через `knowledge.*` capabilities |
| Второй источник labels/statuses | **Не синхронизировать автоматически** | Единственное пересечение — явные automation-правила (§3.5, [ADR-005](./01-adrs.md)) |
| Отдельная система аккаунтов | **Не показывать в managed-режиме** | Пользовательских account-абстракций в Craft нет; identity — connections/credentials (§3.2.6) |
| Полный marketplace в основном UI | **Отложить** | Свой marketplace уже есть: `packages/shared/src/marketplace/catalog.ts`, Extension Center — сьют S |
| AI/provider settings | **Выключить** | Дубль пути конфигурации провайдеров Craft (§3.2.8); оставляем один источник правды о моделях |

Диагностические и административные операции ядра (миграции workspace, восстановление) в продукт не встраиваются: они выполняются нативными средствами SiYuan, а Craft показывает только контур здоровья подключения ([K-07](./07-connection-modes.md)); это вопрос эксплуатации, а не строка скрытия UI.

### 3.5 Два типа метаданных: операционные против семантических

| | Craft — операционные (WORK) | SiYuan — семантические (KNOWLEDGE) |
|---|---|---|
| Вопрос | «Что сейчас происходит с работой?» | «Что это за знание?» |
| Неймспейс | `work.*`: `status`, `labels`, `priority`, `flagged`, `assignee`, `queue`, `review_state` | `knowledge.*`: `tags`, `type`, `author`, `topic`, `valid_from`, `source`, `rating` |
| Каноническое хранилище | Craft storage (`SessionConfig`, labels/statuses/view engine — §3.2.2/§3.2.3) | SiYuan attributes (§3.3.3) |
| Механика | Оптимистичные мутации через sessions RPC (`SessionManager`) | Только proposal/diff/apply через bridge ([K-05](./05-mutation-safety.md)) |

Правила сосуществования:

1. **Отображаться могут вместе** — в одном инспекторе, секциями WORK / KNOWLEDGE (новый `KnowledgeInspector` — [S-03](../2026-08-07-unified-shell/03-panels-rails.md)).
2. **Физически разные.** Никакой магической двусторонней синхронизации — ни поле-в-поле, ни channel-level replays ([ADR-005](./01-adrs.md)).
3. **Единственное пересечение — явные automation-правила**, написанные пользователем как код триггер/действие:

```
WHEN  Craft label = "Publish"
THEN  knowledge.set_attribute { workflow: "ready-to-publish" }   (через proposal → approval)
```

Такое правило наблюдаемо (история запусков автоматизаций), откатываемо (inverse patch в bridge, [K-05](./05-mutation-safety.md)) и никогда не скрыто от пользователя.

## 4. Границы / что НЕ делаем

- **Ничего из Craft не переносим в SiYuan**: ни shell, ни сессии, ни браузер, ни runtime ([ADR-001](./01-adrs.md)).
- **Не строим общую универсальную Entity-БД** поверх сессий/документов/ранов; единый UI-язык списков ≠ единая модель данных ([ADR-003](./01-adrs.md), движок — [K-09](./09-collection-view-engine.md)).
- **Не делаем полную двустороннюю синхронизацию метаданных** Craft↔SiYuan ([ADR-005](./01-adrs.md)); только явные automation-правила (§3.5).
- **Не превращаем Session в SiYuan Document** и не переносим историю чатов в знания ([ADR-006](./01-adrs.md)); связь — только через публикацию ([K-06](./06-publication-pipeline.md)).
- **Не даём агенту прямой записи в SiYuan** (никакого `updateBlock` из модели): всё через proposal → diff → approval → hash-check → apply → audit ([ADR-004](./01-adrs.md), [K-05](./05-mutation-safety.md)).
- **Не переписываем редактор SiYuan** — только встраиваемая поверхность (§3.3.2).
- **Не копируем код SiYuan внутрь Craft monorepo** до разрешения лицензионного контура Apache-2.0 × AGPLv3 ([K-08](./08-licensing.md)); работаем через публичный API и встраиваемую поверхность.
- **Не делаем физический merge двух кодовых баз** на этом горизонте ([ADR-001](./01-adrs.md)).
- **Не смешиваем домены в одной произвольной коллекции** в первой версии view engine (session+document+run+skill в одном списке — позже, Workbench View; граница — [K-09](./09-collection-view-engine.md)).
- **Не выносим cloud-runner, skills, automations, memory, messaging** в SiYuan-контур ни в каком виде (§3.2).

## 5. Критерии приёмки

- [ ] Диаграмма §3.1 показывает три слоя и помеченную границу `HTTP / process boundary`; ответственность каждого слоя сформулирована.
- [ ] Каждый Craft-owned контур в §3.2 имеет: обоснование владения + минимум один существующий путь в `craft-agents` @ main (проверено по scout-отчётам); всё несуществующее помечено «новый компонент».
- [ ] Семантика Session ≠ Document зафиксирована со ссылкой на ADR-006, а механика labels/statuses/views — с указанием `packages/shared/src/{labels,statuses,views}/` и маршрутом к K-09.
- [ ] Поглощаемое из SiYuan (§3.3) покрывает ровно четыре пункта вердикта §4: kernel, редактор-как-поверхность, databases, опциональные sync/mobile.
- [ ] Таблица §3.4 покрывает все пункты вердикта §5, у каждого — решение (скрыть/заменить/не использовать/выключить/отложить/адаптировать) и причина с Craft-хозяином.
- [ ] §3.5 фиксирует два типа метаданных, запрет магической двусторонней синхронизации (ADR-005) и явные automation-правила как единственное пересечение (с примером).
- [ ] Каждый пункт «Что НЕ делаем» ссылается на соответствующий ADR в [K-01](./01-adrs.md) или прикладную спеку сьюта.
- [ ] Все внутренние ссылки — относительные пути внутри `docs/specs/2026-08-07-*/`; cross-suite ссылки указывают на существующий каталог `../2026-08-07-unified-shell/`.

## 6. Открытые вопросы

1. **Shape подключения SiYuan как Source.** SiYuan — это новое значение `SourceType` (`'knowledge'`) или переиспользование `api` (kernel REST на :6806) со специальным avatar/menu? Затрагивает `sources/types.ts`, `server-builder.ts`, UI. Решение фиксируется в [K-03](./03-knowledge-provider-contract.md) / [K-07](./07-connection-modes.md).
2. **Граница выделения Collection View Engine.** Какие части filter-builder'а AppShell (@681–870, @2840–3500) уезжают в `packages/ui-collections/`, а что остаётся session-specific (поиск по контенту, session-family grouping)? Объём миграции — предмет [K-09](./09-collection-view-engine.md).
3. **Credentials под managed-режим.** Для `external-local`/`remote` токен SiYuan ложится в существующий `CredentialManager` (`source_bearer::{ws}::siyuan`); нужен ли новый `CredentialType` для managed kernel — открыто, зависит от P7 ([K-11](./11-roadmap.md)).
4. **SiYuan Cloud identity.** В Craft нет глобальной account-абстракции; если включение sync/mobile (§3.3.4) потребует аккаунта SiYuan Cloud, дом для неё выбирается между connection-моделью §3.2.6 и Identity Center сьюта S ([S-07](../2026-08-07-unified-shell/07-identity-center.md)).
5. **Admin-поверхность SiYuan.** Какие операции ядра (миграции workspace, восстановление) остаются доступными пользователю нативно, а какие получают Craft-обёртку диагностики — уточняется в [K-07](./07-connection-modes.md).
