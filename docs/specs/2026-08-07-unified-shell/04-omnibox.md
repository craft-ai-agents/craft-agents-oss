# S-04 · Craft Omnibox — единая палитра ⌘K

- **Статус:** draft
- **Дата:** 2026-08-07
- **Входные документы:** «Единая оболочка» (исходный UI-документ интеграции, §4 «Единая глобальная палитра» и §14 «Общий поиск и палитра — разные системы под одним UI»), волна W3 из роадмапа §17; scout-отчёты `scout-AppShell`, `scout-SurfacesBrowser`, `scout-SkillsCloud` (craft-agents main @ 961c1f450).
- **Связанные спецификации:** [S-00 Обзор](./00-overview.md), [S-01 Система слотов](./01-shell-slots.md), [S-02 Реестр поверхностей и вкладки](./02-surface-registry-tabs.md), [S-05 Extension Center](./05-extension-center.md), [S-06 Plugin bridge](./06-plugin-bridge.md), [S-10 Анти-цели](./10-anti-goals.md); suite K: [Knowledge Provider Contract](../2026-08-07-siyuan-integration/03-knowledge-provider-contract.md), [Mutation Safety](../2026-08-07-siyuan-integration/05-mutation-safety.md), [Connection Modes](../2026-08-07-siyuan-integration/07-connection-modes.md).

## 1. Цель

Одна палитра `⌘K` на всё приложение, которая **и показывает, и выполняет**: навигацию по ресурсам Craft/SiYuan, добавление объектов в контекст текущей сессии и команды (Craft native, SiYuan kernel, SiYuan-плагины, расширения, скиллы, автоматизации). Палитра — не «поисковая строка с кнопками», а единый UI поверх двух независимых движков — **Command Registry** и **Resource Provider Registry**, — снабжённых общим **Context Key Service**. Горячие клавиши из любой поверхности, включая embedded SiYuan surface, маршрутизируются в Craft renderer через **Focus Context Bridge**; конфликты аккордов решаются явной приоритетной лестницей и UI в Settings→Keyboard Shortcuts.

Критерий волны W3 (att2 §17): «одна палитра выполняет Craft- и SiYuan-действия».

## 2. Контекст и мотивация

**Палитры в Craft сегодня нет** (grep-verified, scout-AppShell §9). Но инфраструктура, на которую она ложится, существует наполовину:

| Что уже есть | Путь | Что даёт Omnibox |
|---|---|---|
| Реестр действий с хоткеями и when-clauses | `apps/electron/src/renderer/actions/` (`definitions.ts` — плоская карта `{id:'app.newChat', label, description?, defaultHotkey:'mod+n', category, scope?, when?}`; `types.ts` — `ActionDefinition`, `ActionScope='global'|'navigator'|'chat'|'sidebar'`; `registry.tsx` — capture-phase keydown, `mod=⌘/Ctrl`) | Command Registry расширяет этот контракт, а не вводит второй |
| When-выражения (VSCode-lite) | `actions/keybinding-context.ts` — `KeybindingContext{inputFocus, hasSelection, chatFocus, navigatorFocus, sidebarFocus, menuOpen}`, `evaluateWhen()`, синхронный снапшот на keydown через `data-focus-zone` + module-level ref, ноль React re-renders | Образец семантики Context Key Service |
| Страница клавиатурных сокращений | `settings-registry.ts` L51 (`id:'shortcuts'`) → `pages/settings/ShortcutsPage.tsx`, рендерит `actionsByCategory` автоматически | Конфликт-UI строится на существующей странице |
| Mention picker в чате | `components/ui/mention-menu.tsx` — `InlineMentionMenu({open,sections,onSelect,filter,position,workspaceId})`, `useInlineMention`, `MentionItemType='skill'|'source'|'file'|'folder'`; грамматика `[skill:slug]` / `[skill:wsSlug:slug]` / `[source:slug]` в `packages/shared/src/mentions`; подключение в `FreeFormInput.tsx` (~L1005, L1623) | Локальное меню `@`; модель секций/аватаров для Omnibox |
| Embedded-окружение для чужого web-приложения | `BrowserPaneManager.createEmbeddedInstance` — композит из трёх WebContentsView (toolbar+page+overlay), host-surface `BrowserPanelPage.tsx` | Дом для SiYuan surface; источник проблемы маршрутизации ⌘K |
| Capability IPC для агентов | `browser-pane-manager.ts` L2791-2796 `registerCapabilityIpc()` → `ipcMain.handle('__browser:invoke', …)`; `preload/bootstrap.ts` L194-196 `CLIENT_BROWSER_INVOKE` → `ipcRenderer.invoke('__browser:invoke', req)`; `BrowserCapabilityRequest` | Прецедент для бриджа выборки блоков из SiYuan surface |
| Перехват клавиш в main для webContents | `browser-pane-manager.ts` L3767-3779 (`before-input-event` на pageWc/toolbarWc/overlayWc), `window-manager.ts` L436 (перехват `mod+w`) | Техническая основа Focus Context Bridge |
| RPC-неймспейсы всех доменов | `packages/shared/src/protocol/channels.ts`: `sessions`, `cloudRuns`, `notes`, `skills`, `automations`, `sources`, `projects`, `browserPane`, `statuses`, `labels`, `memory`, `fs` … | Data-feeds для провайдеров ресурсов |

**Проблема:** SiYuan привносит собственные `⌘K`-поиск, slash-команды блоков и `@`-ссылки на блоки. Если оставить их «как есть» рядом с поиском Craft, получим две глобальные палитры, два поиска и непредсказуемые клавиши — прямой анти-goal (att2 §18, [S-10](./10-anti-goals.md)). Поиск файлов, сессий, скиллов и источников сегодня размазан по навигаторам и кросс-ссылок между доменами нет (исключение — mentions в чате и `notes/*.md`-линки в `ChatPage.tsx` ~L343-347).

**Мотивация «двух движков под одним UI» (att2 §14):** команды и ресурсы имеют разные модели (команды — точные, исполняемые, с `when` и permissions; ресурсы — нечёткий поиск, превью, `open(ref)`). Слияние их в одну функцию дало бы невозможный контракт; слияние их в один UI над двумя реестрами — нет.

## 3. Решение

### 3.1 Архитектура: один UI → два движка → один контекст

```
                 ⌘K  (Craft renderer | embedded SiYuan surface | browser pane)
                                  │
                    Focus Context Bridge (§3.8)
                                  │
            ┌──────────── Omnibox.tsx (новый компонент) ────────────┐
            │  секции выдачи: НАВИГАЦИЯ / КОНТЕКСТ / ДЕЙСТВИЯ        │
            │  grammar префиксов (§3.3), исключения (§3.4)           │
            └───▲────────────────────────────▲───────────────────────┘
                │ search(query, ctx)          │ evaluateWhen(ctx), execute(ctx)
   ┌────────────┴─────────────┐   ┌───────────┴──────────────┐
   │ ResourceProviderRegistry │   │     CommandRegistry      │
   │ 11 провайдеров (§3.6)    │   │ contributions из 5 типов │
   └────────────▲─────────────┘   │ источников (§3.5)        │
                │                 └───────────▲──────────────┘
                └────────── ContextKeyService (§3.7) ─────────┘
                            packages/core/src/platform/
              {commands/, resources/, context-keys/, input-router/}
```

Размещение (по §16 исходного документа): движки — **новые модули** в существующем `packages/core` (сегодня там только `types/` и `utils/`): `packages/core/src/platform/{commands/,resources/,context-keys/}`. UI — **новый компонент** `apps/electron/src/renderer/platform/Omnibox.tsx`. Main-процесс — **новый модуль** `apps/electron/src/main/global-input-router.ts` (перехват аккордов на embedded webContents). Отдельные пакеты не создаём, пока модули не понадобятся Electron+server+CLI одновременно.

### 3.2 UI палитры

Модальный слой поверх shell (внутри `DismissibleLayerProvider` из дерева провайдеров `App.tsx` ~2108-2117). Три фиксированные секции выдачи:

- **НАВИГАЦИЯ** — результаты Resource Provider Registry с дефолтным действием «открыть» (переход через `navigate(route)` / `NavigationContext`, dedup-фокус по прецеденту `AppShell.tsx` ~L643).
- **КОНТЕКСТ** — вторичные действия над ресурсом: вставить mention в текущий чат (`[skill:slug]`/`[source:slug]`-грамматика + новый `[knowledge:ref]`), attached-surface к сессии, «открыть в новой панели» (прецедент `openInNewPanel` из `useSessionMenuActions.ts`).
- **ДЕЙСТВИЯ** — команды Command Registry, отфильтрованные `when`, сгруппированные по `category`, с бейджем источника (`craft`/`siyuan`/`extension`/`skill`/`automation`) и хоткеем справа.

```
┌─ Omnibox ────────────────────────────────────────────────────────┐
│ > agent memory                                                ⌘K │
├─ НАВИГАЦИЯ ──────────────────────────────────────────────────────┤
│  💬 Session «Memory search design»        сессии · вчера         │
│  📚 Doc «Agent Memory.md»                 knowledge · 12 блоков  │
├─ КОНТЕКСТ ───────────────────────────────────────────────────────┤
│  ➕ Упомянуть «Agent Memory.md» в текущей сессии                 │
├─ ДЕЙСТВИЯ ───────────────────────────────────────────────────────┤
│  ⚡ Research selected blocks               knowledge      ⇧⌘R    │
│  ⚙ Open Cloud Runs settings                 craft          ⌘,    │
└──────────────────────────────────────────────────────────────────┘
 fav 5 · nav ↑↓ · actions → · esc — закрыть
```

Скоринг/фильтрация строк переиспользует модель `mention-menu.tsx` (3/2/1 word-boundary + subsequence fallback), аватары — `SkillAvatar`/`SourceAvatar` и новый `KnowledgeAvatar` (по образцу ItemRow). Пустой ввод: последние элементы по доменам + контекстно-доступные команды текущей поверхности.

### 3.3 Префиксы: грамматика ввода

| Префикс | Режим | Движок и область | Дефолтное действие (Enter) |
|---|---|---|---|
| *(нет)* | Универсальный поиск | Все Resource-провайдеры (§3.6) + команды с совпадением по title/keywords | Открыть первый результат (НАВИГАЦИЯ) |
| `>` | Команды | Только Command Registry (все источники) | Выполнить команду с проверкой `when`+permissions |
| `@` | Ссылки/объекты | Провайдеры `siyuan-docs`, `siyuan-blocks`, `craft-sessions`, `sources` | Открыть; `→` — упомянуть/вставить ссылку |
| `/` | Навыки и агентные действия | Провайдер `skills` + команды `source:"skill"\|"automation"` с `agentAction` | Открыть скилл / назначить на сессию / выполнить действие |
| `#` | Метки | `statuses`/`labels` каналы Craft (существуют в `protocol/channels.ts`) + теги SiYuan через мост (suite K) | Открыть коллекцию по метке (View/Board) |
| `?` | Полнотекстовый поиск | Делегирование: `notes.SEARCH`, FTS ядра SiYuan (suite K), поиск по транскриптам сессий | Открыть поисковую поверхность с результатами |
| `!` | Автоматизации и запуски | Провайдеры `automations` и `cloud-runs` (`automations:get`, `cloudRuns.LIST`) | Триггер/вкл-выкл автоматизации, открыть run |

Префикс считается только первым символом поля ввода палитры. Экранирование — `\>` в начале строки. Смена префикса не теряет уже собранный текст после него (перефильтрация локальная, отмена in-flight запросов через `AbortSignal`).

### 3.4 Локальные меню: таблица исключений

Палитра — `⌘K`. Одиночные символы (`/`, `@`, `?`) в текстовых контекстах **не перехватываются**: локальные меню сохраняются (att2 §4).

| Контекст фокуса | Клавиша | Поведение | Реализация |
|---|---|---|---|
| Редактор SiYuan (embedded surface) | `/` | **Родное меню команд блока SiYuan** — палитра не открывается | Событие живёт внутри webContents поверхности; Craft перехватывает только аккорды с `mod` (§3.8) |
| Редактор SiYuan | `@` | Родные ссылки на блоки (block refs) SiYuan | То же — внутри surface |
| Поле ввода чата (`FreeFormInput.tsx`) | `@` | **Общий mention picker** — существующий `InlineMentionMenu` с секциями skill/source/file/folder + новый тип `knowledge` (расширение `MentionItemType` и грамматики `packages/shared/src/mentions` — `[knowledge:ref]`, resolver + badge по образцу `[source:slug]` → `[Mentioned source: x]`) |
| Поле ввода чата | `/` | Меню навыков Craft — тот же `InlineMentionMenu`, ограниченный `MentionItemType='skill'` (расширение триггера существующего `useInlineMention`) |
| Любой контекст, включая embedded surface | `⌘K` | **Всегда Craft Omnibox** | Перехват в main + форвардинг (§3.8) |

Инвариант: локальные меню существуют только при `inputFocus==true`; палитра — аккорд с `mod`, конфликтов грамматик нет.

### 3.5 Command Registry

Контракт команды (вербатим из att2 §4):

```typescript
interface CommandContribution {
  id: string; title: string; category: string;
  source: "craft"|"siyuan"|"extension"|"skill"|"automation";
  when?: string; keywords?: string[]; defaultHotkey?: string;
  permissions?: string[];
  execute(context: CommandContext): Promise<void>;
}
```

**Миграция существующего реестра.** Текущий `ActionDefinition` (`actions/types.ts`) — строгое подмножество: `id/label/description/defaultHotkey/category/scope/when`. Все записи `actions/definitions.ts` регистрируются как команды `source:"craft"` (title=label; `scope` маппится в частичный `when`: `chat`→`chatFocus`, `navigator`→`navigatorFocus`, `sidebar`→`sidebarFocus`). Диспетчер хоткеев `actions/registry.tsx` (capture-phase keydown по `document`) заменяется исполнителем Command Registry; `ShortcutsPage` продолжает рендерить реестр — теперь через Command Registry API. Чистый переход: никаких параллельных вторых реестров команд.

**When-язык.** Расширение существующего `evaluateWhen()` (`keybinding-context.ts`): к булевым ключам добавляются сравнения и счётчики — `==`, `!=`, `>`, `<`, `&&`, `||`, `!`, `.count` над массивными ключами. Семантика сохранена: выражение чистое, вычисляется синхронно над снапшотом Context Key Service в момент keydown/открытия палитры, без React-состояния.

**Permissions.** `permissions?: string[]` использует словарь `ExtensionPermission` из att2 §7 (`knowledge.read/write/delete`, `sessions.read/create/update`, `browser.open/read/automate`, `network.request`, …). Проверка — единый permission gate при `execute()`, согласованный с режимом `PermissionModes` (`explore`/`ask`/`execute`, `packages/shared/src/agent/mode-types.ts`) и слоями `permissions.json` (`packages/shared/src/agent/permissions-config.ts`) — модель «`knowledge.*` capability = шаблоны/правила в per-source permissions» из scout-SkillsCloud. Мутирующие команды знаний дополнительно проходят контур записи suite K ([05-mutation-safety](../2026-08-07-siyuan-integration/05-mutation-safety.md)).

**Маршрут исполнения** (att2 §4): `execute()` получает `CommandContext` (снапшот ключей + сервисные хендлы) и делегирует по цели: Craft native → существующие RPC (`RPC_CHANNELS` через `transport/channel-map.ts`); SiYuan kernel → мост suite K; SiYuan plugin → адаптер [S-06](./06-plugin-bridge.md); расширение → Extension Host ([S-05](./05-extension-center.md)); skill/automation → назначение на сессию / `automations:test`.

**Пример (вербатимная спецификация из att2 §4, развёрнутая):**

```typescript
{
  id: "knowledge.research-selected-blocks",
  title: "Research selected blocks",
  category: "Knowledge",
  source: "craft",
  when: "activeSurface=='knowledge' && selectedBlocks.count>0 && agent.available==true",
  keywords: ["исследовать", "research", "проверить"],
  defaultHotkey: undefined, // назначается пользователем
  permissions: ["knowledge.read", "sessions.create", "browser.navigate"],
  async execute(ctx) {
    // 1. selectedBlocks[] — snapshot из Context Key Service (заполнен через Focus Context Bridge, §3.8).
    // 2. Собрать RunSpec: buildResearchSpec (packages/cloud-runner/src/research-pack.ts) из текстов блоков.
    // 3. RPC_CHANNELS.cloudRuns.SUBMIT (packages/server-core/src/handlers/rpc/cloud-runs.ts).
    // 4. Навигация на поверхность запуска (S-02): navigate(routes.view.cloudRun(runId), {newPanel:false}).
  },
}
```

### 3.6 Resource Provider Registry

Контракт провайдера (вербатим из att2 §14) + опорные типы (новые):

```typescript
interface ResourceProvider {
  id: string; kinds: string[];
  search(query: string, context: SearchContext): Promise<ResourceSearchResult[]>;
  open(ref: ResourceRef): Promise<void>;
  getActions?(ref: ResourceRef, context: SearchContext): Promise<CommandContribution[]>;
}

interface ResourceRef { providerId: string; kind: string; id: string }
interface SearchContext { keys: ContextKeySnapshot; signal: AbortSignal; limit: number }
interface ResourceSearchResult {
  ref: ResourceRef; title: string; subtitle?: string; icon?: string;
  score: number; preview?: string;   // preview — сниппет совпадения
}
```

**Слияние выдачи:** выдача никогда не «склеивается плоско» — каждый провайдер образует подсекцию. Правила: per-provider топ-N (N=5 по умолчанию), нормализация `score` в [0,1] внутри провайдера, секционный вес провайдера по mode (`/` поднимает `skills`, `!` — `automations`+`cloud-runs`), progressive rendering (секции дорисовываются по мере resolve; `signal` отменяет хвосты), debounce 150 мс. `getActions?` наполняет секцию КОНТЕКСТ/подменю `→` выбранной строки (типовые: «открыть в новой панели» — прецедент `SessionItem` middle-click и `useSessionMenuActions.openInNewPanel`; «упомянуть»; «раскрыть в навигаторе»; для runs — Share по прецеденту `cloudRuns.SHARE`).

**Провайдеры (11).** Каждый прибит к существующему коду; «новый компонент» отмечен явно.

| Провайдер | kinds | Источник данных (существующее) | `open(ref)` |
|---|---|---|---|
| `craft-sessions` | session | `RPC_CHANNELS.sessions` (list); фильтр по заголовку клиентски | `routes.view.session(id)`; dedup-фокус по `parseSessionIdFromRoute` |
| `siyuan-docs` | knowledge-doc | Поиск документов через мост ядра (suite K, [03-контракт](../2026-08-07-siyuan-integration/03-knowledge-provider-contract.md)) | Knowledge surface route (S-02) |
| `siyuan-blocks` | knowledge-block | Поиск блоков ядра SiYuan через мост (suite K) | Документ + якорь блока в knowledge surface |
| `cloud-runs` | cloud-run | `RPC_CHANNELS.cloudRuns.LIST` / `GET_STATUS` | Run surface (вкладка `cloud-run`, S-02) |
| `skills` | skill | `RPC_CHANNELS.skills.GET`; уровни `loadAllSkills` (`packages/shared/src/skills/storage.ts`) | `SkillInfoPage` route |
| `automations` | automation | `automations:get`; действия: `SET_ENABLED`/`TEST` | `AutomationInfoPage` route |
| `sources` | source | `sources:get` (lazy `ensureNotesSource` — прецедент managed source для SiYuan, suite K) | `SourceInfoPage` route |
| `browser-history` | browser-tab, browser-history | Живые вкладки: `atoms/browser-pane.ts` (map инстансов); журнал посещений — **новый компонент** (append-only лог в main рядом с `BrowserPaneManager`; CDP History не используем) | Фокус/создание embedded instance + navigate |
| `extensions` | extension | Реестр Extension Center (**новый**, W5, [S-05](./05-extension-center.md)) — до W5 возвращает пусто | Страница расширения |
| `projects` | project | `RPC_CHANNELS.projects` | `ProjectInfoPage` route |
| `files` | file | `electronAPI.searchFiles(basePath, query)` — прецедент из mention-потока (`types.ts` L506, `FreeFormInput.tsx`) | Reveal / вставка file-mention |

**Пример объединённой выдачи «agent memory»** (att2 §14):

```
agent memory
├─ SESSIONS    💬 «Memory search design»        вчера · 42 сообщения
├─ KNOWLEDGE   📚 «Agent Memory.md»             notebook Research · 12 блоков
│              ▦  блок «episodic vs semantic»   Agent Memory.md:143
├─ SKILLS      🧠 memory-search (workspace)     [skill:memory-search]
└─ RUNS        ☁ Run #142 «memory landscape»    done · 5 артефактов
```

### 3.7 Context Key Service

**Новый модуль** `packages/core/src/platform/context-keys/`. Принцип — тот же, что в `keybinding-context.ts`: провайдеры ключей обновляют module-level ref по событиям (focusin, jotai subscribe, IPC push), выражения вычисляются над синхронным снапшотом в момент keydown/открытия палитры. Ноль подписок React → ноль re-renders.

| Ключ | Тип | Откуда берётся (существующее → новое) |
|---|---|---|
| `activeWorkspace` | string | `NavigationProvider(workspaceId, workspaceSlug)` (`App.tsx` ~2108) → публикация из `NavigationContext.tsx` |
| `activeSurface` | enum | Фокусированная панель: route из `panelStackAtom` + `updateFocusedPanelRouteAtom`, классификация через `is*Navigation`-гарды `route-parser.ts`; `isFocusedPanel` из `PanelSlot.tsx` |
| `activeSession` | string? | `focusedSessionIdAtom` / `parseSessionIdFromRoute` (`atoms/panel-stack.ts`) |
| `activeDocument` | KnowledgeRef? | **Новый ключ**: маршрут knowledge surface в фокусированной панели (S-02); публикует SiYuan-адаптер suite K |
| `selectedBlocks[]` | BlockRef[] | **Новый ключ**: запрос через Focus Context Bridge (§3.8) в момент открытия палитры; кэш до закрытия палитры |
| `selectedText` | string | Renderer: `window.getSelection()` (булев прецедент — `hasSelection` в `keybinding-context.ts`); из embedded surface — через bridge |
| `activeBrowserTab` | {instanceId,url}? | `atoms/browser-pane.ts` (map инстансов, tombstones) + видимые поверхности S-02 |
| `permissionMode` | 'explore'\|'ask'\|'execute' | `mode-types.ts` `PermissionModes`; текущее значение из настроек сессии/приложения |
| `focusedPanel` | panelId | `panelStackAtom` + фокус-зоны `FocusContext` (`data-focus-zone`, `_currentZone` в `keybinding-context.ts`) |

Провайдеры ключей регистрируются (`ContextKeyProvider { keys, pull(): Partial<Snapshot> }`): siyuan-адаптер и extension-host публикуют свои ключи через тот же API — иначе `when` у их команд не вычислить.

### 3.8 Focus Context Bridge

**Проблема.** SiYuan surface — это `pageView` (sandboxed WebContentsView), скомпонованный `BrowserPaneManager.createEmbeddedInstance` (перспективный generic — `EmbeddedWebSurfaceManager`, S-02). Keydown внутри него не достигает DOM-слушателя `actions/registry.tsx` в Craft renderer.

**Шаг 1 — захват аккорда (main).** `global-input-router.ts` (**новый компонент**) подписывается на `before-input-event` каждого embedded `webContents` — точный прецедент: `browser-pane-manager.ts` L3767-3779 (обработчики на pageWc/toolbarWc/overlayWc для lockState) и `window-manager.ts` L436 (перехват `mod+w` на `window.webContents`). На совпадении с глобальным аккордом палитры (`mod+k`) — `event.preventDefault()` и форвардинг в Craft renderer: `hostWindow.webContents.send('omnibox:open', { originSurfaceId })`; preload маппирует событие в открытие Omnibox (тот же путь, что `NAVIGATE_EVENT`-слушатель в `NavigationContext.tsx`). Только аккорды с `mod`; одиночные `/`, `@` не трогаем (§3.4). Список форвардимых аккордов — push из renderer по IPC `omnibox:update-chords` от Command Registry (scope `global`).

**Шаг 2 — обратный поток контекста.** Новый capability-канал `__surface:invoke` по образцу `__browser:invoke`: `registerCapabilityIpc()` (`browser-pane-manager.ts` L2791-2796: `ipcMain.handle('__browser:invoke', (_e, req) => dispatchCapability(req))`) и preload-мост `client.handleCapability(CLIENT_BROWSER_INVOKE, …)` в `bootstrap.ts` L194-196. Обобщение: `SurfaceCapabilityRequest{instanceId, capability, args}` → dispatch в main по `instanceId` → для SiYuan surface — в адаптер suite K, который читает выделение блоков через page-side скрипт (preload embedded instance, `contextIsolation`) и/или kernel API. Результат — structured-clone-safe (урок L2862-2866: нельзя шиповать Electron native references через IPC — пропускать через sanitize-хелпер).

**Шаг 3 — маршрут исполнения** (att2 §4): палитра выбирает цель выполнения — `Craft native | SiYuan kernel | SiYuan plugin | Craft extension | Skill | Automation`.

```
embedded SiYuan pageView            main                Craft renderer
        │keyDown ⌘K                   │                      │
        │──before-input-event────────▶│                      │
        │                             │──send('omnibox:open')▶│── open Omnibox
        │                             │                      │── bridge.pull(selectedBlocks)
        │                             │◀─__surface:invoke────│
        │◀── adapter query (page js)──│                      │
        │──blocks[]──────────────────▶│──clone-safe result──▶│── ctx.selectedBlocks
        │                             │                      │── execute() → RPC → цель
```

**Деградация:** surface офлайн (режимы suite K, [07-connection-modes](../2026-08-07-siyuan-integration/07-connection-modes.md)) → ключи `selectedBlocks`/`activeDocument` пустеют, `when` скрывает knowledge-команды, провайдеры `siyuan-*` возвращают пусто; в футере палитры — строка состояния подключения.

### 3.9 Конфликты горячих клавиш

**Приоритетная лестница (1→6, att2 §4):** 1) пользовательское назначение; 2) команда текущей поверхности; 3) Craft native; 4) установленное расширение; 5) SiYuan plugin; 6) системный fallback.

**Разрешение:** нормализованный аккорд индексируется по `when`-домену (набор ключей и значений). Диспетчер собирает кандидатов, чей `when` истинен в текущем снапшоте, и берёт минимальный тир. Ничья внутри тира = конфликт.

**Детекция:** при регистрации и на старте строится chord-index; пары с одинаковым аккордом и **пересекающимися** доменами (по `source`-тиру и набору `when`-ключей; неизвестное пересечение ⇒ считать конфликтом) попадают в реестр конфликтов. Молча победителя не выбираем (att2 §4).

**UI — Settings→Keyboard Shortcuts.** Существующая страница (`settings-registry.ts` L51 `id:'shortcuts'` → `ShortcutsPage.tsx`, сегодня рендерит `actionsByCategory`) расширяется: группировка по `source`, колонка hotkey с inline-переназначением, бейдж конфликта (список претендентов + их тиры), кнопка «сбросить к умолчанию». **Персистентность пользовательских назначений — новое поведение:** `userOverrides` в `actions/registry.tsx` сегодня in-memory («future»); переносим в `lib/local-storage.ts` KEYS registry (ключ `craft-keybindings`, без суффикса workspace). Тир 1 лестницы читается отсюда.

## 4. Границы / что НЕ делаем

- НЕ две глобальные палитры и НЕ две системы поиска ([S-10](./10-anti-goals.md)); вторая палитра SiYuan внутри редактора остаётся только как локальное slash-меню блоков.
- НЕ перехват одиночных символов (`/`, `@`, `?`) из embedded surfaces — только аккорды с `mod` (иначе ломаем ввод текста).
- НЕ OS-wide `globalShortcut` Electron — палитра работает внутри окна приложения.
- НЕ собственный полнотекстовый индекс в палитре: `?` делегирует `notes.SEARCH` / FTS ядра SiYuan.
- НЕ исполнение команд без permission gate; расширения не получают raw secrets — временная capability через broker (att2 §7, [S-06](./06-plugin-bridge.md)).
- НЕ замена `shared/menu-schema.ts`: нативные и React-меню остаются, но читают тот же Command Registry (один источник истины).
- НЕ переписывание `InlineMentionMenu` — только расширение типа `knowledge` и триггера `/`.
- НЕ параллельный «новый» реестр команд рядом со старым `actions/` — только миграция (clean cutover).

## 5. Критерии приёмки

- [ ] `⌘K` из Craft renderer, из embedded SiYuan surface и из browser pane открывает один и тот же Omnibox; попутное событие в surface подавлено (`preventDefault`), повторного срабатывания внутри страницы нет.
- [ ] Выдача имеет секции НАВИГАЦИЯ/КОНТЕКСТ/ДЕЙСТВИЯ; запрос «agent memory» возвращает сгруппированные секции SESSIONS/KNOWLEDGE/SKILLS/RUNS минимум от четырёх живых провайдеров.
- [ ] Все записи `actions/definitions.ts` исполняются через Command Registry; существующие хоткеи (`mod+n`, `mod+f`, `mod+,` и пр.) работают без регрессий.
- [ ] `knowledge.research-selected-blocks` виден в палитре ровно при `activeSurface=='knowledge' && selectedBlocks.count>0`; `execute` создаёт cloud run (`cloudRuns.SUBMIT`) и открывает его поверхность; при `permissionMode=='ask'` показывается подтверждение.
- [ ] Все семь префиксов ведут себя по таблице §3.3; исключения §3.4 соблюдены: `/` в редакторе SiYuan → block menu; `/` в чате → меню скиллов; `@` в чате → `InlineMentionMenu` с типами skill/source/file/folder/**knowledge** и грамматикой `[knowledge:ref]`.
- [ ] Context Key Service покрывает все девять ключей таблицы §3.7; `evaluateWhen` — синхронный снапшот без re-render; siyuan-адаптер публикует `activeDocument`/`selectedBlocks` через тот же API.
- [ ] Лестница §3.9: пользовательское назначение побеждает Craft native; команда поверхности — глобальную экстент-и-plugin команды по тирам; конфликт одного тира виден бейджем в Settings→Keyboard Shortcuts, победитель молча не выбирается; назначения переживают перезапуск.
- [ ] Команды с `permissions` без соответствующего capability не исполняются (запрет механический, не UI-only).

## 6. Открытые вопросы

1. Асинхронные ключи (`agent.available`, статус синка) — push-публикация от адаптера против pull-снапшота при открытии палитры; допустимая задержка устаревания.
2. Ранжирование между провайдерами: статические секционные веса против frecency-профиля (и где его хранить).
3. Лимиты и отмена для медленного ядра SiYuan: таймаут провайдера, частичная выдача, ретрай.
4. Журнал визитов для `browser-history`: собственный append-only лог в main против CDP History domain (приватность, объём, очистка).
5. Remote-режим: какие провайдеры исполняются на удалённом server-core (`remote`-каналы), а какие клиентски; палитра для веб-клиента без Electron-main.
6. Семантика `#` для тегов SiYuan: теги ядра read-only в палитре или допускают assignment через конверт S-08 / envelope suite K.
