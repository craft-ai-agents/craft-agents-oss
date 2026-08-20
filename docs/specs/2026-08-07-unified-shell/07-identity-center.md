# S-07 · Identity Center: федеративная модель аккаунтов и сервисных подключений

- **Doc id:** S-07
- **Название:** Identity Center — единая система аккаунтов (федеративная модель)
- **Статус:** draft
- **Дата:** 2026-08-07
- **Suite:** `docs/specs/2026-08-07-unified-shell/`
- **Входные документы:** исходный документ «Единая оболочка» (att2, §11 «Единая система аккаунтов: федеративная модель», §16, §17 W4, §18); scout-отчёт SkillsCloud (identity-map кодбазы); [S-01 Shell Slots](./01-shell-slots.md); [S-05 Extension Center](./05-extension-center.md); [K-03 Knowledge Provider Contract](../2026-08-07-siyuan-integration/03-knowledge-provider-contract.md); [K-07 Connection Modes (credentialRef)](../2026-08-07-siyuan-integration/07-connection-modes.md).

---

## Цель

Описать единый контур идентичности Craft (Identity Center): федеративную модель Profile / Workspace / ServiceConnection / Entitlement без общей таблицы `users`; единый верхний левый account menu, заменяющий любые разрозненные account switcher'ы; встраивание SiYuan Cloud-аккаунта как сервисного подключения (ServiceConnection), а не как корневой идентичности; сохранение local-first гарантий приложения; переиспользование существующего credential store и реестра настроек.

Identity Center — содержимое волны **W4** роадмапа (att2 §17): «Profile/Workspace/Service Connections/Credential refs/SiYuan account/единый account menu». Критерий волны: нет двух видимых account switcher; SiYuan sync и лицензия доступны.

## Контекст и мотивация

### Что есть в кодбазе сегодня

| Факт | Источник |
|---|---|
| Абстракции пользователя/аккаунта **нет**. Идентичность сведена к LLM-подключениям: `config.llmConnections`, `LlmConnection{ slug, name, providerType, authType, ... }` | `packages/shared/src/config/llm-connections.ts` |
| Все секреты живут в одном зашифрованном хранилище: `CredentialManager` (singleton `get/set/delete/list/checkHealth`), единственный backend — AES-256-GCM файлы (`backends/secure-storage.ts`), ключ `{type}::{scope...}`, разделитель `::` | `packages/shared/src/credentials/types.ts`, `packages/shared/src/credentials/manager.ts` |
| Типы учётных данных — закрытый union из 13 значений: `llm_api_key/llm_oauth/llm_iam/llm_service_account` (ключ `connectionSlug`), `source_oauth/source_bearer/source_apikey/source_basic` (ключ `{workspaceId}::{sourceId}`), `workspace_oauth`, `messaging_bearer`, `ssh_managed_token` и legacy-глобальные; `VALID_CREDENTIAL_TYPES` — явная точка расширения | `packages/shared/src/credentials/types.ts` |
| OAuth-жизненный цикл источников уже реализован: START (PKCE + `oauthFlowStore`) → COMPLETE (`completeOAuthFlow`, HTTP relay `/api/oauth/callback`) → CANCEL/REVOKE; хранение через `SourceCredentialManager` | `packages/server-core/src/handlers/rpc/oauth.ts`, `packages/shared/src/sources/credential-manager.ts` |
| Единственная глобальная операция «log out» — `auth.LOGOUT`: удаляет **все** credentials циклом `manager.list()` → `manager.delete()` и стирает `config.json`; диалог подтверждения: "All conversations will be deleted. This action cannot be undone." | `packages/server-core/src/handlers/rpc/auth.ts` |
| Настройки — единый реестр `SETTINGS_PAGES` (15 энтри: runtime, context, marketplace, app, ai, appearance, input, workspace, permissions, labels, messaging, server, cloudRuns, shortcuts, preferences); страница добавляется четырьмя правками: запись в реестре, компонент, маппинг, иконка | `apps/electron/src/shared/settings-registry.ts`, `apps/electron/src/renderer/pages/settings/settings-pages.ts`, `apps/electron/src/renderer/components/icons/SettingsIcons.tsx` |
| UI-паттерн CRUD подключений со статусами и health уже существует на примере LLM connections + у источников есть `connectionStatus` ('needs_auth'/'failed') | `apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx` |

### Мотивация

С интеграцией SiYuan у приложения появляется **второй** провайдер идентичности: SiYuan Cloud (логин, подписка, устройства, синхронизация). Если встроить его «как обычно», получится два account switcher'а, два места для лицензии и скрытая зависимость локальной работы от облачного логина. att2 §11 фиксирует альтернативу: **федеративная модель** — Craft Profile остаётся корнем, а все внешние аккаунты (включая SiYuan Cloud) подключаются как `ServiceConnection` по ссылке, без общей таблицы `users` и без слияния идентичностей (anti-goal att2 §18: «✗ объединение Craft Profile и SiYuan Cloud account»).

Разрыв в коде, который закрывает этот документ (scout, gap #4): «глобальной cloud-account identity нет; ближайшие прецеденты — LLM-connection OAuth (connection slug + oauth credential) и source OAuth». Identity Center — это тонкий оркестрационный слой над существующими примитивами, а не новая подсистема хранения.

## Решение

### 1. Федеративная модель: НЕ одна таблица users

Идентичность — это граф ссылок, а не единая учётная запись:

```
┌──────────────────┐   1:N        ┌───────────────────────┐
│ Profile          │─────────────▶│ WorkspaceMembership   │
│ mode: local|cloud│              │ role: owner|admin|…   │
└────────┬─────────┘              └───────────┬───────────┘
         │                                    │ N:1
         │                            ┌───────▼───────┐
         │                            │ Workspace     │  (существующие
         │                            │ {id,name,…}   │   workspaces Craft)
         │                            └───────┬───────┘
         │                                    │ 1:N
         ▼                                    ▼
┌──────────────────────┐  credentialRef  ┌──────────────────────────┐
│ ServiceConnection    │────────────────▶│ CredentialManager        │
│ provider · status    │                 │ (существующий store:     │
└──────────┬───────────┘                 │  source_bearer и др.)    │
           │ 1:N                         └──────────────────────────┘
           ▼
┌──────────────────────┐
│ Entitlement          │  status: active|expired|trial
└──────────────────────┘
```

Принципы:

1. **Profile — корень и только корень.** Профиль не «логинится» ни в какой внешний сервис; он лишь владеет ссылками на подключения.
2. **Провайдер владеет своим аккаунтом сам.** SiYuan Cloud хранит пользователя у себя; Craft хранит только `ServiceConnection` + credential (токен) в `CredentialManager`.
3. **Никаких мерджей.** Нельзя «слить» Craft Profile и SiYuan Cloud account; нельзя по e-mail сопоставлять аккаунты между провайдерами.
4. **WorkspaceMembership** существует только для командных workspace (remote/team server); локальные workspace его не требуют.

### 2. Доменные контракты

Интерфейсы заимствованы verbatim из att2 §11 (эскизная запись; конкретные типы полей уточняются при реализации):

```typescript
interface Profile { id; displayName; avatar?; mode: "local"|"cloud" }
interface Workspace { id; name; ownerProfileId }
interface WorkspaceMembership { workspaceId; profileId; role: "owner"|"admin"|"member"|"viewer" }
interface ServiceConnection {
  id; workspaceId;
  provider: "siyuan-local"|"siyuan-cloud"|"github"|"openai"|"anthropic"|"google"|"slack"|"custom";
  accountLabel?; credentialRef?;
  status: "connected"|"expired"|"syncing"|"error"|"disconnected";
}
interface Entitlement { provider; product; status: "active"|"expired"|"trial" }
```

Замечания по конкретизации (не меняют форму контрактов):

- `Profile.id`: при первом запуске автоматически создаётся локальный профиль `{ id: "local", displayName: <имя пользователя ОС или "Local User">, mode: "local" }`. Всё, что сегодня идентифицируется «приложением целиком» (default LLM connection, активный workspace), привязывается к нему без миграции данных.
- `Workspace.id` — это существующий `workspaceId` Craft (ключ сеансов, источников, credentials); `ownerProfileId` добавляется как поле метаданных существующего конфига workspace, сущность не переезжает.
- `ServiceConnection.credentialRef` — opaque-строка (обычно `sourceId`/slug подключения), резолвится в `CredentialId` по правилам §6; формат и семантика `tokenRef` для SiYuan kernel определены в [K-07 Connection Modes](../2026-08-07-siyuan-integration/07-connection-modes.md).
- `Entitlement.provider`/`product` совпадают с `ServiceConnection.provider` (например `provider: "siyuan-cloud", product: "cloud-sync"`).

### 3. Размещение в архитектуре

Следуем att2 §16 — без создания новых пакетов, внутри согласованных границ (все перечисленные пути — **новые компоненты**):

```
packages/core/src/platform/identity/      # Profile/ServiceConnection/Entitlement: модель, стор, события
apps/electron/src/main/identity-broker.ts # оркестрация: OAuth-flow, reconnect, sign-out, polling entitlement
apps/electron/src/renderer/pages/settings/AccountsSettingsPage.tsx  # страница настроек
apps/electron/src/renderer/platform/      # (S-01) AccountMenu в top-bar слоте
```

Правила:

- `platform/identity/` — чистый доменный модуль (нет Electron-зависимостей), хранит состояние в `<configDir>/identity.json`; секреты тут **не лежат никогда** — только `credentialRef`.
- `identity-broker.ts` (main-процесс) — единственная точка, где запускается/завершается авторизация; переиспользует `oauthFlowStore`, `completeOAuthFlow` и relay `/api/oauth/callback` из `packages/server-core/src/handlers/rpc/oauth.ts`.
- RPC-поверхность — **новый namespace** `identity.*` в `packages/shared/src/protocol/channels.ts` (+ классификация в `routing.ts`), по прецеденту регистрации каналов `cloudRuns.*`/`skills.*` (см. scout: registration → HANDLED_CHANNELS → routing → preload). Минимальный набор: `identity.getState`, `identity.updateProfile`, `identity.connect`, `identity.disconnect`, `identity.refreshStatus`; push-канал `identity:changed` (прецедент `skills:changed`, `sources:changed`).

### 4. Единый account menu (верхний левый элемент топ-бара)

Слот «Профиль/Workspace» в верхнем левом углу сетки оболочки (att2 §1, §3: «Переключатель SiYuan/workspace сверху слева → Craft Profile & Workspace»; геометрия слота — в [S-01](./01-shell-slots.md)). Один элемент, одно меню, ровно четыре секции (att2 §11):

```
┌───────────────────────────────────────────┐
│ ● AGI/Rox                             ⌄   │ ← top-left элемент top-bar
├───────────────────────────────────────────┤
│ PROFILE                                   │
│   AGI · local profile                     │
│   Edit profile…                           │
│───────────────────────────────────────────│
│ WORKSPACES                                │
│ ✓ rox                                     │
│   craft-agents                            │
│   ─────────                               │
│   New workspace…   Open workspace folder… │
│───────────────────────────────────────────│
│ CONNECTIONS                               │
│   4 connected · 1 expired                 │
│   SiYuan Cloud: syncing…                  │
│   Manage accounts & connections…          │
│───────────────────────────────────────────│
│ ACCOUNT & SECURITY                        │
│   Settings → Accounts & Connections       │
│   Credential health: ok                   │
│   ─────────                               │
│   Reset app data (log out everything)…    │
└───────────────────────────────────────────┘
```

Требования к меню:

- Раздел **Profile** отражает активный `Profile`; переключение профилей меняет `mode` видимости, но не трогает данные других профилей.
- **Workspaces** — тот же список, что существующий workspace switcher Craft (переиспользуем данные, убираем второй UI-элемент).
- **Connections** — сводка по `ServiceConnection.status`: счётчики `connected/expired/error`, отдельная строка для `siyuan-cloud` (см. §5).
- **Account & Security**: вход в страницу настроек, статус `credentials.HEALTH_CHECK` (RPC уже есть в `auth.ts`), и отдельный, явно помеченный деструктивный пункт полного сброса (§7).
- Второго account switcher'а в приложении быть не должно: SiYuan-переключатель аккаунта/workspace, приезжающий с SiYuan UI, в integrated mode скрывается, его функцию выполняет это меню (compatibility view — исключение, там SiYuan chrome виден целиком).

### 5. Settings → Accounts & Connections

Страница встраивается в существующий реестр по документированному в `settings-registry.ts` четырёхшаговому процессу (все правки — **новые компоненты**, форма записей — verbatim из существующего реестра):

```typescript
// apps/electron/src/shared/settings-registry.ts — добавить после 'workspace':
  { id: 'accounts' as const, labelKey: 'settings.accounts.title', descriptionKey: 'settings.accounts.description' },

// apps/electron/src/renderer/pages/settings/settings-pages.ts — добавить:
import AccountsSettingsPage from './AccountsSettingsPage'
//   и в SETTINGS_PAGE_COMPONENTS:
  accounts: AccountsSettingsPage,

// apps/electron/src/renderer/components/icons/SettingsIcons.tsx — добавить иконку 'accounts'
```

(Замечание из комментария реестра: `labelKey`/`descriptionKey` — i18n-ключи, `i18n.t()` в модуле не вызывать — реестр грузится до инициализации i18n.)

Макет страницы:

```
Settings → Accounts & Connections
┌──────────────────────────────────────────────────────────────┐
│ PROFILE                                                       │
│  ● Local Profile (default) — mode: local                      │
│    displayName [____________]  avatar [Change]                │
├──────────────────────────────────────────────────────────────┤
│ SERVICE CONNECTIONS                                           │
│  siyuan-local   connected    Local kernel · 127.0.0.1:6806    │
│  github         connected    @agisota               [Sign out]│
│  openai         expired      API key           [Reconnect]    │
│  + Connect service…                                           │
├──────────────────────────────────────────────────────────────┤
│ KNOWLEDGE SYNC                                                │
│  SiYuan Cloud                                                 │
│    account      user@example.com                              │
│    sync status  syncing · last ok 2 min ago                   │
│    subscription active (cloud-sync)                           │
│    devices      MacBook (this) · iPad              [Manage↗]  │
│    [Reconnect] [Sign out]                                     │
├──────────────────────────────────────────────────────────────┤
│ ACCOUNT & SECURITY                                            │
│  Credential store health: ok (3 issues: 0)  [Run health check]│
│  Reset app data (log out everything)…                         │
└──────────────────────────────────────────────────────────────┘
```

- Блоки Profile/Security — thin UI над `identity.*` RPC и `credentials.HEALTH_CHECK`.
- Блок **Service Connections** рендерит все `ServiceConnection` активного workspace по паттерну `AiSettingsPage.tsx` (список → статусная строка → Edit/Sign out), но **не дублирует** LLM connections: они остаются в разделе `ai` (`AiSettingsPage`), здесь отображаются как read-only строки со ссылкой «управляется в AI Settings». Инверсия не нужна: `ServiceConnection.provider` уже содержит `openai`/`anthropic`, и при желании LLM connection можно *отразить* как ServiceConnection без переноса владения.
- Блок **Knowledge Sync** — ровно один провайдер: `siyuan-cloud`; поля строго {account / sync status / subscription / devices / reconnect} по att2 §11.

### 6. SiYuan Cloud как ServiceConnection (НЕ корневая идентичность)

```typescript
// пример экземпляра после первого подключения
const siyuanCloud: ServiceConnection = {
  id: "svc-siyuan-cloud",
  workspaceId: "<активный workspace>",
  provider: "siyuan-cloud",
  accountLabel: "user@example.com",
  credentialRef: "siyuan-cloud",        // → CredentialId.name (см. §6.2)
  status: "syncing",
}
const siyuanSyncEntitlement: Entitlement = {
  provider: "siyuan-cloud",
  product: "cloud-sync",
  status: "active",
}
```

**6.1. Поток Connect.** «Connect service… → SiYuan Cloud» запускает OAuth-подобный flow через `identity-broker`: `START` (state в `oauthFlowStore`, открытие URL логина SiYuan Cloud) → callback `/api/oauth/callback` → `COMPLETE` → токен кладётся в `CredentialManager` → `ServiceConnection.status: "connecting" → "connected"`. Reconnect — повторный проход того же flow с сохранением `id` подключения. Disconnect/Sign out — только удаление credential + `status: "disconnected"` (§7). Прецедент каждого шага уже реализован для sources в `packages/server-core/src/handlers/rpc/oauth.ts`.

**6.2. Хранение токена — переиспользование credential store.** Два принципиально разных секрета:

| Секрет | Тип credential | Ключ (`credentialIdToAccount`) | Владелец контракта |
|---|---|---|---|
| API-токен SiYuan kernel (доступ к REST `127.0.0.1:6806` или remote) | `source_bearer` (существующий) | `source_bearer::{workspaceId}::{sourceId}` — tokenRef из конфига подключения | [K-07 Connection Modes](../2026-08-07-siyuan-integration/07-connection-modes.md) |
| Аккаунтный токен SiYuan Cloud (sync/подписка) | **новый** `service_oauth` (расширение `VALID_CREDENTIAL_TYPES` — задокументированная точка расширения) | `service_oauth::{workspaceId}::{name}`, где `name = serviceConnection.id` | этот документ |

`StoredCredential` (`value` + `refreshToken?` + `expiresAt?` + `tokenType?` + `idToken?`) покрывает оба случая без изменения схемы. Резолв секрета всегда один: `getCredentialManager().get({ type, workspaceId, sourceId|name })` — никакого параллельного keychain/файла аккаунтов не создаётся. Если при реализации выяснится, что отдельный тип избыточен, fallback — `workspace_oauth::{workspaceId}::{name}` (уже существующий тип для workspace-уровневых OAuth), но новый тип честнее: LLM/source/SSH префиксы не вводят в заблуждение при `manager.list()` и при `auth.LOGOUT` (§7).

**6.3. Почему не корневая идентичность.** SiYuan Cloud account не появляется в `Profile`, не становится `mode: "cloud"` для пользователя без его явного действия и не нужен ни одному локальному сценарию (§8). Это строка в таблице подключений — не более. Исчезновение аккаунта (Sign out, отзыв токена) деградирует только cloud sync, а не приложение.

### 7. LOGOUT-семантика: три разных операции

Сегодняшний `auth.LOGOUT` (`packages/server-core/src/handlers/rpc/auth.ts`) — граната: удаляет все 13 типов credentials без разбора и стирает `config.json`, диалог предупреждает об удалении всех разговоров. В федеративной модели разводим три операции:

| Операция | UI | Семантика | Реализация |
|---|---|---|---|
| **Sign out подключения** | рядом с каждым `ServiceConnection` | удалить credential этого подключения (`manager.delete({type:'service_oauth',workspaceId,name})` либо `source_*` аналог), `status → "disconnected"`. Другие подключения, сессии, документы не тронуты | `identity.disconnect` → `CredentialManager.delete`; прецедент `oauth.REVOKE` |
| **Sign out профиля (cloud mode)** | Account menu → Profile | все `ServiceConnection` профиля `→ disconnected` + их credentials удалены; локальные данные (workspaces, сессии, заметки) остаются | цикл по owned connections в `identity-broker` |
| **Reset app data (log out everything)** | Account & Security, деструктивный, с существующим confirm-диалогом | поведение сегодняшнего `auth.LOGOUT`: wipe всех credentials (теперь включая `service_oauth`) + удаление `config.json`; текст диалога расширяется упоминанием аккаунтов и подключений | существующий `auth.LOGOUT`, без новых каналов |

SiYuan kernel после любого из Sign out продолжает стартовать локально — обрывается только cloud sync (§8).

### 8. Local-first гарантии

Параграф att2 §11 принимается без изменений: «Local-first остаётся: Craft Profile local + SiYuan Kernel local, account не требуется. Аккаунт только для облачной синхронизации/удалённого сервера/командного workspace/платных сервисов/marketplace purchases».

Матрица доступности (checkable):

| Сценарий | Без единого подключения | Требует ServiceConnection | Какого |
|---|---|---|---|
| Создание/редактирование документов и блоков в SiYuan kernel | ✅ | нет | — |
| Запуск и ведение агентских сессий | ✅ (нужен лишь LLM connection — не аккаунт) | нет | — |
| Локальные sources, skills, автоматизации | ✅ | нет | — |
| SiYuan Cloud sync знаний | ✗ | да | `siyuan-cloud` |
| Подключение к удалённому SiYuan kernel server | ✗ | да | `siyuan-local` (remote) — см. [K-07](../2026-08-07-siyuan-integration/07-connection-modes.md) |
| Командный workspace (server-hosted) | ✗ | да | team server connection + `WorkspaceMembership` |
| Платные функции (paid cloud services) | ✗ | да | соответствующий провайдер + `Entitlement.status: "active"|"trial"` |
| Покупки в marketplace (Extension Center) | ✗ (бесплатная установка — ✓) | да, для покупок | `Entitlement`, см. [S-05](./05-extension-center.md) |

### 9. Entitlement: подписка без hard lockout

- Источник истины — ответ SiYuan Cloud API; локально кэшируется `Entitlement` + `expiresAt` next-check; обновление фоново при `connect`, при `syncing` и по ручному «Refresh».
- `status: "expired"` → cloud sync останавливается, баннер в блоке Knowledge Sync и (опционально) в статус-баре: «SiYuan Cloud subscription expired — sync paused». **Все локальные функции продолжают работать**; lockout-экранов, read-only режима редактора, блокировки экспорта — не вводим.
- `status: "trial"` отображается с остатком периода, но функционально равен `active`.
- Энтитлменты других провайдеров (marketplace purchases) живут по тому же правилу: истёкший `Entitlement` снимает платное, а не локальное.
- `Entitlement` не является credential: это данные, хранятся в `identity.json`, секретов не содержат.

## Границы / что НЕ делаем

- ✗ Общая таблица `users`, единый аккаунт Craft, «Craft ID».
- ✗ Слияние/сопоставление Craft Profile и SiYuan Cloud account (att2 §18 anti-goal) — только ссылка через `ServiceConnection`.
- ✗ Обязательный аккаунт для локальной работы: kernel, документы, сессии, sources, skills доступны без единого подключения (§8).
- ✗ Второй account switcher / второй profile picker вне top-left меню (критерий W4). Переключатель SiYuan «workspace/аккаунт» в integrated mode не показываем.
- ✗ Hard lockout по истечении подписки: никаких блокировок редактора/сессий/экспорта по `Entitlement.status`.
- ✗ Секреты вне `CredentialManager`: никаких новых файлов с токенами, никаких токенов в `identity.json`, `config.json` или аналитике.
- ✗ Изменение модели LLM connections (`llm_*` credentials, `config.llmConnections`, страница `ai`) — они остаются как есть; ServiceConnection может их отображать, но не владеет.
- ✗ Сервис командных workspace / team server: `WorkspaceMembership` — контракт для такого сервиса, сам сервер вне scope этого документа.
- ✗ Движок синхронизации знаний: статусы sync сюда приходят из knowledge-провайдера, реализуется в [suite K](../2026-08-07-siyuan-integration/03-knowledge-provider-contract.md), здесь только отображение.
- ✗ Перенос connect-UX в onboarding-мастер как обязательный шаг — подключения опциональны всегда.

## Критерии приёмки

- [ ] В `SETTINGS_PAGES` добавлена ровно одна запись `{ id: 'accounts', labelKey: 'settings.accounts.title', descriptionKey: 'settings.accounts.description' }`; страница видна и открывается в навигаторе настроек; `SETTINGS_PAGE_COMPONENTS` компилируется (тип `Record<SettingsSubpage, ComponentType>` делает пропуск записи ошибкой TS).
- [ ] Пять интерфейсов (§2) присутствуют в реализации `packages/core/src/platform/identity/` без изменения формы полей.
- [ ] В top-left account menu ровно секции Profile / Workspaces / Connections / Account & Security; в приложении нет второго видимого account switcher (включая SiYuan chrome в integrated mode).
- [ ] SiYuan Cloud подключается кнопкой «Connect service…» и представлен как `ServiceConnection { provider: "siyuan-cloud" }`; блок Knowledge Sync на странице показывает account, sync status, subscription, devices, кнопку reconnect.
- [ ] Холодный старт без единого `ServiceConnection`: создание документа, его редактирование в SiYuan editor и запуск сессии работают (матрица §8, колонка «Без единого подключения»).
- [ ] `ServiceConnection.credentialRef` резолвится в `CredentialId` и читается только через `getCredentialManager().get(...)`; токен SiYuan kernel хранится как `source_bearer::{workspaceId}::{sourceId}` по [K-07](../2026-08-07-siyuan-integration/07-connection-modes.md).
- [ ] Sign out одного подключения удаляет только его credential и ставит `status: "disconnected"`; остальные подключения, сессии и документы не затронуты; соседний `ServiceConnection` остаётся `connected`.
- [ ] `Reset app data` вызывает существующий `auth.LOGOUT` и после него `service_oauth`-записи отсутствуют в `manager.list()`.
- [ ] При `Entitlement { provider: "siyuan-cloud", status: "expired" }` sync ставится на паузу с баннером; локальное редактирование документа и запуск сессии по-прежнему работают (нет hard lockout).
- [ ] SiYuan sync и статус лицензии доступны из единого account menu (критерий волны W4 att2 §17).

## Открытые вопросы

1. Тип credential для сервисных OAuth: новый `service_oauth` в `VALID_CREDENTIAL_TYPES` (предложение §6.2) или переиспользование существующего `workspace_oauth::{workspaceId}::{name}` — решить совместно с владельцем K-07, чтобы `credentialRef` был единообразным.
2. SiYuan Cloud: есть ли официальный OAuth/pat flow, либо только логин→token — зависит от фактики SiYuan Cloud API (вход для identity-broker; не блокирует модель, блокирует Connect-UX).
3. Обновление токенов `service_oauth`: `TokenRefreshManager` сегодня обслуживает OAuth источников — расширяем его на service-типы или вводим параллельный refresh в identity-broker.
4. Команды/team workspaces: где исполняется `WorkspaceMembership` (какой сервер, какая проверка роли на mutate) — вне scope, но контракт роли зафиксирован уже сейчас.
5. Каденс polling entitlement и offline grace window (сколько sync работает при недостижимом SiYuan Cloud до перевода `status: "error"`).
6. Текст деструктивного диалога `auth.SHOW_LOGOUT_CONFIRMATION` ("All conversations will be deleted…"): дополняем упоминанием аккаунтов/подключений сейчас или вместе с переработкой onboarding.
7. Отображение `ssh_managed_token` и `messaging_bearer` в блоке Service Connections: показывать read-only (единая картина) или оставить в их профильных разделах настроек (`server`, `messaging`).
8. Нужен ли `identity.*` push-канал `identity:changed` сразу (для live-обновления account menu), или первая реализация довольствуется refetch на открытие меню.
