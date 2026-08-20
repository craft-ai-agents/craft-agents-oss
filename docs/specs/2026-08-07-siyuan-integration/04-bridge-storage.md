# K-04 · Knowledge Bridge: структура пакетов и хранилище

> **ID документа:** K-04
> **Название:** Knowledge Bridge — структура пакетов, file-backed хранилище, RPC-kаркас
> **Статус:** draft
> **Дата:** 2026-08-07
> **Входные документы:** вердикт архитектуры (local://att1-siyuan-verdict.md §§8, 11 контур 1, 12), [K-00 обзор](./00-overview.md), [K-01 ADR](./01-adrs.md) (ADR-002, ADR-003, ADR-005), [K-03 контракт провайдера](./03-knowledge-provider-contract.md), [K-05 контур записи](./05-mutation-safety.md)

---

## 1. Цель

Определить физическую структуру Knowledge Bridge в монорепозитории форка `agisota/craft-agents-oss`: какие пакеты и файлы создаются, где и в каком формате хранится интеграционное состояние (соединения, снапшоты контекста, связи, предложения мутаций, публикации, аудит), как новые RPC-каналы классифицируются в существующий routing-контур. Bridge хранит **только интеграционное состояние** — контент SiYuan не копируется и не зеркалируется (ADR-002, ADR-003).

## 2. Контекст и мотивация

Вердикт §12 задаёт «минимальную базу Bridge» шестью таблицами (`knowledge_connections`, `knowledge_context_snapshots`, `knowledge_links`, `knowledge_mutation_proposals`, `knowledge_publications`, `knowledge_audit_log`) и явным запретом: «НЕ копировать SiYuan целиком в Craft». Но формулировка «база» не должна читаться как «SQL-база»: в репозитории **нет ORM и миграционного инструментария** (ни drizzle, ни prisma, ни better-sqlite3 как слоя состояния — подтверждено поиском по `packages/`). Каноническое состояние Craft — это JSON/JSONL/MD-файлы под `~/.craft-agent/` и `{workspaceRoot}/`; единственный SQLite в репо — перестраиваемая FTS5-проекция [`packages/server-core/src/memory/fts-index.ts`] с ленивым `require('bun:sqlite')`, `PRAGMA journal_mode=WAL`, `CREATE VIRTUAL TABLE IF NOT EXISTS` и fail-soft семантикой (любая ошибка sqlite → `search()` возвращает `null` → вызывающий код работает по recency-фолбэку).

Рабочие прецеденты хранения, которые Bridge обязан повторять, а не изобретать заново:

| Паттерн | Где в репо |
|---|---|
| Глобальный config-dir `~/.craft-agent` (const `CONFIG_DIR`, override `CRAFT_CONFIG_DIR`, суффикс-инстансы `~/.craft-agent-1`) | `packages/shared/src/config/paths.ts` |
| Scoped-стора `audit.jsonl` append-only + ротация tail-first (`AUDIT_LIMITS {maxLines:10_000, keepLines:7_000}`) | `packages/server-core/src/memory/AuditLog.ts` |
| Атомарная запись: tmp-файл `.${Date.now()}-${process.pid}.*.tmp` + `renameSync(tmp, dest)` | `AuditLog.rotate()`, `LessonStore.rewrite`, `memory-io.ts rewriteLessonsFile`, `decay.ts`, `episodic-memory.ts` |
| JSONL со строгим парсингом: битые строки пропускаются, никогда не бросаются | `parseAuditEntries` в `AuditLog.ts` |
| Контракт `state.json` (authoritative) + `events.jsonl` (append-only зеркало) | `packages/cloud-runner/src/local-provider.ts` |
| Per-source конфиг `{workspaceRoot}/sources/{slug}/config.json` + `guide.md` + `permissions.json` | `packages/shared/src/sources/`, `handlers/rpc/sources.ts` (`ensureNotesSource()`) |
| Токены: AES-256-GCM `SecureStorageBackend`, ключ `{type}::{workspaceId}::{sourceId}` | `packages/shared/src/credentials/manager.ts`, `credentials/types.ts` (`VALID_CREDENTIAL_TYPES`) |
| Механический цикл нового RPC-домена: `channels.ts` → `routing.ts` → `events.ts` → `handlers/rpc/<domain>.ts` → `registerCoreRpcHandlers` → `channel-map.ts` | `packages/shared/src/protocol/*`, scout-ServerCore |

Поэтому «база Bridge» из вердикта §12 реализуется как **набор file-backed stores + одна опциональная sqlite-проекция для индексов**, а не как новая СУБД.

## 3. Решение

### 3.1 Структура пакетов и файлов

Все элементы ниже — **новые компоненты** (в репо нет `knowledge`-неймспейса ни в одном протокольном реестре, подтверждено поиском). Раскладка следует вердикту §8 с отображением на фактические конвенции каталогов (`handlers/rpc/` для RPC-модулей, отдельная папка домена для сервисов):

```
packages/
├── knowledge-core/                        # НОВЫЙ ПАКЕТ — чистые типы и file-backed stores, без I/O к SiYuan
│   └── src/
│       ├── refs.ts                        # KnowledgeRef / CraftRef, парсинг siyuan:// и craft:// URI
│       ├── provider.ts                    # интерфейс KnowledgeProvider (см. K-03)
│       ├── capabilities.ts                # KnowledgeCapabilities, capability-флаги провайдера
│       ├── context.ts                     # ContextSnapshot, ContextMode 'snapshot'|'live-reference' (§3.4)
│       ├── mutations.ts                   # MutationProposal, статусная машина (см. K-05), MutationOp
│       ├── publications.ts                # PublicationRecord + provenance (см. K-06)
│       ├── projections.ts                 # KnowledgeListProjection для view-engine (см. K-09)
│       └── storage/                       # file-backed stores (§3.3) — единственный модуль, трогающий диск
│           ├── paths.ts                   # resolveKnowledgePaths(configDir, workspaceRoot) (§3.5)
│           ├── json-store.ts              # базовый JsonFileStore<T>: read/write tmp+rename, schema-валидация zod
│           ├── jsonl-store.ts             # базовый JsonlStore<T>: append + resilient parse (образец parseAuditEntries)
│           ├── connections-store.ts       # KnowledgeConnection[] (глобальный scope)
│           ├── snapshots-store.ts         # ContextSnapshot по файлам (workspace scope)
│           ├── links-store.ts             # KnowledgeLink[] (append-only jsonl)
│           ├── proposals-store.ts         # MutationProposal по файлам + индекс по status
│           ├── publications-store.ts      # PublicationRecord[] (append-only jsonl)
│           ├── audit-store.ts             # реэкспорт/адаптация AuditLog под knowledge-действия
│           └── link-index.ts              # опциональный sqlite-слой (§3.3.7), образец fts-index.ts
│
├── knowledge-siyuan/                      # НОВЫЙ ПАКЕТ — SiYuan-реализация KnowledgeProvider, HTTP к kernel 6806
│   └── src/
│       ├── client.ts                      # SiyuanKernelClient: fetch-обёртка, bearer token, /api/* endpoints
│       ├── provider.ts                    # SiyuanKnowledgeProvider implements KnowledgeProvider
│       ├── search-adapter.ts              # /api/search/* + /api/sql → SearchPage
│       ├── mutation-adapter.ts            # MutationOp → вызовы /api/block/* и /api/attr/*, base-hash через re-read
│       ├── deep-links.ts                  # siyuan://blocks/<id> ↔ kernel ids
│       ├── compatibility.ts               # версия kernel, capability discovery, feature-флаги
│       └── process-adapter.ts             # токены/lifecycle для managed-режима (P7, см. K-07)
│
apps/electron/src/main/
├── knowledge-surface-manager.ts           # НОВЫЙ — управление встроенной KnowledgeSurface (образец BrowserPaneManager.createEmbeddedInstance)
└── siyuan-process-manager.ts              # НОВЫЙ — spawn/stop/health SiYuan kernel (только managed-режим, P7)

apps/electron/src/renderer/components/knowledge/    # НОВЫЕ UI-компоненты
├── KnowledgeHome.tsx
├── KnowledgeSidebar.tsx
├── KnowledgeSurface.tsx
├── KnowledgeInspector.tsx
├── KnowledgeMentionPicker.tsx             # расширяет mention-menu.tsx новым MentionItemType 'knowledge'
├── KnowledgeDiff.tsx                      # diff/approval UI для мутаций (см. K-05)
└── PublishSessionDialog.tsx               # диалог публикации (см. K-06)

packages/server-core/src/
├── handlers/rpc/knowledge.ts              # НОВЫЙ RPC-модуль (в вердикте: knowledge-rpc.ts) —
│                                          #   HANDLED_CHANNELS + registerKnowledgeHandlers(server, deps)
├── knowledge/
│   ├── bridge-service.ts                  # НОВЫЙ — фасад над stores + провайдерами, единственный писатель файлов
│   ├── publication-service.ts             # НОВЫЙ (вердикт §8) — distill→publish конвейер (см. K-06)
│   └── knowledge-automation-actions.ts    # НОВЫЙ (вердикт §8) — knowledge-действия автоматизаций (см. K-10)
```

Имя `knowledge-rpc.ts` из вердикта отображается в repo-конвенцию `handlers/rpc/<domain>.ts` (прецеденты: `handlers/rpc/notes.ts`, `handlers/rpc/memory-io.ts`, `handlers/rpc/cloud-runs.ts` — все экспортируют `HANDLED_CHANNELS` + `register*Handlers(server, deps)` и регистрируются одной строкой в `handlers/rpc/index.ts → registerCoreRpcHandlers`, которую потребляют и Electron-main (`apps/electron/src/main/handlers/index.ts`, профиль `{browserPane:false}`), и headless-сервер (`packages/server/src/index.ts`)).

### 3.2 RPC-каркас: каналы и классификация routing

Новый неймспейс `RPC_CHANNELS.knowledge` в `packages/shared/src/protocol/channels.ts` (wire-строки — стабильный API-контракт; ключи можно перестраивать, значения нет). Формат wire-строки — `knowledge:camelCase`, push-канал — `knowledge:changed` (прецедент `skills:changed`).

Каждый канал попадает ровно в один из сетов `LOCAL_ONLY_CHANNELS` / `REMOTE_ELIGIBLE_CHANNELS` в `packages/shared/src/protocol/routing.ts` — это вымостено тестом `protocol/__tests__/routing.test.ts` (неклассифицированный канал роняет CI: `LOCAL.size + REMOTE.size === getAllChannelValues().length`). Прецеденты классификации: config-dir данные (`contextDocs`, `marketplace`) — LOCAL_ONLY; workspace-контент (`notes`, `memory`) — REMOTE_ELIGIBLE.

| Канал (wire) | Назначение | Класс | Обоснование |
|---|---|---|---|
| `knowledge:listConnections` | список соединений | LOCAL_ONLY | соединение ссылается на локальный SecureStorage (`credential_ref`) и обычно на localhost:6806 (external-local, K-07) — за пределами хоста бессмысленно |
| `knowledge:saveConnection` | create/update соединения | LOCAL_ONLY | пишет в `~/.craft-agent/knowledge/connections.json` (глобальный config-dir) |
| `knowledge:deleteConnection` | удаление соединения | LOCAL_ONLY | то же + удаление credential |
| `knowledge:testConnection` | health + version + capability probe | LOCAL_ONLY | соединение local-bound; результат не является workspace-контентом |
| `knowledge:search` | поиск по провайдеру | REMOTE_ELIGIBLE | контентный запрос к workspace-домену, аналог `notes:search`; headless-север может быть хозяином kernel-подключения |
| `knowledge:get` | чтение document/block | REMOTE_ELIGIBLE | аналог `notes:read` |
| `knowledge:getBacklinks` | backlinks по ref | REMOTE_ELIGIBLE | контентный запрос |
| `knowledge:getContext` | ContextPayload (snapshot \| live-reference) | REMOTE_ELIGIBLE | читает `{workspaceRoot}/knowledge/snapshots/` (workspace-данные) или провайдера |
| `knowledge:createSnapshot` | захват ContextSnapshot (контур 1) | REMOTE_ELIGIBLE | снапшот принадлежит сессии/workspace |
| `knowledge:listLinks` / `knowledge:link` / `knowledge:unlink` | cross-links Craft↔Knowledge | REMOTE_ELIGIBLE | `{workspaceRoot}/knowledge/links.jsonl` — workspace-контент |
| `knowledge:proposeMutation` | создать MutationProposal | REMOTE_ELIGIBLE | proposals живут в workspace и являются контентом, видимым в UI; само применение gated permissions (K-05), не routing |
| `knowledge:listProposals` / `knowledge:getProposal` | чтение proposals | REMOTE_ELIGIBLE | то же |
| `knowledge:approveProposal` / `knowledge:rejectProposal` | review-решения | REMOTE_ELIGIBLE | мутация workspace-файла proposals/, не SiYuan |
| `knowledge:applyProposal` | READ-HASH-CHECK → APPLY в SiYuan | REMOTE_ELIGIBLE | запись идёт в kernel через провайдера; routing не является security boundary — гейтит permissions engine (K-05 §3.6) |
| `knowledge:rollbackProposal` | inverse patch | REMOTE_ELIGIBLE | как apply |
| `knowledge:listPublications` / `knowledge:publishSession` | публикация (контур 3) | REMOTE_ELIGIBLE | workspace publications + запись через провайдера |
| `knowledge:openDeepLink` | открыть ref в surface | LOCAL_ONLY | чисто GUI-действие (K-02: surface-менеджмент живёт в Electron main), аналог Electron-only каналов |
| `knowledge:changed` | push-уведомление | — (push) | в `BroadcastEventMap` в `events.ts`: payload `[KnowledgeChangedPayload]`, scope `{to:'workspace', workspaceId}` (прецедент `memory.CHANGED` в `memory-io.ts`) |

Watch-подписки на изменения провайдера (P6, K-10) добавят `knowledge:watch` / `knowledge:unwatch` (REMOTE_ELIGIBLE) с cleanup-хуком по образцу `notes.WATCH/UNWATCH` + `cleanupCoreClientResources` в `handlers/rpc/index.ts`.

Renderer-доступ: `apps/electron/src/transport/channel-map.ts` — для каждого канала `invoke(RPC_CHANNELS.knowledge.X)` / `listener(...)` в `CHANNEL_MAP` (сборка `ElectronAPI` через build-api); preload-пересборка обязательна.

### 3.3 Хранилище Bridge: file-backed stores

«Минимальная база» вердикта §12 отображается таблица-в-store. Ни одна таблица не становится SQL-таблицей; каждая сущность — JSON-документ с `id`-ключом.

#### 3.3.1 `knowledge_connections` → `~/.craft-agent/knowledge/connections.json`

Глобальный scope (соединения — свойство машины пользователя, не workspace). Один файл, массив объектов, запись целиком через tmp+rename (размер мизерный — десятки соединений):

```typescript
// packages/knowledge-core/src/storage/connections-store.ts — НОВЫЙ
interface KnowledgeConnection {
  id: string;                        // uuid
  provider: 'siyuan';                // discriminant под будущие провайдеры
  mode: 'external-local' | 'managed' | 'remote';   // SiyuanConnectionMode (K-07)
  baseUrl: string;                   // http://127.0.0.1:6806 | https://… (remote)
  credentialRef: string;             // НЕ токен: ключ CredentialManager 'source_bearer::{ws}::{id}'
  workspacePath?: string;            // managed only
  pinnedVersion?: string;            // managed only
  status: 'unknown' | 'ok' | 'needs_auth' | 'failed';  // кэш последнего probe
  kernelVersion?: string;
  capabilities?: KnowledgeCapabilities;  // кэш capability discovery (compatibility.ts)
  lastProbeAt?: string;              // ISO
  createdAt: string;
}
```

Токен хранится только в `CredentialManager` (AES-256-GCM `SecureStorageBackend`); в файле — `credentialRef`. Тип credential: переиспользуем `source_bearer` (уже в `VALID_CREDENTIAL_TYPES`); введение нового типа `siyuan_token` — отдельное решение через точку расширения `credentials/types.ts` (не требуется на P1).

#### 3.3.2 `knowledge_context_snapshots` → `{workspaceRoot}/knowledge/snapshots/<snapshotId>.json`

Workspace scope, один файл на снапшот (контент блока может быть большим; per-file layout избегает rewrite всего массива и даёт O(1) удаление). Модель — §3.4.

#### 3.3.3 `knowledge_links` → `{workspaceRoot}/knowledge/links.jsonl`

Append-only, одна строка = связь:

```typescript
interface KnowledgeLink {  // НОВЫЙ тип, knowledge-core/refs.ts
  id: string;
  craftRef: CraftRef;        // { scheme:'craft', kind:'session'|'run'|'skill'|'automation', id }
  knowledgeRef: KnowledgeRef;// { scheme:'siyuan', kind:'notebook'|'document'|'block'|'database'|'asset', id }
  relation: 'published-from' | 'context-of' | 'derived-from' | 'reviews' | 'tracked-by';
  createdAt: string;         // ISO
  createdBy: 'user' | 'agent' | 'automation';
  deletedAt?: string;        // tombstone-строка при unlink (append-only семантика сохраняется)
}
```

Unlink = дописывание tombstone; компактизация — периодическая rewriteLessonsFile-стилем (tmp+rename) с выбрасыванием удалённых пар.

#### 3.3.4 `knowledge_mutation_proposals` → `{workspaceRoot}/knowledge/proposals/<proposalId>.json`

Per-file по тем же соображениям, что снапшоты (patch + inverse_patch + diff — объёмные; жизненный цикл — частые статусные апдейты). Полная модель и статусная машина — в [K-05](./05-mutation-safety.md); здесь физический формат:

```typescript
interface MutationProposalFile {   // НОВЫЙ, knowledge-core/mutations.ts
  id: string;
  sessionId?: string;
  connectionId: string;
  targetRef: KnowledgeRef;
  baseHash: string;                // hash контента при READ (контур 2)
  ops: MutationOp[];               // patch_json
  inverseOps?: MutationOp[];       // inverse_patch_json, захватывается при APPROVE→apply
  status: MutationProposalStatus;  // draft|pending_review|approved|applying|applied|conflict|rolled_back
  createdAt: string; updatedAt: string; appliedAt?: string;
  actor: 'user' | 'agent' | 'automation';
}
```

Индекс для `listProposals` — ленивое сканирование директории с чтением только front-полей (статус, target, даты); при росте >1k proposals добавляется per-status индекс-файл `proposals-index.json` (rebuildable, как `index.db`).

#### 3.3.5 `knowledge_publications` → `{workspaceRoot}/knowledge/publications.jsonl`

Append-only (публикация — факт истории, не редактируется): `id, sessionId, runId?, targetRef, provenance (YAML-блок из вердикта §11 контур 3 как JSON), createdAt`. Детали — [K-06](./06-publication-pipeline.md).

#### 3.3.6 `knowledge_audit_log` → `{workspaceRoot}/knowledge/audit.jsonl`

Хранилище = **адаптация существующего `AuditLog`** (`packages/server-core/src/memory/AuditLog.ts`), а не новая реализация: файл остаётся `{dir}/audit.jsonl`, DI через `AuditLog.inDir(knowledgeDir, 'workspace')`. Формат записи наследует `AuditEntry { ts, actor, action, target, detail?, scope }` из `packages/shared/src/memory/types.ts`; `action` — строки `knowledge.*` (см. таблицу в K-05 §3.8), `target` — `siyuan://…` URI. Ротация — наследуемая tail-first (`AUDIT_LIMITS`), атомарный tmp+rename. Битые строки отбрасываются `parseAuditEntries`.

#### 3.3.7 Опциональный SQLite-слой: `{workspaceRoot}/knowledge/index.db`

**Не источник истины** — перестраиваемая проекция для (а) полнотекстового поиска по снапшотам и (б) быстрых link-graph запросов («что ссылается на этот блок») без сканирования jsonl. Реализация строго по образцу `packages/server-core/src/memory/fts-index.ts`:

```typescript
// packages/knowledge-core/src/storage/link-index.ts — НОВЫЙ, образец memory/fts-index.ts
const db = lazyOpen()  // require('bun:sqlite') внутри try/catch; под node/electron-main → null → слой off
db.exec('PRAGMA journal_mode = WAL')
db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_snapshots_fts
         USING fts5(title, text, snapshot_id UNINDEXED, captured_at UNINDEXED)`)
db.exec(`CREATE TABLE IF NOT EXISTS knowledge_links_idx
         (link_id TEXT PRIMARY KEY, craft_ref TEXT, knowledge_ref TEXT, relation TEXT)`)
```

Свойства-инварианты (копируются с fts-index): ленивый `require` (нет падения при загрузке бандла), inline `CREATE … IF NOT EXISTS` вместо миграций, любая sqlite-ошибка → `null`/skip → фолбэк на сканирование jsonl/файлов, `closeAll()` для тестов. Rebuild-процедура: `rebuildLinkIndex()` перечитывает `snapshots/*.json` + `links.jsonl` и пересоздаёт файл — аналогично тому, как FTS-проекция памяти перестраивается из lessons/history.

### 3.4 Модель ContextSnapshot (вердикт §11, контур 1)

```typescript
// packages/knowledge-core/src/context.ts — НОВЫЙ
type ContextMode = 'snapshot' | 'live-reference';

interface ContextSnapshot {
  id: string;
  connectionId: string;
  sessionId: string;
  ref: KnowledgeRef;                    // блок/документ, выбранный пользователем
  mode: ContextMode;
  content: string;                      // каноническая сериализация блока (markdown-ish)
  children: ContextSnapshotChild[];     // рекурсивно, depth-ограничено capability провайдера
  backlinks: KnowledgeRef[];            // на момент захвата
  attributes: Record<string, string>;   // SiYuan attrs на момент захвата
  capturedAt: string;                   // ISO (= captured_at вердикта)
  contentHash: string;                  // sha256 нормализованного content (см. K-05 §3.1 — тот же алгоритм, что baseHash)
}
```

Семантика режимов:

- **`snapshot`** (воспроизводимый): агент работает со `content` как зафиксированным; перечитывание не выполняется. Снапшот пишется в `snapshots/<id>.json` атомарно и дальше неизменяем (immutable).
- **`live-reference`**: в `ContextSnapshot` сохраняются все поля захвата, но перед исполнением (tool call, начало run) провайдер обязан перечитать ref и сравнить `contentHash`: совпал — отдать свежее содержимое; не совпал — вернуть `ContextStaleError { expectedHash, actualHash }`, который session-runtime показывает пользователю как предупреждение «источник изменился с момента захвата» (без silent-подмены контекста).

Оба режима проходят через один RPC `knowledge:createSnapshot { ref, mode, sessionId }`; attach в сессию storing только `snapshotId` + `mode` в метаданных сессии (сессия остаётся владельцем ссылок, ADR-006: «Session is not a document»).

Retention: снапшоты — рабочие артефакты, не знание. GC-политика: удаление снапшотов сессии при архивации сессии + потолок `~200 МБ` на `snapshots/` (LRU по `capturedAt`), исполняется тем же обходом, что prune в skills (`PRUNE_UNUSED` — archive, never delete, прецедент `handlers/rpc/skills.ts`).

### 3.5 Раскладка по путям и протокол записи

```
~/.craft-agent/                                   # CONFIG_DIR (packages/shared/src/config/paths.ts)
└── knowledge/
    └── connections.json                          # KnowledgeConnection[] (tmp+rename)

{workspaceRoot}/                                  # корень workspace-хранилища (как у memory/, sources/, automations.json)
└── knowledge/
    ├── snapshots/<snapshotId>.json               # immutable ContextSnapshot
    ├── links.jsonl                               # append-only + tombstones
    ├── proposals/<proposalId>.json               # MutationProposalFile (rewrite on status change)
    ├── publications.jsonl                        # append-only
    ├── audit.jsonl                               # AuditLog-адаптация, ротация 10k/7k
    ├── events.jsonl                              # зеркало доменных событий (§3.6)
    └── index.db                                  # ОПЦИОНАЛЬНАЯ sqlite-проекция (§3.3.7), удаляема без потерь
```

Протокол записи (единый для всех stores, копия существующих):

1. **Перезапись файла состояния** (connections.json, proposal-файлы): сериализовать → `writeFileSync(tmp)` где `tmp = join(dir, \`.${Date.now()}-${process.pid}.<name>.tmp\`)` → `renameSync(tmp, dest)` (точный паттерн `AuditLog.rotate()` и `LessonStore.rewrite`).
2. **Append-only jsonl** (links, publications, audit, events): `appendFileSync` одной строки; ротация/компактизация — цельным tmp+rename (`AUDIT_LIMITS` как референс порогов).
3. **Чтение jsonl**: resilient parse — пропуск битых строк без исключений (`parseAuditEntries`).
4. **Единый писатель на процесс**: `bridge-service.ts` — единственный импортирующий `storage/*` модуль в server-core; RPC-хендлеры не трогают fs напрямую (аналогично тому, как memory-домен изолирован за MemoryService). Глобальных локов не вводим: write-нагрузка мала и serialized внутри bridge-service.
5. **`CONFIG_DIR` — module-load const**: stores обязаны резолвить пути лениво в конструкторе через `process.env.CRAFT_CONFIG_DIR || CONFIG_DIR`, а не захватывать константу при импорте (та же ловушка, что вынесена в комментарии `AuditLog` — тесты и dev-инстансы `-1` меняют config dir до создания сервисов).

### 3.6 События и аудит-зеркало

По образцу cloud-runner (`state.json` authoritative + `events.jsonl` append-only зеркало, `local-provider.ts`) Bridge ведёт `{workspaceRoot}/knowledge/events.jsonl`: одна строка на доменное событие `{ts, type, payload}` — `snapshot.created`, `link.added|removed`, `proposal.<status-transition>`, `publication.created`, `connection.status-changed`. Файл — зеркало для tail-подписчиков (автоматизации K-10, будущий внешний watcher); источником истины остаются сами stores.

Наружу в UI домен вещает push-канал `knowledge:changed` через `pushTyped(server, RPC_CHANNELS.knowledge.CHANGED, {to:'workspace', workspaceId}, payload)` с типизированным payload в `BroadcastEventMap` (`events.ts`) — прецедент `memory.CHANGED` в `handlers/rpc/memory-io.ts`. Аудит (`audit.jsonl`) и события (`events.jsonl`) разведены: аудит — кто/что сделал с мутациями (комплаенс-контур K-05), события — сигнал перечитать состояние.

## 4. Границы / что НЕ делаем

- **Никакого ORM и миграционного фреймворка** (drizzle/prisma/knex/better-sqlite3-слой состояния) — в репо их нет by design; Bridge следует file-backed конвенции.
- **Никакого зеркалирования контента SiYuan** в файлы Craft: ни двусторонней синхронизации, ни копии notebook tree (ADR-003 «No shared database», ADR-005). `index.db` кэширует только содержимое наших же снапшотов/link-графа Bridge, а не базу знаний.
- **`index.db` никогда не source of truth**: обязан быть безболезненно удаляемым (`knowledge:rebuildIndex` восстанавливает из jsonl/json).
- **Нет общей SQLite-базы с ядром SiYuan** — доступ к данным SiYuan только через его публичный API (`SiyuanKernelClient`), ни прямого чтения его `.db`, ни правки файлов workspace SiYuan силами Craft.
- **Нет универсальной Entity-БД** для всех доменов (вердикт §15).
- **Нет пер-сущностных версий/истории** в stores на P1–P3 (история = audit.jsonl + proposals; content-версионирование — зона ответственности SiYuan).
- **Экспорт/импорт** knowledge-домена не входит в этот документ; когда появится — делать по образцу bundle v1 `memory-io.ts` (merge|replace).

## 5. Критерии приёмки

- [ ] Все пути из §3.5 создаются лениво через `resolveKnowledgePaths()`; ни один модуль не импортирует `CONFIG_DIR` напрямую (проверяется sandbox-тестом с `CRAFT_CONFIG_DIR=/tmp/...`, паттерн существующих storage-startup-tестов).
- [ ] Каждый канал из §3.2 добавлен в `channels.ts`, `events.ts` (push-канал), `HANDLED_CHANNELS` и ровно в один routing-сет; `routing.test.ts` зелёный без правок логики теста.
- [ ] Киллер-файл тест: повреждённая середина `links.jsonl` (битая строка) не роняет чтение; хвост читается полностью (повторяет контракт `parseAuditEntries`).
- [ ] Атомарность: убитый между tmp-записью и rename процесс не оставляет частично записанный `connections.json`/`proposals/<id>.json` (tmp-файлы подчищаются на старте `cleanupOrphanTmp`, прецедент из memory-io).
- [ ] `AuditLog.inDir({workspaceRoot}/knowledge, 'workspace')` используется без форка класса; ротация 10k/7k срабатывает на прогоне >maxLines.
- [ ] `index.db` удаляется в работающей системе → `knowledge:search` по снапшотам деградирует на jsonl-скан без ошибок; `rebuild` восстанавливает индекс.
- [ ] Тест `registration-profiles.test.ts` подтверждает регистрацию всех `knowledge:*` каналов в обоих профилях (GUI + headless).
- [ ] Секретов в файлах нет: `connections.json` содержит только `credentialRef`; токен читается только через `CredentialManager.get`.

## 6. Открытые вопросы

1. **Workspace-keyed vs глобальные соединения**: remote-режим (K-07) может потребовать per-workspace соединений (`{workspaceRoot}/knowledge/connections.json` вместо глобального). Решить на P1 по UX-наблюдению; миграция — перенос записи при сохранении.
2. **Предел вложенности `children` в ContextSnapshot**: предлагается capability-флаг провайдера `maxSnapshotDepth` (см. compatibility.ts), дефолт 3 — подтвердить на реальных документах SiYuan.
3. **Дедупликация снапшотов** по `(connectionId, ref.id, contentHash)` — экономия диска на повторных attach одного блока; усложняет GC подсчётом ссылок из сессий. Отложено до появления метрик объёма.
4. **Тип credential**: оставить `source_bearer` (ключ `source_bearer::{workspaceId}::siyuan-<connectionId>`) или расширить `VALID_CREDENTIAL_TYPES` значением `siyuan_token` для отдельного health-семафора — решить вместе с K-07 (remote TLS повышает ценность различения).
5. **Миграция notes → knowledge**: существующий `notes:*` домен концептуально пересекается с SiYuan (scout-ServerCore «Gaps»). Отношение notes↔SiYuan — предмет K-02; данный документ хранилище notes не трогает.
