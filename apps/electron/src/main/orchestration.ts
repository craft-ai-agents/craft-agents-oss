/**
 * Orchestration Service
 *
 * Manages daily report collection, triage, and orchestration planning.
 * Follows the same pattern as the Scheduler service.
 *
 * Features:
 * - Daily report submission from GitHub
 * - Triage scoring with Claude API
 * - Assignment recommendations
 * - GitHub sync
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { BrowserWindow } from 'electron';
import { mainLog } from './logger';
import type { WindowManager } from './window-manager';
import {
  saveDailyReport,
  getLatestDailyReport,
  getConnectionStatus,
  saveConnectionStatus,
  createDailyReport,
  submitDailyReport,
  type DailyReport,
  type GitHubConnectionStatus,
} from '@vespr/shared/github';
import { IPC_CHANNELS } from '../shared/types';

/**
 * OrchestrationService manages daily reports and GitHub integration for a workspace.
 */
export class OrchestrationService {
  private workspaceId: string;
  private workspacePath: string;
  private windowManager: WindowManager | null = null;
  private connectionStatus: GitHubConnectionStatus | null = null;

  constructor(workspaceId: string, workspacePath: string) {
    this.workspaceId = workspaceId;
    this.workspacePath = workspacePath;
  }

  /**
   * Set window manager for notifications
   */
  setWindowManager(wm: WindowManager): void {
    this.windowManager = wm;
  }

  /**
   * Initialize the orchestration service
   */
  async initialize(): Promise<void> {
    try {
      // Load connection status
      this.connectionStatus =
        (await getConnectionStatus(this.workspaceId)) || null;
      mainLog.info(
        `Orchestration initialized for workspace ${this.workspaceId}`
      );
    } catch (error) {
      mainLog.error('Failed to initialize orchestration:', error);
    }
  }

  /**
   * Get current connection status
   */
  async getStatus(): Promise<GitHubConnectionStatus | null> {
    return this.connectionStatus;
  }

  /**
   * Set connection status and save it
   */
  async setConnectionStatus(
    status: GitHubConnectionStatus
  ): Promise<GitHubConnectionStatus> {
    this.connectionStatus = status;
    await saveConnectionStatus(this.workspaceId, status);

    // Broadcast update to renderer
    this.broadcastEvent({
      type: 'connection-status-updated',
      status,
    });

    return status;
  }

  /**
   * Create a new daily report from GitHub activity
   */
  async createReport(options: {
    repoOwner: string;
    repoName: string;
    accessToken: string;
    sinceDays?: number;
  }): Promise<DailyReport> {
    const report = await createDailyReport(this.workspaceId, {
      repoOwner: options.repoOwner,
      repoName: options.repoName,
      accessToken: options.accessToken,
      sinceDays: options.sinceDays,
    });

    // Broadcast event
    this.broadcastEvent({
      type: 'report-created',
      report,
    });

    return report;
  }

  /**
   * Submit a daily report (make it immutable and ready for triage)
   */
  async submitReport(report: DailyReport): Promise<DailyReport> {
    const submitted = await submitDailyReport(this.workspaceId, report);

    // Broadcast event
    this.broadcastEvent({
      type: 'report-submitted',
      report: submitted,
    });

    return submitted;
  }

  /**
   * Get the latest daily report
   */
  async getLatestReport(): Promise<DailyReport | null> {
    return getLatestDailyReport(this.workspaceId);
  }

  /**
   * Broadcast orchestration event to all windows
   */
  private broadcastEvent(event: {
    type: string;
    [key: string]: unknown;
  }): void {
    if (!this.windowManager) return;

    const windows = this.windowManager.getAllWindows();
    for (const win of windows) {
      if (
        win.window &&
        !win.window.isDestroyed() &&
        win.workspaceId === this.workspaceId
      ) {
        win.window.webContents.send(IPC_CHANNELS.ORCHESTRATION_EVENT, event);
      }
    }
  }
}

/**
 * Global orchestration services indexed by workspace ID
 */
const orchestrationServices = new Map<string, OrchestrationService>();

/**
 * Get or create orchestration service for a workspace
 */
export function getOrchestrationService(
  workspaceId: string,
  workspacePath: string
): OrchestrationService {
  if (!orchestrationServices.has(workspaceId)) {
    const service = new OrchestrationService(workspaceId, workspacePath);
    orchestrationServices.set(workspaceId, service);
    service.initialize().catch(error => {
      mainLog.error('Failed to initialize orchestration service:', error);
    });
  }
  return orchestrationServices.get(workspaceId)!;
}

/**
 * Initialize orchestration services for all workspaces
 */
export async function initializeAllOrchestrations(
  workspaces: Array<{ id: string; rootPath: string }>
): Promise<void> {
  for (const workspace of workspaces) {
    const service = getOrchestrationService(workspace.id, workspace.rootPath);
    await service.initialize();
  }
}

/**
 * Cleanup orchestration service for a workspace
 */
export function cleanupOrchestrationService(workspaceId: string): void {
  orchestrationServices.delete(workspaceId);
}
