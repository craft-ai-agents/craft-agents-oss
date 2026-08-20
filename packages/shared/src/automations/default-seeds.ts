/**
 * Default automation seeds for new / empty workspaces.
 *
 * craftSeedVersion gates re-seeding: we only write when the file is missing
 * or empty (no matchers). User wipes are not clobbered until the seed version
 * is intentionally bumped.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolveAutomationsConfigPath, generateShortId } from './resolve-config-path.ts';
import type { AutomationEvent, AutomationMatcher, AutomationsConfig } from './types.ts';
import { buildDefaultSchedulerPromptSeed } from './default-seed-template.ts';

/** Bump only when seed content must re-apply to empty workspaces. */
export const CRAFT_AUTOMATION_SEED_VERSION = 1 as const;

export type SeededAutomationsFile = AutomationsConfig & {
  version: 2;
  craftSeedVersion: typeof CRAFT_AUTOMATION_SEED_VERSION;
};

type SeedMatcher = Omit<AutomationMatcher, 'id' | 'actions'> & {
  id?: string;
  actions: AutomationMatcher['actions'];
};

function m(
  partial: SeedMatcher & { event: AutomationEvent },
): { event: AutomationEvent; matcher: AutomationMatcher } {
  const { event, ...rest } = partial;
  return {
    event,
    matcher: {
      id: rest.id ?? generateShortId(),
      enabled: rest.enabled ?? false,
      ...rest,
    },
  };
}

/**
 * 30 RU-first templates: 10 scheduled + 10 event + 10 agentic.
 * Mostly disabled; a few safe read-only demos stay on.
 */
export function buildDefaultAutomationSeeds(): SeededAutomationsFile {
  const seeds: Array<{ event: AutomationEvent; matcher: AutomationMatcher }> = [
    // ── 10 scheduled (SchedulerTick) ──────────────────────────────────────
    m(buildDefaultSchedulerPromptSeed()),
    m({
      event: 'SchedulerTick',
      name: 'Ежедневный standup-summary',
      cron: '0 10 * * 1-5',
      timezone: 'Europe/Moscow',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt:
            'Подготовь standup: что сделано вчера, что сегодня, блокеры. Коротко, списком.',
        },
      ],
    }),
    m({
      event: 'SchedulerTick',
      name: 'Еженедельный обзор',
      cron: '0 17 * * 5',
      timezone: 'Europe/Moscow',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt:
            'Сделай еженедельный обзор: ключевые сессии, закрытые задачи, открытые риски и фокус на следующую неделю.',
        },
      ],
    }),
    m({
      event: 'SchedulerTick',
      name: 'Полуденный check-in',
      cron: '0 13 * * 1-5',
      timezone: 'Europe/Moscow',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt: 'Короткий midday check-in: прогресс по плану утра, что сдвинуть.',
        },
      ],
    }),
    m({
      event: 'SchedulerTick',
      name: 'Вечерний разбор',
      cron: '0 19 * * 1-5',
      timezone: 'Europe/Moscow',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt:
            'Вечерний разбор дня: что закрыто, что переносится, уроки на завтра. Без воды.',
        },
      ],
    }),
    m({
      event: 'SchedulerTick',
      name: 'Понедельник: цели недели',
      cron: '30 9 * * 1',
      timezone: 'Europe/Moscow',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt: 'Сформулируй 3–5 целей на неделю и критерии успеха для каждой.',
        },
      ],
    }),
    m({
      event: 'SchedulerTick',
      name: 'Inbox zero напоминание',
      cron: '0 16 * * 1-5',
      timezone: 'Europe/Moscow',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt:
            'Проверь «зависшие» сессии в backlog/todo старше 3 дней и предложи архивировать, делегировать или закрыть.',
        },
      ],
    }),
    m({
      event: 'SchedulerTick',
      name: 'Субботний ретро',
      cron: '0 11 * * 6',
      timezone: 'Europe/Moscow',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt: 'Лёгкое ретро недели: keep / improve / try. 5–7 пунктов.',
        },
      ],
    }),
    m({
      event: 'SchedulerTick',
      name: 'Ночной дайджест открытого',
      cron: '0 22 * * *',
      timezone: 'Europe/Moscow',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt:
            'Короткий дайджест незакрытых задач и сессий needs-review. Только факты.',
        },
      ],
    }),
    m({
      event: 'SchedulerTick',
      name: 'Ежемесячный аудит workspace',
      cron: '0 10 1 * *',
      timezone: 'Europe/Moscow',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt:
            'Месячный аудит: устаревшие навыки, источники без auth, автоматизации, которые никогда не срабатывали. Рекомендации.',
        },
      ],
    }),

    // ── 10 event (app events) ─────────────────────────────────────────────
    m({
      event: 'SessionStatusChange',
      name: 'На needs-review: чеклист проверки',
      matcher: 'needs-review',
      enabled: true,
      permissionMode: 'safe',
      conditions: [
        { condition: 'state', field: 'sessionStatus', to: 'needs-review' },
      ],
      actions: [
        {
          type: 'prompt',
          prompt:
            'Сессия перешла в «Требует проверки». Составь короткий чеклист ревью (цель, риски, что проверить) и не меняй статус сам.',
        },
      ],
    }),
    m({
      event: 'SessionStatusChange',
      name: 'На done: предложение архива',
      matcher: 'done',
      enabled: false,
      permissionMode: 'safe',
      conditions: [{ condition: 'state', field: 'sessionStatus', to: 'done' }],
      actions: [
        {
          type: 'prompt',
          prompt:
            'Сессия завершена (done). Кратко резюмируй результат и спроси, архивировать ли её. Не архивируй без явного согласия.',
        },
      ],
    }),
    m({
      event: 'SessionStatusChange',
      name: 'На in-progress: фокус-заметка',
      matcher: 'in-progress',
      enabled: false,
      permissionMode: 'safe',
      conditions: [
        { condition: 'state', field: 'sessionStatus', to: 'in-progress' },
      ],
      actions: [
        {
          type: 'prompt',
          prompt:
            'Сессия во «В работе». Напомни цель/acceptance и следующий конкретный шаг (1–2 предложения).',
        },
      ],
    }),
    m({
      event: 'LabelAdd',
      name: 'Метка urgent: эскалация',
      matcher: 'urgent|срочно',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt:
            'На сессию повесили срочную метку. Оцени блокер и предложи минимальный план разблокировки на 30–60 минут.',
        },
      ],
    }),
    m({
      event: 'LabelAdd',
      name: 'Метка research: углубить тему',
      matcher: 'research|рисёрч',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt:
            'Добавлена research-метка. Сформулируй 5 уточняющих вопросов и план исследования без запуска внешних ранов.',
        },
      ],
    }),
    m({
      event: 'FlagChange',
      name: 'В избранное: закрепить контекст',
      matcher: 'true',
      enabled: false,
      permissionMode: 'safe',
      conditions: [{ condition: 'state', field: 'isFlagged', value: true }],
      actions: [
        {
          type: 'prompt',
          prompt:
            'Сессию добавили в избранное. Сохрани краткий «контекст карточки»: цель, статус, next step.',
        },
      ],
    }),
    m({
      event: 'PermissionModeChange',
      name: 'Смена режима прав: audit log',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt:
            'Режим разрешений изменился. Зафиксируй old→new и напомни риски allow-all, если он включён. Без действий с инструментами.',
        },
      ],
    }),
    m({
      event: 'SessionStatusChange',
      name: 'Cancelled: post-mortem lite',
      matcher: 'cancelled',
      enabled: false,
      permissionMode: 'safe',
      conditions: [{ condition: 'state', field: 'sessionStatus', to: 'cancelled' }],
      actions: [
        {
          type: 'prompt',
          prompt:
            'Сессия отменена. Одна фраза причины (если видна) + что переиспользовать в будущем.',
        },
      ],
    }),
    m({
      event: 'LabelRemove',
      name: 'Снята метка blocked',
      matcher: 'blocked|блок',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt:
            'Снята метка blocked. Предложи возобновить работу: один next action.',
        },
      ],
    }),
    m({
      event: 'CloudRunCompleted',
      name: 'Облачный ран готов: импорт-подсказка',
      enabled: true,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt:
            'Облачный ран завершён. Кратко опиши, как просмотреть бриф и импортировать артефакты в текущую сессию. Не импортируй сам.',
        },
      ],
    }),

    // ── 10 agentic (agent SDK hooks) ──────────────────────────────────────
    m({
      event: 'PostToolUse',
      name: 'После Edit/Write: self-check diff',
      matcher: '^(Edit|Write|MultiEdit)$',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt:
            'Только что был edit/write. Пройдись self-check: компилируется ли идея, нет ли явных TODO/секретов, соответствует ли цели сессии. Коротко.',
        },
      ],
    }),
    m({
      event: 'PostToolUse',
      name: 'После Bash: проверить exit hygiene',
      matcher: '^Bash$',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt:
            'После Bash: если команда упала — предложи минимальный фикс; если ок — не комментируй.',
        },
      ],
    }),
    m({
      event: 'PostToolUseFailure',
      name: 'Сбой инструмента: диагностика',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt:
            'Инструмент упал. Диагностируй причину по ошибке и предложи один безопасный retry-путь.',
        },
      ],
    }),
    m({
      event: 'Stop',
      name: 'Стоп агента: summary хода',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt:
            'Агент остановился. 3–5 буллетов: что сделано, что осталось, рекомендованный next step пользователю.',
        },
      ],
    }),
    m({
      event: 'SessionStart',
      name: 'Старт сессии: контекст-бриф',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt:
            'Новая/возобновлённая сессия. Если есть title/goal — подтверди понимание цели одним абзацем.',
        },
      ],
    }),
    m({
      event: 'SessionEnd',
      name: 'Конец сессии: handoff note',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt:
            'Сессия завершает работу. Handoff: состояние, открытые вопросы, файлы/пути к артефактам.',
        },
      ],
    }),
    m({
      event: 'PreToolUse',
      name: 'Перед опасным Bash: caution',
      matcher: '^Bash$',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt:
            'Перед Bash: если команда деструктивна (rm -rf, drop, force push) — явно предупреди. Иначе молчи.',
        },
      ],
    }),
    m({
      event: 'UserPromptSubmit',
      name: 'Длинный промпт: структура',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt:
            'Если пользовательский запрос > 800 символов и без структуры — предложи разбить на шаги перед исполнением.',
        },
      ],
    }),
    m({
      event: 'SubagentStop',
      name: 'Сабагент завершён: merge notes',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt:
            'Сабагент завершился. Выдели actionable findings для основной сессии, отбрось шум.',
        },
      ],
    }),
    m({
      event: 'PreCompact',
      name: 'Перед compact: pin critical',
      enabled: false,
      permissionMode: 'safe',
      actions: [
        {
          type: 'prompt',
          prompt:
            'Скоро compact. Перечисли 3–7 фактов, которые нельзя потерять (решения, пути, TODO).',
        },
      ],
    }),
  ];

  const automations: AutomationsConfig['automations'] = {};
  for (const { event, matcher } of seeds) {
    const list = automations[event] ?? [];
    list.push(matcher);
    automations[event] = list;
  }

  return {
    version: 2,
    craftSeedVersion: CRAFT_AUTOMATION_SEED_VERSION,
    automations,
  };
}

function countMatchers(config: { automations?: Record<string, unknown[]> } | null | undefined): number {
  if (!config?.automations || typeof config.automations !== 'object') return 0;
  let n = 0;
  for (const list of Object.values(config.automations)) {
    if (Array.isArray(list)) n += list.length;
  }
  return n;
}

export interface EnsureDefaultAutomationsResult {
  /** true when a seed file was written */
  seeded: boolean;
  /** absolute path to automations.json */
  path: string;
  /** matcher count after ensure */
  matcherCount: number;
  reason: 'created' | 'already-present' | 'user-empty-preserved' | 'invalid-preserved';
}

/**
 * Ensure workspace has default automations when missing or truly empty.
 *
 * Rules:
 * - Missing file → write seeds (craftSeedVersion: 1).
 * - Present with zero matchers AND no craftSeedVersion → write seeds (migrate empty).
 * - Present with zero matchers AND craftSeedVersion >= current → leave (user wiped).
 * - Present with matchers → leave untouched.
 */
export function ensureDefaultAutomations(workspaceRoot: string): EnsureDefaultAutomationsResult {
  const path = resolveAutomationsConfigPath(workspaceRoot);

  if (!existsSync(path)) {
    const seeded = buildDefaultAutomationSeeds();
    writeFileSync(path, `${JSON.stringify(seeded, null, 2)}\n`, 'utf-8');
    return {
      seeded: true,
      path,
      matcherCount: countMatchers(seeded),
      reason: 'created',
    };
  }

  type ParsedAutomationsFile = {
    automations?: Record<string, unknown[]>;
    craftSeedVersion?: number;
  };
  let parsed: ParsedAutomationsFile;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8')) as ParsedAutomationsFile;
  } catch {
    return { seeded: false, path, matcherCount: 0, reason: 'invalid-preserved' };
  }

  const matcherCount = countMatchers(parsed);
  if (matcherCount > 0) {
    return { seeded: false, path, matcherCount, reason: 'already-present' };
  }

  const existingSeed = typeof parsed.craftSeedVersion === 'number' ? parsed.craftSeedVersion : 0;
  if (existingSeed >= CRAFT_AUTOMATION_SEED_VERSION) {
    // User cleared automations after seeding — do not clobber.
    return { seeded: false, path, matcherCount: 0, reason: 'user-empty-preserved' };
  }

  // Empty legacy file without seed marker → migrate in seeds.
  const seeded = buildDefaultAutomationSeeds();
  writeFileSync(path, `${JSON.stringify(seeded, null, 2)}\n`, 'utf-8');
  return {
    seeded: true,
    path,
    matcherCount: countMatchers(seeded),
    reason: 'created',
  };
}
