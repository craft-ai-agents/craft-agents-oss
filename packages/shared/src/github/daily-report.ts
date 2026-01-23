/**
 * Daily Report Service
 *
 * Orchestrates GitHub data collection into daily reports
 */

import { v4 as uuid } from 'uuid';
import { GitHubClient } from './client.ts';
import {
  saveDailyReport,
  getLatestDailyReport,
  getConnectionStatus,
} from './storage.ts';
import type { DailyReport, GitHubConnectionStatus } from './types.ts';

/**
 * Options for creating a daily report
 */
export interface CreateDailyReportOptions {
  /** GitHub repository owner */
  repoOwner: string;
  /** GitHub repository name */
  repoName: string;
  /** Access token for GitHub API */
  accessToken: string;
  /** Number of days to look back */
  sinceDays?: number;
  /** Team capacity info */
  teamCapacity?: {
    availableDevelopers: number;
    hoursPerDay: number;
  };
}

/**
 * Create a new daily report from current GitHub activity
 */
export async function createDailyReport(
  workspaceId: string,
  options: CreateDailyReportOptions
): Promise<DailyReport> {
  const client = new GitHubClient(options.accessToken);

  // Fetch recent activity
  const activity = await client.fetchRecentActivity(
    options.repoOwner,
    options.repoName,
    { sinceDays: options.sinceDays || 1 }
  );

  // Create report
  const report: DailyReport = {
    id: uuid(),
    workspaceId,
    date: Date.now(),
    github: {
      repoOwner: options.repoOwner,
      repoName: options.repoName,
      issues: activity.issues,
      pullRequests: activity.pullRequests,
      teamMembers: activity.teamMembers,
      errors: activity.errors,
    },
    teamCapacity: options.teamCapacity,
    status: 'draft',
    createdAt: Date.now(),
  };

  return report;
}

/**
 * Submit a daily report (make it immutable)
 */
export async function submitDailyReport(
  workspaceId: string,
  report: DailyReport
): Promise<DailyReport> {
  const submitted: DailyReport = {
    ...report,
    status: 'submitted',
    submittedAt: Date.now(),
  };

  await saveDailyReport(workspaceId, submitted);

  return submitted;
}

/**
 * Fetch latest report status
 */
export async function getReportStatus(
  workspaceId: string
): Promise<{ isConnected: boolean; latestReport: DailyReport | null }> {
  const [status, latestReport] = await Promise.all([
    getConnectionStatus(workspaceId),
    getLatestDailyReport(workspaceId),
  ]);

  return {
    isConnected: status?.isConnected ?? false,
    latestReport,
  };
}

/**
 * Get summary stats for today's report
 */
export async function getReportSummary(
  report: DailyReport
): Promise<{
  issueCount: number;
  prCount: number;
  teamMemberCount: number;
  hasErrors: boolean;
}> {
  return {
    issueCount: report.github?.issues.length ?? 0,
    prCount: report.github?.pullRequests.length ?? 0,
    teamMemberCount: report.github?.teamMembers.length ?? 0,
    hasErrors: (report.github?.errors?.length ?? 0) > 0,
  };
}
