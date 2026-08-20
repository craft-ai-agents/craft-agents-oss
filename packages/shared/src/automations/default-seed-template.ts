import type { AutomationEvent, AutomationMatcher } from './types.ts';

export type AutomationSeedTemplate = Omit<AutomationMatcher, 'id'> & {
  event: AutomationEvent;
};

/**
 * The first built-in scheduler seed, kept separate from disk seeding so graph
 * projection can reuse the exact flow in renderer-safe code.
 */
export function buildDefaultSchedulerPromptSeed(): AutomationSeedTemplate {
  return {
    event: 'SchedulerTick',
    name: 'Утренний план дня',
    cron: '0 9 * * 1-5',
    timezone: 'Europe/Moscow',
    enabled: true,
    permissionMode: 'safe',
    labels: ['scheduled'],
    actions: [
      {
        type: 'prompt',
        prompt:
          'Составь краткий утренний план на сегодня: 3 приоритета, риски и что можно отложить. Опирайся на открытые сессии и заметки workspace.',
      },
    ],
  };
}
