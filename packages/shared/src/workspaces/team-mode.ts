import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONFIG_DIR, loadWorkspaceConfig, saveWorkspaceConfig } from './storage.ts';
import {
  WORKSPACE_FORMAT_VERSION,
  type SharedFolderProvider,
  type WorkspaceConfig,
  type WorkspaceStorageConfig,
  type WorkspaceTeamConfig,
} from './types.ts';

export const TEAM_CONFIG_FILE = 'team/config.json';
export const TEAM_MACHINE_DIR = 'team/machines';

export interface TeamMachineIdentity {
  version: 1;
  workspaceId: string;
  machineId: string;
  displayName: string;
  createdAt: string;
  lastOpenedAt: string;
}

export interface TeamMachineHeartbeat {
  version: 1;
  machineId: string;
  displayName: string;
  appVersion?: string;
  canRunAutomations: boolean;
  isRunner: boolean;
  observedTeamRevision: number;
  lastSeenAt: string;
  lastAutomationHeartbeatAt?: string;
}

export interface TeamModeStatus {
  supported: boolean;
  supportedFormatVersion: number;
  formatVersion: number;
  storage: WorkspaceStorageConfig;
  team: WorkspaceTeamConfig;
  teamConfigPath: string;
  privateMachinePath: string;
  heartbeatPath: string;
  machine: TeamMachineIdentity;
  heartbeat: TeamMachineHeartbeat;
}

function nowIso(): string {
  return new Date().toISOString();
}

function atomicWriteJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf-8');
    renameSync(tmp, file);
  } catch (error) {
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw error;
  }
}

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

export function getTeamConfigFile(workspaceRootPath: string): string {
  return join(workspaceRootPath, TEAM_CONFIG_FILE);
}

export function getTeamMachinesDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, TEAM_MACHINE_DIR);
}

export function getTeamHeartbeatFile(workspaceRootPath: string, machineId: string): string {
  return join(getTeamMachinesDir(workspaceRootPath), `${machineId}.json`);
}

export function getPrivateTeamDir(workspaceId: string): string {
  return join(process.env.CRAFT_CONFIG_DIR || CONFIG_DIR, 'team', workspaceId);
}

export function getPrivateMachineFile(workspaceId: string): string {
  return join(getPrivateTeamDir(workspaceId), 'machine.json');
}

export function defaultSoloStorage(): WorkspaceStorageConfig {
  return { mode: 'solo', portabilityVersion: 1 };
}

export function createDisabledTeamConfig(existing?: Partial<WorkspaceTeamConfig>): WorkspaceTeamConfig {
  const timestamp = nowIso();
  return {
    enabled: false,
    teamId: existing?.teamId ?? `team_${randomUUID().slice(0, 8)}`,
    revision: existing?.revision ?? 0,
    runnerMachineId: existing?.runnerMachineId,
    automationsPolicy: existing?.automationsPolicy ?? 'manual-only',
    backgroundTriggersEnabled: existing?.backgroundTriggersEnabled ?? false,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: existing?.updatedAt ?? timestamp,
  };
}

export function ensureWorkspaceTeamFields(config: WorkspaceConfig): WorkspaceConfig {
  return {
    ...config,
    formatVersion: config.formatVersion ?? WORKSPACE_FORMAT_VERSION,
    storage: config.storage ?? defaultSoloStorage(),
    team: config.team ?? createDisabledTeamConfig(),
  };
}

export function writeTeamConfigMirror(workspaceRootPath: string, config: WorkspaceConfig): void {
  const normalized = ensureWorkspaceTeamFields(config);
  atomicWriteJson(getTeamConfigFile(workspaceRootPath), {
    version: 1,
    workspaceId: normalized.id,
    storage: normalized.storage,
    team: normalized.team,
    generatedAt: nowIso(),
    precedence: 'config.json is authoritative; this mirror is for inspection and future migrations.',
  });
}

export function ensureWorkspaceTeamMetadata(workspaceRootPath: string): WorkspaceConfig {
  const loaded = loadWorkspaceConfig(workspaceRootPath);
  if (!loaded) throw new Error(`Failed to load workspace config at ${workspaceRootPath}`);
  assertNotMoved(loaded);
  assertSupportedFormat(loaded);
  const normalized = ensureWorkspaceTeamFields(loaded);
  saveWorkspaceConfig(workspaceRootPath, normalized);
  writeTeamConfigMirror(workspaceRootPath, normalized);
  return normalized;
}

function assertSupportedFormat(config: WorkspaceConfig): void {
  const formatVersion = config.formatVersion ?? WORKSPACE_FORMAT_VERSION;
  if (formatVersion > WORKSPACE_FORMAT_VERSION) {
    throw new Error(`Workspace format ${formatVersion} requires a newer app version.`);
  }
}

function assertNotMoved(config: WorkspaceConfig): void {
  if (config.movedTo?.path) {
    throw new Error(`Workspace moved to ${config.movedTo.path}`);
  }
}

export function readOrCreateMachineIdentity(workspaceId: string, displayName?: string): TeamMachineIdentity {
  const file = getPrivateMachineFile(workspaceId);
  const existing = readJson<TeamMachineIdentity>(file);
  const timestamp = nowIso();
  const identity: TeamMachineIdentity = existing?.version === 1 && existing.machineId
    ? {
        ...existing,
        displayName: displayName?.trim() || existing.displayName || hostname(),
        lastOpenedAt: timestamp,
      }
    : {
        version: 1,
        workspaceId,
        machineId: `machine_${randomUUID().slice(0, 8)}`,
        displayName: displayName?.trim() || hostname(),
        createdAt: timestamp,
        lastOpenedAt: timestamp,
      };
  atomicWriteJson(file, identity);
  return identity;
}

function readExistingMachineIdentity(workspaceId: string): TeamMachineIdentity | null {
  const existing = readJson<TeamMachineIdentity>(getPrivateMachineFile(workspaceId));
  return existing?.version === 1 && existing.machineId ? existing : null;
}

function createReadOnlyMachineIdentity(workspaceId: string): TeamMachineIdentity {
  const timestamp = nowIso();
  return {
    version: 1,
    workspaceId,
    machineId: 'not_joined',
    displayName: hostname(),
    createdAt: timestamp,
    lastOpenedAt: timestamp,
  };
}

function createReadOnlyHeartbeat(
  workspaceRootPath: string,
  machine: TeamMachineIdentity,
  team: WorkspaceTeamConfig,
  options: { appVersion?: string } = {},
): TeamMachineHeartbeat {
  const existing = machine.machineId === 'not_joined'
    ? null
    : readJson<TeamMachineHeartbeat>(getTeamHeartbeatFile(workspaceRootPath, machine.machineId));
  return existing?.version === 1
    ? existing
    : {
        version: 1,
        machineId: machine.machineId,
        displayName: machine.displayName,
        appVersion: options.appVersion,
        canRunAutomations: false,
        isRunner: team.runnerMachineId === machine.machineId,
        observedTeamRevision: team.revision,
        lastSeenAt: nowIso(),
      };
}

export function writeMachineHeartbeat(
  workspaceRootPath: string,
  config: WorkspaceConfig,
  machine: TeamMachineIdentity,
  options: { appVersion?: string; canRunAutomations?: boolean } = {},
): TeamMachineHeartbeat {
  const normalized = ensureWorkspaceTeamFields(config);
  const heartbeat: TeamMachineHeartbeat = {
    version: 1,
    machineId: machine.machineId,
    displayName: machine.displayName,
    appVersion: options.appVersion,
    canRunAutomations: options.canRunAutomations ?? true,
    isRunner: normalized.team?.runnerMachineId === machine.machineId,
    observedTeamRevision: normalized.team?.revision ?? 0,
    lastSeenAt: nowIso(),
    lastAutomationHeartbeatAt:
      normalized.team?.runnerMachineId === machine.machineId && normalized.team.backgroundTriggersEnabled
        ? nowIso()
        : undefined,
  };
  atomicWriteJson(getTeamHeartbeatFile(workspaceRootPath, machine.machineId), heartbeat);
  return heartbeat;
}

export function getTeamModeStatus(workspaceRootPath: string, options: { appVersion?: string } = {}): TeamModeStatus {
  const loaded = loadWorkspaceConfig(workspaceRootPath);
  if (!loaded) throw new Error(`Failed to load workspace config at ${workspaceRootPath}`);
  assertNotMoved(loaded);
  const formatVersion = loaded.formatVersion ?? WORKSPACE_FORMAT_VERSION;
  const team = loaded.team ?? createDisabledTeamConfig({ teamId: 'team_uninitialized' });
  const machine = readExistingMachineIdentity(loaded.id) ?? createReadOnlyMachineIdentity(loaded.id);
  const heartbeat = createReadOnlyHeartbeat(workspaceRootPath, machine, team, options);

  if (formatVersion > WORKSPACE_FORMAT_VERSION) {
    return {
      supported: false,
      supportedFormatVersion: WORKSPACE_FORMAT_VERSION,
      formatVersion,
      storage: loaded.storage ?? defaultSoloStorage(),
      team,
      teamConfigPath: getTeamConfigFile(workspaceRootPath),
      privateMachinePath: getPrivateMachineFile(loaded.id),
      heartbeatPath: getTeamHeartbeatFile(workspaceRootPath, machine.machineId),
      machine,
      heartbeat,
    };
  }

  return {
    supported: formatVersion <= WORKSPACE_FORMAT_VERSION,
    supportedFormatVersion: WORKSPACE_FORMAT_VERSION,
    formatVersion,
    storage: loaded.storage ?? defaultSoloStorage(),
    team,
    teamConfigPath: getTeamConfigFile(workspaceRootPath),
    privateMachinePath: getPrivateMachineFile(loaded.id),
    heartbeatPath: getTeamHeartbeatFile(workspaceRootPath, machine.machineId),
    machine,
    heartbeat,
  };
}

export function markWorkspaceAsSharedFolder(
  workspaceRootPath: string,
  input: { provider?: SharedFolderProvider; providerLabel?: string; makeRunner?: boolean; appVersion?: string } = {},
): TeamModeStatus {
  const loaded = ensureWorkspaceTeamMetadata(workspaceRootPath);
  const machine = readOrCreateMachineIdentity(loaded.id);
  const timestamp = nowIso();
  const previousTeam = loaded.team ?? createDisabledTeamConfig();
  const config: WorkspaceConfig = {
    ...loaded,
    formatVersion: WORKSPACE_FORMAT_VERSION,
    storage: {
      mode: 'shared-folder',
      portabilityVersion: 1,
      provider: input.provider ?? 'generic-folder',
      providerLabel: input.providerLabel,
      sharedRootId: loaded.storage?.mode === 'shared-folder' ? loaded.storage.sharedRootId : `shared_${randomUUID().slice(0, 8)}`,
      enabledAt: loaded.storage?.mode === 'shared-folder' ? loaded.storage.enabledAt : timestamp,
      vaultPolicy: 'copy-into-workspace',
      pathPolicy: 'relative-required',
    },
    team: {
      ...previousTeam,
      enabled: true,
      revision: previousTeam.revision + 1,
      runnerMachineId: input.makeRunner ? machine.machineId : previousTeam.runnerMachineId,
      automationsPolicy: input.makeRunner ? 'runner-only' : 'manual-only',
      backgroundTriggersEnabled: Boolean(input.makeRunner),
      updatedAt: timestamp,
    },
  };
  saveWorkspaceConfig(workspaceRootPath, config);
  writeTeamConfigMirror(workspaceRootPath, config);
  const heartbeat = writeMachineHeartbeat(workspaceRootPath, config, machine, { appVersion: input.appVersion });
  return {
    supported: true,
    supportedFormatVersion: WORKSPACE_FORMAT_VERSION,
    formatVersion: WORKSPACE_FORMAT_VERSION,
    storage: config.storage!,
    team: config.team!,
    teamConfigPath: getTeamConfigFile(workspaceRootPath),
    privateMachinePath: getPrivateMachineFile(config.id),
    heartbeatPath: getTeamHeartbeatFile(workspaceRootPath, machine.machineId),
    machine,
    heartbeat,
  };
}

export function setRunnerMachine(workspaceRootPath: string, machineId?: string): TeamModeStatus {
  const loaded = loadWorkspaceConfig(workspaceRootPath);
  if (!loaded) throw new Error(`Failed to load workspace config at ${workspaceRootPath}`);
  assertNotMoved(loaded);
  assertSupportedFormat(loaded);
  if (loaded.storage?.mode !== 'shared-folder' || !loaded.team?.enabled) {
    throw new Error('Team runner requires an enabled shared-folder team workspace.');
  }
  const machine = readOrCreateMachineIdentity(loaded.id);
  const timestamp = nowIso();
  const previousTeam = loaded.team ?? createDisabledTeamConfig();
  const runnerMachineId = machineId ?? machine.machineId;
  const config: WorkspaceConfig = {
    ...loaded,
    team: {
      ...previousTeam,
      enabled: true,
      revision: previousTeam.revision + 1,
      runnerMachineId,
      automationsPolicy: 'runner-only',
      backgroundTriggersEnabled: true,
      updatedAt: timestamp,
    },
  };
  saveWorkspaceConfig(workspaceRootPath, config);
  writeTeamConfigMirror(workspaceRootPath, config);
  const heartbeat = writeMachineHeartbeat(workspaceRootPath, config, machine);
  return {
    supported: true,
    supportedFormatVersion: WORKSPACE_FORMAT_VERSION,
    formatVersion: config.formatVersion ?? WORKSPACE_FORMAT_VERSION,
    storage: config.storage ?? defaultSoloStorage(),
    team: config.team!,
    teamConfigPath: getTeamConfigFile(workspaceRootPath),
    privateMachinePath: getPrivateMachineFile(config.id),
    heartbeatPath: getTeamHeartbeatFile(workspaceRootPath, machine.machineId),
    machine,
    heartbeat,
  };
}
