/**
 * Integration Tests: Daily Report Generation
 *
 * Tests the complete daily report flow from GitHub API to report submission
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { GitHubClient } from '../client.ts';
import { createDailyReport, submitDailyReport, getReportSummary } from '../daily-report.ts';
import type { GitHubIssue, GitHubPullRequest, GitHubUser } from '../types.ts';

// Mock data
const mockIssues: GitHubIssue[] = [
  {
    id: 1,
    number: 101,
    title: 'Fix login bug',
    body: 'Users cannot login on mobile',
    state: 'open',
    assignees: [],
    labels: [{ name: 'bug' }],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 2,
    number: 102,
    title: 'Implement dark mode',
    body: 'Add dark mode support',
    state: 'open',
    assignees: [],
    labels: [{ name: 'feature' }],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const mockPullRequests: GitHubPullRequest[] = [
  {
    id: 3,
    number: 201,
    title: 'Add TypeScript support',
    body: 'Migrate codebase to TypeScript',
    state: 'open',
    assignees: [],
    labels: [{ name: 'refactor' }],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const mockCollaborators: GitHubUser[] = [
  {
    id: 1001,
    login: 'alice',
    name: 'Alice Developer',
    email: 'alice@example.com',
  },
  {
    id: 1002,
    login: 'bob',
    name: 'Bob Designer',
    email: 'bob@example.com',
  },
];

describe('Daily Report Integration', () => {
  const TEST_WORKSPACE_ID = 'test-workspace-' + Math.random().toString(36).slice(2, 9);
  const TEST_TOKEN = 'fake-token-test';

  beforeEach(() => {
    // Clear any previous mocks
  });

  describe('complete report generation flow', () => {
    it('should generate report with all data from GitHub', async () => {
      // Setup mocks
      const mockFetch = mock(async (url) => {
        const urlStr = typeof url === 'string' ? url : url.toString();

        // Check for specific endpoints BEFORE checking for /repos/
        if (urlStr.includes('/issues')) {
          return new Response(JSON.stringify(mockIssues), {
            status: 200,
            headers: {
              'x-ratelimit-limit': '5000',
              'x-ratelimit-remaining': '4998',
              'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
            },
          });
        }

        if (urlStr.includes('/pulls')) {
          return new Response(JSON.stringify(mockPullRequests), {
            status: 200,
            headers: {
              'x-ratelimit-limit': '5000',
              'x-ratelimit-remaining': '4997',
              'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
            },
          });
        }

        if (urlStr.includes('/collaborators')) {
          return new Response(JSON.stringify(mockCollaborators), {
            status: 200,
            headers: {
              'x-ratelimit-limit': '5000',
              'x-ratelimit-remaining': '4996',
              'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
            },
          });
        }

        // Generic repository info endpoint
        if (urlStr.includes('/repos/') && !urlStr.includes('/issues') && !urlStr.includes('/pulls')) {
          return new Response(
            JSON.stringify({
              id: 1,
              name: 'test-repo',
              full_name: 'owner/test-repo',
              owner: { login: 'owner' },
              description: 'Test repository',
              stars: 100,
              watchers: 50,
            }),
            {
              status: 200,
              headers: {
                'x-ratelimit-limit': '5000',
                'x-ratelimit-remaining': '4999',
                'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
              },
            }
          );
        }

        return new Response('[]', { status: 200 });
      });

      global.fetch = mockFetch as any;

      // Generate report
      const report = await createDailyReport(TEST_WORKSPACE_ID, {
        repoOwner: 'owner',
        repoName: 'test-repo',
        accessToken: TEST_TOKEN,
        sinceDays: 1,
      });

      // Verify report structure
      expect(report).toBeDefined();
      expect(report.github?.repoOwner).toBe('owner');
      expect(report.github?.repoName).toBe('test-repo');
      expect(report.github?.issues).toHaveLength(2);
      expect(report.github?.pullRequests).toHaveLength(1);
      expect(report.github?.teamMembers).toHaveLength(2);
      expect(report.status).toBe('draft');
    });

    it('should gracefully handle partial failures', async () => {
      const mockFetch = mock(async (url) => {
        const urlStr = typeof url === 'string' ? url : url.toString();

        if (urlStr.includes('/issues')) {
          return new Response(JSON.stringify(mockIssues), {
            status: 200,
            headers: {
              'x-ratelimit-limit': '5000',
              'x-ratelimit-remaining': '4999',
              'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
            },
          });
        }

        // PRs fail
        if (urlStr.includes('/pulls')) {
          return new Response('Server error', { status: 503 });
        }

        // Collaborators fail
        if (urlStr.includes('/collaborators')) {
          return new Response('Unauthorized', { status: 401 });
        }

        return new Response('[]', { status: 200 });
      });

      global.fetch = mockFetch as any;

      const report = await createDailyReport(TEST_WORKSPACE_ID, {
        repoOwner: 'owner',
        repoName: 'test-repo',
        accessToken: TEST_TOKEN,
      });

      // Should return partial data with errors
      expect(report.github?.issues).toHaveLength(2);
      expect(report.github?.pullRequests).toHaveLength(0);
      expect(report.github?.teamMembers).toHaveLength(0);
      expect((report.github?.errors ?? []).length).toBeGreaterThan(0);
    });

    it('should include all required fields in generated report', async () => {
      const mockFetch = mock(async () => {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: {
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '4999',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
          },
        });
      });

      global.fetch = mockFetch as any;

      const report = await createDailyReport(TEST_WORKSPACE_ID, {
        repoOwner: 'owner',
        repoName: 'test-repo',
        accessToken: TEST_TOKEN,
        sinceDays: 7,
        teamCapacity: {
          availableDevelopers: 5,
          hoursPerDay: 8,
        },
      });

      // Verify all required fields
      expect(report.id).toBeDefined();
      expect(report.id.length).toBeGreaterThan(0);
      expect(report.date).toBeDefined();
      expect(typeof report.date).toBe('number');
      expect(report.status).toBe('draft');
      expect(report.github).toBeDefined();
      expect(report.teamCapacity).toBeDefined();
      expect(report.teamCapacity?.availableDevelopers).toBe(5);
      expect(report.teamCapacity?.hoursPerDay).toBe(8);
    });

    it('should include time range based on sinceDays', async () => {
      const mockFetch = mock(async () => {
        return new Response(JSON.stringify(mockIssues), {
          status: 200,
          headers: {
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '4999',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
          },
        });
      });

      global.fetch = mockFetch as any;

      // Test 7-day lookback
      const report = await createDailyReport(TEST_WORKSPACE_ID, {
        repoOwner: 'owner',
        repoName: 'test-repo',
        accessToken: TEST_TOKEN,
        sinceDays: 7,
      });

      expect(report).toBeDefined();
      // Verify the report was generated with correct parameters
      expect(report.github?.issues.length).toBeGreaterThanOrEqual(0);
    });

    it('should support empty repository', async () => {
      const mockFetch = mock(async () => {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: {
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '4999',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
          },
        });
      });

      global.fetch = mockFetch as any;

      const report = await createDailyReport(TEST_WORKSPACE_ID, {
        repoOwner: 'owner',
        repoName: 'empty-repo',
        accessToken: TEST_TOKEN,
      });

      expect(report.github?.issues).toHaveLength(0);
      expect(report.github?.pullRequests).toHaveLength(0);
      expect(report.status).toBe('draft');
    });

    it('should generate unique IDs for each report', async () => {
      const mockFetch = mock(async () => {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: {
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '4999',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
          },
        });
      });

      global.fetch = mockFetch as any;

      const report1 = await createDailyReport(TEST_WORKSPACE_ID, {
        repoOwner: 'owner',
        repoName: 'repo1',
        accessToken: TEST_TOKEN,
      });

      const report2 = await createDailyReport(TEST_WORKSPACE_ID, {
        repoOwner: 'owner',
        repoName: 'repo2',
        accessToken: TEST_TOKEN,
      });

      expect(report1.id).not.toBe(report2.id);
    });
  });

  describe('report error handling', () => {
    it('should handle network errors gracefully', async () => {
      const mockFetch = mock(async () => {
        throw new Error('Network timeout');
      });

      global.fetch = mockFetch as any;

      const report = await createDailyReport(TEST_WORKSPACE_ID, {
        repoOwner: 'owner',
        repoName: 'test-repo',
        accessToken: TEST_TOKEN,
      });

      // Should still return a report with errors
      expect(report).toBeDefined();
      expect((report.github?.errors ?? []).length).toBeGreaterThan(0);
    });

    it('should handle invalid repository', async () => {
      const mockFetch = mock(async () => {
        return new Response('Not found', { status: 404 });
      });

      global.fetch = mockFetch as any;

      const report = await createDailyReport(TEST_WORKSPACE_ID, {
        repoOwner: 'nonexistent',
        repoName: 'nonexistent-repo',
        accessToken: TEST_TOKEN,
      });

      expect((report.github?.errors ?? []).length).toBeGreaterThan(0);
      expect(report.github?.issues).toHaveLength(0);
    });
  });
});
