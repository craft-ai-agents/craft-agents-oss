/**
 * GitHub REST API Client
 *
 * Provides a type-safe wrapper around GitHub's REST API with:
 * - Automatic rate limit handling
 * - Response caching (1 hour TTL)
 * - Batch operations for efficiency
 * - Graceful error handling
 */

import type {
  GitHubIssue,
  GitHubPullRequest,
  GitHubUser,
  GitHubActivityResponse,
  GitHubError,
  GitHubRepository,
} from './types.ts';

/**
 * Cache entry with TTL
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Rate limit info from GitHub
 */
interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
}

/**
 * GitHub REST API Client
 */
export class GitHubClient {
  private accessToken: string;
  private cache = new Map<string, CacheEntry<unknown>>();
  private cacheTTL = 3600000; // 1 hour
  private rateLimitInfo: RateLimitInfo | null = null;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  /**
   * Check if cache entry is still valid
   */
  private isCacheValid<T>(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.timestamp < this.cacheTTL;
  }

  /**
   * Get cached value if valid
   */
  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (entry && this.isCacheValid(entry)) {
      return entry.data;
    }
    this.cache.delete(key);
    return null;
  }

  /**
   * Set cache value
   */
  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Make authenticated GitHub API request
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `https://api.github.com${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/vnd.github.v3+json',
        ...options.headers,
      },
    });

    // Update rate limit info from response headers
    const limit = response.headers.get('x-ratelimit-limit');
    const remaining = response.headers.get('x-ratelimit-remaining');
    const reset = response.headers.get('x-ratelimit-reset');

    if (limit && remaining && reset) {
      this.rateLimitInfo = {
        limit: parseInt(limit, 10),
        remaining: parseInt(remaining, 10),
        reset: parseInt(reset, 10) * 1000,
      };
    }

    if (!response.ok) {
      if (response.status === 403 && remaining === '0') {
        throw new Error('GitHub API rate limit exceeded');
      }
      if (response.status === 401) {
        throw new Error('GitHub authentication failed');
      }
      if (response.status === 404) {
        throw new Error(`GitHub resource not found: ${endpoint}`);
      }
      const text = await response.text();
      throw new Error(`GitHub API error: ${response.status} ${text}`);
    }

    return (await response.json()) as T;
  }

  /**
   * Get current rate limit info
   */
  getRateLimit(): RateLimitInfo | null {
    return this.rateLimitInfo;
  }

  /**
   * Check if we're near rate limit (less than 10 requests remaining)
   */
  isNearRateLimit(): boolean {
    return this.rateLimitInfo ? this.rateLimitInfo.remaining < 10 : false;
  }

  /**
   * List issues for a repository
   */
  async listIssues(
    owner: string,
    repo: string,
    options: { state?: 'open' | 'closed' | 'all'; since?: string } = {}
  ): Promise<GitHubIssue[]> {
    const cacheKey = `issues:${owner}:${repo}:${JSON.stringify(options)}`;
    const cached = this.getFromCache<GitHubIssue[]>(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams({
      state: options.state || 'open',
      per_page: '100',
    });
    if (options.since) {
      params.append('since', options.since);
    }

    const issues = await this.request<GitHubIssue[]>(
      `/repos/${owner}/${repo}/issues?${params}`
    );

    this.setCache(cacheKey, issues);
    return issues;
  }

  /**
   * List pull requests for a repository
   */
  async listPullRequests(
    owner: string,
    repo: string,
    options: {
      state?: 'open' | 'closed' | 'all';
      since?: string;
    } = {}
  ): Promise<GitHubPullRequest[]> {
    const cacheKey = `prs:${owner}:${repo}:${JSON.stringify(options)}`;
    const cached = this.getFromCache<GitHubPullRequest[]>(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams({
      state: options.state || 'open',
      per_page: '100',
    });
    if (options.since) {
      params.append('since', options.since);
    }

    const prs = await this.request<GitHubPullRequest[]>(
      `/repos/${owner}/${repo}/pulls?${params}`
    );

    this.setCache(cacheKey, prs);
    return prs;
  }

  /**
   * Get repository details
   */
  async getRepository(owner: string, repo: string): Promise<GitHubRepository> {
    const cacheKey = `repo:${owner}:${repo}`;
    const cached = this.getFromCache<GitHubRepository>(cacheKey);
    if (cached) return cached;

    const repository = await this.request<GitHubRepository>(
      `/repos/${owner}/${repo}`
    );

    this.setCache(cacheKey, repository);
    return repository;
  }

  /**
   * List repository collaborators
   */
  async listCollaborators(
    owner: string,
    repo: string
  ): Promise<GitHubUser[]> {
    const cacheKey = `collaborators:${owner}:${repo}`;
    const cached = this.getFromCache<GitHubUser[]>(cacheKey);
    if (cached) return cached;

    const users = await this.request<GitHubUser[]>(
      `/repos/${owner}/${repo}/collaborators?per_page=100&affiliation=all`
    );

    this.setCache(cacheKey, users);
    return users;
  }

  /**
   * Get authenticated user
   */
  async getAuthenticatedUser(): Promise<GitHubUser> {
    const cacheKey = 'user:authenticated';
    const cached = this.getFromCache<GitHubUser>(cacheKey);
    if (cached) return cached;

    const user = await this.request<GitHubUser>('/user');

    this.setCache(cacheKey, user);
    return user;
  }

  /**
   * Fetch recent activity for a repository
   * Returns issues and PRs created/updated in the last N days
   */
  async fetchRecentActivity(
    owner: string,
    repo: string,
    options: {
      sinceDays?: number;
    } = {}
  ): Promise<GitHubActivityResponse> {
    const errors: GitHubError[] = [];
    const sinceDays = options.sinceDays || 1;

    // Calculate since date
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - sinceDays);
    const sinceIso = sinceDate.toISOString();

    try {
      // Fetch in parallel
      const [issues, pullRequests, collaborators] = await Promise.all([
        this.listIssues(owner, repo, { state: 'all', since: sinceIso }).catch(
          (error) => {
            errors.push({
              type: 'network',
              message: error instanceof Error ? error.message : 'Unknown error',
              timestamp: Date.now(),
            });
            return [];
          }
        ),
        this.listPullRequests(owner, repo, {
          state: 'all',
          since: sinceIso,
        }).catch((error) => {
          errors.push({
            type: 'network',
            message: error instanceof Error ? error.message : 'Unknown error',
            timestamp: Date.now(),
          });
          return [];
        }),
        this.listCollaborators(owner, repo).catch((error) => {
          errors.push({
            type: 'network',
            message: error instanceof Error ? error.message : 'Unknown error',
            timestamp: Date.now(),
          });
          return [];
        }),
      ]);

      return {
        issues,
        pullRequests,
        teamMembers: collaborators,
        errors,
      };
    } catch (error) {
      errors.push({
        type: 'unknown',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      });

      return {
        issues: [],
        pullRequests: [],
        teamMembers: [],
        errors,
      };
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
