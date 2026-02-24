import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveAutomationsConfigPath, migrateHooksToAutomations } from './resolve-config-path.ts';
import { AUTOMATIONS_CONFIG_FILE } from './constants.ts';

describe('resolve-config-path', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'resolve-automations-config-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('prefers automations.json when valid and non-empty', () => {
    writeFileSync(join(tempDir, AUTOMATIONS_CONFIG_FILE), JSON.stringify({
      version: 2,
      automations: { LabelAdd: [{ actions: [{ type: 'command', command: 'echo ok' }] }] },
    }));
    writeFileSync(join(tempDir, 'hooks.json'), JSON.stringify({
      hooks: { LabelAdd: [{ hooks: [{ type: 'command', command: 'echo legacy' }] }] },
    }));

    expect(resolveAutomationsConfigPath(tempDir)).toBe(join(tempDir, AUTOMATIONS_CONFIG_FILE));
  });

  it('falls back to hooks.json when both exist and automations.json is invalid', () => {
    writeFileSync(join(tempDir, AUTOMATIONS_CONFIG_FILE), '{ invalid json');
    writeFileSync(join(tempDir, 'hooks.json'), JSON.stringify({
      hooks: { LabelAdd: [{ hooks: [{ type: 'command', command: 'echo legacy' }] }] },
    }));

    expect(resolveAutomationsConfigPath(tempDir)).toBe(join(tempDir, 'hooks.json'));
  });

  it('keeps automations.json canonical when hooks.json does not exist', () => {
    writeFileSync(join(tempDir, AUTOMATIONS_CONFIG_FILE), '{ invalid json');
    expect(resolveAutomationsConfigPath(tempDir)).toBe(join(tempDir, AUTOMATIONS_CONFIG_FILE));
  });

  it('migrates hooks.json to automations.json and preserves matcher ids', () => {
    writeFileSync(join(tempDir, 'hooks.json'), JSON.stringify({
      version: 1,
      hooks: {
        LabelAdd: [
          { id: 'abc123', hooks: [{ type: 'command', command: 'echo 1' }] },
          { hooks: [{ type: 'command', command: 'echo 2' }] },
        ],
      },
    }));

    const migrated = migrateHooksToAutomations(tempDir);
    expect(migrated).toBe(true);

    const automationsPath = join(tempDir, AUTOMATIONS_CONFIG_FILE);
    const config = JSON.parse(readFileSync(automationsPath, 'utf-8'));
    const first = config.automations.LabelAdd[0];
    const second = config.automations.LabelAdd[1];

    expect(first.id).toBe('abc123');
    expect(typeof second.id).toBe('string');
    expect(second.id.length).toBe(6);
    expect(existsSync(join(tempDir, 'hooks.json'))).toBe(false);
    expect(
      readdirSync(tempDir).some((name) => name === 'hooks.json.old' || name.startsWith('hooks.json.old.'))
    ).toBe(true);
  });

  it('re-migrates from hooks.json when automations.json is empty and both files exist', () => {
    writeFileSync(join(tempDir, AUTOMATIONS_CONFIG_FILE), JSON.stringify({ version: 2, automations: {} }));
    writeFileSync(join(tempDir, 'hooks.json'), JSON.stringify({
      hooks: {
        LabelAdd: [{ hooks: [{ type: 'command', command: 'echo from hooks' }] }],
      },
    }));

    const migrated = migrateHooksToAutomations(tempDir);
    expect(migrated).toBe(true);

    const config = JSON.parse(readFileSync(join(tempDir, AUTOMATIONS_CONFIG_FILE), 'utf-8'));
    expect(config.automations.LabelAdd).toHaveLength(1);
    expect(existsSync(join(tempDir, 'hooks.json'))).toBe(false);
  });

  it('uses timestamped backup name if hooks.json.old already exists', () => {
    writeFileSync(join(tempDir, 'hooks.json.old'), 'previous backup');
    writeFileSync(join(tempDir, 'hooks.json'), JSON.stringify({
      hooks: {
        LabelAdd: [{ hooks: [{ type: 'command', command: 'echo hi' }] }],
      },
    }));

    const migrated = migrateHooksToAutomations(tempDir);
    expect(migrated).toBe(true);

    const backups = readdirSync(tempDir).filter((name) => name.startsWith('hooks.json.old'));
    expect(backups.length).toBeGreaterThanOrEqual(2);
  });
});
