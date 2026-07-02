import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWorkspaceConfig } from '../storage.ts';
import {
  getTeamModeStatus,
  markWorkspaceAsSharedFolder,
  setRunnerMachine,
  TEAM_CONFIG_FILE,
} from '../team-mode.ts';
import type { WorkspaceConfig } from '../types.ts';

const tempDirs: string[] = [];

function makeWorkspaceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'team-workspace-'));
  const privateRoot = mkdtempSync(join(tmpdir(), 'team-private-'));
  tempDirs.push(root, privateRoot);
  process.env.CRAFT_CONFIG_DIR = privateRoot;
  return root;
}

function writeWorkspace(root: string, partial: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
  const config: WorkspaceConfig = {
    id: `ws_${Math.random().toString(36).slice(2)}`,
    name: 'Team Workspace',
    slug: 'team-workspace',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...partial,
  };
  writeFileSync(join(root, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
  return config;
}

afterEach(() => {
  delete process.env.CRAFT_CONFIG_DIR;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('team mode metadata', () => {
  it('loads legacy workspaces with no storage field unchanged', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root);

    const loaded = loadWorkspaceConfig(root);
    expect(loaded).not.toBeNull();
    expect(loaded?.storage).toBeUndefined();
    expect(loaded?.team).toBeUndefined();
  });

  it('creates solo storage metadata and a generated team config mirror on status read', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root);

    const status = getTeamModeStatus(root);
    const saved = loadWorkspaceConfig(root);

    expect(status.storage.mode).toBe('solo');
    expect(status.team.enabled).toBe(false);
    expect(saved?.storage?.mode).toBe('solo');
    expect(existsSync(join(root, TEAM_CONFIG_FILE))).toBe(true);
  });

  it('enabling team mode writes shared-folder storage, team config, and machine heartbeat', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root);

    const status = markWorkspaceAsSharedFolder(root, {
      provider: 'generic-folder',
      providerLabel: 'Current folder',
    });
    const mirror = JSON.parse(readFileSync(join(root, TEAM_CONFIG_FILE), 'utf-8'));

    expect(status.storage.mode).toBe('shared-folder');
    expect(status.team.enabled).toBe(true);
    expect(status.team.revision).toBe(1);
    expect(mirror.team.enabled).toBe(true);
    expect(existsSync(status.privateMachinePath)).toBe(true);
    expect(existsSync(status.heartbeatPath)).toBe(true);
  });

  it('joining an existing team workspace creates private identity and heartbeat files', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root, {
      storage: {
        mode: 'shared-folder',
        portabilityVersion: 1,
        provider: 'google-drive',
        sharedRootId: 'shared_existing',
        enabledAt: new Date().toISOString(),
        vaultPolicy: 'copy-into-workspace',
        pathPolicy: 'relative-required',
      },
      team: {
        enabled: true,
        teamId: 'team_existing',
        revision: 4,
        automationsPolicy: 'manual-only',
        backgroundTriggersEnabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    const status = getTeamModeStatus(root);

    expect(status.team.teamId).toBe('team_existing');
    expect(existsSync(status.privateMachinePath)).toBe(true);
    expect(existsSync(status.heartbeatPath)).toBe(true);
    expect(status.heartbeat.observedTeamRevision).toBe(4);
  });

  it('sets the current machine as runner and increments the team revision', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root);

    const enabled = markWorkspaceAsSharedFolder(root);
    const runner = setRunnerMachine(root);

    expect(runner.team.runnerMachineId).toBe(enabled.machine.machineId);
    expect(runner.team.automationsPolicy).toBe('runner-only');
    expect(runner.team.backgroundTriggersEnabled).toBe(true);
    expect(runner.team.revision).toBe(enabled.team.revision + 1);
  });

  it('reports future workspace formats as unsupported', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root, { formatVersion: 99 });

    const status = getTeamModeStatus(root);
    const saved = loadWorkspaceConfig(root);

    expect(status.supported).toBe(false);
    expect(status.formatVersion).toBe(99);
    expect(status.machine.machineId).toBe('read_only');
    expect(saved?.storage).toBeUndefined();
    expect(existsSync(join(root, TEAM_CONFIG_FILE))).toBe(false);
  });
});
