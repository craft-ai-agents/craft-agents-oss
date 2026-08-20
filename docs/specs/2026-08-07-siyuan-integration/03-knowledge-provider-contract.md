# K-03 · Контракт KnowledgeProvider

| Поле | Значение |
|---|---|
| ID документа | `K-03` (`03-knowledge-provider-contract`) |
| Название | Контракт KnowledgeProvider: типы ссылок, интерфейс, реестр, RPC-интеграция |
| Статус | draft |
| Дата | 2026-08-07 |
| Входные документы | Вердикт «SiYuan ↔ Craft» (att1, §§3.3, 8, 9, 10, 11); scout-отчёты ServerCore / SkillsCloud / SurfacesBrowser (codebase@main); [K-01 · ADR](./01-adrs.md); [K-02 · Границы интеграции](./02-integration-boundaries.md); [K-07 · Режимы подключения](./07-connection-modes.md); [S-04 · Omnibox](../2026-08-07-unified-shell/04-omnibox.md) |

## Цель

Зафиксировать типобезопасный системный контракт, через который Craft (UI, сессии, автоматизации, агенты) работает с движком знаний: типы ссылок `CraftRef`/`KnowledgeRef`, полный интерфейс `KnowledgeProvider`, реестр провайдеров, причины, по которым MCP не является основой интеграции, и точный маппинг контракта на существующие точки расширения кодовой базы (RPC-loop, mention parser, routes).

## Контекст и мотивация

Исходный вердикт (att1) назначает Craft хозяином продукта, SiYuan — присоединяемым движком знаний, а между ними — Knowledge Integration Layer. Этап P1 роадмапа ([K-11 · Роадмап](./11-roadmap.md)) требует read-only провайдера: connection health, capability discovery, search, get, backlinks, deep links, @mention picker. Этап P3 добавляет безопасный write-back через proposals. Оба этапа невозможны специфицировать без единого контракта: без него UI, RPC-слой, mention-система и агентные инструменты начнут изобретать собственные ad-hoc форматы ссылок и API.

Существующая кодовая база уже содержит все «пазы» для такого контракта: механический RPC-loop (`packages/shared/src/protocol/channels.ts` → `routing.ts` → `handlers/rpc/*.ts` → `channel-map.ts`), домен notes как полный референс CRUD+search+backlinks RPC-поверхности (`packages/server-core/src/handlers/rpc/notes.ts`, 19 каналов), mention-грамматика `[skill:slug]` / `[source:slug]` (`packages/shared/src/mentions/index.ts`) и типобезопасные маршруты `routes.view.*` (`apps/electron/src/shared/routes.ts`). Контракт ниже спроектирован так, чтобы занять эти пазы без вторых конвенций.

## Решение

### 3.1 Адресуемые ссылки: CraftRef и KnowledgeRef

Исходные типы (att1 §3.3, verbatim):

```typescript
type CraftRef =
  | { scheme: "craft"; kind: "session" | "run" | "skill" | "automation"; id: string };
type KnowledgeRef = {
  scheme: "siyuan";
  kind: "notebook" | "document" | "block" | "database" | "asset";
  id: string;
};
```

Форма провайдера из интерфейса §9 (`provider: "siyuan"` вместо `scheme`) — это wire-форма того же ref. Канонический тип в `packages/knowledge-core/src/refs.ts` («новый компонент»; пакет из att1 §8) объединяет обе формы, не ломая верbatim-значения:

```typescript
// packages/knowledge-core/src/refs.ts
export type CraftRefKind = 'session' | 'run' | 'skill' | 'automation';

export interface CraftRef {
  scheme: 'craft';
  kind: CraftRefKind;
  id: string;
}

export type KnowledgeKind = 'notebook' | 'document' | 'block' | 'database' | 'asset';

export interface KnowledgeRef {
  /** att1 §3.3: всегда 'siyuan' для первой реализации; будущие провайдеры — свои scheme */
  scheme: 'siyuan';
  kind: KnowledgeKind;
  /** Стабильный id ядра SiYuan (document id / block id / notebook id) */
  id: string;
  /**
   * att1 §9 wire-форма. Присутствует в RPC-DTO; отсутствие == 'siyuan'.
   * Зарезервированные значения: 'siyuan' | 'obsidian' | 'notion' | 'memory' (InMemory).
   */
  provider?: string;
  /** Какое подключение (knowledge_connections.id, K-04) обслуживает ref; single-connection MVP */
  connectionId?: string;
}
```

Форматы @-ссылок (att1 §3.3) и их роли:

| Форма | Пример | Назначение |
|---|---|---|
| Отображение | `@siyuan/document/20240101120000-abcde` , `@craft/session/abc`, `@craft/run/def` | Читаемая форма в UI (mention picker, бейджи, инспектор) |
| Токен в тексте сообщения | `[knowledge:siyuan/block/20240101120000-abcde]` | Сериализация в markdown сообщений (как `[skill:slug]`, `[source:slug]`); парсится в shared/mentions |
| Deep link (external) | `siyuan://document/20240101120000-abcde` | Открытие нативного SiYuan (fallback `KnowledgeProvider.open`) |
| Внутренний маршрут | `knowledge/document/20240101120000-abcde` | Craft-навигация через `routes.view.knowledge()` (см. §3.5.3) |

Шесть сценариев применения @-ссылок (att1 §3.3, развёрнуто):

1. **Вставить в чат** — mention picker (`InlineMentionMenu`, расширение §3.5.2) вставляет токен `[knowledge:…]`; рендерится бейджем в `UserMessageBubble` через существующий `extractBadges`.
2. **Открыть** — клик по бейджу/ссылке → `navigate(routes.view.knowledge({kind, id}))` (§3.5.3) → KnowledgeSurface; вне Craft — `provider.open(ref)` → `siyuan://…`.
3. **Использовать как контекст** — из бейджа/инспектора: `getContext(ref, 'snapshot')` → `ContextPayload` сохраняется в `knowledge_context_snapshots` (хранение — [K-04](./04-bridge-storage.md)) и попадает в промпт сессии.
4. **Положить в автоматизацию** — токен `[knowledge:…]` в условиях/действиях автоматизации (триггеры и действия `knowledge.*` — [K-10](./10-skills-automations.md)).
5. **Показать в инспекторе** — KnowledgeInspector (новый компонент §8) отображает `get(ref)` → `KnowledgeNode` (WORK+KNOWLEDGE секции по att1 §6).
6. **Сохранить как связь** — пара `CraftRef ↔ KnowledgeRef` в `knowledge_links` (K-04) с `relation: 'attached' | 'published' | 'cites' | 'generated-from'`; рендерится как backlink-чипы в сессии и в инспекторе.

Serialize/parse-хелперы (новый компонент, `refs.ts`):

```typescript
export function serializeKnowledgeRef(ref: KnowledgeRef): string; // 'siyuan/block/<id>'
export function parseKnowledgeRef(text: string): KnowledgeRef | null;
export function serializeCraftRef(ref: CraftRef): string;         // 'craft/session/<id>'
export function parseCraftRef(text: string): CraftRef | null;
/** [knowledge:siyuan/block/<id>] → KnowledgeRef; компактная форма [knowledge:block/<id>] → default provider */
export const KNOWLEDGE_MENTION_PATTERN =
  /\[knowledge:(?:([a-z][a-z0-9-]*)\/)?(notebook|document|block|database|asset)\/([^\]\s]+)\]/g;
```

### 3.2 Интерфейс KnowledgeProvider

Исходный интерфейс (att1 §9, verbatim):

```typescript
type KnowledgeRef = { provider: "siyuan"; kind: "notebook"|"document"|"block"|"database"|"asset"; id: string };
type ContextMode = "snapshot" | "live-reference";
interface KnowledgeProvider {
  capabilities(): Promise<KnowledgeCapabilities>;
  search(input: SearchInput): Promise<SearchPage>;
  get(ref: KnowledgeRef): Promise<KnowledgeNode>;
  getContext(ref: KnowledgeRef, mode: ContextMode): Promise<ContextPayload>;
  proposeMutation(input: MutationInput): Promise<MutationProposal>;
  applyMutation(proposalId: string): Promise<ApplyResult>;
  open(ref: KnowledgeRef): Promise<void>;
}
```

Полные типы (`packages/knowledge-core/src/{provider,capabilities,context,mutations}.ts`, новые компоненты). Все поля обязательные, если не помечены `?`; никаких `any`:

```typescript
// capabilities.ts
export interface KnowledgeCapabilities {
  provider: string;               // 'siyuan'
  version: string;                // версия ядра, из health-check (compatibility.ts)
  minSupportedVersion: string;    // порог из packages/knowledge-siyuan/src/compatibility.ts
  features: {
    search: boolean;
    backlinks: boolean;
    attributes: boolean;
    databases: boolean;           // database/attribute views (att1 §4.3)
    assets: boolean;
    liveReference: boolean;       // поддержан режим getContext(ref, 'live-reference')
    watch: boolean;               // события изменений → knowledge:changed push
    deepLinks: boolean;           // стабильные deep links в нативный редактор
  };
  mutations: {
    createDocument: boolean;
    appendBlock: boolean;
    updateBlock: boolean;         // только explicitly selected block (att1 §11)
    setAttribute: boolean;        // только explicitly selected attribute
    transactions: boolean;        // мульти-оп атомарность; SiYuan: false → 1 op на proposal
    rollback: boolean;            // inversePatch сохраняется и применим
  };
}

// search (provider.ts)
export interface SearchInput {
  query: string;
  kinds?: KnowledgeKind[];        // default: ['document', 'block']
  notebookId?: string;
  pathPrefix?: string;            // '/Research/Reports'
  attributes?: Record<string, string>; // фильтр по SiYuan attributes (domain-сущности §4.3)
  limit?: number;                 // default 20, max 100
  cursor?: string;                // opaque курсор постраничности
}

export interface SearchHit {
  ref: KnowledgeRef;
  title: string;
  snippet: string;                // plain text с контекстом совпадения
  notebookPath: string;
  updatedAt: number;              // epoch ms
  score?: number;
}

export interface SearchPage {
  items: SearchHit[];
  nextCursor?: string;            // отсутствует = последняя страница
  totalEstimate?: number;
}

// get (provider.ts)
export interface KnowledgeAttribute { key: string; value: string; }

export interface KnowledgeNode {
  ref: KnowledgeRef;
  title: string;
  markdown?: string;              // для document/block
  parentRef?: KnowledgeRef;
  path: string;                   // '/Research/Reports/Craft × SiYuan'
  attributes: KnowledgeAttribute[];
  createdAt: number;
  updatedAt: number;
  contentHash: string;            // sha256 нормализованного markdown (см. Открытые вопросы)
  blockCount?: number;            // для document
}

// context.ts
export type ContextMode = 'snapshot' | 'live-reference';

export interface ContextPayload {
  ref: KnowledgeRef;
  mode: ContextMode;
  blockId: string;                                  // корневой block/document ID (att1 §11)
  content: string;                                  // markdown
  children: Array<{ blockId: string; content: string }>;
  backlinks: Array<{ ref: KnowledgeRef; title: string }>;
  attributes: KnowledgeAttribute[];
  capturedAt: number;                               // captured_at
  contentHash: string;                              // content_hash на момент захвата
  provenance?: { sessionId?: string; runId?: string };
}

// mutations.ts
export type MutationOp =
  | { type: 'create-document'; notebookId: string; path: string; markdown: string }
  | { type: 'append-block'; parentId: string; markdown: string }
  | { type: 'update-block'; blockId: string; markdown: string }
  | { type: 'set-attribute'; targetId: string; key: string; value: string };

export interface MutationInput {
  targetRef?: KnowledgeRef;       // обязателен для всех op, кроме create-document
  op: MutationOp;
  baseHash?: string;              // хэш цели, прочитанный агентом до генерации patch
  sessionId?: string;
  summary: string;                // человекочитаемое описание для Craft diff UI
}

export interface MutationProposal {
  id: string;
  connectionId: string;
  sessionId?: string;
  input: MutationInput;
  targetRef: KnowledgeRef;
  baseHash: string;               // зафиксирован при создании; перепроверяется на apply
  diffPreview: {
    before: string;               // markdown цели ДО
    after: string;                // после применения op
    unified?: string;             // unified diff для KnowledgeDiff.tsx (новый компонент §8)
  };
  inversePatch: MutationOp;       // обратная операция (rollback, ADR-004)
  status: 'pending' | 'approved' | 'applied' | 'conflicted' | 'discarded' | 'expired';
  createdAt: number;
  expiresAt: number;
}

export interface ApplyResult {
  proposalId: string;
  applied: boolean;
  conflicted: boolean;            // RE-READ: hash mismatch → applied=false (att1 §11 flow)
  currentHash?: string;           // фактический хэш при конфликте
  appliedAt?: number;
  createdRef?: KnowledgeRef;      // для create-document
  auditId?: string;               // запись в knowledge_audit_log (K-04)
}

// errors (provider.ts)
export type KnowledgeErrorCode =
  | 'CONNECTION_UNAVAILABLE'
  | 'UNSUPPORTED_OPERATION'      // capability выключена (P1: все mutations)
  | 'NOT_FOUND'
  | 'HASH_CONFLICT'
  | 'INVALID_REF'
  | 'CAPABILITY_DISABLED'        // запрещено permissions.json
  | 'PROVIDER_ERROR';

export class KnowledgeError extends Error {
  constructor(
    readonly code: KnowledgeErrorCode,
    message: string,
    readonly details?: unknown,
  ) { super(message); this.name = 'KnowledgeError'; }
}
```

Семантика методов и фаза ввода ([K-11](./11-roadmap.md)):

| Метод | Семантика | Ошибки | Фаза |
|---|---|---|---|
| `capabilities()` | Дешёвый discovery; кэшируется на время подключения; вызывается на health-check | `CONNECTION_UNAVAILABLE` | P1 |
| `search(input)` | Адаптер над SiYuan search/SQL (search-adapter.ts, §8); только трансляция, без копии индекса в Craft | `CONNECTION_UNAVAILABLE`, `PROVIDER_ERROR` | P1 |
| `get(ref)` | Полный узел: markdown, attributes, hash | `NOT_FOUND`, `INVALID_REF` | P1 |
| `getContext(ref, mode)` | `snapshot` — зафиксированный `ContextPayload` (воспроизводимый контекст сессии, хранится в K-04); `live-reference` — легковесный ref, который агент перечитывает перед выполнением | `NOT_FOUND`, `UNSUPPORTED_OPERATION` | P1 |
| `proposeMutation(input)` | READ TARGET → CAPTURE BASE HASH → APPLY PATCH LOCALLY → вернуть proposal c `diffPreview`+`inversePatch`; ничего не пишет в SiYuan | `HASH_CONFLICT`, `UNSUPPORTED_OPERATION`, `CAPABILITY_DISABLED` | P3 |
| `applyMutation(proposalId)` | RE-READ TARGET → HASH MATCHES? да → APPLY + AUDIT + STORE INVERSE; нет → `conflicted` | `HASH_CONFLICT`, `NOT_FOUND` | P3 |
| `open(ref)` | Резолвит ref в поверхность: deep link в нативный редактор или Craft-маршрут (§3.5.3) | `NOT_FOUND`, `CONNECTION_UNAVAILABLE` | P1 |

Полный flow mutate (READ → HASH → PATCH → CRAFT DIFF → APPROVE → RE-READ → HASH? → APPLY/AUDIT/INVERSE) и UI-дифф — предмет [K-05 · Безопасность мутаций](./05-mutation-safety.md); здесь фиксируется только типозапись.

### 3.3 Реестр провайдеров

Топология (att1 §9): `Craft UI → KnowledgeProvider { SiYuan (первый и наиболее глубокий), позже Obsidian/Notion, InMemoryProvider для тестов }`. Реестр — «новый компонент» `packages/knowledge-core/src/registry.ts`:

```typescript
export type KnowledgeProviderFactory = (connection: KnowledgeConnection) => KnowledgeProvider;

export interface KnowledgeConnection {
  id: string;                     // knowledge_connections.id (K-04)
  provider: string;               // 'siyuan'
  label: string;
  baseUrl?: string;               // external-local/remote режимы (K-07)
  status: 'connected' | 'degraded' | 'offline' | 'needs_auth';
}

export interface KnowledgeRegistry {
  registerProvider(scheme: string, factory: KnowledgeProviderFactory): void;
  connect(connection: KnowledgeConnection): Promise<KnowledgeProvider>;
  /** Разрешение ref → провайдер: по ref.provider/scheme, иначе default */
  resolve(ref: KnowledgeRef): KnowledgeProvider;
  defaultProvider(): KnowledgeProvider | null;
  list(): KnowledgeConnection[];
}
```

Решения реестра:

- **MVP — одно подключение SiYuan**: `resolve()` всегда возвращает его; мульти-подключение — поле `connectionId` уже заложено в `KnowledgeRef`, миграции API не потребуется.
- **InMemoryProvider** (`packages/knowledge-core/src/testing/in-memory-provider.ts`, новый компонент): полная реализация в памяти для unit/component-тестов. Контракт-конформанс обязателен для всех реализаций — по образцу `conformanceSuite` из `packages/cloud-runner/src/index.ts` (три провайдера `CloudRunProvider` проходят один набор тестов).
- **Obsidian/Notion** — только регистрация схемы; без собственного block-ID слоя получат деградированные `capabilities`.

### 3.4 Почему MCP — не основа интеграции (att1 §10)

Анти-паттерн (att1 §10, verbatim-логика): `Craft UI → LLM → MCP → SiYuan`. Почему он отклонён:

1. **UI зависит от модели**: поведение интерфейса (какие блоки прочитаны, какой diff показан) не должно определяться тем, что модель решила вызвать.
2. **Точный diff невозможен**: через текстовые ответы модели нельзя надёжно построить `diffPreview.before/after` и `unified`.
3. **Атомарность и конфликты**: hash-conflict check (RE-READ → COMPARE) — синхронное системное действие, а не цепочка tool calls, которую модель может прервать.
4. **Непрозрачный write-back**: аудит (`knowledge_audit_log`, K-04) не может опираться на самоотчёт модели.

Правильная схема — две поверхности над одним контрактом:

```
Craft UI / Inspector / Automations ──typed calls──▶ KnowledgeProvider ──▶ SiYuan kernel API
Agents (session LLM, skills, runs) ──▶ MCP facade ──▶ KnowledgeProvider ──▶ SiYuan kernel API
```

MCP — агентная поверхность; KnowledgeProvider — системная поверхность. MCP-facade («новый компонент» `packages/knowledge-mcp-server/`, упаковочный прецедент — stdio session-scoped `packages/session-mcp-server/src/index.ts`) экспонирует инструменты из att1 §2.5: `knowledge.search`, `knowledge.read`, `knowledge.get_backlinks`, `knowledge.get_context`, `knowledge.propose_update`, `knowledge.create_document`, `knowledge.set_attribute`, `knowledge.publish`. **Все write-инструменты facade транслируются в `proposeMutation`** (ADR-004: все записи агентов — через proposals); `applyMutation` агенту недоступен — применение только через Craft diff approval ([K-05](./05-mutation-safety.md)). Гейтинг по слоям разрешений: `blockedTools`/`alwaysAllow`/source-scoped `permissions.json` в `packages/shared/src/agent/permissions-config.ts` + `mode-types.ts` (поле `readOnlyMcpPatterns` — существующий прецедент read-only ограничения MCP-инструментов).

### 3.5 Маппинг на существующие точки кодовой базы

#### 3.5.1 Пакетная раскладка (att1 §8) и RPC-loop

Раскладка по att1 §8 с поправкой на существующую конвенцию каталогов (RPC-хендлеры живут в `handlers/rpc/<domain>.ts`, а не в корне `src/` — отклонение от буквы §8 сознательное, ради прецедента `handlers/rpc/notes.ts`):

```
packages/
├── knowledge-core/            # новый пакет (att1 §8)
│   └── src/ refs.ts, provider.ts, capabilities.ts, context.ts, mutations.ts,
│            registry.ts, publications.ts, projections.ts, testing/in-memory-provider.ts
└── knowledge-siyuan/          # новый пакет (att1 §8)
    └── src/ client.ts, provider.ts, search-adapter.ts, mutation-adapter.ts,
             deep-links.ts, compatibility.ts, process-adapter.ts

packages/server-core/src/
├── handlers/rpc/knowledge.ts            # registerKnowledgeHandlers + HANDLED_CHANNELS
│                                        # (в §8 назван knowledge-rpc.ts — перенесён в конвенцию домена)
├── services/publication-service.ts      # (§8 publication-service.ts; K-06)
└── services/knowledge-automation-actions.ts  # (§8; K-10)

apps/electron/src/main/  knowledge-surface-manager.ts, siyuan-process-manager.ts   # новые (§8; K-02/K-07)
apps/electron/src/renderer/components/knowledge/  KnowledgeHome.tsx, KnowledgeSidebar.tsx,
   KnowledgeSurface.tsx, KnowledgeInspector.tsx, KnowledgeMentionPicker.tsx,
   KnowledgeDiff.tsx, PublishSessionDialog.tsx                                      # новые (§8; K-02/K-06)
```

RPC-loop (по scout-ServerCore, механическая волна добавления каналов):

1. `packages/shared/src/protocol/channels.ts` — новый namespace `knowledge` (wire-строки `knowledge:camelCase`, как `notes:list`).
2. `packages/shared/src/protocol/routing.ts` — каждый канал ровно в одном set; CI-гейт `__tests__/routing.test.ts` (`LOCAL.size + REMOTE.size === все каналы`).
3. `packages/shared/src/protocol/events.ts` — `BroadcastEventMap[RPC_CHANNELS.knowledge.CHANGED] = [payload: KnowledgeChangedPayload]`; DTO в `dto.ts`.
4. `packages/server-core/src/handlers/rpc/knowledge.ts` — `registerKnowledgeHandlers(server, deps)`, `server.handle(RPC_CHANNELS.knowledge.X, …)`, broadcast через `pushTyped` (`transport/push.ts`).
5. `packages/server-core/src/handlers/rpc/index.ts` — добавить в `registerCoreRpcHandlers` → автоматически доступно и Electron main (`apps/electron/src/main/handlers/index.ts`, профиль `{browserPane:false}`), и headless-серверу (`packages/server/src/index.ts`).
6. Renderer: `apps/electron/src/transport/channel-map.ts` — `searchKnowledge: invoke(RPC_CHANNELS.knowledge.SEARCH)`, `onKnowledgeChanged: listener(RPC_CHANNELS.knowledge.CHANGED)` (хелперы `invoke()`/`listener()` существуют, строят `ElectronAPI` через `build-api.ts`).

Классификация маршрутизации (прецеденты из scout: notes/memory = REMOTE_ELIGIBLE как workspace-owned контент; contextDocs/marketplace = LOCAL_ONLY как локальная конфигурация; управление локальным движком = LOCAL_ONLY):

| Канал (`RPC_CHANNELS.knowledge.*`) | Payload (запрос → ответ) | Класс |
|---|---|---|
| `LIST_CONNECTIONS = 'knowledge:listConnections'` | `{}` → `KnowledgeConnection[]` | REMOTE_ELIGIBLE |
| `CAPABILITIES = 'knowledge:capabilities'` | `{ connectionId }` → `KnowledgeCapabilities` | REMOTE_ELIGIBLE |
| `SEARCH = 'knowledge:search'` | `{ connectionId, input: SearchInput }` → `SearchPage` | REMOTE_ELIGIBLE |
| `GET = 'knowledge:get'` | `{ connectionId, ref }` → `KnowledgeNode` | REMOTE_ELIGIBLE |
| `GET_CONTEXT = 'knowledge:getContext'` | `{ connectionId, ref, mode: ContextMode }` → `ContextPayload` | REMOTE_ELIGIBLE |
| `GET_BACKLINKS = 'knowledge:getBacklinks'` | `{ connectionId, ref }` → `ContextPayload['backlinks']` | REMOTE_ELIGIBLE |
| `PROPOSE_MUTATION = 'knowledge:proposeMutation'` | `{ connectionId, input: MutationInput }` → `MutationProposal` | REMOTE_ELIGIBLE |
| `GET_PROPOSAL = 'knowledge:getProposal'` | `{ proposalId }` → `MutationProposal` | REMOTE_ELIGIBLE |
| `APPLY_MUTATION = 'knowledge:applyMutation'` | `{ proposalId }` → `ApplyResult` | REMOTE_ELIGIBLE |
| `DISCARD_MUTATION = 'knowledge:discardMutation'` | `{ proposalId }` → `{ ok: true }` | REMOTE_ELIGIBLE |
| `ENGINE_STATUS = 'knowledge:engineStatus'` | `{ connectionId }` → `{ mode, running, pid?, version? }` | LOCAL_ONLY |
| `ENGINE_START = 'knowledge:engineStart'` / `ENGINE_STOP = 'knowledge:engineStop'` | `{ connectionId }` → `{ ok: true }` | LOCAL_ONLY |
| `CHANGED = 'knowledge:changed'` | push `[KnowledgeChangedPayload = { ref, change: 'created' \| 'updated' \| 'removed' }]` (events.ts) | REMOTE_ELIGIBLE |

Lifecycle/версии managed-ядра подробно — [K-07](./07-connection-modes.md); хранение proposals/snapshots/links/audit — [K-04](./04-bridge-storage.md) (jsonl-сторы по паттерну `MemoryFileStore`/`LessonStore`: atomic tmp+rename, без ORM и миграций — ограничение кодовой базы из scout-ServerCore: единственный SQLite репозитория — fail-soft FTS5-проекция `packages/server-core/src/memory/fts-index.ts`).

#### 3.5.2 Расширение mention parser (@-синтаксис)

Существующее (scout-SkillsCloud, проверено по коду):

- `packages/shared/src/mentions/index.ts` — `parseMentions(text, skillSlugs, sourceSlugs)` → `ParsedMentions { skills, invalidSkills, sources, files, folders }`; паттерны `[skill:slug]`, `[skill:workspaceId:slug]`, `[source:slug]`; `resolveSourceMentions` превращает `[source:github]` → семантический маркер `[Mentioned source: github]` (L174–178); `extractBadges` → `ContentBadge[]` (ре-экспорт через `apps/electron/src/renderer/lib/mentions.ts`).
- `apps/electron/src/renderer/components/ui/mention-menu.tsx` L14 — `MentionItemType = 'skill' | 'source' | 'file' | 'folder'`; `InlineMentionMenu({open, sections, onSelect, filter, position})` + `useInlineMention`; `MentionSection{id,label,items}`; rows меняют аватар по типу (`SkillAvatar`/`SourceAvatar`); скоринг 3/2/1 + subsequence.
- Подключение ввода: `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx` (~L1005 `useInlineMention({skills,sources,files})`, ~L1623 render меню).
- Прецедент кликабельных ссылок-знаний: `pages/ChatPage.tsx` ~L343–347 резолвит `notes/*.md` → навигация в NotesPage.

Изменения (все — локальные расширения существующих файлов; новые символы помечены):

| Файл | Изменение |
|---|---|
| `packages/shared/src/mentions/index.ts` | `ParsedMentions += knowledge: string[]` (сериализованные `siyuan/<kind>/<id>`); паттерн `KNOWLEDGE_MENTION_PATTERN` (§3.1); `resolveKnowledgeMentions(text)` → `[Knowledge: <kind> <id>]` (новая функция); `extractBadges` += knowledge-бейджи |
| `apps/electron/src/renderer/components/ui/mention-menu.tsx` | `MentionItemType += 'knowledge'` (L14); рендер строки через новый `KnowledgeAvatar` (новый компонент) |
| `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx` | `useInlineMention({skills, sources, files, knowledge})`: результаты `knowledge:search` RPC (debounce) складываются в `MentionSection{id:'knowledge', label:'Knowledge'}` |
| Insert-грамматика | Выбор в меню вставляет `[knowledge:siyuan/<kind>/<id>]`; в UI отображается как `@siyuan/<kind>/<id>`-бейдж |

#### 3.5.3 Deep links через routes view

Существующее (scout-SurfacesBrowser, проверено по коду): `apps/electron/src/shared/routes.ts` — типобезопасные билдеры `routes.view.*` (например `browser: (instanceId) => \`browser/instance/${id}\``, notes: `notes/note/${id}`); `apps/electron/src/shared/route-parser.ts` — route → `NavigationState.details` (ветка `{type:'browser', id}` ~L196); `MainContentPanel.tsx` — dispatch по `is*Navigation` guard → `ChatPage`/`BrowserPanelPage`/`NotesPage`; URL — единственный источник истины (`NavigationContext.tsx`, сериализация `?panels=`).

Изменения:

| Слой | Изменение (новый код) |
|---|---|
| `apps/electron/src/shared/routes.ts` | `routes.view.knowledge: (params?: { kind?: KnowledgeKind; id?: string })` → `knowledge` \| `knowledge/notebook/{id}` \| `knowledge/document/{id}` \| `knowledge/block/{id}` |
| `apps/electron/src/shared/route-parser.ts` | ветка `knowledge/<kind>/<id>` → `details: { type: 'knowledge', kind, id }` + guard `isKnowledgeNavigation` |
| `MainContentPanel.tsx` | ветка → `<KnowledgeSurface ref={ref} />` (новый компонент, §8) |
| Dedup-open | в `AppShell.tsx` (~L643, прецедент `parseSessionIdFromRoute`) добавить `parseKnowledgeKeyFromRoute` — повторный open фокусирует существующую панель |

`KnowledgeProvider.open(ref)` вElectron-реализации: renderer сам строит маршрут и вызывает `navigate(...)`; канала `knowledge:open` в таблице нет — навигация не RPC. Нативный fallback — `siyuan://document/<id>` через `deep-links.ts` (§8). MVP-поверхность: `BrowserPaneManager.createEmbeddedInstance({url: siyuanServerUrl})` уже грузит произвольные URL (scout), нового main-кода не требует; чистая точка — выделение `EmbeddedWebSurfaceManager` (K-02). Известный gap (scout): instance-id вида `browser-embedded-${n}` эфемерны и deep links не переживают рестарт → knowledge-маршруты ключируются только по `kind/id` из ref, инстанс лениво восстанавливается при навигации.

Cross-suite: omnibox [S-04](../2026-08-07-unified-shell/04-omnibox.md) — единая точка ввода @-ссылок всех схем; он потребляет этот контракт, не переопределяя его.

### 3.6 Версии и capability discovery

Handshake подключения: `capabilities()` → сверка `version >= minSupportedVersion` и включённых features (транспорт и условия запуска — [K-07](./07-connection-modes.md)). На фазе P1 каждая мутационная capability = `false`, и `proposeMutation/applyMutation` обязаны отвечать `KnowledgeError('UNSUPPORTED_OPERATION')`; InMemoryProvider конфигурирует capabilities тестово. Включение мутаций (P3) — сменой `mutations.*` в `capabilities`, без изменения интерфейса: UI и MCP-facade читают только его.

## Границы / что НЕ делаем

- **Никакого произвольного SQL write** в SiYuan (att1 §11): search-adapter может читать через SQL; запись — только четыре `MutationOp`.
- **Никаких bulk-операций** на первой версии: bulk delete, notebook delete, mass update, silent overwrite — запрещены (att1 §11); нет `bulk*` методов в интерфейсе и каналы типа `knowledge:bulkDelete` не вводятся.
- **MCP не основа интеграции**: UI никогда не идёт через LLM/MCP (§3.4); facade — только для агентов и только поверх того же провайдера.
- **Не копируем block-модель и граф backlinks в Craft** (ADR-003, no shared database): search/backlinks индексируются ядром; bridge хранит только интеграционное состояние ([K-04](./04-bridge-storage.md)).
- **Не переписываем редактор SiYuan** (att1 §4.2): `open()` ведёт во встроенную/нативную поверхность.
- **Не строим универсальную Entity-БД и двустороннюю синхронизацию метаданных** (att1 §6, §15).
- **Не вносим код SiYuan в monorepo** до решения лицензионного вопроса ([K-08](./08-licensing.md)): только публичный API ядра.

## Критерии приёмки

- [ ] `CraftRef`, `KnowledgeRef` приведены verbatim по att1 §3.3; все шесть сценариев применения @-ссылок описаны (§3.1).
- [ ] Интерфейс `KnowledgeProvider` verbatim по att1 §9; все вспомогательные типы (`KnowledgeCapabilities`, `SearchInput`/`SearchPage`/`SearchHit`, `KnowledgeNode`, `ContextPayload` с block ID/content/children/backlinks/attributes/captured_at/content_hash, `MutationInput`/`MutationProposal`/`ApplyResult`, `KnowledgeError`) — полный TypeScript без `any` и placeholder-полей (§3.2).
- [ ] Реестр: интерфейс `KnowledgeRegistry`, упомянуты минимум три реализации — SiYuan (первая), Obsidian/Notion (схема), `InMemoryProvider` (тесты) — и паттерн conformance по образцу `cloud-runner` (§3.3).
- [ ] Секция «Почему MCP — не основа» содержит ≥4 причины из att1 §10 и схему «UI → Provider; Agents → MCP facade → Provider» (§3.4).
- [ ] Таблица RPC-каналов включает `name / payload / routing class` для всех каналов; каждый классифицирован ровно один раз; указаны 6 шагов RPC-loop с реальными путями (`channels.ts`, `routing.ts`, `events.ts`, `handlers/rpc/knowledge.ts`, `handlers/rpc/index.ts`, `channel-map.ts`) (§3.5.1).
- [ ] Mention-расширение указано с реальными путями (`packages/shared/src/mentions/index.ts`, `mention-menu.tsx` L14, `FreeFormInput.tsx`) и грамматикой `[knowledge:…]` (§3.5.2).
- [ ] Deep links: реальные пути `routes.ts` / `route-parser.ts` / `MainContentPanel.tsx`, формат маршрутов `knowledge/<kind>/<id>` (§3.5.3).
- [ ] Раздел «Границы» явно содержит SQL write и bulk ops.
- [ ] Пакеты `knowledge-core`/`knowledge-siyuan` и их файлы перечислены по att1 §8 (§3.5.1).

## Открытые вопросы

1. **content_hash**: sha256 нормализованного markdown на стороне адаптера или хэш ядра, если появится в API? (влияет на `contentHash` и hash-conflict в [K-05](./05-mutation-safety.md)).
2. **Постраничность search**: opaque cursor поверх SiYuan `limit/offset` — как держать детерминизм при изменении индекса между страницами.
3. **block-anchor deep link**: как прокручивать встроенный редактор к конкретному `block`-ref (протокол поверх embedded pane; зависит от выбора KnowledgeSurface в [K-02](./02-integration-boundaries.md)).
4. **Эфемерность instance-id**: политика восстановления knowledge-панели после рестарта (гап из scout-SurfacesBrowser) — принадлежит ли решение `knowledge-surface-manager.ts` или общему surface-host [S-01](../2026-08-07-unified-shell/01-shell-slots.md).
5. **`watch`/`knowledge:changed`**: polling ядра vs webhook/WS — зависит от режима подключения ([K-07](./07-connection-modes.md)); feature-flag `capabilities.features.watch`.
6. **Разрешение компактной mention-формы `[knowledge:block/<id>]`** при >1 подключении: default provider против обязательного scheme-сегмента (MVP — default; зафиксировать до реализации §3.5.2).
