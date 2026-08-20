# PRD: Runtime-конфигурация, контекстные документы и маркетплейс плагинов

- **Статус**: Draft for review (2026-08-07)
- **Репозиторий**: agisota/craft-agents-oss (main @ 4807446f4)
- **Связанные документы**: `docs/omp-v2-prd.md` (закрытая интеграция OMP), `docs/omp-rpc-notes.md`, `AGENTS.md`

---

## 1. Проблема и цели

Сейчас OMP-рантайм работает для всех сессий и агентов автоматически, а toolchain (11 инструментов) ставится сам — но:

1. Настройки рантайма размазаны и частично недоступны из UI (модель, thinking, approval, env, toolchain — нет единой точки).
2. Набор автозагружаемых инструментов фиксирован в манифесте; добавить популярные CLI-агенты/утилиты нельзя без правки кода.
3. Агенту известны только скиллы, которые пользователь сам поставил (`~/.agents/skills`), и контекстные файлы `agents.md`/`claude.md`. Нет пре-установленных скиллов из коробки, нет дефолтных документов поведения (`soul.md`, `rules.md`).
4. Маркетплейса плагинов нет; установка стороннего skill-pack — ручная.

**Цели** (G):

- **G1**. Свежий девайс: приложение ставит расширенный набор инструментов и пре-установленные скиллы без ручных действий.
- **G2**. Каждая сессия стартует с дефолтными контекстными документами (`soul.md` — личность, `rules.md` — обязательные правила работы), редактируемыми пользователем.
- **G3**. Всё, что умеет OMP, выведено в настройки: две новые вкладки **Runtime** (двигатель) и **Context** (контент) + **Marketplace** (каталог плагинов в один клик).
- **G4**. Изменения в UI реально меняют `config.json`/context-файлы/toolchain и видны агенту без рестарта где это технически возможно.

## 2. Не-цели

- Не ставим системные демоны: `docker`/`brew` — только **detect + install-guide** (см. §5.3).
- Не переписываем `~/.omp/agent/config.yml` пользователя (не-цель omp-v2-prd §2 сохраняется).
- Не вводим свой npm-plugin-package формат (подход B отклонён: YAGNI, новый формат + миграции ≈ ×2 работы).
- Не отдаём «голый каталог ссылок» вместо реальной установки (нарушает G1).
- Не меняем механику pending skills самообучения (`skillsPending:*`) — она существует и дополняется, не заменяется.

## 3. Как устроено сейчас (факты из разведки кода)

| Область | Реализация | Файлы |
|---|---|---|
| Toolchain | Манифест 11 инструментов × 4 платформы (pinned version+url+sha256+size), kinds: binary-архив и npm-tarball с embedded lock (fail-closed). `ensureAll({background})` волнами по `dependsOn`, concurrency 2, retry 5s/30s/2m | `packages/shared/src/toolchain/{manifest-data,manager,downloader,installer,resolver,npm-locks}.ts` |
| Запуск toolchain | `bootstrapConfigArtifacts()` fire-and-forget `ensureAll` | `packages/server-core/src/bootstrap/headless-start.ts:317`, `apps/electron/src/main/index.ts:93` |
| Сессия OMP | `omp --mode rpc --append-system-prompt <buildCraftContextPrompt()>`, env + toolchain PATH prefix; модель/thinking через NDJSON-RPC (`set_model`, `set_thinking_level`), allow-all ⇄ `--approval-mode yolo` | `packages/shared/src/agent/omp-agent.ts` |
| System prompt Claude/Pi | `getSystemPrompt()` = craft-assistant + preferences + project + memory + `<project_context_files>` (листинг **только** `agents.md`/`claude.md`, до 30 файлов) | `packages/shared/src/prompts/system.ts` (`CONTEXT_FILE_PATTERNS`, стр. 45) |
| Skills | Ярусы `~/.omp/agent/skills` < `~/.agents/skills` < `{workspace}/skills` < `{project}/.agents/skills`, merge по slug, SKILL.md через gray-matter; UI — `SkillsListPanel.tsx` | `packages/shared/src/skills/storage.ts`, `omp-discovery.ts` |
| Bundle→disk sync | Прецеденты `initializeDocs()` (resources/docs → ~/.craft-agent/docs) и `ensureDefaultPermissions()` (version-merge) | `packages/shared/src/docs/index.ts`, `agent/permissions-config.ts:60` |
| Settings UI | 13 вкладок в `SETTINGS_PAGES`; новая вкладка = registry + page component + icons + menu-schema + sidebar whitelist + i18n ×9 локалей | `apps/electron/src/shared/settings-registry.ts`, `settings-pages.ts` |
| Каналы RPC | Свой WS-RPC; новый канал = channels.ts + channel-map + `ElectronAPI` + handler + **routing.ts** (LOCAL_ONLY/REMOTE_ELIGIBLE, exhaustiveness-тест в CI) + `ipc-channels.test.ts` | `packages/shared/src/protocol/*`, `server-core/src/handlers/rpc/*` |
| Маркетплейс | Отсутствует | — |

Известный WIP: `packages/shared/src/protocol/routing.ts` грязный (чужая сессия) — для новых каналов трогать его аккуратно, ребейзить свои строки поверх.

## 4. Подтверждённые источники инструментов и скиллов

Резолв всех имён из заявки (проверено по GitHub/npm, 2026-08-07):

### 4.1 Инструменты

| Имя | Источник | Тип установки |
|---|---|---|
| just | github:casey/just | binary (GitHub releases) |
| fzf | github:junegunn/fzf | binary (GitHub releases) |
| mise | github:jdx/mise | binary (GitHub releases) |
| wt | github:max-sixty/worktrunk | binary (GitHub releases / cargo) |
| opencode | github:anomalyco/opencode, npm `opencode-ai` | npm |
| oh-my-claudecode | github:Yeachan-Heo/oh-my-claudecode, npm `oh-my-claude-sisyphus` ⚠ имя npm ≠ имя репо | npm |
| oh-my-codex | github:Yeachan-Heo/oh-my-codex, npm `oh-my-codex` | npm |
| oh-my-openagent | github:code-yeongyu/oh-my-openagent, npm `oh-my-openagent` | npm || oh-my-hermes | github:Salomondiei08/oh-my-hermes — ПОДТВЕРЖДЕНО пользователем (upstream, не форк) | npm/git-npm — финальный kind фиксируется при M1 |
| eve | github:vercel/eve, npm `eve` | npm (beta) |
| gbrain | github:garrytan/gbrain — **только git-install**, в npm не опубликован | git-npm (`bun install -g github:garrytan/gbrain`) |
| gstack | github:garrytan/gstack, бинарь ~58MB на Bun | binary (GitHub releases) |
| CLI-Anything | github:HKUDS/CLI-Anything, pip `cli-anything-hub` | pip (через toolchain `uv`) |
| infisical-cli | github:Infisical/infisical (`cli/`) | binary (GitHub releases) |
| vercel-skills (CLI `skills`) | github:vercel-labs/skills | npm (`npx skills`) |
| mole | github:tw93/Mole (macOS-чистильщик) — ПОДТВЕРЖДЕНО пользователем | brew |
| docker | — | detect-only + install-guide |
| brew | — | detect-only (macOS), install-guide |

### 4.2 Skill-пакеты

| Пакет | Источник | Состав |
|---|---|---|
| **agent-skills-installer** | github:agisota/agent-skills-installer (public, MIT) | Installer-движок: 62 upstream-источника, 1268 skill'ов, 8 адаптеров рантайма, sync+lockfile+SHA-256. **Кандидат на роль движка маркетплейса** (§8) |
| obra/superpowers | github:obra/superpowers | brainstorm→plan→TDD→subagent методология |
| hallmark | github:Nutlope/hallmark (`npx skills add nutlope/hallmark`) | 21 дизайн-тема, 57 slop-гейтов |
| vercel agent-skills | github:vercel-labs/agent-skills | vercel-optimize, react-best-practices, web-design-guidelines и др. |
| gstack skills | github:garrytan/gstack | 54 claude-skills |
| gbrain skills | github:garrytan/gbrain | генерируются `gbrain skillpack scaffold --all` |
| openpencil skills | github:open-pencil/skills | скиллы дизайн-редактора OpenPencil |
| opendesign skills | github:manalkaff/opendesign | 10 скиллов AI-design-агента |
| mattpocock skills | github:mattpocock/skills | 51 скилл (to-spec, to-tickets, tdd, code-review…) |
| aidevops | github:marcusquinn/aidevops | DevOps-стек для OpenCode-агентов (как источник идей + пакет) |

## 5. Под-проект P1: вкладка Runtime + расширенный toolchain

### 5.1 UI

Новая вкладка `settings/runtime` **поглощает** существующую `settings/toolchain` (роут `settings/toolchain` редиректит на `settings/runtime`, чтобы не плодить дубли). Секции:

1. **Подключения и модель** — уже существующая механика llm-connections (выносим сюда компактный блок): providerType, model, baseUrl; изменение → `llmConnections` в config.json; для OMP — `set_model` в живую сессию без рестарта (прецедент `applyOmpModel`, omp-agent.ts:1644).
2. **Thinking level** — канал `settings:get/setDefaultThinkingLevel` уже есть (REMOTE_ELIGIBLE); UI-перенос сюда.
3. **Approval mode** — allow-all ⇄ `--approval-mode yolo` при спавне; переключение помечает сессии «требуется респавн» (existing flip-механика, omp-agent.ts:1701).
4. **Toolchain** — перенос содержимого нынешней ToolchainSettingsPage + новый раздел «Дополнительные инструменты» (§5.2): per-tool toggle + кнопка Update, состояние через `toolchain:status/statusChanged`.
5. **Env-переменные сессий** — редактируемый `envOverrides` (уже читается SessionManager при спавне OMP).

Одинаково доступно в app-shell навигаторе и из меню (CONFIG-запись в menu-schema, 7 точек правки новой вкладки — см. §3).

### 5.2 Расширение toolchain-манифеста

В `manifest-data.ts` добавляется поле `kind`:

```ts
kind: 'binary'        // как сейчас: pinned URL + sha256 × 4 платформы
     | 'npm'          // как omp сейчас: pinned tarball + embedded package-lock (fail-closed)
     | 'git-npm'      // НОВОЕ: bun install -g github:owner/repo@<commit> — commit pin + lock-хэш
     | 'pip'          // НОВОЕ: через toolchain uv pinned wheel + hashes (uv pip install --require-hashes)
     | 'brew'         // НОВОЕ: логический слой — требует brew (detect-only); installer = brew install --quiet <formula>
     | 'detect'       // НОВОЕ: не ставим, только обнаруживаем (docker, brew) + гайд в UI
```

Новый поле `tier: 'core' | 'default-on' | 'opt-in'`:

- `core` — нынешние 11, всегда устанавливаются (ломать нельзя: CI `scripts/toolchain-smoke.ts`).
- `default-on` — ставятся автоматически на новых девайсах, пользователь может выключить (toggle в Runtime) → persisted в `config.json` `toolchain.disabled: string[]`; `ensureAll` пропускает выключенные.
- `opt-in` — тяжёлые/спорные (docker, brew-зависимые, gstack с его 58MB бинарём, eve beta) — выключены по умолчанию, ставятся по клику.

Mapping инструментов из §4.1:

| Инструмент | kind | tier | Примечание |
|---|---|---|---|
| just, fzf, mise, wt, gstack, infisical | binary | default-on | releases с sha256 |
| opencode, oh-my-openagent, oh-my-codex, oh-my-claudecode, eve, vercel skills | npm | default-on (eve → opt-in, beta) | embedded locks gen-скриптом |
| oh-my-hermes | npm или git-npm | opt-in | источник уточняется (org-форк agisota/oh-my-hermes релевантнее для брендинга) |

> **Errata реализации (2026-08-07)**: `oh-my-openagent` исключён из toolchain — у его npm-дерева транзитивный пакет `git-bash-mcp` не опубликован в registry (npm падает с EUNSUPPORTEDPROTOCOL). До фикса апстрима устанавливается только вручную (`npx oh-my-openagent install`). `gstack` и `oh-my-hermes` — не toolchain, а маркетплейс-записи (у первого нет релизных бинарей, второй не публикуется в npm).
| gbrain | git-npm | default-on | commit-pin обязателен |
| CLI-Anything | pip | opt-in | через uv (python уже в toolchain) |
| mole | brew | opt-in, macOS only | требует brew (detect) |
| docker, brew | detect | opt-in | никогда не ставим сами |

Паттерны переиспользуются как есть: `downloader` (sha256 поток), `installer` (атомарный `current` symlink, лончеры `bin/*` на bun-wrapper), `manager.ensureAll` (волны по `dependsOn`). Новый код — только генераторы локов для npm/git-npm/pip (скрипт `scripts/toolchain-locks.ts` — по образцу `npm-locks.ts` fail-closed; нет лока — не ставим).

**Supply-chain**: ни один новый kind не исполняет `curl|sh` сторонних репо. git-npm pin'ится на commit SHA; pip — `--require-hashes`; npm — embedded lock. Всё это продолжает toolchain-smoke CI (matrix legs уже есть).

### 5.3 Detect-only инструменты

`docker`, `brew`: в UI показываются статусом «обнаружен/не обнаружен». `ensureAll` их не скачивает. Если `brew` обнаружен на macOS и пользователь включил brew-kind инструмент — транзакционный `brew install`, иначе — карточка с install-guide (один клик «Скопировать команду»).

## 6. Под-проект P2: вкладка Context + документы контекста

### 6.1 Новые документы

- **`soul.md`** — личность агента, адаптация публичного систем-промпта/личности Hermes (NousResearch) под рантайм OMP (см. драфт, Приложение A).
- **`rules.md`** — дефолтные жёсткие правила для всех пользователей (Приложение B): принудительный паттерн brainstorm→plan→implement→verify, обязательность скилл-первого-прохода, дефолтный рантайм/модели/CLI.
- Возможность добавлять **произвольные доп. документы** (UI: кнопка «Добавить документ контекста» → новый `*.md` в `~/.craft-agent/context/`).

### 6.2 Доставка и редактирование

1. Шаблоны шипим в бандл: `apps/electron/resources/context/{soul.md,rules.md}`.
2. При старте `ensureContextDocs()` (скопировать образец `initializeDocs()`/`ensureDefaultPermissions()`): создаёт `~/.craft-agent/context/{soul.md,rules.md}` **один раз** (version header `<!-- context-doc-version: N -->`). Пользовательские правки не затираются; если версий бандла новее — мягкий баннер «доступна обновлённая версия шаблона» с дифом и кнопками Accept/Keep mine.
3. Инжект в промпт:
   - Claude/Pi: новый блок в `getSystemPrompt()` (порядок: projectBlock → contextDocs → memory → debug).
   - OMP: расширить `buildCraftContextPrompt()` (`omp-agent.ts:302`) чтением `~/.craft-agent/context/*.md` (лимит 20KB/док, sanitize как у preferences).
4. `CONTEXT_FILE_PATTERNS` дополняется `['soul.md','rules.md']` — per-project файлы с теми же именами в root проекта **переопределяют** глобальные (опциональный механизм, документируем).

### 6.3 UI вкладки `settings/context`

- Список контекст-документов (soul, rules, пользовательские): редактор markdown, статус «шаблон обновился».
- Секция скиллов: ссылка на существующий SkillsListPanel + сводка pre-installed паков (§7) — состояние, версия, enable/disable.
- Секция памяти: сводка MemoryService lessons (read-only, ссылка).

### 6.4 Жёсткость rules.md (решение пользователя)

Дефолт жёсткий: содержимое обязывает модели/рантаймы/CLI и паттерн работы. Файл **редактируем пользователем**; приложение не блокирует аномальный выбор в GUI, но сам правила — пользовательские. В UI метка «отредактировано локально».

## 7. Под-проект P3: пре-установленные скиллы

1. Вендоринг при сборке: `apps/electron/resources/skills/<pack-slug>/...` (из источников §4.2; версии пинятся commit SHA + `SKILLS.lock` в репо).
2. `ensureBundledSkills()` (образец `ensureDefaultPermissions()`): синк каждого пака в `~/.agents/skills/<slug>` на старте main, атомарно (tmp+rename), version-merge по хэшу — локальные правки пользователя не затираются (ручной файн берёт приоритет, UI показывает «локально изменён»).
3. Дефолтно включённые пакеты: `superpowers`, `vercel-agent-skills (подмножество common)`, `mattpocock/skills`. Остальные из §4.2 — доступны через Marketplace (§8) одним кликом, чтобы не раздувать установку (суммарный вес и дедлайны smoke-CI).
4. Отключение пака: `config.json` `bundledSkills.disabled: string[]` — синк его пропускает, директория на диске остаётся (не удаляем пользовательские данные).
5. Доступность агенту: `~/.agents/skills` уже глобальный ярус discovery — ничего менять не надо. @-mention и Skill-tool механики на месте.

## 8. Под-проект P4: Marketplace

### 8.1 Архитектура

- **Каталог**: встроенный `resources/marketplace/catalog.json` + **обязательное remote-обновление** (решено пользователем): при старте и раз в 24ч fetch последнего `catalog.json` с `raw.githubusercontent.com/agisota/craft-agents-oss/main/resources/marketplace/catalog.json` (ETag/If-None-Match, кэш в `~/.craft-agent/marketplace/catalog.cache.json`, сравнение поля `catalogVersion`; при недоступности сети — тихий fallback на встроенную/cached копию). Источник доверия — наш зафиксированный raw-URL; целостность записей обеспечивается pinned commit SHA + SHA-256 контента внутри каждой записи (catalog-is-index, не исполняемый код). Записи каталога:

```jsonc
{
  "id": "vercel-agent-skills",
  "kind": "skillpack",            // skillpack | tool | context-doc
  "title": "Vercel Agent Skills",
  "descriptionRu": "Официальные скиллы Vercel: руководства по React, оптимизации и веб-дизайну для агентов.",
  "source": { "type": "github", "repo": "vercel-labs/agent-skills", "ref": "<commit-sha>" },
  "skills": ["vercel-optimize", "react-best-practices", "..."],
  "license": "MIT",
  "default": "installed|available",
  "sizeHintKb": 240,
  "tags": ["react", "frontend"]
}
```

- **Движок установки**: адаптация логики `agisota/agent-skills-installer` (git clone --depth 1 на pinned ref, verify, lockfile `~/.craft-agent/marketplace/lock.json`, SHA-256 контента) — вместо написания с нуля. Устанавливает в `~/.agents/skills/` (skillpack) или ставит запись в toolchain overlay (tool) либо документ в `~/.craft-agent/context/` (context-doc).
- **Только GitHub-источники** в каталоге, curated: никаких произвольных URL из UI (защита от `curl|sh`-промптов). Расширение каталога — PR в наш репо (ревью + CI-проверка источников).

### 8.2 UI вкладки `settings/marketplace`

**Обязательное наполнение карточки** (решено пользователем — «наполнить хорошенько»):

- Название, **русское краткое и понятное описание** (все описания в каталоге — на русском; source-описания с GitHub переводятся/переписываются кураторами каталога, machine-перевод недопустим).
- **Живые метрики**: ★ stars, ⬇ downloads (GitHub release-downloads + npm weekly для npm-источников), «обновлён N дней назад» (`pushed_at`). Подтягиваются лениво через GitHub REST API (+ npm registry API) с кэшем 6ч в `~/.craft-agent/marketplace/stats-cache.json` и деградацией «метрики недоступны» оффлайн — fetch не блокирует рендер списка (skeleton).
- Теги, размер, лицензия, статус (Installed vX / Available / Update available — через сравнение lock.json с pinned ref каталога).
- Один клик: Install (прогресс по push-каналу), Update, Remove (soft: удаляем то, что сами поставили, не трогая локальные правки).
- Поиск/фильтр по тегам; сортировка: по звёздам / по обновлению / по загрузкам.

### 8.3 Каналы RPC (новые)

`marketplace:catalog` (LOCAL_ONLY), `marketplace:install/remove/update`, `marketplace:statusChanged` (push), `marketplace:list`, `marketplace:refreshCatalog` (форс-запрос remote-каталога), `marketplace:stats` (ленивый fetch ★/downloads/updated с кэшем). Каждый — в `channels.ts`, `channel-map.ts`, `ElectronAPI`, **routing.ts** (LOCAL_ONLY), `ipc-channels.test.ts`. Плюс `contextDocs:list/read/write`, `contextDocs:templateUpdated`. Классификация в routing обязательна (CI exhaustiveness-тест).

## 9. Изменения данных и конфига

`StoredConfig` (config.json) получает:

```ts
toolchain: { disabled: string[] },
bundledSkills: { disabled: string[] },
runtime: { envOverrides: Record<string,string> }   // уже частично существует per-session
```

Новые пути: `~/.craft-agent/context/*.md`, `~/.craft-agent/marketplace/{catalog.json,lock.json}`, `~/.agents/skills/<pack-slug>/`.

ConfigWatcher подписывается на `~/.craft-agent/context/` (push `contextDocs:CHANGED`).

i18n: все новые строки — в 9 локалей (`settings.runtime.*`, `settings.context.*`, `settings.marketplace.*`, `marketplace.*`, `contextDocs.*`), parity-тесты закроют.

## 10. Безопасность

- Каталог curated; установка только из GitHub на pinned commit; SHA-256 проверяется (`agent-skills-installer`-логика).
- npm/git-npm/pip kinds — только с embedded lock. Без лока — fail-closed.
- `soul.md`/`rules.md` — пользовательский контент, включается в промпт как есть (sanitize на уровне интерполяции: escape XML-тегов перед встраиванием в `<project_context>`).
- Marketplace-установка не выполняет postinstall-скрипты установленных репо (clone-only, не `npm install` чужого кода без юзера).
- Detect-only инструменты не модифицируют систему.

## 11. Платформы и оффлайн

- 4 платформы toolchain как раньше; новые binary-инструменты обязаны иметь релизы на все 4 (иначе tier `opt-in` + платформенная оговорка).
- Оффлайн: состояние `offline` уже экзистирует в manager; new kinds используют тот же выход. Marketplace показывает кэш каталога + статус «оффлайн».

## 12. Майлстоуны

| # | Состав | Критерий приёмки |
|---|---|---|
| **M1** | Toolchain kinds (git-npm, pip, brew, detect) + 5 новых binary/npm инструментов (just, fzf, mise, wt, gstack) + тоглы в config | `bun run toolchain-smoke` зелёный на чистом §CRAF_CONFIG_DIR; тоглы реально выключают установку |
| **M2** | Context документы: `soul.md`+`rules.md` шаблоны, ensureContextDocs, инжект в 3 бэкенда, вкладка Context | Новая сессия OMP стартует с --append-system-prompt содержащим rules.md; правка soul.md из UI видна в следующей сессии; CONTEXT_FILE_PATTERNS включает оба; parity i18n |
| **M3** | Preset skills: бандл superpowers+vercel+mattpocock, ensureBundledSkills, disable-флаг | Чистый запуск ставит паки в `~/.agents/skills`; агент видит их через discovery; disable не трогает файлы |
| **M4** | Marketplace: catalog.json (RU-описания), remote-catalog refresh (ETag/24ч), stats-fetch (★/downloads/updated, кэш 6ч), адаптированный installer, вкладка Marketplace, каналы RPC | Install vercel-agent-skills из UI → появляется в skills discovery; карточки показывают ★/загрузки/«обновлён N дней назад» на русском; remote-update каталога применяется без релиза приложения; update/remove round-trip; все каналы в routing.ts + ipc-channels.test.ts |
| **M5** | Вкладка Runtime: поглощение Toolchain + секции модель/thinking/approval/env | Роут `settings/toolchain` редиректит; все ручки меняют config.json и применяются без рестарта где возможно; tab visible в навигаторе и меню |

Зависимости: M1 независим; M2–M4 независимы между собой; M5 опирается на M1 (тоглы) — реализуем параллельно с M1.

## 13. Acceptance-критерия (глобальные)

1. Свежий `~/.craft-agent` + пустой девайс: после старта все `core`+`default-on` инструменты готовы; сессия отвечает; скиллы superpowers известны агенту (`@superpowers` mention резолвится).
2. UI: все три вкладки видны; изменение default-thinking в Runtime применяется к следующей сессии без рестарта приложения.
3. Правка `rules.md` из UI меняет содержимое системного промпта следующей сессии (проверка логом `--append-system-prompt`).
4. i18n parity-тесты, ipc-channels тест, routing exhaustiveness — зелёные; `bun test` регрессий 0 (база: 5531 pass / 0 fail на main).
5. `bunx tsc --noEmit` по всем затронутым пакетам и electron — чисто.

## 14. Риски

- **Вес бандла**: gstack ~58MB на платформу. Митигация: gstack → opt-in (качается по клику), bundled-скиллы без бинарей, суммарный cap DMG +100MB.
- **Скорость первого запуска**: +N инструментов удлиняют ensureAll. Митигация: concurrency поднять до 3, «default-on» качается в background после готовности `core` (уже fire-and-forget).
- **Нестабильность git-npm источников** (gbrain не в npm): pin commit + хэш, alarm при недосупе — как у retry-политики manager'а.
- **i18n дрейф**: 9 локалей — parity-тест в CI наловит.
- **Чужой WIP в routing.ts**: при добавлении каналов делать ребейз осторожно, координироваться с соседней сессией.

## 15. Открытые вопросы — РЕШЕНЫ пользователем (2026-08-07)

1. `mole` = **tw93/Mole** (macOS-чистильщик), kind `brew`, tier `opt-in`, macOS-only. davrodpin/mole (SSH) не нужен.
2. `oh-my-hermes` = **upstream Salomondiei08** (без форк-оговорок).
3. Маркетплейс = **отдельная третья вкладка** `settings/marketplace`, обогащённая метриками (★/downloads/updated) и русскими описаниями (§8.2).
4. Vercel-набор зафиксирован: toolchain — `vercel-labs/skills` + `vercel-labs/agent-browser` (opt-in); пресет-скиллы — `vercel-labs/agent-skills` + `vercel-labs/next-skills`; каталог — `portless`, `just-bash`, `opensrc`, `deepsec`, `dev3000`.
5. Remote-update каталога — **ДА, обязательно** (§8.1: ETag-кэш, раз в 24ч, fallback на бандл).

---

## Приложение A. Драфт `soul.md` (адаптация Hermes NousResearch под OMP)

```markdown
<!-- context-doc-version: 1 -->
# Soul — Craft Agent

Ты — агент рантайма Craft Agents поверх OMP. Отвечай в меру и по делу: каждая
фраза — факт, решение или риск. Не выполняй очевидное заново и не пиши
саммари ради саммари. Если чего-то не знаешь — скажи это специфично, назови
tradeoff и предложи скучно-безопасный вариант.

Рабочий этос: любопытство к источнику, а не к симптому; уважение к чужому WIP;
точность в именах файлов, символах и состоянии; проверка эффекта изменений
перед «готово». Когда инструкция противоречит здравому смыслу безопасности —
назови конфликт, предложи альтернативу и дай пользователю выбор.

Тон: прямой, без лести, без маркетинговых слов. По-русски или в языке
пользователя, термины — на английском как принято в инженерных командах.
```

> Примечание: это авторская адаптация «духа Hermes», а не verbatim-копия (лицензионная чистота + привязка к нашему рантайму). Финальный текст — на утверждение.

## Приложение B. Драфт `rules.md` (дефолтные жёсткие правила)

```markdown
<!-- context-doc-version: 1 -->
# Rules — Craft Agent (по умолчанию; этот файл можно править)

## Рантайм и модели
- Основной рантайм: OMP (`@oh-my-pi/pi-coding-agent`), бэкенд `providerType: 'omp'`.
- Дефолтная модель: из LLM-подключения по умолчанию (seed: rox-kimi / kimi-K3).
- Auxiliary CLI-агенты (codex, opencode, oh-my-*) — только для верификации/консультаций
  по запросу задачи, не как замена основной петли.

## Рабочий паттерн (обязателен)
1. Сначала скиллы: перед нетривиальной задачей проверь известные скиллы; применяй подходящие.
2. Процесс: brainstorm/уточнение → план → реализация → верификация эффекта.
3. Симптом не гасим: чиним в источнике.
4. Чужой WIP в дереве не трогаем.
5. Перед «готово» — прогон реального сценария, а не только теста/тайпчека.

## Ограничения
- Не модифицировать системные пути вне toolchain без явной просьбы.
- Не выполнять curl|bash из неподтверждённых источников.
- Все новые зависимости — pinned, с lockfile.
```

## Errata (implementation)

- **Channels / catalog:** marketplace uses the catalog + CHANGED channels shipped in-tree (not a separate feed surface).
- **Locales:** 10 locale files under `packages/shared/src/i18n/locales` (en, ru, de, es, fr, hu, ja, pl, zh-Hans, zh-Hant); parity tests enforce key sets.
- **Context docs UI strings:** `settings.context.*` including `settings.context.locallyEdited` (“Edited locally” / «Отредактировано локально») when installed body differs from bundled template (version headers stripped).
- **Marketplace empty keys:** live empty state uses `marketplace.emptyTitle` / `marketplace.emptyDescription`; unused `settings.marketplace.emptyTitle` / `emptyDescription` removed.
- **Catalog packs:** gstack / hermes marketplace entries present; openagent excluded (unpublished transitive deps).
- **Runtime LLM compact:** Runtime settings shows default connection summary (name, provider, model, base URL, auth) with switcher + link to full AI settings (`settings.runtime.llm*`).
- **Toolchain disabled filter:** `setToolchainDisabled` / known `ToolName` set (`ALL_TOOL_NAMES`) fail-closed — unknown names dropped on persist.
- **Content pins:** `expectedContentSha256` required for `skillpack` / `context-doc` at `parseCatalog`; tools remain unpinned by design.
- **Catalog remote integrity:** remote fetch verifies `catalog.json.sha256` sidecar when the catalog URL ends with `catalog.json` (GNU `sha256sum` format); bundled sidecar verified when present.
- **Brew:** install uses `brew install --quiet <formula>`; on pin mismatch uninstall uses `brew uninstall --force` then errors; no `formula@version` pin form for mole.
- **CLI-Anything:** shipped as toolchain opt-in pip tool `cli-anything` / lock `cli-anything@0.4.1` (hub entry `cli-hub` / `cli_hub.cli`).
- **Marketplace card copy:** entry descriptions remain curated Russian (`descriptionRu`); machine translation of upstream READMEs is not used.
- **Catalog signing:** ed25519 over catalog.json body (`catalog.json.sig`); public key baked in `catalog-signing.ts`; private key via `CRAFT_MARKETPLACE_CATALOG_SIGNING_KEY` or gitignored `scripts/.marketplace-catalog-signing-key.b64` when running `marketplace-content-sha.ts`. Combined with `catalog.json.sha256` digest + content pins.
- **Model switch from Runtime:** always updates the default LLM connection; when a chat session is focused (`activeSessionIdAtom`), also calls existing `electronAPI.setSessionModel(sessionId, workspaceId, defaultModel, slug)` (same path as ChatPage). Without a focused session, applies to the next session only.
