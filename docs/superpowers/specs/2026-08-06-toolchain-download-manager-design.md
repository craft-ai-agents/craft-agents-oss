# Toolchain Download Manager — дизайн

Дата: 2026-08-06. Статус: утверждён пользователем (дизайн-решения ниже).

## Проблема

Свежая установка Craft Agents падает с `Executable not found in $PATH: "omp"`: форк сидит дефолтное LLM-подключение `rox-kimi` с `providerType: 'omp'` (`packages/shared/src/config/storage.ts:2520-2591`), а `OmpAgent` резолвит бинарник только через `OMP_CLI_PATH || 'omp'` (`packages/shared/src/agent/omp-agent.ts:507`). При этом приложение **подписано и нотаризовано** (проверено на 0.11.4: `Developer ID Application: Blockratize Inc (6M3F56SRFC)`, `spctl: Notarized Developer ID`) — поэтому «зашить всё в бандл» означало бы подписывать/нотаризовать каждый вложенный бинарник и раздувать zip с 273MB до ~500–600MB. Выбрана стратегия **first-run download manager**: артефакты, скачанные приложением в `~/.craft-agent`, не получают quarantine-атрибут (скачивание не браузером).

## Цели

1. OMP-подключение по умолчанию работает из коробки: после первого запуска `omp` установлен без каких-либо действий пользователя.
2. Агенты в своих сабпроцессах имеют определённый набор инструментов (`gh`, `jq`, `yq`, `ffmpeg`, `pandoc`, `node`, `python`, `git` на Windows) через `PATH` без настройки.
3. Обновление инструментов не требует релиза приложения.
4. Headless server и CLI получают тот же менеджер.

## Утверждённые решения

- **Автоустановка всего манифеста по умолчанию.** Никаких opt-in кнопок «Install» как обязательного шага: менеджер при старте приложения ставит все отсутствующие/устаревшие инструменты молча в фоне (включая ffmpeg, несмотря на ~80MB). UI — только отображение прогресса/статуса и принудительный «Update now».
- **pi не включать** (решено, вопрос снят).
- **Источники загрузки — напрямую** (GitHub Releases/CDN вендора). Без зеркала/прокси в MVP; зеркало — возможный отдельный шаг позже. Rate limits GitHub API обходим: качаем зафиксированные в манифесте прямые URL артефактов, API не дергаем.
- **Windows поддерживается** наравне с macOS/Linux (включая portablegit — на macOS/Linux git считаем системным, только проверка наличия с warning-бейджем).
- **Оффлайн**: тихий fail попытки установки + бейдж «offline» в UI, ретрай при следующем старте / по появлению сети.

## Нецели

- Не ставим системные пакеты, не трогаем глобальный PATH, Homebrew, /usr/local.
- Не зеркало артефактов, не проверка подписей сверх sha256 (GPG — позже, если понадобится).
- Автообновление инструментов под запущенным агентом — нет; обновление применяется при рестарте или явной кнопкой.
- «pi» (@mariozechner/pi-coding-agent) в манифест не входит: pi-agent-server уже встроен в бандл.

## Архитектура

Новый модуль `packages/shared/src/toolchain/`:

```
toolchain/
├── manifest.ts     # декларативный манифест: tool, version, per {os,arch}: {url, sha256, size, archive, binPaths[]} — единственная точка правки при бампе версий
├── downloader.ts   # fetch -> ~/.craft-agent/downloads/partial + sha256-verify + atomic rename; retry с backoff (все 5xx и сетевые сбои); <=2 параллельных загрузки
├── installer.ts    # распаковка tar.gz/zip (на bun — bun:nesi tar; windows zip), chmod +x (unix), layout ~/.craft-agent/toolchain/<tool>/<version>/ + symlink/junction current
├── resolver.ts     # findExecutable(name): toolchain -> bundled (claude/uv/ripgrep/bun) -> PATH; toolchainEnv() -> { PATH, доп. vars (UV_PYTHON_INSTALL_DIR и т.п.) }
├── manager.ts      # ensureAll(): diff installed vs manifest, оркестрация download+install, статус-машина per tool (missing/downloading(%)/installing/ready/error/offline/outdated)
└── status.ts       # снапшот статусов для UI/CLI, event-emitter для прогресса
```

### Интеграционные точки

- **OmpAgent** (`packages/shared/src/agent/omp-agent.ts:507,1684`): вместо `OMP_CLI_PATH?.trim() || 'omp'` → `process.env.OMP_CLI_PATH?.trim() || resolver.findExecutable('omp')`. Поведение OMP_CLI_PATH сохраняется (override приоритетен).
- **Env сабпроцессов агентов**: в местах спавна агентов (`base-agent.ts` / `omp-agent.ts` / pi-agent) `env = { ...process.env, PATH: resolver.toolchainPath() + path.delimiter + process.env.PATH }`.
- **Bootstrap**: `packages/server-core/src/bootstrap/headless-start.ts` и electron main после `ensureConfigDir()` — `toolchainManager.ensureAll({ background: true })`.
- **UI (electron renderer)**: раздел настроек «Toolchain»: список инструментов (имя, версия, размер, статус, прогресс-бар), бейдж offline, кнопка «Обновить» при `outdated`. События прогресса через существующий IPC/event-канал.
- **CLI**: `craft toolchain status|update` (тонкая обёртка над status.ts/manager.ts) — если в форке есть CLI точка входа; иначе откладываем.
- **Seed rox-kimi**: больше не требует предустановленного omp — ensureAll ставит его до первой сессии. Если установка не успела/оффлайн — OmpAgent показывает понятную ошибку «omp ещё не установлен: идёт загрузка toolchain» вместо голого ENOENT.

## Манифест инструментов (планируемый состав)

| Инструмент | ~Размер/платформу | Источник | Платформы | Примечание |
|---|---|---|---|---|
| omp | ~30MB | npm tarball `@oh-my-pi/pi-coding-agent` (registry.npmjs.org, прямой URL к .tgz), запуск через вендорный bun | все | критичный — блокирует дефолтное подключение; bun и node_modules-tree кладём рядом, launcher-скрипт `omp` |
| python 3.12 | ~40MB | `uv python install 3.12 --install-dir <toolchain>/python` вендорным uv (astral standalone) | все | uv уже в бандле — python «бесплатно» |
| node LTS | ~48MB | nodejs.org/dist tar.gz/zip (pinned) | все | для npx-based MCP серверов |
| ffmpeg | ~80MB | static builds: evermeet.cx (mac), BtbN (win/linux) | все | ставится по умолчанию вместе со всеми |
| pandoc | ~30MB | GitHub jgm/pandoc releases | все | |
| gh | ~12MB | GitHub cli/cli releases | все | |
| jq | ~3MB | GitHub jqlang/jq releases | все | |
| yq | ~5MB | GitHub mikefarah/yq releases | все | |
| git | ~50MB | portablegit (GitHub git-for-windows releases) | только win | mac/linux: детект системного; отсутствует -> warning-бейдж |

Итого полная установка ≈ **~300MB на машину** сверх бандла 273MB. bun/uv/ripgrep/claude не качаем — регистрируем в resolver как bundled.

Все pinned версии + sha256 фиксируются в `manifest.ts` (per os/arch константы). Обновление = правка манифеста + PR.

## Поток загрузки/установки

1. `ensureAll()` при запуске (фон, после bootstrap): diff манифеста с `toolchain/state.json`.
2. Для каждого missing/outdated: скачать в `~/.craft-agent/downloads/partial/<tool>-<version>`, сверить sha256, распаковать в `toolchain/<tool>/<version>`, атомарно переключить `current` symlink, удалить старую версию и partial. Ошибка hash — удалить partial, ошибка состояния per-tool.
3. Resume: без Range-resume в MVP — повтор с чистого листа (проще, 273MB не качаем единым файлом). Partial-файлы при повторном старте удаляются.
4. Обновления: bump версии в манифесте -> статус `outdated` -> ставится автоматически при следующем ensureAll (новая директория, переключение symlink только когда агенты не запущены? нет — переключаем сразу: unix удаление/перестановка symlink не ломает запущенный процесс; на Windows занятый .exe не даст себя удалить -> откладываем cleanup, symlink переключаем junction'ом, обновление PATH-lookup подхватится новыми процессами).
5. Оффлайн: любой сетевой сбой до начала скачивания -> статус `offline`, ретрай по online-event (electron: `net.isOnline`/событие `online`; headless: экспоненциальный backoff до 15 мин).

## Обработка ошибок и статус-машина

Состояния per tool: `missing -> downloading(pct) -> installing -> ready | error(msg) | offline | outdated(-> downloading...)`. Статус-снапшот живёт в `toolchain/state.json` (для переживания рестарта) + runtime events для UI.

- sha256 mismatch: артефакт удалён, tool в `error`, ретрай при следующем ensureAll.
- 404/CDN-сбой: retry x3 backoff [5s, 30s, 2m], затем `error` до следующего запуска.
- ROI: критичность только у `omp` — его статус дублируем в UI-ярлык подключения (rox-kimi карточка показывает «Установка рантайма… %»).

## Тестирование

- unit: manifest-валидация (все не-Windows записи имеют sha256 и url для каждой target-платформы), downloader (mock fetch: ok, hash mismatch, retry), installer layout/symlink, resolver precedence (toolchain > bundled > PATH).
- integration: ensureAll с локальным file- «сервером» (test fixtures маленьких архивов) — полный цикл install -> findExecutable попадает в toolchain.
- smoke (ручной/ CI по тегу): на чистом профиле `CRAFT_CONFIG_DIR=/tmp/fresh` запуск -> все tools ready, `omp --mode rpc` стартует, OmpAgent проходит turn.

## Риски

- **Rate limits/блокировки вендор-CDN**: смягчено retry; зеркало — следующий шаг при жалобах.
- **Размер**: ~300MB на машину — принято пользователем («ставим всё по умолчанию»).
- **Windows антивирусы** на portablegit/ffmpeg — принимаем, clean fallback: `error` статус с инструкцией.
- **Целостность**: все артефакты только по sha256 из манифеста; манифест в подписанном приложении -> неизменяем в рантайме (remote-manifest не делаем в MVP).

## Что не делаем в MVP (отложено)

- Зеркало/прокси загрузок.
- Range-resume прерванных загрузок.
- Автообновление без рестарта, дельта-апдейты.
- CLI `craft toolchain` если нет CLI-точки входа в форке.
