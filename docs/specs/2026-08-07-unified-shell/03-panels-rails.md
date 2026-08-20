# S-03. Панели и рейки как реестр: Activity Rail, Inspector Rail, PanelRegistry

- **Doc ID**: S-03
- **Статус**: draft
- **Дата**: 2026-08-07
- **Входные документы**: «Единая оболочка» (att2, §§1–3, 9, 16–17), scout-отчёты `scout-AppShell` и `scout-SessionsViews` по `/Users/marklindgreen/Projects/craft-agents`.
- **Связанные документы**: [S-01 Shell slots](./01-shell-slots.md), [S-02 Surface registry и вкладки](./02-surface-registry-tabs.md), [S-04 Omnibox](./04-omnibox.md), [S-05 Extension Center](./05-extension-center.md), [S-09 Roadmap](./09-roadmap-waves.md), [S-10 Anti-goals](./10-anti-goals.md), [K-03 Knowledge Provider Contract](../2026-08-07-siyuan-integration/03-knowledge-provider-contract.md).

## 1. Цель

Перевести навигационные панели и боковые рейки Craft с хардкода в `AppShell.tsx` на декларативный реестр: любая панель (core, расширение, SiYuan-плагин) объявляется через `PanelContribution`, размещается в одном из шести `PanelSlot` и попадает в Activity Rail / Inspector Rail без правок мега-компонента оболочки. Документ фиксирует:

- состав Activity Rail (7 пунктов, включая поддерево Agent Studio) и Inspector Rail (6 инспекторов);
- типы `PanelSlot` / `PanelContribution` как единый контракт (verbatim из исходного документа);
- правило «запрет хардкода» и целевое размещение реестра;
- сопоставление dock-панелей SiYuan-плагинов на слоты Craft;
- пользовательские операции над панелями и формат их персистентности;
- профили компоновки и ключи контекста (`when`-выражения) для панелей.

## 2. Контекст и мотивация

### 2.1. Как устроено сегодня (факты по коду)

Оболочка рендерера — мега-компонент `apps/electron/src/renderer/components/app-shell/AppShell.tsx` (~4000 строк). Пункты навигации в нём захардкожены в нескольких местах, которые обязаны меняться согласованно:

| Место | Что содержит | Путь |
|---|---|---|
| Inline-модель пунктов | массив `links[]` с `nav:sources/skills/memory/projects/notes/automations` (~строки 2530–2730) | `apps/electron/src/renderer/components/app-shell/AppShell.tsx` |
| Рендер сайдбара | `LeftSidebar.tsx` (~595 строк) получает `links` пропом: дерево с раскрытием, сортируемые статусные группы, контекстные меню | `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx` |
| «Перечисление страниц» | union `NavigationState` из ~10 навигаторов (sessions+board, sources, settings, skills, notes, …) + type-guards | `apps/electron/src/shared/types.ts:1079-1223` |
| Маршруты | typed route builders и двунаправленный парсер route↔NavigationState (~1000 строк); новый навигатор = правка обеих сторон | `apps/electron/src/shared/routes.ts`, `apps/electron/src/shared/route-parser.ts` |
| Контекстные меню | union `SidebarMenuType` + ветки пунктов — расширяется под каждую секцию вручную | `apps/electron/src/renderer/components/app-shell/SidebarMenu.tsx` |
| Ветвление контента | per-navigator switch по страницам (`ChatPage`/`SourceInfoPage`/`SkillInfoPage`/…) | `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx` |
| Колонка навигатора | переключатель колонки по навигатору (~строка 3570) | `apps/electron/src/renderer/components/app-shell/AppShell.tsx` |

Правая колонка сегодня — ad-hoc: `RightSidebarPanel` в `apps/electron/src/shared/types.ts` и per-page инспекторы (например `NoteInspector` в `apps/electron/src/renderer/pages/notes/`) без общей модели «узкий рейл иконок → один инспектор». Глобального нижнего бара нет; статус решён как overlay-слот над вводом (`components/app-shell/input/ToolbarStatusSlot.tsx`).

Персистентность хрома уже централизована в `apps/electron/src/renderer/lib/local-storage.ts`: реестр `KEYS` (~30 ключей, префикс `craft-`, typed `get<T>(key, fallback, suffix?)`, динамические суффиксы вида `panel-layout:${key}`, `tabs-${workspaceId}`). Ключи списков — `listFilter`, `labelFilter`, `viewFilters` (карта `{ [viewKey]: { statuses, labels } }`), `collapsedSidebarItems`, `chatGroupingMode`.

### 2.2. Почему это не масштабируется

1. **Цена добавления пункта.** Новый навигатор сегодня требует правок минимум в шести местах (`AppShell.tsx` links[], `types.ts` union, `routes.ts`, `route-parser.ts`, `SidebarMenu.tsx`, `MainContentPanel.tsx`) — при этом интеграция SiYuan добавляет Knowledge, Runs, Extensions, Agent Studio и панели расширений.
2. **Невозможность плагинных панелей.** SiYuan Plugin API оперирует dock-панелями (LeftTop/LeftBottom/RightTop/RightBottom/BottomLeft/BottomRight) и custom tabs; `ExtensionManifest.contributes.panels` из [S-05](./05-extension-center.md) ожидает точку расширения «панели». Хардкод-модель принципиально не принимает внешние contribution.
3. **Нет пользовательской компоновки.** Сейчас сохраняются только видимость/ширина колонок (`sidebarVisible`, `sidebarWidth`, `panel-layout:${key}`); пользователь не может скрыть пункт, переставить его или сохранить набор «профиль».
4. **Отрицательный прецедент.** `apps/electron/src/renderer/lib/navigation-registry.ts` — устаревший реестр (3 навигатора, `PlaceholderComponents`). Он документирован как STALE; повторно использовать его запрещено: авторитетный источник — union в `shared/types.ts`. Урок: реестр должен быть *единственной* моделью, а не вторым способом рядом с хардкодом.

### 2.3. Существующие прецеденты реестров

- `apps/electron/src/shared/settings-registry.ts` — **образец для подражания**: единый `SETTINGS_PAGES` (15 подстраниц) порождает тип `SettingsSubpage`, валидацию и задокументированный 4-шаговый рецепт добавления; полнота рендера гарантируется типом `Record<SettingsSubpage, ComponentType>` в `pages/settings/settings-pages.ts`. PanelRegistry повторяет эту схему: single source → производные типы → TS-контроль полноты.
- `apps/electron/src/renderer/actions/registry.tsx` + `actions/keybinding-context.ts` — готовый when-движок: контекстные ключи (`inputFocus`, `hasSelection`, `chatFocus`, `navigatorFocus`, `sidebarFocus`, `menuOpen`) и `evaluateWhen`. PanelRegistry использует тот же синтаксис выражений.

## 3. Решение

### 3.1. Два рейка в системе слотов

Геометрия областей зафиксирована в [S-01](./01-shell-slots.md): `RAIL (48px) | NAVIGATOR (220–260px) | COLLECTION (280–380px) | MAIN (min 640px) | INSPECTOR (320–420px)`. Настоящий документ определяет, *чем наполняются* крайние колонки:

```
┌────────────┬───────────────────────────────────────────────────┬────────────┐
│ ACTIVITY   │  NAVIGATOR │ COLLECTION │ MAIN SURFACE           │ INSPECTOR  │
│ RAIL 48px  │            │            │                        │ RAIL 48px  │
│ + rail     │            │            │                        │ + один     │
│   items    │            │            │                        │ инспектор  │
└────────────┴───────────────────────────────────────────────────┴────────────┘
```

- **Activity Rail (слева)** — вертикальный рейл иконок верхнего уровня: выбирает активный навигатор/режим приложения. Раскрытие второго уровня (поддерево) выполняется внутри рейла флаяутом, основной контент — в слоте `navigator-primary`.
- **Inspector Rail (справа)** — вертикальный рейл иконок инспекторов: клик раскрывает **один** правый инспектор; повторный клик по активной иконке сворачивает. Два больших правых sidebar одновременно не существует (anti-goal, [S-10](./10-anti-goals.md)).
- **Status slot (низ)** — однострочная полоса `slot:"status"` (подключение, sync, активный runtime, токены, фоновые задачи). Регистрируется тем же `PanelRegistry`, но с ограничениями: не `resizable`, клик по индикатору ведёт на соответствующую поверхность (`open()` из [S-02](./02-surface-registry-tabs.md)), а не открывает панель. Сегодняшнего глобального бара нет — ближайший прецедент `ToolbarStatusSlot.tsx` (overlay-слот над вводом), он остаётся локальным кейсом composer'а. Slot status — не лента уведомлений (требование [S-01](./01-shell-slots.md)).

### 3.2. Activity Rail

Состав рейла (порядок = `defaultOrder`, шаг 10 — для вставок расширений):

| order | id | Пункт | Навигатор (slot `navigator-primary`) | Источник | Статус в коде |
|---|---|---|---|---|---|
| 10 | `rail.sessions` | Sessions | список сессий (board/list viewMode) | `core` | навигатор `sessions` существует (`shared/types.ts`) |
| 20 | `rail.knowledge` | Knowledge | Knowledge Navigator: Notebooks / Tags / Inbox / Favorites | `core` | **новый компонент** (волна W2); данные — через [K-03](../2026-08-07-siyuan-integration/03-knowledge-provider-contract.md) |
| 30 | `rail.browser` | Browser | список окон/вкладок браузера | `core` | инфраструктура есть (`BrowserPaneManager`, страницы browser в `MainContentPanel.tsx`) |
| 40 | `rail.runs` | Runs | список облачных запусков (queued/running/done) | `core` | backend-контур `cloudRuns.*` в `packages/server-core` существует; отдельный навигатор — **новый компонент** (сейчас UI — чип в composer) |
| 50 | `rail.agent-studio` | Agent Studio | флаяут-поддерево, см. ниже | `core` | узлы существуют как разнесённые навигаторы/страницы |
| 60 | `rail.extensions` | Extensions | Extension Center (Installed / Marketplace) | `core` | **новый компонент** (волна W5, [S-05](./05-extension-center.md)) |
| 70 | `rail.settings` | Settings | навигатор настроек (15 подстраниц) | `core` | существует (`shared/settings-registry.ts`) |

**Раскрытие второго уровня.** Первый клик по пункту открывает слот `navigator-primary` с его навигатором. У пунктов с `children` клик (или hover с задержкой) открывает флаяут-список рядом с рейлом; выбор узла подсвечивает родителя и грузит навигатор узла. Состояние раскрытия не липкое: смена пункта сворачивает флаяут (аналог существующего `collapsedSidebarItems` хранит только пользовательские свёртки внутри навигатора).

**Поддерево Agent Studio** (`rail.agent-studio.children`) — сегодня это разрозненные разделы, после реестра они становятся узлами одного родителя:

| Узел | Что открывает | Сегодня в коде |
|---|---|---|
| `studio.skills` | навигатор Skills | навигатор `skills` (`nav:skills` в links[], `MainContentPanel.tsx`) |
| `studio.sources` | навигатор Sources | навигатор `sources` |
| `studio.memory` | навигатор Memory | навигатор `memory` |
| `studio.automations` | навигатор Automations | навигатор `automations` |
| `studio.toolchain` | Toolchain (runtime/инструменты: статусы, установка, disable) | compound-route `settings/toolchain` → навигатор `settings`, `details:{type:'runtime'}`; RPC `toolchain.*` в server-core |

Текущее расположение этих разделов (верхнеуровневые навигаторы / подстраница Settings) при переезде в поддерево не ломает deep links: старые compound-routes (`settings/toolchain`, `sources`, `skills`) продолжают парситься `route-parser.ts` и редиректятся на contribution id.

### 3.3. Inspector Rail

Правый рейл: шесть иконок; активен строго один инспектор. Набор доступных иконок зависит от поверхности через `when` (см. §3.9).

| id | Инспектор | Назначение | Доступность (when) |
|---|---|---|---|
| `insp.agent` | Agent | Craft Agent Inspector: документ/выбранные блоки/backlinks/источники/связанная сессия; режимы Contextual companion ↔ Full session | `agent.available==true` |
| `insp.info` | Info | свойства объекта: метаданные поверхности, envelope (статус/labels/flags) | всегда |
| `insp.outline` | Outline | структура документа/сессии | `activeSurface=='knowledge' \|\| activeSurface=='session'` |
| `insp.backlinks` | Backlinks | входящие ссылки на документ/блок | `activeSurface=='knowledge'` |
| `insp.graph` | Graph | локальный граф связей | `activeSurface=='knowledge'` (v1 — placeholder до графовой визуализации) |
| `insp.history` | History | версии/история объекта + браузерная история на browser-surface | всегда |

Поведение: клик по неактивной иконке открывает инспектор (дефолтная ширина из `PanelContribution`, пользовательская — из overrides); клик по активной — скрывает слот `inspector`, рейл иконок остаётся видимым. Смена поверхности не закрывает инспектор, но при смене `activeSurface` инспектор, чей `when` перестал выполняться, заменяется на дефолтный для новой поверхности (`insp.info`), а прежний выбор запоминается per surface kind.

### 3.4. Контракт: PanelSlot и PanelContribution

Типы — единый источник, **verbatim** из исходного документа (§9); `PanelRenderer` — ссылка на React-компонент рендера (для `craft-sandbox`/`siyuan-plugin` — host-компонент адаптера):

```typescript
type PanelSlot = "activity"|"navigator-primary"|"navigator-secondary"|"inspector"|"bottom"|"status";
interface PanelContribution {
  id: string; title: string; icon: string;
  slot: PanelSlot; defaultOrder?: number;
  when?: string; defaultVisible?: boolean; resizable?: boolean;
  source: { type: "core"|"extension"|"siyuan-plugin"; id: string };
  render: PanelRenderer;
}
```

Правила чтения контракта:

- `id` глобально уникален (`<domain>.<name>`, напр. `knowledge.navigator`, `insp.backlinks`); коллизия id — отказ регистрации с записью в лог, первая регистрация побеждает.
- `when` — выражение над Context Keys (§3.9); без `when` панель доступна всегда.
- `source` определяет изоляцию рендера: `core` — прямой React-рендер; `extension` — extension host / sandboxed renderer ([S-05](./05-extension-center.md)); `siyuan-plugin` — адаптер поверх SiYuan dock API.
- `resizable` разрешает sash-ресайз; фактические размеры хранятся в layout-state (§3.7), не в contribution.

### 3.5. PanelRegistry: запрет хардкода

**Новый компонент** (волна W1, размещение по att2 §16):

```
packages/core/src/platform/panels/        # модель: types.ts (PanelSlot/PanelContribution), registry.ts, ordering.ts
apps/electron/src/renderer/platform/      # хосты: ActivityRail.tsx, PanelHost.tsx, InspectorHost.tsx
```

Размещение согласовано с соседними документами: реестр поверхностей по [S-02](./02-surface-registry-tabs.md) живёт renderer-first (`renderer/platform/SurfaceTabs.tsx`), потому что случаи «Electron-only» у surfaces пока нет; панели же делят пакет `platform/` с Context Key Service из [S-04](./04-omnibox.md) (`packages/core/src/platform/context-keys/`) — `when`-контракт потребляется и палитрой, и панелями, поэтому модель и реестр держим в `packages/core` по плану att2 §16, а React-хосты — в renderer.

`PanelRegistry` — runtime-API над списком зарегистрированных contributions:

```ts
interface PanelRegistry {
  register(contribution: PanelContribution): Disposable;      // коллизия id → throw + лог
  list(slot: PanelSlot, ctx: ContextKeys): PanelContribution[]; // отсортировано order, отфильтровано evaluateWhen
  get(id: string): PanelContribution | undefined;
  onDidChange(listener: () => void): Disposable;               // для перерисовки рейлов
}
```

**Правило для ревью (проверяется grep'ом):** после миграции W1 в `AppShell.tsx`/`LeftSidebar.tsx`/`MainContentPanel.tsx`/`shared/types.ts`/`route-parser.ts` **не добавляются** новые rail-пункты и навигаторы; новый пункт = `registry.register(...)`. Существующие массив `links[]` и ветки `MainContentPanel` конвертируются в core-contributions (таблица §3.2 — seed-список), затем inline-модель удаляется. Полнота рендера контролируется как в `settings-registry.ts`: `Record<PanelSlot, HostComponent>` + список обязательных core-ids, покрытый тестом реестра.

Миграция происходит по одному навигатору за раз; пока навигатор не конвертирован, он живёт по-старому (реестр не обязан поглощать всё за один шаг) — но ветка «старый путь» инкапсулирована одним legacy-адаптером contribution, а не размазана по shell.

### 3.6. Сопоставление SiYuan dock-панелей

SiYuan Plugin API предоставляет dock-позиции и custom tabs. Сопоставление на слоты Craft (att2 §9, полное):

| SiYuan dock | Craft PanelSlot / цель | Примечание |
|---|---|---|
| `LeftTop` | `navigator-primary` | основной навигатор плагина |
| `LeftBottom` | `navigator-secondary` | вторичная нижняя секция под навигатором |
| `RightTop` | `inspector` | вкладка Inspector Rail (пункт в рейле) |
| `RightBottom` | `inspector` secondary tab | вторая вкладка того же инспектора |
| `BottomLeft` | `bottom` | нижняя панель |
| `BottomRight` | `bottom` | нижняя панель (вторая вкладка bottom-слота) |
| custom tab | `SurfaceTab` | вкладка верхнего ряда, см. [S-02](./02-surface-registry-tabs.md) |

Dock-панель плагина, требующая сложной SiYuan-специфичной DOM-структуры, не проецируется принудительно: плагин остаётся работоспособным в L0/L1-режиме через compatibility view (Knowledge → «Open full SiYuan interface»), регистрация панели выполняется только при L2+. Уровни совместимости — [S-06](./06-plugin-bridge.md).

### 3.7. Пользовательские операции и persistence

Пользователь может над любой панелью рейлов: **закрепить** (pinned — не скрывается при смене профиля/поверхности), **скрыть**, **переместить** (изменить порядок внутри рейла; слот меняется только между `inspector`-вкладками и `bottom`-вкладками), **изменить размер** (sash, если `resizable`), **сохранить layout** (текущие overrides → в именованный профиль), **восстановить layout** (сброс к профилю или factory default).

Persistence — в существующем модуле `apps/electron/src/renderer/lib/local-storage.ts` поверх его `KEYS`-реестра и typed get/set; новые ключи добавляются в `KEYS` (**новый компонент**). S-01 фиксирует, что композиция слотов сериализуется как `LayoutProfile` («Layout — данные, не код»); его контракт локализован здесь (**новый компонент**):

```typescript
interface LayoutProfile {
  id: string; title: string; builtin?: boolean;          // builtin: agent|knowledge|research|review|browser|focus|debug
  slots: Partial<Record<PanelSlot, {
    visible: boolean;
    width?: number;                                       // для resizable-слотов (navigator-*/inspector)
    active?: string;                                      // активная contribution слота (напр. activeInspector)
  }>>;
  activityItem?: string;                                  // выбранный пункт Activity Rail (напр. "rail.knowledge")
  createdAt: number; updatedAt: number;
}
```

| KEY | Строка | Суффикс | Содержимое |
|---|---|---|---|
| `panelLayout` *(существующий)* | `panel-layout` | `${layoutKey}` | пропорции панелей (как сегодня) |
| `panelProfile` *(новый)* | `panel-profile` | `${workspaceId}` | id активного `LayoutProfile` (образец суффикса — `tabs-${workspaceId}`) |
| `panelState` *(новый)* | `panel-registry-state` | `${workspaceId}` | пользовательские overrides реестра + `customProfiles: Record<id, LayoutProfile>` |

Формат `panel-registry-state` (JSON; образец per-view карты — существующий `viewFilters` `{ [viewKey]: { statuses, labels } }`):

```jsonc
{
  "version": 1,
  "activeProfile": "research",
  "rails": {
    "activity":  { "collapsed": false },
    "inspector": { "open": true, "activeInspector": "insp.agent", "width": 360 }
  },
  "overrides": {
    // [contributionId] — только пользовательские дельты; дефолты живут в contribution
    "knowledge.navigator": { "order": 20, "pinned": true,  "hidden": false, "width": 260 },
    "rail.runs":           { "hidden": true },
    "insp.graph":          { "hidden": true }
  },
  "customProfiles": {
    // LayoutProfile (§3.7): сохранённые пользователем композиции
    "my-review": {
      "id": "my-review", "title": "Мой review", "activityItem": "rail.knowledge",
      "slots": {
        "navigator-primary": { "visible": true,  "width": 240, "active": "knowledge.navigator" },
        "inspector":         { "visible": true,  "width": 380, "active": "insp.agent" },
        "bottom":            { "visible": false }
      },
      "createdAt": 1754500000000, "updatedAt": 1754500000000
    }
  }
}
```

Инварианты: (1) чтение только через `get<T>(KEYS.panelState, fallback, workspaceId)` — parse-failure отдаёт fallback (поведение модуля); (2) `version` обязателен, неизвестные версии читаются best-effort по известным полям; (3) overrides никогда не дублируют дефолтное значение поля (delta-only); (4) состояние не выходит за workspace — суффикс `${workspaceId}` для всего, кроме глобальной видимости рейлов.

### 3.8. Профили компоновки

Семь встроенных профилей (id фиксированы; пользовательские — в `customProfiles`):

| Профиль | Activity Rail | Navigator | Collection | Main | Inspector | Bottom / Status |
|---|---|---|---|---|---|---|
| `agent` | виден | Sessions | фильтры сессий | Chat | `insp.agent` (full session) | скрыт |
| `knowledge` | виден | Knowledge Navigator | — | Document (SiYuan editor) | `insp.info` / `insp.outline` | скрыт |
| `research` | виден | Knowledge Navigator | — | Document **split** Browser | `insp.agent` (companion) | скрыт |
| `review` | виден | — | Needs Review | Diff surface | Provenance (вкладка `insp.agent`) | скрыт |
| `browser` | виден | свёрнут | — | Browser во всю ширину | `insp.history` | скрыт |
| `focus` | свёрнут | свёрнут | свёрнут | единственная surface | свёрнут | скрыт |
| `debug` | виден | Sessions | — | Chat/Runs | `insp.history` | **развёрнут** (logs/console) |

Research layout:

```
┌──────┬───────────────┬────────────────────────────────┬──────────────┐
│ RAIL │ KNOWLEDGE     │ MAIN (split 50/50)             │ AGENT        │
│  📚▸ │ Notebooks     │ ┌───────────────┬────────────┐ │ companion    │
│      │ Tags          │ │ Document.md   │ Browser    │ │ 3 blocks sel │
│      │ Inbox         │ │ (SiYuan edit) │ (research) │ │ ▶ Find srcs  │
└──────┴───────────────┴────────────────────────────────┴──────────────┘
```

Review layout:

```
┌──────┬───────────────┬────────────────────────────────┬──────────────┐
│ RAIL │ NEEDS REVIEW  │ DIFF: proposal #142            │ PROVENANCE   │
│  📚  │  12 items     │  - old line                    │ run #142     │
│  ▶   │  ▾ run #142   │  + new line                    │ sources: 3   │
│      │               │  ctx…                          │ author: kimi │
└──────┴───────────────┴────────────────────────────────┴──────────────┘
```

Переключение профиля — из меню рейла и из Omnibox (команды `layout.applyProfile`, [S-04](./04-omnibox.md)); смена профиля записывает `panel-profile` и применяет слот-состав без перезагрузки.

### 3.9. Context Keys: when-выражения панелей

Синтаксис выражений и функция оценки — наследники `apps/electron/src/renderer/actions/keybinding-context.ts` (`evaluateWhen`, существующие ключи `inputFocus/hasSelection/chatFocus/navigatorFocus/sidebarFocus/menuOpen`). **Общий Context Key Service** — компонент волны W3 Omnibox; его контракт и полный набор ключей фиксирует [S-04](./04-omnibox.md) (там же — приоритеты горячих клавиш). Настоящий документ закрепляет только **ключи-предшественники**, необходимые панелям уже в W1–W2:

| Ключ | Тип | Источник значения | Используется для |
|---|---|---|---|
| `activeSurface` | `surface.kind` (`session`/`knowledge`/`browser`/`cloud-run`/…) | SurfaceRegistry ([S-02](./02-surface-registry-tabs.md)) | видимость инспекторов/навигаторов |
| `selectedBlocks.count` | number | knowledge surface (provider [K-03](../2026-08-07-siyuan-integration/03-knowledge-provider-contract.md)) | действия инспектора агента |
| `agent.available` | boolean | наличие настроенного backend-соединения сессии | `insp.agent`, команды «Спросить о документе» |
| `focusedPanel` | contribution id | `focusedPanelIdAtom` (`atoms/panel-stack.ts`); общий ключ из таблицы [S-04](./04-omnibox.md) §3.7 | контекстные меню, hotkeys внутри панели |
| `rail.activity.collapsed` | boolean | **новый ключ** — публикует PanelRegistry из layout-state (§3.7) | hotkey-режимы, focus-профиль |

Пример применения в contribution:

```typescript
{
  id: "insp.backlinks", title: "Backlinks", icon: "link-2",
  slot: "inspector", defaultOrder: 40,
  when: "activeSurface=='knowledge'",
  defaultVisible: true, resizable: true,
  source: { type: "core", id: "knowledge" },
  render: BacklinksInspector,
}
```

Консистентность с палитрой гарантируется тем, что команды ([S-04](./04-omnibox.md), пример `knowledge.research-selected-blocks`, `when="activeSurface=='knowledge' && selectedBlocks.count>0 && agent.available==true"`) вычисляют `when` тем же сервисом и по тем же ключам.

## 4. Границы / что НЕ делаем

- **Не содержимое навигаторов.** Дерево блокнотов, фильтры сессий, страницы Sources/Skills — это рендеры contribution; документ определяет только слоты, контракт и состав рейлов. Движок представлений COLLECTION-столбца (фильтры/группировки/view-запросы) — отдельный контур [K-09](../2026-08-07-siyuan-integration/09-collection-view-engine.md); здесь только его слот `navigator-secondary`.
- **Не Command/Resource Registry и не хоткеи** — это [S-04](./04-omnibox.md); здесь только ключи контекста, нужные панелям.
- **Не SurfaceRegistry/вкладки** — [S-02](./02-surface-registry-tabs.md); custom tab SiYuan-плагинов лишь упомянут в таблице сопоставления.
- **Не меняем SiYuan runtime**: dock API плагинов продолжает исполняться внутри SiYuan; Craft проецирует contributions, не перенося DOM (anti-goal, [S-10](./10-anti-goals.md)).
- **Не второй Activity Rail / второй постоянный правый sidebar** — один рейл слева, один справа, один раскрытый инспектор (anti-goals att2 §18).
- **Не удаляем устаревший `lib/navigation-registry.ts`** в этом документе: он уже помечен STALE, его вынос — отдельная уборка, не блокер W1.
- **Не ломаем URL-формат панельных пропорций** `panelStackAtom` (`atoms/panel-stack.ts`) до отдельной миграции; layout-state §3.7 живёт в localStorage, а пропорции multi-panel остаются в URL.
- **Не графовая визуализация** в W1–W2: `insp.graph` регистрируется как вкладка-placeholder, контент — поздняя волна.

## 5. Критерии приёмки

- [ ] Типы `PanelSlot` / `PanelContribution` присутствуют в `packages/core/src/platform/panels/types.ts` **verbatim** (см. §3.4); сборка renderer-а падает при неполном `Record<PanelSlot, HostComponent>`.
- [ ] Grep по `AppShell.tsx`, `LeftSidebar.tsx`, `shared/types.ts`, `route-parser.ts` не находит новых rail/item-хардкодов после W1; все пункты §3.2 приходят из `PanelRegistry`.
- [ ] Добавление новой панели (тестовая core-contribution) выполняется одной регистрацией без правок шести файлов из §2.2; пункт появляется в рейле, проходит ordering и `when`-фильтрацию.
- [ ] Activity Rail содержит 7 пунктов §3.2; Agent Studio раскрывается поддеревом из 5 узлов; старые deep links (`sources`, `skills`, `settings/toolchain`) продолжают открываться.
- [ ] Inspector Rail содержит 6 иконок §3.3; одновременно открыт не более одного инспектора; `when`-фильтрация по `activeSurface` работает.
- [ ] Таблица сопоставления §3.6 покрывает все 6 dock-позиций SiYuan и custom tab; L2+ dock-панель плагина появляется в назначенном слоте, L0/L1 не регистрирует панель.
- [ ] Операции pin/hide/move/resize/save/restore сохраняются в `panel-registry-state:${workspaceId}` и переживают перезапуск renderer; parse-broken JSON отдаёт defaults без падения.
- [ ] `LayoutProfile` (§3.7) сериализуется/восстанавливается: сохранение текущей композиции → смена профиля → восстановление; 7 builtin-профилей имеют `builtin: true` и недоступны для перезаписи.
- [ ] 7 профилей компоновки применяются без перезагрузки; Research и Review соответствуют схемам §3.8.
- [ ] Ключи §3.9 доступны `evaluateWhen` в панельных `when` и совпадают с ключами палитры ([S-04](./04-omnibox.md)).

## 6. Открытые вопросы

1. **Коллизии порядка.** Две contribution с одинаковым `defaultOrder` сортируются стабильно по `id` — достаточно ли этого, или нужен явный `tiebreak`-приоритет `core > extension > siyuan-plugin`?
2. **Миграция существующих ключей.** Текущие `sidebarVisible`/`sidebarWidth`/`sidebarMode` и legacy `SidebarMode` (`app-shell/sidebar-types.ts`) — сворачивать их в `panel-registry-state` в W1 или держать параллельно до конца миграции навигаторов?
3. **Pinned + when=false.** Если пользователь закрепил панель, чей `when` на новой поверхности ложен, — показывать disabled-состояние или временно скрывать (сейчас: скрывать, выбор запоминается)?
4. **Перемещение между рейлами.** Сейчас move разрешён внутри одного рейла и между `inspector`-/`bottom`-вкладками (§3.7) — оставляем это ограничение или разрешаем произвольный перенос между рейлами (требует per-slot контракта размеров)?
5. **Graph Inspector.** Отдельная иконка рейла с inline-графом или кнопка «открыть как вкладку» (`SurfaceTab`) при малой ширине — решить после спайка графовой визуализации.
