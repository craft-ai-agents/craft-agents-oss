# Self-learning + Self-evolving для craft-agents — дизайн

Дата: 2026-08-06. Статус: draft (на ревью).
Референс-механизм: kirodotdev/KiroCrew (`src/kiro_crew/{learn,memory,history,skills,context,heartbeat}.py`).

## Цель

1. **Self-learning**: коррекции пользователя и фейлы задач становятся durable-уроками; предпочтения и контекст проекта переносятся в новые сессии.
2. **Self-evolving**: повторяющиеся паттерны становятся переиспользуемыми скиллами (с user approval).

Архитектурное решение (согласовано): **гибрид** — хранилище владеет craft (файлы в `~/.craft-agent` и workspace, видимые/редактируемые в UI), дистилляцию и skill-синтез выполняет OMP-агент внутри серверного процесса craft (не новый LLM-клиент). Skill-кандидаты — через **approval queue**. Скоупы памяти: **global + workspace** (project `MEMORY.md` оставляем как есть, вне системы).

## 1. Хранилище

```
~/.craft-agent/memory/            # GLOBAL scope
  lessons.jsonl                   # append-only
  preferences.md                  # rollup пользовательских предпочтений (не заменяет preferences.json; JSON остаётся источником правды для структурных prefs, md — для свободного текста)
{workspace}/memory/               # WORKSPACE scope
  lessons.jsonl
  context.md                      # активный контекст проекта/работы
  history/YYYY-MM-DD.md           # дневные саммари сессий
{workspace}/skills/.pending/<slug>/   # очередь skill-кандидатов
  SKILL.md
  .meta.json
```

Lesson-схема (JSONL, одна строка = урок):

```json
{
  "ts": "2026-08-06T12:00:00Z",
  "rule": "всегда прогоняй frontend checks перед тем как называть изменение готовым",
  "category": "preference | workflow | knowledge | correction",
  "scope": "global | workspace",
  "negative": false,
  "source": { "sessionId": "…", "trigger": "explicit | branch | interrupted | error | distillation" }
}
```

Ограничения (как у KiroCrew `learn.py`): лимит 200 уроков на store (прун старейших), максимум 50 попадает в контекст, дедуп по `rule.toLowerCase()`, `mtime`-кэш чтения. Dot-директория `.pending` исключается из skills-discovery (кандидат не триггерится до approve).

## 2. Capture (packages/server-core, новый MemoryService)

`packages/server-core/src/memory/MemoryService.ts` — in-process сервис, живёт рядом с SessionManager.

Сигналы:

1. `SessionManager.onSessionComplete` (`SessionManager.ts:6696`, событие `SessionCompletionEvent{reason: complete|interrupted|error|timeout, finalText, tokenUsage}`) — подписываемся **вторым listener'ом** рядом с `TaskRunner.onSessionComplete` (`tasks/TaskRunner.ts:420`). `interrupted | error | timeout` = сигнал «пошло не так».
2. Пользовательская коррекция: путь `branchFromMessageId` (ветка по редактированию сообщения, ChatDisplay со стороны UI; серверная валидация в SessionManager ~2800–3100). Эмитим внутреннее событие `memory.correctionObserved{sessionId, messageId}`.
3. Explicit: чат-команда/инструмент «запомни …» (см. п.4 — пишется напрямую в lessons.jsonl без LLM).

Триггеры дистилляции:

- **Message-count**: каждые 30 новых сообщений в сессии → лёгкая дистилляция (memory/preferences только, без skill-detection).
- **Idle**: 60-секундный in-process тик в MemoryService проверяет сессии, неактивные ≥3ч → полная дистилляция (history + lessons + skill-кандидат). Тик — `setInterval` в server-core, **без cron**.
- Завершение сессии (`reason=complete`) → полная дистилляция (в очередь, чтобы не блокировать следующий turn).

## 3. Distillation (через OMP-агента)

Один промпт на окно транскрипта. Транскрипт читаем из `{workspace}/sessions/{sessionId}/session.jsonl` (`shared/src/sessions/jsonl.ts` — resilient parser, формат стабильный: header + StoredMessage/строка).

Строитель окна: переиспользуем `buildTransferredSessionContext` из `packages/shared/src/agent/conversation-summary.ts`.

Промпт требует строгий JSON:

```json
{
  "history_entry": "…",            // саммари дня, для memory/history/YYYY-MM-DD.md
  "memory_update": "…",            // дельта для context.md / preferences.md (null если пусто)
  "lessons": [ { "rule": "…", "category": "…", "negative": false } ],
  "skill_candidate": null | { "slug": "…", "description": "…", "body": "…" }
}
```

Пайплайн: MemoryService → spawned one-shot OMP RPC-сессия (отдельный лёгкий промпт, `--no-session`-эквивалент) → parse JSON (на невалидном JSON один retry с уточняющим промптом, потом дроп + лог) → запись в файлы п.1 → broadcast `memory.CHANGED` клиентам.

Конфиг (`~/.craft-agent/config.json`): `memory.enabled` (def true), `memory.distillIdleHours` (def 3), `memory.distillMsgCount` (def 30).

## 4. Инъекция в system prompt

`packages/shared/src/prompts/system.ts`: добавляем `formatLessonsForPrompt(scope)` и `formatWorkspaceMemoryForPrompt()`:

```
[Learned corrections — user-taught rules. ALWAYS follow these. They override default behavior.]
- <rule 1>
- …
[Workspace memory]
<context.md / preferences.md / recent history summary>
```

Точки подключения (все три провайдера):

- `claude-agent.ts:716 resolveProjectContext`
- `pi-agent.ts:219 resolveProjectContext`
- `omp-agent.ts` — **исправить существующую дырку**: project memory/preferences там сейчас не инжектятся; добавляем тот же блок.

Сборка блока: global lessons + workspace lessons (workspace приоритетнее при конфликте — order в тексте), затем memory, обрезка до 50 уроков.

## 5. Self-evolving: skill approval queue

Дистилляция возвращает `skill_candidate` при повторяющемся паттерне. Гейты:

- config `skills.autoCreateFromSessions` (def false — opt-in);
- порог: ≥5 tool-calls схожей формы в окне (эвристика в промпте, не коде);
- sensitive paths исключены (`.ssh`, `*.key`, credentials — фильтр по списку до отправки транскрипта в distillation).

Файловый флоу (по мотивам `kiro_crew/skills.py`):

1. Кандидат пишется в `{workspace}/skills/.pending/<slug>/{SKILL.md,.meta.json}` (meta: источник, ts, tool-call stats).
2. Новый RPC-namespace `skills.pending`: `list | approve | dismiss`; broadcast `skills.PENDING_CHANGED` (по образцу `skills.CHANGED`, регистрация в `packages/server-core/src/handlers/rpc/index.ts`, каналы в `packages/shared/src/protocol/{channels,events}.ts`).
3. Approve: snapshot `…/<slug>/.versions/v1-SKILL.md` → атомарный move `.pending/<slug>` → `skills/<slug>/` (rename внутри одного FS; при сбое restore из snapshot) → ConfigWatcher видит change → `skills.CHANGED` → скилл активен.
4. Dismiss: удаление `.pending/<slug>` + запись в meta-лог (чтобы не предлагать тот же slug повторно; дедуп по `slug + normalized description`).
5. TTL: кандидаты старше 30 дней прунятся.

UI: бейдж + секция «Pending» в `apps/electron/src/renderer/components/app-shell/SkillsListPanel.tsx` и страница просмотра кандидата (diff-просмотр SKILL.md, кнопки Approve/Dismiss). Webui шарит transport — бесплатно.

## 6. UI памяти

Новая вкладка Memory рядом со Skills (`SkillsListPanel` — сосед): список уроков global/workspace (edit/delete → прямая правка JSONL с перезаписью файла), context.md view/edit, история по дням. Чтение/запись через RPC `memory.*` (`memory.CHANGED` broadcast). Sensitive-redaction на уровне записи (distill-промпт + регекс-фильтр на токены/секреты перед записью урока).

## 7. Тесты

Unit (vitest/bun test, по соседней конвенции server-core):

- LessonStore: дедуп case-insensitive, лимиты 200/50, negative-флаг, mtime-кэш.
- MemoryService: эмит SessionCompletionEvent (mock) → запись сигнала; 30-msg триггер; idle-логика по подменённому clock.
- Distillation: parse JSON (валидный/битый/retry), redaction фильтр.
- Skill queue: approve → move + v1 snapshot; dismiss → анти-повтор; `.pending` не виден discovery.
- Injection: snapshot-тест system prompt с уроками/памятью для одного провайдера + grep-проверка, что блок дошёл до всех трёх агентов.

## 8. Что НЕ входит (YAGNI)

- Векторная память / embeddings (KiroCrew vector_memory.py) — keyword + recency decay достаточно на v1.
- Версии v2+ скиллов (только v1 snapshot).
- Heartbeat-задачи из HEARTBEAT.md — отдельная фича (cron уже есть в craft, не трогаем).
- Incognito/Temporary режимы сессий — v2.
- Project-scope (`MEMORY.md`) не интегрируем — остаётся агент-managed.

## Риски

- Секции 4–5 трогают три агента и RPC-протокол — изменения протокола additive-only (новые каналы), обратная совместимость сохраняется.
- Idle-distillation на больших транскриптах — окно ограничиваем последними N токенов (порог подобрать в плане, старт 40k).
- Двойная запись preferences (json + md) — md генерируется только дистилляцией, json — ручным редактированием; конфликты решает json (структурные prefs приоритетнее).
