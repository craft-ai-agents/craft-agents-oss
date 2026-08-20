import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CRAFT_AUTOMATION_SEED_VERSION,
  buildDefaultAutomationSeeds,
  ensureDefaultAutomations,
} from './default-seeds.ts';
import { AUTOMATIONS_CONFIG_FILE } from './constants.ts';
import { validateAutomationsConfig } from './validation.ts';

describe('default automation seeds', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'craft-auto-seeds-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('builds 30 matchers across scheduled/event/agentic buckets', () => {
    const seeds = buildDefaultAutomationSeeds();
    expect(seeds.version).toBe(2);
    expect(seeds.craftSeedVersion).toBe(CRAFT_AUTOMATION_SEED_VERSION);

    let total = 0;
    let scheduled = 0;
    let agentic = 0;
    for (const [event, list] of Object.entries(seeds.automations ?? {})) {
      total += list.length;
      if (event === 'SchedulerTick') scheduled += list.length;
      if (
        [
          'PreToolUse',
          'PostToolUse',
          'PostToolUseFailure',
          'Stop',
          'SessionStart',
          'SessionEnd',
          'UserPromptSubmit',
          'SubagentStop',
          'PreCompact',
        ].includes(event)
      ) {
        agentic += list.length;
      }
    }
    expect(total).toBe(30);
    expect(scheduled).toBe(10);
    expect(agentic).toBe(10);
    // remaining 10 are app events
    expect(total - scheduled - agentic).toBe(10);

    const enabled = Object.values(seeds.automations ?? {})
      .flat()
      .filter((m) => m.enabled === true);
    // a few safe demos on, most off
    expect(enabled.length).toBeGreaterThanOrEqual(2);
    expect(enabled.length).toBeLessThanOrEqual(5);

    const validation = validateAutomationsConfig(seeds);
    expect(validation.valid).toBe(true);
  });

  it('seeds missing automations.json on ensure', () => {
    const result = ensureDefaultAutomations(dir);
    expect(result.seeded).toBe(true);
    expect(result.matcherCount).toBe(30);
    expect(existsSync(join(dir, AUTOMATIONS_CONFIG_FILE))).toBe(true);
    const parsed = JSON.parse(readFileSync(join(dir, AUTOMATIONS_CONFIG_FILE), 'utf-8'));
    expect(parsed.craftSeedVersion).toBe(1);
  });

  it('does not clobber user matchers', () => {
    writeFileSync(
      join(dir, AUTOMATIONS_CONFIG_FILE),
      JSON.stringify({
        version: 2,
        automations: {
          LabelAdd: [{ name: 'mine', matcher: 'x', actions: [{ type: 'prompt', prompt: 'hi' }] }],
        },
      }),
      'utf-8',
    );
    const result = ensureDefaultAutomations(dir);
    expect(result.seeded).toBe(false);
    expect(result.reason).toBe('already-present');
    const parsed = JSON.parse(readFileSync(join(dir, AUTOMATIONS_CONFIG_FILE), 'utf-8'));
    expect(parsed.automations.LabelAdd).toHaveLength(1);
    expect(parsed.automations.LabelAdd[0].name).toBe('mine');
  });

  it('preserves intentional user wipe after seed version present', () => {
    writeFileSync(
      join(dir, AUTOMATIONS_CONFIG_FILE),
      JSON.stringify({ version: 2, craftSeedVersion: 1, automations: {} }),
      'utf-8',
    );
    const result = ensureDefaultAutomations(dir);
    expect(result.seeded).toBe(false);
    expect(result.reason).toBe('user-empty-preserved');
  });

  it('migrates empty legacy file without craftSeedVersion', () => {
    writeFileSync(
      join(dir, AUTOMATIONS_CONFIG_FILE),
      JSON.stringify({ version: 2, automations: {} }),
      'utf-8',
    );
    const result = ensureDefaultAutomations(dir);
    expect(result.seeded).toBe(true);
    expect(result.matcherCount).toBe(30);
  });
});
