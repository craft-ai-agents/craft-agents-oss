/**
 * Scheduler Types
 *
 * Types for the scheduled jobs (cron) system.
 * Jobs run in the Electron main process while the app is open.
 */

/** How the job targets sessions */
export type JobAction =
  | { type: 'new-session'; skillSlug?: string; prompt?: string }
  | { type: 'batch'; skillSlug: string; filter: JobFilter }

/** Filter for batch jobs (which sessions to target) */
export interface JobFilter {
  /** 'today' = sessions with activity today, 'active' = all non-archived, 'labeled' = by label */
  scope: 'today' | 'active' | 'labeled';
  /** Required when scope='labeled' */
  labels?: string[];
}

export interface ScheduledJob {
  id: string;
  name: string;
  enabled: boolean;
  workspaceId: string;
  // Cron-like schedule: "HH:MM", "weekdays HH:MM", "weekends HH:MM", "*/Xh", or standard 5-field cron
  schedule: string;
  action: JobAction;
  /** Permission mode for created sessions */
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  /** Model override */
  model?: string;
  /** Source slugs to activate on created sessions (MCP servers, APIs, etc.) */
  enabledSourceSlugs?: string[];
  /** Working directory override for created sessions */
  workingDirectory?: string;
  /** Skill slugs to activate via skillSlugs option (proper skill activation) */
  enabledSkillSlugs?: string[];
  /** Run on next app launch if missed (within graceWindowMinutes) */
  runOnLaunchIfMissed?: boolean;
  graceWindowMinutes?: number;
  /** Notification when complete (default: true) */
  notifyOnComplete?: boolean;
  /** Timestamp tracking */
  lastRunAt?: number;
  lastRunStatus?: 'success' | 'error';
  createdAt: number;
  updatedAt: number;
}

export interface JobExecution {
  jobId: string;
  sessionId: string;
  startedAt: number;
  completedAt?: number;
  status: 'running' | 'success' | 'error';
  error?: string;
}

/** Input for creating a new scheduled job (id/timestamps auto-generated) */
export interface CreateScheduledJobInput {
  name: string;
  schedule: string;
  action: JobAction;
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  model?: string;
  enabledSourceSlugs?: string[];
  workingDirectory?: string;
  enabledSkillSlugs?: string[];
  runOnLaunchIfMissed?: boolean;
  graceWindowMinutes?: number;
  notifyOnComplete?: boolean;
}

/** Input for updating an existing scheduled job */
export interface UpdateScheduledJobInput {
  name?: string;
  enabled?: boolean;
  schedule?: string;
  action?: JobAction;
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  model?: string;
  enabledSourceSlugs?: string[];
  workingDirectory?: string;
  enabledSkillSlugs?: string[];
  runOnLaunchIfMissed?: boolean;
  graceWindowMinutes?: number;
  notifyOnComplete?: boolean;
}
