import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONFIG_DIR, loadWorkspaceConfig, saveWorkspaceConfig } from './storage.ts';
import { listConflictRecords, scanProviderConflictedCopies } from '../records/storage.ts';
import {
  WORKSPACE_FORMAT_VERSION,
  type SharedFolderProvider,
  type WorkspaceConfig,
  type WorkspaceStorageConfig,
  type WorkspaceTeamConfig,
  type WorkspaceTeamMember,
  type WorkspaceTeamRole,
} from './types.ts';

export const TEAM_CONFIG_FILE = 'team/config.json';
export const TEAM_MACHINE_DIR = 'team/machines';
export const TEAM_RUNNER_STATE_FILE = 'team/runner-state.json';
export const TEAM_RUNNER_PULSE_LOG_FILE = 'team/runner-pulse.jsonl';
export const TEAM_RUNNER_STALE_AFTER_MS = 15 * 60 * 1000;
export const TEAM_RUNNER_HANDOVER_GRACE_MS = 10 * 60 * 1000;
export const TEAM_HEARTBEAT_MIN_WRITE_MS = 5 * 60 * 1000;
export const TEAM_RUNNER_PULSE_ROTATE_BYTES = 512 * 1024;

export interface TeamMachineIdentity {
  version: 1;
  workspaceId: string;
  memberId?: string;
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
  joined: boolean;
  currentMember?: WorkspaceTeamMember;
  currentRole: WorkspaceTeamRole | 'none';
  canManageTeam: boolean;
  canEditSharedWork: boolean;
  syncHealth: TeamSyncHealth;
}

export type TeamSyncHealthState = 'solo' | 'healthy' | 'warning' | 'blocked';
export type TeamSyncHealthCheckState = 'ok' | 'warning' | 'blocked';

export interface TeamSyncHealthCheck {
  id: string;
  label: string;
  status: TeamSyncHealthCheckState;
  detail?: string;
}

export interface TeamSyncHealth {
  status: TeamSyncHealthState;
  summary: string;
  joined: boolean;
  machineCount: number;
  conflictCount: number;
  runnerMachineId?: string;
  runnerLastSeenAt?: string;
  checks: TeamSyncHealthCheck[];
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

export type TeamPermissionAction =
  | 'team.settings.update'
  | 'team.runner.assign'
  | 'team.members.invite'
  | 'team.members.remove'
  | 'secrets.update'
  | 'storage.migrate'
  | 'records.write'
  | 'files.write'
  | 'agent.chat'
  | 'automation.background.run'
  | 'community.email.draft'
  | 'community.email.send';

export interface TeamPermissionDecision {
  allowed: boolean;
  action: TeamPermissionAction;
  role: WorkspaceTeamRole | 'none';
  reason?: string;
  member?: WorkspaceTeamMember;
  machineId: string;
  runnerMachineId?: string;
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
    members: existing?.members,
    runnerMachineId: existing?.runnerMachineId,
    automationsPolicy: existing?.automationsPolicy ?? 'manual-only',
    backgroundTriggersEnabled: existing?.backgroundTriggersEnabled ?? false,
    runnerMissedTickPolicy: existing?.runnerMissedTickPolicy ?? 'skip',
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: existing?.updatedAt ?? timestamp,
  };
}

function createTeamMember(machine: TeamMachineIdentity, role: WorkspaceTeamRole, timestamp = nowIso()): WorkspaceTeamMember {
  return {
    memberId: machine.memberId ?? `member_${randomUUID().slice(0, 10)}`,
    displayName: machine.displayName || hostname(),
    role,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function writeMachineIdentity(workspaceId: string, identity: TeamMachineIdentity): TeamMachineIdentity {
  atomicWriteJson(getPrivateMachineFile(workspaceId), identity);
  return identity;
}

function getTeamMembers(team: WorkspaceTeamConfig): WorkspaceTeamMember[] {
  return Array.isArray(team.members) ? team.members.filter((member) => Boolean(member.memberId && member.role)) : [];
}

function getMemberForMachine(team: WorkspaceTeamConfig, machine: TeamMachineIdentity): WorkspaceTeamMember | undefined {
  if (!machine.memberId) return undefined;
  return getTeamMembers(team).find((member) => member.memberId === machine.memberId);
}

function getRoleForMachine(team: WorkspaceTeamConfig, machine: TeamMachineIdentity): WorkspaceTeamRole | 'none' {
  return getMemberForMachine(team, machine)?.role ?? 'none';
}

export function ensureMachineTeamMember(
  workspaceRootPath: string,
  config: WorkspaceConfig,
  machine: TeamMachineIdentity,
  defaultRole: WorkspaceTeamRole,
): { config: WorkspaceConfig; machine: TeamMachineIdentity; member: WorkspaceTeamMember } {
  const team = config.team ?? createDisabledTeamConfig();
  const members = getTeamMembers(team);
  const existing = getMemberForMachine(team, machine);
  if (existing) return { config, machine, member: existing };

  const timestamp = nowIso();
  const member = createTeamMember(machine, members.length === 0 ? 'owner' : defaultRole, timestamp);
  const nextMachine = machine.memberId === member.memberId ? machine : { ...machine, memberId: member.memberId, lastOpenedAt: timestamp };
  const nextConfig: WorkspaceConfig = {
    ...config,
    team: {
      ...team,
      members: [...members, member],
      updatedAt: timestamp,
    },
  };
  saveWorkspaceConfig(workspaceRootPath, nextConfig);
  writeMachineIdentity(config.id, nextMachine);
  return { config: nextConfig, machine: nextMachine, member };
}

function isOwnerOnlyAction(action: TeamPermissionAction): boolean {
  return [
    'team.settings.update',
    'team.runner.assign',
    'team.members.invite',
    'team.members.remove',
    'secrets.update',
    'storage.migrate',
    'community.email.send',
  ].includes(action);
}

export function evaluateTeamPermission(
  workspaceRootPath: string,
  input: { action: TeamPermissionAction; machineId?: string } | TeamPermissionAction,
): TeamPermissionDecision {
  const action = typeof input === 'string' ? input : input.action;
  if (action === 'automation.background.run') {
    const gate = evaluateTeamRunnerGate(workspaceRootPath);
    return {
      allowed: gate.allowed && gate.reason === 'runner',
      action,
      role: 'none',
      reason: gate.allowed ? undefined : gate.reason,
      machineId: gate.machineId,
      runnerMachineId: gate.runnerMachineId,
    };
  }

  const loaded = loadWorkspaceConfig(workspaceRootPath);
  if (!loaded) throw new Error(`Failed to load workspace config at ${workspaceRootPath}`);
  assertNotMoved(loaded);
  const team = loaded.team ?? createDisabledTeamConfig({ teamId: 'team_uninitialized' });
  const machine = readExistingMachineIdentity(loaded.id) ?? createReadOnlyMachineIdentity(loaded.id);
  if (typeof input !== 'string' && input.machineId && input.machineId !== machine.machineId) {
    return {
      allowed: false,
      action,
      role: 'none',
      reason: 'machine-mismatch',
      machineId: machine.machineId,
      runnerMachineId: team.runnerMachineId,
    };
  }
  const members = getTeamMembers(team);
  const role = getRoleForMachine(team, machine);
  const member = getMemberForMachine(team, machine);
  const effectiveRole = role === 'none' && machine.machineId !== 'not_joined' && members.length === 0 ? 'owner' : role;
  const base = {
    action,
    role: effectiveRole,
    member,
    machineId: machine.machineId,
    runnerMachineId: team.runnerMachineId,
  };

  if ((loaded.storage?.mode ?? 'solo') === 'solo' || !team.enabled) return { ...base, allowed: true };
  if (machine.machineId === 'not_joined') return { ...base, allowed: false, reason: 'not-joined' };
  if (effectiveRole === 'none') return { ...base, allowed: false, reason: 'unknown-member' };
  if (isOwnerOnlyAction(action)) {
    return effectiveRole === 'owner'
      ? { ...base, allowed: true }
      : { ...base, allowed: false, reason: 'owner-required' };
  }
  return effectiveRole === 'owner' || effectiveRole === 'editor'
    ? { ...base, allowed: true }
    : { ...base, allowed: false, reason: 'member-required' };
}

export function assertTeamPermission(
  workspaceRootPath: string,
  input: { action: TeamPermissionAction; machineId?: string } | TeamPermissionAction,
): TeamPermissionDecision {
  const decision = evaluateTeamPermission(workspaceRootPath, input);
  if (!decision.allowed) {
    throw new Error(`Team permission denied for ${decision.action}: ${decision.reason ?? 'not allowed'}`);
  }
  if (decision.role === 'owner' && !decision.member && decision.machineId !== 'not_joined') {
    const loaded = loadWorkspaceConfig(workspaceRootPath);
    const machine = loaded ? readExistingMachineIdentity(loaded.id) : null;
    if (loaded?.team?.enabled && machine && getTeamMembers(loaded.team).length === 0) {
      ensureMachineTeamMember(workspaceRootPath, loaded, machine, 'owner');
    }
  }
  return decision;
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
  const initiatedAt = Date.parse(handover.initiatedAt);
  const fromHeartbeat = getRunnerHeartbeat(workspaceRootPath, handover.from);
  if (!fromHeartbeat) return Number.isFinite(initiatedAt) && now - initiatedAt > TEAM_RUNNER_HANDOVER_GRACE_MS;
  if (fromHeartbeat && fromHeartbeat.observedTeamRevision >= handover.revision) return true;
  if (isTeamRunnerHeartbeatStale(fromHeartbeat, now, TEAM_RUNNER_STALE_AFTER_MS)) return true;
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

function getConflictCount(workspaceRootPath: string, machineId: string, scanProviderConflicts: boolean): number {
  try {
    if (scanProviderConflicts) {
      scanProviderConflictedCopies(workspaceRootPath, { machineId });
    }
    return listConflictRecords(workspaceRootPath).filter((conflict) => conflict.status !== 'resolved').length;
  } catch {
    return 0;
  }
}

function buildTeamSyncHealth(
  workspaceRootPath: string,
  input: {
    supported: boolean;
    storage: WorkspaceStorageConfig;
    team: WorkspaceTeamConfig;
    machine: TeamMachineIdentity;
    heartbeat: TeamMachineHeartbeat;
    runnerHeartbeat?: TeamMachineHeartbeat;
    runnerIsStale: boolean;
  },
): TeamSyncHealth {
  const joined = input.machine.machineId !== 'not_joined';
  const machineCount = listTeamMachineHeartbeats(workspaceRootPath).length;
  const shouldScanProviderConflicts = input.storage.mode === 'shared-folder' && input.team.enabled;
  const conflictCount = getConflictCount(workspaceRootPath, input.machine.machineId, shouldScanProviderConflicts);
  const checks: TeamSyncHealthCheck[] = [];

  if (input.storage.mode === 'solo' || !input.team.enabled) {
    return {
      status: 'solo',
      summary: 'Solo workspace',
      joined,
      machineCount,
      conflictCount,
      checks: [{ id: 'storage', label: 'Storage mode', status: 'ok', detail: 'Local solo workspace' }],
    };
  }

  checks.push({
    id: 'format',
    label: 'Workspace format',
    status: input.supported ? 'ok' : 'blocked',
    detail: input.supported ? 'Supported by this app' : 'Requires a newer app',
  });
  checks.push({
    id: 'storage',
    label: 'Storage mode',
    status: input.storage.mode === 'shared-folder' ? 'ok' : 'warning',
    detail: input.storage.mode === 'shared-folder' ? 'Shared folder' : input.storage.mode,
  });
  checks.push({
    id: 'joined',
    label: 'This machine',
    status: joined ? 'ok' : 'warning',
    detail: joined ? input.machine.displayName : 'Join this team workspace to create a private machine identity',
  });
  checks.push({
    id: 'team-config',
    label: 'Team config mirror',
    status: existsSync(getTeamConfigFile(workspaceRootPath)) ? 'ok' : 'warning',
    detail: existsSync(getTeamConfigFile(workspaceRootPath)) ? 'Present' : 'Missing team/config.json mirror',
  });
  checks.push({
    id: 'heartbeat',
    label: 'This machine heartbeat',
    status: joined && existsSync(getTeamHeartbeatFile(workspaceRootPath, input.machine.machineId)) ? 'ok' : 'warning',
    detail: joined ? input.heartbeat.lastSeenAt : 'Not joined',
  });

  if (input.team.automationsPolicy === 'runner-only' || input.team.backgroundTriggersEnabled) {
    checks.push({
      id: 'runner',
      label: 'Runner machine',
      status: input.team.runnerMachineId ? (input.runnerIsStale ? 'warning' : 'ok') : 'warning',
      detail: input.team.runnerMachineId
        ? input.runnerIsStale ? 'Runner heartbeat is stale or missing' : input.team.runnerMachineId
        : 'No runner assigned',
    });
  }

  if (input.team.runnerHandover) {
    checks.push({
      id: 'handover',
      label: 'Runner handover',
      status: 'warning',
      detail: `Pending from ${input.team.runnerHandover.from ?? 'unknown'} to ${input.team.runnerHandover.to}`,
    });
  }

  if (input.heartbeat.observedTeamRevision < input.team.revision) {
    checks.push({
      id: 'revision',
      label: 'Team revision',
      status: 'warning',
      detail: `Observed ${input.heartbeat.observedTeamRevision}, current ${input.team.revision}`,
    });
  } else {
    checks.push({
      id: 'revision',
      label: 'Team revision',
      status: 'ok',
      detail: `Revision ${input.team.revision}`,
    });
  }

  checks.push({
    id: 'conflicts',
    label: 'Conflict inbox',
    status: conflictCount > 0 ? 'warning' : 'ok',
    detail: conflictCount > 0 ? `${conflictCount} open conflict${conflictCount === 1 ? '' : 's'}` : 'No open conflicts',
  });

  const status: TeamSyncHealthState = checks.some((check) => check.status === 'blocked')
    ? 'blocked'
    : checks.some((check) => check.status === 'warning')
      ? 'warning'
      : 'healthy';

  return {
    status,
    summary: status === 'healthy'
      ? 'Team sync looks healthy'
      : status === 'blocked'
        ? 'Team sync is blocked'
        : 'Team sync needs attention',
    joined,
    machineCount,
    conflictCount,
    runnerMachineId: input.team.runnerMachineId,
    runnerLastSeenAt: input.runnerHeartbeat?.lastAutomationHeartbeatAt ?? input.runnerHeartbeat?.lastSeenAt,
    checks,
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
  const file = getTeamRunnerPulseLogFile(workspaceRootPath);
  mkdirSync(dirname(file), { recursive: true });
  try {
    if (existsSync(file) && statSync(file).size > TEAM_RUNNER_PULSE_ROTATE_BYTES) {
      renameSync(file, `${file}.1`);
    }
  } catch {
    // Pulse logging should never block automation execution.
  }
  const timestamp = input.timestamp ?? nowIso();
  if (existsSync(file)) {
    try {
      const lastLine = readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean).pop();
      const last = lastLine ? JSON.parse(lastLine) as { machineId?: string; event?: string; allowed?: boolean; reason?: string; timestamp?: string } : null;
      const lastAt = last?.timestamp ? Date.parse(last.timestamp) : NaN;
      if (
        last
        && last.machineId === input.machineId
        && last.event === input.event
        && last.allowed === input.allowed
        && last.reason === input.reason
        && Number.isFinite(lastAt)
        && Date.parse(timestamp) - lastAt < TEAM_HEARTBEAT_MIN_WRITE_MS
      ) {
        return;
      }
    } catch {
      // Keep pulse logging best-effort.
    }
  }
  appendFileSync(file, JSON.stringify({
    version: 1,
    machineId: input.machineId,
    event: input.event,
    allowed: input.allowed,
    reason: input.reason,
    timestamp,
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
  const existing = getRunnerHeartbeat(workspaceRootPath, machine.machineId);
  const lastSeen = existing?.lastSeenAt ? Date.parse(existing.lastSeenAt) : NaN;
  const revisionChanged = existing?.observedTeamRevision !== normalized.team?.revision;
  if (existing && !revisionChanged && Number.isFinite(lastSeen) && Date.now() - lastSeen < TEAM_HEARTBEAT_MIN_WRITE_MS) {
    return existing;
  }
  return writeMachineHeartbeat(workspaceRootPath, normalized, machine, { appVersion: input.appVersion, canRunAutomations: true });
}

export function joinWorkspaceTeam(workspaceRootPath: string, input: { appVersion?: string; displayName?: string } = {}): TeamModeStatus {
  const loaded = loadWorkspaceConfig(workspaceRootPath);
  if (!loaded) throw new Error(`Failed to load workspace config at ${workspaceRootPath}`);
  assertNotMoved(loaded);
  assertSupportedFormat(loaded);
  const normalized = ensureWorkspaceTeamFields(loaded);
  if (normalized.storage?.mode !== 'shared-folder' || !normalized.team?.enabled) {
    throw new Error('Joining a team requires an enabled shared-folder team workspace.');
  }
  const machine = readOrCreateMachineIdentity(normalized.id, input.displayName);
  const joined = ensureMachineTeamMember(workspaceRootPath, normalized, machine, 'editor');
  writeTeamConfigMirror(workspaceRootPath, joined.config);
  writeMachineHeartbeat(workspaceRootPath, joined.config, joined.machine, { appVersion: input.appVersion, canRunAutomations: true });
  return getTeamModeStatus(workspaceRootPath, { appVersion: input.appVersion });
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
  const storage = loaded.storage ?? defaultSoloStorage();
  const supported = formatVersion <= WORKSPACE_FORMAT_VERSION;
  const joined = machine.machineId !== 'not_joined';
  const currentMember = getMemberForMachine(team, machine);
  const members = getTeamMembers(team);
  const currentRole: WorkspaceTeamRole | 'none' =
    storage.mode === 'solo' || !team.enabled
      ? 'owner'
      : currentMember?.role ?? (joined && members.length === 0 ? 'owner' : 'none');
  const canManageTeam = currentRole === 'owner';
  const canEditSharedWork = currentRole === 'owner' || currentRole === 'editor';
  const syncHealth = buildTeamSyncHealth(workspaceRootPath, {
    supported,
    storage,
    team,
    machine,
    heartbeat,
    ...runnerStatus,
  });

  if (formatVersion > WORKSPACE_FORMAT_VERSION) {
    return {
      supported,
      supportedFormatVersion: WORKSPACE_FORMAT_VERSION,
      formatVersion,
      storage,
      team,
      teamConfigPath: getTeamConfigFile(workspaceRootPath),
      privateMachinePath: getPrivateMachineFile(loaded.id),
      heartbeatPath: getTeamHeartbeatFile(workspaceRootPath, machine.machineId),
      machine,
      heartbeat,
      ...runnerStatus,
      joined,
      currentMember,
      currentRole,
      canManageTeam,
      canEditSharedWork,
      syncHealth,
    };
  }

  return {
    supported,
    supportedFormatVersion: WORKSPACE_FORMAT_VERSION,
    formatVersion,
    storage,
    team,
    teamConfigPath: getTeamConfigFile(workspaceRootPath),
    privateMachinePath: getPrivateMachineFile(loaded.id),
    heartbeatPath: getTeamHeartbeatFile(workspaceRootPath, machine.machineId),
    machine,
    heartbeat,
    ...runnerStatus,
    joined,
    currentMember,
    currentRole,
    canManageTeam,
    canEditSharedWork,
    syncHealth,
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
  if (previousTeam.enabled && loaded.storage?.mode === 'shared-folder') {
    assertTeamPermission(workspaceRootPath, 'team.settings.update');
  }
  const automationsPolicy = input.makeRunner
    ? 'runner-only'
    : previousTeam.enabled
      ? previousTeam.automationsPolicy
      : 'manual-only';
  const backgroundTriggersEnabled = input.makeRunner
    ? true
    : previousTeam.enabled
      ? previousTeam.backgroundTriggersEnabled
      : false;
  let config: WorkspaceConfig = {
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
      automationsPolicy,
      backgroundTriggersEnabled,
      updatedAt: timestamp,
    },
  };
  const joined = ensureMachineTeamMember(workspaceRootPath, config, machine, 'owner');
  config = joined.config;
  saveWorkspaceConfig(workspaceRootPath, config);
  writeTeamConfigMirror(workspaceRootPath, config);
  const heartbeat = writeMachineHeartbeat(workspaceRootPath, config, joined.machine, { appVersion: input.appVersion });
  const runnerStatus = getRunnerStatusFields(workspaceRootPath, config.team!);
  const isJoined = joined.machine.machineId !== 'not_joined';
  const currentMember = getMemberForMachine(config.team!, joined.machine);
  const currentRole = currentMember?.role ?? 'none';
  const syncHealth = buildTeamSyncHealth(workspaceRootPath, {
    supported: true,
    storage: config.storage!,
    team: config.team!,
    machine: joined.machine,
    heartbeat,
    ...runnerStatus,
  });
  return {
    supported: true,
    supportedFormatVersion: WORKSPACE_FORMAT_VERSION,
    formatVersion: WORKSPACE_FORMAT_VERSION,
    storage: config.storage!,
    team: config.team!,
    teamConfigPath: getTeamConfigFile(workspaceRootPath),
    privateMachinePath: getPrivateMachineFile(config.id),
    heartbeatPath: getTeamHeartbeatFile(workspaceRootPath, joined.machine.machineId),
    machine: joined.machine,
    heartbeat,
    ...runnerStatus,
    joined: isJoined,
    currentMember,
    currentRole,
    canManageTeam: currentRole === 'owner',
    canEditSharedWork: currentRole === 'owner' || currentRole === 'editor',
    syncHealth,
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
  assertTeamPermission(workspaceRootPath, 'team.runner.assign');
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
  const joined = machine.machineId !== 'not_joined';
  const currentMember = getMemberForMachine(config.team!, machine);
  const currentRole = currentMember?.role ?? 'none';
  const syncHealth = buildTeamSyncHealth(workspaceRootPath, {
    supported: true,
    storage: config.storage ?? defaultSoloStorage(),
    team: config.team!,
    machine,
    heartbeat,
    ...runnerStatus,
  });
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
    joined,
    currentMember,
    currentRole,
    canManageTeam: currentRole === 'owner',
    canEditSharedWork: currentRole === 'owner' || currentRole === 'editor',
    syncHealth,
  };
}
