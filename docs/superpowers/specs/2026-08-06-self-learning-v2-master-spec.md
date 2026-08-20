# Self-learning v2 — мастер-спека (20 фич, 5 направлений)

Дата: 2026-08-06. Статус: approved scope («всё берём»).
База: спека v1 `2026-08-06-self-learning-memory-design.md` (реализована, HEAD c8c76eaf6).

## Декомпозиция

Зависимость: схема урока v2 (метаданные) и audit-log нужны почти всем → фаза W1 foundation.
W2 (качество обучения), W3 (масштаб памяти + приватность), W4 (жизненный цикл скиллов + UX) идут после W1.

## W1 — Foundation

### F1. Lesson schema v2 (обратно-совместимое расширение JSONL)
Добавляемые поля (все optional, старые файлы читаются без миграции):
- `usageCount: number` — сколько раз урок был включён в собранный промпт
- `lastUsedAt: string` (ISO)
- `conflicts: Array<{sessionId: string, ts: string, reason: 'branch'|'interrupted'|'error'}>` — нарушения урока (feedback loop)
- `promoted?: {fromScope: 'workspace', workspaceIds: string[], ts: string}` — метка повышения до global
- `generated?: boolean` — написан дистилляцией (vs explicit/branch)
`LessonStore` инкрементирует/обновляет через atomic rewrite. API: `touchUsed(rules: string[])`, `recordConflict(rule, evt)`.

### F2. Audit log
`{scope}/memory/audit.jsonl`, запись: `{ts, actor: 'ui'|'distill'|'rpc'|'queue', action: 'add'|'update'|'delete'|'promote'|'conflict'|'approved'|'dismissed', target: string, detail?: string}`. Пишут: LessonStore (mutation methods), MemoryService.applyResult, SkillPendingQueue (approve/dismiss), rpc/memory.ts. Перезапись не делаем — только append, лимит 10k строк (ротация хвостом).

### F3. Session memory modes (4.1)
`Session.memoryMode?: 'persistent'|'incognito'|'temporary'` (default persistent):
- persistent — текущее поведение (чтение+запись)
- incognito — промпт-блоки читаются; LessonStore/MemoryService записи ПРОПУСКАЮТСЯ (completion/distill/branch triggers no-op; explicit add через RPC пишет)
- temporary — промпт-блоки не инжектятся, ничего не пишется
Проводка: `SessionManager.createBackendFromResolvedContext` (memoryBlocks skip когда temporary), MemoryService (skip по mode), SessionCompletionEvent не меняется. UI: переключатель в шапке сессии (иконка глаза; три состояния), сохраняется в session metadata. RPC: `sessions.setMemoryMode` (additive) + поле в sessions.get.

### F4. Provenance backbone (для 5.2/5.3)
`buildMemoryBlocks()` возвращает `{ lessonsBlock, memoryBlock, used: Array<{rule, scope}>, usedSkills: string[] }` (usedSkills — из skills конфига сессии). SessionManager сохраняет per-turn provenance в `sessions/{id}/meta/provenance.json` (последний тёрн). RPC `sessions.getProvenance(sessionId)` → `{lessons: [...], skills: [...]}`.

## W2 — Learning quality

### L1. Feedback loop (1.1)
MemoryService: при branch/interrupted/error completion — сопоставить текст уроков, активных в этой сессии (provenance), эвристикой нарушения: если ответ агента содержит действие, запрещённое negative-правилом (простое подстрочное совпадение ключевых слов правила) или юзер прервал turn где урок был применён → `recordConflict`. UI Memory tab: колонка «конфликты N» + сортировка.

### L2. Conflict detection при добавлении (1.2)
При addLesson (RPC): новый урок vs существующие — быстрый LLM-чек (тот же one-shot mini): `{conflicts: [{existingRule, relation: 'contradicts'|'subsumes'|'none'}]}`. Ответ `conflicts` возвращается клиенту; UI показывает inline-предупреждение с кнопками «заменить» / «оставить оба». Fallback при недоступном LLM — пропуск (не блокировать запись).

### L3. Global promotion (1.3)
Один и тот же нормализованный rule в ≥2 воркспейсах (scan всех workspace stores) → в Memory tab баннер «кандидат на глобальный урок» с кнопкой Promote → копия в global store с `promoted{fromScope, workspaceIds}`. RPC: `memory.PROMOTION_CANDIDATES` (list), promote повторяет ADD_LESSON-scope global + маркировка.

### L4. Source links (1.4)
У урока есть `source.sessionId`. UI: иконка-ссылка → навигация `routes.view.session(sessionId)` (если сессия существует; иначе disabled с tooltip «сессия удалена»).

### L5. Negative-first формулировки (1.5)
Config `memory.negativeFirst` (default true). Дистилляция: промпт просит по возможности формулировать уроки как negative (запрет), UI показывает их отдельным тоном. A/B-механика: флаг сравнивается по `conflicts`-статистике из L1 (дата-анализ в будущем, сейчас только сбор).

## W3 — Memory scale + privacy

### M1. FTS-поиск (2.1)
SQLite FTS5 (bun:sqlite) `{scope}/memory/index.db`: таблицы lessons, history (daily files), context. Индексирование ленивое при записи (hooks в LessonStore/MemoryFileStore) + rebuild command. `memory.getContext(scope, query?)` с query → ranked подмножество (top-K, K в config, default 20) вместо «last 50». Injection-путь: buildMemoryBlocks принимает optional query = последние 2 юзер-сообщения сессии → релевантные подмножества в промпт. Важно: при error fallback на текущее поведение (recency).

### M2. Semantic (episodic) память (2.2)
Векторный слой: embeddings через существующий one-shot мини-LLM? Нет — embedding-энпоинт: rox-kimi не даёт эмбеддингов; использовать локальный модель через node feature-extractors? Внешняя зависимость запрещена правилом «без новых runtime deps» в v1 — здесь ослабляем: `@xenova/transformers` (pure JS, ~50MB мод spared) с lazy-download в `{configDir}/models/`, fallback keyword если модель недоступна. Episodic store: success/failure сессий (summary из history) с векторным top-3 в промпте когда topical overlap > 0.78. Гейт config `memory.semantic` (default false — opt-in; скачивание модели при включении).

### M3. Decay/compaction (2.3)
Daily-history старше 14д → недельная свёртка (LLM one-shot) в `history/weekly-YYYY-Wnn.md`; старше 60д → `history/monthly-YYYY-MM.md`; старше 365д → удаление. Фон-worker в MemoryService idle tick (раз в 24ч). `loadWorkspaceMemory` читает: last-7 daily + last-4 weekly + monthly summary.

### M4. Import/export (2.5)
`memory.EXPORT` → `{lessons, context, preferences, history[]}` JSON-bundle (по образцу sessions EXPORT); `memory.IMPORT(bundle, {mode: 'merge'|'replace'})` с дедупом. UI: кнопки в табе Memory.

### M5. Project-scope unification (2.4)
Project `MEMORY.md` интегрируется как третий скоуп чтения: `buildMemoryBlocks` включает project memory (когда сессия привязана к проекту) в свой блок; записи НЕ мигрируются (agent-managed остаётся), но UI таб Memory показывает project section read-only + ссылку на проект.

### P1. Redaction v2 (4.2)
Паттерны redactSecrets выносим в конфиг: `memory.redactExtraPatterns: string[]` (названия проектов, пути и т.д.) + встроенные дефолты. При записи урока через UI — предупреждение, если regex матчит, с кнопкой «замаскировать».

### P2. Per-workspace disable (4.4)
`{workspace}/config.json`: `memory.enabled` перебивает глобальное. Читается в `memoryServiceFor` через loadWorkspaceConfig.

## W4 — Skill lifecycle + UX

### S1. Review page + risk-флаги (3.1)
Страница кандидата (из pending-секции): полный просмотр SKILL.md + auto risk-флаги: сетевые вызовы (curl/fetch/http), filesystem за пределами cwd (rm, пути в $HOME), секретные слова, sudo. Флаги считаются регексами на клиенте (без LLM). Дедуп-близость: клиентский сравнение по словам с именами существующих скиллов (показ «похож на X»).

### S2. Script validation (3.2)
Если кандидат содержит fenced code блоки с bash/sh: статический разбор — запрещённые токены (sudo, rm -rf /, curl|wget с pipe в sh, eval) → кнопка Approve disabled + причина. На сервере при approve тоже проверка (defense-in-depth, RPC возвращает ошибку если скрипт не прошёл, strict=true).

### S3. Skill versioning (3.3)
`SkillPendingQueue.enqueue` когда slug совпадает с существующим скиллом: НЕ пропускать, а создавать кандидат как «обновление v2» (meta: `updates: existingSlug`). Approve: snapshot текущего в `.versions/v{N}-SKILL.md` (N+1), апсертить содержимое. UI показывает diff v1↔v2 (строковый diff, простой LCS или side-by-side pre). RPC `skills.pending.DIFF`.

### S4. Usage metrics (3.4)
Provenance (F4) считает per-skill попадания в промпт; коррекция в течение тёрна после использования — «неудачное применение». Метрики в skills/.usage.jsonl (append). UI: sortable колонка в Skills panel («used N×, conflicts K»); кнопка «Prune unused» (список кандидатов 0-usage за 30д → bulk dismiss в pending? нет — bulk delete активных с подтверждением).

### T1. Team export (3.5)
Кнопка на approved скилле: копировать в `{projectRoot}/.agents/skills/<slug>` (project scope уже поддерживается loader'ом) → git commit опционально. RPC `skills.exportToProject`.

### Y1. Dashboard insights (5.1)
Панель (новый раздел в Memory tab или отдельная карточка): за 7 дней — добавлено уроков, конфликтов, pending-кандидатов, approved; файлы читаются из audit.jsonl. RPC `memory.INSIGHTS`.

### Y2. Provenance strip в чате (5.2)
Под сообщением ассистента строка «Учтено: 2 урока, 1 скилл» (клик → popover со списком). Данные из F4 (`sessions.getProvenance`).

### Y3. Composer-chip «урок применён» (5.3)
Когда финальный текст ассистента verbatim содержит фрагменты правила (substring>6 слов), chip «Из урока: <rule>» под сообщением со ссылкой в таб. Реализация: клиентская проверка по provenance + rule text.

### Y4. Onboarding seed (5.4)
При первом запуске с memory.enabled: мастер из 3 карточек (безопасные дефолтные уроки: «запускай тесты перед done», «не пиши секреты в код», «коммить на английском»?) — user выбирает → пишет в global. Показ один раз (флаг в config `memory.onboarded`).

## Нефункциональные требования
- Обратная совместимость: v1-lessons.jsonl читается без миграции (данные мигрируют лениво при первой перезаписи: jsonl рядом появляется schema:2 header? — НЕТ, поля optional, схема-свидетель не нужен)
- Все новые RPC additive; новые файлы не ломают v1-ридеры
- Semantic (M2) и FTS (M1) независимы: FTS обязателен для v2 шипа, M2 за feature-флагом
- Тесты на каждый модуль (bun test), live e2e для W1-фундамента и ключевых интеракций W4

## Открытые вопросы (решены в плане)
- M2 зависимость `@xenova/transformers` — новая runtime-dep: разрешена scope-явлением этой спеки; lazy, не обязательна для базы.
- Y1 dashboard как карточка в Memory tab (не отдельная страница).
- L5 A/B — только сбор метрик в v2, анализ v3.
