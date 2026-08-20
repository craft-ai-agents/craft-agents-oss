# K-09. Collection View Engine: выделение переиспользуемого движка представлений

- **Документ**: K-09 · suite K «Интеграция SiYuan в Craft» · `docs/specs/2026-08-07-siyuan-integration/`
- **Статус**: draft
- **Дата**: 2026-08-07
- **Входные документы**: «Вердикт» (исходный документ архитектурного решения, §§2.3, 3.1, 7 — `local://att1-siyuan-verdict.md`); scout-отчёт SessionsViews (`local://scout-SessionsViews.md`, кодовая база `craft-agents @ 961c1f450`)
- **Связанные документы**: [00-overview.md](./00-overview.md); [01-adrs.md](./01-adrs.md) (ADR-003, ADR-005); [03-knowledge-provider-contract.md](./03-knowledge-provider-contract.md); [11-roadmap.md](./11-roadmap.md) (фаза P5); suite S «Единая оболочка» — [03-panels-rails.md](../2026-08-07-unified-shell/03-panels-rails.md), [04-omnibox.md](../2026-08-07-unified-shell/04-omnibox.md)

---

## 1. Цель

Выделить из session-specific компонентов списка сессий **переиспользуемый движок коллекционных представлений** (Collection View Engine), который одинаково обслуживает Sessions, Knowledge, Cloud Runs, Automations и Sources, — без объединения канонических хранилищ этих доменов.

Документ фиксирует:

1. Точную карту того, что в текущем списке сессий **уже generic**, что **generic по ядру, но подсвечено сессиями**, а что **жёстко завязано на сессии** (с реальными путями и символами кодовой базы).
2. Атомарный план выделения (шаги E1–E8): какие файлы переносятся в `packages/ui-collections`, какие адаптеры остаются в доменах.
3. Интерфейс `ListProjection` и три его реализации-адаптера (`SessionListProjection`, `KnowledgeListProjection`, `CloudRunListProjection`).
4. Формат сохранённых представлений знаний (Saved Knowledge Views) как расширение существующего `ViewConfig` на домен `knowledge` с движком выражений filtrex.

Отвечает фазе P5 и пунктам §2.3/§3.1/§7 «Вердикта». UI-слоты, в которых движок будет смонтирован (панели, рельсы, табы), специфицирует suite S; здесь — только движок и его контракты.

## 2. Контекст и мотивация

### 2.1 Список сессий — самый зрелый список приложения

Список сессий уже пережил **один цикл выделения**: визуальная оболочка (`EntityList`/`EntityRow`), выбор (`useMultiSelect`) и композиция взаимодействий (`useEntityListInteractions`) — generic и повторно используются панелями Sources и Skills. Второй полу-generic слой живёт в `packages/shared`: labels (дерево + значения + фильтр), statuses (конфиг + CRUD) и views (движок выражений filtrex, хранение `views.json`). Источник данных: `SessionManager` → RPC `sessions.ts` → renderer-атом `sessionMetaMapAtom` → `SessionList.tsx` → `useSessionSearch.ts` → `EntityList` groups → `SessionItem` на `EntityRow`.

### 2.2 Почему текущего состояния недостаточно

- **Фильтр-билдер не выделен.** Основная реализация — ~700 строк инлайн в `apps/electron/src/renderer/components/app-shell/AppShell.tsx` (~строки 2840–3500), плюс параллельная компактная `CompactSessionListFilter.tsx` (497 строк). Обе жёстко привязаны к понятиям сессий (statuses/labels/projects).
- **Сортировка захардкожена**: `lastActivity (lastMessageAt) DESC` везде, включая представителей семей и плитки board. Пользовательского контроля поля/направления сортировки нет — это самый большой пробел для движка представлений.
- **Группировка — закрытый union**: `ChatGroupingMode = 'date' | 'status' | 'unread' | 'project'` (`SessionList.tsx:70`) с четырьмя рукописными ветками бакетирования в `rowData` (~строки 300–620). Сгруппировать по произвольному полю (label, model, permissionMode, notebook, workflow_status) нельзя.
- **Сохранённые представления неполные**: `views.json` — это только выражения-фильтры; состояние «фильтр-карты + режим группировки + сортировка + раскладка групп» живёт безымянно в `localStorage` (`view-filters`, `collapsed-session-groups` с суффиксом `ws=…|filter=…|group=…`, `apps/electron/src/renderer/utils/session-list-collapse.ts`).
- **Новые домены стучатся в дверь**: Knowledge (документы/базы/блоки SiYuan), Cloud Runs (`cloudRuns.LIST/GET_STATUS` поверх `state.json` + `events.jsonl`), Automations. Без движка каждый получит третью и четвёртую копию фильтр-билдера — противоречие ADR-001 («Craft — единственная продуктовая оболочка») по духу и запрету второго источника labels/statuses по букве (см. [02-integration-boundaries.md](./02-integration-boundaries.md)).

### 2.3 Ключевое ограничение архитектуры

> **«Единая поверхность отображения ≠ единая каноническая модель данных.»** («Вердикт» §2.3)

Движок представлений — это UI- и query-контракт. Данные остаются там, где лежат: сессии — в `workspaces/<id>/sessions/*/session.jsonl`, знания — в SiYuan, ранны — в директориях cloud-runner. ADR-003 («No shared database») и ADR-005 («операционные и семантические метаданные раздельны») обязательны: движок строит проекции, а не общую entity-БД (анти-цель §15 «Вердикта»).

## 3. Решение

### 3.1 Карта существующего кода: что уже generic, что переносится, что остаётся

Все пути относительны корня монорепо `craft-agents`; префиксы: `SH` = `packages/shared/src/`, `R` = `apps/electron/src/renderer/`.

| Слой | Компонент / символ | Путь | Статус сегодня | Судьба в движке |
|---|---|---|---|---|
| Визуал | `EntityList`, `EntityListGroup` (generic grouped/collapsible list, header/footer slots) | `R/components/ui/entity-list.tsx` | generic as-is (потребители: SessionList, SourcesListPanel, SkillsListPanel) | перенос в `ui-collections/components/` без изменения API |
| Визуал | `EntityRow` (скелет строки: icon/title/badges/trailing/hover-menu/selection) | `R/components/ui/entity-row.tsx` | generic as-is (используется SessionItem/SourceItem/SkillItem) | перенос; строки доменов остаются адаптерами поверх |
| Визуал | `entity-list-empty.tsx`, `entity-list-badge.tsx`, `entity-list-label-badge.tsx`, `entity-icon.tsx`, `entity-panel.tsx` | `R/components/ui/` | generic as-is | перенос |
| Выбор | `useMultiSelect` (pure state machine, anchor+range) | `R/hooks/useMultiSelect.ts` | generic as-is | перенос в `ui-collections` (framework-free ядро) |
| Выбор | `useEntityListInteractions` (roving-tabindex + multiselect + search-filter + pluggable selectionStore) | `R/hooks/useEntityListInteractions.ts` | generic as-is | перенос |
| Выбор | `useEntitySelection` | `R/hooks/useEntitySelection.ts` | generic as-is | перенос |
| Меню | `SessionMenuParts.tsx` (render-only наборы пунктов share/status/labels; общий `useSessionMenuActions` для desktop Dropdown и compact Drawer), `menu-context.tsx` (полиморфизм DropdownMenu/ContextMenu) | `R/components/…` | render-only generic, действия привязаны к сессиям | отделить render-каркас (перенос) от action-дескрипторов (остаются в домене) |
| Меню | `MultiSelectPanel.tsx` (панель bulk-действий) | `R/components/…` | generic по chrome, действия — из `useAppShellContext` (BatchSessionMenu) | перенос каркаса; bulk-действия — через дескриптор проекции (§3.4) |
| Labels | `packages/shared/src/labels/*`: `types.ts` (LabelConfig-дерево, valueType string/number/date/link, autoRules), `values.ts` (`parseLabelEntry`/`extractLabelId`), `filter.ts` (`matchesLabelFilter` — единый предикат, descendant-aware, `__all__`, projectId-gate; минимальная структурная форма `LabelFilterableSession`) | `SH/labels/` | ядро generic; путь хранения `labels/config.json` — сессионно-окрашен | перенос модуля в `ui-collections/labels.ts`; предикат становится `matchesLabelFilter(entity: { labels?: string[]; projectId?: string }, …)` |
| Statuses | `packages/shared/src/statuses/*` (config + CRUD) | `SH/statuses/` | логика generic; категории open/closed — inbox-семантика сессий | перенос в `ui-collections/statuses.ts`; категории сделать частью конфигурации домена, а не встроенной константой |
| Views | `packages/shared/src/views/*`: `types.ts` (`ViewConfig`, `ViewEvaluationContext`, `CompiledView`), `evaluator.ts` (`compileAllViews` @50, `evaluateViews` @72, `buildViewContext` @100), `functions.ts` (`VIEW_FUNCTIONS`), `validation.ts`, `defaults.ts` (`getDefaultViews`), `storage.ts` (`VIEWS_FILE = 'views.json'` в корне workspace, `loadViewsConfig`, `migrateFromSmartLabels`) | `SH/views/` | движок выражений generic (filtrex: `compileExpression` + `useDotAccessOperatorAndOptionalChaining`); **но** `ViewEvaluationContext` session-shaped | перенос в `ui-collections/saved-views.ts`; контекст вычисления заменить на схемный `EntityViewContext` (§3.3, E4) |
| Поиск | `packages/shared/src/search/fuzzy.ts` (`fuzzyScore`) | `SH/search/` | generic | перенос |
| UI-state | `lib/local-storage.ts` (KEYS registry: `listFilter`, `labelFilter`, `viewFilters`, `chatGroupingMode`, `collapsedSessionGroups`), `utils/session-list-collapse.ts` (scope-суффикс) | `R/lib/`, `R/utils/` | рецепт персистентности, не модуль | паттерн обобщается в `ui-collections/saved-views.ts` (именованные `SavedListView`); session-ключи остаются для миграции |
| Фильтр-пайплайн | `useSessionSearch.ts` (`getSessionStatus` + `matchesLabelFilter` + content search + collapse-aware pagination) | `R/hooks/useSessionSearch.ts` (581 строка) | session-coupled | заменяется generic `useCollectionQuery(items, schema, viewDef)` (E4); контент-поиск остаётся доменным провайдером запроса |
| Группировка | 4 ветки бакетирования в `SessionList.tsx` (~300–620), `utils/session-families.ts` (семейные группы до внешнего бакетирования) | `R/components/session-list/SessionList.tsx`, `R/utils/session-families.ts` | session-coupled | бакетирование заменяется pluggable `GroupingRule[]` (E4); семейства сессий остаются доменным pre-grouper'ом (адаптер) |
| Фильтр-билдер UI | инлайн в `AppShell.tsx` (~2840–3500) + `CompactSessionListFilter.tsx` (497 строк) | `R/components/app-shell/` | session-coupled, дублирован desktop/compact | переписывается как декларативный `FilterBuilder` по `FilterSchema`, два скина (desktop/compact) поверх одной реализации (E3) |
| Board | `components/app-shell/kanban/KanbanBoard.tsx`, `KanbanBoardContainer.tsx`, `atoms/kanban.ts` | `R/components/app-shell/kanban/` | отдельный пайплайн (view-models), не лежит поверх query-движка | **v1 не соединяем**; board остаётся доменной раскладкой (см. «Границы») |
| Меню фильтров | `label-menu-utils.ts` + `label-menu.tsx` (`filterItems`, `segmentScore`, `createLabelMenuItems`), `StatusMenuItems`/`LabelMenuItems` (render-only props), `sortable-list.tsx` (DnD), `EditPopover` EDIT_CONFIGS (`edit-statuses`\|`edit-labels`\|`edit-views`) | `R/components/ui/`, `R/components/…` | generic по пропсам, session-окрашены данные | перенос рендер-каркасов; регистрация `edit-knowledge-views` в EDIT_CONFIGS — отдельным шагом (E5) |

Итоговая пропорция подтверждает границу «Вердикта» §2.3: **рендер-каркас и движок выражений уже generic**, а связка «схема фильтров → бакетирование → сортировка → именованное сохранённое состояние» — session-specific и должна быть переписана декларативно.

### 3.2 Целевой модуль: `packages/ui-collections`

По «Вердикту» §3.1 — новый workspace-пакет. Внутренняя раскладка (имена файлов — по §3.1 «Вердикта»):

```
packages/ui-collections/
├── src/
│   ├── projections.ts      — ListProjection, ProjectionRegistry, доменные дескрипторы
│   ├── filters.ts          — FilterSchema (декларативные оси фильтрации), компиляция в предикаты/query
│   ├── grouping.ts         — GroupingRule, PluggableGroupers, встроенные правила (field/date/status)
│   ├── sorting.ts          — SortRule { field, direction }, компараторы, правила tie-break
│   ├── saved-views.ts      — SavedListView, ViewsStorage (views.json v2), доменизированный ViewConfig
│   ├── labels.ts           — перенос SH/labels (types/values/filter) с общей структурной формой
│   ├── statuses.ts         — перенос SH/statuses с конфигурируемыми категориями
│   ├── search.ts           — перенос SH/search/fuzzy
│   ├── interactions.ts     — useMultiSelect, useEntityListInteractions, useEntitySelection (framework-free)
│   └── query.ts            — useCollectionQuery (filter+group+sort+paginate+collapse pipeline)
└── components/             — React-слой (потребляется apps/electron как workspace-зависимость)
    ├── EntityList.tsx / EntityRow.tsx / EntityListEmpty.tsx / EntityBadges.tsx
    ├── FilterBuilder.tsx (+ CompactFilterBuilder — единый код, два скина)
    ├── CollectionMenuParts.tsx (render-only), MenuContext.tsx, MultiSelectPanel.tsx
    └── LabelMenu.tsx, StatusMenu.tsx, SortableList.tsx
```

Произвольный домен подключается через **доменную схему**:

```typescript
/** Декларативное описание домена для движка. «Новый компонент» (этой схемы в репо нет). */
interface CollectionDomainSchema<TItem> {
  domain: 'sessions' | 'knowledge' | 'cloud-runs' | 'automations' | 'sources';
  /** Оси фильтрации — то, что сегодня захардкожено как statuses/labels/projects. */
  filterAxes: FilterAxis[];           // { id, title, valueKind: 'enum'|'label-tree'|'project'|'string'|'date', options() }
  /** Поля, доступные выражениям filtrex (схема контекста вычисления). */
  viewContextFields: ContextField[];  // заменяет session-shaped ViewEvaluationContext
  /** Допустимые правила группировки. */
  groupings: GroupingRule[];          // { id, title, keyOf(item), order?: string[] }
  /** Поля сортировки с компараторами. */
  sortFields: SortField[];            // { id, title, compare(a,b) }
  /** Провайдер строк: in-memory (сессии) или удалённый (knowledge). */
  queryProvider: 'local' | 'remote';
}
```

Для remote-домена (knowledge) движок **не фильтрует в памяти**: `FilterSchema` компилируется в `SearchInput` провайдера знаний (см. [03-knowledge-provider-contract.md](./03-knowledge-provider-contract.md)) и исполняется стороной SiYuan; локально применяются лишь пост-фильтры, недостижимые выражением поиска (точность filtrex выше точности SQL-подобного запроса SiYuan, поэтому компиляция обязана быть консервативной — непонятная аксис уходит в пост-фильтр).

### 3.3 План выделения: атомарные шаги E1–E8

Каждый шаг — самостоятельно зелёный коммит: приложение собирается и ведёт себя идентично на каждой границе. Порядок обязателен (зависимости сверху вниз).

**E1. Скелет пакета + перенос pure-модулей.**
Файлы: создать `packages/ui-collections/` (`package.json`, `src/index.ts`); переместить `packages/shared/src/labels/*` → `ui-collections/src/labels.ts(+)`, `packages/shared/src/statuses/*` → `statuses.ts(+)`, `packages/shared/src/search/fuzzy.ts` → `search.ts`, hooks `useMultiSelect.ts`/`useEntityListInteractions.ts`/`useEntitySelection.ts` → `interactions.ts(+)`.
Затронутые импорты: все потребители labels/statuses (AppShell, SessionList, label-menu, statuses RPC-адаптеры) переводятся на `ui-collections` в этом же коммите — shim re-export **не оставляем** (clean cutover).
Приёмка: `matchesLabelFilter`, `parseLabelEntry`, `getDefaultStatusConfig` импортируются из `ui-collections`; существующие тесты labels/views проходят без правки ожиданий.

**E2. Перенос рендер-каркаса.**
Файлы: `entity-list.tsx`, `entity-row.tsx`, `entity-list-empty.tsx`, `entity-list-badge.tsx`, `entity-list-label-badge.tsx`, `entity-icon.tsx`, `entity-panel.tsx`, `sortable-list.tsx`, `label-menu.tsx` + `label-menu-utils.ts`, `menu-context.tsx` → `packages/ui-collections/components/`.
Адаптеры, которые **остаются** в доменах: `SessionItem`, `SourceItem`, `SkillItem` (строки), `SessionBadges` — они по-прежнему собирают пропсы для `EntityRow` из доменных данных.
Приёмка: SessionList/SourcesListPanel/SkillsListPanel рендерятся на новых путях; визуально 1:1.

**E3. Декларативный фильтр-билдер.**
Файлы: новый `FilterBuilder.tsx` (+ компактный скин) в `ui-collections/components/`; удаление ~700 строк инлайн-реализации из `AppShell.tsx` и всей `CompactSessionListFilter.tsx`; `SessionList` получает `FilterSchema` из доменной схемы сессий.
Доменная часть: `apps/electron/src/renderer/domains/sessions/collection-schema.ts` — описание осей `status` (enum из statuses config), `label` (label-tree из labels config), `project` (project registry). Это — единственный session-specific код новой конфигурации.
Приёмка: оба скина (desk/compact) работают на одной реализации; tri-state `Map<string,'include'|'exclude'>` семантика (exclude wins, includes OR-gate) и `ViewFiltersMap` (`AppShell.tsx:681`) сохранены как транспорт фильтров.

**E4. Query-пайплайн + pluggable grouping/sorting.**
Файлы: новый `ui-collections/src/query.ts` (`useCollectionQuery`), `grouping.ts`, `sorting.ts`; `useSessionSearch.ts` распадается на: generic-часть (фильтр бакетов при collapse, пагинация) → `query.ts`; доменную часть (контент-поиск по transcripts, `getSessionStatus`) → `domains/sessions/session-query.ts`. Четыре ветки бакетирования `SessionList.tsx:300-620` заменяются регистрацией четырёх `GroupingRule` в схеме сессий; `'date'` остаётся принудительной для state-подпредставлений (правило наследует текущее поведение `AppShell.tsx:857`).
Добавляется `SortRule` с пользовательским выбором поля/направления — закрывает главный известный пробел.
Приёмка: визуальный паритет списка сессий; `rowData` мемо строится только из схемы; новая группировка `label` становится доступна для сессий без изменения движка.

**E5. Именованные сохранённые представления (SavedListView) + доменизация ViewConfig.**
Файлы: `packages/shared/src/views/*` → `ui-collections/src/saved-views.ts(+)`; расширение `ViewConfig` полем `domain` (обратно-совместимый default `'sessions'`); продвижение безымянной `ViewFiltersMap` + `chatGroupingMode` + сортировки + collapse-карты в сущность `SavedListView { id, domain, viewId?, filters, grouping, sort, layout? }`, хранимой в `views.json` v2 (миграция в `loadViewsConfig` по образцу `migrateFromSmartLabels`); регистрация `edit-knowledge-views` в `EditPopover` EDIT_CONFIGS рядом с `edit-views`.
`ViewEvaluationContext` (`views/types.ts:58`, session-shaped) заменяется на схемный: `buildViewContext` (`views/evaluator.ts:100`) получает поля из `CollectionDomainSchema.viewContextFields`; `compileAllViews`/`evaluateViews` не меняются.
Приёмка: существующие `views.json` читаются без действий пользователя (миграция), выражения filtrex дают те же badge-фильтры; SavedListView восстанавливает filter+grouping+sort за один клик.

**E6. Адаптер домена сессий: `SessionListProjection`.**
Файлы: `apps/electron/src/renderer/domains/sessions/session-projection.ts`; `SessionMenuParts`/`BatchSessionMenu` переводятся на action-дескрипторы проекции (действия по-прежнему вызывают те же колбэки `useAppShellContext` — RPC `sessions.*` @ `server-core/src/handlers/rpc/sessions.ts:301-390`).
Приёмка: список сессий целиком event-driven через движок; нулевая функциональная регрессия (share/status/labels/flag/archive меню, семейное сворачивание `session-families.ts`).

**E7. Адаптер домена облачных запусков: `CloudRunListProjection`.**
Файлы: `apps/electron/src/renderer/domains/cloud-runs/run-projection.ts`; источник данных — существующие `cloudRuns.LIST`/`GET_STATUS` RPC (`packages/server-core/src/handlers/rpc/cloud-runs.ts`) и `RunState='queued'|'running'|'done'|'failed'|'cancelled'` из `packages/cloud-runner/src/types.ts`.
Приёмка: поповер CloudRuns заменяется/дублируется view-коллекцией; saved view «упавшие ранны за 7 дней» — чистый filtrex.

**E8. Адаптер домена знаний: `KnowledgeListProjection`.**
Файлы: `apps/electron/src/renderer/domains/knowledge/knowledge-projection.ts`; источник — `KnowledgeProvider` ([03-knowledge-provider-contract.md](./03-knowledge-provider-contract.md)); remote queryProvider (§3.2); bulk-действия — только разрешённые операции Контура 2 ([05-mutation-safety.md](./05-mutation-safety.md)).
Приёмка: Knowledge Home (фаза P2 UI, см. suite S [03-panels-rails.md](../2026-08-07-unified-shell/03-panels-rails.md)) рендерит документы/базы через тот же `EntityList`, что и сессии.

### 3.4 `ListProjection` и три адаптера

Каноническая форма («Вердикт» §2.3, verbatim):

```typescript
interface ListProjection {
  key: string; title: string; subtitle?: string; icon?: string;
  labels: Array<{ id: string; title: string }>;
  status?: { id: string; title: string };
  updatedAt: number;
  open(): void;
}
class SessionListProjection implements ListProjection {}
class KnowledgeListProjection implements ListProjection {}
class CloudRunListProjection implements ListProjection {}
```

Это — контракт **строки**: то, что движку нужно знать об элементе любой коллекции, чтобы нарисовать `EntityRow`, чипы labels/status и открыть запись. Полный runtime-контракт домена вокруг него (этого интерфейса в att1 нет — «новый компонент», следствие §3.2):

```typescript
interface DomainProjection {
  readonly domain: CollectionDomainSchema<any>['domain'];
  readonly schema: CollectionDomainSchema<any>;
  /** Загрузка элементов (local: полный срез; remote: страница под компилированный запрос). */
  fetch(query: CompiledCollectionQuery): Promise<ListProjection[]>;
  /** Подписка на изменения (sessions: CHANGED-broadcast; cloud-runs: events.jsonl tail; knowledge: watcher §10). */
  subscribe(onChange: () => void): () => void;
  /** Дескрипторы row-menu и bulk-действий (доменные; движок только рендерит). */
  rowActions(item: ListProjection): ActionDescriptor[];
  bulkActions?(): ActionDescriptor[];
}
```

Три реализации — три источника правды, **без объединения БД**:

| Проекция | Источник данных | Каноническое хранилище | Откуда labels/status | `open()` |
|---|---|---|---|---|
| `SessionListProjection` | `sessionMetaMapAtom` ← RPC `sessions.*` | `workspaces/<id>/sessions/*/session.jsonl` (`packages/shared/src/sessions/storage.ts`) | Craft `labels[]` (`"id"`/`"id::value"` через `parseLabelEntry`) + dynamic `sessionStatus` из statuses config | навигация в chat-поверхность сессии |
| `KnowledgeListProjection` | `KnowledgeProvider.search/get` ([03](./03-knowledge-provider-contract.md)), remote | SiYuan (блоки/документы/базы; SQL/attributes на стороне kernel) | Craft operational labels поверх `knowledge_links` (см. [04-bridge-storage.md](./04-bridge-storage.md)) + SiYuan attributes как чужие поля контекста (ADR-005) | `open(ref)` → KnowledgeSurface (suite S [02-surface-registry-tabs.md](../2026-08-07-unified-shell/02-surface-registry-tabs.md)) |
| `CloudRunListProjection` | `cloudRuns.LIST/GET_STATUS` + `events.jsonl` tail | run-директории cloud-runner (`state.json` + `events.jsonl`, `packages/cloud-runner/src/local-provider.ts`) | Craft labels ранна + `RunState` как status | открыть popover/панель ранна |

### 3.5 Saved Knowledge Views

Канонический пример («Вердикт» §7, verbatim):

```yaml
name: Исследования на проверке
domain: knowledge
filter: { notebook: Research, attributes: { workflow_status: needs-review } }
group: { by: topic }
sort: [{ updated_at: desc }]
actions: [{ run_skill: verify-sources }, { set_attribute: approved }]
```

Принцип «Вердикта» §7: **«Те же UI-компоненты, что и список сессий. Под капотом: Session View → Craft storage; Knowledge View → SiYuan attributes/search; Cloud Run View → Craft runner. Один UI-язык, три независимых домена.»**

Соответствие существующему формату `ViewConfig` (`packages/shared/src/views/types.ts:16`, сегодня — expression-фильтр в `views.json`):

| YAML-поле | Маппинг на движок Craft | Комментарий |
|---|---|---|
| `name` | `ViewConfig.title` + `SavedListView.id/name` (E5) | — |
| `domain: knowledge` | новое поле `ViewConfig.domain: 'knowledge'` (default `'sessions'` — обратная совместимость) | расширение формата, не новый файл форматно; физически knowledge-виды хранятся отдельной секцией/файлом `views.json` v2 |
| `filter` | компиляция в filtrex-выражение домена `knowledge`: `notebook == "Research" and attributes.workflow_status == "needs-review"`; затем — в `SearchInput` провайдера (remote, §3.2) + пост-фильтр | поля выражения регистрируются через `viewContextFields` схемы домена: `notebook`, `attributes.*`, `updated_at`, `type`, `backlink_count` |
| `group` | `GroupingRule` `topic` в схеме knowledge | pluggable grouping (E4) |
| `sort` | `SortRule { field: updated_at, direction: desc }` — **впервые пользовательская сортировка** (E4) | закрывает пробел отсутствия sort-контроля |
| `actions` | дескрипторы bulk-кнопок представления; исполнение — skills ([10-skills-automations.md](./10-skills-automations.md)) и mutation-контур ([05](./05-mutation-safety.md)); `set_attribute` — только через approval Контура 2 | actions — нормативная часть yaml «Вердикта», хранимая как `SavedListView.presetActions` |

### 3.6 Интеграция с оболочкой

Движок — поставщик содержимого для слотов suite S: навигаторные панели ([03-panels-rails.md](../2026-08-07-unified-shell/03-panels-rails.md)) монтируют `CollectionView` по `domain`; omnibox/[04-omnibox.md](../2026-08-07-unified-shell/04-omnibox.md) получает `ListProjection`-строки всех доменов через единый `ProjectionRegistry` (быстрый переход/attach). Sidebar-регистрации остаются прежними (`LeftSidebar` LinkItem, `SidebarMenuType` union) — для домена knowledge добавляется навигатор по образцу sources/skills, но список внутри него — уже продукт движка.

## 4. Границы / что НЕ делаем

1. **НЕ смешиваем домены в одной коллекции в v1.** «На первой версии НЕ смешивать session+document+run+skill в одной произвольной коллекции (позже — Workbench View)» («Вердикт» §7). Смешанный Workbench View — отдельный документ, после P5.
2. **НЕ объединяем базы данных.** Общая универсальная Entity-БД — анти-цель (§15 «Вердикта», ADR-003). Проекции — read-адаптеры над независимыми хранилищами.
3. **НЕ соединяем board с query-движком в v1.** `KanbanBoardContainer` — параллельный пайплайн; присоединение board-layout к `useCollectionQuery` — greenfield-проект позже (scout: «Board view is a parallel pipeline… joining it is greenfield»).
4. **НЕ вводим второй язык фильтров.** Выражения SiYuan (SQL) не отображаются пользователю и не редактируются; пользовательский язык один — filtrex + декларативные оси (иначе — второй источник labels/statuses, запрещённый §5 «Вердикта»).
5. **НЕ тащим session-семантику в generic-код.** `session-families` (branch-линейка), наследование фильтров новой сессией (`new-session-filter-inheritance.ts`) и forced-`date` для state-views остаются доменными адаптерами, не параметрами движка.
6. **НЕ делаем bulk-действия generic по семантике.** Движок рендерит bulk-бар и дескрипторы; сами операции (включая запреты Контура 2: bulk delete, mass update, silent overwrite) задаются доменом и проходят контур записи ([05-mutation-safety.md](./05-mutation-safety.md)).

## 5. Критерии приёмки

- [ ] Существует пакет `packages/ui-collections` с файловой раскладкой §3.2; `matchesLabelFilter`, `parseLabelEntry`, `ViewConfig`, `compileAllViews`, `evaluateViews`, `useMultiSelect`, `useEntityListInteractions` импортируются оттуда без shim re-export из `packages/shared`.
- [ ] Шаги E1–E8 описывают атомарные коммиты с перечисленными файлами; каждый шаг из таблицы §3.1 имеет статус «generic as-is / перенос / остаётся адаптером».
- [ ] `ListProjection` воспроизведён verbatim из «Вердикта» §2.3; зарегистрированы три проекции-адаптера из таблицы §3.4; ни одна не читает чужое каноническое хранилище (ADR-003).
- [ ] Saved Knowledge View из §3.5 (yaml) загружается как `SavedListView` с `domain: 'knowledge'`: filter скомпилирован в filtrex-выражение и (для remote) в `SearchInput` провайдера; `group`/`sort` применяются движком; `actions` видны как preset bulk-кнопки.
- [ ] Список сессий после E6 визуально и функционально паритетен текущему (группировки date/status/unread/project, tri-state фильтры, семейное сворачивание, меню, bulk-действия).
- [ ] Появившаяся пользовательская сортировка работает одинаково для sessions и knowledge.
- [ ] Ни одна коллекция v1 не содержит элементов более чем одного домена.

## 6. Открытые вопросы

1. **Точная граница compile → post-filter для knowledge**: какие оси `FilterSchema` гарантированно выразимы в SiYuan attribute-search, а какие всегда уходят в пост-фильтр? Зависит от capability-дискавери провайдера ([03-knowledge-provider-contract.md](./03-knowledge-provider-contract.md), `capabilities()`).
2. **Персистентность remote-коллекций**: сохранять ли последний срез `KnowledgeListProjection` локально для оффлайн-открытия списка (без права записи) — или knowledge-раздел полностью online?
3. **Board-layout как четвёртая раскладка движка**: когда (и если) присоединять `KanbanBoardContainer` к `useCollectionQuery` — после Workbench View или параллельно?
4. **Collapse-ключи для knowledge**: текущий scope-суффикс `ws=…|filter=…|group=…` (`session-list-collapse.ts`) — достаточен ли он для remote-домена (учитывать ли `notebook` в ключе)?
5. **Кто владеет миграцией `views.json` v1 → v2** при сосуществовании старого `migrateFromSmartLabels` — отдельный миграционный проход или расширение существующего `loadViewsConfig`?
