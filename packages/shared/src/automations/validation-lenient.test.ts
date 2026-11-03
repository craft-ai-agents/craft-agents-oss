/**
 * Tests for loadAutomationsConfigLenient — the runtime / Automations-screen load
 * that skips invalid matchers instead of rejecting the whole file.
 */

import { describe, it, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { loadAutomationsConfigLenient, validateAutomationsConfig } from './validation.ts';

describe('loadAutomationsConfigLenient', () => {
  let warn: ReturnType<typeof spyOn>;
  beforeEach(() => { warn = spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warn.mockRestore(); });

  it('loads a valid file with no issues, matching the strict validator', () => {
    const raw = {
      version: 2,
      automations: {
        LabelAdd: [{ id: 'a1', matcher: '^urgent$', actions: [{ type: 'prompt', prompt: 'look' }] }],
        SchedulerTick: [{ cron: '0 9 * * 1-5', timezone: 'Europe/Budapest', actions: [{ type: 'script', script: 'scripts/x.ts' }] }],
      },
    };
    const { config, issues } = loadAutomationsConfigLenient(raw);
    expect(issues).toEqual([]);
    expect(config.automations).toEqual(validateAutomationsConfig(raw).config!.automations);
  });

  it('skips only the matcher with the removed command action, and says what to use instead', () => {
    const { config, issues } = loadAutomationsConfigLenient({
      automations: {
        LabelAdd: [
          { id: 'old', name: 'Legacy log', actions: [{ type: 'command', command: 'echo hi' }] },
          { id: 'ok', actions: [{ type: 'prompt', prompt: 'fine' }] },
        ],
      },
    });
    expect(config.automations.LabelAdd?.map(m => m.id)).toEqual(['ok']);
    expect(issues).toEqual([{
      event: 'LabelAdd',
      index: 0,
      id: 'old',
      name: 'Legacy log',
      messages: ['Action 1 uses the removed "command" type; use a "script" action instead'],
    }]);
  });

  it('names an unknown action type instead of zod\'s "Invalid input"', () => {
    const { issues } = loadAutomationsConfigLenient({
      automations: { LabelAdd: [{ actions: [{ type: 'prompt', prompt: 'a' }, { type: 'email', to: 'x' }] }] },
    });
    expect(issues[0]?.messages).toEqual(['Action 2 has an unknown type "email"; use "prompt", "webhook" or "script"']);
  });

  it('skips matchers that fail semantic checks (bad cron, bad regex)', () => {
    const { config, issues } = loadAutomationsConfigLenient({
      automations: {
        SchedulerTick: [
          { cron: 'not a cron', actions: [{ type: 'prompt', prompt: 'x' }] },
          { cron: '*/15 * * * *', actions: [{ type: 'prompt', prompt: 'y' }] },
        ],
        LabelAdd: [{ matcher: '([a-z]+)+', actions: [{ type: 'prompt', prompt: 'z' }] }],
      },
    });
    expect(config.automations.SchedulerTick).toHaveLength(1);
    expect(config.automations.LabelAdd).toBeUndefined();
    expect(issues.map(i => `${i.event}[${i.index}]`)).toEqual(['SchedulerTick[0]', 'LabelAdd[0]']);
    expect(issues[0]?.messages[0]).toContain('Invalid cron expression');
    expect(issues[1]?.messages[0]).toContain('catastrophic backtracking');
  });

  it('reports matchers under an unknown event and does not load them', () => {
    const { config, issues } = loadAutomationsConfigLenient({
      automations: { LabelAddd: [{ actions: [{ type: 'prompt', prompt: 'typo' }] }] },
    });
    expect(config.automations).toEqual({});
    expect(issues).toEqual([{ event: 'LabelAddd', index: 0, messages: ['Unknown event "LabelAddd"'] }]);
  });

  it('merges a deprecated alias into its canonical event but reports the RAW event and index', () => {
    const { config, issues } = loadAutomationsConfigLenient({
      automations: {
        SessionStatusChange: [{ actions: [{ type: 'prompt', prompt: 'new' }] }],
        TodoStateChange: [
          { actions: [{ type: 'prompt', prompt: 'old name' }] },
          { actions: [] },
        ],
      },
    });
    expect(config.automations.SessionStatusChange?.map(m => (m.actions[0] as { prompt: string }).prompt)).toEqual(['new', 'old name']);
    expect(issues).toEqual([{ event: 'TodoStateChange', index: 1, messages: ['actions: At least one action required'] }]);
  });

  it('loads agent-event matchers (they are valid) but reports that they never run', () => {
    const { config, issues } = loadAutomationsConfigLenient({
      automations: { PreToolUse: [{ matcher: '^Bash$', actions: [{ type: 'prompt', prompt: 'x' }] }] },
    });
    expect(config.automations.PreToolUse).toHaveLength(1);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ event: 'PreToolUse', index: 0 });
    expect(issues[0]?.messages[0]).toContain('never run');
  });

  it('reports file-level and event-level shape problems without an index', () => {
    expect(loadAutomationsConfigLenient(['not', 'an', 'object']).issues).toEqual([
      { messages: ['automations.json must contain a JSON object'] },
    ]);
    expect(loadAutomationsConfigLenient({ automations: 'nope' }).issues[0]?.event).toBeUndefined();
    expect(loadAutomationsConfigLenient({ automations: { LabelAdd: { not: 'a list' } } }).issues).toEqual([
      { event: 'LabelAdd', messages: ['"LabelAdd" must be a list of automations'] },
    ]);
  });

  it('treats a file without "automations" as empty, not as a problem', () => {
    expect(loadAutomationsConfigLenient({ version: 2 })).toEqual({ config: { automations: {} }, issues: [] });
  });
});
