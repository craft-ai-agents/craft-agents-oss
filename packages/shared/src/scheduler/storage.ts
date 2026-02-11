/**
 * Scheduler Storage
 *
 * Filesystem-based storage for workspace scheduled jobs.
 * Jobs are stored at {workspaceRootPath}/scheduler.json
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { ScheduledJob, CreateScheduledJobInput, UpdateScheduledJobInput } from './types.ts';
import { readJsonFileSync } from '../utils/files.ts';
import { debug } from '../utils/debug.ts';

const SCHEDULER_FILE = 'scheduler.json';

interface SchedulerData {
  jobs: ScheduledJob[];
}

/**
 * Get the path to the scheduler config file for a workspace.
 */
export function getSchedulerPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, SCHEDULER_FILE);
}

/**
 * Load all scheduled jobs for a workspace.
 * Returns empty array if no config file exists.
 */
export function loadScheduledJobs(workspaceRootPath: string): ScheduledJob[] {
  const configPath = getSchedulerPath(workspaceRootPath);

  if (!existsSync(configPath)) {
    return [];
  }

  try {
    const data = readJsonFileSync<SchedulerData>(configPath);
    return data.jobs ?? [];
  } catch (error) {
    debug('[scheduler] Failed to load jobs:', error);
    return [];
  }
}

/**
 * Save all scheduled jobs for a workspace (atomic write).
 */
export function saveScheduledJobs(workspaceRootPath: string, jobs: ScheduledJob[]): void {
  const configPath = getSchedulerPath(workspaceRootPath);
  const data: SchedulerData = { jobs };

  try {
    writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    debug('[scheduler] Failed to save jobs:', error);
    throw error;
  }
}

/**
 * Create a new scheduled job in a workspace.
 * Returns the created job with generated id and timestamps.
 */
export function createScheduledJob(
  workspaceRootPath: string,
  workspaceId: string,
  input: CreateScheduledJobInput
): ScheduledJob {
  const jobs = loadScheduledJobs(workspaceRootPath);
  const now = Date.now();

  const job: ScheduledJob = {
    id: randomUUID(),
    name: input.name,
    enabled: true,
    workspaceId,
    schedule: input.schedule,
    action: input.action,
    permissionMode: input.permissionMode,
    model: input.model,
    enabledSourceSlugs: input.enabledSourceSlugs,
    workingDirectory: input.workingDirectory,
    enabledSkillSlugs: input.enabledSkillSlugs,
    runOnLaunchIfMissed: input.runOnLaunchIfMissed ?? false,
    graceWindowMinutes: input.graceWindowMinutes ?? 120,
    notifyOnComplete: input.notifyOnComplete ?? true,
    createdAt: now,
    updatedAt: now,
  };

  jobs.push(job);
  saveScheduledJobs(workspaceRootPath, jobs);
  return job;
}

/**
 * Update an existing scheduled job.
 */
export function updateScheduledJob(
  workspaceRootPath: string,
  jobId: string,
  updates: UpdateScheduledJobInput
): ScheduledJob | null {
  const jobs = loadScheduledJobs(workspaceRootPath);
  const index = jobs.findIndex(j => j.id === jobId);
  if (index === -1) return null;

  const existing = jobs[index]!;
  const updated: ScheduledJob = {
    ...existing,
    ...updates,
    id: existing.id,
    workspaceId: existing.workspaceId,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };
  jobs[index] = updated;
  saveScheduledJobs(workspaceRootPath, jobs);
  return updated;
}

/**
 * Delete a scheduled job.
 */
export function deleteScheduledJob(workspaceRootPath: string, jobId: string): boolean {
  const jobs = loadScheduledJobs(workspaceRootPath);
  const filtered = jobs.filter(j => j.id !== jobId);
  if (filtered.length === jobs.length) return false;

  saveScheduledJobs(workspaceRootPath, filtered);
  return true;
}

/**
 * Update the last run status and timestamp of a job.
 */
export function updateJobRunStatus(
  workspaceRootPath: string,
  jobId: string,
  status: 'success' | 'error'
): void {
  const jobs = loadScheduledJobs(workspaceRootPath);
  const job = jobs.find(j => j.id === jobId);
  if (!job) return;

  job.lastRunAt = Date.now();
  job.lastRunStatus = status;
  job.updatedAt = Date.now();
  saveScheduledJobs(workspaceRootPath, jobs);
}
