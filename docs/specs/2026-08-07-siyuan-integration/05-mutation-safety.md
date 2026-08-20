# K-05 · Безопасный контур записи: Mutation Proposals

> **ID документа:** K-05
> **Название:** Mutation safety — статусная машина предложений, hash-guarded apply, rollback, интеграция с permissions engine
> **Статус:** draft
> **Дата:** 2026-08-07
> **Входные документы:** вердикт архитектуры (local://att1-siyuan-verdict.md §11 контур 2, §16 P3), [K-01 ADR](./01-adrs.md) (ADR-004 «All agent writes use proposals»), [K-03 контракт провайдера](./03-knowledge-provider-contract.md) (`proposeMutation`/`applyMutation`), [K-04 хранилище Bridge](./04-bridge-storage.md) (proposals-store, audit-store, ContextSnapshot)

---

## 1. Цель

Специфицировать единственный допустимый способ изменить данные в SiYuan из Craft: конвейер **READ → BASE HASH → PATCH → DIFF → APPROVE → RE-READ → HASH CHECK → APPLY / CONFLICT → AUDIT + INVERSE PATCH**, оформленный как статусная машина `MutationProposal`. Документ фиксирует: разрешённые на старте операции и явно запрещённые, UX конфликтов, интеграцию с существующим permissions engine (`PermissionMode`, слоистые `permissions.json`), rollback через inverse patch и формат аудит-записей. Прямой вызов записывающих API ядра SiYuan из агента, автоматизации или UI в обход этого конвейера невозможен по построению (ADR-004).

## 2. Контекст и мотивация

SiYuan — канонический владелец знания (ADR-002): цена порчи данных там максимальна, а Craft — внешний клиент его API. Вердикт §11 контур 2 формулирует два жёстких требования:

1. «НИКАКОЙ прямой `updateBlock()` модели в Auto на первой версии» — даже в самом разрешающем permission-режиме запись идёт через proposal.
2. Flow с base-hash: применение разрешено только если цель не менялась между чтением и записью — это защита от silent overwrite чужих правок (пользователь мог редактировать тот же блок в самом SiYuan, пока агент готовил патч).

Существующий permissions engine репозитория — естественный второй контур защиты. Факты кодовой базы:

- `packages/shared/src/agent/mode-types.ts`: `PermissionMode = 'safe' | 'ask' | 'allow-all'` с каноническими именами `PermissionModeCanonical = 'explore' | 'ask' | 'execute'` (маппинг `PERMISSION_MODE_TO_CANONICAL`); `PERMISSION_MODE_CONFIG` описывает режимы: `'safe'` → «Explore: Read-only exploration. Blocks writes, never prompts», `'ask'` → «Ask to Edit», `'allow-all'` → execute-режим.
- Там же `PermissionsConfigSchema` (zod): `allowedBashPatterns`, `allowedMcpPatterns`, `allowedApiEndpoints` (правила `ApiEndpointRuleSchema` = method + path-паттерн), `allowedWritePaths`, `blockedTools`, `blockedCommandHints`. Ядро-записывающие инструменты (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`) захардкожены как заблокированные в Explore (`SAFE_MODE_CONFIG`) — прецедент «write запрещён безусловно в safe».
- `packages/shared/src/agent/permissions-config.ts`: слои `~/.craft-agent/permissions/default.json` (синкается `ensureDefaultPermissions()` из bundled) < workspace `{workspaceRoot}/permissions.json` < per-source `{workspaceRoot}/sources/{slug}/permissions.json`; слияние аддитивное (верхние слои могут только расширять разрешения); доступ через `loadWorkspacePermissionsConfig`, `loadSourcePermissionsConfig`, `isApiEndpointAllowed`.
- Агентские capabilities из вердикта §2.5 (`knowledge.search`, `knowledge.read`, `knowledge.create_document`, `knowledge.propose_update`, …) едут поверх этого engine как имена инструментов/endpoint-правил — новой системы разрешений не вводится.

## 3. Решение

### 3.1 Базовые сущности

```typescript
// packages/knowledge-core/src/mutations.ts — НОВЫЙ
type MutationProposalStatus =
  | 'draft'           // агент/пользователь собрал ops, base захвачен, diff ещё не показан
  | 'pending_review'  // diff построен и показан в KnowledgeDiff.tsx, ждёт решения пользователя
  | 'approved'        // пользователь одобрил; разрешён переход к apply
  | 'applying'        // RE-READ + HASH CHECK + APPLY в полёте (краткосрочный, есть timeout)
  | 'applied'         // записано в SiYuan; inverse patch сохранён
  | 'conflict'        // RE-READ показал baseHash != currentHash
  | 'rolled_back';    // applied, затем inverse patch применён (терминальное состояние цепочки)

/** Единственные операции, допустимые в v1 (белый список, §3.4.1). */
type MutationOp =
  | { op: 'createDocument'; notebook: string; path: string; title: string; markdown: string }
  | { op: 'appendBlock'; documentId: string; markdown: string }                       // в конец документа
  | { op: 'updateBlock'; blockId: string; markdown: string }                          // только explicitly selected
  | { op: 'setAttribute'; blockId: string; name: string; value: string };             // только explicitly selected

/** Доказательство «explicitly selected»: ссылка на выбор пользователя. */
interface SelectionProof {
  kind: 'surface-selection' | 'context-snapshot' | 'inspector-target';
  /** knowledge-surface selection id | snapshotId из K-04 | inspector ref+ts */
  selectionId: string;
  ref: KnowledgeRef;               // должен совпадать с целью op
  selectedAt: string;              // ISO; свежесть проверяется (см. §3.4.1)
}

interface MutationProposal {
  id: string;
  connectionId: string;
  sessionId?: string;              // сессия-инициатор (для agent/automation)
  targetRef: KnowledgeRef;         // ОДНА цель на proposal в v1 (один document или один block-db scope)
  ops: MutationOp[];
  selectionProofs: SelectionProof[]; // по одному на каждый op вида updateBlock/setAttribute
  baseHash: string;                // sha256 канонической сериализации цели при READ
  baseReadAt: string;              // ISO момента READ
  inverseOps?: MutationOp[];       // вычисляются при APPROVE из зафиксированного pre-state
  preState?: string;               // каноническая сериализация до apply (источник inverse, может быть большой → хранится отдельной секцией файла)
  hashAlgorithm: 'sha256-canonical-v1';
  status: MutationProposalStatus;
  statusHistory: Array<{ from: MutationProposalStatus; to: MutationProposalStatus; at: string; actor: Actor; reason?: string }>;
  conflictInfo?: { expectedHash: string; actualHash: string; currentContent: string };
  actor: 'user' | 'agent' | 'automation';
  approvedBy?: string;             // 'user' (v1: только человек) — под future delegation
  createdAt: string; updatedAt: string; appliedAt?: string; rolledBackAt?: string;
}
```

Физический формат файла — `MutationProposalFile` из [K-04 §3.3.4](./04-bridge-storage.md); `statusHistory` — часть файла, переписывается тем же tmp+rename протоколом.

**Хэш.** `contentHash`/`baseHash` — `sha256` канонической сериализации: UTF-8, нормализация `\r\n → \n`, trim конечных пробельных строк, стабильный порядок полей сериализатора провайдера (`mutation-adapter.ts` обязан читать цель тем же кодом, что `get()` провайдера, — иначе hash чувствителен к представлению). Тот же алгоритм использует `ContextSnapshot.contentHash` (K-04 §3.4) — единая точка определения: `canonicalizeForHash(node): string` в `knowledge-core/context.ts`.

### 3.2 Статусная машина

```
                 ┌──────────────────────────────────────────────────────────┐
                 │                                                          │
   READ+HASH     ▼                    diff UX                               │
 [создать] ──► draft ──buildDiff──► pending_review ──approve──► approved ──apply──► applying
                 ▲                      │   │                     │              │     │
                 │                      │   │                     │          hash OK  hash FAIL
                 │                      │   │ reject              │              ▼     ▼
                 │                      │   ▼                     │           applied  conflict
                 │                      │ [discarded: файл        │              │      │ rebase
                 │                      │  удаляется, audit]      │        rollback│      ▼ (новый READ)
                 │                      │                         │              ▼      draft (новый цикл)
                 └──────────────────────┴────────── rebase ───────┴──► rolled_back
```

Таблица переходов (все переходы пишутся в `statusHistory` и в `audit.jsonl`, §3.8):

| # | Переход | Guard (обязательное условие) | Сайд-эффекты | Инициатор |
|---|---|---|---|---|
| T1 | ∅ → `draft` | `ops` непустой; каждый op ∈ белого списка §3.4.1; `selectionProofs` валидны для updateBlock/setAttribute; permission-гейт §3.6 разрешает `propose` | READ цели через провайдера → `baseHash`,`baseReadAt`; файл proposals/ создан | agent / user / automation |
| T2 | `draft` → `pending_review` | diff успешно построен (base content + ops → текстовый diff) | payload в `knowledge:changed`; KnowledgeDiff.tsx рендерится | user (кнопка «Проверить») или auto при emerge в UI |
| T3 | `pending_review` → `approved` | явный клик approve пользователем; permission-гейт §3.6 разрешает apply-намерение в текущем mode | `inverseOps` вычисляются из `preState` (захваченного при T1) | user |
| T4 | `pending_review` → ∅ (discard) | — | файл удаляется; audit `knowledge.proposal.rejected` | user / timeout (TTL draft, §3.7) |
| T5 | `approved` → `applying` | НЕ истёк `approvalTtl` (см. §3.7); permission-гейт §3.6 в момент apply всё ещё ОК | RE-READ цели | user («Применить») / automation-approved |
| T6 | `applying` → `applied` | `sha256(reRead) === baseHash`; все ops успешно исполнены провайдером в одной последовательности | audit `applied`; `appliedAt`; RE-READ для verify → audit detail нового hash | система |
| T7 | `applying` → `conflict` | `sha256(reRead) !== baseHash` | НИЧЕГО не пишется в SiYuan; `conflictInfo`; audit `conflict`; push `knowledge:changed` | система |
| T8 | `applying` → `applying` (retry-once) | провайдер вернул транзиентную сеть-ошибку до первой записи | один retry с новым RE-READ; далее — only T6/T7 | система |
| T9 | `conflict` → `draft` (rebase) | пользователь выбрал «перечитать и пересобрать» | свежий READ → новый `baseHash`; ops пере-адаптированы или отмечены stale; старый proposal помечается `superseded` в `statusHistory` (файл не удаляется) | user |
| T10 | `applied` → `rolled_back` | permission-гейт §3.6; RE-READ: текущий hash == post-apply hash (иначе rollback сам конфликтует → T7-семантика с новым audit) | применение `inverseOps` как отдельного mutation-прохода (тот же HASH CHECK); audit `rolled_back` | user |
| T11 | любой терминальный (`applied`/`conflict`/`rolled_back`) | — | дальнейших переходов нет; повторный apply = новый proposal | — |

Инварианты:

- **Apply возможен только из `approved`** — нет пути `draft → applying` или `pending_review → applying`.
- **В `applying` запись в SiYuan начинается только после успешного HASH CHECK**; частично применённый proposal невозможен по контракту провайдера: `mutation-adapter.ts` исполняет ops строго последовательно и при ошибке op №k (k>1) немедленно применяет уже вычисленные inverse-шаги для op 1..k-1 (best-effort) и переводит proposal в `conflict` с `conflictInfo.reason='partial-apply-rolled-back'`. (SiYuan API не транзакционен — это компенсирующая, не транзакционная семантика; фиксируется честно в audit.)
- **Нет silent rebase**: повторный READ всегда инициируется пользователем (T9), никогда — автоматически подменой baseHash.
- **`approving` всегда человеческий** в v1: `actor='automation'` может создать proposal (T1), но T3 требует `approvedBy: 'user'`; делегированный auto-approve — открытый вопрос §6, запрещён до решения.

### 3.3 Поканальный flow конвейера

```
agent/user ──knowledge:proposeMutation────┐
                                          ▼
 bridge-service: VALIDATE ops (§3.4) ──► provider.get(target)      [READ]
                                     ► baseHash = sha256(canon)  [BASE HASH]
                                     ► capture preState
                                     ► proposals/<id>.json (draft)
                                          │ knowledge:changed
                                          ▼
 UI (KnowledgeDiff.tsx): base vs patched   [DIFF]     ──knowledge:approveProposal──► approved
                                          │                     + inverseOps
                                          ▼
 knowledge:applyProposal ──► provider.get(target)               [RE-READ]
                             hash == baseHash ? ──нет──► conflict [CONFLICT UX §3.5]
                                 │да
                                 ▼ provider.apply(ops)          [APPLY]
                                 ► audit + inverseOps persisted [AUDIT + INVERSE PATCH]
                                 ► verify re-read → applied
```

RPC-каналы задействованы: `knowledge:proposeMutation`, `knowledge:approveProposal`, `knowledge:rejectProposal`, `knowledge:applyProposal`, `knowledge:rollbackProposal`, `knowledge:getProposal`, `knowledge:listProposals` (классификация routing — [K-04 §3.2](./04-bridge-storage.md)).

### 3.4 Матрица операций

#### 3.4.1 Разрешённые на старте (P3, белый список)

| Op | Условия допуска при T1 | Исполнение на ядре |
|---|---|---|
| `createDocument` | notebook существует (проверяется READ при propose); path нормализован, без `..`; title непустой | `POST /api/filetree/createDocWithMd` |
| `appendBlock` | document существует; markdown ≤ `maxBlockBytes` (capability, дефолт 256 КБ) | `POST /api/block/appendBlock` |
| `updateBlock` | `selectionProof` свежий (≤ 24 ч) и `proof.ref.id === op.blockId`; блок существует в preState | `POST /api/block/updateBlock` |
| `setAttribute` | `selectionProof` на целевой block/document; `name` ∈ allowlist `craft-*`/`knowledge-*` префиксов (системные attrs SiYuan — только чтение) | `POST /api/attr/setBlockAttrs` |

«Explicitly selected» — машинно проверяемое условие: источники доказательства — выделение в `KnowledgeSurface` (selection events → server), `ContextSnapshot` (K-04: block был attach'нут в сессию пользователем), или явный target из `KnowledgeInspector`. Произвольный blockId из текста агента без proof → proposal отклоняется ещё в `bridge-service` с audit `knowledge.proposal.rejected` (reason `missing-selection-proof`).

#### 3.4.2 Запрещённые (v1, hard-coded в whitelist — отсутствие op в union `MutationOp` и есть запрет)

| Запрет | Механизм гарантии |
|---|---|
| bulk delete (несколько блоков/документов) | нет op типа delete в `MutationOp`; `removeBlock` API не вызывается ни одним адаптером |
| notebook delete | то же; notebook-уровневые write-API не оборачиваются в `SiyuanKernelClient` вовсе (клиент экспортирует только методы из таблицы §3.4.1 + чтение) |
| arbitrary SQL write | `search-adapter.ts` использует `/api/sql` **только для SELECT** (regex-guard `^\s*select\b`, иначе throw до сети); write-SQL endpoint не экспонируется клиентом |
| mass update (обновление по условию/фильтру) | `updateBlock` требует конкретный `blockId` + proof; нет op «обновить все, где attr=X» |
| silent overwrite | архитектурно невозможен: apply из любого статуса кроме `approved` отсутствует; T6 требует hash-match; rebase только ручной (T9) |

### 3.5 UX конфликта (T7)

Переход в `conflict` **ничего не записывает в SiYuan**. Пользователь видит:

1. Push `knowledge:changed` → в сессии и в Knowledge-разделе появляется карточка «Конфликт записи: документ изменился в SiYuan, пока вы проверяли правку».
2. `KnowledgeDiff.tsx` (новый компонент) в conflict-режиме — трёхколоночный вид:
   - **Base (что читал агент)** — preState, с пометкой времени `baseReadAt`;
   - **Текущее в SiYuan** — `conflictInfo.currentContent` с `actualHash`;
   - **Предлагаемый патч** — ops с подсветкой строк, которых больше нет в текущем состоянии (stale-пересечения маркируются).
3. Действия (только они, кнопок «перезаписать молча» нет):
   - **«Перечитать и пересобрать» (T9)** — новый READ, diff пересчитывается против свежего base; пользователь явно видит, что взял чужие правки за основу;
   - **«Отменить» (T4)** — proposal discarded, audit записан;
   - **«Открыть в SiYuan»** — deep-link в surface для ручного разбирательства.
4. `conflictInfo` хранится в файле proposal — конфликт переживает перезапуск приложения и ревидируется позже из списка `knowledge:listProposals {status:'conflict'}`.

### 3.6 Интеграция с permissions engine

Capability-имена из вердикта §2.5 привязываются к существующим полям `PermissionsConfigSchema` — ни нового движка, ни параллельной системы прав:

| Capability | Инструмент/канал | Поле permissions.json | Семантика |
|---|---|---|---|
| `knowledge.search`, `knowledge.read`, `knowledge.get_backlinks` | MCP-инструменты фасада + `knowledge:search`/`get`/`getBacklinks` RPC | `allowedMcpPatterns` (regex на имена инструментов) | чтение; в Explore (`safe`) разрешены всегда |
| `knowledge.create_document`, `knowledge.append_block`, `knowledge.propose_update`, `knowledge.set_attribute` | proposal-инструменты (создание T1) | `allowedMcpPatterns` + `blockedTools` | создание draft/pending_review — побочно свободно (ничего не пишет в SiYuan), но в `"safe"` блокируется вместе с core-write инструментами (прецедент `SAFE_MODE_CONFIG`) |
| исполнение записи в ядро | HTTP к kernel `/api/block/*`, `/api/attr/*`, `/api/filetree/*` | `allowedApiEndpoints` (`ApiEndpointRuleSchema`: method + path) | сетевой уровень: Bridge не открывает соединение на записывающие endpoints, если правило запрещает — проверка `isApiEndpointAllowed` в `SiyuanKernelClient` |

Матрица режимов (`PermissionMode` → поведение knowledge-контура):

| Mode (canonical) | Создание proposal (T1) | Approve (T3) | Apply (T5→T6) |
|---|---|---|---|
| `safe` (Explore) | запрещено (инструменты write-knowledge в `blockedTools` по умолчанию дефолтного слоя) | — | — |
| `ask` | разрешено | только руками пользователя | после approve; каждый apply виден и отменяем |
| `allow-all` (execute, «Auto» вердикта) | разрешено | только руками пользователя | после approve; авто-подтверждения нет — **прямых записей без proposal нет в любом режиме** |

Ключевое следствие: permission mode регулирует **доступ к операциям и видимость промптов**, но не обходит статусную машину. Различие «Auto» vs «Ask» в v1 сводится к тому, что в `ask` UI дополнительно подтверждает каждый переход, а в `allow-all` approve/apply делаются двумя явными кликами без промежуточных диалогов — но оба проходят T1→T3→T5→T6.

Слои конфигурации: дефолтный bundled `default.json` (синкается `ensureDefaultPermissions()` в `~/.craft-agent/permissions/default.json`) содержит базовые `blockedTools` для knowledge-write инструментов в safe; workspace `permissions.json` и per-source `{workspaceRoot}/sources/siyuan/permissions.json` (`getSourcePermissionsPath`, `loadSourcePermissionsConfig` — готовый слой, SiYuan оформляется как source, см. K-07) могут **расширять** разрешения (аддитивное слияние), но не ослаблять инвариант §3.2 (apprve-человек, hash-check) — он в коде, а не в конфиге.

Единая точка принуждения: `bridge-service.ts` вызывает `assertKnowledgeActionAllowed(action, ctx)` перед T1, T3, T5 и внутри `SiyuanKernelClient` при каждом записывающем HTTP (defense in depth: статусная машина + endpoint rules). `PermissionModeChange` — существующее событие автоматизаций (`APP_EVENTS`): его смена не ретроактивна — одобренный proposal остаётся approved, но apply перепроверяет mode в момент T5.

### 3.7 Сроки жизни и гигиена

- **TTL `draft`/`pending_review`**: 7 суток без решения → авто-T4 (discard) с audit (`reason='ttl-expired'`). Исполняется при загрузке `bridge-service` (lazy sweep, без нового планировщика — образец: minute-aligned `SchedulerService` уже существует, при P6 может переноситься туда).
- **TTL `approved`**: 24 часа; после — apply отклоняется (`approval-expired`), proposal возвращается в `pending_review` для свежего approve (сторож против «approve вчера — apply после недели чужих правок»). Дополнительная страховка — тем не менее основная: HASH CHECK в T6 не зависит от TTL.
- **Хранение**: applied/conflict/rolled_back proposals не удаляются (история); компактизация директории — задел будущего (открытый вопрос).

### 3.8 Rollback и формат аудита

**Rollback (T10).** `inverseOps` вычисляются при T3 из зафиксированного `preState`: для `updateBlock` — обратный `updateBlock` со старым markdown; для `setAttribute` — старое значение или `removeAttribute`-эквивалент (установка пустого) с записью прежнего значения в inverse; для `appendBlock` — siYuan-id вставленного блока фиксируется ответом apply, inverse = его удаление **не выполняется через removeBlock в v1** (delete запрещён) — вместо этого inverse для append = `updateBlock` на tombstone-строку `> _откачено Craft <ts>_` + `setAttribute craft-rolled-back=true` (soft-rollback, честно помеченный в документе). Для `createDocument` inverse = setAttribute `craft-rolled-back=true` + переименование в `… (откачено)` — физическое удаление документа так же запрещено. Rollback сам является mutation-проходом: RE-READ, hash-check против post-apply hash, запись, audit.

**Формат записи аудита** (`{workspaceRoot}/knowledge/audit.jsonl`, класс — адаптация `AuditLog`, формат наследует `AuditEntry` из `packages/shared/src/memory/types.ts`):

```json
{
  "ts": "2026-08-07T12:34:56.789Z",
  "scope": "workspace",
  "actor": "agent",
  "action": "knowledge.proposal.applied",
  "target": "siyuan://blocks/20260803120000-a1b2c3d",
  "detail": "{\"proposalId\":\"p_01J…\",\"ops\":[\"updateBlock\"],\"baseHash\":\"9f2c…\",\"postHash\":\"41de…\",\"appliedBy\":\"user\",\"sessionId\":\"s_123\"}"
}
```

Значения `action` (полный список): `knowledge.proposal.created`, `knowledge.proposal.reviewed`, `knowledge.proposal.approved`, `knowledge.proposal.rejected`, `knowledge.proposal.applied`, `knowledge.proposal.conflict`, `knowledge.proposal.rolled_back`, `knowledge.proposal.approval_expired`, `knowledge.snapshot.created`, `knowledge.publication.created`, `knowledge.link.added`, `knowledge.link.removed`. `actor` ∈ `user|agent|automation` (`AuditActor` union расширяется значением `'automation'` при необходимости — поле строковое union в shared/memory/types, точка расширения документируется в K-01 ADR). `detail` — JSON-строка с хэшами, ops, connectionId, sessionId/runId. Ротация и устойчивость к битым строкам наследуются от `AuditLog` (`AUDIT_LIMITS`, `parseAuditEntries`).

## 4. Границы / что НЕ делаем

- **Никаких прямых write** из агента/автоматизации/UI в SiYuan в обход pipeline — включая режим `allow-all` (требование вердикта §11 контур 2).
- **Нет multi-target транзакций** в v1: один proposal = один `targetRef`; связанные изменения оформляются цепочкой proposals.
- **Нет алгоритмического merge при конфликте** — только UX трёх версий и ручной rebase; auto-merge трёхсторонний отложен (и может не понадобиться никогда).
- **Нет физических удалений** через Bridge в v1 (ни блоков, ни документов, ни notebook) — rollback soft, delete-API не оборачивается клиентом.
- **Ручное редактирование в встроенном SiYuan-редакторе** (KnowledgeSurface) не проходит через этот конвейер — это пользователь, работающий в каноническом приложении; конвейер регулирует только записи, инициированные Craft (агентом, автоматизацией, кнопками UI).
- **Нет делегированного auto-approve** по правилам/автоматизациям в v1 (`approvedBy: 'user'` всегда) — см. открытый вопрос.
- **Нет очереди конкурирующих proposals на одну цель** (optimistic single-writer): второй proposal на тот же блок создаётся честно, конфликт всплывёт на HASH CHECK первого apply; сериализация per-target — будущее улучшение.

## 5. Критерии приёмки

- [ ] Таблица переходов §3.2 покрыта state-machine тестом: все T1–T11 выполняются на in-memory провайдере; любой переход вне таблицы — throw.
- [ ] Apply из статуса ≠ `approved` невозможен (тест на каждый иной статус).
- [ ] Изменение цели между READ и APPLY (прокладка-адаптер меняет контент) → T7 `conflict`, в SiYuan ноль записей, `conflictInfo` в файле.
- [ ] `updateBlock` без валидного `selectionProof` отклонён на T1 с audit `rejected/missing-selection-proof`.
- [ ] SQL-guard: `mutation-adapter`/`search-adapter` не исполняет не-SELECT (unit: строки `update …`, `insert …`, `delete …` → throw до сети).
- [ ] Режим `safe`: `knowledge:proposeMutation` с write-op отклонён permissions-гейтом; `knowledge:search` работает.
- [ ] Режим `allow-all`: единственный путь записи — через approved proposal; прямой `updateBlock` инструмент отсутствует в MCP-фасаде (проверка списка экспонируемых инструментов).
- [ ] Rollback applied-proposal: RE-READ hash-check, inverse применён, итоговый контент == `preState` (hash совпал), статус `rolled_back`, audit-цепочка `created→approved→applied→rolled_back` полна.
- [ ] Частичный сбой apply (адаптер падает на op 2/3): оп 1 откачен best-effort inverse, статус `conflict`, `reason='partial-apply-rolled-back'`, запись в audit.
- [ ] UX: конфликт-карточка рендерит три колонки (base/current/patch) и ровно три действия §3.5; «молчаливой перезаписи» в DOM нет.
- [ ] Формат audit-записи валидируется `parseAuditEntries` (ts/action обязательны, битая строка пропускается), ротация 10k/7k срабатывает.

## 6. Открытые вопросы

1. **Префикс-allowlist атрибутов**: достаточно ли `craft-*`/`knowledge-*`, или нужен workspace-конфиг `allowedAttrPatterns` (новое поле в `PermissionsConfigSchema`)? Решить на первом реальном кейсе database-строк (K-09).
2. **Отношение к SiYuan history**: ядро SiYuan ведёт свою историю снапшотов; стоит ли rollback дополнительно пытаться вызвать ядерный rollback (если API позволит) вместо inverse-patch? Требует research по `/api/history/*` — после P3.
3. **Hard-delete как отдельный proposal-тип v2**: если появится, потребует двойного approve и отдельного `inverseOps` = полный preState документа; не проектировать сейчас.
4. **TTL-константы** (7d draft, 24h approved) — вынести в `knowledge` секцию конфига workspace или оставить константами? Сейчас константы в `knowledge-core/mutations.ts`, образец `AUDIT_LIMITS`.
5. **Auto-approve по явному правилу пользователя** (например, «append в Inbox-документ без approve»): если вводить — только как per-workspace permissions-правило с записью в audit и отдельным ADR; в v1 запрещено.
