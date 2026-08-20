# Implementation plan: Self-learning + Self-evolving (craft-agents)

Spec: `docs/superpowers/specs/2026-08-06-self-learning-memory-design.md` (approved 2026-08-06).

## Contract (wave 0, делаю вручную до фан-аута)

Новый файл `packages/shared/src/memory/types.ts`:

```ts
export type LessonCategory = "preference" | "workflow" | "knowledge" | "correction";
export type LessonScope = "global" | "workspace";
export type LessonTrigger = "explicit" | "branch" | "interrupted" | "error" | "distillation";

export interface Lesson {
  ts: string;                 // ISO
  rule: string;
  category: LessonCategory;
  scope: LessonScope;
  negative?: boolean;
  source: { sessionId?: string; trigger: LessonTrigger };
}

export interface MemoryConfig {
  enabled: boolean;                    // def true
  distillIdleHours: number;            // def 3
  distillMsgCount: number;             // def 30
}

export interface SkillCandidate {
  slug: string;
  description: string;
  body: string;                        // SKILL.md body (без frontmatter)
  source: { sessionId?: string; ts: string; toolCallStats?: Record<string, number> };
}

export interface DistillResult {
  history_entry: string | null;
  memory_update: string | null;
  lessons: Array<{ rule: string; category: LessonCategory; negative?: boolean }>;
  skill_candidate: { slug: string; description: string; body: string } | null;
}
```

RPC-контракт (additive, packages/shared/src/protocol/):
- channels: `memory.LIST_LESSONS | ADD_LESSON | UPDATE_LESSON | DELETE_LESSON | GET_CONTEXT | UPDATE_CONTEXT | LIST_HISTORY`; `skills.pending.LIST | APPROVE | DISMISS`.
- events (BroadcastEventMap): `memory.CHANGED { scope: LessonScope | "both" }`, `skills.PENDING_CHANGED {}`.

Тестовая конвенция: `bun test` colocated `__tests__` / `*.test.ts` в server-core (по соседним файлам).

## Wave 1 (parallel)

### A. MemoryStore (server-core)
`packages/server-core/src/memory/`:
- `LessonStore.ts` — JSONL CRUD, case-insensitive дедуп, лимиты 200 total / 50 context, prune старейших, mtime-кэш, atomic rewrite (tmp+rename).
- `MemoryFileStore.ts` — read/write `memory/context.md`, `preferences.md`, `history/YYYY-MM-DD.md`; paths для global (`~/.craft-agent/memory/`) и workspace (`{workspace}/memory/`).
- Тесты: дедуп, лимиты, prune, negative, corrupt-line resilience, atomicity (no partial writes).

### B. Prompt injection (shared + 3 агента)
- `packages/shared/src/prompts/system.ts`: `formatLessonsForPrompt(lessons)`, `formatWorkspaceMemoryForPrompt({context, preferences, recentHistory})` — блоки по спеке п.4, workspace lessons после global (приоритет текстовым порядком).
- Подключить: `claude-agent.ts:resolveProjectContext`, `pi-agent.ts resolveProjectContext`, `omp-agent.ts` (там ещё и project memory/preferences впервые).
- Слой чтения: агент получает уже собранные строки через параметр (DI), чтобы unit-тесты не ходили в FS.
- Тесты: snapshot блока, обрезка до 50, порядок global→workspace, все три провайдера получают блок.

## Wave 2 (parallel, depends on = contract)

### C. RPC + broadcast
- `packages/shared/src/protocol/{channels,events,dto}.ts` additive.
- `packages/server-core/src/handlers/rpc/memory.ts`, `skills-pending.ts` (+ регистрация в `handlers/rpc/index.ts`).
- `skills-pending.ts`: list/approve/dismiss над `{workspace}/skills/.pending/`; approve = snapshot `.versions/v1-SKILL.md` + atomic move + restore on failure; dismiss = удаление + `.dismissed.jsonl` (анти-повтор по slug+normalized description); TTL prune 30d.
- Тесты: approve flow, dismiss анти-повтор, .pending не виден в skills discovery (storage.ts loadAllSkills — проверить и при необходимости добавить dot-filter).

### D. MemoryService + Distillation
- `packages/server-core/src/memory/MemoryService.ts`:
  - Подписка на `SessionManager.onSessionComplete` (второй listener рядом с TaskRunner).
  - События: correctionObserved (hook из branch-пути), message-count (30), idle (60s setInterval, clock injectable), session-complete → очередь.
  - Distillation: собрать окно транскрипта через `buildTransferredSessionContext`, секрет-фильтр (regex: token/secret/key patterns), вызов one-shot OMP RPC-сессии (изолированный промпт, не трогает пользовательскую сессию), parse JSON + 1 retry, retry fail → лог и дроп.
  - Запись результата через MemoryStore (A) + эмит `memory.CHANGED`; skill_candidate → в `.pending/` с гейтами (config `skills.autoCreateFromSessions` def false, sensitive-path exclusion).
  - Explicit path: RPC `memory.ADD_LESSON` пишет напрямую без distillation.
- Тесты: триггеры (mock события + injectable clock), parse/parse-retry, redaction, очередь не блокирует следующий turn; гейт autoCreateFromSessions=false → кандидат не пишется.

## Wave 3 (parallel, depends on C,D)

### E. UI (apps/electron renderer + webui общий transport)
- Секция Pending в `SkillsListPanel.tsx` (бейдж, страница кандидата: просмотр SKILL.md, Approve/Dismiss). Подписка на `skills.PENDING_CHANGED`.
- Вкладка Memory (уроки global/workspace: list/edit/delete; context.md view/edit; history по дням). Подписка на `memory.CHANGED`.
- Чат-команда «запомни …» → `memory.ADD_LESSON` (trigger: explicit).
- Русская локализация по соседней конвенции UI.

## Verification (финал, вручную)
- `bun tsc` по затронутым пакетам + `bun test` server-core/shared.
- Smoke: поднять server, создать сессию, explicit lesson → виден в system prompt следующей сессии; inject mock correction → lesson в workspace jsonl; approve pending skill → скилл в discovery.

## Зависимости
- A и B независимы. C и D зависят от contract (волна 0) и A. E зависит от C (RPC) и контракта событий.
