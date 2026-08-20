# 07 — Режимы подключения к SiYuan (Connection Modes)

> **ID спеки:** K-07
> **Статус:** draft
> **Дата:** 2026-08-07
> **Входные документы:** архитектурный вердикт «SiYuan поглощается Craft как движок знаний» (§13 «Три режима подключения», §12 «Минимальная база Bridge», §16 «Последовательность поглощения»); [00-overview.md](./00-overview.md) (обзор интеграции), [01-adrs.md](./01-adrs.md) (ADR-001…006), [02-integration-boundaries.md](./02-integration-boundaries.md) (системная граница), [03-knowledge-provider-contract.md](./03-knowledge-provider-contract.md) (контракт провайдера), [04-bridge-storage.md](./04-bridge-storage.md) (схема `knowledge_connections`), [05-mutation-safety.md](./05-mutation-safety.md) (контур записи), [08-licensing.md](./08-licensing.md) (лицензионный контур), [11-roadmap.md](./11-roadmap.md) (фазы P0–P7).

## 1. Цель

Определить модель подключения Craft → SiYuan: три режима (`external-local`, `managed`, `remote`), их UX, жизненный цикл, health check, хранение токенов через существующий `SourceCredentialManager`/`CredentialManager`, версионирование и capability discovery, каталог ошибок и порядок внедрения режимов (external-local — первым; managed — только после решения лицензионного вопроса, фаза P7).

## 2. Контекст и мотивация

SiYuan — внешний процесс с HTTP API (по умолчанию `localhost:6806`), он владеет каноническим хранилищем знаний (ADR-002), общей базы данных нет (ADR-003). Craft общается с ядром только по HTTP, и теоретически это можно было бы оформить как очередной Source категории `api` — но знаниям нужен контракт глубже, чем `mcp|api|local` (deep links, встроенная editor surface, конвейер публикаций, capability discovery), поэтому SiYuan **не** регистрируется как обычный Source (`packages/shared/src/sources/types.ts`, `SourceType = mcp|api|local`), а получает собственный слой `knowledge-bridge` с таблицей `knowledge_connections` (см. [04-bridge-storage.md](./04-bridge-storage.md)).

При этом инфраструктура подключений в репо уже построена и переиспользуется, а не изобретается заново:

- **Хранилище токенов**: `packages/shared/src/credentials/` — `CredentialManager` (синглтон, `getCredentialManager()`), методы `get/set/delete/list/checkHealth`, единственный backend `SecureStorageBackend` (`backends/secure-storage.ts`), AES-256-GCM encrypted file. Типы кредешелов — `CredentialType` union, в т.ч. `source_bearer` и `source_apikey`; формат ключа `'{type}::{workspaceId}::{sourceId}'` (`packages/shared/src/credentials/types.ts`).
- **Менеджер кредешелов источников**: `SourceCredentialManager` (`packages/shared/src/sources/credential-manager.ts`, 1379 LOC) — резолв `getCredentialId()` по `authType` (bearer → `source_bearer`, header/query → `source_apikey`), OAuth-потоки, `checkHealth`.
- **RPC-поверхность для credential-настроек**: `sources:saveCredentials` и смежные каналы в `packages/server-core/src/handlers/rpc/sources.ts` — образец для канала `knowledge:saveConnection`.
- **Settings UI-реестр**: `SETTINGS_PAGES` в `apps/electron/src/shared/settings-registry.ts` — точка добавления страницы «Knowledge».
- **Прецедент embedded-хостинга внешнего процесса/поверхности**: `BrowserPaneManager.createEmbeddedInstance` (`apps/electron/src/main/browser-pane-manager.ts`, 4014 LOC) — образец для `siyuan-process-manager.ts` в managed-режиме (§3.4).

Вердикт фиксирует три режима и порядок: external-local — первый производственный (минимум вмешательства, чистая лицензионная граница), managed — целевой нативный (лучший UX, но упаковка/обновления/лицензия), remote — для сервера и нескольких устройств. Данная спека раскрывает каждый режим до уровня, достаточного для реализации P1.

## 3. Решение

### 3.1 Контракт режима подключения

Union-тип из вердикта §13 — каноничен, не переопределяется:

```typescript
type SiyuanConnectionMode =
  | { kind: "external-local"; baseUrl: string; tokenRef: string }
  | { kind: "managed"; workspacePath: string; pinnedVersion: string }
  | { kind: "remote"; baseUrl: string; tokenRef: string; tlsRequired: true };
```

Режим — это **поле записи подключения**, а не отдельная сущность. Запись живёт в `knowledge_connections` (схема — [04-bridge-storage.md](./04-bridge-storage.md)):

```typescript
interface KnowledgeConnection {
  id: string;                       // uuid, PK
  provider: "siyuan";               // extensibility point под будущие Obsidian/Notion
  mode: SiyuanConnectionMode;       // JSON-вариант, kind дискриминирует
  baseUrl: string | null;           // дублируется на уровень строки для индексов/диагностики
  credentialRef: string | null;     // tokenRef для external-local/remote; см. §3.6
  version: string | null;           // версия SiYuan kernel, заполнена health check'ом
  capabilitiesJson: string | null;  // кэш capability discovery (§3.7)
  status: ConnectionStatus;         // lifecycle-состояние (§3.2)
  lastHealthAt: string | null;      // ISO-дата последнего успешного health check
}

type ConnectionStatus =
  | "registered"   // запись создана, валидация не выполнялась
  | "validating"   // идёт первичный version check + auth check
  | "healthy"      // heartbeat проходит, capabilities актуальны
  | "degraded"     // heartbeat проходит с ошибками фич (capability false) или нестабилен
  | "unreachable"  // heartbeat не проходит
  | "auth-invalid" // 401/403 от kernel
  | "disabled";    // выключен пользователем (запись хранится, heartbeat не ходит)
```

Ограничение: в P1–P6 живой является **одна** активная запись (первичный контур «один Craft ↔ один SiYuan»). Мультиконнекты заложены ключом `id`, но UI их не экспонирует (см. «Границы»).

### 3.2 Жизненный цикл подключения

```
                                 validate()
   [create] ──▶ registered ───────────────▶ validating
                    │                         │ version check + auth OK
                    │ delete()                ▼
                    │                       healthy ◀──┐
                    │                         │        │ heartbeat OK
                    │              heartbeat  │ heartbeat OK,
                    │              fail ×N    ▼ capability loss
                    │                         ▼        │
                    │   timeout/backoff   unreachable  degraded
                    └─────────▶ disabled ◀── toggle off ─┴── auth-invalid (401/403)
                                     │
                                  toggle on → validating
```

Переходы важные для реализации:

- `registered → validating`: обязателен **до первого чтения** — провайдер не выдаёт `search/get`, пока `status ∉ {healthy, degraded}`; UI в это время показывает скелетон Knowledge-раздела (см. [09-collection-view-engine.md](./09-collection-view-engine.md)).
- `healthy → unreachable`: только после N последовательных неудач (N=3, интервал heartbeat 30 s, таймаут запроса 5 s) — исключает дёргание UI на одиночных таймаутах.
- `unreachable → validating` автоматически: фоновый backoff-пробник (1 мин → 5 мин → 15 мин, потолок 15 мин) — пользователь не обязан «переподключаться» руками.
- `auth-invalid` — терминальный: пробник останавливается, требуются действия пользователя (новый токен). `checkHealth` у `CredentialManager` дополнительно помечает кредешел как `CredentialHealthIssue` (`packages/shared/src/credentials/types.ts`).
- `disabled`: heartbeat и пробник выключены, запись и кредешел хранятся; удаление записи обязано удалять и кредешел (`credentialRef`) best-effort — прецедент очистки: `deleteApiKeyCredentialBestEffort` в `packages/shared/src/sources/storage.ts`.

### 3.3 Режим `external-local` — первый производственный

Пользователь сам ставит и обновляет SiYuan, Craft подключается к уже работающему ядру.

**UX (settings-страница «Knowledge», новая запись в `SETTINGS_PAGES`, `apps/electron/src/shared/settings-registry.ts`; layout по образцу `AiSettingsPage.tsx`):**
1. Кнопка «Подключить SiYuan» → мастер: авто-детект `http://127.0.0.1:6806` (probe точки `version`: любой ответ формы SiYuan, включая 401, идентифицирует живое ядро), поле `baseUrl` с предзаполнением, поле «API token» (подсказка: в SiYuan — Settings → About → API Token), кнопка «Проверить» (выполняет `validate()`), затем «Сохранить».
2. После сохранения — карточка подключения: статус-чип (`healthy/degraded/...`), версия ядра, capabilities-строка, кнопки «Отключить»/«Удалить»/«Заменить токен».
3. Если probe не нашёл ядро — мастер показывает инструкцию по установке SiYuan со ссылкой (мы **не скачиваем и не устанавливаем** SiYuan за пользователя в этом режиме — §4).

**Lifecycle:** запись создаётся валидной только после успешного `validate()`; далее общий heartbeat (§3.2). Никакого процессного управления — Craft не стартует и не останавливает ядро: если SiYuan выключен, статус `unreachable`, пробник живёт по backoff'у.

**Health check:** `POST {baseUrl}/api/system/version` из main-процесса с заголовком авторизации (§3.6), таймаут 5 s. Ответ даёт строку версии → обновляем `knowledge_connections.version`, `lastHealthAt`; каждые 10 минут (или на `validating`) — полный capability discovery (§3.7).

**Credentials:** `tokenRef` обязателен (ядро без токена не отдаёт API): маппинг в реальный механизм — §3.6.

**Versioning:** окно совместимости проверяется на `validate()` и на каждой смене `version` (ядро могли обновить «снаружи» под нами) — §3.7.

**Ошибки**, типичные именно для этого режима: ядро не запущено (`UNREACHABLE`), порт занят другим процессом (диагностируем по не-SiYuan ответу — заголовок/body не наш), протухший токен после смены API Token в SiYuan (`AUTH_INVALID`). Диагностика — §3.8.

### 3.4 Режим `managed` — целевой нативный (фаза P7, после [08-licensing.md](./08-licensing.md))

Craft скачивает/упаковывает закреплённую версию SiYuan kernel, запускает её как дочерний процесс и полностью владеет её жизненным циклом и workspace'ом.

**Новые компоненты** (оба названия — из карты вердикта §8, реализация — новая):
- `apps/electron/src/main/siyuan-process-manager.ts` — менеджер процесса в main-процессе Electron;
- `packages/knowledge-siyuan/process-adapter.ts` — платформо-зависимая часть: резолюция бинаря, аргументы запуска, проверка checksum.

**Архитектурный прецедент — `BrowserPaneManager`** (`apps/electron/src/main/browser-pane-manager.ts`). Это действующий в кодовой базе менеджер управляемых внешних сущностей, и `siyuan-process-manager.ts` копирует его структурные решения:

| Приём BrowserPaneManager (существует) | Перенос в SiyuanProcessManager (новый компонент) |
|---|---|
| `Map<string, BrowserInstance>` — единый реестр инстансов в main | `Map<string, ManagedSiyuanInstance>` (фактически 1 запись в v1, но форма та же) |
| `createEmbeddedInstance` — композит из 3 WebContentsView (toolbar+page+overlay), изолированный `partition persist:browser-pane` | `startManagedInstance` — композит из child process + HTTP-клиент + лог-стрим; изоляция — собственный `workspacePath` и выделенный порт |
| `createForSession/focusBoundForSession/destroyForSession` — жизненный цикл, привязанный к владельцу | `startForWorkspace/stopForWorkspace` — цикл, привязанный к workspaceId Craft |
| RPC-регистрация `browserPane.*`, `CREATE_EMBEDDED` проставляет `workspaceId` из ctx (`apps/electron/src/main/handlers/browser.ts`) | RPC-каналы `knowledge.managed.*`, `START` проставляет `workspaceId` из ctx тем же способом |
| Финализация уничтожения защищена от падений cleanup (fix `finalizeDestroyedInstance` — cleanup-ошибки не должны отменять финализацию) | Тот же принцип: `stop()` идемпотентен, ошибки kill/drain логируются, но статус процесса всегда доезжает до `stopped/crashed` |
| Renderer-зеркало инстансов (`atoms/browser-pane.ts`, tombstones) | Snapshot статуса процесса в renderer через subscription `knowledge:managedStatus` |

**Spawn:** запуск бинаря закреплённой версии (`pinnedVersion`, semver) с флагами ядра (точный набор фиксируется в `process-adapter.ts` и сверяется с документацией пинованной версии): `--workspace=<workspacePath>`, `--port=<allocated>`, `--accessAuthCode=<generated>`, `--lang`, readonly-флаги не используются (нужен write-back по контракту [05-mutation-safety.md](./05-mutation-safety.md)). Порт **не** 6806: выделяется свободный ephemeral, чтобы managed-ядро не конфликтовало с SiYuan-установкой самого пользователя (`PORT_CONFLICT` — ошибка конфигурации, не рантайма).

**Доступ:** процесс всегда слушает только loopback; `accessAuthCode` при старте генерируется случайным, пишется в конфиг ядра и сохраняется как обычный `source_apikey`-кредешел (§3.6) — дальше managed не отличается от `external-local` для read/write-контуров: `baseUrl=http://127.0.0.1:<allocated>`, `tokenRef` на сгенерированный токен. Это ключевое упрощение: **весь provider-код работает по одному HTTP-контракту, режим отличается только тем, кто владеет процессом**.

**Workspace-менеджмент:** корень `<configDir>/knowledge-workspaces/<connectionId>/` (sandbox внутри конфиг-каталога Craft, прецедент `<configDir>/cloud-runs.env` из `packages/server-core/src/handlers/rpc/cloud-runs.ts`). Первый запуск — инициализация пустого workspace; миграции форматов хранения при смене `pinnedVersion` выполняются самим ядром, Craft лишь: (а) делает файловый бэкап workspace перед апгрейдом версии; (б) при неудаче health check после апгрейда — предлагает откат на предыдущий pinned-бинарь.

**Versioning:** `pinnedVersion` сверяется с фактической версией процесса на каждом `start` (mismatch → `VERSION_UNSUPPORTED`, автозапуск блокируется); поставка и обновление бинаря — отдельный канал дистрибуции, открывается только после лицензионного решения (P7, см. [08-licensing.md](./08-licensing.md) §3.6: managed = распространение бинаря → обязательны AGPL-совместимая публикация или коммерческое разрешение).

**Health:** двухслойный — (1) pid-watchdog (exit события процесса, crash-loop guard: max 5 рестартов, экспоненциальный backoff, затем `KERNEL_CRASHED`); (2) тот же HTTP heartbeat `version`, что у external-local. Остановка: мягкая (SIGTERM, grace 10 s) → SIGKILL; при выходе приложения дерево процессов гасится целиком (orphan kernel, держащий workspace lock, — главный источник «не стартует на следующем запуске»; симптом диагностируется как `WORKSPACE_LOCKED`, §3.8).

**UX:** zero-install — пользователь включает тумблер «Управляемое ядро SiYuan»; первый запуск показывает прогресс скачивания/распаковки; далее ядро прозрачно: пользователь видит Knowledge-раздел, а не SiYuan.

### 3.5 Режим `remote` — сервер и несколько устройств

Craft Desktop подключается к SiYuan, развёрнутому на сервере пользователя/команды (self-hosted Docker, хостинг).

**TLS обязателен:** поле `tlsRequired: true` зашито в вариант типа и проверяется дважды — (а) на `validate()`: `baseUrl` со схемой `http://` отклоняется с кодом `TLS_REQUIRED` (единственное исключение — loopback `http://127.0.0.1|http://localhost` для локального туннеля/разработки, фиксируется в UI отдельным подтверждением); (б) в HTTP-клиенте `packages/knowledge-siyuan/client.ts` (новый компонент): downgrade `https:// → http://` через redirect запрещён, self-signed сертификат — отказ с `TLS_INVALID` и инструкцией (доверенный CA или ручное исключение в мастере; «принять любой сертификат» в коде не существует).

**UX:** мастер «Удалённый сервер»: `baseUrl` (`https://…`), token; дополнительно показываем fingerprint сертификата при первом подключении (trust-on-first-use для самоподписанных — с явным чекбоксом, записывается в запись подключения). Одна `remote`-запись может обслуживать несколько устройств пользователя: сами знания живут на сервере, Craft лишь хранит `credentialRef` локально (§3.6) — синхронизация подключений между устройствами вне scope (§4).

**Lifecycle/health:** идентичны external-local (та же машина состояний §3.2), плюс TLS-ветки ошибок (`TLS_INVALID`, `TLS_REQUIRED`) и повышенные таймауты: запрос 10 s, heartbeat 60 s (WAN). Пробник тот же backoff.

**Credentials:** тот же `tokenRef`-механизм (§3.6); токен ни при каких условиях не улёт в plain-http (запрещено типом) и не пишется в логи — строковые формы `CredentialId` безопасны для логирования (это указатели, не значения).

### 3.6 Маппинг `tokenRef` → реальное хранилище кредешелов

SiYuan kernel требует токен в заголовке `Authorization: Token <apiToken>` на каждый запрос. Это header-аутентификация со статическим токеном, и существующий резолвер `SourceCredentialManager.getCredentialId()` (`packages/shared/src/sources/credential-manager.ts`, ~L310–326) уже кодирует её канонично: header/query → слот `source_apikey`. Поэтому:

```typescript
// tokenRef — сериализованный CredentialId (packages/shared/src/credentials/types.ts,
// формат '{type}::{workspaceId}::{sourceId}'):
const tokenRef = `source_apikey::${workspaceId}::siyuan`;
```

| Шаг | Реальный механизм | Символы / путь |
|---|---|---|
| Запись токена | `CredentialManager.set` (синглтон `getCredentialManager()`), шифрование AES-256-GCM, backend `SecureStorageBackend` | `packages/shared/src/credentials/manager.ts`, `backends/secure-storage.ts`, `index.ts` |
| Тип кредешела | `source_apikey` ∈ `SOURCE_CREDENTIAL_TYPES = ['source_oauth','source_bearer','source_apikey','source_basic']` | `packages/shared/src/credentials/types.ts` (L141–147) |
| Чтение на запрос | `CredentialManager.get({ type: 'source_apikey', workspaceId, sourceId: 'siyuan' })` → `StoredCredential.value` → заголовок `Authorization: Token …` | `packages/shared/src/credentials/manager.ts` |
| Health кредешела | `CredentialManager.checkHealth` → `CredentialHealthStatus`/`CredentialHealthIssue` (протухший/отсутствующий токен — диагностика) | `packages/shared/src/credentials/manager.ts`, `types.ts` |
| Удаление | best-effort очистка слота при удалении подключения (прецедент `deleteApiKeyCredentialBestEffort`) | `packages/shared/src/sources/storage.ts` |
| RPC-образец | `sources:saveCredentials` — форма канала для нового `knowledge:saveConnection` | `packages/server-core/src/handlers/rpc/sources.ts` |

Типовой выбор **не** `source_bearer`: bearer — это схема `Authorization: Bearer …`; SiYuan использует `Token`-схему, и `source_apikey` («header/query API key») — семантически точный слот, подтверждённый маппингом в `getCredentialId()`. Новый `CredentialType` (`siyuan_token`) **не** вводится — это лишнее расширение `VALID_CREDENTIAL_TYPES` без нового поведения.

Тонкость managed-режима: токен там рождается программно (случайный `accessAuthCode`), но проходит тем же путём — сразу `CredentialManager.set`, `tokenRef` в записи; разницы для остальных контуров нет.

### 3.7 Версионирование и capability discovery

- **Version check**: при `validate()` и каждом heartbeat — `POST /api/system/version`; версия парсится как semver и проверяется на окно `[minKernel, maxKernel)`, зашитое в `packages/knowledge-siyuan/compatibility.ts` (новый компонент; имя файла — из карты вердикта §8). Вне окна: ниже min → `VERSION_UNSUPPORTED` (агент отключён от контура, показывается инструкция обновить SiYuan); выше max — `degraded` с баннером «версия новее проверенной, часть функций может отличаться», но чтение продолжает работать.
- **Capability discovery**: на `validate()` и раз в 10 минут — проба фич по их API-точкам (без записи): поиск по полному тексту, backlinks, SQL-запрос (`/api/query/sql`, execute-only-SELECT), databases/attribute views, assets, наличие UI для editor surface. Результат — `SiyuanCapabilities` (новый тип в `packages/knowledge-siyuan/compatibility.ts`), кэшируется в `knowledge_connections.capabilities_json`:

```typescript
interface SiyuanCapabilities {
  search: boolean;            // POST /api/search/searchBlock доступен
  backlinks: boolean;         // backlinks/refcount endpoints
  sqlQuery: boolean;          // SELECT-only через /api/query/sql
  databases: boolean;         // attribute-view / database views
  editorSurface: boolean;     // веб-UI ядра пригоден для embedding (см. 09-*)
  assets: boolean;            // загрузка/раздача assets
}
```

- Потребитель — `KnowledgeProvider.capabilities()` ([03-knowledge-provider-contract.md](./03-knowledge-provider-contract.md)); отсутствие фичи переводит подключение в `degraded`, соответствующие UI-ветки скрываются (нет `sqlQuery` — нет контура сохранённых запросов), но core-чтение работает.

### 3.8 Каталог ошибок и диагностика

Коды — перечислимый тип в `packages/knowledge-core/` (новый компонент) или его SiYuan-специализация; все ошибки обязаны маппиться на один из них, сырой текст — в `details` для логов, но не в UI.

| Код | Условие | Режим | Действие UI |
|---|---|---|---|
| `SIYUAN_UNREACHABLE` | TCP/connect-таймаут или не-SiYuan ответ на version-probe | все | чип `unreachable`, backoff-пробник, подсказка «запущен ли SiYuan» |
| `SIYUAN_AUTH_INVALID` | 401/403 | все | карточка «заменить токен», heartbeat stop |
| `SIYUAN_AUTH_MISSING` | `credentialRef` резолвится в отсутствующую запись | external-local, remote | то же, что AUTH_INVALID |
| `SIYUAN_VERSION_UNSUPPORTED` | версия вне окна (ниже min / managed-mismatch) | все | блокировка контура + инструкция обновления |
| `SIYUAN_TLS_REQUIRED` | http:// для remote | remote | отказ до сохранения записи |
| `SIYUAN_TLS_INVALID` | недоверенный/протухший сертификат | remote | trust-on-first-use-диалог или отказ |
| `SIYUAN_PORT_CONFLICT` | выделенный порт занят при старте managed | managed | повторная аллокация порта, затем ошибка конфигурации |
| `SIYUAN_WORKSPACE_LOCKED` | ядро отвечает «workspace locked» (остался orphan-процесс) | managed | kill старого pid → рестарт; иначе диагностика |
| `SIYUAN_KERNEL_CRASHED` | exit ≠ 0, лимит рестартов исчерпан | managed | предложение рестарта, логи ядра одной кнопкой |
| `SIYUAN_TIMEOUT` | запрос > таймаута (5 s LAN / 10 s WAN) | все | retry с backoff; N подряд → `unreachable` |

Поверхности диагностики: (1) карточка подключения в Settings (статус + последняя ошибка + `lastHealthAt`); (2) placeholder в Knowledge-разделе при `unreachable/auth-invalid`; (3) debug-лог с `CredentialId`-указателями (значения токенов в лог не попадают никогда).

### 3.9 Порядок внедрения режимов

| Порядок | Режим | Связка с фазами ([11-roadmap.md](./11-roadmap.md)) | Обоснование |
|---|---|---|---|
| 1 | `external-local` | Единственный режим для P1–P6 | Минимум вмешательства, Craft ничего не распространяет (лицензионно чистый контур, [08-licensing.md](./08-licensing.md) вариант A), пользовательская установка проще диагностируется и обновляется, нет процессного управления |
| 2 | `remote` | Опциональное расширение после P2 (та же HTTP-суровость + TLS-ветки) | Не блокирует магистраль; добавляет только TLS-строгость и WAN-таймауты поверх external-local |
| 3 | `managed` | Только P7 — после того, как API-интеграция доказала ценность **и** решён лицензионный вопрос ([08-licensing.md](./08-licensing.md)) | Требует канала дистрибуции бинаря, обновлений, миграций workspace — и это AGPL-критичная зона |

Провайдер и все контуры (чтение, mutations, публикация) разрабатываются **только против HTTP-контракта**, единого для трёх режимов — переход external-local → managed не трогает их вообще (меняется владелец процесса и порт, не протокол).

## 4. Границы / что НЕ делаем

- **Не регистрируем SiYuan как обычный Source** (`mcp|api|local`): Source-контракт не выражает deep links, editor surface, publication; knowledge-bridge — отдельный слой, который лишь переиспользует credential-инфраструктуру.
- **Не делаем прямых вызовов renderer → SiYuan**: весь SiYuan-трафик идёт из main-процесса/`server-core` (единая точка таймаутов, TLS-политики и логирования); webContents никогда не хранит и не видит токен.
- **Managed не реализуем до P7** и до лицензионного решения — никакого скачивания/упаковки бинаря SiYuan в P1–P6.
- **Не поддерживаем `remote` по plain-HTTP** и не добавляем режим «игнорировать ошибки сертификата».
- **Не устанавливаем внешний SiYuan за пользователя** в external-local (только детект и инструкция).
- **Мультиконнекты** (несколько активных записей) не экспонируем в UI на P1–P6 (ключи в схеме заложены, UI — один активный).
- **Не синхронизируем Craft-подключения между устройствами** (remote-запись хранится локально на каждом устройстве).
- **Не вводим новый `CredentialType`** — `source_apikey` покрывает SiYuan token семантически и механически.
- **Не храним в `knowledge_connections` сами секреты** — только `credential_ref`-указатели (см. схему в [04-bridge-storage.md](./04-bridge-storage.md)).

## 5. Критерии приёмки

- [ ] `SiyuanConnectionMode` в коде дословно совпадает с union из §3.1 (три варианта, `tlsRequired: true` литералом у `remote`).
- [ ] Запись подключения сохраняется/читается через `knowledge_connections`; `credential_ref` никогда не содержит значение токена.
- [ ] external-local: мастер из Settings проходит «детект 6806 → токен → проверить → сохранить», статус становится `healthy`, `version` у записи заполнена фактической версией ядра.
- [ ] При выключенном SiYuan статус спустя N=3 heartbeat переходит в `unreachable`, после запуска — самовосстановление в `healthy` без действий пользователя.
- [ ] Неверный токен даёт `auth-invalid` и остановку пробника; замена токена возвращает `healthy` после одного `validate()`.
- [ ] Токен хранится через `CredentialManager.set/get` под ключом `source_apikey::<workspaceId>::siyuan`; в `CredentialManager.list` запись видна; в логах — только `CredentialId`.
- [ ] Версия вне окна → `SIYUAN_VERSION_UNSUPPORTED`/degraded-баннер по правилам §3.7; `capabilities_json` обновляется discovery-пробой.
- [ ] remote: `http://` (не loopback) отклоняется `SIYUAN_TLS_REQUIRED` до сохранения записи; redirect https→http в клиенте запрещён.
- [ ] managed (когда P7): старт процесса из `siyuan-process-manager.ts` с allocated-портом ≠ 6806, случайный `accessAuthCode` сохранён обычным `set`; выход приложения не оставляет orphan-процесса с lock'ом workspace (`WORKSPACE_LOCKED` не воспроизводится при повторном запуске).
- [ ] renderer не выполняет ни одного прямого запроса к baseUrl SiYuan (проверяется прослушиванием сети webContents в smoke-сценарии).

## 6. Открытые вопросы

1. Встроенный heartbeat 30 s/60 s (LAN/WAN) и backoff-лесенка пробника — утвердить окончательные числа по замерам на P1 (не блокирует API-контракт).
2. Trust-on-first-use для самоподписанных сертификатов remote: храним ли fingerprint сертификата в записи подключения постоянно или per-session?
3. Managed: политика выбора `pinnedVersion` (ручная правка vs канал обновлений) и состав флагов запуска ядра — финальный список сверить с документацией конкретной пинованной версии SiYuan.
4. Managed: лимиты ресурсов ядра (RAM/CPU) и их наблюдаемость в Craft — нужна ли видимость для пользователя.
5. Нужна ли опция «несколько remote-записей» (личный + командный сервер) уже в P3–P4, или точно откладываем за рамки произвольных мультиконнектов?
6. Синхронизация `credentialRef` между устройствами (remote-режим) — отдельная спека/фаза или сознательно навсегда локально?
