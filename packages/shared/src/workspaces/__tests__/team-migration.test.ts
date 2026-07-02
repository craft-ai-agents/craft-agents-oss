import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { loadWorkspaceConfig, saveWorkspaceConfig } from '../storage.ts';
import {
  assertWorkspaceOpenable,
  moveWorkspaceToSharedFolder,
  preflightSharedFolderMigration,
  TEAM_MIGRATIONS_DIR,
  writeMovedToTombstone,
} from '../team-migration.ts';
import type { WorkspaceConfig } from '../types.ts';

const tempDirs: string[] = [];

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeWorkspace(root: string, partial: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
  const config: WorkspaceConfig = {
    id: `ws_${Math.random().toString(36).slice(2)}`,
    name: 'Migrating Workspace',
    slug: 'migrating-workspace',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    defaults: {
      workingDirectory: root,
    },
    ...partial,
  };
  writeFileSync(join(root, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
  mkdirSync(join(root, 'context'), { recursive: true });
  writeFileSync(join(root, 'context', 'CONTEXT.md'), '# Context\n', 'utf-8');
  return config;
}

afterEach(() => {
  delete process.env.CRAFT_CONFIG_DIR;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('team shared-folder migration', () => {
  it('moves a workspace into a destination parent with team config, receipt, and portable config', () => {
    const source = makeDir('team-migrate-source-');
    const destinationParent = makeDir('team-migrate-dest-');
    const privateRoot = makeDir('team-migrate-private-');
    process.env.CRAFT_CONFIG_DIR = privateRoot;
    writeWorkspace(source);

    const result = moveWorkspaceToSharedFolder(source, destinationParent, {
      provider: 'generic-folder',
      providerLabel: 'Temp shared folder',
    });

    expect(result.finalRootPath).toBe(join(destinationParent, basename(source)));
    expect(existsSync(result.finalRootPath)).toBe(true);
    expect(existsSync(join(result.finalRootPath, 'config.json'))).toBe(true);
    expect(existsSync(join(result.finalRootPath, 'team', 'config.json'))).toBe(true);
    expect(existsSync(result.receiptPath)).toBe(true);
    expect(existsSync(join(result.finalRootPath, 'context', 'CONTEXT.md'))).toBe(true);

    const migrated = loadWorkspaceConfig(result.finalRootPath);
    expect(migrated?.storage?.mode).toBe('shared-folder');
    expect(migrated?.storage?.mode === 'shared-folder' ? migrated.storage.movedFrom : undefined).toBe(source);
    expect(migrated?.team?.enabled).toBe(true);
    expect(migrated?.defaults?.workingDirectory).toBe(source);

    const receipt = JSON.parse(readFileSync(result.receiptPath, 'utf-8'));
    expect(receipt.status).toBe('complete');
  });

  it('rolls back the temp migration folder when preflight fails on secret files', () => {
    const source = makeDir('team-migrate-secret-source-');
    const destinationParent = makeDir('team-migrate-secret-dest-');
    writeWorkspace(source);
    writeFileSync(join(source, '.env'), 'SECRET=value\n', 'utf-8');

    const preflight = preflightSharedFolderMigration(source, destinationParent);
    expect(preflight.ok).toBe(false);
    expect(preflight.blockedFiles).toEqual(['.env']);
    expect(() => moveWorkspaceToSharedFolder(source, destinationParent)).toThrow('Workspace contains files that should not be synced.');
    expect(existsSync(join(destinationParent, basename(source)))).toBe(false);
    expect(existsSync(join(source, 'config.json'))).toBe(true);
  });

  it('rejects destinations inside the source workspace', () => {
    const source = makeDir('team-migrate-nested-source-');
    writeWorkspace(source);
    const nestedDestinationParent = join(source, 'shared-parent');
    mkdirSync(nestedDestinationParent);

    const preflight = preflightSharedFolderMigration(source, nestedDestinationParent);

    expect(preflight.ok).toBe(false);
    expect(preflight.reason).toBe('Destination cannot be inside the workspace being moved.');
    expect(() => moveWorkspaceToSharedFolder(source, nestedDestinationParent)).toThrow('Destination cannot be inside the workspace being moved.');
    expect(existsSync(join(nestedDestinationParent, basename(source)))).toBe(false);
  });

  it('refuses migrating folders, config-less folders, in-progress receipts, and moved tombstones', () => {
    const parent = makeDir('team-open-guard-');
    const migrating = join(parent, '.craft-migrating-test');
    mkdirSync(migrating);
    expect(() => assertWorkspaceOpenable(migrating)).toThrow('still migrating');

    const configless = join(parent, 'configless-workspace');
    mkdirSync(configless);
    writeFileSync(join(configless, 'CONTEXT.md'), '# Partial\n', 'utf-8');
    expect(() => assertWorkspaceOpenable(configless)).toThrow('config.json is not available');

    const inProgress = join(parent, 'in-progress-workspace');
    mkdirSync(join(inProgress, TEAM_MIGRATIONS_DIR), { recursive: true });
    writeWorkspace(inProgress);
    writeFileSync(join(inProgress, TEAM_MIGRATIONS_DIR, 'mig_test.json'), JSON.stringify({
      version: 1,
      migrationId: 'mig_test',
      status: 'in-progress',
      sourceRootPath: '/old',
      destinationParentPath: parent,
      finalRootPath: inProgress,
      provider: 'generic-folder',
      startedAt: new Date().toISOString(),
    }, null, 2), 'utf-8');
    expect(() => assertWorkspaceOpenable(inProgress)).toThrow('migration is still in progress');

    const moved = join(parent, 'moved-workspace');
    mkdirSync(moved);
    const movedConfig = writeWorkspace(moved);
    writeMovedToTombstone(moved, join(parent, 'new-workspace'), 'mig_done');
    expect(() => assertWorkspaceOpenable(moved)).toThrow('Workspace moved to');
    expect(() => saveWorkspaceConfig(moved, { ...movedConfig, name: 'Old Workspace Write' })).toThrow('Workspace moved to');
  });
});
