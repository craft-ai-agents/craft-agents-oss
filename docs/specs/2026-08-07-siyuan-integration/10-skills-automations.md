# K-10. Skills и автоматизации: knowledge-capabilities, триггеры и действия

- **Документ**: K-10 · suite K «Интеграция SiYuan в Craft» · `docs/specs/2026-08-07-siyuan-integration/`
- **Статус**: draft
- **Дата**: 2026-08-07
- **Входные документы**: «Вердикт» (исходный документ архитектурного решения, §§2.5, 2.6, Контур 2 — `local://att1-siyuan-verdict.md`); scout-отчёты SkillsCloud (`local://scout-SkillsCloud.md`) и ServerCore (`local://scout-ServerCore.md`), кодовая база `craft-agents @ 961c1f450`
- **Связанные документы**: [00-overview.md](./00-overview.md); [01-adrs.md](./01-adrs.md) (ADR-004, ADR-005); [03-knowledge-provider-contract.md](./03-knowledge-provider-contract.md) (§3.2 — методы провайдера); [04-bridge-storage.md](./04-bridge-storage.md) (audit); [05-mutation-safety.md](./05-mutation-safety.md) (Контур 2); [06-publication-pipeline.md](./06-publication-pipeline.md) (publish); [07-connection-modes.md](./07-connection-modes.md); [09-collection-view-engine.md](./09-collection-view-engine.md) (presetActions видов)

---

## 1. Цель

Определить, как существующие подсистемы Craft — **skills** (директории `{slug}/SKILL.md` + YAML frontmatter, 4-уровневая резолюция) и **automations** (event-bus с trigger/action union) — получают знаниевые возможности без строительства параллельных механизмов:

1. Таблица знаниевых capabilities скиллов: `knowledge.search / knowledge.read / knowledge.get_backlinks / knowledge.create_document / knowledge.propose_update / knowledge.publish / knowledge.set_attribute` («Вердикт» §2.5) — с точным маппингом на методы `KnowledgeProvider` ([03](./03-knowledge-provider-contract.md) §3.2) и на permissions engine.
2. Полный пример скилла `research-and-publish` («Вердикт» §2.5) в реальном формате `SKILL.md` кодовой базы.
3. Расширение `AutomationSystem`: пять новых триггеров (`knowledge.document.created/updated`, `knowledge.attribute.changed`, `knowledge.database.row.changed`, `knowledge.document.stale`) и шесть новых действий (`knowledge.create_document/append_block/propose_patch/set_attribute/link_session/publish_run`) — со схемами payload и механикой регистрации.
4. Сквозной сценарий «Вердикта» §2.6: `needs-research` → cloud run → report → `review`.

Документ отвечает фазе P6 ([11-roadmap.md](./11-roadmap.md)) и опирается на ADR-004: все записи агентов/автоматизаций — только через proposal-контур.

## 2. Контекст и мотивация

### 2.1 Скиллы сегодня

Скилл — директория `{slug}/SKILL.md` с YAML frontmatter (gray-matter), метаданные — плоский 6-полевой контракт `SkillMetadata` (`packages/shared/src/skills/types.ts`):

```typescript
// packages/shared/src/skills/types.ts (существующий контракт)
interface SkillMetadata {
  name: string;
  description: string;
  globs?: string[];
  alwaysAllow?: string[];      // имена инструментов, всегда разрешённые при активном скилле
  icon?: string;
  requiredSources?: string[];  // слаги sources для авто-подключения
}
```

Резолюция по ярусам (project `.agents/skills` > workspace `skills/` > global `~/.agents/skills` > OMP discovery; craft-скилл затеняет OMP-вариант), lifecycle вызова: @-mention → синтаксис `[skill:slug]` → `BaseAgent.extractSkillPaths` резолвит пути (без чтения) → `PrerequisiteManager` блокирует, пока модель реально не прочитала `SKILL.md` → `SessionManager` (~L6424–6445) авто-подключает `requiredSources` через `buildServersFromSources` + `setSourceServers`. Плюсами являются: нулевой новый жизненный цикл — knowledge-скиллы едут на существующем конвейере.

### 2.2 Permissions engine сегодня

Слоистый JSON: `~/.craft-agent/permissions/default.json` (синкается `ensureDefaultPermissions`) < workspace `permissions.json` < per-source `sources/{slug}/permissions.json` — аддитивно (следующий слой только смягчает). Схема — `PermissionsConfigSchema` (`packages/shared/src/agent/mode-types.ts:134`, zod), поля компилированного конфига: `blockedTools`, `allowedBashPatterns`, `allowedApiEndpoints`, `readOnlyMcpPatterns` (RegExp[] — какие MCP-инструменты доступны в safe/explore), `allowedWritePaths`, `blockedCommandHints`. Режимы сессии — `PermissionMode = 'safe' | 'ask' | 'allow-all'` (`mode-types.ts:24`; канонические UI-имена: explore/ask/execute). Именно сюда ложатся паттерны `knowledge.*`: для MCP-слоя через `readOnlyMcpPatterns`/`blockedTools`, для API-слоя через `allowedApiEndpoints` — **без единого нового поля схемы** (подтверждённый extension point, scout SkillsCloud §Capability/permission model).

### 2.3 Автоматизации сегодня

`AutomationSystem` (`packages/shared/src/automations/automation-system.ts`) — per-workspace фасад: `WorkspaceEventBus` (`event-bus.ts`, emit/history) + handlers + `automations.json` в корне workspace + опциональный scheduler. Ключевые факты кодовой базы:

- Триггеры: union `AppEvent` (`types.ts:15`) + константа `APP_EVENTS` (`types.ts:42`): `'LabelAdd','LabelRemove','LabelConfigChange','PermissionModeChange','FlagChange','SessionStatusChange','SchedulerTick'`; плюс `AgentEvent`/`AGENT_EVENTS` (хуки Claude SDK через `sdk-bridge.ts`).
- Матчер: `AutomationMatcher` (`types.ts:151`): `{ id?, name?, matcher (regex), cron (5-field), timezone, permissionMode, labels, enabled, conditions: AutomationCondition[], telegramTopic }`; конфиг — `AutomationsConfig` (`types.ts:185`): `Partial<Record<AutomationEvent, AutomationMatcher[]>>` в `{workspaceRoot}/automations.json`.
- Действия: union `AutomationAction = PromptAction | WebhookAction` (`types.ts:102`); исполнение — `handlers/prompt-handler.ts` и `handlers/webhook-handler.ts`; контракт хендлера — `AutomationHandler { subscribe(bus); dispose() }` (`handlers/types.ts`).
- Расписания: `SchedulerService` (`packages/shared/src/scheduler/scheduler-service.ts`) эмитит `SchedulerTick` каждую минуту (границе-выровненно); `cron-matcher.ts` матчит cron+timezone; `retry-scheduler.ts` — retry-очередь.
- История и аудит: `event-logger.ts` дописывает CloudEvents-записи в `{workspaceRoot}/events.jsonl`; `event-log-handler.ts` подписан на все события шины; история — `automations-history.jsonl` с крышками из `constants.ts` (20 записей/матчер, 1000 всего, усечение полей 2000 символов).

Добавление триггера = расширить `AppEvent` + `APP_EVENTS` + эмиттер + `validation.ts` + `schemas.ts`. Добавление действия = расширить union `AutomationAction` + новый handler (по контракту `subscribe/dispose`) + ветка `validation.ts` + `schemas.ts`. **Нулевой новой инфраструктуры** (scout ServerCore: «SchedulerService sync — zero new infra needed»; SiYuan-события предложено эмитить как `SiyuanSyncChange` — здесь мы уточняем это до пяти доменных knowledge-событий).

### 2.4 Что добавляет «Вердикт»

- §2.5 (skills): capability-список из семи `knowledge.*` и пример `research-and-publish`.
- §2.6 (automations): пять триггеров, шесть действий и сквозной пример: «WHEN SiYuan attr.status="needs-research" THEN create cloud run (skill=deep-research) ON SUCCESS create SiYuan report, link to row, status→"review"».
- Контур 2: разрешены только create document / append block / update explicitly selected block / set explicitly selected attribute; запрещены bulk delete, notebook delete, arbitrary SQL write, mass update, silent overwrite. Эти лимиты — floor для любого capability и любого automation action.

## 3. Решение

### 3.1 Knowledge capabilities скиллов → методы провайдера → разрешения

Capabilities экспонятся агенту как **MCP-инструменты** in-process сервера (паттерн `packages/session-mcp-server` + `packages/session-tools-core` — упаковочный прецедент): тонкий facade над `KnowledgeProvider`, а не прямые вызовы UI (§10 «Вердикта»: MCP — агентная поверхность, KnowledgeProvider — системная). Скилл запрашивает их через `alwaysAllow`/`requiredSources`, система — через permissions engine. Методы провайдера — по [03-knowledge-provider-contract.md](./03-knowledge-provider-contract.md) §3.2 (набор `capabilities() / search() / get() / getContext() / proposeMutation() / applyMutation() / open()`, verbatim att1 §9).

| Capability (имя MCP-инструмента) | Провайдер / слой исполнения | Класс доступа | Режим по умолчанию | Механизм разрешения |
|---|---|---|---|---|
| `knowledge.search` | `provider.search(input)` → `SearchPage` | read | `safe` (explore): разрешено | паттерн `knowledge.search` в `readOnlyMcpPatterns` per-source `permissions.json` |
| `knowledge.read` | `provider.get(ref)` + `provider.getContext(ref, mode)` (`'snapshot'`/`'live-reference'`) → `ContextPayload` | read | `safe` (explore): разрешено | `readOnlyMcpPatterns`; snapshot-режим по умолчанию, live-reference — параметр |
| `knowledge.get_backlinks` | backlinks — часть `ContextPayload` из `getContext`; тонкий доступ — RPC `knowledge:getBacklinks` | read | `safe` (explore): разрешено | `readOnlyMcpPatterns` |
| `knowledge.create_document` | `provider.proposeMutation({ ops: [{ type: 'create-document', ... }] })` → apply после approval | write-proposal | `ask` (создаёт proposal + diff для пользователя) | исключён из `readOnlyMcpPatterns`; gate — режим сессии; whitelist разрешённых op Контура 2 |
| `knowledge.propose_update` | `provider.proposeMutation({ baseHash, patch })` → `MutationProposal` (НИКОГДА auto-apply из скилла) | write-proposal | `ask` | то же; apply — только `applyMutation(proposalId)` из UI/Diff-контура ([05](./05-mutation-safety.md)) |
| `knowledge.set_attribute` | `MutationOp { type: 'set-attribute', name, value }` через `proposeMutation`; apply по approval | write-proposal | `ask`; auto-apply запрещён, если атрибут не в allow-list матчера (см. §3.5) | то же + проверка «explicitly selected attribute» Контура 2 |
| `knowledge.publish` | **НЕ метод провайдера**: pipeline публикации сессии/рана ([06-publication-pipeline.md](./06-publication-pipeline.md)), facade-инструмент над publication-service | write-apply (создаёт документ + provenance + cross-link) | `ask` (review обязателен) | то же + обязательный review-шаг Контура 3 |

Механика насечек по слоям (все три существуют сегодня — новых механизмов не вводим):

1. **Skill-уровень**: `alwaysAllow: ["knowledge.search", "knowledge.read", "knowledge.get_backlinks"]` — скилл декларирует read-capabilities как не-intrusive; UI (`SkillInfoPage`) уже рендерит alwaysAllow. Записывающие capabilities в `alwaysAllow` **запрещены конвенцией** — `propose_*`, `create_document`, `set_attribute`, `publish` обязаны проходить `ask`; положение enforce'ится валидацией скилла (новая проверка в skills validation — «новый компонент», навязан ADR-004).
2. **Permissions-уровень**: per-source `sources/siyuan/permissions.json` (source `siyuan` создаётся по прецеденту `ensureNotesSource`, см. [07-connection-modes.md](./07-connection-modes.md)): `readOnlyMcpPatterns: ["^knowledge\\.(search|read|get_backlinks)$"]`, `blockedTools` по вкусу (`^knowledge\\.publish$` для строгих workspace), `allowedWritePaths` не применим (нет файлового доступа — SiYuan за API).
3. **Сессионный режим**: `PermissionMode` решает, читает ли агент свободно (в explore видны read-only паттерны), спрашивает ли (`ask` — дефолт для write-proposal) или имеет allow-all. **Ограничение floor**: даже `allow-all` не превращает `propose_update` в apply — hash-conflict check и approval остаются в контуре записи ниже permissions-слоя ([05-mutation-safety.md](./05-mutation-safety.md), ADR-004).

### 3.2 Пример: скилл `research-and-publish`

Канонический пример «Вердикта» §2.5 (verbatim):

```yaml
name: research-and-publish
input:
  knowledge_ref: siyuan://blocks/...
capabilities: [web.search, browser.navigate, knowledge.read, knowledge.propose_update]
output: { type: siyuan_document, destination: /Research/Reports }
```

Полный `SKILL.md` в формате кодовой базы (`packages/shared/src/skills/types.ts`), с маппингом полей «Вердикта»:

```markdown
---
name: research-and-publish
description: "Прочитать узел знаний SiYuan, провести веб-рисёрч по его теме и предложить обновление документа (proposal + diff) либо опубликовать отчёт в /Research/Reports."
globs: []                        # скилл вызывается явно (@-mention), не по файловым глобам
alwaysAllow:
  - knowledge.search
  - knowledge.read
  - knowledge.get_backlinks
icon: research-publish.svg
requiredSources:
  - siyuan                       # auto-enable SiYuan source (07-connection-modes.md); SessionManager ~L6424
---

# research-and-publish

## Вход (`input`)
Один аргумент — knowledge ref: `siyuan://blocks/<id>` или `siyuan://documents/<id>`
(грамматика `[knowledge:…]` mentions — новый MentionItemType, scout SkillsCloud §Gaps #5).
Получи контекст через `knowledge.read` в режиме `snapshot` (воспроизводимость);
backlinks — через `knowledge.get_backlinks` для карты смежных документов.

## Порядок работы
1. READ: `knowledge.read(ref, mode: "snapshot")` → зафиксируй `content_hash`.
2. RESEARCH: web.search / browser.navigate по теме узла; источники фиксируй списком.
3. SYNTHESIZE: сопоставь найденное с текущим содержимым; ничего не переписывай молча.
4. WRITE — один из двух исходов:
   a. Обновление существующего документа → `knowledge.propose_update`
      (patch против захваченного base hash; пользователь увидит Craft Diff и примет/отклонит);
   b. Новый отчёт → `knowledge.publish` в notebook `Research`, путь `/Research/Reports/<slug>`.

## Контракт выхода (`output`)
- type: siyuan_document; destination: `/Research/Reports` (для исхода 4b);
  либо `MutationProposal` (для исхода 4a).
- Provenance обязателен: source_session_id, source_blocks (все читанные siyuan:// refs),
  web-источники, модель (по Контуру 3, 06-publication-pipeline.md).

## Запреты
- Не вызывать `knowledge.create_document`/`propose_update` массово (по одному целевому узлу).
- Не записывать вне `/Research/Reports` без явного запроса пользователя.
- Bulk delete / SQL write / silent overwrite — запрещены на уровне контура записи.
```

Маппинг полей «Вердикта» на существующий формат: `capabilities` → `alwaysAllow` (read-часть) + per-source `permissions.json` (весь набор) + `requiredSources`; `input` → секция «Вход» тела (MCP-инструмент принимает ref параметром); `output` → секция «Контракт выхода» тела. Поля `input`/`output` как **структурные** frontmatter-ключи — возможное будущее расширение `SkillMetadata` («новый компонент», вне объёма v1 — см. Открытые вопросы).

### 3.3 Расширение AutomationSystem: механика регистрации

Триггеры. В `packages/shared/src/automations/types.ts` к `AppEvent`-union и `APP_EVENTS` добавляются пять литералов (multi-word события в camel-стиле существующих `'LabelAdd'` — берём точечные `'KnowledgeDocumentCreated'` и т.д.; ключи-строки в `AutomationsConfig`):

```typescript
// types.ts — расширение union (добавляемые литералы)
export type AppEvent = /* …существующие… */
  | 'KnowledgeDocumentCreated' | 'KnowledgeDocumentUpdated'
  | 'KnowledgeAttributeChanged' | 'KnowledgeDatabaseRowChanged'
  | 'KnowledgeDocumentStale';
```

Эмиттер — `KnowledgeChangeWatcher` (серверный модуль рядом с `packages/server-core/src/knowledge-rpc.ts` / `knowledge-automation-actions.ts` по структуре §8 «Вердикта»): v1 — поллер по `provider.search`/snapshot-diff с защитой `content_hash` и attribute-diff поверх `Capabilities` провайдера (push-стрим из SiYuan отсутствует — поллинг «новый компонент», интервал из конфига соединения, дефолт 60 s); валидируется через `validation.ts`, JSON-схемы матчеров — `schemas.ts`.

Действия. `AutomationAction` расширяется `KnowledgeAction`; исполнитель — новый `handlers/knowledge-handler.ts` с контрактом `AutomationHandler { subscribe(bus); dispose() }` (как `prompt-handler.ts`/`webhook-handler.ts`), делегирующий в `packages/server-core/src/knowledge-automation-actions.ts` → `KnowledgeProvider`. История/retries/аудит — существующие `event-logger.ts`, `retry-scheduler.ts`, `automations-history.jsonl` + `knowledge_audit_log` ([04-bridge-storage.md](./04-bridge-storage.md)) с `actor_ref = automation:<id>`.

### 3.4 Таблица новых триггеров

| Триггер (AppEvent) | Источник (v1) | Payload (JSON) | Условия матчера (`conditions`) |
|---|---|---|---|
| `KnowledgeDocumentCreated` | поллер: diff списка документов по `search`/tree | `{"ref":{"scheme":"siyuan","kind":"document","id":"…"},"notebookId":"…","path":"/Research/…","title":"…","createdAt":1754572800,"attrs":{…}}` | `notebookId`, `pathPrefix`, `title` (через общее regex-поле `matcher`) |
| `KnowledgeDocumentUpdated` | поллер: `content_hash` документа изменился | `{"ref":{…},"contentHashBefore":"…","contentHashAfter":"…","updatedAt":…,"editor":"external"}` | `notebookId`, `pathPrefix`, `minChangedBlocks?` (эвристика из diff-size поля payload) |
| `KnowledgeAttributeChanged` | поллер: attribute-diff строк/блоков БД | `{"ref":{…},"databaseId":"…","rowId":"…","attribute":{"name":"workflow_status","type":"select"},"oldValue":"open","newValue":"needs-research","changedAt":…}` | `databaseId`, `attribute.name`, `newValue` (eq/regex), `oldValue?` |
| `KnowledgeDatabaseRowChanged` | поллер: diff строк attribute-view | `{"database":{"scheme":"siyuan","kind":"database","id":"…"},"row":{"blockId":"…","ref":{…}},"changeKind":"created\|updated","changedAttributes":{"status":{"old":"…","new":"…"}},"changedAt":…}` | `databaseId`, `changeKind`, по `changedAttributes.<name>.new` |
| `KnowledgeDocumentStale` | вычисляемое: cron-тик `SchedulerService` (раз/сутки) + запрос документов с `updatedAt < now - staleAfterDays` или `attrs.valid_until < now` | `{"ref":{…},"lastUpdatedAt":…,"staleAfterDays":90,"validUntil":null,"attrs":{…},"computedAt":…}` | `staleAfterDays`, `notebookId`, `pathPrefix`, `attr.validUntil set\|expired` |

Общее: payload кладётся в событие шины и виден `event-log-handler` → `events.jsonl`; условия — существующие `AutomationCondition` (`conditions.ts`), новых типов условий не требуется (path-prefix и regex покрытыми операторами); wildcard-поля payload адресуются через существующую интерполяцию `{{event.*}}` в prompt/webhook template.

### 3.5 Таблица новых действий

Все действия — один вариант union `KnowledgeAction { type: 'knowledge', op: …, params: … }` либо шесть раздельных литералов `type: 'knowledge.create_document' | …` — выбираем **шесть литералов** (плоский union читается в `AutomationsConfig` и совместим с существующим switch).

| Действие (type) | Payload params (JSON-schema, выдержки) | Исполнение | Ограничения безопасности (floor Контура 2) |
|---|---|---|---|
| `knowledge.create_document` | `{"notebook":"Research","path":"/Research/Reports/<slug>","markdown":"…\n","attributes":{"workflow_status":"review"}, "provenance":{"automationId":"…","sessionId":"…","runId":"…"}}` | `proposeMutation` op `create-document` + auto-apply (разрешённый op) | путь ограничен prefix-allow-list из матчера; provenance обязателен; аудит + inverse (пустой delete-оператор запрещён — rollback = архивация, см. [05](./05-mutation-safety.md)) |
| `knowledge.append_block` | `{"parentRef":{"kind":"document","id":"…"},"markdown":"…","position":"end"}` | op `append-block` + auto-apply | только append (не insert-в-середину); parentRef валидируется существованием через `provider.get` |
| `knowledge.propose_patch` | `{"targetRef":{…},"baseHash":"…","patch":[{op:"replace-block","blockId":"…","markdown":"…"}],"rationale":"…","notify":{"channel":"ui"}}` | `proposeMutation` → proposal в статусе `pending` | **никогда не auto-apply**; результат — уведомление + запись в `knowledge_mutation_proposals` ([04](./04-bridge-storage.md)); apply — из diff UI |
| `knowledge.set_attribute` | `{"targetRef":{…},"databaseId":"…","name":"workflow_status","value":"review"}` | op `set-attribute` через `proposeMutation` + auto-apply **только если** `name` в `attributeAllowList` матчера | вне allow-list — деградация до proposal (pending); запрет mass-update: одна цель на один вызов |
| `knowledge.link_session` | `{"knowledgeRef":{…},"craftRef":{"scheme":"craft","kind":"session","id":"…"},"relation":"produced-by"}` | запись в `knowledge_links` ([04](./04-bridge-storage.md)) | Craft-side запись, SiYuan не затрагивается — всегда безопасно |
| `knowledge.publish_run` | `{"runId":"…","targetNotebook":"Research","targetPath":"/Research/Reports","distillSkill":"distill-report","review":"required"}` | pipeline [06-publication-pipeline.md](./06-publication-pipeline.md): distill → draft → review → publish → `knowledge_publications` + cross-link | `review: "required"` — единственное значение в v1; auto-publish запрещён ADR-004 |

Дополнительное (не-knowledge) действие, требуемое сквозным сценарием — выходит за список §2.6 «Вердикта», но есть прямое следствие «THEN create cloud run»: `cloud_run.submit` — `{"specTemplate":"deep-research","topic":"…{{event.attrs.topic}}…","skillSlug":"deep-research","limits":{…},"labels":["knowledge-triggered"],"callbackTag":"{{event.ref.id}}"}`, исполнение через существующий `cloudRuns.SUBMIT` RPC ([11-roadmap.md](./11-roadmap.md), P6). Аналогично — завершающее событие ранна: расширение `AppEvent` литералом `'CloudRunCompleted'` (источник — `subscribeEvents` tail `events.jsonl` cloud-runner, `packages/cloud-runner/src/local-provider.ts`).

### 3.6 Сквозной сценарий: needs-research → cloud run → report → review

Исходная формулировка («Вердикт» §2.6): «WHEN SiYuan attr.status="needs-research" THEN create cloud run (skill=deep-research) ON SUCCESS create SiYuan report, link to row, status→"review"». Разложение на две автоматизации (цепочка через общее событие завершения ранна):

```
[SiYuan] row attr workflow_status := "needs-research"
   │  (≤60 s поллинг KnowledgeChangeWatcher)
   ▼
Craft EventBus: KnowledgeAttributeChanged {rowId, newValue:"needs-research"}
   │  Automation A (match: databaseId=ResearchDB, attribute.name=workflow_status, newValue=needs-research)
   ▼
action cloud_run.submit {skillSlug: deep-research, topic: row.title, callbackTag: rowId}
   │  packages/cloud-runner, бюджеты DEFAULT_RUN_LIMITS (30 мин / 2M ток / 25 MB)
   ▼
Craft EventBus: CloudRunCompleted {runId, labels:["knowledge-triggered"], callbackTag: rowId}
   │  Automation B (match: callbackTag присутствует, state=done)
   ├─► knowledge.publish_run {runId, targetNotebook/Path, review: required} → → документ **создаётся как публикация ранна по Контуру 3** с review-экраном
   ├─► knowledge.link_session {knowledgeRef: row.ref, craftRef: run, relation: "researched-by"}
   └─► knowledge.set_attribute {row, workflow_status: "review"}   (allow-list матчера)
   ▼
event-logger → events.jsonl; knowledge_audit_log — три записи с actor_ref automation:B
```

Фрагмент `automations.json` (существующий формат `AutomationsConfig`, новые ключи — новые события):

```json
{
  "automations": {
    "KnowledgeAttributeChanged": [
      {
        "id": "a1b2c3",
        "name": "needs-research → cloud run",
        "enabled": true,
        "permissionMode": "ask",
        "conditions": [
          { "field": "databaseId", "op": "eq", "value": "<ResearchDB-id>" },
          { "field": "attribute.name", "op": "eq", "value": "workflow_status" },
          { "field": "newValue", "op": "eq", "value": "needs-research" }
        ],
        "actions": [
          { "type": "cloud_run.submit", "skillSlug": "deep-research",
            "topic": "{{event.title}}", "labels": ["knowledge-triggered"],
            "callbackTag": "{{event.rowId}}" }
        ]
      }
    ],
    "CloudRunCompleted": [
      {
        "id": "d4e5f6",
        "name": "research report → SiYuan + status review",
        "enabled": true,
        "permissionMode": "ask",
        "conditions": [ { "field": "labels", "op": "contains", "value": "knowledge-triggered" } ],
        "actions": [
          { "type": "knowledge.publish_run", "runId": "{{event.runId}}",
            "targetNotebook": "Research", "targetPath": "/Research/Reports", "review": "required" },
          { "type": "knowledge.link_session",
            "knowledgeRef": { "scheme": "siyuan", "kind": "block", "id": "{{event.callbackTag}}" },
            "craftRef": { "scheme": "craft", "kind": "run", "id": "{{event.runId}}" },
            "relation": "researched-by" },
          { "type": "knowledge.set_attribute",
            "targetRef": { "scheme": "siyuan", "kind": "block", "id": "{{event.callbackTag}}" },
            "name": "workflow_status", "value": "review" }
        ]
      }
    ]
  }
}
```

Поля `attributeAllowList` (в матчере B: `["workflow_status","valid_until"]`) и префикс пути публикации — части JSON-схемы матчера (расширение `schemas.ts`). Failure-линии: row удалён до завершения → `knowledge.set_attribute` валится валидацией `provider.get` → proposal `pending` с ошибкой (не молчит); run failed → `CloudRunCompleted` не эмитится для `state=failed` (match `state=done`), отдельный матчер на `failed` опционален.

## 4. Границы / что НЕ делаем

1. **НИКАКОЙ прямой записи из скилла/автоматизации** в обход Контура 2 — запрет оперативнее режима `allow-all` ([05-mutation-safety.md](./05-mutation-safety.md), ADR-004). Запрещённые операции (bulk delete, notebook delete, arbitrary SQL write, mass update, silent overwrite) не получают ни tool-имени, ни action-литерала — отсутствие в схеме и есть enforcement.
2. **НЕ вводим capability-matrix в frontmatter скилла** — `alwaysAllow`/`requiredSources` остаются единственными capability-полями; fine-grained управление едет на permissions engine (`readOnlyMcpPatterns`/`blockedTools`/`allowedApiEndpoints`), а не на новых ключах `SkillMetadata` (scout SkillsCloud, gap #6).
3. **Источник триггеров v1 — только поллинг.** Никаких kernel-хуков, websocket-подписок на изменения SiYuan и SiYuan-side плагинных автоматизаций (§5 «Вердикта»: автоматизации через плагины SiYuan — не основной механизм). Push-стрим — кандидат post-P7 (managed kernel, [07-connection-modes.md](./07-connection-modes.md)).
4. **НЕ синхронизируем метаданные магически.** Пересечение Craft↔SiYuan метаданных — только явные автоматизации вида «WHEN Craft label=Publish THEN set SiYuan attr.workflow=ready-to-publish» (§6 «Вердикта», ADR-005); автоматом — никогда.
5. **MCP-facade — только агентная поверхность.** UI, diff, apply, conflict-check — вне MCP (§10 «Вердикта»); `knowledge.*` MCP-инструменты не вызываются из рендерера.
6. **`review` для publish — всегда `required` в v1**; compose-only автопубликация отчётов (без экрана review) — отдельное изменение ADR, не конфигурация матчера.

## 5. Критерии приёмки

- [ ] Таблица §3.1 сведена: каждая из 7 capabilities «Вердикта» §2.5 имеет маппинг на метод провайдера из [03](./03-knowledge-provider-contract.md) §3.2 (или явное «не метод провайдера» для `knowledge.publish`/`get_backlinks`), класс доступа и дефолтный permission mode.
- [ ] Read-capabilities (`search`/`read`/`get_backlinks`) разрешимы в режиме `safe` через `readOnlyMcpPatterns` без изменения кода permissions engine (только `permissions.json`).
- [ ] `SKILL.md` примера §3.2 парсится существующим gray-matter-парсером в валидный `SkillMetadata` (все ключи frontmatter — из 6-полевого контракта) и несёт att1-контракт (input/capabilities/output) в маппинге, указанном текстом.
- [ ] Пять триггеров §3.4 и семь действий §3.5 (6 knowledge + `cloud_run.submit`) добавлены в `AppEvent`/`AutomationAction` с валидацией `validation.ts` + `schemas.ts`; handler `knowledge-handler.ts` реализует `subscribe(bus)/dispose()` и проходит регистрацию в `AutomationSystem` без изменения существующих handlers.
- [ ] Каждая операция записи из automation создаёт запись в `knowledge_audit_log` с `actor_ref = automation:<id>` и (для create/append) inverse-данные rollback.
- [ ] Сценарий §3.6 воспроизводится на `automations.json` из документа: `needs-research` → сабмит ранна → публикация с review → строка переведена в `review`; каждый шаг виден в `automations-history.jsonl` и `events.jsonl`.
- [ ] `knowledge.propose_patch` не имеет пути auto-apply ни в одном режиме разрешений.

## 6. Открытые вопросы

1. **Структурные `input`/`output` в `SkillMetadata`** (att1-поля сейчас — секции тела): переносить ли в frontmatter v2 спустя P6 (toolchain валидации входа, генерация UI-формы)? Зависит от того, сколько knowledge-скиллов появится фактически.
2. **Интервал и экономика поллинга**: 60 s × N подключений × размер базы — пороги деградации (backpressure, пропуск циклов) и переход на event-streaming (kernel webhooks) после P7.
3. **`CloudRunCompleted` — единственное non-knowledge событие пакета**: стоит ли вместо него generic `RunStateChange` (паритет с `SessionStatusChange`)? Влияет на будущие run-автоматизации вне знаний; решать с [11-roadmap.md](./11-roadmap.md).
4. **allow-list атрибутов для `set_attribute`** — per-workspace или per-automation (сейчас: поле матчера, т.е. per-automation)? per-workspace слой в `permissions.json` логичнее философски, но усложняет расчёт эффективного конфига.
5. **stale-вычисление**: достаточно ли `updatedAt/valid_until`, или нужен пользовательский stale-предикат на filtrex (переиспользование движка из [09-collection-view-engine.md](./09-collection-view-engine.md) для условий `KnowledgeDocumentStale`)?
