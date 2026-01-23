/**
 * Tests for GitHub REST API Client
 *
 * Tests caching, rate limiting, and error handling
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { GitHubClient } from '../client.ts';
import type { GitHubIssue, GitHubPullRequest, GitHubUser } from '../types.ts';

// Mock issue
const mockIssue: GitHubIssue = {
  id: 1,
  number: 1,
  title: 'Test Issue',
  body: 'Test body',
  state: 'open',
  assignees: [],
  labels: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// Mock PR
const mockPR: GitHubPullRequest = {
  id: 2,
  number: 1,
  title: 'Test PR',
  body: 'Test body',
  state: 'open',
  assignees: [],
  labels: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// Mock user
const mockUser: GitHubUser = {
  id: 1,
  login: 'testuser',
  name: 'Test User',
  email: 'test@example.com',
};

describe('GitHubClient', () => {
  let client: GitHubClient;

  beforeEach(() => {
    client = new GitHubClient('fake-token');
    // Clear cache before each test
    client.clearCache();
  });

  describe('rate limit tracking', () => {
    it('should initialize without rate limit info', () => {
      expect(client.getRateLimit()).toBeNull();
      expect(client.isNearRateLimit()).toBe(false);
    });
  });

  describe('list issues', () => {
    it('should fetch and cache issues', async () => {
      // Mock fetch
      const mockFetch = mock(async (url) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        expect(urlStr).toContain('/repos/owner/repo/issues');
        return new Response(JSON.stringify([mockIssue]), {
          status: 200,
          headers: {
            'x-ratelimit-limit': '60',
            'x-ratelimit-remaining': '59',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
          },
        });
      });
      global.fetch = mockFetch as any;

      const issues = await client.listIssues('owner', 'repo');
      expect(issues).toHaveLength(1);
      expect(issues[0]).toBeDefined();
      if (issues[0]) {
        expect(issues[0].title).toBe('Test Issue');
      }
    });

    it('should return cached results on subsequent calls', async () => {
      let callCount = 0;
      const mockFetch = mock(async () => {
        callCount++;
        return new Response(JSON.stringify([mockIssue]), {
          status: 200,
          headers: {
            'x-ratelimit-limit': '60',
            'x-ratelimit-remaining': '59',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
          },
        });
      });
      global.fetch = mockFetch as any;

      // First call
      await client.listIssues('owner', 'repo');
      expect(callCount).toBe(1);

      // Second call should use cache
      const second = await client.listIssues('owner', 'repo');
      expect(second).toHaveLength(1);
      expect(callCount).toBe(1);
    });
  });

  describe('error handling', () => {
    it('should handle 404 errors', async () => {
      const mockFetch = mock(async () => {
        return new Response('Not found', { status: 404 });
      });
      global.fetch = mockFetch as any;

      try {
        await client.listIssues('owner', 'nonexistent');
        expect(false).toBe(true); // Should throw
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('not found');
      }
    });

    it('should handle 401 unauthorized', async () => {
      const mockFetch = mock(async () => {
        return new Response('Unauthorized', { status: 401 });
      });
      global.fetch = mockFetch as any;

      try {
        await client.listIssues('owner', 'repo');
        expect(false).toBe(true); // Should throw
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('authentication');
      }
    });
  });

  describe('recent activity', () => {
    it('should fetch issues and PRs in parallel', async () => {
      const mockFetch = mock(async (url) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/issues')) {
          return new Response(JSON.stringify([mockIssue]), {
            status: 200,
            headers: {
              'x-ratelimit-limit': '60',
              'x-ratelimit-remaining': '59',
              'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
            },
          });
        }
        if (urlStr.includes('/pulls')) {
          return new Response(JSON.stringify([mockPR]), {
            status: 200,
            headers: {
              'x-ratelimit-limit': '60',
              'x-ratelimit-remaining': '59',
              'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
            },
          });
        }
        if (urlStr.includes('/collaborators')) {
          return new Response(JSON.stringify([mockUser]), {
            status: 200,
            headers: {
              'x-ratelimit-limit': '60',
              'x-ratelimit-remaining': '59',
              'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
            },
          });
        }
        return new Response('[]', { status: 200 });
      });
      global.fetch = mockFetch as any;

      const activity = await client.fetchRecentActivity('owner', 'repo');

      expect(activity.issues).toHaveLength(1);
      expect(activity.pullRequests).toHaveLength(1);
      expect(activity.teamMembers).toHaveLength(1);
      expect(activity.errors).toHaveLength(0);
    });

    it('should gracefully handle errors in fetchRecentActivity', async () => {
      const mockFetch = mock(async (url) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/issues')) {
          return new Response('[]', { status: 200 });
        }
        if (urlStr.includes('/pulls')) {
          return new Response('Server error', { status: 500 });
        }
        return new Response('[]', { status: 200 });
      });
      global.fetch = mockFetch as any;

      const activity = await client.fetchRecentActivity('owner', 'repo');

      expect(activity.issues).toHaveLength(0);
      expect(activity.pullRequests).toHaveLength(0);
      expect(activity.errors.length).toBeGreaterThan(0);
    });
  });
});
