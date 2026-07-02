import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
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
export const TEAM_RUNNER_STATE_FILE = 'team/runner-state.json';
export const TEAM_RUNNER_PULSE_LOG_FILE = 'team/runner-pulse.jsonl';
export const TEAM_RUNNER_STALE_AFTER_MS = 15 * 60 * 1000;
export const TEAM_RUNNER_HANDOVER_GRACE_MS = 10 * 60 * 1000;

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
  runnerHeartbeat?: TeamMachineHeartbeat;
  runnerIsStale: boolean;
  runnerStaleAfterMs: number;
}

export interface TeamRunnerState {
  version: 1;
  runnerMachineId?: string;
  lastSchedulerTickAt?: string;
  lastSchedulerTickKey?: string;
  updatedAt: string;
}

export type TeamRunnerGateReason =
  | 'solo'
  | 'runner'
  | 'unsupported'
  | 'team-disabled'
  | 'not-shared-folder'
  | 'manual-only'
  | 'background-disabled'
  | 'no-runner'
  | 'not-runner'
  | 'handover-pending'
  | 'stale-observed-revision';

export interface TeamRunnerGateDecision {
  allowed: boolean;
  reason: TeamRunnerGateReason;
  machineId: string;
  runnerMachineId?: string;
  observedTeamRevision: number;
  teamRevision: number;
  runnerIsStale: boolean;
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

export function getTeamRunnerStateFile(workspaceRootPath: string): string {
  return join(workspaceRootPath, TEAM_RUNNER_STATE_FILE);
}

export function getTeamRunnerPulseLogFile(workspaceRootPath: string): string {
  return join(workspaceRootPath, TEAM_RUNNER_PULSE_LOG_FILE);
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
    runnerMissedTickPolicy: existing?.runnerMissedTickPolicy ?? 'skip',
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

export function listTeamMachineHeartbeats(workspaceRootPath: string): TeamMachineHeartbeat[] {
  const dir = getTeamMachinesDir(workspaceRootPath);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => readJson<TeamMachineHeartbeat>(join(dir, file)))
    .filter((heartbeat): heartbeat is TeamMachineHeartbeat => heartbeat?.version === 1 && Boolean(heartbeat.machineId));
}

export function getRunnerHeartbeat(workspaceRootPath: string, runnerMachineId?: string): TeamMachineHeartbeat | undefined {
  if (!runnerMachineId) return undefined;
  return listTeamMachineHeartbeats(workspaceRootPath).find((heartbeat) => heartbeat.machineId === runnerMachineId);
}

export function isTeamRunnerHeartbeatStale(
  heartbeat: TeamMachineHeartbeat | undefined,
  now: number = Date.now(),
  staleAfterMs = TEAM_RUNNER_STALE_AFTER_MS,
): boolean {
  if (!heartbeat) return true;
  const lastSeen = Date.parse(heartbeat.lastAutomationHeartbeatAt ?? heartbeat.lastSeenAt);
  return !Number.isFinite(lastSeen) || now - lastSeen > staleAfterMs;
}

function isRunnerHandoverReady(workspaceRootPath: string, team: WorkspaceTeamConfig, now = Date.now()): boolean {
  const handover = team.runnerHandover;
  if (!handover) return true;
  if (!handover.from) return true;
  const fromHeartbeat = getRunnerHeartbeat(workspaceRootPath, handover.from);
  if (fromHeartbeat && fromHeartbeat.observedTeamRevision >= handover.revision) return true;
  if (isTeamRunnerHeartbeatStale(fromHeartbeat, now, TEAM_RUNNER_STALE_AFTER_MS)) return true;
  const initiatedAt = Date.parse(handover.initiatedAt);
  return Number.isFinite(initiatedAt) && now - initiatedAt > TEAM_RUNNER_HANDOVER_GRACE_MS;
}

function getRunnerStatusFields(workspaceRootPath: string, team: WorkspaceTeamConfig): Pick<TeamModeStatus, 'runnerHeartbeat' | 'runnerIsStale' | 'runnerStaleAfterMs'> {
  const runnerHeartbeat = getRunnerHeartbeat(workspaceRootPath, team.runnerMachineId);
  return {
    runnerHeartbeat,
    runnerIsStale: team.enabled && Boolean(team.runnerMachineId) && isTeamRunnerHeartbeatStale(runnerHeartbeat),
    runnerStaleAfterMs: TEAM_RUNNER_STALE_AFTER_MS,
  };
}

export function readTeamRunnerState(workspaceRootPath: string): TeamRunnerState {
  return readJson<TeamRunnerState>(getTeamRunnerStateFile(workspaceRootPath)) ?? {
    version: 1,
    updatedAt: nowIso(),
  };
}

function writeTeamRunnerState(workspaceRootPath: string, state: TeamRunnerState): TeamRunnerState {
  atomicWriteJson(getTeamRunnerStateFile(workspaceRootPath), state);
  return state;
}

export function recordRunnerSchedulerTick(workspaceRootPath: string, machineId: string, tickKey: string, tickAt = nowIso()): TeamRunnerState {
  const state = readTeamRunnerState(workspaceRootPath);
  return writeTeamRunnerState(workspaceRootPath, {
    ...state,
    version: 1,
    runnerMachineId: machineId,
    lastSchedulerTickAt: tickAt,
    lastSchedulerTickKey: tickKey,
    updatedAt: tickAt,
  });
}

export function appendRunnerPulse(
  workspaceRootPath: string,
  input: { machineId: string; event: string; allowed: boolean; reason: string; timestamp?: string },
): void {
  mkdirSync(dirname(getTeamRunnerPulseLogFile(workspaceRootPath)), { recursive: true });
  appendFileSync(getTeamRunnerPulseLogFile(workspaceRootPath), JSON.stringify({
    version: 1,
    machineId: input.machineId,
    event: input.event,
    allowed: input.allowed,
    reason: input.reason,
    timestamp: input.timestamp ?? nowIso(),
  }) + '\n', 'utf-8');
}

export function evaluateTeamRunnerGate(workspaceRootPath: string): TeamRunnerGateDecision {
  const loaded = loadWorkspaceConfig(workspaceRootPath);
  if (!loaded) throw new Error(`Failed to load workspace config at ${workspaceRootPath}`);
  assertNotMoved(loaded);
  const formatVersion = loaded.formatVersion ?? WORKSPACE_FORMAT_VERSION;
  const team = loaded.team ?? createDisabledTeamConfig({ teamId: 'team_uninitialized' });
  const machine = readExistingMachineIdentity(loaded.id) ?? createReadOnlyMachineIdentity(loaded.id);
  const heartbeat = createReadOnlyHeartbeat(workspaceRootPath, machine, team);
  const runnerHeartbeat = getRunnerHeartbeat(workspaceRootPath, team.runnerMachineId);
  const runnerIsStale = team.enabled && Boolean(team.runnerMachineId) && isTeamRunnerHeartbeatStale(runnerHeartbeat);
  const base = {
    machineId: machine.machineId,
    runnerMachineId: team.runnerMachineId,
    observedTeamRevision: heartbeat.observedTeamRevision,
    teamRevision: team.revision,
    runnerIsStale,
  };

  if (formatVersion > WORKSPACE_FORMAT_VERSION) return { ...base, allowed: false, reason: 'unsupported' };
  if ((loaded.storage?.mode ?? 'solo') === 'solo') return { ...base, allowed: true, reason: 'solo' };
  if (loaded.storage?.mode !== 'shared-folder') return { ...base, allowed: false, reason: 'not-shared-folder' };
  if (!team.enabled) return { ...base, allowed: false, reason: 'team-disabled' };
  if (team.automationsPolicy !== 'runner-only') return { ...base, allowed: false, reason: 'manual-only' };
  if (!team.backgroundTriggersEnabled) return { ...base, allowed: false, reason: 'background-disabled' };
  if (!team.runnerMachineId) return { ...base, allowed: false, reason: 'no-runner' };
  if (team.runnerMachineId !== machine.machineId) return { ...base, allowed: false, reason: 'not-runner' };
  if (team.runnerHandover?.to === machine.machineId && !isRunnerHandoverReady(workspaceRootPath, team)) {
    return { ...base, allowed: false, reason: 'handover-pending' };
  }
  if (heartbeat.observedTeamRevision < team.revision) return { ...base, allowed: false, reason: 'stale-observed-revision' };

  return { ...base, allowed: true, reason: 'runner' };
}

export function clearReadyRunnerHandover(workspaceRootPath: string, machineId: string): WorkspaceConfig | null {
  const loaded = loadWorkspaceConfig(workspaceRootPath);
  if (!loaded?.team?.runnerHandover || loaded.team.runnerHandover.to !== machineId) return null;
  if (!isRunnerHandoverReady(workspaceRootPath, loaded.team)) return null;
  const timestamp = nowIso();
  const config: WorkspaceConfig = {
    ...loaded,
    team: {
      ...loaded.team,
      revision: loaded.team.revision + 1,
      runnerHandover: undefined,
      updatedAt: timestamp,
    },
  };
  saveWorkspaceConfig(workspaceRootPath, config);
  writeTeamConfigMirror(workspaceRootPath, config);
  const machine = readOrCreateMachineIdentity(config.id);
  writeMachineHeartbeat(workspaceRootPath, config, machine);
  return config;
}

export function refreshTeamRunnerHeartbeat(workspaceRootPath: string, input: { appVersion?: string } = {}): TeamMachineHeartbeat | null {
  const loaded = loadWorkspaceConfig(workspaceRootPath);
  if (!loaded) throw new Error(`Failed to load workspace config at ${workspaceRootPath}`);
  assertNotMoved(loaded);
  const normalized = ensureWorkspaceTeamFields(loaded);
  if ((normalized.storage?.mode ?? 'solo') === 'solo') return null;
  const machine = readOrCreateMachineIdentity(normalized.id);
  return writeMachineHeartbeat(workspaceRootPath, normalized, machine, { appVersion: input.appVersion, canRunAutomations: true });
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
  const runnerStatus = getRunnerStatusFields(workspaceRootPath, team);

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
      ...runnerStatus,
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
    ...runnerStatus,
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
  const runnerStatus = getRunnerStatusFields(workspaceRootPath, config.team!);
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
    ...runnerStatus,
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
  const handoverFrom = previousTeam.runnerMachineId && previousTeam.runnerMachineId !== runnerMachineId
    ? previousTeam.runnerMachineId
    : undefined;
  const nextRevision = previousTeam.revision + 1;
  const config: WorkspaceConfig = {
    ...loaded,
    team: {
      ...previousTeam,
      enabled: true,
      revision: nextRevision,
      runnerMachineId,
      runnerHandover: handoverFrom
        ? {
            from: handoverFrom,
            to: runnerMachineId,
            initiatedAt: timestamp,
            revision: nextRevision,
          }
        : undefined,
      automationsPolicy: 'runner-only',
      backgroundTriggersEnabled: true,
      updatedAt: timestamp,
    },
  };
  saveWorkspaceConfig(workspaceRootPath, config);
  writeTeamConfigMirror(workspaceRootPath, config);
  const heartbeat = writeMachineHeartbeat(workspaceRootPath, config, machine);
  const runnerStatus = getRunnerStatusFields(workspaceRootPath, config.team!);
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
    ...runnerStatus,
  };
}
