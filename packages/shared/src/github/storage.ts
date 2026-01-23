/**
 * GitHub Data Persistence
 *
 * Handles storage and retrieval of:
 * - GitHub connection credentials
 * - Daily reports
 * - GitHub connection status
 *
 * Storage location: ~/.vespr/workspaces/{workspaceId}/github/
 */

import { promises as fs, mkdirSync } from 'fs';
import { join } from 'path';
import type {
  DailyReport,
  GitHubConnectionStatus,
} from './types.ts';

/**
 * Get GitHub storage directory for a workspace
 */
export function getGitHubStorageDir(workspaceId: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return join(home, '.vespr', 'workspaces', workspaceId, 'github');
}

/**
 * Get daily reports file path
 */
function getDailyReportsPath(workspaceId: string): string {
  return join(getGitHubStorageDir(workspaceId), 'daily-reports.jsonl');
}

/**
 * Get connection status file path
 */
function getConnectionStatusPath(workspaceId: string): string {
  return join(getGitHubStorageDir(workspaceId), 'status.json');
}

/**
 * Save a daily report
 */
export async function saveDailyReport(
  workspaceId: string,
  report: DailyReport
): Promise<void> {
  const dir = getGitHubStorageDir(workspaceId);
  mkdirSync(dir, { recursive: true });

  const path = getDailyReportsPath(workspaceId);
  const line = JSON.stringify(report) + '\n';

  // Append to JSONL file
  await fs.appendFile(path, line, 'utf-8');
}

/**
 * Get the latest daily report
 */
export async function getLatestDailyReport(
  workspaceId: string
): Promise<DailyReport | null> {
  const path = getDailyReportsPath(workspaceId);

  try {
    const content = await fs.readFile(path, 'utf-8');
    const lines = content.trim().split('\n').filter((l) => l);

    if (lines.length === 0) return null;

    const lastLine = lines[lines.length - 1];
    if (!lastLine) return null;
    return JSON.parse(lastLine) as DailyReport;
  } catch (error) {
    // File doesn't exist yet
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Get all daily reports
 */
export async function getAllDailyReports(
  workspaceId: string
): Promise<DailyReport[]> {
  const path = getDailyReportsPath(workspaceId);

  try {
    const content = await fs.readFile(path, 'utf-8');
    const lines = content.trim().split('\n').filter((l) => l);

    return lines.map((line) => JSON.parse(line) as DailyReport);
  } catch (error) {
    // File doesn't exist yet
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Get daily reports for a date range
 */
export async function getDailyReportsByDateRange(
  workspaceId: string,
  startDate: Date,
  endDate: Date
): Promise<DailyReport[]> {
  const reports = await getAllDailyReports(workspaceId);

  const startTime = startDate.getTime();
  const endTime = endDate.getTime();

  return reports.filter(
    (report) => report.date >= startTime && report.date <= endTime
  );
}

/**
 * Save GitHub connection status
 */
export async function saveConnectionStatus(
  workspaceId: string,
  status: GitHubConnectionStatus
): Promise<void> {
  const dir = getGitHubStorageDir(workspaceId);
  mkdirSync(dir, { recursive: true });

  const path = getConnectionStatusPath(workspaceId);
  await fs.writeFile(path, JSON.stringify(status, null, 2), 'utf-8');
}

/**
 * Get GitHub connection status
 */
export async function getConnectionStatus(
  workspaceId: string
): Promise<GitHubConnectionStatus | null> {
  const path = getConnectionStatusPath(workspaceId);

  try {
    const content = await fs.readFile(path, 'utf-8');
    return JSON.parse(content) as GitHubConnectionStatus;
  } catch (error) {
    // File doesn't exist yet
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Clear all GitHub data for a workspace
 */
export async function clearWorkspaceData(workspaceId: string): Promise<void> {
  const dir = getGitHubStorageDir(workspaceId);

  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Directory might not exist, that's okay
  }
}
