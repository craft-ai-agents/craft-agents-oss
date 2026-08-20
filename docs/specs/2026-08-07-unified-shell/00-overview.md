# S-00. Единая оболочка Craft × SiYuan — обзор и целевая модель

- **Doc ID**: S-00
- **Статус**: draft
- **Дата**: 2026-08-07
- **Входные документы**: исходный документ UI-интеграции «Единая оболочка» (att2); scout-отчёты `scout-AppShell.md`, `scout-SessionsViews.md`, `scout-SurfacesBrowser.md`; архитектурный вердикт интеграции SiYuan (att1, см. suite K)
- **Связанные документы**: [S-01 Слоты оболочки](./01-shell-slots.md), [S-02 Реестр поверхностей и вкладки](./02-surface-registry-tabs.md), [S-03 Панели и rails](./03-panels-rails.md), [S-04 Omnibox](./04-omnibox.md), suite K: [README](../2026-08-07-siyuan-integration/README.md), [K-03 Контракт Knowledge Provider](../2026-08-07-siyuan-integration/03-knowledge-provider-contract.md)
- **Репозиторий**: agisota/craft-agents-oss (форк craft-ai-agents/craft-agents-oss)

---

## 1. Цель

Зафиксировать целевую модель пользовательского интерфейса после интеграции SiYuan в Craft: одна геометрия оболочки, принцип «Craft — хозяин каждого слота», полная карта переноса элементов интерфейса SiYuan в элементы Craft. Документ — точка входа в suite S: он отвечает на вопрос «что мы строим концептуально», детали механизмов вынесены в S-01…S-10.

## 2. Контекст и мотивация

### 2.1. Два интерфейса уже построены по одной геометрии

И Craft, и SiYuan компонуются по одинаковой базовой схеме:

```
[ГЛОБАЛЬНЫЙ РЕЖИМ] → [КОНТЕКСТНАЯ НАВИГАЦИЯ] → [КОЛЛЕКЦИЯ/ДЕРЕВО] → [ОСНОВНАЯ РАБОЧАЯ ПОВЕРХНОСТЬ] → [ИНСПЕКТОР/АГЕНТ]
```

- **Craft сегодня**: 3-колоночная сетка в `apps/electron/src/renderer/components/app-shell/AppShell.tsx` (4007 строк, mega-component) — `[LeftSidebar ~20% | NavigatorPanel ~32% | MainContentPanel ~48%]`, плюс `TopBar.tsx` (48px) и правый sidebar (`RightSidebarPanel` в `apps/electron/src/shared/types.ts:1079-1245`).
- **SiYuan сегодня**: левый вертикальный activity rail, панели структуры/тегов/inbox/закладок, редактор с вкладками, правый dock (backlinks/graph/…), status bar.

Раз геометрия совпадает, интерфейсы **не надо «склеивать»** (вкладывать SiYuan окном внутрь Craft). Надо определить единый набор слотов и назначить хозяина каждого слота.

### 2.2. Почему склейка не подходит

| Признак склейки | Чем это плохо |
|---|---|
| Второй глобальный chrome (логотип, workspace switcher, настройки) | Два «приложения в приложении», постоянная путаница фокуса |
| Вторая палитра / вторая поисковая строка | Пользователь не знает, где искать; хоткеи конфликтуют |
| Второй marketplace и вторая система аккаунтов | Двойное управление расширениями и подписками |
| Отдельная тема и AI-чат SiYuan | Визуальный разрыв, два конкурирующих агента |

Craft уже содержит отдельные контуры app-shell, чата, браузера (`BrowserPaneManager.createEmbeddedInstance` в main-процессе), автоматизаций и облачных запусков — каждый со своим UI-входом. Добавление знаний «ещё одной вложенной оболочкой» превратит оболочку в набор несвязных iframe-окон.

### 2.3. Почему хозяин — Craft

- Оболочка Craft уже URL-driven: `NavigationState` union (10 навигаторов) ⇄ `shared/routes.ts` ⇄ `shared/route-parser.ts` ⇄ panel-stack атомы (`atoms/panel-stack.ts`) ⇄ localStorage restore (`lib/local-storage.ts` KEYS registry ~30 ключей). Это носитель, на который ложатся новые поверхности.
- Командная инфраструктура Craft (`actions/definitions.ts`, `actions/registry.tsx`, `shared/menu-schema.ts`) — единственное место, куда можно честно маршрутизировать hotkey обоих миров (сегодня палитры нет вообще — см. [S-04](./04-omnibox.md)).
- Волна интеграции идёт «снаружи внутрь»: W1 не трогает SiYuan runtime вообще (см. [S-09 Дорожная карта](./09-roadmap-waves.md)).

## 3. Решение

### 3.1. Тезис «одна геометрия»

Объявляем **одну оболочку Craft из пяти слотов + статус-бар**, где каждый слот — контракт геометрии, а не обязательная колонка:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Профиль/Workspace        Вкладки поверхностей              ⌘K    +           │
├──────┬────────────────┬──────────────────┬──────────────────────┬────────────┤
│ RAIL │   NAVIGATOR    │    COLLECTION    │    MAIN SURFACE      │ INSPECTOR  │
│ 48px │  220–260px     │   280–380px      │    min 640px         │ 320–420px  │
├──────┴────────────────┴──────────────────┴──────────────────────┴────────────┤
│ Статус │ синхронизация │ активный runtime │ токены │ фоновые задачи            │
└──────────────────────────────────────────────────────────────────────────────┘
```

Размеры, режимы, мотивация и сравнение с существующим shell — в [S-01](./01-shell-slots.md). Здесь важно: все пять областей **не обязаны** быть открыты одновременно — слот сворачивается, скрывается и возвращается профилем компоновки.

### 3.2. Craft — хозяин каждого слота

| Слот | Хозяин | Что предоставляет SiYuan |
|---|---|---|
| Хром окна (top bar, вкладки, ⌘K, профиль) | Craft | ничего — не проносим свой хром |
| RAIL (глобальный режим) | Craft | паттерн activity rail как вдохновение, не код оболочки |
| NAVIGATOR | Craft | данные структуры знаний через Knowledge Provider ([K-03](../2026-08-07-siyuan-integration/03-knowledge-provider-contract.md)) |
| COLLECTION | Craft | движок представлений коллекций ([K-09](../2026-08-07-siyuan-integration/09-collection-view-engine.md)) |
| MAIN SURFACE | Craft (вкладки, layout) | редактор и блоки как embedded **surface** (новый компонент `SiyuanEditorSurface`) |
| INSPECTOR | Craft (Inspector Rail) | backlinks/outline/graph/properties как реестровые панели |
| STATUS BAR | Craft | статус подключения/синхронизации kernel как источник данных |

Итог — **не Craft с вложенным окном SiYuan**, а единая адаптивная оболочка Craft, внутри которой SiYuan предоставляет редактор, блоки и знания. Панели и навигация перестают хардкодиться в `AppShell.tsx` и переходят на реестры: `SurfaceRegistry` / `PanelRegistry` (новые компоненты, контракты в [S-02](./02-surface-registry-tabs.md) и [S-03](./03-panels-rails.md)). Переход постепенный: существующие Sessions, Browser, Runs становятся типами surface без регрессий.

### 3.3. Карта элементов SiYuan → Craft

Полная карта переноса (все элементы интерфейса SiYuan из исходного документа §3). Каждая строка — либо проекция в существующий элемент Craft, либо явно помеченный **новый компонент**.

| Элемент SiYuan | Куда переезжает в Craft | Статус |
|---|---|---|
| Переключатель workspace (сверху слева) | Craft Profile & Workspace (см. [S-07 Identity Center](./07-identity-center.md)) | существует: workspace selector в `TopBar.tsx` |
| Левая вертикальная панель (activity bar) | Craft Activity Rail (48px, режимы) | новый компонент, см. [S-01](./01-shell-slots.md) |
| Structure (дерево документов) | Knowledge Navigator / Outline | новый `KnowledgeNavigatorPanel` |
| Tags (облако тегов) | Knowledge Navigator / Tags | новый компонент; правило labels↔tags — в [K-suite](../2026-08-07-siyuan-integration/02-integration-boundaries.md) |
| Inbox (неразобранное) | Knowledge Navigator / Inbox | новый компонент |
| Bookmarks (закладки) | Knowledge Navigator / Favorites | новый компонент |
| Graph (граф связей) | Inspector → Graph **или** отдельная вкладка | новый компонент (Inspector-панель или `SurfaceTab`) |
| Backlinks (обратные ссылки) | Inspector → Links | новый компонент |
| Editor tabs (вкладки редактора) | Unified Surface Tabs | новый компонент, см. [S-02](./02-surface-registry-tabs.md) |
| Plugin icon (иконка плагинов) | Extensions → Installed | новый Extension Center, см. [S-05](./05-extension-center.md) |
| Marketplace / crown (базар, вип-корона) | Extensions → Marketplace | новый компонент, см. [S-05](./05-extension-center.md) |
| Search (глобальный поиск) | Craft Omnibox | новый компонент, см. [S-04](./04-omnibox.md) |
| Terminal | Tools / Console surface | новый тип surface (`kind: "console"`) |
| Theme (темы SiYuan) | Craft Appearance (Settings) | существует: `pages/settings` + `AppearanceSettingsPage`; темы знаний — через Extension Center (`runtime: "skill-pack"`/theme) |
| Status bar | Общий Craft Status Bar | новый компонент, см. [S-03](./03-panels-rails.md) |
| SiYuan Agent (AI-чат) | Craft Agent Inspector | существующий чат-контур Craft, новый Inspector-вариант, см. [S-03](./03-panels-rails.md) |
| SiYuan settings (настройки) | Settings → Knowledge → Advanced | существующий settings-registry (`apps/electron/src/shared/settings-registry.ts`, 4-шаговый рецепт добавления страницы) |

Редкие настройки собираются в `Settings → Knowledge { Connection / Storage / Sync / Editor / Plugins / Open advanced SiYuan settings }`. Принцип: функциональность **не вырезается**, но **не дублируется** — у каждой возможности ровно один видимый вход.

### 3.4. Конечный интерфейс

Целевая картина после волн W1–W6 (знания открыты поверх рабочего дня агента):

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ AGI/Rox   [Session] [Architecture.md] [Browser] [Run #142]           ⌘K  +   │
├─────┬─────────────────┬────────────────────┬─────────────────────┬────────────┤
│ 💬  │ KNOWLEDGE       │ RESEARCH           │ ARCHITECTURE.MD     │ AGENT      │
│ 📚  │ Notebooks       │ Needs Review 12    │ # Craft × SiYuan    │ 4 blocks   │
│     │ ...             │                    │                     │  ...       │
├─────┴─────────────────┴────────────────────┴─────────────────────┴────────────┤
│ SiYuan connected · Synced · Kimi K3 · Auto mode · 2 background runs           │
└───────────────────────────────────────────────────────────────────────────────┘
```

Читается так: пользователь держит рядом сессию агента, документ знаний, браузер и облачный запуск — переключение между вкладками **не уничтожает контекст** (state вкладок сериализуется, см. [S-02](./02-surface-registry-tabs.md)); статус-бар агрегирует подключение kernel, синк, активную модель и фоновые задачи Craft в одной строке.

### 3.5. Итоговая формула

```
Craft shell
  + SiYuan editor/kernel
  + единый panel/surface registry
  + единая command palette (Omnibox)
  + федеративный identity center
  + единый extension catalog
  + несколько изолированных runtimes
= единая оболочка
```

Каждое слагаемое детализировано в отдельном документе suite: registry → [S-02](./02-surface-registry-tabs.md)/[S-03](./03-panels-rails.md), palette → [S-04](./04-omnibox.md), extensions → [S-05](./05-extension-center.md), plugin bridge → [S-06](./06-plugin-bridge.md), identity → [S-07](./07-identity-center.md), runtimes → [S-06](./06-plugin-bridge.md) и [K-02](../2026-08-07-siyuan-integration/02-integration-boundaries.md).

## 4. Границы / что НЕ делаем

- **НЕ склеиваем два глобальных shell.** Полный запретный список «второго shell» — в [S-01 §3.5](./01-shell-slots.md) и [S-10 Анти-цели](./10-anti-goals.md): две палитры, два activity rail, два AI-агента, два account switcher, два marketplace.
- **НЕ переписываем SiYuan editor.** Редактор и блоки подключаются как surface; рендер и модель документа остаются в kernel/runtime SiYuan (compat-уровни L0–L3 в [S-06](./06-plugin-bridge.md)).
- **НЕ описываем здесь архитектуру данных.** Knowledge Provider, bridge-хранилище, контур записи, публикация — suite K ([README](../2026-08-07-siyuan-integration/README.md)); S-documents ссылаются на неё, но не дублируют.
- **НЕ фиксируем в этом документе контракты реестров и палитры** — только целевую модель; интерфейсы в S-02/S-03/S-04.
- **НЕ требуем одновременной видимости всех слотов** — профили компоновки (Agent/Knowledge/Research/Review/Browser/Focus/Debug) скрывают лишнее.

## 5. Критерии приёмки

- [ ] Тезис «одна геометрия» сформулирован одной цепочкой слотов и воспроизводим со схемой §3.1.
- [ ] Для каждого из 5 слотов + status bar назван хозяин (Craft) и указано, что именно предоставляет SiYuan (таблица §3.2).
- [ ] Карта SiYuan → Craft (§3.3) содержит **все 17 элементов** исходного документа §3, включая строку про редкие настройки; ни один элемент не потерян и не продублирован.
- [ ] Каждое утверждение «уже существует» ссылается на реальный файл/символ кодовой базы (`AppShell.tsx`, `TopBar.tsx`, `settings-registry.ts`, …); всё новое помечено «новый компонент».
- [ ] Конечный интерфейс (§3.4) и итоговая формула (§3.5) воспроизведены и не противоречат S-01/S-02.
- [ ] Границы §4 явно запрещают «второй shell» и отсылают к S-10.

## 6. Открытые вопросы

1. **Naming глобальных режимов в rail**: `Sessions / Knowledge / Browser / Runs / Agent Studio / Extensions / Settings` (исходный документ) или сокращённый набор W1 (`Sessions / Knowledge / Extensions`)? Финализируется в [S-01](./01-shell-slots.md) и волне W1.
2. **Terminal/Console surface**: входит в W-волну позже остальных; нужен ли отдельный `SurfaceTab.kind: "console"` на W1 или достаточно существующего `BrowserPanelPage`? Кандидат на решение в [S-02](./02-surface-registry-tabs.md).
3. **Graph**: Inspector-панель или полноценная вкладка? От перевеса зависит layout Inspector Rail ([S-03](./03-panels-rails.md)).
4. **Темы SiYuan**: переносим ли theme-packs базара как `runtime: "web-widget"`/`skill-pack` расширения или ограничиваемся маппингом на Craft Appearance? Решение в [S-05](./05-extension-center.md).
5. **Мобильная/compact геометрия**: `PanelStackContainer.tsx` уже имеет compact-mode stacked transitions; как слот-модель деградирует на узких окнах — требуется отдельный проход (кандидат на S-03).
