# Suite K. Интеграция SiYuan в Craft — индекс спецификаций

- **Документ**: K-README · suite K «Интеграция SiYuan в Craft» · `docs/specs/2026-08-07-siyuan-integration/`
- **Статус**: draft
- **Дата**: 2026-08-07
- **Входные документы**: «Вердикт» (исходный документ архитектурного решения, session artifact `local://att1-siyuan-verdict.md`); «Единая оболочка» (исходный документ UI-интеграции, `local://att2-unified-shell.md`); scout-отчёты по кодовой базе `craft-agents @ 961c1f450` (RepoMap, AppShell, SessionsViews, SurfacesBrowser, ServerCore, SkillsCloud)
- **Связанные документы**: родственная suite S «Единая оболочка» — [../2026-08-07-unified-shell/README.md](../2026-08-07-unified-shell/README.md)

---

## 1. Цель

Этот файл — точка входа в suite K: индекс всех тринадцати документов с краткими аннотациями, рекомендуемый порядок чтения, матрица покрытия входных документов и явная связка с родственной suite S (UI-оболочка). Он не содержит решений сам по себе; его задача — чтобы рецензент и исполнитель за минуту понимали, из чего состоит suite, в каком порядке её читать и где искать покрытие каждого раздела исходных документов.

## 2. Контекст и мотивация

Suite K специфицирует **архитектурную** сторону поглощения SiYuan форком `agisota/craft-agents-oss`: системные границы, контракт провайдера знаний, хранилище Bridge, безопасность записи, публикационный конвейер, режимы подключения, лицензирование, движок коллекционных представлений, knowledge-расширения skills/automations и roadmap поглощения.

UI-сторона (слоты оболочки, реестр поверхностей и вкладки, панели, omnibox, extension center, identity center) вынесена в отдельную suite S, чтобы:

- архитектура и оболочка ревьюились и реализовывались независимыми волнами;
- перекрёстные ссылки между ними оставались точечными и проверяемыми;
- каждая suite укладывалась в читаемый объём (150–450 строк на документ).

Вердикт, объединяющий обе suites: **Craft — магистраль, SiYuan — поглощаемый движок знаний** ([00-overview.md](./00-overview.md)). Форк расходится с upstream Craft на 347 коммитов вперёд при 1 позади и содержит собственные контуры (`packages/cloud-runner`, `apps/cloud-gateway`, `packages/messaging-discord-worker`) — поэтому обратное поглощение (SiYuan как хост) не рассматривается ([01-adrs.md](./01-adrs.md), ADR-001).

## 3. Решение

### 3.1 Как читать suite (порядок)

Порядок чтения совпадает с порядком принятия решений вердикта (фазы P0–P7):

1. **Вердикт и ограничители** — [00-overview.md](./00-overview.md) → [01-adrs.md](./01-adrs.md). Сначала итоговый контур и карта решений, затем шесть P0-решений в формате ADR. Если любой последующий документ противоречит ADR — исправляется документ, а не ADR (ADR пересматривается только отдельным решением).
2. **Границы и контракт** — [02-integration-boundaries.md](./02-integration-boundaries.md) → [03-knowledge-provider-contract.md](./03-knowledge-provider-contract.md). Чьи подсистемы, что скрываем, и как выглядит единственная точка доступа к знаниям (`KnowledgeProvider`).
3. **Контур записи** — [04-bridge-storage.md](./04-bridge-storage.md) → [05-mutation-safety.md](./05-mutation-safety.md). Где лежит интеграционное состояние и как безопасно писать (proposals, diff, hash-check, rollback).
4. **Движение результатов** — [06-publication-pipeline.md](./06-publication-pipeline.md). Как сессия превращается в знание (distill → review → publish → provenance).
5. **Эксплуатация и внешние ограничения** — [07-connection-modes.md](./07-connection-modes.md) → [08-licensing.md](./08-licensing.md). Режимы подключения и лицензионный контур, влияющие на поставку.
6. **Переиспользование** — [09-collection-view-engine.md](./09-collection-view-engine.md) → [10-skills-automations.md](./10-skills-automations.md). Единый view-engine поверх доменов и knowledge-расширения существующих skills/automations.
7. **План** — [11-roadmap.md](./11-roadmap.md). Фазы P0–P7, зависимости, критерии выхода.

Короткие пути:

- **Рецензенту стратегии** достаточно: 00 → 01 → 11.
- **Исполнителю**: 01 → 02 → 03 → (04 | 05 | 06 — по задаче) → 11.
- **UI-инженеру**: 00 → suite S целиком → обратно сюда 03/05/09 по точкам сцепления (§3.3).

### 3.2 Индекс документов (13)

| # | Файл | Аннотация |
|---|---|---|
| — | [README.md](./README.md) | Этот индекс: порядок чтения, аннотации, матрица покрытия, связь с suite S. |
| 00 | [00-overview.md](./00-overview.md) | Вердикт «Craft — магистраль, SiYuan — поглощаемый движок знаний» (расхождение форка 347/1), формула продукта, итоговый контур Craft → Bridge → SiYuan, полная карта решений (§15 вердикта). |
| 01 | [01-adrs.md](./01-adrs.md) | Шесть P0-ADR: Craft is host product; SiYuan owns canonical knowledge; No shared database; All agent writes use proposals; Operational and semantic metadata remain separate; Session is not a document. |
| 02 | [02-integration-boundaries.md](./02-integration-boundaries.md) | Системная граница: что остаётся в Craft (shell, сессии, labels/statuses, skills, automations, runtime, memory, cloud runner, sources/MCP, permissions), что поглощается из SiYuan (kernel, блочный редактор, базы/атрибуты), что скрывается (второй shell, AI chat, настройки моделей, marketplace). |
| 03 | [03-knowledge-provider-contract.md](./03-knowledge-provider-contract.md) | Контракт `KnowledgeProvider` (`capabilities/search/get/getContext/proposeMutation/applyMutation/open`), тип `KnowledgeRef`, режимы контекста `snapshot` vs `live-reference`, capability discovery; почему MCP — агентная поверхность, а не основа интеграции. |
| 04 | [04-bridge-storage.md](./04-bridge-storage.md) | Минимальная схема Bridge-хранилища: `knowledge_connections`, `knowledge_context_snapshots`, `knowledge_links`, `knowledge_mutation_proposals`, `knowledge_publications`, `knowledge_audit_log`. Только интеграционное состояние, без копий знаний. |
| 05 | [05-mutation-safety.md](./05-mutation-safety.md) | Безопасный write-back: capture base hash → agent patch → Craft diff → user approval → re-read/hash-check → apply + audit + inverse patch → rollback; allow-list операций (create document, append block, update selected block, set selected attribute) и запрещённые классы (bulk delete, arbitrary SQL write, silent overwrite). |
| 06 | [06-publication-pipeline.md](./06-publication-pipeline.md) | Session → Knowledge: distill skill → structured draft → review/diff → выбор notebook/path → публикация документа → cross-link → provenance (`source_session_id`, `source_run_ids`, `generated_by`, `source_blocks`). |
| 07 | [07-connection-modes.md](./07-connection-modes.md) | Три режима подключения SiYuan: `external-local` (первый производственный; пользовательский SiYuan на `localhost:6806`), `managed` (Craft управляет закреплённым kernel — только после лицензионного решения), `remote` (TLS к удалённому kernel). |
| 08 | [08-licensing.md](./08-licensing.md) | Apache-2.0 (Craft) × AGPLv3 (SiYuan): варианты сосуществования (внешний SiYuan по API / AGPL-совместимая публикация / коммерческое разрешение / замена kernel); «отдельный процесс ≠ автоматически нет AGPL-обязательств»; запрет копирования кода SiYuan в monorepo до решения. |
| 09 | [09-collection-view-engine.md](./09-collection-view-engine.md) | Единый Collection View Engine: projections (`SessionListProjection`/`KnowledgeListProjection`/`CloudRunListProjection`), grouping/filtering/sorting/saved views; один UI-язык поверх трёх независимых доменов данных; Saved Knowledge Views. |
| 10 | [10-skills-automations.md](./10-skills-automations.md) | Knowledge-capabilities для skills (`knowledge.search/read/get_backlinks/create_document/propose_update/publish/set_attribute`) и knowledge-триггеры/действия автоматизаций (`knowledge.document.created/updated`, `knowledge.attribute.changed`, `knowledge.database.row.changed`, `knowledge.document.stale`). |
| 11 | [11-roadmap.md](./11-roadmap.md) | Последовательность поглощения P0→P7 (ADR → read-only provider → нативный раздел Knowledge → write-back → Session→Knowledge → saved views → automations → managed kernel) с критериями выхода и зависимостями. |

### 3.3 Родственная suite S и точки сцепления

**Suite S «Единая оболочка»: [../2026-08-07-unified-shell/README.md](../2026-08-07-unified-shell/README.md)** — UI-интеграция: единая адаптивная оболочка Craft, внутри которой SiYuan предоставляет редактор, блоки и знания. Состав: обзор (00), слоты оболочки (01), реестр поверхностей и вкладки (02), панели и рельсы (03), omnibox (04), extension center (05), plugin bridge (06), identity center (07), рабочий конверт `KnowledgeWorkEnvelope` (08), волны внедрения W1–W6 (09), анти-цели (10).

Точки сцепления K ↔ S (проверять согласованность при изменении любой стороны):

| Тема | Suite K | Suite S |
|---|---|---|
| Knowledge surface / editor host | [03-knowledge-provider-contract.md](./03-knowledge-provider-contract.md) (provider, `open(ref)`) | [02-surface-registry-tabs.md](../2026-08-07-unified-shell/02-surface-registry-tabs.md) (SurfaceTab `{kind:"knowledge"}`) |
| Diff-машина proposal | [05-mutation-safety.md](./05-mutation-safety.md) (конвейер, статусы) | [02-surface-registry-tabs.md](../2026-08-07-unified-shell/02-surface-registry-tabs.md) (surface `{kind:"diff"}`) |
| Разделение метаданных | [01-adrs.md](./01-adrs.md) ADR-005 | [08-work-envelope.md](../2026-08-07-unified-shell/08-work-envelope.md) (`KnowledgeWorkEnvelope`) |
| Режимы подключения / статус ядра | [07-connection-modes.md](./07-connection-modes.md) | [07-identity-center.md](../2026-08-07-unified-shell/07-identity-center.md) (ServiceConnection `{provider:"siyuan-local"…}`) |
| Единые представления | [09-collection-view-engine.md](./09-collection-view-engine.md) | [03-panels-rails.md](../2026-08-07-unified-shell/03-panels-rails.md) (слот Collection) |
| План внедрения | [11-roadmap.md](./11-roadmap.md) (P0–P7) | [09-roadmap-waves.md](../2026-08-07-unified-shell/09-roadmap-waves.md) (W1–W6) |

### 3.4 Матрица покрытия входных документов

Каждый раздел исходного «Вердикта» покрыт хотя бы одним документом suite; UI-разделы покрыты suite S. Использовать при ревизии исходников: изменение раздела вердикта должно находить свой документ по этой таблице.

| Раздел «Вердикта» | Покрывается |
|---|---|
| Вердикт, формула, итоговый контур | [00-overview.md](./00-overview.md) |
| §1 Целевая системная граница | [00-overview.md](./00-overview.md) §3.3, [02-integration-boundaries.md](./02-integration-boundaries.md) |
| §2 Что остаётся в Craft (2.1–2.8) | [02-integration-boundaries.md](./02-integration-boundaries.md); 2.3 → [09-collection-view-engine.md](./09-collection-view-engine.md); 2.5/2.6 → [10-skills-automations.md](./10-skills-automations.md); 2.8 memory → [06-publication-pipeline.md](./06-publication-pipeline.md) |
| §3 Переиспользование внутри Craft (view-engine, surface host, refs) | [09-collection-view-engine.md](./09-collection-view-engine.md); suite S [02-surface-registry-tabs.md](../2026-08-07-unified-shell/02-surface-registry-tabs.md); [03-knowledge-provider-contract.md](./03-knowledge-provider-contract.md) |
| §4 Что поглощаем из SiYuan | [02-integration-boundaries.md](./02-integration-boundaries.md); suite S [02-surface-registry-tabs.md](../2026-08-07-unified-shell/02-surface-registry-tabs.md) |
| §5 Что не переносим / скрываем | [02-integration-boundaries.md](./02-integration-boundaries.md); suite S [01-shell-slots.md](../2026-08-07-unified-shell/01-shell-slots.md), [10-anti-goals.md](../2026-08-07-unified-shell/10-anti-goals.md) |
| §6 Два типа метаданных | [01-adrs.md](./01-adrs.md) ADR-005; suite S [08-work-envelope.md](../2026-08-07-unified-shell/08-work-envelope.md) |
| §7 Сохранённые представления для знаний | [09-collection-view-engine.md](./09-collection-view-engine.md) |
| §8 Структура Knowledge Bridge (пакеты) | [02-integration-boundaries.md](./02-integration-boundaries.md), [03-knowledge-provider-contract.md](./03-knowledge-provider-contract.md) |
| §9 Интерфейс провайдера знаний | [03-knowledge-provider-contract.md](./03-knowledge-provider-contract.md) |
| §10 MCP — не основа интеграции | [01-adrs.md](./01-adrs.md) ADR-004 (альтернативы), [03-knowledge-provider-contract.md](./03-knowledge-provider-contract.md) |
| §11 Контуры чтения / записи / публикации | контур 1 → [03-knowledge-provider-contract.md](./03-knowledge-provider-contract.md); контур 2 → [05-mutation-safety.md](./05-mutation-safety.md); контур 3 → [06-publication-pipeline.md](./06-publication-pipeline.md) |
| §12 Минимальная база Bridge | [04-bridge-storage.md](./04-bridge-storage.md) |
| §13 Три режима подключения | [07-connection-modes.md](./07-connection-modes.md) |
| §14 Лицензионный контур | [08-licensing.md](./08-licensing.md) |
| §15 Карта решений | [00-overview.md](./00-overview.md) §3.4 (таблица целиком) |
| §16 Последовательность поглощения P0–P7 | [01-adrs.md](./01-adrs.md) (P0), [11-roadmap.md](./11-roadmap.md) (P1–P7) |
| «Единая оболочка» (att2, целиком) | suite S: [../2026-08-07-unified-shell/README.md](../2026-08-07-unified-shell/README.md) |

### 3.5 Структура suite на диске

```
docs/specs/2026-08-07-siyuan-integration/
├── README.md                          ← этот индекс
├── 00-overview.md                     ← вердикт, контур, карта решений
├── 01-adrs.md                         ← ADR-001…006 (P0)
├── 02-integration-boundaries.md       ← чьи подсистемы; что скрываем
├── 03-knowledge-provider-contract.md  ← KnowledgeProvider / KnowledgeRef
├── 04-bridge-storage.md               ← 6 таблиц Bridge
├── 05-mutation-safety.md              ← proposal → diff → apply → audit/rollback
├── 06-publication-pipeline.md         ← Session → Knowledge + provenance
├── 07-connection-modes.md             ← external-local / managed / remote
├── 08-licensing.md                    ← Apache-2.0 × AGPLv3
├── 09-collection-view-engine.md       ← ListProjection × 3 домена
├── 10-skills-automations.md           ← knowledge.* tools, triggers, actions
└── 11-roadmap.md                      ← фазы P0–P7
```

### 3.6 Мини-глоссарий (общие термины suite)

- **Knowledge Bridge** — контур интеграции между Craft и SiYuan: провайдер, адаптеры, Bridge-хранилище. Не путать с MCP.
- **KnowledgeRef** — типизированная ссылка на сущность знаний (`provider/kind/id`), см. [03](./03-knowledge-provider-contract.md).
- **Context snapshot / live-reference** — два режима подключения знания к сессии: зафиксированная копия с `content_hash` против перечитывания перед выполнением.
- **Mutation proposal** — пакет изменения с base hash, patch и inverse patch; единственный способ записи агента (ADR-004, [05](./05-mutation-safety.md)).
- **Inverse patch** — обратный патч, сохраняемый при apply; основа rollback.
- **Provenance** — происхождение опубликованного документа (сессия, раны, модель, исходные блоки), [06](./06-publication-pipeline.md).
- **ListProjection** — адаптер домена к единому списковому UI без слияния баз ([09](./09-collection-view-engine.md)).
- **Managed kernel** — режим, при котором Craft запускает и жизненно циклит закреплённую версию SiYuan kernel ([07](./07-connection-modes.md)); фаза P7.

### 3.7 Обозначения и конвенции suite

- **Скелет каждого документа** (единый для suite): шапка (id, название, статус `draft`, дата `2026-08-07`, входные документы) → Цель → Контекст и мотивация → Решение → Границы / что НЕ делаем → Критерии приёмки → Открытые вопросы.
- **Язык**: проза на русском; идентификаторы кода, API, SQL, типы — на английском (следует репозиторной привычке: RU-тела коммитов, RU `AGENTS.md`).
- **Существующий код** всегда помечается реальным путём (например, `apps/electron/src/main/browser-pane-manager.ts`); планируемое помечается «новый компонент». Жёлтое смешение «есть/будет» запрещено — по нему строятся оценки в [11-roadmap.md](./11-roadmap.md).
- **Ссылки**: внутри suite — относительные `./NN-…md`; между suites — `../2026-08-07-unified-shell/NN-…md` (валидны после слияния обеих веток в одно дерево `docs/`).
- **ADR** именуются `ADR-NNN`, статусы: `Accepted` → при пересмотре `Superseded by ADR-NNN` (процесс — [01-adrs.md](./01-adrs.md), «Открытые вопросы»).

## 4. Границы / что НЕ делаем

- README не специфицирует решения — все содержательные утверждения живут в документах 00–11; здесь только навигация, аннотации и матрица покрытия.
- Suite K не описывает UI-слоты, вкладки, палитры, extension-каталог и identity-UI — это территория suite S.
- Не задаёт i18n-ключи и UI-копии: пользовательские строки подчиняются репозиторной конвенции (`packages/shared/CLAUDE.md` — паритет всех 10 локалей обязателен).
- Не заменяет детальные подсистемные PRD: документы 02–11 — самостоятельные спецификации со своими критериями приёмки.
- Пути пакетов в схемах документов — **целевая** структура; существующие компоненты помечены реальными путями, отсутствующие — как «новый компонент» (§3.7).

## 5. Критерии приёмки

- [ ] Индекс §3.2 покрывает все 13 файлов suite K (README + 00–11), аннотация каждого — 1–2 строки, без заглушек.
- [ ] Присутствует ссылка на suite S по относительному пути и таблица точек сцепления K ↔ S.
- [ ] Матрица §3.4 покрывает все разделы «Вердикта» (шапка, §1–§16, итоговый контур) и указывает на suite S для UI-материала.
- [ ] Порядок чтения §3.1 согласован с фазами вердикта (P0 сначала) и не противоречит [11-roadmap.md](./11-roadmap.md).
- [ ] Все относительные ссылки ведут на имена файлов из состава suite K или на документы suite S.
- [ ] Шапка содержит id документа, статус `draft`, дату `2026-08-07` и ссылки на входные документы.

## 6. Открытые вопросы

1. **Общее оглавление после слияния веток.** Suite K и suite S живут в отдельных worktree/ветках; нужно ли `docs/specs/README.md` с объединённым оглавлением — решить при мерже обеих.
2. **Политика ссылок между suites до мержа.** Относительные пути `../2026-08-07-unified-shell/…` валидны только после слияния в одно дерево `docs/`; до этого они проверяются по именам файлов из плана suite S.
3. **Сопровождение индекса.** Кто обновляет аннотации при глубокой переработке документа — предлагается правило «меняешь документ — правишь его строку в README» в рамках того же PR.
4. **Версионирование suite.** Нужен ли тег/пакет версии suite целиком (например, при пересмотре ADR) — отложено до первого пересмотра (см. [01-adrs.md](./01-adrs.md), «Открытые вопросы»).
