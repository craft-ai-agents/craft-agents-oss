/**
 * Tests for GitHub Data Storage
 *
 * Tests persistence layer for daily reports and connection status
 */

import { describe, it, expect, afterEach, beforeEach } from 'bun:test';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  saveDailyReport,
  getLatestDailyReport,
  getAllDailyReports,
  getDailyReportsByDateRange,
  saveConnectionStatus,
  getConnectionStatus,
} from '../storage.ts';
import type { DailyReport, GitHubConnectionStatus } from '../types.ts';

// Helper to create mock report
function createMockReport(
  testWorkspaceId: string,
  overrides?: Partial<DailyReport>
): DailyReport {
  return {
    id: 'test-id',
    workspaceId: testWorkspaceId,
    date: Date.now(),
    github: {
      repoOwner: 'owner',
      repoName: 'repo',
      issues: [],
      pullRequests: [],
      teamMembers: [],
    },
    status: 'draft',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('GitHub Storage', () => {
  const getUniqueWorkspaceId = () => 'test-workspace-' + Math.random();

  describe('saveDailyReport', () => {
    it('should save a daily report', async () => {
      const wsId = getUniqueWorkspaceId();
      const report = createMockReport(wsId);
      await saveDailyReport(wsId, report);

      const latest = await getLatestDailyReport(wsId);
      expect(latest).not.toBeNull();
      if (latest) expect(latest.id).toBe(report.id);

      // Cleanup
      await fs.rm(join(tmpdir(), '.vespr', 'workspaces', wsId), {
        recursive: true,
        force: true,
      });
    });

    it('should append multiple reports to JSONL', async () => {
      const wsId = getUniqueWorkspaceId();
      const report1 = createMockReport(wsId, { id: 'id-1' });
      const report2 = createMockReport(wsId, { id: 'id-2' });

      await saveDailyReport(wsId, report1);
      await saveDailyReport(wsId, report2);

      const all = await getAllDailyReports(wsId);
      expect(all).toHaveLength(2);
      expect(all[0]).toBeDefined();
      expect(all[1]).toBeDefined();
      if (all[0]) expect(all[0].id).toBe('id-1');
      if (all[1]) expect(all[1].id).toBe('id-2');

      // Cleanup
      await fs.rm(join(tmpdir(), '.vespr', 'workspaces', wsId), {
        recursive: true,
        force: true,
      });
    });
  });

  describe('getLatestDailyReport', () => {
    it('should return null if no reports exist', async () => {
      const wsId = getUniqueWorkspaceId();
      const latest = await getLatestDailyReport(wsId);
      expect(latest).toBeNull();
    });

    it('should return the latest report', async () => {
      const wsId = getUniqueWorkspaceId();
      const oldDate = Date.now() - 86400000; // 1 day ago
      const newDate = Date.now();

      const report1 = createMockReport(wsId, { id: 'id-1', date: oldDate });
      const report2 = createMockReport(wsId, { id: 'id-2', date: newDate });

      await saveDailyReport(wsId, report1);
      await saveDailyReport(wsId, report2);

      const latest = await getLatestDailyReport(wsId);
      expect(latest).not.toBeNull();
      if (latest) {
        expect(latest.id).toBe('id-2');
      }

      // Cleanup
      await fs.rm(join(tmpdir(), '.vespr', 'workspaces', wsId), {
        recursive: true,
        force: true,
      });
    });
  });

  describe('getAllDailyReports', () => {
    it('should return empty array if no reports exist', async () => {
      const wsId = getUniqueWorkspaceId();
      const reports = await getAllDailyReports(wsId);
      expect(reports).toHaveLength(0);
    });

    it('should return all reports in order', async () => {
      const wsId = getUniqueWorkspaceId();
      for (let i = 0; i < 3; i++) {
        await saveDailyReport(wsId, createMockReport(wsId, { id: `id-${i}` }));
      }

      const reports = await getAllDailyReports(wsId);
      expect(reports).toHaveLength(3);

      // Cleanup
      await fs.rm(join(tmpdir(), '.vespr', 'workspaces', wsId), {
        recursive: true,
        force: true,
      });
    });
  });

  describe('getDailyReportsByDateRange', () => {
    it('should filter reports by date range', async () => {
      const wsId = getUniqueWorkspaceId();
      const now = Date.now();
      const dayInMs = 86400000;

      // Create reports on different days
      await saveDailyReport(wsId, createMockReport(wsId, { id: 'id-1', date: now - 2 * dayInMs }));
      await saveDailyReport(wsId, createMockReport(wsId, { id: 'id-2', date: now - dayInMs }));
      await saveDailyReport(wsId, createMockReport(wsId, { id: 'id-3', date: now }));

      // Query last 1.5 days
      const startDate = new Date(now - dayInMs - (dayInMs / 2));
      const endDate = new Date(now);

      const reports = await getDailyReportsByDateRange(wsId, startDate, endDate);
      expect(reports.length).toBeGreaterThanOrEqual(1); // Should get at least reports from the range

      // Cleanup
      await fs.rm(join(tmpdir(), '.vespr', 'workspaces', wsId), {
        recursive: true,
        force: true,
      });
    });
  });

  describe('Connection Status', () => {
    it('should save and retrieve connection status', async () => {
      const wsId = getUniqueWorkspaceId();
      const status: GitHubConnectionStatus = {
        isConnected: true,
        login: 'testuser',
        email: 'test@example.com',
        connectedAt: Date.now(),
      };

      await saveConnectionStatus(wsId, status);

      const retrieved = await getConnectionStatus(wsId);
      expect(retrieved).not.toBeNull();
      if (retrieved) {
        expect(retrieved.isConnected).toBe(true);
        expect(retrieved.login).toBe('testuser');
      }

      // Cleanup
      await fs.rm(join(tmpdir(), '.vespr', 'workspaces', wsId), {
        recursive: true,
        force: true,
      });
    });

    it('should return null if no status exists', async () => {
      const wsId = getUniqueWorkspaceId();
      const status = await getConnectionStatus(wsId);
      expect(status).toBeNull();
    });
  });
});
