# S-08. Рабочий конверт знаний (KnowledgeWorkEnvelope)

- **Doc ID**: S-08
- **Статус**: draft
- **Дата**: 2026-08-07
- **Входные документы**: исходный документ UI-интеграции «Единая оболочка» (att2, §15 «Метаданные: KnowledgeWorkEnvelope», §10, §16); архитектурный вердикт интеграции SiYuan (att1, §2.2–2.3, §6, §12, §16); scout-отчёты `scout-SessionsViews.md`, `scout-ServerCore.md`
- **Связанные документы**: [S-00 Обзор](./00-overview.md), [S-03 Панели и rails](./03-panels-rails.md), [S-10 Анти-цели](./10-anti-goals.md); suite K: [K-02 Границы интеграции](../2026-08-07-siyuan-integration/02-integration-boundaries.md) (§6 «Два типа метаданных»), [K-03 Контракт Knowledge Provider](../2026-08-07-siyuan-integration/03-knowledge-provider-contract.md), [K-04 Knowledge Bridge: пакеты и хранилище](../2026-08-07-siyuan-integration/04-bridge-storage.md), [K-09 Движок коллекционных представлений](../2026-08-07-siyuan-integration/09-collection-view-engine.md), [K-10 Скиллы и автоматизации](../2026-08-07-siyuan-integration/10-skills-automations.md)
- **Репозиторий**: agisota/craft-agents-oss (форк craft-ai-agents/craft-agents-oss)

---

## 1. Цель

Зафиксировать контракт, хранение и правила отображения **рабочего конверта знаний** — Craft-side операционного слоя (`status`/`labels`/`flagged`/`archived`/`assignedTo`/timestamps) вокруг адресуемого объекта знания (`KnowledgeRef`). Документ решает три вопроса:

1. Где физически живёт операционная метаинформация о знаниях (ответ: в Craft storage, в составе bridge-хранилища — см. [K-04](../2026-08-07-siyuan-integration/04-bridge-storage.md)).
2. Как операционный workflow (конверт) соседствует с семантическими атрибутами SiYuan в одном UI, не сливаясь в одну модель данных.
3. Как [K-09 Движок коллекционных представлений](../2026-08-07-siyuan-integration/09-collection-view-engine.md) читает конверт, чтобы отдавать знаниям те же labels/статусы/группировки, что и сессиям.

Связанные решения suite K здесь не дублируются: семантика `KnowledgeRef`, контракт провайдера и каноническая схема bridge-таблиц — в K-03/K-04; запрет авто-синхронизации метаданных — в K-02 §6.

## 2. Контекст и мотивация

### 2.1. У Craft уже есть зрелый операционный слой — у знаний его нет

Сессии Craft несут богатый набор рабочих метаданных, зашитый в `SessionConfig` (`packages/shared/src/sessions/types.ts`): `isFlagged`, `isArchived`/`archivedAt`, `hidden`, `hasUnread`, `labels: string[]`, `sessionStatus` (динамический ID из конфигурации статусов), `kanbanColumn`, `projectId`. Вокруг них построены: единственный предикат label-фильтрации `matchesLabelFilter` (`packages/shared/src/labels/filter.ts`), движок сохранённых представлений (filtrex-выражения, хранение в `views.json`), RPC-мутации `flag/unflag/archive/setSessionStatus/setLabels/setKanbanColumn` (`packages/server-core/src/handlers/rpc/sessions.ts`) и авторитетные мутации в `packages/server-core/src/sessions/SessionManager.ts`.

Пользователь, привыкший к этому контуру, закономерно ждёт того же от документов и блоков SiYuan: пометить исследование флагом, навесить label `llm`, отправить документ в колонку REVIEW. Но `SessionConfig` и его storage строго сессионные (см. [K-02](../2026-08-07-siyuan-integration/02-integration-boundaries.md): «Session = процесс работы; Document = принятый результат работы», ADR-006). «Приделать» эти поля к знаниям можно только новым контрактом.

### 2.2. SiYuan уже хранит семантику — операционные поля туда писать нельзя

SiYuan владеет семантическими атрибутами (`knowledge.tags/type/author/topic/valid_from/source/rating` — att1 §6) и блоковой моделью. Прямая запись Craft-статусов в атрибуты SiYuan означала бы:

- перенос чужой операционной таксономии в каноническое знание (нарушение ADR-005: «Operational and semantic metadata remain separate», att1 P0);
- конфликт с SiYuan database/attribute views, где атрибуты — предметные сущности, а не workflow очереди;
- необходимость двусторонней синхронизации, от которой прямо отказались (att1 §5: «Второй источник labels/statuses — не синхронизировать автоматически»; [K-02 §6](../2026-08-07-siyuan-integration/02-integration-boundaries.md)).

### 2.3. Компромисс исходных документов

att2 §15 формулирует компромисс: **не синхронизировать Craft labels ↔ SiYuan tags**, а для представлений ввести Craft-side «рабочий конверт» вокруг объекта знания. Конверт — запись в storage Craft, ключ — `KnowledgeRef`. Знание остаётся каноническим в SiYuan; работа над знанием — в Craft.

## 3. Решение

### 3.1. Контракт конверта

Контракт — verbatim из att2 §15:

```typescript
interface KnowledgeWorkEnvelope {
  knowledgeRef: KnowledgeRef;
  status?: string; labels?: string[]; flagged?: boolean; archived?: boolean; assignedTo?: string;
  createdAt: number; updatedAt: number;
}
```

`KnowledgeRef` — адресуемая ссылка из [K-03](../2026-08-07-siyuan-integration/03-knowledge-provider-contract.md) (att1 §3.3): `{ scheme: "siyuan"; kind: "notebook"|"document"|"block"|"database"|"asset"; id: string }`.

Семантика полей и их прецеденты в сессионной модели:

| Поле | Тип | Аналог в `SessionConfig` | Семантика |
|---|---|---|---|
| `knowledgeRef` | `KnowledgeRef` | `id` сессии | Ключ конверта; пустых конвертов не существует |
| `status` | `string?` | `sessionStatus` | ID статуса из общего конфигуратора статусов Craft; драйвер Board-колонок |
| `labels` | `string[]?` | `labels` (`"id"` или `"id::value"`) | Ссылки на те же `LabelConfig`, что фильтрует `matchesLabelFilter` |
| `flagged` | `boolean?` | `isFlagged` | Флаг внимания; bool, не label |
| `archived` | `boolean?` | `isArchived`/`archivedAt` | Скрытие из активных представлений без удаления |
| `assignedTo` | `string?` | — (у сессий нет) | Craft Profile ID ответственного; источник — Identity Center (S-07) |
| `createdAt`/`updatedAt` | `number` | timestamps сессии | Жизненный цикл конверта, **не** документа |

### 3.2. Хранение: bridge-side, Craft-owned

Конверт живёт **в storage Craft, в составе bridge-хранилища** ([K-04 §3.3 «Хранилище Bridge: file-backed stores»](../2026-08-07-siyuan-integration/04-bridge-storage.md)). Семейство сущностей att1 §12 (`knowledge_connections`, `knowledge_context_snapshots`, `knowledge_links`, `knowledge_mutation_proposals`, `knowledge_publications`, `knowledge_audit_log`) физически реализовано как file-backed stores (SQL из att1 §12 — только логическая схема; в репо нет ORM, единственный sqlite — disposable FTS-проекция `packages/server-core/src/memory/fts-index.ts`, scout-ServerCore). Конверт — **новый store** того же семейства (`work-envelopes`, кандидат на §3.3.8 в K-04), согласованный с владельцем K-04:

```typescript
// {workspaceRoot}/knowledge/work-envelopes.jsonl — JSONL store (одна запись на строку;
// компактизация tmp+rename), ключ в пределах workspace-стореджа — knowledgeRef
interface KnowledgeWorkEnvelopeRecord {
  knowledgeRef: KnowledgeRef;   // сериализуется целиком: {scheme,kind,id}
  status?: string;
  labels?: string[];            // формат "id" | "id::value", как у сессий
  flagged?: boolean;
  archived?: boolean;
  assignedTo?: string;          // Craft Profile ID
  createdAt: number;
  updatedAt: number;
}
```

Принципы:

- **Ключ — `knowledgeRef` в пределах workspace-стореджа**: путь `{workspaceRoot}/knowledge/` уже даёт workspace-scoping — один и тот же `siyuan://document/…` может иметь разные конверты в разных workspace Craft (как у сессий workspace-scoped URLs в `lib/local-storage.ts`).
- **Физика по конвенциям repo**: JSONL + атомарная запись через tmp+rename (образец `packages/server-core/src/handlers/rpc/memory-io.ts`); опциональная **disposable sqlite-проекция** `index.db` для индексированных выборок по `status`/`labels` (образец `memory/fts-index.ts`) — перестраивается из JSONL и источником истины не является.
- **Храним только операционное**: ни содержимого документа, ни заголовка, ни атрибутов SiYuan (att1 §12: «Bridge хранит только интеграционное состояние»).
- **Lazy creation**: конверт создаётся первой операционной операцией (set status/label/flag/archive/assign). Документ без конверта — валидное состояние «без рабочего контекста», не ошибка.
- **RPC-доступ** — по механическому циклу repo (scout-ServerCore): новые каналы `knowledge.envelopes.*` в `packages/shared/src/protocol/channels.ts` → обязательная классификация в `routing.ts` (CI-gate `routing.test.ts` упадёт иначе) → push-событие в `BroadcastEventMap` (`events.ts`) → хендлер-модуль `packages/server-core/src/handlers/rpc/knowledge.ts` (новый) → регистрация в `handlers/rpc/index.ts`. Физический дизайн store (layout, компактизация, проекции) принадлежит K-04 §3.3; код выше — его клиенты.
- **Осиротевшие конверты**: если ref удалён в SiYuan, конверт НЕ удаляется автоматически — помечается `unresolved` в UI и чистится явной операцией (защита от потери рабочего состояния при временной недоступности kernel'а).

### 3.3. Отображение: документ SiYuan на Craft Board

Сессии уже умеют board-представление (`viewMode: board` в `NavigationState`, `routes.view.board`, `kanbanColumn` в `SessionConfig`). Для знаний Board — конфигурация движка представлений (K-09), где **колонка — проекция `envelope.status`**, а не отдельное поле. Пример (att2 §15): сохранённое представление «Research Board» с колонками BACKLOG / RESEARCH / REVIEW / DONE:

```
┌────────────┬──────────────┬─────────────┬──────────────┐
│ BACKLOG    │ RESEARCH     │ REVIEW      │ DONE         │
├────────────┼──────────────┼─────────────┼──────────────┤
│ siyuan://  │ siyuan://    │ siyuan://   │ siyuan://    │
│ document/… │ document/…   │ document/…  │ document/…   │
│ «Edge LLM» │ «ivec↔qdrant»│ «Craft×SiY.»│ «Bazaar scan»│
│ label:idea │ label:llm ⚑  │ label:arch  │ label:idea   │
│  ·         │ assigned: mk │  ·          │ archived     │
└────────────┴──────────────┴─────────────┴──────────────┘
```

- Документ без конверта попадает в явную служебную колонку/секцию «Unfiled» (не теряется и не получает молча `BACKLOG`).
- Drag&drop карточки между колонками = RPC-мутация `knowledge.envelopes.setStatus` (lazy-создание при первом drop). Механика bulk/multi-select — та же, что у сессий (`useMultiSelect`, `useEntityListInteractions` — существующие обобщённые хуки, scout-SessionsViews).
- Сортировка/группировка/фильтры внутри Board — общий язык движка представлений: по envelope-полям (`status`, `labels`, `flagged`, `archived`, `assignedTo`, `updatedAt`) и/или по SiYuan-атрибутам (если view config K-09 это объявляет). Физически фильтрация envelope-полей идёт по bridge store, атрибутов — через SiYuan search/SQL адаптер (K-03); склейка — в projection (§3.6).

### 3.4. Два типа метаданных в одном инспекторе, но не одна таблица

Правило (att1 §6, [K-02 §6](../2026-08-07-siyuan-integration/02-integration-boundaries.md)):

- **Craft (операционные)**: `work.status/labels/priority/flagged/assignee/queue/review_state` — «что сейчас происходит с работой?»
- **SiYuan (семантические)**: `knowledge.tags/type/author/topic/valid_from/source/rating` — «что это за знание?»

Инспектор (`KnowledgeInspector.tsx`, новый компонент из att2 §16 `apps/electron/src/renderer/knowledge/`, слот inspector — см. [S-03](./03-panels-rails.md)) показывает оба домена как **две отдельные секции**, а не общую таблицу:

```
┌─ WORK (Craft envelope) ─────────────┐
│ Status    [REVIEW        ▾]         │
│ Labels    [arch] [llm]      +       │
│ Flagged   [x]   Assigned  [mk ▾]    │
│ Updated   2026-08-06 18:41          │
├─ KNOWLEDGE (SiYuan, canonical) ─────┤
│ Tags      #llm #edge                │
│ Type      Research-note             │
│ Author    … (атрибуты SiYuan)       │
│ Открыть в редакторе / Backlinks     │
└─────────────────────────────────────┘
```

- Секция WORK редактируется напрямую (мутации конверта, §3.2).
- Секция KNOWLEDGE — чтение через `KnowledgeProvider.get` (K-03); редактирование атрибутов идёт через SiYuan editor или mutation-контур K-05, не через конверт.
- Принцип «отображаются вместе, но не одна таблица» (att2 §15) — это **UI-композиция двух независимых источников**, запрет на join физических моделей («единая поверхность отображения ≠ единая каноническая модель данных», att1 §2.3).

### 3.5. Запрет labels↔tags auto-sync: только явные automation rules

**Никакой двусторонней или односторонней автоматической синхронизации Craft labels ↔ SiYuan tags** (att2 §15, [K-02 §6](../2026-08-07-siyuan-integration/02-integration-boundaries.md), анти-цель №8 в [S-10](./10-anti-goals.md)). Причины:

- разные владельцы и разные таксономии (label `research` ≠ тег `#research`: первое — очередь работы, второе — тема знания);
- двусторонний sync порождает петли (tag→label→rule→tag) и конфликтные гонки при одновременной правке в двух приложениях;
- неявная синхронизация не видна пользователю и не подлежит аудиту.

**Единственный разрешённый путь пересечения** — явное automation-правило в Craft automation engine (существующий: `packages/shared/src/automations/`, `AutomationMatcher`, schedulers), расширенный knowledge-триггерами/действиями по [K-10](../2026-08-07-siyuan-integration/10-skills-automations.md) (att1 §2.6). Пример канонической формы (att1 §6):

```yaml
# Явное правило: операционное событие Craft → семантическая правка SiYuan
name: publish-label-marks-ready
when: { craft.label_added: { label: "Publish", target: knowledge } }
then: { knowledge.set_attribute: { name: "workflow", value: "ready-to-publish" } }
```

Отличие от auto-sync: правило — именованная, ревьюируемая, отключаемая, залогированная в истории автоматизаций запись с явным направлением и маппингом; auto-sync — скрытая системная магия. Детект нарушения: любой код, мутирующий SiYuan tags из label-изменений (или наоборот) вне движка автоматизаций, — баг (чек-лист ревью в [S-10](./10-anti-goals.md)).

### 3.6. Как KnowledgeListProjection читает конверт

Движок представлений (K-09, контракты из att1 §2.3) нормализует неоднородные домены в единый list-contrat:

```typescript
interface ListProjection {
  key: string; title: string; subtitle?: string; icon?: string;
  labels: Array<{ id: string; title: string }>;
  status?: { id: string; title: string };
  updatedAt: number;
  open(): void;
}
class SessionListProjection implements ListProjection {}
class KnowledgeListProjection implements ListProjection {}
class CloudRunListProjection implements ListProjection {}
```

`KnowledgeListProjection` собирает строку из **двух источников** (и ни один из них не копируется в другой):

```
SiYuan (KnowledgeProvider, K-03)          Craft bridge storage (K-04 §3.3)
  search/get → node {title, subtitle,       envelopeStore.getMany(refs)  // work-envelopes.jsonl
                      icon, updated}    +   (+ index.db проекция, если есть)
        │                                            │
        └──────────────► merge per ref ◄─────────────┘
                              │
              ListProjection row:
              key      = knowledgeRef (stable id)
              title    = SiYuan node.title        (canonical)
              subtitle = notebook/path            (canonical)
              labels   = envelope.labels  ?? []   (Craft)
              status   = envelope.status  ?? none (Craft)
              updatedAt = max(node.updated, envelope.updatedAt ?? 0)
              open()   = deep link → surface tab {kind:"knowledge", ref}
```

Правила чтения:

1. **Batch**: envelope-чтение всегда одним batch-запросом по списку ref'ов страницы поиска/представления — N+1 по RPC запрещён (канал `knowledge.envelopes.getMany`).
2. **Отсутствие конверта ≠ отсутствие строки**: знание видимо в представлениях и без рабочего состояния; envelope-поля просто пусты.
3. **Фильтры view config решают источник**: предикат по envelope-полям исполняется над bridge-таблицей; предикат по SiYuan-атрибутам — в search-запросе к kernel'у; конъюнкция — merge по ref (детали и лимиты пагинации — K-09).
4. **`open()`** — deep link (K-03 deep-links), открывающий knowledge surface tab (см. [S-02](./02-surface-registry-tabs.md)); сам конверт в URL не сериализуется.
5. Обратная связь в реальном времени: push-событие `knowledge.envelopes.changed` (per `BroadcastEventMap`) → invalidate projection, как это делают сессии через их CHANGED-каналы.

## 4. Границы / что НЕ делаем

- **НЕ синхронизируем labels ↔ tags автоматически** — только явные automation rules (§3.5).
- **НЕ храним конверт в SiYuan** (attributes, meta-файлы, custom blocks) и **не храним семантику SiYuan в конверте** — разделение доменов физическое (ADR-005).
- **НЕ строим общую Entity-БД** «всё-in-one» для sessions+documents+runs (att1 §15 «Общая универсальная Entity-БД → НЕ строить»): конверт — узкий store одного домена.
- **НЕ заводим SQL-слой ради конвертов**: физика — file-backed store по K-04 §3.3; sqlite допускается только как disposable проекция, перестраиваемая из JSONL (§3.2).
- **НЕ копируем контент/заголовок документа** в конверт «для скорости»: title/subtitle всегда читаются из провайдера; кэш — ответственность K-03/K-09 с инвалидацией по событиям.
- **НЕ удаляем осиротевшие конверты** автоматически (§3.2).
- **НЕ вводим `kanbanColumn` в конверте**: колонка — проекция `status` в конкретном view config (§3.3); множественные Board'ы с разным маппингом колонок обязаны работать с одним и тем же конвертом.
- **НЕ меняем SiYuan search/SQL-поведение**: конверт невидим для kernel'а; SiYuan-клиенты (включая мобильные, att1 §4.4) продолжают видеть только каноническое знание.
- **НЕ создаём новый механизм статусов/labels**: конверт ссылается на существующие `LabelConfig` и конфигуратор статусов (`packages/shared/src/labels/*`, statuses-модуль) — новых таксономий не делаем.

## 5. Критерии приёмки

- [ ] Интерфейс `KnowledgeWorkEnvelope` в коде совпадает с §3.1 verbatim (поля, опциональность, типы).
- [ ] Конверт хранится в Craft storage как file-backed store `work-envelopes` в составе bridge-хранилища K-04 §3.3 (запись через tmp+rename); содержимого документа и SiYuan-атрибутов в записи нет (проверка валидацией полей записи).
- [ ] Каналы `knowledge.envelopes.*` классифицированы в `routing.ts` (CI-exhaustiveness test зелёный), мутаторы идут через хендлер-модуль server-core, событие changed пушится по `BroadcastEventMap`.
- [ ] Lazy creation: первый `setStatus`/`setLabels` по новому ref создаёт конверт атомарно; чтение по ref без конверта возвращает `null`, а не ошибку.
- [ ] Board «Research» (BACKLOG/RESEARCH/REVIEW/DONE) группирует документы SiYuan по `envelope.status`; документы без конверта видны в секции «Unfiled»; drag&drop между колонками меняет только envelope.
- [ ] Инспектор показывает секции WORK и KNOWLEDGE раздельно: WORK редактируется из Craft, KNOWLEDGE — read-only отражение атрибутов SiYuan (правка — через editor/mutation-контур K-05).
- [ ] В кодовой базе отсутствует путь записи SiYuan tags из Craft labels (и обратно) вне движка автоматизаций; явное правило вида att1 §6 исполняется через automation engine и отражается в его истории.
- [ ] `KnowledgeListProjection` отдаёт строки с envelope-полями из bridge storage; знания без конверта отображаются; envelope `<null>`-строк не порождает; фильтры view config по envelope и по SiYuan-атрибутам работают совместно (K-09).
- [ ] Конверты переживают перезапуск SiYuan kernel/смену connection mode (K-07): storage не зависит от состояния подключения.
- [ ] Осиротевший конверт (ref удалён в SiYuan) отображается как `unresolved` и не удалён без явного действия пользователя.

## 6. Открытые вопросы

1. **`assignedTo`: пространство идентичностей.** Значение — Craft Profile ID (S-07 Identity Center). Как резолвить membership списка workspace для выбора исполнителя, и что показывать, если профиль удалён — отдельное решение S-07; здесь храним opaque string.
2. **Scope применимости конверта по `kind`.** Для `document`/`block` польза очевидна; нужны ли конверты на `notebook`/`database`/`asset` (архив целого notebook?) — решить после W2 по опыту использования.
3. **Multi-client конфликты конверта.** Два клиента правят один конверт: last-write-wins по `updatedAt` или revision-counter с conflict-индикацией? У сессий стоит вопрос так же — это крэші; принять общее решение в K-04.
4. **REMOTE_ELIGIBLE vs LOCAL_ONLY классификация `knowledge.envelopes.*`** — зависит от топологии remote workspaces (headless `packages/server`); предварительно REMOTE_ELIGIBLE по аналогии с sessions, финально — при открытии канала.
5. **Нужен ли `unread`-аналог сессий** (`hasUnread`/`lastReadMessageId`) для документов с автоматизациями-публикациями (K-10), или unread остаётся сессионным понятием.
