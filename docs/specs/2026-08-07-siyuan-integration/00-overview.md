# K-00. Обзор интеграции: вердикт, итоговый контур и карта решений

- **Документ**: K-00 · suite K «Интеграция SiYuan в Craft» · `docs/specs/2026-08-07-siyuan-integration/`
- **Статус**: draft
- **Дата**: 2026-08-07
- **Входные документы**: «Вердикт» (исходный документ архитектурного решения, session artifact `local://att1-siyuan-verdict.md`); «Единая оболочка» (исходный документ UI-интеграции, `local://att2-unified-shell.md`); разведка кодовой базы `craft-agents @ 961c1f450` — scout-отчёты RepoMap, AppShell, SessionsViews, SurfacesBrowser, ServerCore, SkillsCloud
- **Связанные документы**: [README suite](./README.md); родственная suite S «Единая оболочка» — [../2026-08-07-unified-shell/README.md](../2026-08-07-unified-shell/README.md)

---

## 1. Цель

Зафиксировать вердикт верхнего уровня о том, **какой продукт является магистралью** интеграции Craft × SiYuan, показать целевое распределение ответственности между Craft, Knowledge Bridge и SiYuan и свести в одну таблицу все архитектурные решения, принятые до детальных спецификаций.

Это входная точка suite K. Документы 01–11 раскрывают отдельные подсистемы, но обязаны оставаться согласованными с картой решений §3.4 и с шестью ADR в [01-adrs.md](./01-adrs.md): противоречие подсистемного документа карте решений означает ошибку в подсистемном документе, а не в карте.

Документ отвечает на три вопроса:

1. Что становится хозяином интеграции — Craft, SiYuan или «третий продукт»?
2. Как выглядит итоговый системный контур (кто за что отвечает, где проходят границы)?
3. Какие решения уже приняты — и какие анти-решения явно зафиксированы, чтобы их не переоткрывали?

## 2. Контекст и мотивация

### 2.1 Состояние форка

Форк `agisota/craft-agents-oss` расходится с исходным Craft на **347 коммитов вперёд при 1 позади**. В форке существуют собственные контуры, которых нет upstream:

- облачные запуски: `packages/cloud-runner` (провайдер-нейтральный контракт `CloudRunProvider`) + `apps/cloud-gateway` (Cloudflare Worker + Durable Object + контейнерный runner) + `apps/modal-gateway` (FastAPI fallback);
- Discord-контур `packages/messaging-discord-worker` рядом с `packages/messaging-gateway` (Telegram/WhatsApp);
- собственный релизный конвейер (dmg-сборки, generic-фид обновлений) и macOS CI на self-hosted runner.

Обратное поглощение (SiYuan как хост, Craft как подключаемый модуль) потребовало бы переноса агентного runtime, сессий, браузерного контура, автоматизаций, облачных запусков, мессенджерных шлюзов и системы разрешений — то есть фактически всей продуктовой ценности форка. Такой вариант не рассматривается (формально отклонён в ADR-001, см. [01-adrs.md](./01-adrs.md)).

### 2.2 Две зрелые системы с одинаковой геометрией

Оба приложения построены по одной схеме:

```
[ГЛОБАЛЬНЫЙ РЕЖИМ] → [КОНТЕКСТНАЯ НАВИГАЦИЯ] → [КОЛЛЕКЦИЯ/ДЕРЕВО] → [ОСНОВНАЯ РАБОЧАЯ ПОВЕРХНОСТЬ] → [ИНСПЕКТОР/АГЕНТ]
```

В Craft эта геометрия уже реализована и проверена: трёхколоночный shell `apps/electron/src/renderer/components/app-shell/AppShell.tsx`; реестр навигаторов `NavigationState` (union из 10 навигаторов, `apps/electron/src/shared/types.ts`, строки ~1079–1245); панельный стек со split-view и URL-сериализацией `apps/electron/src/renderer/atoms/panel-stack.ts`; host-поверхность для встраивания чужих web-приложений — связка `BrowserPaneManager.createEmbeddedInstance` (`apps/electron/src/main/browser-pane-manager.ts`, композит из трёх WebContentsView: toolbar + page + overlay) и `BrowserPanelPage.tsx` (rect-reporter div + `ResizeObserver` + `syncBounds`).

Совпадение геометрии означает: интеграция — это не «вклеить окно SiYuan в Craft», а сделать Craft хозяином каждого слота, передав SiYuan роль центральной рабочей поверхности знаний. UI-сторона этого решения специфицирована в suite S ([01-shell-slots.md](../2026-08-07-unified-shell/01-shell-slots.md), [02-surface-registry-tabs.md](../2026-08-07-unified-shell/02-surface-registry-tabs.md)); suite K фиксирует системные границы, контракты и хранение.

### 2.3 Главные риски, которые снимает вердикт

1. **«Интерфейс внутри интерфейса»**: два логотипа, два workspace-switcher, две глобальные палитры, два AI-чата, два marketplace. Снимается решением «поглощение, а не соединение» (карта скрываемых элементов — [02-integration-boundaries.md](./02-integration-boundaries.md) и suite S [01-shell-slots.md](../2026-08-07-unified-shell/01-shell-slots.md)).
2. **Два источника правды о данных**: копирование знаний в storage Craft порождает двустороннюю синхронизацию и конфликты. Снимается ADR-002/ADR-003 (каноническое знание — только в SiYuan; общей БД нет).
3. **Непрозрачная запись агента в базу знаний**: прямой `updateBlock()` из модели способен молча испортить долговечные данные. Снимается ADR-004 и контуром из [05-mutation-safety.md](./05-mutation-safety.md).
4. **Лицензионная коллизия**: Craft — Apache-2.0, SiYuan — AGPLv3. До разрешения вопроса код SiYuan не копируется внутрь monorepo; граница — процессная и API-шная. Разбор — [08-licensing.md](./08-licensing.md).

## 3. Решение

### 3.1 Вердикт

> **Ничего ценного из Craft в SiYuan не переносим. `agisota/craft-agents-oss` остаётся главным приложением, продуктовым интерфейсом и исполнительным ядром. SiYuan поглощается Craft как специализированный движок знаний.**
>
> Craft — магистраль. SiYuan — присоединяемый орган.

Вердикт развёрнут в шесть архитектурных решений-ограничителей (фаза P0), формально оформленных в [01-adrs.md](./01-adrs.md):

| ADR | Формулировка |
|---|---|
| ADR-001 | Craft is host product |
| ADR-002 | SiYuan owns canonical knowledge |
| ADR-003 | No shared database |
| ADR-004 | All agent writes use proposals |
| ADR-005 | Operational and semantic metadata remain separate |
| ADR-006 | Session is not a document |

### 3.2 Формула проекта

```
Craft = продуктовая оболочка + рабочие представления + агентное исполнение + автоматизации
SiYuan = структурированное долговечное знание (kernel, блоки, бэклинки, атрибуты, БД, SQL)
Unified product = Craft + native Knowledge mode + SiYuan engine + controlled bridge
```

Распределение ответственности:

- **Craft**: «работа, исполнение, взаимодействие, управление агентами» — сессии, labels/statuses, skills, automations, sources/MCP, permissions, memory, browser, cloud runs, messaging.
- **SiYuan**: «структурированное долговечное знание» — notebooks, документы, блоки со стабильными ID, backlinks, атрибуты, database/attribute views, SQL, поиск, assets, полный блочный редактор.
- **Bridge**: «безопасное движение контекста и результатов между ними» — `KnowledgeProvider`, снапшоты контекста, cross-links, search-adapter, mutation proposals, diff approval, rollback, история публикаций.

### 3.3 Итоговый контур

```
┌─────────────────────────────────────────────────────────────────────┐
│                       CRAFT — AGISOTA ПРОДУКТ                       │
│  ┌───────────────┬────────────────────────┬───────────────────────┐ │
│  │  EXPERIENCE   │       EXECUTION        │     KNOWLEDGE UI      │ │
│  │  labels,      │  agents, sessions,     │  views, navigator,    │ │
│  │  statuses,    │  runs, automations,    │  editor surface,      │ │
│  │  shell, nav,  │  skills, browser,      │  inspector, mention,  │ │
│  │  settings     │  cloud-runner, memory  │  saved views          │ │
│  └───────────────┴────────────────────────┴───────────────────────┘ │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                        ┌──────────▼───────────┐
                        │   KNOWLEDGE BRIDGE   │   (новый контур)
                        │ KnowledgeProvider /  │
                        │ context snapshots /  │
                        │ cross-links / search │
                        │ adapter / mutation   │
                        │ proposals / diff     │
                        │ approval / rollback  │
                        │ / audit /            │
                        │ publication history  │
                        └──────────┬───────────┘
                                   │ HTTP / process boundary
                        ┌──────────▼───────────┐
                        │        SIYUAN        │
                        │ blocks / documents / │
                        │ notebooks /          │
                        │ backlinks / attrs /  │
                        │ databases / SQL /    │
                        │ search / assets /    │
                        │ import-export /      │
                        │ full block editor    │
                        └──────────────────────┘
```

Ключевые свойства контура:

- **Процессная граница.** SiYuan kernel — отдельный процесс; первый производственный режим — `external-local` (пользовательский SiYuan на `localhost:6806`). Ни один пакет Craft не линкуется с кодом SiYuan. Режимы подключения — [07-connection-modes.md](./07-connection-modes.md).
- **Чтение раньше записи.** Первый производственный контур (P1) — read-only `KnowledgeProvider`: агент читает SiYuan и физически не может испортить данные. Запись появляется только через proposals (P3, [05-mutation-safety.md](./05-mutation-safety.md)).
- **Bridge — тонкий.** Хранит только интеграционное состояние (шесть таблиц, [04-bridge-storage.md](./04-bridge-storage.md)); каноническое знание остаётся в workspace SiYuan (ADR-002, ADR-003).
- **Единый UI-язык поверх разных доменов.** Sessions, Knowledge и Cloud Runs рендерятся одним view-engine, но их базы не объединяются: «единая поверхность отображения ≠ единая каноническая модель данных» ([09-collection-view-engine.md](./09-collection-view-engine.md)).

### 3.4 Карта решений

Полная карта принятых решений и анти-решений (источник: «Вердикт», §15 — приведена без потерь). Каждая строка раскрыта в документах suite K/S; изменение строки требует пересмотра соответствующего ADR и затронутых документов.

| Элемент | Решение | Детализация |
|---|---|---|
| Craft fork | **Главная магистраль** | [01-adrs.md](./01-adrs.md) ADR-001 |
| App shell / sidebar / sessions / labels / statuses | **Оставить в Craft** | [02-integration-boundaries.md](./02-integration-boundaries.md); suite S [01-shell-slots.md](../2026-08-07-unified-shell/01-shell-slots.md) |
| Grouping / filtering / saved views | **Общий Craft view-engine** | [09-collection-view-engine.md](./09-collection-view-engine.md) |
| Browser | **Оставить и расширить surface-host** | [02-integration-boundaries.md](./02-integration-boundaries.md); существующий `BrowserPaneManager` (`apps/electron/src/main/browser-pane-manager.ts`) |
| Skills | **Оставить + knowledge-инструменты** | [10-skills-automations.md](./10-skills-automations.md); существующие `packages/shared/src/skills/` |
| Automations | **Оставить + knowledge triggers/actions** | [10-skills-automations.md](./10-skills-automations.md); существующие `packages/shared/src/automations/` |
| Sources/MCP, model providers, permissions, memory, cloud runner, messaging | **Оставить в Craft без смены владельца** | [02-integration-boundaries.md](./02-integration-boundaries.md) |
| SiYuan kernel / block model / search / backlinks / SQL / databases | **Использовать как движок знаний** | ADR-002; [03-knowledge-provider-contract.md](./03-knowledge-provider-contract.md) |
| SiYuan block editor | **Встроить, не переписывать** | suite S [02-surface-registry-tabs.md](../2026-08-07-unified-shell/02-surface-registry-tabs.md) |
| SiYuan app shell / AI chat / model settings / automations UI | **Скрыть / не использовать** | [02-integration-boundaries.md](./02-integration-boundaries.md) |
| Общая универсальная Entity-БД | **НЕ строить** | ADR-003; [04-bridge-storage.md](./04-bridge-storage.md) |
| Полная двусторонняя синхронизация метаданных | **НЕ строить** | ADR-005; suite S [08-work-envelope.md](../2026-08-07-unified-shell/08-work-envelope.md) |
| Физический merge двух кодовых баз | **НЕ делать сейчас** | ADR-001; [08-licensing.md](./08-licensing.md) |

### 3.5 Карта документов suite K

| # | Документ | Раскрывает |
|---|---|---|
| 01 | [01-adrs.md](./01-adrs.md) | Шесть P0-решений в формате ADR (контекст, последствия, отклонённые альтернативы) |
| 02 | [02-integration-boundaries.md](./02-integration-boundaries.md) | Системная граница: что остаётся в Craft, что поглощается из SiYuan, что скрывается |
| 03 | [03-knowledge-provider-contract.md](./03-knowledge-provider-contract.md) | Интерфейс `KnowledgeProvider`, `KnowledgeRef`, capabilities, режимы контекста |
| 04 | [04-bridge-storage.md](./04-bridge-storage.md) | Минимальная схема Bridge-хранилища (шесть таблиц интеграционного состояния) |
| 05 | [05-mutation-safety.md](./05-mutation-safety.md) | Безопасный write-back: proposal → diff → approval → hash-check → apply → audit → rollback |
| 06 | [06-publication-pipeline.md](./06-publication-pipeline.md) | Session → Knowledge: distill, review, publish, cross-link, provenance |
| 07 | [07-connection-modes.md](./07-connection-modes.md) | Режимы подключения: `external-local` / `managed` / `remote` |
| 08 | [08-licensing.md](./08-licensing.md) | Apache-2.0 × AGPLv3: варианты сосуществования и ограничения |
| 09 | [09-collection-view-engine.md](./09-collection-view-engine.md) | Единый движок коллекционных представлений (Sessions/Knowledge/Runs) |
| 10 | [10-skills-automations.md](./10-skills-automations.md) | Knowledge-capabilities для skills и knowledge-триггеры/действия автоматизаций |
| 11 | [11-roadmap.md](./11-roadmap.md) | Последовательность поглощения P0–P7 с критериями выхода |

## 4. Границы / что НЕ делаем

- **НЕ переносим** историю чатов в SiYuan: сессии остаются в Craft (Session = процесс работы, Document = принятый результат — ADR-006).
- **НЕ строим** общую универсальную Entity-БД и полную двустороннюю синхронизацию метаданных (ADR-003, ADR-005).
- **НЕ делаем** физический merge двух кодовых баз на этом этапе (карта решений §3.4; лицензионный аспект — [08-licensing.md](./08-licensing.md)).
- **НЕ переписываем** блочный редактор SiYuan — только встраивание как управляемой поверхности (suite S).
- **НЕ оставляем** в продуктовом UI второй app shell, второй AI-чат, вторые настройки моделей, второй marketplace, вторую систему labels/statuses от SiYuan (полный список скрываемого — [02-integration-boundaries.md](./02-integration-boundaries.md)).
- **НЕ даём** агенту прямой записи в SiYuan в обход proposal/diff/approval (ADR-004; контур — [05-mutation-safety.md](./05-mutation-safety.md)).
- **НЕ копируем** код SiYuan в monorepo до разрешения лицензионного вопроса ([08-licensing.md](./08-licensing.md)).
- **НЕ создаём** MCP-сервер как основу интеграции: MCP — агентная поверхность; системная поверхность — `KnowledgeProvider` ([03-knowledge-provider-contract.md](./03-knowledge-provider-contract.md)).

## 5. Критерии приёмки

- [ ] Вердикт §3.1 и формула §3.2 воспроизводят исходный «Вердикт» без искажения смысла.
- [ ] Карта решений §3.4 содержит все 13 строк §15 исходного документа, включая три анти-решения («НЕ строить» / «НЕ делать сейчас»).
- [ ] Каждая строка карты решений ссылается минимум на один документ suite K или suite S.
- [ ] Итоговый контур §3.3 показывает три слоя (Craft → Bridge → SiYuan), процессную границу и однонаправленность начальной записи.
- [ ] Расхождение форка зафиксировано (347 коммитов вперёд, 1 позади) вместе с собственными контурами форка.
- [ ] Все относительные ссылки указывают на имена файлов из состава suite K (README, 00–11) или suite S.
- [ ] Утверждения о существующем коде подкреплены реальными путями репозитория; новые компоненты помечены как новые.

## 6. Открытые вопросы

1. **Стратегия синхронизации с upstream Craft.** Расхождение 347/1 продолжит расти; нужен отдельный процесс ребейза/черри-пиков upstream. Вне scope suite K, но влияет на оценки в [11-roadmap.md](./11-roadmap.md).
2. **Managed kernel.** Режим `managed` (Craft управляет закреплённой версией SiYuan kernel, workspace и lifecycle) возможен только после того, как API-интеграция доказала ценность и решён лицензионный вопрос (см. [07-connection-modes.md](./07-connection-modes.md), [08-licensing.md](./08-licensing.md)). Критерий готовности к P7 нуждается в уточнении.
3. **Web/CLI parity.** Knowledge mode спроектирован для Electron-оболочки; поведение `apps/webui` и `apps/cli` (read-only просмотр знаний? resolve mention-ссылок?) требует отдельного решения после фазы P2.
4. **Второй провайдер знаний.** `KnowledgeProvider` проектируется провайдер-нейтрально (SiYuan — первая и наиболее глубокая реализация; InMemory для тестов), но Obsidian/Notion осознанно не входят в roadmap P0–P7 — держать интерфейс свободным от SiYuan-специфики там, где это не удорожает дизайн.
5. **iOS-клиент.** `apps/ios` сегодня работает с сессиями; показ опубликованных знаний (read-only) обсуждается после фазы P4.
