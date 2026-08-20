# K-06 · Публикация сессий в знания: пайплайн Session → Knowledge

> **ID документа:** K-06
> **Статус:** draft
> **Дата:** 2026-08-07
> **Владелец:** команда форка `agisota/craft-agents-oss`
> **Входные документы:** архитектурный вердикт «Craft — магистраль, SiYuan — присоединяемый орган» (§2.5 capabilities `knowledge.*`, §2.2 «Session = процесс работы; Document = принятый результат», §6 два типа метаданных, §8 структура Knowledge Bridge, §9 интерфейс KnowledgeProvider, §11 контур 3 «Публикация сессии», §12 схема Bridge-хранилища, §16 фаза P4); scout-отчёты по репозиторию `craft-agents` @ main: SkillsCloud (формат скиллов, permissions, cloud-runner, RPC), SessionsViews (модель сессии, меню, labels).
> **Связанные документы:** [K-01 ADR](./01-adrs.md) (ADR-004 — вся запись через proposals), [K-03 Контракт KnowledgeProvider](./03-knowledge-provider-contract.md) (capabilities и типы `KnowledgeRef`/`MutationProposal`), [K-04 Bridge storage](./04-bridge-storage.md) (таблицы `knowledge_links`, `knowledge_publications`, `knowledge_audit_log`), [K-05 Контур записи и mutation safety](./05-mutation-safety.md) (proposal/diff/approval/apply/audit/rollback), [K-07 Режимы подключения](./07-connection-modes.md), [K-10 Skills и автоматизации](./10-skills-automations.md). Соседний сьют: [S-02 Реестр поверхностей и вкладки](../2026-08-07-unified-shell/02-surface-registry-tabs.md) (хостинг поверхностей `diff`/`knowledge`).

---

## 1. Цель

Специфицировать единственный канонический путь, которым результат работы Craft (сессия или завершённый cloud run) становится долговечным знанием в SiYuan:

> Craft Session → Distill skill → Structured draft → Craft review/diff UI → выбор SiYuan notebook/path → Publish → cross-link + provenance.

Документ фиксирует: машину состояний публикации, формат черновика и provenance, спецификацию Distill-скилла (в существующем формате `SKILL.md`), UI-точки входа (`PublishSessionDialog.tsx`, надпись «Published to: …» в сессии), правила идемпотентной повторной публикации (update существующего документа вместо создания дублей), правила дистилляции (что никогда не публикуется автоматически) и связку с `packages/cloud-runner`.

Пайплайн — это фаза P4 дорожной карты вердикта (§16) и единственный производственный write-path, кроме прямого редактирования через [контур записи](./05-mutation-safety.md).

## 2. Контекст и мотивация

Craft — канонический владелец Session (messages, turns, tool calls, streaming, model/provider, permission mode, labels, flags; существующая модель — `packages/shared/src/sessions/types.ts`: `SessionConfig`, `SessionHeader`, `SESSION_PERSISTENT_FIELDS`). SiYuan — канонический владелец документов и блоков. Вердикт запрещает отождествлять их: **Session = процесс работы; Document = принятый результат работы** (вердикт §2.2). Между ними нужен явный, человеком подтверждаемый переход — без него возникают два провальных сценария:

1. **«Агент сам публикует»** — модель пишет в базу знаний по своему усмотрению. Запрещено ADR-004 ([K-01](./01-adrs.md)) и правилами контура записи (вердикт §11 контур 2): на первой версии разрешены только create document / append block / update explicitly selected block / set explicitly selected attribute, и всё это — через proposal+diff+approval из [K-05](./05-mutation-safety.md).
2. **«Копипаста»** — пользователь вручную переносит результат, теряя происхождение: какой сессией, каким прогоном, какой моделью и из каких исходных блоков получен текст. Provenance и перекрёстная ссылка (`craft-ref ↔ knowledge-ref`) — обязательная часть публикации, а не опция.

Существующая инфраструктура, на которую пайплайн опирается (ничего из этого не дублируется):

- **Cloud runner**: `packages/cloud-runner/src/types.ts` (`CloudRunProvider.createRun/getStatus/cancel/listArtifacts`, `RunState = 'queued'|'running'|'done'|'failed'|'cancelled'`, `ArtifactMeta{path,size}`), RPC `packages/server-core/src/handlers/rpc/cloud-runs.ts` — каналы `SUBMIT {topic, sessionId?}`, `IMPORT {runId, sessionId}`, `AGGREGATE {runId, sessionId, language?}`, `LIST_ARTIFACTS`, `READ_ARTIFACT {runId, path}`. Результат run попадает в сессию уже сегодня (IMPORT/AGGREGATE) — пайплайн публикации обязан работать и с этой связкой, и с прямой публикацией из run.
- **Скиллы**: каталоги `{slug}/SKILL.md` + YAML frontmatter, контракт `SkillMetadata{name,description,globs?,alwaysAllow?,icon?,requiredSources?}` из `packages/shared/src/skills/types.ts`; тиры загрузки project `.agents/skills` > workspace `skills/` > global `~/.agents/skills` (`packages/shared/src/skills/storage.ts`); bundled-набор копируется через `ensureBundledSkills()` (`packages/shared/src/skills/bundled.ts`); `requiredSources` автоматически подключаются SessionManager'ом при вызове скилла (`packages/server-core/src/sessions/SessionManager.ts`).
- **Permissions**: слоистый движок `packages/shared/src/agent/permissions-config.ts` + `mode-types.ts` (`PermissionModes explore(safe)/ask/execute(allow-all)`, поля `blockedTools/allowedApiEndpoints/…`) — естественный дом для гейтинга capabilities `knowledge.*` (gap-анализ scout'а: у скилла нет своей матрицы capabilities, она живёт в permissions-слоях — см. [K-03](./03-knowledge-provider-contract.md)).

## 3. Решение

### 3.1 Поток end-to-end

```
┌──────────────┐   (a) меню сессии «Publish to Knowledge…»   ┌────────────────────────┐
│ Craft Session│ ───────────────────────────────────────────▶ │ PublishSessionDialog   │
│  или CloudRun│   (b) кнопка на RunSurface (только done)     │ (новый компонент,      │
└──────┬───────┘                                              │  dialogs, 4 шага)      │
       │                                                      └─────────┬──────────────┘
       │ 1. DISTILL {sessionId, runIds?}                                 │
       ▼                                                                 ▼
┌────────────────────────┐  SKILL.md = спека дистилляции        ┌────────────────────┐
│ publication-service.ts │ ── LLM-вызов с инструкциями ───────▶ │ Distill skill      │
│ (новый, server-core)   │    скилла + транскрипт + артефакты   │ knowledge-distill  │
└──────┬─────────────────┘                                      └────────────────────┘
       │ 2. PublishDraft (markdown + summary + source_blocks + excluded + contentHash)
       ▼
┌────────────────────────┐  3. PREPARE {draftId,target}         ┌────────────────────┐
│ Ревью в диалоге:       │ ───────────────────────────────────▶ │ KnowledgeProvider  │
│ предпросмотр, список   │    create|update + baseHash          │ search/get         │
│ исключённого,          │                                      │ (K-03)             │
│ выбор notebook/path    │ ◀─────────────────────────────────── │
└──────┬─────────────────┘  баннер режима + diff (K-05)
       │ 4. APPLY {draftId,target}  →  proposeMutation → Craft Diff → USER APPROVES → applyMutation
       ▼
┌────────────────────────┐
│ SiYuan: create/update  │  provenance (атрибуты craft.* + YAML-блок в шапке документа)
│ document               │
└──────┬─────────────────┘
       │ 5. POST-COMMIT (только после успешного apply)
       ▼
  knowledge_publications (строка, provenance_json)      ┐
  knowledge_links (craft_ref ↔ knowledge_ref,           │  схема и владелец —
    relation='published')                               │  [K-04](./04-bridge-storage.md)
  knowledge_audit_log (action='publish.applied')        ┘
       │
       ▼
  Сессия: надпись «Published to: Research / Craft × SiYuan architecture» (вычисляется
  по knowledge_links, второй копии в модели сессии НЕ хранится)
```

Все пять шагов — RPC-вызовы одного диалога; состояние между ними не теряется при закрытии окна (черновик и заявка живут на сервере).

### 3.2 Машина состояний публикации

```typescript
// packages/knowledge-core/src/publications.ts (новый компонент)
export type PublicationStatus =
  | 'distilling'      // шаг 1: LLM дистиллирует, черновик ещё не готов
  | 'draft'           // черновик готов, ждёт ревью (терминальное состояние между сессиями UI)
  | 'target_pending'  // выбрана цель, PREPARE показал create|update
  | 'publishing'      // APPLY: proposal отклонён/применяется через контур K-05
  | 'published'       // документ записан, cross-link и provenance зафиксированы
  | 'conflict'        // baseHash не сошёлся на update — эскалация в диалог K-05
  | 'failed';         // ошибка провайдера/сети; retry допустим (идемпотентно, см. 3.6)
```

Переходы: `distilling → draft|failed`; `draft → target_pending → publishing → published|conflict|failed`. `conflict` возвращает пользователя в `target_pending` с новым PREPARE (re-read target, новый baseHash). Отмена диалога оставляет `draft` — черновик не удаляется.

### 3.3 Distill skill — спецификация в формате SKILL.md

Скилл поставляется **bundled** с Craft (копируется `ensureBundledSkills()`, `packages/shared/src/skills/bundled.ts`), slug `knowledge-distill`, файл `skills/knowledge-distill/SKILL.md`. Frontmatter — ровно по контракту `SkillMetadata` из `packages/shared/src/skills/types.ts` (те же поля, что выдаёт `craft-agent skill create --globs … --always-allow … --required-sources …`, см. `apps/electron/resources/docs/craft-cli.md`):

```yaml
---
name: Дистилляция сессии в знание
description: Превратить завершённую рабочую сессию Craft (или результат cloud run) в структурированный черновик знания для ревью и публикации в SiYuan. Use when a session or cloud run result is being prepared for publication into the knowledge base.
alwaysAllow:
  - knowledge.search
  - knowledge.read
  - knowledge.get_backlinks
requiredSources:
  - siyuan
---
```

Требования к содержимому и механике:

- **`alwaysAllow`** содержит **только read-only** capabilities из списка `knowledge.*` ([K-03](./03-knowledge-provider-contract.md)): дистиллятору нужно перечитывать исходные блоки (`knowledge.read`, `knowledge.get_backlinks`) и искать связанные документы (`knowledge.search`). `knowledge.publish`, `knowledge.create_document`, `knowledge.propose_update`, `knowledge.set_attribute` в `alwaysAllow` **запрещены**: запись не может быть pre-authorized скиллом; фактическая возможность записи определяется permissions-слоями (`packages/shared/src/agent/permissions-config.ts`, поле `allowedApiEndpoints`) и всегда завершается human approval в UI (ADR-004). В режиме `explore` (safe) публикация недоступна целиком; в `ask`/`execute` — доступна только через диалог.
- **`requiredSources: [siyuan]`** — при вызове скилла внутри сессии SessionManager автоматически подключает источник `siyuan` (механизм `requiredSources` → `buildServersFromSources`, `packages/server-core/src/sessions/SessionManager.ts`); регистрация самого источника — по образцу `ensureNotesSource()` (`packages/server-core/src/handlers/rpc/sources.ts`), режимы подключения — [K-07](./07-connection-modes.md).
- **`globs` не задаётся** — скилл не срабатывает по файловым паттернам; запускается явно (шаг 1 диалога) или `@`-упоминанием `[skill:knowledge-distill]` в чате (парсер mention'ов — `packages/shared/src/mentions`).
- **Два входа, одно поведение**: (а) `PublishSessionDialog` вызывает дистилляцию через RPC `knowledge.publish.DISTILL` — `publication-service.ts` исполняет SKILL.md как инструкцию к LLM-вызову над собранным входом; (б) агент внутри сессии вызывает тот же скилл mention'ом — тело SKILL.md гарантированно попадает в контекст (PrerequisiteManager заставляет модель прочитать файл до работы). Черновик в обоих случаях валидируется сервисом одинаково (3.4), поэтому «ручной» и «агентный» пути не расходятся.
- Тело SKILL.md (markdown после frontmatter) содержит правила дистилляции из 3.9 и выходной контракт: **строго один JSON-объект `PublishDraft`** — сервис парсит его, а не свободный текст.

### 3.4 Структурированный черновик (Structured draft)

```typescript
// packages/knowledge-core/src/publications.ts (новый компонент)
export interface PublishDraft {
  id: string;                       // draft_<uuid>
  sessionId?: string;               // отсутствует при прямой публикации из run (3.8)
  runIds: string[];                 // cloud runs, чьи артефакты вошли в черновик
  title: string;                    // предложенный заголовок документа
  markdown: string;                 // тело; конвертация markdown → SiYuan blocks — задача mutation-adapter'а (K-03)
  summary: string;                  // 3–5 предложений для шага ревью
  outline: Array<{ heading: string; blockCount: number }>;
  sourceBlocks: string[];           // siyuan://blocks/... — знания, на которые опирался текст
  sourceMessages: Array<{ sessionId: string; messageId: string }>; // опора на сессию
  excluded: ExcludedFragment[];     // что вырезано и почему (3.9) — показывается на ревью
  contentHash: string;              // sha256(markdown) — часть ключа идемпотентности
  model: { connectionSlug: string; modelId: string };  // → provenance.generated_by
  createdAt: number;
}

export interface ExcludedFragment {
  reason:
    | 'credential-like'    // похоже на секрет/токен
    | 'pii'                // персональные данные вне доверенных источников
    | 'raw-transcript'     // сырые логи tool calls, stack traces, JSON-дампы
    | 'unverified-claim'   // утверждение без опоры на source_blocks/сообщения
    | 'internal-id'        // служебные идентификаторы, не несущие знания
    | 'size-cap';          // превышение лимита фрагмента
  excerptHash: string;      // sha256 фрагмента; сам фрагмент в draft НЕ включается
  origin: 'session' | 'run-artifact' | 'source-block';
}
```

Валидация сервиса при приёме черновика: обязательные поля, `excluded[*].excerptHash` вместо сырого текста, лимит размера `markdown` (по аналогии с лимитами cloud-runner, `RunLimits` в `packages/cloud-runner/src/types.ts`), отказ при пустом списке опор (`sourceBlocks` + `sourceMessages` одновременно пусты быть не могут — публиковать «ниоткуда» нельзя).

### 3.5 Review/diff UI: `PublishSessionDialog.tsx`

**Новый компонент** `apps/electron/src/renderer/components/knowledge/PublishSessionDialog.tsx` (расположение — по карте вердикта §8; хостинг поверхностей `diff`/`knowledge` — по [S-02](../2026-08-07-unified-shell/02-surface-registry-tabs.md)). Точки входа:

- меню сессии — новый пункт «Publish to Knowledge…» рядом с существующими `StatusMenuItems/LabelMenuItems` (`apps/electron/src/renderer/components/app-shell/SessionMenuParts.tsx`, render-only паттерн меню);
- тулбар run-представления — кнопка активна только при `RunState === 'done'` (3.8);
- повторное открытие по надписи «Published to: …» в сессии — показывает историю публикаций (шаг «history»).

Четыре шага диалога:

1. **Distill** — прогресс `distilling`, затем предпросмотр: `title`, `summary`, `outline`, счётчик и список `excluded` (reason + origin, содержимое не показывается). Кнопки: «Re-distill» (новый LLM-вызов, новый `draftId`, старый черновик помечается superseded) и «Edit draft» (inline-редактирование `markdown`, пересчёт `contentHash`).
2. **Target** — выбор notebook и пути. Источник данных — `KnowledgeProvider.search/get` ([K-03](./03-knowledge-provider-contract.md)), capabilities `knowledge.search`/`knowledge.read`; поле пути с автодополнением по дереву документов; запоминание последних целей. Превью результирующего `siyuan://document/<id>` адреса.
3. **Review/apply** — баннер режима `create` (новый документ) или `update` (существующий, со ссылкой на него); для `update` — полный Craft Diff старого и нового содержимого через **новый компонент** `KnowledgeDiff.tsx` (та же карта §8), поверх общего контура approval из [K-05](./05-mutation-safety.md): `READ TARGET → CAPTURE BASE HASH → SHOW DIFF → USER APPROVES → RE-READ → HASH MATCHES? → APPLY + AUDIT + INVERSE PATCH`. Без явного подтверждения пользователя применение невозможно — в любом permission mode.
4. **Done** — карточка результата: deep link `siyuan://document/<id>` (копирование, открытие в KnowledgeSurface), сводка provenance, время применения. Ошибки: `conflict` → переход на шаг 2/3 с новым PREPARE; `failed` → retry APPLY (безопасен, 3.6).

### 3.6 Выбор цели и идемпотентная повторная публикация

`PREPARE {draftId, target}` resolves режим в два прохода:

1. **По bridge-хранилищу** ([K-04](./04-bridge-storage.md)): ищется `knowledge_links` с `craft_ref = {scheme:'craft', kind:'session', id: sessionId}` и `relation='published'`. Найдено → `mode:'update'`, цель = существующий `knowledge_ref`.
2. **По атрибутам SiYuan** (страховка от рассинхрона bridge): документ, доступный по целевому пути, опрашивается на атрибут `craft.source_session_id` (provenance, 3.7). Совпал с текущей сессией → `mode:'update'`.
3. Ни то, ни другое → `mode:'create'`. **Конфликт пути**: по целевому пути уже есть документ без craft-provenance → запрет silent overwrite (вердикт §11, запрещённые операции): диалог предлагает переименовать путь или явно «Adopt existing» — тогда документ получает craft-атрибуты и первый update идёт через тот же proposal/diff.

Гарантии идемпотентности:

- **Повторная публикация той же сессии** — это `update`, а не новый документ: дублей в SiYuan не возникает. Если `contentHash` нового черновика совпал с хранящимся в `knowledge_publications.provenance_json` — APPLY коротко замыкается: возвращается прежний `PublishResult` без обращения к SiYuan.
- **Двойной APPLY / двойной клик** — каждый APPLY материализуется в `MutationProposal` с уникальным `proposalId` ([K-05](./05-mutation-safety.md)); повторный вызов `applyMutation(proposalId)` по уже применённой заявке возвращает сохранённый `ApplyResult`, а не второй записи.
- **Retry после `failed`** — PREPARE/ APPLY без побочных эффектов до точки `applyMutation`; сетевая ошибка после успешного apply обнаруживается сверкой `craft.source_session_id` атрибута (проход 2) и трактуется как `update`.
- **Regression-guard на update нарушать нельзя**: инверс-патч и audit пишутся контуром K-05; rollback create-режима = proposal на удаление только что созданного документа (точечно разрешённая операция «delete own just-created document», тоже через approval).

### 3.7 Cross-link и provenance

Записывается **только после успешного apply**, атомарной транзакцией bridge (владелец схемы — [K-04](./04-bridge-storage.md)):

- `knowledge_links`: `craft_ref_json = {scheme:'craft', kind:'session', id:<sessionId>}` (и/или `kind:'run', id:<runId>`) ↔ `knowledge_ref_json = {scheme:'siyuan', kind:'document', id:<docId>}`, `relation='published'`, `created_at`. По этой строке работает обратная связь: из документа в сессию (session/run inspector показывает «Source») и из сессии в документ (надпись 3.10).
- `knowledge_publications`: `{id, session_id, run_id, target_ref_json, provenance_json, created_at}` — история всех публикаций (включая superseded-черновики: отдельная строка с `relation='superseded'` в links не создаётся, но publication-строка остаётся).
- `knowledge_audit_log`: `action='publish.applied'`, `actor_ref` (пользователь), `payload_json` (proposalId, contentHash, mode).

Provenance на стороне SiYuan (вердикт §11, блок приводится **дословно**):

```yaml
craft:
  source_session_id: session_123
  source_run_ids: [run_456]
  published_at: ...
  generated_by: { provider: ..., model: ... }
  source_blocks: [siyuan://blocks/...]
```

Заполняется из `PublishDraft`: `source_session_id` ← `sessionId`, `source_run_ids` ← `runIds`, `generated_by` ← `model` (`provider` = connectionSlug/model provider, `model` = modelId), `source_blocks` ← `sourceBlocks`, `published_at` ← время apply. Физически provenance хранится в двух формах: (а) машиночитаемые атрибуты документа `craft.source_session_id`, `craft.source_run_ids`, `craft.published_at`, `craft.content_hash` — через `knowledge.set_attribute` capability, ими пользуется проход 3.6(2); (б) человекочитаемый YAML-блок в шапке документа (первый блок, verbatim-формат выше) — чтобы происхождение было видно и в самом SiYuan, включая его мобильные клиенты. Дублирование осознанное: атрибуты — для машины, блок — для читателя; источником истины считаются атрибуты.

### 3.8 Связь с cloud runner

Два легальных сценария:

1. **Run → Session → Publish**: артефакты run уже импортируются в сессию существующими каналами `cloudRuns.IMPORT {runId, sessionId}` / `cloudRuns.AGGREGATE {runId, sessionId}` (`packages/server-core/src/handlers/rpc/cloud-runs.ts`). Далее — обычная публикация сессии; `runIds` черновика заполняются из связанных импортов, и в provenance попадают реальные `run_id`.
2. **Прямая публикация из run**: вход с тулбара RunSurface, доступна только при `RunState === 'done'` (тип в `packages/cloud-runner/src/types.ts`). Материал черновика — не транскрипт сессии, а артефакты run (`LIST_ARTIFACTS`/`READ_ARTIFACT`; типичный агрегат — `notes.md` подзадач); `draft.sessionId` отсутствует, `craft_ref` в links получает `kind:'run'`. Provenance обязательно несёт `source_run_ids` и (в атрибутах) провайдера run (`local|cloudflare|modal|e2b` из настроек cloud-runner) — строчка `run_id` в `knowledge_publications` для этого сценария обязательна, для session-only публикации остаётся `NULL` (схема — [K-04](./04-bridge-storage.md)).

Ограничения: отменённый/failed run не публикуется; артефакты проходят те же правила дистилляции (3.9) — `path_traversal`-защита путей уже обеспечена `assertSafeArtifactPath` (`packages/cloud-runner/src/types.ts`).

### 3.9 Правила дистилляции — что НЕ публикуется автоматически

Дистиллятор **обязан** исключать, диалог **обязан** показывать исключения, автопубликация **запрещена** в принципе:

| Правило | Реакция |
|---|---|
| Строки, похожие на секреты (токены, ключи, значения env, bearer, PEM-блоки) | `excluded.reason='credential-like'`; никогда не попадают в `markdown` и в draft |
| Персональные данные вне доверенных источников | `excluded.reason='pii'` |
| Сырые транскрипты: логи tool calls, stack traces, полные JSON-дампы, stream-потоки | `excluded.reason='raw-transcript'`; дистиллируются в выводы, не в цитаты |
| Утверждения без опоры (нет `sourceBlocks`/`sourceMessages`) | `excluded.reason='unverified-claim'` |
| Служебные идентификаторы и инструкции (системные промпты, тела SKILL.md, внутренние id) | `excluded.reason='internal-id'` |
| Любой publish-вызов без человеческого approval в диалоге | отвергается сервисом до провайдера (ADR-004) |

Ревью обязательно всегда: скилл не имеет пути записи (3.3), сервис не экспортирует RPC «publish without approval», а контур K-05 технически не позволяет apply без подтверждённого proposal.

### 3.10 Надпись «Published to: …» в сессии

Требование вердикта: `В сессии: «Published to: Research / Craft × SiYuan architecture»`. Реализация без второго источника истины:

- **Каноническое хранилище — `knowledge_links`** ([K-04](./04-bridge-storage.md)); модель сессии (`SessionConfig`/`SESSION_PERSISTENT_FIELDS`, `packages/shared/src/sessions/types.ts`) **не расширяется**: никаких новых полей, дублирующих ссылку.
- Отображение: инспектор/шапка сессии джойнит `knowledge_links` по `craft_ref` сессии и рендерит строку «Published to: \<notebook\> / \<path\>» как ссылку на KnowledgeSurface; повторный клик открывает `PublishSessionDialog` в режиме history.
- **Никакой автоматической синхронизации в labels** (запрет двойной правды, вердикт §6). Допустимая опция — явная пользовательская автоматизация вида «WHEN published THEN set label knowledge/published» — это домен [K-10](./10-skills-automations.md) и существующего механизма labels (auto-labels, `packages/shared/src/labels/`); пайплайн её не навязывает (см. «Открытые вопросы»).

### 3.11 RPC-поверхность

Новый namespace в реестре `RPC_CHANNELS` (`packages/shared/src/protocol/channels.ts`) с классификацией в `routing.ts` — по образцу notes (19 каналов, `packages/server-core/src/handlers/rpc/notes.ts`) и cloudRuns:

```
knowledge.publish.DISTILL   { sessionId?, runIds?, language? } → { draftId }            (async, → 'distilling')
knowledge.publish.GET_DRAFT { draftId }                        → PublishDraft
knowledge.publish.UPDATE_DRAFT { draftId, title?, markdown? }  → PublishDraft           (пересчёт contentHash)
knowledge.publish.PREPARE   { draftId, target }                → { mode:'create'|'update', docId?, baseHash? }
knowledge.publish.APPLY     { draftId, target }                → { proposalId }         (далее контур K-05)
knowledge.publish.LIST      { sessionId? runId? }              → PublicationRecord[]    (история + history-режим)
```

Оркестратор — **новый компонент** `packages/server-core/src/publication-service.ts` (расположение по вердикту §8); собственной БД у него нет — только таблицы bridge из [K-04](./04-bridge-storage.md) и вызовы `KnowledgeProvider` из [K-03](./03-knowledge-provider-contract.md).

## 4. Границы / что НЕ делаем

- **Никакой автопубликации**: ни скилл, ни автоматизация, ни `execute` permission mode не могут записать документ без human approval в Craft UI (ADR-004).
- **Никакой прямой записи скиллом**: `alwaysAllow` Distill-скилла ограничен read-only capabilities; `knowledge.publish` / `knowledge.propose_update` ему не выдаются.
- **Нетрактовка Session как документа**: транскрипт не мигрирует в SiYuan; публикуется только дистиллированный результат (вердикт §2.2).
- **Никаких новых полей в модели сессии** и никакой двусторонней синхронизации «link ↔ label/status» (вердикт §6); надпись «Published to: …» — производная от `knowledge_links`.
- **Никакого silent overwrite** по чужому пути и никаких массовых операций (bulk publish, mass update) — вердикт §11 контур 2.
- **Без копирования кода/данных SiYuan в монорепо**: вся запись — через `KnowledgeProvider` и HTTP/process boundary (лицензионная граница — [K-08](./08-licensing.md)).
- **Ассеты (картинки/файлы) в первой версии не заливаются**: draft — markdown-текст и ссылки; изображения остаются внешними ссылками (см. «Открытые вопросы»).
- Без rollback «в обход» K-05: откат любой публикации — это proposal того же контура (delete-own-document для create, inverse patch для update).

## 5. Критерии приёмки

- [ ] Полный flow сессии: меню → диалог → distill → ревью (видны `summary`/`outline`/`excluded`) → выбор notebook/path → publish → документ создан в SiYuan, в сессии видна надпись «Published to: …», клик открывает документ.
- [ ] Distill-скилл загружается через существующий механизм (`loadAllSkills`, `packages/shared/src/skills/storage.ts`), frontmatter валиден по `SkillMetadata`, read-only `alwaysAllow`, `requiredSources:[siyuan]` автоматически подключает источник.
- [ ] Provenance: в документе присутствует YAML-блок вердикта (verbatim) и атрибуты `craft.source_session_id` / `craft.source_run_ids` / `craft.published_at` / `craft.content_hash`; `generated_by` совпадает с моделью дистилляции.
- [ ] Cross-link: строка `knowledge_links` (relation='published') связывает `craft_ref` сессии/run и `knowledge_ref` документа; из документа видна обратная ссылка на сессию.
- [ ] Идемпотентность: повторная публикация той же сессии → режим `update` через proposal/diff из [K-05](./05-mutation-safety.md), дубликат документов не создаётся; apply с неизменным `contentHash` возвращает прежний результат без обращения к SiYuan; двойной клик APPLY даёт одну запись.
- [ ] Конфликт пути: документ без craft-provenance по целевому пути блокирует create до явного «Adopt existing» или смены пути.
- [ ] Правила дистилляции: фрагменты `credential-like`/`pii`/`raw-transcript`/`unverified-claim` отсутствуют в `markdown` и перечислены в `excluded`; approval обязателен при любом permission mode; в `explore` публикация недоступна.
- [ ] Cloud run: из `done`-run запускается прямая публикация, `run_id` присутствует в provenance и `knowledge_publications`; сценарий IMPORT→AGGREGATE→publish сохраняет `source_run_ids`.
- [ ] Аудит: на каждую применённую публикацию есть строка `knowledge_audit_log` с `action='publish.applied'`; rollback выполняется через контур K-05 (inverse patch / delete-own-document).
- [ ] История: `knowledge.publish.LIST` возвращает все публикации сессии/run, включая superseded-черновики; диалог в режиме history их показывает.

## 6. Открытые вопросы

1. **Ассеты**: как заливать изображения/файлы из черновика в SiYuan assets и переписывать ссылки; зависит от assets API в [K-03](./03-knowledge-provider-contract.md).
2. **Производная label для списка сессий**: нужен ли фильтруемый признак «опубликовано» (проекция `knowledge_links` в list-фильтр) и не нарушит ли это запрет двойной правды; альтернатива — явная автоматизация [K-10](./10-skills-automations.md).
3. **Re-distill после публикации**: допубликация новых правок поверх опубликованного (режим update) против superseded-цепочки документов; сейчас выбран update — требуется подтверждение UX-исследованием.
4. **Язык генерируемого документа**: следовать языку сессии, таргет-ноутбуку или явному параметру `language` (как у `cloudRuns.AGGREGATE`).
5. **Конкурентные диалоги**: два окна публикации одной сессии одновременно — блокировка черновика (`draftId` lock/TTL) или last-write-wins через конфликт baseHash в [K-05](./05-mutation-safety.md).
6. **Гранулярность `sourceMessages`**: достаточно ли ссылок `messageId` для проверяемости provenance или нужен адресуемый transcript-export формат.
