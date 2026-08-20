# S-01. Слоты оболочки: геометрия, режимы, границы против «второго shell»

- **Doc ID**: S-01
- **Статус**: draft
- **Дата**: 2026-08-07
- **Входные документы**: исходный документ UI-интеграции «Единая оболочка» §§1–2 (att2); scout-отчёт `scout-AppShell.md` (существующий shell, факты по файлам)
- **Связанные документы**: [S-00 Обзор](./00-overview.md), [S-02 Реестр поверхностей и вкладки](./02-surface-registry-tabs.md), [S-03 Панели и rails](./03-panels-rails.md), [S-04 Omnibox](./04-omnibox.md), [S-05 Extension Center](./05-extension-center.md), [S-07 Identity Center](./07-identity-center.md), [S-10 Анти-цели](./10-anti-goals.md)

---

## 1. Цель

Специфицировать целевую композицию оболочки: набор слотов и их размеры, состав каждого слота в четырёх глобальных режимах, что именно переносим из интерфейса SiYuan (и почему), что принципиально не переносим («второй shell»), и как целевая геометрия соотносится с существующим shell Craft. Контракты реестров (`SurfaceRegistry`, `PanelRegistry`) и механика вкладок — вне scope: см. [S-02](./02-surface-registry-tabs.md) и [S-03](./03-panels-rails.md); здесь — геометрия и правила наполнения.

## 2. Контекст и мотивация

### 2.1. Как устроен shell сегодня

По scout-AppShell (craft-agents @ 961c1f450):

- **Сетка**: 3 колонки в `apps/electron/src/renderer/components/app-shell/AppShell.tsx` (4007 строк, mega-component): `[LeftSidebar ~20% | NavigatorPanel ~32% | MainContentPanel ~48%]` (layout-комментарий в коде). Flex-ряд собирается в `PanelStackContainer.tsx` с `PanelResizeSash`.
- **Левая боковая панель**: `LeftSidebar.tsx` (595 строк) рендерит prop `links[]` — модель собирается **inline** в `AppShell.tsx` (~строки 2530–2730): `nav:sources`, `nav:skills`, `nav:memory`, `nav:projects`, `nav:notes`, `nav:automations` плюс сессии/статусы/labels и контекстные меню (`SidebarMenu.tsx`, типы `allSessions` … `newSession`).
- **Колонка навигатора**: switch по `navState` (~строки 3570–3615) между `SourcesListPanel` / `SkillsListPanel` / `MemoryListPanel` / `AutomationsListPanel` / `ProjectsListPanel`.
- **Контент**: `MainContentPanel.tsx` ветвится по `isXNavigation` → `ChatPage` / `SourceInfoPage` / `SkillInfoPage` / `AutomationInfoPage` / `ProjectInfoPage` / `BrowserPanelPage` / `NotesPage` / Kanban / `SETTINGS_PAGE_COMPONENTS`.
- **Верх**: `TopBar.tsx` (48px, persistent): sidebar toggle, menu, back/forward, workspace selector, browser strip (вкладки браузера), Help dropdown.
- **Статус**: глобального нижнего бара **нет**; ближайший эквивалент — `input/ToolbarStatusSlot.tsx` (приоритетный overlay над полем ввода: escape-hint, `BrowserStatusBar`).
- **Правый край**: тип `RightSidebarPanel` объявлен в `apps/electron/src/shared/types.ts:1079-1245` — постоянной правой rail-структуры нет.
- **Персистентность**: `lib/local-storage.ts` KEYS registry (~30 ключей, префикс `craft-`, суффикс workspace): `sidebarVisible`, `sidebarWidth`, `panelLayout(:key)`, `workspaceUrl(:slug)`; пропорции панелей сериализуются в URL через `atoms/panel-stack.ts` (`?panels=route:proportion`).

### 2.2. Проблемы, которые решает слот-модель

1. **Перегрузка левой колонки.** Сегодня один столбец несёт: Sessions (с фильтрами Statuses/Labels), Sources, Skills, Memory, Projects, Notes, Automations, Settings — и будет расти (Knowledge, Browser, Runs, Extensions). Каждый новый раздел требует правки `links[]`, switch навигатора, обработчиков кликов в `AppShell.tsx` — mega-component растёт линейно.
2. **Нет командного слоя.** Палитры нет вообще (grep-verified по scout-AppShell); хоткеи живут в `actions/registry.tsx` без UI-поверхности. Интеграция знаний без единого вызова команд превратит меню в свалку (Omnibox — [S-04](./04-omnibox.md)).
3. **Вкладки есть только у браузера.** Browser strip в `TopBar.tsx` хранит только browser-вкладки; сессии/документы/runs переключаются через навигацию с потерей визуального контекста.
4. **Справа пусто.** Контекстные данные (агент, backlinks, outline) девать некуда — нет inspector-контура.

### 2.3. Почему решение — слоты, а не «ещё одна колонка»

Каждая добавленная «ещё одна колонка» увеличивает минимальную ширину окна и хардкодит композицию в `AppShell.tsx`. Слот-модель объявляет **контракт геометрии**: область с диапазоном ширины, источником контента из реестра и правилом видимости. Панели перестают хардкодиться — добавление раздела становится регистрацией `PanelContribution` (см. [S-03](./03-panels-rails.md)), а не правкой 4007-строчного компонента.

## 3. Решение

### 3.1. Целевая композиция: 5 слотов + статус-бар

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

| Слот | Ширина | Роль | Контент поставляется |
|---|---|---|---|
| **RAIL** | 48px фикс | Переключатель глобального режима | `PanelContribution slot:"activity"` — реестр, не хардкод |
| **NAVIGATOR** | 220–260px | Контекстная навигация режима (разделы, деревья, фильтры) | `slot:"navigator-primary"` |
| **COLLECTION** | 280–380px | Коллекция/дерево объектов режима (список сессий, документы, очередь review) | `slot:"navigator-secondary"` / collection view engine ([K-09](../2026-08-07-siyuan-integration/09-collection-view-engine.md)) |
| **MAIN SURFACE** | min 640px, остальное | Рабочая поверхность с вкладками | `SurfaceTabs` над типизированными surface (S-02) |
| **INSPECTOR** | 320–420px | Контекстный инспектор активной поверхности | `slot:"inspector"` (за Inspector Rail 48px) |
| **STATUS BAR** | высота одной строки | Агрегированный статус: подключение, sync, runtime, токены, фоновые задачи | `slot:"status"` |

Принципы:

1. **Слоты — не обязательные колонки.** Все пять областей НЕ обязаны быть открыты одновременно. Любой слот (кроме RAIL) может быть свёрнут/скрыт; минимальная жизнеспособная композиция — RAIL + MAIN SURFACE.
2. **Inspector не является вторым постоянным sidebar.** Справа постоянно живёт только узкий Inspector Rail (48px иконок); широкая область 320–420px раскрывается по выбору пункта и скрывается обратно.
3. **Layout — данные, не код.** Композиция (какие слоты видимы, ширины, порядок) сериализуется как **LayoutProfile** (новый компонент; носитель — существующие механизмы: пропорции в URL из `atoms/panel-stack.ts`, KEYS registry `lib/local-storage.ts`). Профили поставляются из коробки: **Agent / Knowledge / Research / Review / Browser / Focus / Debug**; пользователь может закрепить/скрыть/переместить/изменить размер слота и сохранить/восстановить layout.
4. **Один хозяин хрома.** Top bar, вкладки, ⌘K, профиль, status bar — всегда Craft, в любом режиме и при любом активном surface (включая embedded SiYuan editor).

### 3.2. Режимы и состав слотов

RAIL переключает **глобальный режим**; режим определяет содержимое слотов. Scope этого документа — четыре режима (Сессии, Знания, Исследование, Расширения); исходный документ допускает расширение rail (Browser, Runs, Agent Studio, Settings) — эти пункты либо сворачиваются в перечисленные режимы, либо добавляются поздними волнами (см. §6 и [S-09](./09-roadmap-waves.md)).

| Слот | 💬 Сессии | 📚 Знания | 🔬 Исследование | 🧩 Расширения |
|---|---|---|---|---|
| **NAVIGATOR** | Workspace-разделы: фильтры Statuses, Labels; списки Projects | Notebooks, Structure (дерево), Tags, Inbox, Favorites | Сохранённые исследования, источники (Sources), очереди | Категории каталога: Apps, Knowledge, Skills, Sources, Automations, Agent runtimes, Themes |
| **COLLECTION** | Список сессий / board-виды (Kanban — существующий `board` viewMode) | Список документов выбранного узла; результаты collection views | Очередь «Needs Review» с счётчиком; подборки материалов | Карточки расширений: Installed / Updates / Marketplace |
| **MAIN SURFACE** | `ChatPage` (существует), board surface | `SiyuanEditorSurface` (новый компонент): документ, свойства, блоки | Split: документ + `BrowserPanelPage` (существует); diff surface результатов | Детальная страница расширения (runtime, permissions, works-in, настройки) |
| **INSPECTOR** | Agent (чат-контур Craft), метаданные сессии, провенанс провайдера | Agent / Info / Outline / Backlinks (Links) / Graph / History | Agent / Provenance; цепочка источников | Permissions расширения, журнал событий, issues |
| **STATUS BAR** | активный runtime, токены, approval-режим | `SiYuan connected/syncing` · синк · конфликты | фоновые задачи исследования, browser-агенты | фоновые установки/обновления |

Замечания к таблице:

- В режиме **Знания** Inspector Rail содержит пункты `Agent / Info / Outline / Backlinks / Graph / History`; пункт Agent открывает **Craft Agent Inspector** — SiYuan AI как отдельный контур не сохраняется (см. §3.5).
- Режим **Расширения** — UI-проекция [S-05 Extension Center](./05-extension-center.md); здесь важно только, что каталог живёт в тех же слотах, без отдельного окна/маркетплейса.
- Переключение режима **не уничтожает** открытые вкладки MAIN SURFACE — вкладки глобальны (см. §3.3), меняется лишь наполнение навигационных слотов.

### 3.3. Верхние вкладки поверхностей

Вкладка = любая рабочая поверхность, а не только браузер:

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

Пользователь держит рядом `[Session] [Architecture.md] [Browser] [Run #142]`. Переключение не уничтожает контекст: состояние вкладки сериализуется и восстанавливается (механизм — наследник URL-пропорций `?route=/?panels=` из `contexts/NavigationContext.tsx`). Жизненный цикл, `SurfaceRegistry`, dirty-flags и границы количества вкладок — в [S-02](./02-surface-registry-tabs.md). Здесь фиксируем: вкладки живут в верхнем хроме Craft (сегодняшний browser strip из `TopBar.tsx` — частный случай, который обобщается).

### 3.4. Что забираем из интерфейса SiYuan

Переносим **паттерны**, а не код оболочки SiYuan:

1. **Левый Activity Rail.** Узкая вертикальная панель режимов 48px. Мотивация — реальная перегрузка текущей боковой панели Craft: в одном столбце уже живут `Sessions` (+Statuses/Labels), `nav:sources`, `nav:skills`, `nav:memory`, `nav:projects`, `nav:notes`, `nav:automations`, `Settings` (inline `links[]` в `AppShell.tsx:2530–2730`, типы меню `allSessions`…`newSession` в `SidebarMenu.tsx`) — и в неё просятся Knowledge, Browser, Runs, Extensions. Rail даёт режимам первоклассный переключатель; после выбора режима раскрывается **текущая панель второго уровня Craft**, напр. `Agent Studio → Skills / Sources (APIs / MCPs / Local folders) / Memory / Automations / Toolchain`. Это НЕ сокращение функций — устранение бесконечной колонки: каждый существующий раздел сохраняется, но получает адрес «режим → раздел».
2. **Правый контекстный rail → Inspector Rail.** Узкая панель иконок справа (`Agent / Info / Outline / Backlinks / Graph / History`); клик раскрывает **один** инспектор шириной 320–420px. НЕ держать постоянно второй большой sidebar — сегодняшний `RightSidebarPanel` (union в `shared/types.ts`) становится содержимым этого инспектора.
3. **Верхняя система вкладок.** Вкладка = любая поверхность (см. §3.3); обобщаем существующий browser strip на все типы.

### 3.5. Что НЕ берём: запрет на «второй глобальный shell»

Не оставляем ни одного дублирующего глобального элемента; каждый элемент SiYuan-хрома маршрутизируется в единственный хозяйский элемент Craft:

| Элемент SiYuan-хрома | Маршрут в Craft |
|---|---|
| Второй логотип | Хром Craft (top bar), бренд workspace — в [S-07 Identity Center](./07-identity-center.md) |
| Второй workspace switcher | Craft Profile & Workspace selector (`TopBar.tsx` уже содержит workspace selector) |
| Вторая глобальная строка поиска | Craft Omnibox (`?`-префикс, полнотекст), см. [S-04](./04-omnibox.md) |
| Вторая палитра | Craft Omnibox (⌘K), маршрутизация команд из embedded surface — S-04 |
| Вторая кнопка настроек | Craft Settings; знания = `Settings → Knowledge {Connection/Storage/Sync/Editor/Plugins/Advanced}` на существующем `settings-registry.ts` |
| Второй marketplace | Craft Extension Center (SiYuan Bazaar = один из provider), см. [S-05](./05-extension-center.md) |
| Отдельная тема | Craft Appearance; темы знаний — через Extension Center, не через свой переключатель |
| Отдельный AI-чат SiYuan | Craft Agent Inspector (§3.2); двух агентных контуров не допускаем |

Правило: функциональность не вырезается, но **видимый вход ровно один** (полная карта элементов — в [S-00 §3.3](./00-overview.md)).

### 3.6. Сравнение с существующим shell

| Аспект | Сегодня (файл/символ) | Целевое | Тип изменения |
|---|---|---|---|
| Глобальный режим | нет понятия; разделы в одной колонке | RAIL 48px, реестр пунктов | новый компонент (Activity Rail) |
| Левая боковая панель | `LeftSidebar.tsx`, prop `links[]` из `AppShell.tsx:2530–2730` | NAVIGATOR 220–260px, контент из `PanelRegistry` по режиму | миграция существующих панелей в реестр |
| Колонка навигатора | switch ~`AppShell.tsx:3570–3615` (`SourcesListPanel` и др.) | тот же паттерн, но данные из реестра, не switch | рефакторинг без смены UX |
| Коллекция | вторая колонка совмещена с навигатором | COLLECTION 280–380px, выделенный слот | новый слот; Kanban/list переезжают из обобщённого MainContentPanel |
| Контент | `MainContentPanel.tsx` per-navigator branches | MAIN SURFACE min 640px + `SurfaceTabs` | обобщение browser strip (из `TopBar.tsx`) на все surface |
| Верхний хром | `TopBar.tsx` 48px: toggle/menu/back/forward/workspace/browser strip/Help | тот же бар + унифицированные вкладки + ⌘K + «+» | расширение существующего компонента |
| Палитра команд | отсутствует (grep-verified) | слот вызова в хроме (⌘K), Omnibox | новый компонент, см. [S-04](./04-omnibox.md) |
| Статус | `input/ToolbarStatusSlot.tsx` — overlay над вводом; нижнего бара нет | STATUS BAR — постоянный слот снизу окна | новый компонент; ToolbarStatusSlot остаётся локальным companion |
| Правая область | `RightSidebarPanel` union (`shared/types.ts`), без постоянной rail | Inspector Rail 48px + раскрываемый Inspector 320–420px | новый компонент поверх существующего union |
| Персистентность layout | `atoms/panel-stack.ts` (URL `?panels=`), KEYS `panelLayout`/`sidebarVisible`/`sidebarWidth` | LayoutProfile (именованные композиции + пер-слот состояние) | расширение существующих механизмов, новый формат ключа |
| Добавление раздела | 9-шаговый рецепт (types.ts union → routes → links[] → switch → MainContentPanel → panel-stack → i18n ×10 → menu → barrel) | регистрация `PanelContribution`/`SurfaceRegistration`, AppShell не правится | смена механизма (детали — S-02/S-03) |

Нерегрессия: режим **Сессии** в целевой геометрии обязан воспроизводить сегодняшний поток без потерь (список сессий, `ChatPage`, Kanban-board, контекстные меню `SidebarMenu.tsx`) — это критерий волны W1 в [S-09](./09-roadmap-waves.md).

## 4. Границы / что НЕ делаем

- **НЕ вводим второй глобальный shell** — полный запретный список §3.5 обязателен; сводный anti-goal список suite — в [S-10](./10-anti-goals.md).
- **НЕ хардкодим новые разделы в `AppShell.tsx`.** Ни один новый пункт rail/навигатора не добавляется через `links[]`; только реестр.
- **НЕ фиксируем здесь TypeScript-контракты** `PanelContribution`, `SurfaceRegistry`, механику вкладок и сериализацию LayoutProfile — это [S-02](./02-surface-registry-tabs.md) и [S-03](./03-panels-rails.md); здесь только геометрия и наполнение.
- **НЕ трогаем SiYuan runtime/рендер редактора** в волне слотов (W1): editor подключается как surface позже ([S-02](./02-surface-registry-tabs.md), [K-03](../2026-08-07-siyuan-integration/03-knowledge-provider-contract.md)).
- **НЕ удаляем функциональность существующей боковой панели** — перераспределяем её по «режим → раздел»; сокрытие слотов — выбор пользователя/профиля, не потеря возможности.
- **НЕ превращаем status bar в ленту уведомлений** — только агрегированные индикаторы (подключение, sync, runtime, токены, фоновые задачи); интерактивные элементы ограничены переходом к соответствующей поверхности.

## 5. Критерии приёмки

- [ ] Описаны все **5 слотов + status bar** с точными диапазонами ширины (48 / 220–260 / 280–380 / min 640 / 320–420).
- [ ] Зафиксирован принцип «слоты — не обязательные колонки» (§3.1 п.1) и минимальная композиция RAIL+MAIN.
- [ ] Таблица §3.2 покрывает **4 режима** (Сессии/Знания/Исследование/Расширения) и для каждого заполняет NAVIGATOR, COLLECTION, MAIN SURFACE, INSPECTOR, STATUS BAR.
- [ ] Мотивация Activity Rail опирается на реальные items боковой панели и реальные пути (`AppShell.tsx:2530–2730`, `LeftSidebar.tsx`, `SidebarMenu.tsx`), а не на абстракцию.
- [ ] Список «НЕ берём второй shell» (§3.5) содержит **все 8 элементов** исходного документа §2, каждый с маршрутом в Craft.
- [ ] Сравнительная таблица §3.6 связывает каждый целевой слот с существующим кодом (путь + символ) или помечает «новый компонент».
- [ ] Указано, что переключение режимов и вкладок не уничтожает контекст (§3.2, §3.3).
- [ ] Нерегрессия режима Сессии заявлена как критерий W1.

## 6. Открытые вопросы

1. **Финальный набор пунктов RAIL в W1**: полный список `Sessions / Knowledge / Browser / Runs / Agent Studio / Extensions / Settings` или четыре режима этого документа + свёрнутое «Ещё»? Browser и Runs — кандидаты на surface внутри режимов, а не на отдельные пункты rail.
2. **Порядок и иконки rail по умолчанию** и политика переупорядочивания пользователем (drag в rail или только через настройки).
3. **Compact/узкие окна**: `PanelStackContainer.tsx` уже имеет compact-mode stacked transitions — наследуем ли эту механику для сворачивания COLLECTION/NAVIGATOR или вводим отдельные breakpoints слот-модели? Бюджет — в [S-03](./03-panels-rails.md).
4. **Профили компоновки**: поставляем ли все семь (Agent/Knowledge/Research/Review/Browser/Focus/Debug) в W1 или Research/Review/Focus/Debug откладываем за W2+?
5. **Status bar на платформах без нижнего хрома**: если окно сжато ниже min-высоты, переносим индикаторы в top bar или прячем по приоритету?
