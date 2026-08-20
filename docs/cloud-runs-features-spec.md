> **W3 (commit a5ba72b2c):** WS-стриминг на обеих gateway (/runs/:id/ws, hibernation-safe) — CF acceptWebSocket + logEvent fanout, Modal FastAPI ws; strict scoping (инцидент: первая версия перехватывала backend handshake). Schedules UI в диалоге (list/toggle/delete/add, i18n ×9). docker-housekeeping.sh + launchd (Ср+Вс 09:30). F21 prod: CI job craft-gateway-deploy (amd64 без QEMU, wrangler deploy через CCI env CLOUDFLARE_API_TOKEN/ACCOUNT_ID/CLOUD_RUNS_TOKEN — добавить в CCI project env) + Dockerfile.omp. runner-omp lazy-install убит spike'ом — fail-fast вариант.

# Spec: Cloud Runs — пакет след-фич (F1–F22)

> **Статусы по 2026-08-06 (commits eef8d6891 → 5e91c5e75):** зашиты и live-проверены F1,F2,F3 (pack-model),F4 (agent-loop runner v2: 6 rounds/15 tool calls live),F5 (brief.json structured, 12 claims/10 links live),F6 (cheapModelId),F8 (self-contained scheduler в watcher + schedules CRUD channels),F9,F10,F11 (preview Markdown renderer),F12,F13,F14 (eventLog + events route + dialog tail; WS отложен),F16 (marp slides CF),F19,F20,F22 (personas). **Отложено: F18 E2B (нужны креды от вашего E2B), F21 omp-runner (см. ниже), F17 workflow CI — активируется с secrets CLOUD_RUNS_{TOKEN,MODAL_GATEWAY_URL,CLOUDFLARE_GATEWAY_URL} в repo settings.**

> **F15 зашит и live-проверен (commits 22-46H):** токенизированная публичная share-страница GET /share/<id>/<token> на обоих gateway (HTML read-only, маркдаун-артефакты inline), POST /runs/:id/share|revoke под do-auth; UI кнопка Share копирует ссылку в клипборд. Live: mint→200(10KB page)→revoke→404.

> **F21 — spike, shelved (2026-08-06):** кодовый вариант `agenticMode: 'omp'` зашит (runner-omp.mjs, variant switch в startPackExec, lazy `npm i -g @oh-my-pi/pi-coding-agent+bun` в контейнере). Live-проба обнажила: npm-инсталл ~500MB в CF-контейнере НЕ укладывается в subtask бюджеты (>15 мин, watchdog убил по wall-clock). Причина НЕ сетевая: native postinstalls + io-ограничения ephemeral fs. Сценарий включения в прод: собрать образ CI-потоком на реальном amd64 хосте (без QEMU+дисковых трений), где omp+bun инжектятся в билд-стейдж — delta ~700MB. До тех пор runner v2 (loop) прагматически эквивалентен (те же web_search/fetch_url tool-calling).



Статус: waves 1–2 зашиты (commits eef8d6891 → 5e91c5e75); открыты: F15 (viewer-инфра), F18 (креды), F21 (omp-runner spike), F17 (активация secrets CI)
Владелец: команда форка `agisota/craft-agents-oss`
Дата: 2026-08-06
Связанные документы: [cloud-runs-prd.md](cloud-runs-prd.md) (G1–G5 зашиты), TRUTH: код фаз 1–4 + follow-ups.

Конвенции исходного состояния: gateway'и (CF: `apps/cloud-gateway`, Modal: `apps/modal-gateway`) имеют marker-driven неблокирующий state machine, usage-ledger (tokens+cpuMs), ttl-sweep, auto-flip при createRun, watcher/webhook. Контракт провайдеров — `packages/cloud-runner/src/types.ts`. Конформанс — `conformanceSuite`.

---

## F1. Resume failed run

**Цель:** failed-ран можно довести до done без перезапуска с нуля.

**Поверхность:** кнопка «Resume» на failed-ране в диалоге (рядом с retry). Повторный `SUBMIT` с **тем же spec.id** и исходными subtasks.

**Дизайн:**
- Gateway уже идемпотентен по spec.id: второй createRun вернёт handle и DO/modal продолжит со skip готовых done.marker'ов. Двухстороннее rescue работает.
- Handler: `cloudRuns:resume` RPC — по runId из registry берём записанное, пересобираем spec (реестр не хранит spec целиком! Надо: registry хранить также `subtasks` и `limits` на submit — небольшая миграция записей; старая запись без subtasks → resume недоступен, показ «недоступно»).
- Провайдер-getStatus до submit'а: failed/cancelled обязателен.
- UI кнопка disabled для записей без subtasks (легаси).

**Приёмка:** после измена LLM-лёг (503 или timeout) resume на том же runId доводит run до done, используя ✅ маркеры ранних сабтасков (usage не удваивается — копится только недоделанное).

**Риски/касания:** registry migration (ловушка: старые записи), ожидаемая доп-запись ~2KB на ран — ок.

**Оценка:** 0.5–1 день. Файлы: server-core cloud-runs.ts (registry shape, RESUME handler), channels.ts, channel-map, ElectronAPI, chip UI, i18n ×8.

---

## F2. Cancel-kill: реальная остановка исполнения

**Цель:** cancel обрывает LLM-биллинг и вычисление, а не только state-флаг.

**Дизайн:**
- CF: RunDO хранит последний exec handle id → cancel вызывает backend killExec(id) (интерфейс ShellRPC.killExec есть). Fallback: `ctx.container.signal(SIGKILL)` нет — тогда принудительный сон контейнера (простой путь: удалить `.craft-run/config.json` + write `KILL.marker`, раннер не увидит... _нет_: лучший простой ход — `this.backend.containerStop?`; практически: после cancel DO также чистит awaitingSubtask и НЕ ре-стартует alarm chain; исполняющийся exec доигрывает, но его маркер уже игнорируется (state cancelled wins) — для митигирования биллинга в v1 достаточно killExec).
- Modal: driver loop перед каждым sandbox проверяет cancel-key (уже делает); для убийства летящего sandbox хранить sb.terminate() в driver (cancel-key check внешним endpoint + terminate через отдельный endpoint, который модал хранит в Dict: run_id→sb id).
- Тест: cancel mid-subtask → счёт не тикает дальше (usage.cpuMs замерзает), state=cancelled.

**Приёмка:** cancel на 30-й секунде сабтаска → usage на следующем опросе не растёт >+10%.

**Оценка:** 1 день. Файлы: run-do.ts (killExec), modal app.py (sb registry), handler tests.

---

## F3. Параллельные сабтаски (concurrency=2, опц. больше)

**Цель:** wall-time 5-сабтаск рисёрча ~15 мин → ~4-6 мин без потери порядка сборки.

**Дизайн:**
- Модель: пул exec'ов размером `spec.concurrency ?? 2`. Маркеры изолированы по subtask-подпапкам — collision-семантики нет. RunDO: state расширяется `awaiting: Record<subtaskId, PersistedAwaiting>` (вместо одного). Alarm-тик: сколько свободных слотов — столько стартов; исходы читаются маркерами как сейчас.
- Modal: driver спавнит пачку sandboxes (asyncio.gather с семафором).
- Бюджет-семантика не меняется: watchdog по общему wall-clock; usage складывается.
- Сabtask_timeout per subtask остаётся.
- Конфиг: spec.concurrency (default 2, max 4), UI не трогаем (поле в settings позже).
- PERF-риск: LLM-gateway poolSize:1 был замечен в 503 — предохранитель: при 503 → автоснижение эффективного concurrency до 1 на остаток рана (adaptive backoff).

**Приёмка:** 5-сабтаск run на CF завершается за ≤40% времени живой базисной версии; ни один сабтаск не конфликтует за workspace path (conformance green).

**Оценка:** 2 дня. Файлы: run-do.ts (пул), modal app.py (gather), spec type, conformance (порядок маркеров не важен).

---

## F4. Real research-раннер (multi-tool loop)

**Цель:** сабтаски делают настоящий deep research (поиск, чтение источников, итерации) вместо single-shot эссе.

**Дизайн (два варианта, выбор в фазе реализации):**
- **A. omp-runner:** образ собирает `npm i -g @oh-my-pi/pi-coding-agent`, config с rox-провайдером инжектится gateway'ем, запуск `omp --mode rpc` и handler protocol (omp-rpc-notes). Плюс: настоящий агент-луп, web_search из конфига. Минус: тяжёлый деплой, ещё один auth-поток, слабее контроль пер-степ.
- **B. Встроенный mini-loop (рекомендуем):** runner.mjs расширяется до bounded agent-loop: LLM может вызвать tools `web_search` (через craft sources? нет — в облаке нет craft) → используем `api.rox.one` если есть search-эндпоинт, иначе прямые проприетарные (Exa/Tavily key из env секретов cloud-runs.env gateway-side) + `fetch_url` (cheerio → markdown). ≤8 tool-steps per subtask, trace пишется в `trace.jsonl`.
- Выбор: spike 1 день попробовать A; провал → B как fallback (наоборот со спадом спека в PRD фазе 0 бы).

**Приёмка:** риссёрч-ответ содержит ≥3 реальные ссылки (проверка по regex в answer.md), trace записан.

**Оценка:** spike 1 день + 2-3 дня runner.

---

## F5. Structured artifacts (schema-выход)

**Цель:** отчёт агрегатора со ссылками, доверительностью и цитатами, а не беллетристика.

**Дизайн:**
- Сабтаск-выход: `brief.json` {summary, claims[{text,confidence,sources[]}], links[]} + человекочитаемый `answer.md` (рендер из json).
- Runner: response_format json_schema (OpenAI совместимый). api.rox.one поддержка — проверить в spike; fallback: prompt-constrained JSON + zod-проверка в runner'е (х2 try).
- AGGREGATE prompt: собирать из brief.json'ов (структура вместо MD).
- Обратная совместимость: answer.md продолжает писаться (для preview в UI).

**Приёмка:** brief.json валиден по zod; отчёт аггрегатора содержит секцию «Источники» с реальными URL.

**Оценка:** 1-2 дня.

---

## F6. Multi-model mix

**Цель:** дешевле и лучше: черновые сабтаски на дешёвых моделях, синтез-аггрегация на сильной.

**Дизайн:**
- Subtask spec += `model?` (уже есть в spec.model top-level); buildResearchSpec: landscape/alternatives → `cheapModel` (config cloudRuns.cheapModelId), state-of-the-art/outlook → main, aggregation preserves session model.
- Registry/usage: статус usage разложить по моделям (usageByModel) — usage-agent.json уже имеет model context.
- UI: settings-два поля (main/cheap model id).

**Приёмка:** run записывает usage по моделям; стоимость такого рана ниже baseline при НЕ худшем качестве (ручная сверка 2 тестовых тем).

**Оценка:** 1 день.

---

## F7. Run forking (уточнение от отчёта)

**Цель:** от done-рана: «уточни X» — доп. сабтаски в тот же workspace, сборка поверх существующих брифов.

**Дизайн:**
- RPC `cloudRuns:fork {runId, subtasks[]}`: gateway createRun spec.id = `<orig>--fork-<n>` **но** DO workspace НЕ трогаем (это новая DO!) — нужен spec.parentRunId: gateway при старте fork копирует artifacts родителя в `context/` рабочей папки (exec cp через fs API).
- Агрегатор видит `context/*` как prior briefs.
- UI: кнопка «Уточнить» на done-ране → поле вопроса → 1-3 новых сабтаска (LLM-генерация сабтасков из вопроса, опц. шаблон).

**Приёмка:** fork-ран видит брифы родителя как контекст; отчёт агрегатора привязан к уточняющему вопросу.

**Оценка:** 2 дня.

---

## F8. Scheduled runs (интеграция с Automations)

**Цель:** «Рисёрч по X каждый понедельник в 9:00» из существующей системы автомейшенов craft.

**Дизайн:**
- Automation action type `cloud_run` (registry действий автомейшенов в server-core; посмотреть tasks.ts/automations handler): params {topicTemplate, provider}. По тику: buildResearchSpec → createRun → по done автосборка в целевой sessionId (или новую сессию на каждую дату).
- Шаблонизация темы датой: `{{date}}` → "AI chips market как на {{date}}".
- Оповещение: webhook уже есть; ещё push в сессию.

**Приёмка:** автомейшн срабатывает по расписанию (test: fake tick handler есть), создаёт ран и отчёт в указанной сессии.

**Оценка:** 2 дня (зависит от pluggability автомейшенов).

---

## F9. Префил темы из сессии

**Цель:** кнопка не требует ручного ввода темы.

**Дизайн:** в диалоге кнопка «Из сессии»: RPC `cloudRuns:sessionTopic {sessionId}` → server читает последние N сообщений (getSessionMessages) → короткий LLM-вызов (smol) для формулировки research-темы → поле заполнено, юзер правит. Без LLM: fallback = title сессии + последний user-message (обрезать 200с).
**Приёмка:** поле заполняется осмысленной темой ≤2 дек; ручное переопределение всегда доступно.
**Оценка:** 0.5–1 день.

---

## F10. Presets шаблонов ранов

**Цель:** один клик до типового пака.

**Дизайн:** buildResearchPack(kind): research(5), competitor(5: landscape/pricing/weakness/swot/outlook), literature(4: surveys/methods/gaps/future), vendor(5: capabilities/pricing/lock-in/references/recommendation). Map kind→prompt templates (RU/EN). UI: select `Режим` в диалоге, default research.
**Приёмка:** каждый preset выдаёт ≥4 сабтаска с осмысленными промптами (snapshot-test на количество/идентификаторы).
**Оценка:** 1 день.

---

## F11. Artifact preview в диалоге

**Цель:** чтение answer.md без похода в файловую систему.

**Дизайн:** done-ран → кнопка-иконка «eye» на строке → RPC `cloudRuns:readArtifact {runId, path}` (server читает через provider.fetchArtifact — remote gf) → открыть DocumentFormattedMarkdownOverlay/GenericOverlay (существующие компоненты). Размер-cap 100KB.
**Приёмка:** двойной клик по строке открывает overlay с реальным brief; traversal-safe.
**Оценка:** 0.5–1 день.

---

## F12. Failure detail в UI

**Цель:** failed показывает причину и подсказку.

**Дизайн:** LIST handler: уже возвращает status с failureReason; добавить failureDetail (есть в status gateway'я). Chip: иконка (i) на failed-ране → tooltip/popover с detail + actionable hint map: budget_exceeded→«поднять лимит в Settings», runner_error 503→«LLM перегружен, нажмите Resume/Retry», timeout→«сабтаск не уложился, упростить тему».
**Приёмка:** у каждого failureReason есть текст-подсказка (i18n ×8).
**Оценка:** 0.5 дня.

---

## F13. Оценка стоимости до старта

**Цель:** юзер видит «примерную цену вопроса» до нажатия.

**Дизайн:** registry хранит usage завершённых research-ранов → сервер считает медиану (tokens+cpuMs) → RPC возвращает в GET_CONFIG: estimatedRunCost {tokens, cpuMs, usdLower, usdUpper} (usdrange из config costPerMTokens USD bounds). Отображение в диалоге под полем темы.
**Приёмка:** после ≥1 завершённого рана диалог показывает оценку и диапазон; до данных — «нет статистики».
**Оценка:** 1 день.

---

## F14. Streaming прогресса (WS)

**Цель:** живой текст текущего сабтаска вместо счётчика x/5.

**Дизайн:** gateway: WS `/runs/:id/events`: DO держит-пишет события-строчки (`subtask started/done`, tail stderr через exec events). RunDO: alarm loop → не WS; подписка через отдельный fetch-handler-створ: WebSocketPair; события пишутся в storage log (cap 200 строк). UI dialog подписывается, рисует live-log. Optional: SSE вместо WS (проще через Worker).
**Приёмка:** при открытом диалоге виден строковый прогресс (subtask landscape: LLM responding…), без задержки poll.
**Оценка:** 2 дня.

---

## F15. Shared runs (публичная read-only ссылка)

**Цель:** ссылка на артефакты/отчёт для внешних людей.

**Дизайн:** viewer-infrastructure уже есть (apps/viewer). RPC `cloudRuns:share {runId}` → server пишет snapshot (artifacts + REPORT.md) в вид viewer-bundlea (session-bundle механика) → public URL. Отзыв (`revoke`). Отчёт санитизируется (без .craft-run/config.json, секреты отсекаются фильтром).
**Приёмка:** ссылка открывается без auth, содержит все MD-артефакты; revoke закрывает доступ; файлы с секретами не попадают в bundle (тест ассерт).
**Оценка:** 2 дня.

---

## F16. Отчёт → презентация

**Цель:** возврат к исходному юзкейсу «преза по теме»: runner генерит слайды.

**Дизайн:** в образ CF (и modal-image) добавить marp-cli (npm-g) → опц. журнал: spec.outputs: ['slides'] → runner после LLM прогоняет marp answer.md → slides.html/pdf → артефакт. UI: чекбокс «Слайды» в диалоге; import скачивает.
**Приёмка:** стандартный ран с флагом выдаёт slides.html среди артефактов, открываемый браузером.
**Оценка:** 1 день + образ rebuild.

---

## F17. Nightly conformance CI

**Цель:** preview-API рассинхрон CF ловится раньше пользователей.

**Дизайн:** GitHub Action (cron 04:00 UTC): install → conformanceSuite local + CF + Modal (secrets в actions secrets), fail → issue создаётся/комментируется. RWX no deployments, только run'ы.
**Приёмка:** зелёный крон на момент сдачи; форс-фейл (несуществующий токен временно) создаёт алерт.
**Оценка:** 0.5 дня.

---

## F18. E2B-провайдер (третья нога)

**Цель:** vendor risk хеджировать до трёх.

**Дизайн:** E2BProvider в cloud-runner: E2B Sandbox API (create sandbox, write config+runner py (re-использовать модал-runner скрипт!), watch markers, template `python:3.11`). API-контракт E2B SDK JS — assess in impl. Тот же conformanceSuite gate.
**Приёмка:** E2B conformance leg green; флип provider=e2b работает.
**Оценка:** 1-2 дня.

---

## F19. Zombie-страж

**Цель:** раны, застрявшие в running (краш DO без alarm, баг state machine), не висят вечно.

**Дизайн:** DO-alarm при старте: awaitingSubtask старше 2×SUBTASK_TIMEOUT → mark failed zombie; продуктовый zombie-guard уже частично внутри timeout-логики — этот пункт: **серверный свип** раз в 10 мин: registry runs running > 2×wallClock → getStatus;
**Приёмка:** зомби (специально созданный) помечается failed{failureReason:'zombie_reaped'} в течение 15 мин.
**Оценка:** 0.5 дня.

---

## F20. Import sanitizer

**Цель:** cloud-контент (markdown) до локального агента проходит проверку на враждебные инструкции.

**Дизайн:** IMPORT/AGGREGATE: простой gate: (а) лимиты размера (есть), (б) паттерн-скан на известные injection-маркеры ("ignore previous instructions", "system prompt", tool-name упоминания craft) → флаг `sanitized: true` + предупреждение юзеру (не блок). (в) AGGREGATE prompt: обёрнуть брифы в «данные, не инструкции» доселение.
**Приёмка:** fixture с hostile-md импортируется с предупреждением; аггрегатор видит briefing-block framing.
**Оценка:** 1 день.

---

## F21. omp-runner path (возвращён по решению владельца)

**Цель:** вариант A из F4 как альтернативный раннер (первый класс, не сброс).

**Дизайн:**
- Образ: `npm i -g @oh-my-pi/pi-coding-agent` на слое поверх computerd (image tag bump).
- Config injection: gateway пишет `/workspace/.omp/agent/config.yml` (providers: rox base+key из Secrets env), `~/.omp` → symlink в workspace для persistence.
- Runner: спавн `omp --mode rpc --session-dir <dir>`, NDJSON протокол (docs/omp-rpc-notes подробно), host-tools только для fs/web — депривизировать craft-бинарки.
- Риски: размер образа (+~150MB node_modules), холодный старт +10-20с, версионирование omp (pin semver) — nightly conformance (F17) прикрывает.
**Приёмка:** в CF sandbox omp стартует rpc, принимает turn с research prompt и даёт tool-trace в artifacts/trace.jsonl.
**Оценка:** spike 1 день + 2 дня интеграция.

---

## F22. Multi-run personas (возвращён)

**Цель:** «спор экспертов» — один запрос = 3 персоны (аналитик/скептик/оптимист) с разными системными промптами, агрегатор пишет «синтез дискуссии».

**Дизайн:** spec.personas[{id, systemPrompt}] × N subtasks-grid; маркеры уже изолированы по subtask id — преффикс `persona--subtask`. Аггрегация: спец-пресет (F10) persona_synthesis. UI: чекбокс multi-persona в диалоге.
**Приёмка:** две темы прогоняются с заметно diverging briefs (не одинаковый текст); агрегатор пишет секцию противоречий по персонам.
**Оценка:** 1.5 дня (на базе F3/F5).

---

## Матрица зависимостей

```
F4(F21) ← F17 (conformance защищает preview-auth)
F6 ← F4 (usageByModel from runner)
F7 ← F5 (structured context copy)
F3 ← (независимая сразу)
F14 ← F3 (события пула)
F22 ← F3, F5
F16 ← F11 (preview slides)
F8 ← F1 (resume логика для отказов автомейшена)
F12 ← F11/общий UI refactor диалога
```

## Общий план тестирования будущих фич

- Каждая фича: unit (handler level, existing fakeServer pattern) + затронутая conformance-нога, live smoke для gateway-изменений; UI-фичи — CDP-drive e2e (existing harness: electron + vite + 9333).
- i18n ×8 на каждый новый ключ (lint:i18n:parity gate).
