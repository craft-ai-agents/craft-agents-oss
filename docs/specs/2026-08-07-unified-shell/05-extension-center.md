# S-05. Extension Center: единый каталог расширений поверх множественных runtimes

> **Doc id:** S-05 · **Статус:** draft · **Дата:** 2026-08-07
> **Входные документы:** att2 «Единая оболочка» §5 (плагинная система), §7 (Extension API), §8 (где исполнять плагины), §12 (единый marketplace); [S-01 Слоты оболочки](./01-shell-slots.md); [S-02 Surface Registry и вкладки](./02-surface-registry-tabs.md); [S-03 Панели и rails](./03-panels-rails.md); [S-04 Omnibox](./04-omnibox.md); [S-06 Plugin Bridge](./06-plugin-bridge.md); [K-03 Knowledge Provider Contract](../2026-08-07-siyuan-integration/03-knowledge-provider-contract.md); [K-08 Licensing](../2026-08-07-siyuan-integration/08-licensing.md)
> **Grounding:** packages/shared/src/marketplace/{catalog,installer,lock}.ts; packages/shared/src/agent/{permissions-config,mode-types}.ts; packages/shared/src/skills/; packages/shared/src/sources/; packages/shared/src/automations/; packages/shared/src/credentials/; apps/electron/src/shared/settings-registry.ts; apps/electron/src/main/browser-pane-manager.ts

---

## 1. Цель

Один Extension Center — единая точка обнаружения, установки, настройки и удаления ВСЕХ расширений Craft — поверх НЕСКОЛЬКИХ изолированных runtimes исполнения. Пользователь видит один каталог с фильтрами; система честно исполняет каждый тип расширения там, где он должен исполняться: доверенный код — в Craft, сторонний UI — в песочнице, SiYuan-плагины — внутри SiYuan runtime, MCP-серверы — в server-core.

Принцип-девиз: **«один каталог ≠ один runtime»**.

## 2. Контекст и мотивация

Сегодня «расширяемость» Craft размазана по несвязанным сущностям:

- **Skills** — директории `{slug}/SKILL.md` с YAML-frontmatter, tiers `project .agents/skills > workspace > global ~/.agents/skills`, модель `SkillMetadata` (packages/shared/src/skills/types.ts), RPC `skills.*` (packages/server-core/src/handlers/rpc/skills.ts).
- **Sources** — папки `{workspace}/sources/{slug}/config.json`, `SourceType mcp|api|local` (packages/shared/src/sources/types.ts), credentials через `SourceCredentialManager` с ключами `{type}::{scope}` (packages/shared/src/credentials/manager.ts).
- **Automations** — событийная шина: триггеры `AppEvent/AgentEvent/cron`, действия `PromptAction/WebhookAction` (packages/shared/src/automations/types.ts, automation-system.ts).
- **Marketplace** — курируемый каталог `MarketplaceEntry{id, kind:'skillpack'|'tool'|'context-doc', source:{github repo+pinned 40-hex SHA}}` с ETag/24h-кэшем и fail-closed валидацией (packages/shared/src/marketplace/catalog.ts, installer.ts, lock.ts).
- **SiYuan Bazaar** появляется с интеграцией SiYuan — третий «магазин».

Если склеить это в один runtime, мы получим либо исполнение стороннего кода в Electron main (запрещено, att2 §18), либо вырезание SiYuan-плагинов (запрещено, [S-06 Plugin Bridge](./06-plugin-bridge.md)). Поэтому объединяем **каталог, точки расширения и модель разрешений** — и осознанно НЕ объединяем способы исполнения.

Существующий permissions engine уже слоистый: bundled default `~/.craft-agent/permissions/default.json` < workspace `permissions.json` < per-source `sources/{slug}/permissions.json`, аддитивное слияние (packages/shared/src/agent/permissions-config.ts), zod-схема в mode-types.ts. Это естественный дом для разрешений расширений — новая сущность «extension» просто получает свой слой, а не свою систему безопасности.

## 3. Решение

### 3.1. Федерация каталогов, один UI

```
┌──────────────────────── EXTENSION CENTER (renderer) ─────────────────────────┐
│  Filter: All | Apps | Knowledge | Skills | Sources | Automations |           │
│          Agent runtimes | Themes                                             │
├──────────────────────────┬──────────────────────────┬────────────────────────┤
│  PROVIDERS (fan-in)      │  INSTALLED (workspace)   │  UPDATES / PERMS       │
│  • Craft curated catalog │  • все runtime-типы      │  • diff разрешений     │
│    (существующий         │  • enable/disable        │  • developer mode      │
│     marketplace/catalog) │  • per-workspace         │  • registries          │
│  • SiYuan Bazaar         │    visibility            │                        │
│  • Локальные папки/URL   │                          │                        │
└──────────────────────────┴──────────────────────────┴────────────────────────┘
```

Провайдер каталога — интерфейс, а не жёсткий список:

```typescript
interface CatalogProvider {                       // новый компонент
  id: "craft-curated" | "siyuan-bazaar" | "local" | "url";
  list(filter: CatalogFilter): Promise<CatalogEntry[]>;
  fetch(id: string, version: string): Promise<ExtensionPackage>;
  // craft-curated переиспользует packages/shared/src/marketplace/catalog.ts
  // (pinned SHA, ETag+24h кэш, fail-closed валидация метаданных)
}
```

`CatalogEntry` нормализует поля всех провайдеров к виду карточки (§3.6). Установленные записи всех типов — единый `ExtensionRecord` (§3.4), физически лежат в провайдер-специфичных хранилищах (skills — в tiers-директориях, sources — в `sources/{slug}/`, и т.д.): Extension Center — проекция, а не новая схема хранения.

### 3.2. Категории каталога

| Категория | Что сюда попадает | runtime по умолчанию |
|---|---|---|
| Apps | полноценные поверхности: dashboards, инструменты с собственным UI | `web-widget`, `craft-sandbox` |
| Knowledge | коннекторы баз знаний, в т.ч. SiYuan provider и его расширения | `siyuan-plugin`, `mcp-source` |
| Skills | skill-пакеты (инструкции, шаблоны, процедуры) | `skill-pack` |
| Sources | MCP/API/local подключения данных и инструментов | `mcp-source` |
| Automations | пакеты триггеров и действий | `automation-pack` |
| Agent runtimes | исполнители агентов: OMP, Hermes, Pi и прочие | `agent-runtime` |
| Themes | темы оболочки | `craft-native` |

Фильтр `All` — смешанная лента с бейджами категории и runtime. Категория — презентационная оси; runtime — исполнительная. Одна категория может содержать разные runtime (Knowledge: SiYuan Bazaar-плагины и MCP-коннекторы), и карточка обязана это показывать.

### 3.3. Типы runtime (8) — таблица

| runtime | Кто исполняет и где | Уровень доверия | Примеры |
|---|---|---|---|
| `craft-native` | код в репозитории Craft, прошедший ревью; исполняется в main/renderer как first-party | полное (наш код) | встроенные темы, Activity Rail items ядра |
| `craft-sandbox` | сторонний JS/TS в **Extension Host** — отдельном процессе (§3.5) | песочница + permissions | сторонние панели, агентные действия |
| `siyuan-plugin` | внутри SiYuan runtime (kernel + editor bundle); НЕ в Electron main, НЕ в Extension Host | SiYuan runtime + bridge-проекция (см. [S-06](./06-plugin-bridge.md)) | плагины Bazaar |
| `mcp-source` | MCP/API серверы, запущенные через `SourceServerBuilder` в server-core (существует) | layered permissions sources/{slug}/permissions.json | MCP tools, внешние API |
| `skill-pack` | без кода: документы SKILL.md читаются агентом при активации (существует) | набор файлов + `alwaysAllow`/`requiredSources` | пакеты навыков |
| `automation-pack` | декларативные триггеры/действия в automation engine server-core (существует) | `automation.register` + per-action permissions | webhook→prompt цепочки |
| `web-widget` | ТОЛЬКО sandboxed webContents (§3.5), без backend-кода | изоляция UI + typed bridge | виджеты статуса, дешборды |
| `agent-runtime` | внешний процесс-исполнитель со своим супервизором (паттерн CloudRunProvider, packages/cloud-runner/src/types.ts) | изоляция процесса + run-limits | OMP, Hermes, Pi |

Ключевые следствия таблицы:
- `siyuan-plugin` НЕ «подчиняется» Extension Host: он исполняется в SiYuan runtime, а Craft проецирует его вклады через bridge (детали — [S-06](./06-plugin-bridge.md), §4).
- `mcp-source`, `skill-pack`, `automation-pack` — «runtime» в номенклатурном смысле: существующие модели Sources/Skills/Automations уже исполняются сегодня, Extension Center лишь показывает их карточками (§3.8).
- Добавление 9-го runtime = явное изменение этой таблицы + manifest schema. Скрытых runtimes нет.

### 3.4. Контракт: ExtensionManifest

Базовая форма (verbatim из att2 §7 — каноническая):

```typescript
interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  runtime:
    | "craft-native" | "craft-sandbox" | "siyuan-plugin" | "mcp-source"
    | "skill-pack" | "automation-pack" | "web-widget" | "agent-runtime";
  activationEvents?: string[];
  permissions: ExtensionPermission[];
  contributes?: {
    commands?;
    activityItems?;
    panels?;
    surfaces?;
    menus?;
    settings?;
    skills?;
    automationTriggers?;
    automationActions?;
    agentActions?;
  };
}
```

Развёрнутая форма с типизированными contributes (схема zod, «новый компонент» `packages/shared/src/extensions/manifest-schema.ts`; имена полей и состав — как в базовой форме, добавлены только типы значений и два сервисных поля):

```typescript
interface ExtensionManifestFull extends ExtensionManifest {
  engines?: { craft?: string };              // semver-диапазон совместимой версии Craft
  dependencies?: string[];                   // id других расширений / source slugs
                                             // (прецедент: SkillMetadata.requiredSources)
  contributes?: {
    commands?: CommandContribution[];        // id,title,category,when?,defaultHotkey?
                                             // форма = apps/electron/src/renderer/actions/definitions.ts
    activityItems?: ActivityItemContribution[]; // id,title,icon,order? → Activity Rail (S-01)
    panels?: PanelContribution[];            // id,title,icon,slot,when?,defaultVisible?,resizable?
                                             // PanelSlot из S-01/S-03
    surfaces?: SurfaceContribution[];        // kind,title,icon,mount → SurfaceTab (S-02)
    menus?: MenuContribution[];              // location (activity|navigator|surface|editor|block|tab),
                                             // commandId, when? — when-семантика = keybinding-context.ts
    settings?: SettingsContribution[];       // ключи плагина → страница настроек расширения
    skills?: SkillPackContribution[];        // {slug} → materials skills tier (packages/shared/src/skills)
    automationTriggers?: AutomationTriggerContribution[]; // matcher-конфиги, совместимые с
                                             // packages/shared/src/automations/types.ts
    automationActions?: AutomationActionContribution[];   // PromptAction/WebhookAction-совместимые
    agentActions?: AgentActionContribution[];             // инструменты агента: id,title,description,
                                             // inputSchema(JSON Schema), permissions[]
  };
}
```

Правила схемы:
- **Fail-closed** (по примеру `MarketplaceEntry` в catalog.ts): неизвестный `runtime`, неизвестное имя разрешения в `permissions`, неизвестный ключ внутри `contributes` → манифест отвергается целиком с диагностикой, частичной регистрации нет.
- `activationEvents` — ленивая активация: `onCommand:<id>`, `onSurface:<kind>`, `onStartup`, `onWorkspaceOpen`. Пустой массив = активация при установке.
- Манифесты всех runtime-типов валидируются ОДНОЙ схемой; адаптеры (§3.8) генерируют синтетический манифест для существующих сущностей, чтобы весь UI/permissions-контур видел один тип.

### 3.4.1. Четырнадцать точек расширения оболочки

`contributes.*` манифеста проецируются на ровно эти 14 точек (детальная геометрия слотов — [S-01](./01-shell-slots.md), [S-03](./03-panels-rails.md); палитра — [S-04](./04-omnibox.md)):

1. **Activity Rail** — `activityItems`: иконка режима в левом rail 48px.
2. **Navigator** — `panels` (slot `navigator-primary`/`navigator-secondary`): деревья и списки второго уровня.
3. **Collection Views** — `panels`/`surfaces` для коллекций (Needs Review, Favorites, виртуальные выборки).
4. **Main Surfaces** — `surfaces`: новый `SurfaceTab.kind` (шаблон `extension`-вкладки из S-02).
5. **Inspector** — `panels` (slot `inspector`): вкладки правого инспектора.
6. **Bottom Panel** — `panels` (slot `bottom`): консоли, логи, инструменты.
7. **Status Bar** — `menus`/статус-элементы slot `status` (прецедент: ToolbarStatusSlot как единственная status-поверхность сегодня).
8. **Command Palette** — `commands`: команды с `when`, `defaultHotkey`, `category` (форма = существующий action registry в apps/electron/src/renderer/actions/definitions.ts).
9. **Context Menus** — `menus`: контекстные действия editor/tree/dock/block/tab с `when`-семантикой keybinding-context.ts.
10. **Mention Picker** — вклад в mention-источники (прецедент: MentionItemType union в components/ui/mention-menu.tsx, новые типы добавляются расширяемо).
11. **Agent Tools** — `agentActions`: инструменты, доступные Craft-агенту (id, description, inputSchema, permissions).
12. **Automation Triggers** — `automationTriggers`: matcher-конфиги, совместимые с типами packages/shared/src/automations/types.ts.
13. **Automation Actions** — `automationActions`: действия, совместимые с PromptAction/WebhookAction.
14. **Settings** — `settings`: ключи настроек расширения на его странице (Settings → Extensions → <name>).

Точка 15 появляется только через изменение этого списка + схемы; манифест с неизвестной точкой отвергается fail-closed.

### 3.5. Extension Host: изоляция исполнения

Диаграмма контуров доверия:

```
┌─ Electron main (trusted, first-party) ────────────────────────────────────┐
│ Extension Host Manager            (новый компонент:                        │
│  apps/electron/src/main/extension-host-manager.ts)                        │
│   • spawn/restart/monitor                                                 │
│   • capability broker: единственный держатель CredentialManager           │
│     (packages/shared/src/credentials/manager.ts остаётся в main)          │
│   • resource limits: CPU/mem/wall-clock на вызов                          │
└───────┬──────────────────────────────────────────────────────┬───────────┘
        │ typed JSON-RPC (MessagePort; конверт capability)      │ typed JSON-RPC
        ▼                                                       ▼
┌─ Extension Host (utilityProcess, 1 на workspace) ─┐   ┌─ UI runtime: sandboxed ──┐
│  craft-sandbox extensions                         │   │  BrowserView/webContents  │
│  • НЕТ raw secrets: только scoped tokens          │   │  • contextIsolation: true │
│  • НЕТ nodeIntegration                            │   │  • nodeIntegration: false │
│  • permission check на КАЖДЫЙ inbound call        │   │  • CSP (жёсткий meta)     │
│  • crash → Supervisor: пометить degraded,         │   │  • partition persist:     │
│    баннер в Extension Center; main/сессии/        │   │    ext-<id>               │
│    browser/другие workspaces НЕ роняются          │   │  • typed preload bridge:  │
└───────────────────────────────────────────────────┘   │    только whitelisted     │
                                                        │    методы + capability    │
│  SiYuan runtime (kernel :6806 + editor bundle)      │    checks (прецедент:      │
│  └─ siyuan-plugin extensions  → см. [S-06]          │    preload/browser-toolbar │
│                                                     │    + __browser:invoke)      │
└─ MCP/API sources: server-core (существует) ─────────┴───────────────────────────┘
```

Решения изоляции:
1. **Отдельный процесс.** Extension Host — Electron `utilityProcess` (bun/node fork), один на workspace (не один на расширение: плотность процессов контролируется, а граница доверия — workspace). RPC-конверт по образцу `RpcServer/RpcClient` из packages/server-core/src/transport/types.ts: `handle(channel, fn)`, типизированные каналы регистрируются в общем цикле channels.ts + routing.ts (обязательная классификация LOCAL_ONLY/REMOTE_ELIGIBLE).
2. **No raw secrets.** В Extension Host физически не попадают API-ключи и `process.env` main. Доступ к секрету = вызов брокера: main выдаёт **временный scoped capability-token** (напр. 15 мин, метод+endpoint), которым host ходит в egress-proxy main. `SecureStorageBackend` остаётся недоступным из host по построению (другой процесс, нет handle).
3. **Resource limits.** На каждый RPC-вызов — wall-clock timeout; на процесс — CPU/mem наблюдение, при превышении: throttle → kill → restart по политике (аналог RunLimits из packages/cloud-runner/src/types.ts: `maxWallClockSec` и т.п.).
4. **Crash isolation.** Смерть host НЕ роняет Craft main, открытые сессии, browser panes, server-core, другие workspaces. UI показывает состояние `degraded` на карточках затронутых расширений; команды таких расширений в палитре дают ошибку «расширение перезапускается».
5. **Sandboxed renderer для UI.** Сторонний UI (craft-sandbox panels/surfaces, web-widget) рендерится в отдельном webContents: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, собственная session-partition `persist:ext-<extensionId>`, строгая CSP, typed preload-bridge с capability checks при каждом IPC. Прецедент композитного webContents-хостинга в кодовой базе: `BrowserPaneManager.createEmbeddedInstance` (apps/electron/src/main/browser-pane-manager.ts: toolbar+page+overlay, partition `persist:browser-pane`) и preload-мост `__browser:invoke` (apps/electron/src/preload/bootstrap.ts).
6. **siyuan-plugin вне Extension Host** — их исполнение и изоляция описаны в [S-06](./06-plugin-bridge.md) §2; здесь важно только, что их Craft-сторона (registry entries, commands) проходит те же permission checks.

### 3.6. Permission vocabulary и маппинг на существующий engine

Полный словарь разрешений (zod union, «новый компонент» `packages/shared/src/extensions/permissions.ts`):

```typescript
type ExtensionPermission =
  | "knowledge.read" | "knowledge.write" | "knowledge.delete"
  | "sessions.read" | "sessions.create" | "sessions.update"
  | "browser.open" | "browser.read" | "browser.automate"
  | "filesystem.read" | "filesystem.write"
  | "network.request" | "shell.execute"
  | "automation.register"
  | "ui.panel" | "ui.command"
  | `secrets.use:${string}`;              // secrets.use:<credential-id>
```

Маппинг на существующую layered permissions engine (поля `PermissionsConfigSchema` mode-types.ts: `blockedTools`, `allowedBashPatterns`, `allowedApiEndpoints`, `readOnlyMcpPatterns`, `allowedWritePaths`; режимы `explore|ask|execute`):

| Разрешение | Точка enforcement | Маппинг на permissions engine |
|---|---|---|
| `knowledge.read` | server-core `knowledge.*` RPC (blueprint — notes.ts) | read-инструменты совпадают с `readOnlyMcpPatterns` → доступны даже в `explore`; запрет = `blockedTools` на knowledge-инструменты |
| `knowledge.write` / `knowledge.delete` | тот же канал, ветка записи | вне read-only паттернов: `explore` → блок, `ask` → диалог, `execute` → allow; per-source слой `sources/{slug}/permissions.json` |
| `sessions.read/create/update` | server-core session RPC (SessionManager) | capability проверяется при регистрации манифеста; agent-tool путь дополнительно гейтится `blockedTools` |
| `browser.open/read/automate` | main `browserPane.*` IPC (handlers/browser.ts; CREATE_EMBEDDED уже штампует workspaceId) | capability check на каждом IPC; `browser.automate` (CDP) — отдельное, явно подсвечивается при установке |
| `filesystem.read/write` | agent tools Read/Write/Edit | `allowedWritePaths` (write); read вне workspace+allow-list → `ask` |
| `network.request` | egress-proxy в main для Extension Host | `allowedApiEndpoints` glob (расширение может сужать, не расширять) |
| `shell.execute` | agent Bash tool | `allowedBashPatterns`; `blockedTools:["Bash"]` = полный запрет |
| `automation.register` | automations RPC (packages/shared/src/automations/) | без разрешения регистрация триггеров/действий отклоняется `E_PERMISSION` |
| `ui.panel` / `ui.command` | renderer Contribution Registry | contribution без granted permission отбрасывается при регистрации (fail-closed, warning в dev mode) |
| `secrets.use:<credential>` | capability broker в main | выдача scoped token; `<credential>` должен существовать в `VALID_CREDENTIAL_TYPES` (packages/shared/src/credentials/types.ts) |

Хранение grant'ов — **расширение существующей схемы**, а не новая система («новый компонент», добавка к mode-types.ts):

```typescript
// дополнительное необязательное поле в PermissionsConfigSchema:
extensions?: Record<string, {
  granted: ExtensionPermission[];
  grantedAt: string;            // ISO
  revoked?: ExtensionPermission[];
}>;
```

Семантика слоёв сохраняется аддитивной (более глубокий слой не может быть строже, как и сегодня); пользовательский отзыв разрешения пишется в workspace `permissions.json`. Обновление расширения, запрашивающее новые разрешения, → повторный диалог с **diff**, молчаливой эскалации нет.

### 3.7. Карточка расширения

```
┌────────────────────────────────────────────────────────────────────┐
│ ▣ KYLines                                            v2.4.1  ↻upd  │
│   Knowledge · siyuan-plugin · provider: SiYuan Bazaar              │
│   «Схема связей поверх блоков документа»                           │
│                                                                    │
│  Runtime    ⦿ siyuan-plugin — исполняется внутри SiYuan runtime    │
│             (не в Craft main; проекция через Plugin Bridge, S-06)  │
│  Works in   Knowledge surface · Compatibility mode · Status bar    │
│  Permissions knowledge.read · ui.panel · ui.command        (3/3 ✓) │
│  Dependencies  siyuan-kernel >= 3.1                                │
│  Install to   [Workspace: AGI/Rox ▾]        [ Install ]            │
└────────────────────────────────────────────────────────────────────┘
```

Обязательные поля карточки (любой runtime, любой провайдер): название/версия/иконка, **runtime-значок с пояснением где исполняется**, **permissions (число + раскрытие списка)**, **works-in** (какие поверхности/режимы затрагивает), **install target** (global / workspace / project — переиспользует tiers из packages/shared/src/skills/storage.ts), actions Install/Enable/Disable/Uninstall/Update. Группа высокого риска (`shell.execute`, `filesystem.write`, `browser.automate`, `network.request`, `secrets.use:*`) подсвечивается отдельным цветом в развёрнутом виде.

### 3.8. Адаптеры существующих сущностей (без изменения их моделей)

| Сущность | Существующая модель (менять НЕЛЬЗЯ) | Адаптер («новый компонент») | Синтетический манифест |
|---|---|---|---|
| Skills | dir `{slug}/SKILL.md` + frontmatter `SkillMetadata` (packages/shared/src/skills/types.ts), tiers в storage.ts | `SkillsAdapter` | runtime `skill-pack`; permissions ← `alwaysAllow` (→ agent-tool grants слоя); dependencies ← `requiredSources` |
| Sources | `{workspace}/sources/{slug}/config.json`, `SourceType mcp|api|local` (packages/shared/src/sources/types.ts) | `SourcesAdapter` | runtime `mcp-source`; permissions ← слой `sources/{slug}/permissions.json` + `secrets.use:<credential>` на credentialRef |
| Automations | триггеры/действия из packages/shared/src/automations/types.ts | `AutomationsAdapter` | runtime `automation-pack`; permissions ← `automation.register` + permissions вложенных действий |
| Marketplace entries | `MarketplaceEntry` (catalog.ts, kind skillpack/tool/context-doc) | `CatalogAdapter` | runtime по kind; integrity ← pinned SHA, lock.ts |
| Themes | темы renderer provider stack | `ThemesAdapter` | runtime `craft-native` (только наши темы) |

Каждый адаптер — чистая функция `ExistingModel → ExtensionRecord`; persistent storage сущностей НЕ копируется и НЕ мигрируется. Тест-инвариант: включение Extension Center не меняет ни одного файла skills/sources/automations на диске.

Lifecycle events: `extensions:changed` push добавляется в `BroadcastEventMap` (packages/shared/src/protocol/events.ts) по существующему механическому циклу channels.ts → routing.ts → handler → registerCoreRpcHandlers.

### 3.9. Установка (единый flow, 8 шагов)

1. **select** — выбор карточки в Extension Center (любой провайдер).
2. **choose workspace** — install target: global (user) / workspace (по умолчанию) / project (для skill-pack — `.agents/skills`, существующий tier).
3. **show runtime** — объяснение модели исполнения и доверия (из §3.3).
4. **show permissions** — полный список; высокорисковая группа подсвечена; явное подтверждение.
5. **show dependencies** — requiredSources / расширения / `engines.craft`; недостающее предлагается доустановить.
6. **install** — загрузка от провайдера, pin версии/SHA (прецедент: 40-hex SHA в catalog.ts), запись в lock-файл (прецедент: marketplace/lock.ts).
7. **activate** — по `activationEvents`; лениво, без блокировки UI.
8. **register contributions** — регистрация в Contribution Registry → слоты ([S-01](./01-shell-slots.md), [S-03](./03-panels-rails.md)), палитра ([S-04](./04-omnibox.md)); push `extensions:changed`.

Uninstall = обратный порядок: deregister → deactivate → remove files → release credentials (CredentialManager.delete по scope расширения).

### 3.10. Settings → Extensions

Новая страница настроек по существующему рецепту: одна запись в `SETTINGS_PAGES` (apps/electron/src/shared/settings-registry.ts, документированный 4-шаговый add flow) + компонент в `SETTINGS_PAGE_COMPONENTS` (settings-pages.ts, TS-enforced completeness). Секции:

- **Installed** — карточки с enable/disable, install target, runtime.
- **Updates** — список обновлений; permission diff перед применением.
- **Permissions** — сводка «расширение → granted/revoked», отзыв в один клик (правка workspace permissions.json).
- **Disabled** — карантинное хранилище.
- **Developer mode** — установка из локальной папки, verbose-лог Extension Host.
- **Registries** — список catalog providers, приоритет, offline-режим.

Страница настроек конкретного плагина: Craft settings contribution (settings в манифесте) | SiYuan custom tab (для siyuan-plugin) | compatibility view (fallback, см. [S-06](./06-plugin-bridge.md) §6).

## 4. Границы / что НЕ делаем

- ✗ Единый runtime исполнения — принципиально отвергнут (§1).
- ✗ Сторонние расширения в Electron main (att2 §18) — весь third-party код в Extension Host / sandboxed webContents / SiYuan runtime / внешних процессах.
- ✗ Raw API keys и `process.env` расширениям — только scoped capability через broker.
- ✗ Миграция/переписывание моделей Skills/Sources/Automations — только read-only адаптеры.
- ✗ Молчаливое повышение разрешений при update — всегда diff-диалог.
- ✗ Платный marketplace, рейтинги, отзывы, биллинг — вне scope v1.
- ✗ Подпись/аудит Bazaar-пакетов сверх fail-closed валидации метаданных и pin SHA — доверие к провайдеру фиксируется в Registries.
- ✗ Авто-обновление по умолчанию — только ручное из Updates.

## 5. Критерии приёмки

- [ ] Каталог показывает все 7 категорий фильтров и корректно раскладывает записи всех 8 runtime-типов; карточка каждого типа содержит runtime+пояснение, permissions, works-in, install target.
- [ ] `ExtensionManifest` валидируется zod-схемой; неизвестный runtime/permission/contribute-ключ → fail-closed reject с диагностикой.
- [ ] Все 10 contributes-точек манифеста реально регистрируются в Contribution Registry и видны в соответствующих слотах (rail, palette, panels, surfaces, menus, settings, skills, automation triggers/actions, agent actions).
- [ ] Все 14 точек расширения оболочки перечислены в реестре (S-01/S-03) и принимают contributions от минимум одного тестового расширения.
- [ ] Permission mapping: вызов `shell.execute` без grant → `E_PERMISSION`; `secrets.use:<cred>` выдаёт scoped token, Extension Host физически не имеет доступа к `SecureStorageBackend` (проверка процессной изоляции).
- [ ] Гранты хранятся в существующем workspace `permissions.json` (поле `extensions`), слоистое слияние с bundled default/per-source не сломано (существующие тесты permissions-config зелёные).
- [ ] Crash Extension Host: kill процесса → main/сессии/browser/другие workspaces живы; карточки затронутых расширений показывают `degraded`; restart восстанавливает без потери остального UI.
- [ ] Sandboxed renderer: сторонняя панель запускается с `contextIsolation:true, nodeIntegration:false, sandbox:true`, собственной partition и CSP; вызов не-whitelisted метода из preload отклоняется.
- [ ] Адаптеры Skills/Sources/Automations: сущности видны в Extension Center, при этом содержимое их storage на диске не изменилось ни на байт (diff пуст).
- [ ] Установочный flow проходит все 8 шагов; disable плагина сохраняется между перезапусками; `extensions:changed` broadcast приходит в открытые окна.
- [ ] Settings → Extensions существует как страница в `SETTINGS_PAGES` со секциями Installed/Updates/Permissions/Disabled/Developer mode/Registries.
- [ ] Обновление расширения с новым разрешением → повторный диалог с diff; молчаливого grant нет.

## 6. Открытые вопросы

1. Верификация Bazaar-пакетов: достаточно ли fail-closed метаданных + pin SHA, или вводим подписи для вне-курированных провайдеров? (Дефолт: метаданные+pin; подписи отдельным эпиком.)
2. Политика обновлений per-runtime: единый «manual» или per-provider (Bazaar часто обновляется)? (Дефолт: manual + Updates view.)
3. Egress для `network.request`: общий `allowedApiEndpoints` workspace или дополнительный extension-scoped слой? (Дефолт: extension-scoped список в `extensions.<id>.granted`, проксируется main.)
4. Web-widget и filesystem: запрет FS полностью или read-only через capability? (Дефолт: нет FS, только RPC capabilities.)
5. Нужен ли формальный conformance-suite для провайдеров каталога (по образцу CloudRunProvider conformance)? (Дефолт: да, минимальный: list/fetch/install idempotence.)
