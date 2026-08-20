# S-09. Unified Shell — последовательность реализации (волны W1–W6)

- **Doc ID**: S-09
- **Статус**: draft
- **Дата**: 2026-08-07
- **Входные документы**: исходный документ UI-интеграции «Единая оболочка» (att2, §16 «Минимальная внутренняя архитектура», §17 «Последовательность реализации (волны)», §2–§15); архитектурный вердикт интеграции SiYuan (att1, §16 «Последовательность поглощения», P0–P7); scout-отчёты `scout-AppShell.md`, `scout-SessionsViews.md`, `scout-SurfacesBrowser.md`, `scout-ServerCore.md`, `scout-SkillsCloud.md`
- **Связанные документы**: [S-00 Обзор](./00-overview.md), [S-01 Слоты оболочки](./01-shell-slots.md), [S-02 Реестр поверхностей и вкладки](./02-surface-registry-tabs.md), [S-03 Панели и rails](./03-panels-rails.md), [S-04 Omnibox](./04-omnibox.md), [S-05 Extension Center](./05-extension-center.md), [S-06 Plugin Bridge](./06-plugin-bridge.md), [S-07 Identity Center](./07-identity-center.md), [S-08 Рабочий конверт](./08-work-envelope.md), [S-10 Анти-цели](./10-anti-goals.md); suite K: [K-11 Дорожная карта](../2026-08-07-siyuan-integration/11-roadmap.md), [K-03 Контракт Knowledge Provider](../2026-08-07-siyuan-integration/03-knowledge-provider-contract.md), [K-05 Безопасность мутаций](../2026-08-07-siyuan-integration/05-mutation-safety.md), [K-07 Режимы подключения](../2026-08-07-siyuan-integration/07-connection-modes.md), [K-08 Лицензирование](../2026-08-07-siyuan-integration/08-licensing.md)
- **Репозиторий**: agisota/craft-agents-oss (форк craft-ai-agents/craft-agents-oss)

---

## 1. Цель

Разбить реализацию единой оболочки на шесть волн (W1–W6) с проверяемыми критериями выхода, явными зависимостями от фаз поглощения suite K (P0–P7, [K-11](../2026-08-07-siyuan-integration/11-roadmap.md)) и рисками. Документ — операционное расписание suite S: что строим, в каком порядке, что считается «готово», что может пойти не так.

## 2. Контекст и мотивация

### 2.1. Две дорожные карты, одна система

- **Suite K** (att1 §16, K-11): фазы поглощения P0 (ADR-001…006) → P1 (read-only провайдер) → P2 (нативный раздел Knowledge) → P3 (безопасный write-back) → P4 (Session→Knowledge) → P5 (сохранённые представления знаний) → P6 (knowledge-автоматизации) → P7 (managed kernel после гейтов G1 «ценность API» + G2 «лицензия»). Это путь «снизу вверх»: протокол → хранение → мутации.
- **Suite S** (att2 §17): волны оболочки W1–W6. Это путь «снаружи внутрь»: каркас UI → знания → команды → идентичность → расширения → плагины.

Волны НЕ дублируют фазы: K поставляет возможности (что система умеет), S поставляет видимый порядок (что пользователь получает). Отсюда жёсткое правило: **волна не может открыть UI поверх возможности, которой ещё нет в K** — но может открыть UI подмножества, пока K движется дальше.

### 2.2. Почему W1 — первый и «скучный»

Оболочка Craft сегодня — это `AppShell.tsx` (4007 строк) с 3-колоночной сеткой, inline-моделью навигации `links[]` (~2530–2730), единым носителем маршрутизации (`NavigationState` union из 10 навигаторов ⇄ `routes.ts` ⇄ `route-parser.ts` ⇄ `atoms/panel-stack.ts` ⇄ restore через `lib/local-storage.ts`) и **полным отсутствием** палитры команд и реестра поверхностей (scout-AppShell, scout-SurfacesBrowser). Любая последующая волна встраивается в слоты, реестры и вкладки — значит, реестры должны существовать первыми, и их ввод не должен сломать ни один из 10 существующих навигаторов.

### 2.3. Правило внутренней архитектуры на все волны

att2 §16: **не создавать сразу 8 новых пакетов**. Всё сначала живёт внутри существующих границ: `packages/core/src/platform/{commands/,resources/,panels/,surfaces/,extensions/,identity/,context-keys/}`, `packages/core/src/knowledge/{provider.ts,refs.ts,envelopes.ts,mutations.ts}`, `packages/core/src/knowledge/providers/siyuan/{client.ts,adapter.ts,commands.ts,resources.ts}`, `apps/electron/src/renderer/platform/{ActivityRail,SurfaceTabs,PanelHost,InspectorHost,Omnibox,ExtensionCenter}.tsx`, `apps/electron/src/renderer/knowledge/{KnowledgeNavigator,KnowledgeCollection,KnowledgeSurface,KnowledgeInspector,KnowledgeAgentPanel}.tsx`, `apps/electron/src/main/{knowledge-surface-manager,extension-host-manager,global-input-router,identity-broker}.ts`. Отдельные пакеты выделяются только когда модуль реально используется Electron + server + CLI + web client. Все перечисленные пути — **новые компоненты** (в репо их нет; существующие опорные точки названы в каждой волне явно).

## 3. Решение

### 3.0. Граф зависимостей: волны × фазы

```
                K-P0   K-P1      K-P2      K-P3      K-P4     K-P5    K-P6   K-P7
                ADR    read-only Knowledge write-back Session→ saved   auto- managed
                       provider  section              Knowledge views   mations kernel
S-W1 shell        ○      ·        ·         ·         ·        ·       ·      ·
S-W2 knowledge    ○      ●        ●         ·         ○        ○       ·      ·
S-W3 omnibox      ○      ●        ◐         ·         ·        ·       ·      ·
S-W4 identity     ○      ●        ·         ·         ·        ·       ·      ·
S-W5 ext-center   ○      ◐        ·         ·         ·        ·       ○      ·
S-W6 plugin-br.   ○      ●        ●         ●         ·        ·       ·      ·

● — жёсткая зависимость (волна не стартует без фазы)   ◐ — опционально/обогащает
○ — только общая рамка решений (ADR), не кодовая зависимость   · — нет связи
```

Зависимости между волнами:

```
        K-P0 (ADR-001…006 приняты)
            │
            ▼
        S-W1 Единый shell                          ┌── K-P1 read-only provider
            │                                      ├── K-P2 раздел Knowledge
            ├────────────► S-W2 Knowledge mode ◄───┘
            │              │
            ├────► S-W3 Omnibox ◄── K-P1 (search/deep links) [◐ K-P2]
            │
            ├────► S-W4 Identity ◄── K-P1 (connection health); докум. K-07/K-08
            │
            ├────► S-W5 Extension Center [◐ K-P1, K-P6]
            │              │
            │              └────► S-W6 Plugin bridge ◄── K-P1 + K-P2 + K-P3 (K-05)
            │
  K-P4 / K-P5 / K-P6 НЕ блокируют S-волны — обогащают контент:
  P4 → публикация сессии как действие в W2; P5 → настраиваемые saved views в W2/W3;
  P6 → automation-packs в каталоге W5.  K-P7 (managed kernel) — вне suite S.
```

W2 и W3 после W1 могут идти параллельно (разные владельцы контуров); W4 и W5 — тоже параллельно им и друг другу. W6 стартует только после W2 и W5.

### 3.1. W1 — единый shell

> Скоп verbatim (att2 §17): «Activity Rail, SurfaceRegistry, PanelRegistry, InspectorRail, сохранение layout, единые вкладки. Ничего не менять в SiYuan runtime».

**Компоненты.**

| Элемент | Статус | Путь |
|---|---|---|
| Existing shell-каркас | существует | `apps/electron/src/renderer/components/app-shell/AppShell.tsx` (4007 lines), `TopBar.tsx`, `LeftSidebar.tsx` (рендерит `links`), `PanelStackContainer.tsx`, `PanelSlot.tsx`, `MainContentPanel.tsx` |
| Маршрутизация/URL | существует | `apps/electron/src/shared/{types.ts (NavigationState union, :1079-1245), routes.ts, route-parser.ts (1018 LOC)}`, `contexts/NavigationContext.tsx` (1309 LOC) |
| Панельная стопка | существует | `renderer/atoms/panel-stack.ts` (PanelStackEntry/push/close/resize, proportions→URL), lane-scaffolding `PanelLanePolicy` + `__tests__/panel-stack-lanes.test.ts` |
| Персистентность layout | существует | `renderer/lib/local-storage.ts` (KEYS ~30, `panelLayout`, `sidebarVisible`, per-workspace restore), `hooks/useResizablePanels.ts` |
| Командная база | существует | `renderer/actions/{definitions.ts,registry.tsx,keybinding-context.ts}`, `shared/menu-schema.ts` |
| PanelRegistry + PanelHost, SurfaceRegistry + SurfaceTabs, ActivityRail, InspectorRail/InspectorHost | **новый компонент** | `packages/core/src/platform/{panels/,surfaces/}`, `renderer/platform/{ActivityRail,SurfaceTabs,PanelHost,InspectorHost}.tsx` |
| Гейтинг волны | существует | `packages/shared/src/feature-flags.ts` (паттерн `CRAFT_FEATURE_*`) |

**Критерий выхода.** Verbatim (att2 §17): *«существующие Sessions без регрессий, открываются как тип surface»*. Расширенные проверки:

- Все 10 существующих навигаторов рендерятся через новые реестры без изменения поведения (визуальный паритет плюс существующие тесты renderer зелёные).
- `route-parser.ts` round-trip (parse↔build) для каждого `SurfaceTab`-kind, включая новые `knowledge`/`extension` (хотя бы деградация в существующий маршрут до W2/W5).
- Layout (видимость/ширины/panel proportions) переживает перезапуск и переключение workspace (контракт `local-storage.ts` + URL-params не меняется для старых роутов).
- Волна за `CRAFT_FEATURE_*` флагом; новые строки проходят i18n-parity на 10 локалях (`scripts/check-i18n-parity.ts`).
- Ни одного нового top-level пакета (правило att2 §16).

**Зависимости.** K: только P0 (принятые ADR как общая рамка). S: нет.

**Риски.** (1) Blast radius рефакторинга `AppShell.tsx` — смягчается подходом реестров вместо hardcode (att2 §9) и флагом; (2) расхождение двух источников персистентности (URL vs localStorage) — фиксируем URL как source of truth (конвенция `NavigationContext.tsx`); (3) `lib/navigation-registry.ts` объявлен STALE (scout-AppShell) — не переиспользовать, авторитетен union в `shared/types.ts`; (4) compact-режим `PanelStackContainer` — регрессии stacked-переходов проверять отдельно.

### 3.2. W2 — Knowledge mode

> Скоп verbatim (att2 §17): «Knowledge в rail, Navigator, SiYuan editor surface, документы/блоки/backlinks/properties, Craft Agent Inspector, compatibility view».

**Компоненты.** Новые: `packages/core/src/knowledge/{provider,refs,envelopes,mutations}.ts` (контракты из K-03/[S-08](./08-work-envelope.md)), `packages/core/src/knowledge/providers/siyuan/*`, `renderer/knowledge/{KnowledgeNavigator,KnowledgeCollection,KnowledgeSurface,KnowledgeInspector,KnowledgeAgentPanel}.tsx`, `apps/electron/src/main/knowledge-surface-manager.ts`. Существующие опоры: host-surface паттерн `renderer/pages/BrowserPanelPage.tsx` (rect-reporter div + `ResizeObserver`/rAF → `browserPane.syncBounds` — шаблон встраивания чужого web-приложения) и `apps/electron/src/main/browser-pane-manager.ts` (`createEmbeddedInstance`, 3-WebContentsView композит, partitions); inspector-секции по образцу `RightSidebarPanel` (`shared/types.ts`); NotesPage как прецедент knowledge-style страницы (`renderer/pages/notes/`); CRUD-хуки списков `useMultiSelect`/`useEntityListInteractions` (переиспользуются для Navigator-коллекции).

**Критерий выхода.** Verbatim: *«работа с документом без второго app shell»*. Расширенные проверки:

- Открытие документа из Navigator создаёт surface tab `{kind:"knowledge", ref}`; документ/блоки/backlinks/properties читаются через `KnowledgeProvider` (K-03) и видны в соответствующих секциях Inspector.
- Craft Agent Inspector (att2 §10): contextual-действия над выбранным блоком («Спросить о документе/Переписать блок/Найти источники/…») стартуют обычную или компактную Craft-сессию с attached `KnowledgeRef`; «Full session» открывает полноценную session surface.
- Compatibility view (att2 §13): кнопка «Open full SiYuan interface» открывает полный SiYuan UI в отдельной Craft-вкладке; переключение integrated↔compatibility не теряет открытые документы.
- Провайдер в этой волне read-only: любой вызов мутации отсутствует/отклоняется (граница K-P1); рабочий конверт ([S-08](./08-work-envelope.md)) доступен: lazy-создание, Board с фиксированным маппингом BACKLOG/RESEARCH/REVIEW/DONE по `status`, секция «Unfiled».
- SiYuan runtime не изменён: integrated mode скрывает дублирующий chrome только на слое композиции (att2 §13).

**Зависимости.** K: P1 (read-only провайдер: health/search/get/backlinks/deep links) и P2 (нативный раздел Knowledge: sidebar item, home notebooks/recent/databases/saved views/search, встроенная editor surface) — обе жёсткие; P4/P5 обогащают (действие «Publish session», настраиваемые saved views вместо фиксированного маппинга). S: W1.

**Риски.** (1) Производительность/фокус встраивания (bounds-sync, `did-finish-load`, перехват hotkeys) — лечится копированием протокола BrowserPanelPage; (2) событийный мост editor→inspector (selection/backlinks) — контракт событий должен жить в адаптере, не в renderer-хаках; (3) падение SiYuan kernel не должно ронять Craft (изоляция процесса, health-бар); (4) первый connection mode — только `external-local` ([K-07](../2026-08-07-siyuan-integration/07-connection-modes.md)), managed не тащим в W2.

### 3.3. W3 — Omnibox

> Скоп verbatim (att2 §17): «Command Registry, Resource Provider Registry, Context Key Service, ⌘K, поиск сессий+знаний, маршрутизация hotkey из SiYuan surface».

**Компоненты.** Новые: `packages/core/src/platform/{commands/,resources/,context-keys/}`, `renderer/platform/Omnibox.tsx`, `apps/electron/src/main/global-input-router.ts` (перехват ⌘K на embedded webContents → палитра в Craft renderer). Существующие опоры: `renderer/actions/registry.tsx` (capture-phase keydown, `matchesHotkey`, user overrides), `keybinding-context.ts` (when-clause context keys — прямой прообраз Context Key Service), `actions/definitions.ts` (actions const → `ShortcutsPage` через `actionsByCategory`), `shared/menu-schema.ts` (нативное + React меню), `InlineMentionMenu`/`useInlineMention` (`components/ui/mention-menu.tsx` — прецедент секционного матчинга; сюда добавляется `MentionItemType: "knowledge"`), каналы поиска `sessions.ts` (@434) и `handlers/rpc/notes.ts` (полный CRUD+SEARCH как образец RPC-поверхности).

**Критерий выхода.** Verbatim: *«одна палитра выполняет Craft- и SiYuan-действия»*. Расширенные проверки:

- Один запрос (напр. «agent memory») отдаёт секции SESSIONS/KNOWLEDGE/SKILLS/RUNS (att2 §14); префиксы `>`/`@`/`/`/`#`/`?`/`!` работают по спецификации att2 §4, локальные меню (`/` в редакторе и чате, `@` в редакторе и чате) сохраняют различное поведение.
- ⌘K внутри embedded SiYuan surface перехватывается на уровне webContents и открывает Craft-палитру (global-input-router); маршрутизация выполнения: {Craft native | SiYuan kernel | SiYuan plugin | Craft extension | Skill | Automation}.
- Конфликты хоткеев видны в Settings→Keyboard Shortcuts с явным лесеночным приоритетом (пользовательское > команда поверхности > Craft native > расширение > SiYuan plugin > системный fallback); молчаливого «победителя» нет.
- `when`-выражения контекстно верны (пример att2: `knowledge.research-selected-blocks` активна только при `activeSurface=='knowledge' && selectedBlocks.count>0 && agent.available==true`).

**Зависимости.** K: P1 (search adapter + deep links; жёстко), P2 опционально (открытие найденного в knowledge surface). S: W1 (реестры), желательно W2 (чтобы KNOWLEDGE-секция была не пустой).

**Риски.** (1) Перехват фокуса у embedded webContents — тестировать на macOS/Windows отдельно; (2) латентность федеративного поиска (сессии+SiYuan+runs) — бюджет времени на провайдера, отмена запросов; (3) коллизии id команд между source-ами — пространства имён в Command Registry (`knowledge.*`, `siyuan-plugin:*`).

### 3.4. W4 — Identity Center

> Скоп verbatim (att2 §17): «Profile/Workspace/Service Connections/Credential refs/SiYuan account/единый account menu».

**Компоненты.** Новые: `packages/core/src/platform/identity/`, `apps/electron/src/main/identity-broker.ts` (брокер временных capability вместо raw secrets для расширений, att2 §7), единый верхний левый элемент (Profile/Workspaces/Connections/Account & Security), Settings→Accounts & Connections→Knowledge Sync (новая подстраница через существующий 4-шаговый рецепт `shared/settings-registry.ts` + `pages/settings/settings-pages.ts`). Существующие опоры: `packages/shared/src/credentials/{manager,types}.ts` (CredentialManager singleton, SecureStorageBackend, ключ `{type}::{scope}`, расширяемый `VALID_CREDENTIAL_TYPES`), `config/llm-connections.ts` (модель LlmConnection), `handlers/rpc/oauth.ts` (start/complete/cancel/revoke), `AiSettingsPage.tsx` (шаблон CRUD-соединений со статусами здоровья).

**Критерий выхода.** Verbatim: *«нет двух видимых account switcher; SiYuan sync и лицензия доступны»*. Расширенные проверки:

- В UI ровно один account-switcher (левый верх); SiYuan Cloud живёт как `ServiceConnection {provider: "siyuan-cloud"}` со статусом из union `"connected"|"expired"|"syncing"|"error"|"disconnected"` — не как корневая идентичность (att2 §11, анти-цель №7 [S-10](./10-anti-goals.md)).
- Local-first не сломан: Craft local profile + локальный SiYuan kernel работают без единого аккаунта.
- В renderer/DTO не утекает raw-токен: только `credentialRef` (проверка ревью типов `BroadcastEventMap`/DTO + отсутствие `process.env` в пейлоадах расширений — брокер выдаёт временные capability, att2 §7).
- Экран Knowledge Sync показывает SiYuan Cloud account, sync status, подписку/устройства и reconnect; лицензионная информация — по [K-08](../2026-08-07-siyuan-integration/08-licensing.md).

**Зависимости.** K: P1 (health/версия соединения), документально K-07 (режимы), K-08 (лицензия/entitlement). S: W1 (слот rail для identity-элемента).

**Риски.** (1) Смешение Craft Profile и SiYuan Cloud account в одной модели — запрещено анти-целью №7, держать федерацию; (2) второй виток настроек моделей внутри embedded SiYuan должен быть скрыт (att1 §5), иначе двойной контур; (3) дрейф entitlement API SiYuan Cloud.

### 3.5. W5 — Extension Center

> Скоп verbatim (att2 §17): «единый каталог, типы runtime, permissions, install target, installed/update views, SiYuan Bazaar provider, Craft extension manifest».

**Компоненты.** Новые: `packages/core/src/platform/extensions/` (Extension Registry + `ExtensionManifest` из att2 §7: `runtime`, `permissions`, `contributes`), `renderer/platform/ExtensionCenter.tsx`, Settings→Extensions {Installed/Updates/Permissions/Disabled/Developer mode/Registries} (паттерн settings-registry). Существующие опоры (источники записей каталога, не миграция данных): skills — `packages/shared/src/skills/{types,storage}.ts` (4-ярусное разрешение), sources/MCP — `packages/shared/src/sources/*`, automations — `packages/shared/src/automations/*`, permissions engine — `packages/shared/src/agent/{permissions-config.ts,mode-types.ts}` (layered default < workspace < per-source; permission-листы манифеста отображаются через него).

**Критерий выхода.** Verbatim: *«управление всеми расширениями из Craft»*. Расширенные проверки:

- Единый список с фильтрами типов (All/Apps/Knowledge/Skills/Sources/Automations/Agent runtimes/Themes); карточка явно показывает `runtime` + `permissions` + «works-in» (att2 §5/§12); поддержаны все 8 runtime-типов (включая `siyuan-plugin` — записи приходят из W6 feed).
- Install flow полный: select → choose workspace → show runtime → show permissions → show dependencies → install → activate → register contributions (att2 §12).
- Встроенные сущности Craft (skills/sources/automations/agent runtimes) видны и управляемы из каталога без переезда данных; установленное `craft-sandbox` UI исполняется в sandboxed renderer (contextIsolation, no nodeIntegration, CSP — att2 §8).
- Contributions установленного расширения регистрируются в реестрах W1/W3 и выключаются одним toggle.

**Зависимости.** K: P1 опционально (capability/plugin-листинг позже через W6), P6 опционально (automation-packs как runtime-тип). S: W1 (реестры contributions), W3 (commands из манифеста).

**Риски.** (1) Scope creep (подпись пакетов, биллинг, телеметрия) — вне волны; (2) юридические/API-риски провайдера SiYuan Bazaar; (3) расхождение permissions манифеста с layered `permissions.json` — один источник правды в engine, манифест только декларация.

### 3.6. W6 — Plugin bridge

> Скоп verbatim (att2 §17): «L1 launchable plugins, bridge-aware manifests, команды SiYuan plugins в Craft palette, custom tabs, contextual actions, compat levels».

**Компоненты.** Новые: вклад адаптера `packages/core/src/knowledge/providers/siyuan/{commands.ts,resources.ts}` (проекция в Contribution Registry), `apps/electron/src/main/extension-host-manager.ts` (изолированный extension host: no raw secrets, permission checks, resource limits, crash isolation — att2 §8), bridge-aware manifest mapping `SiYuan Plugin → SiYuan Adapter → Craft Contribution Registry {commands/tabs/panels/menus/agent actions}` (att2 §5), compat levels L0–L3 (att2 §6), dock-маппинг SiYuan→PanelSlot (att2 §9). Существующие опоры: surface model `SurfaceTab` (включая `{kind:"extension"}`), изоляционные паттерны `browser-pane-manager.ts` (partition per домен), `preload/bootstrap.ts` контролируемые каналы.

**Критерий выхода.** Verbatim: *«поддерживаемые плагины нативны, неподдерживаемые не ломаются»*. Расширенные проверки:

- L0: «Open in SiYuan compatibility view» доступна для любого плагина всегда; L1: плагин виден в Extensions/палитре/настройках и запускаем (UI внутри SiYuan surface); L2: эталонный плагин экспортирует команду + контекстное действие + custom tab в реестры Craft; L3 заявлен как цель, не обязательство волны (att2 §6).
- Падение плагина не роняет Craft main/сессии/браузер/другие workspaces (изоляция extension host — att2 §8).
- Легаси/неподдерживаемый плагин деградирует в L0 без потери данных; команды плагинов в палитре неймспейснуты (`siyuan-plugin:*`), конфликты хоткеев идут через лестницу W3.
- Любое пишущее действие L2/L3 идёт через proposal/diff контур [K-05](../2026-08-07-siyuan-integration/05-mutation-safety.md), не через прямой `updateBlock`.

**Зависимости.** K: P1 (листинг/события плагинов), P2 (compatibility view внутри Craft-вкладок), P3 (write-путь для L2/L3). S: W2 (knowledge surface), W3 (палитра), W5 (каталог).

**Риски.** (1) Соблазн «авто-переноса DOM» плагинов — анти-цель №6, только адаптер-проекции; (2) импеданс event-bus SiYuan→Craft; (3) permissions плагинов: raw API keys запрещены (анти-цель №5) — только broker-issued capabilities; (4) тяжёлые dock-панели навсегда остаются в L0 — это норма, не дефект.

### 3.7. Сводная таблица волн

| Волна | Скоп (коротко) | Жёсткие зависимости | Критерий (verbatim att2 §17) |
|---|---|---|---|
| W1 | Реестры shell, rails, вкладки, layout | K-P0 | «существующие Sessions без регрессий, открываются как тип surface» |
| W2 | Knowledge mode + editor surface + agent inspector | K-P1, K-P2, S-W1 | «работа с документом без второго app shell» |
| W3 | Omnibox: команды+ресурсы+context keys | K-P1, S-W1 | «одна палитра выполняет Craft- и SiYuan-действия» |
| W4 | Identity Center, федерация аккаунтов | K-P1, S-W1 | «нет двух видимых account switcher; SiYuan sync и лицензия доступны» |
| W5 | Extension Center, каталог 8 runtime-типов | S-W1, W3 | «управление всеми расширениями из Craft» |
| W6 | Plugin bridge L0–L3, extension host | K-P1, K-P2, K-P3, S-W2, S-W5 | «поддерживаемые плагины нативны, неподдерживаемые не ломаются» |

## 4. Границы / что НЕ делаем

- **НЕ стартуем волны до W1**: без реестров/slot-контрактов каждая следующая волна порождает второй rail/палитру (анти-цели №1–2, [S-10](./10-anti-goals.md)). Параллелить можно W2/W3/W4/W5 между собой, не W1 ни с чем.
- **НЕ трогаем SiYuan runtime в W1** и не переписываем SiYuan editor вообще (анти-цель №9).
- **НЕ выделяем новые пакеты** до доказанного переиспользования (att2 §16); структура `packages/core/src/platform|knowledge` — на все волны.
- **НЕ тащим K-работу в S-волны**: провайдер, мутации, публикации, автоматизации знаний реализует suite K (K-03/K-05/K-06/K-10, фазы P1–P6); S только открывает UI поверх них. Обратное тоже верно: K-фазы не зашивают UI-решения.
- **НЕ ждём K-P7** (managed kernel) для любой волны: P7 гейтится ценностью API и лицензией (K-11) и лежит вне suite S.
- **НЕ удаляем compatibility view** ни на одной волне (анти-цель №10); integrated mode — добавка, не замена.
- **НЕ делаем iOS/mobile-волну** в этой дорожной карте.

## 5. Критерии приёмки (на уровне всей карты)

- [ ] Каждая волна имеет критерий att2 §17 verbatim + расширенные проверяемые пункты (§3.1–3.6), и все они закрыты перед стартом следующей зависимой волны.
- [ ] После каждой волны: существующие тесты renderer/shared/server зелёные, `route-parser` round-trip и routing-exhaustiveness CI зелёные, i18n parity на 10 локалях зелёная, волна отключаема флагом.
- [ ] Каждая жёсткая зависимость waves×phases из §3.0 имеет подтверждённый артефакт на стороне suite K (changelog K-11) до старта волны.
- [ ] Ни одна волна не нарушает ни одну анти-цель [S-10](./10-anti-goals.md) (чек-лист анти-целей — обязательная секция ревью каждой волны).
- [ ] Ни один «новый компонент» из §2.3 не вводится раньше своей волны; преждевременные пакеты в ревью отклоняются.

## 6. Открытые вопросы

1. **Параллельность W2 и W3.** W3 технически стартует после W1+K-P1, но KNOWLEDGE-секция палитры пуста до W2. Допустим ли запуск W3 с SESSIONS/RUNS и подключением знаний по готовности — или ждать W2 для единого UX-демо?
2. **Board vs saved views.** W2 несёт фиксированный маппинг колонок (BACKLOG/RESEARCH/REVIEW/DONE) поверх envelope; настраиваемые сохраняемые представления приходят с K-P5. Остаётся ли W2-board приходом K-P5 без миграции конфигураций?
3. **Themes как runtime-тип W5.** Есть ли источник тем в Craft сегодня (кроме `ThemeProvider`), чтобы каталог не показывал пустой тип — или тип скрывается до первого поставщика?
4. **Эталонный L2-плагин для W6.** Выбрать заранее один реальный плагин SiYuan как приёмочный образец (критерий «команда+контекстное действие+tab»); кандидат — с governance-решением, не техническим.
5. **SiYuan Bazaar provider в W5**: юридические условия каталога и модель покупок относятся к W4 (entitlements) и K-08; порядок между W4/W5 может потребовать обращения, если Bazaar поедет раньше entitlements.
