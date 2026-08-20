# Suite S. Единая оболочка Craft × SiYuan — индекс и порядок чтения

- **Doc ID**: S-README
- **Статус**: draft
- **Дата**: 2026-08-07
- **Входные документы**: исходный документ UI-интеграции «Единая оболочка» (att2); scout-отчёты `scout-RepoMap.md`, `scout-AppShell.md`, `scout-SessionsViews.md`, `scout-SurfacesBrowser.md`, `scout-ServerCore.md`, `scout-SkillsCloud.md`
- **Связанные документы**: suite K (архитектура интеграции) — [../2026-08-07-siyuan-integration/README.md](../2026-08-07-siyuan-integration/README.md)
- **Репозиторий**: agisota/craft-agents-oss (форк craft-ai-agents/craft-agents-oss)

---

## 1. Цель

Индексировать все документы suite S (единая оболочка UI), задать рекомендуемый порядок чтения и границу ответственности против соседней suite K. Этот файл — точка входа: он отвечает «что читать и в каком порядке», но не дублирует содержание документов. Нормативны всегда конкретные документы S-00…S-10, а не этот индекс.

## 2. Контекст и мотивация

Интеграция SiYuan как knowledge engine в Craft специфицируется **двумя параллельными suite**, живущими в двух worktree:

- **Suite S (этот каталог, ветка `spec/unified-shell`)** — пользовательская оболочка: слоты, поверхности, панели, палитра, расширения, идентичность, метаданные конверта работы. Отвечает на вопрос «как единый UI устроен и что видит пользователь».
- **Suite K (ветка `spec/knowledge-integration`)** — [../2026-08-07-siyuan-integration/README.md](../2026-08-07-siyuan-integration/README.md): архитектура интеграции — ADR, границы интеграции, контракт Knowledge Provider, bridge-хранилище, контур записи (mutation safety), пайплайн публикации, режимы подключения, лицензирование, движок collection views, скиллы/автоматизации, roadmap. Отвечает на вопрос «как данные и запись устроены под оболочкой».

Правило разделения обязательное: UI-документы ссылаются на контракты K-suite (например, [K-03](../2026-08-07-siyuan-integration/03-knowledge-provider-contract.md), [K-09](../2026-08-07-siyuan-integration/09-collection-view-engine.md)), но не переопределяют их. Если требование проверяется на данных без UI — оно принадлежит K; если оно про слот/поверхность/команду/аккаунт в UI — оно принадлежит S.

## 3. Решение

### 3.1. Индекс документов suite S (00–10 + этот README)

| Файл | Doc ID | Содержание | Основные зависимости |
|---|---|---|---|
| [README.md](./README.md) | S-README | Этот индекс, порядок чтения, граница S/K, соглашения | — |
| [00-overview.md](./00-overview.md) | S-00 | Целевая модель «одна геометрия»: 5 слотов + status bar, Craft — хозяин каждого слота, полная карта элементов SiYuan → Craft (17 строк), конечный интерфейс, итоговая формула | att2; scout-AppShell |
| [01-shell-slots.md](./01-shell-slots.md) | S-01 | Геометрия слотов (48 / 220–260 / 280–380 / min 640 / 320–420), 4 режима (Сессии/Знания/Исследование/Расширения) с составом слотов, что берём из SiYuan, запрет «второго shell» (8 пунктов), сравнение с существующим shell | S-00; att2 §§1–2 |
| [02-surface-registry-tabs.md](./02-surface-registry-tabs.md) | S-02 | `SurfaceRegistry`, тип `SurfaceTab`, унифицированные верхние вкладки, жизненный цикл поверхностей (session/knowledge/browser/database/cloud-run/extension/diff), сериализация и восстановление состояния вкладок | S-01 |
| [03-panels-rails.md](./03-panels-rails.md) | S-03 | `PanelRegistry`/`PanelContribution`, Activity Rail, Navigator/Collection/Inspector-панели, Inspector Rail, Status Bar, LayoutProfile, проекция SiYuan docks (LeftTop…BottomRight) в слоты | S-01, S-02 |
| [04-omnibox.md](./04-omnibox.md) | S-04 | Единая палитра ⌘K: Command Registry, Resource Provider Registry, Context Key Service, префиксы (`> @ / # ? !`), маршрутизация hotkey из embedded SiYuan surface, политика конфликтов клавиш, различение «поиск vs палитра» под одним UI | S-02, S-03; существующий `actions/`-реестр |
| [05-extension-center.md](./05-extension-center.md) | S-05 | Единый каталог расширений: типы runtime (`craft-native`, `craft-sandbox`, `siyuan-plugin`, `mcp-source`, `skill-pack`, `automation-pack`, `web-widget`, `agent-runtime`), permissions, install target, installed/update views, SiYuan Bazaar как provider | S-01; K-08 (лицензирование) |
| [06-plugin-bridge.md](./06-plugin-bridge.md) | S-06 | Мост SiYuan-плагинов: уровни совместимости L0–L3, bridge-aware manifests, проекция команд/dock-панелей/вкладок в Contribution Registry, изоляция исполнения (не в Electron main), compatibility view | S-05, S-02, S-03 |
| [07-identity-center.md](./07-identity-center.md) | S-07 | Федеративная модель аккаунтов: Craft Profile/Workspace, Service Connections, credential refs, SiYuan account (sync/лицензия), единое account menu; запрет двух account switcher, индикатор `status: connected/expired/syncing/error/disconnected` | S-00; K-07 (режимы подключения), K-08 |
| [08-work-envelope.md](./08-work-envelope.md) | S-08 | `KnowledgeWorkEnvelope`: метаданные рабочего объекта (источник, провенанс, блоки, сессии-обработчики, статус), потребление в Inspector/Omnibox/Research layout, связь с пайплайном публикации | S-02; K-03, K-06 |
| [09-roadmap-waves.md](./09-roadmap-waves.md) | S-09 | Волны внедрения W1–W6 (shell → knowledge mode → omnibox → identity → extension center → plugin bridge) с критериями выхода и нерегрессией Sessions (W1 ничего не меняет в SiYuan runtime) | все S-00…S-08; K-11 |
| [10-anti-goals.md](./10-anti-goals.md) | S-10 | Сводный запретный список: две палитры, два activity rail, два AI-контура, расширения в Electron main, raw API keys, авто-перенос DOM плагинов, слияние аккаунтов, labels↔tags без правила, переписывание редактора, отказ от compatibility view | все S-документы; K-02 |

### 3.2. Порядок чтения (первый проход)

```
README → 00 → 01 → 02 → 03 → 04 → 08 → 05 → 06 → 07 → 10 → 09
└─вход─┘ └── геометрия ──┘ └ реестры ┘ └⌘K┘ └мета┘ └ расширения ─┘ └акк┘ └грани┘ └план┘
```

1. **README → S-00 → S-01** — целевая модель и геометрия; без них остальное читается как набор несвязных реестров.
2. **S-02 → S-03** — реестры поверхностей и панелей: механика, на которую опираются все последующие документы.
3. **S-04** — командный слой (⌘K) поверх реестров.
4. **S-08** — метаданные `KnowledgeWorkEnvelope`; читается после палитры, т.к. omnibox-контекст и Inspector — его потребители.
5. **S-05 → S-06** — расширительный контур: каталог, затем мост SiYuan-плагинов (L0–L3).
6. **S-07** — идентичность; поздно, т.к. зависит от решений S-05 (marketplace) и K-07 (подключение).
7. **S-10** — анти-цели: чек-лист перед review любого решения suite.
8. **S-09** — волны: замыкает suite, связывая критерии выхода с документами S-01…S-06.

### 3.3. Граф зависимостей

```
        S-00
         │
        S-01
        ╱  ╲
     S-02  S-03 ──────┐
      │ ╲    │        │
      │  S-04(S-02,S-03)│
      │    ╲ │        │
      │     S-08      │
      │               │
   S-05 ── S-06 ── S-07 (S-05, S-06)
            ╲        ╱
             S-10 (все)
              ╲
             S-09 (все + K-11)
```

Чтение «по стрелкам» эквивалентно порядку §3.2; S-10 и S-09 — транзитивные замыкания.

### 3.4. Треки по ролям

| Роль | Минимальный трек |
|---|---|
| UI-разработчик shell | README → S-00 → S-01 → S-02 → S-03 → S-09 |
| Разработчик расширений/плагинов | S-00 → S-05 → S-06 → S-04 (контекст палитры) → S-10 |
| Автор suite K / архитектор | S-00 → S-01 → S-08 → S-07 → далее K-00…K-11 |
| Ревьюер | S-00 → S-10 → целевой документ → S-09 (критерии волн) |

### 3.5. Карта документов suite K (для ориентации)

Полный индекс и норматив — в [README suite K](../2026-08-07-siyuan-integration/README.md). Краткая карта для перекрёстных ссылок из S:

| Doc | Файл | Тема | Кто ссылается из S |
|---|---|---|---|
| K-00 | `00-overview.md` | Обзор архитектуры интеграции | S-00 |
| K-01 | `01-adrs.md` | ADR ключевых решений | S-10 |
| K-02 | `02-integration-boundaries.md` | Границы интеграции, runtimes | S-00, S-06, S-10 |
| K-03 | `03-knowledge-provider-contract.md` | Контракт Knowledge Provider | S-00, S-01, S-02, S-08 |
| K-04 | `04-bridge-storage.md` | Bridge-хранилище | S-08 |
| K-05 | `05-mutation-safety.md` | Контур записи, безопасность мутаций | S-10 |
| K-06 | `06-publication-pipeline.md` | Пайплайн публикации | S-08 |
| K-07 | `07-connection-modes.md` | Режимы подключения kernel | S-01 (status bar), S-07 |
| K-08 | `08-licensing.md` | Лицензирование SiYuan | S-05, S-07 |
| K-09 | `09-collection-view-engine.md` | Движок collection views | S-01 (COLLECTION), S-02 |
| K-10 | `10-skills-automations.md` | Скиллы и автоматизации поверх знаний | S-04, S-05 |
| K-11 | `11-roadmap.md` | Дорожная карта архитектуры | S-09 |

### 3.6. Расположение и версионирование

| | Suite S | Suite K |
|---|---|---|
| Worktree | `/Users/marklindgreen/Projects/craft-agents-spec-shell` | `/Users/marklindgreen/Projects/craft-agents-spec-knowledge` |
| Ветка | `spec/unified-shell` | `spec/knowledge-integration` |
| Каталог | `docs/specs/2026-08-07-unified-shell/` | `docs/specs/2026-08-07-siyuan-integration/` |
| Статус набора | draft, без commit до утверждения | draft, без commit до утверждения |

Обе suite живут поверх одного штриха кода (основной checkout `~/Projects/craft-agents`, read-only для авторов спецификаций); все ссылки на «существует в кодовой базе» ведут в него.

Исходные артефакты спецификации: `att1-siyuan-verdict.md` (архитектурный вердикт, вход K), `att2-unified-shell.md` (единая оболочка, вход S), шесть scout-отчётов (`RepoMap`, `AppShell`, `SessionsViews`, `SurfacesBrowser`, `ServerCore`, `SkillsCloud`). Изменение входного документа требует пересмотра затронутых S/K-документов и обновления даты в header.

### 3.7. Соглашения suite

- Язык: русская проза; идентификаторы, API, SQL — английский (по конвенции репозитория).
- Каждый документ: header (doc id, статус, дата, входные документы) + разделы «Цель / Контекст и мотивация / Решение / Границы, что НЕ делаем / Критерии приёмки / Открытые вопросы».
- Cross-ссылки относительные: внутри suite — `./NN-name.md`; в suite K — `../2026-08-07-siyuan-integration/NN-name.md`.
- Утверждения «уже существует» обязаны ссылаться на реальный путь/символ кодовой базы (например, `apps/electron/src/shared/types.ts` NavigationState union, `BrowserPaneManager.createEmbeddedInstance`); всё новое помечается «новый компонент».
- Диаграммы — ASCII/text code-блоки; таблицы — Markdown; интерфейсы — TypeScript code-блоки (по образцу `docs/runtime-context-marketplace-prd.md`).

## 4. Границы / что НЕ делаем

- НЕ дублируем содержание K-suite: контракты данных, запись, подключение, лицензия — только ссылки `../2026-08-07-siyuan-integration/…`.
- НЕ фиксируем в README нормативные решения: при расхождении README с документом S-NN нормативен документ; README — навигационный артефакт.
- НЕ описываем здесь волны/критерии/anti-goals содержательно — только указываем на S-09/S-10.

## 5. Критерии приёмки

- [ ] Индекс §3.1 перечисляет **все 11 документов suite (00–10) плюс README** с Doc ID и содержанием в одну строку.
- [ ] Ссылка на suite K присутствует и относительна: `../2026-08-07-siyuan-integration/README.md`.
- [ ] Задан порядок чтения (§3.2) из 12 шагов с обоснованием групп, граф зависимостей (§3.3) и треки по ролям (§3.4).
- [ ] Карта suite K (§3.5) перечисляет K-00…K-11 и совпадает с именами файлов K-каталога.
- [ ] Каждая ссылка в индексе совпадает с реальным именем файла каталога.
- [ ] Соглашения §3.7 выполняются всеми документами suite (header, разделы, относительные ссылки, grounding).

## 6. Открытые вопросы

1. Нужен ли сводный CHANGELOG suite при обновлении документов волнами (или достаточно git-истории worktree `spec/unified-shell`)?
2. Остаётся ли suite S в `docs/specs/…` ветки `spec/unified-shell` после утверждения или переносится в `docs/` основной ветки одним merge вместе с K?
3. Вводим ли owner-поле per doc в header, когда начнутся параллельные правки S-02…S-10?
