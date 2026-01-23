/**
 * GitHub REST API Client
 *
 * Provides a type-safe wrapper around GitHub's REST API with:
 * - Automatic rate limit handling
 * - Response caching (1 hour TTL)
 * - Batch operations for efficiency
 * - Graceful error handling
 * - Exponential backoff retry with jitter
 * - Transient error detection
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
 * Retry configuration
 */
interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

/**
 * Error classification for retry logic
 */
type ErrorType = 'transient' | 'rateLimit' | 'auth' | 'notFound' | 'permanent' | 'network';

/**
 * GitHub REST API Client
 */
export class GitHubClient {
  private accessToken: string;
  private cache = new Map<string, CacheEntry<unknown>>();
  private cacheTTL = 3600000; // 1 hour
  private rateLimitInfo: RateLimitInfo | null = null;
  private retryConfig: RetryConfig = {
    maxAttempts: 3,
    initialDelayMs: 500,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
  };
  private requestTimeoutMs = 30000; // 30 second timeout

  constructor(accessToken: string, config?: { timeout?: number; retry?: Partial<RetryConfig> }) {
    this.accessToken = accessToken;
    if (config?.timeout) {
      this.requestTimeoutMs = config.timeout;
    }
    if (config?.retry) {
      this.retryConfig = { ...this.retryConfig, ...config.retry };
    }
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
   * Classify error type for retry logic
   */
  private classifyError(status: number, message: string): ErrorType {
    if (status === 429) return 'rateLimit';
    if (status === 401 || status === 403) return 'auth';
    if (status === 404) return 'notFound';
    if (status >= 500 || status === 408) return 'transient';
    if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND') || message.includes('timeout')) {
      return 'network';
    }
    return 'permanent';
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryable(errorType: ErrorType, attempt: number): boolean {
    switch (errorType) {
      case 'transient':
      case 'network':
        return attempt < this.retryConfig.maxAttempts;
      case 'rateLimit':
        // Retry once for rate limit, but indicate we should back off
        return attempt < 1;
      case 'auth':
      case 'notFound':
      case 'permanent':
        return false;
    }
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private calculateBackoffDelay(attempt: number): number {
    const exponentialDelay = Math.min(
      this.retryConfig.initialDelayMs * Math.pow(this.retryConfig.backoffMultiplier, attempt),
      this.retryConfig.maxDelayMs
    );
    // Add jitter (±25%)
    const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
    return Math.max(0, exponentialDelay + jitter);
  }

  /**
   * Retry a function with exponential backoff
   */
  private async retry<T>(fn: () => Promise<T>, context: string = 'API request'): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.retryConfig.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const errorMessage = lastError.message;
        const status = this.extractStatusFromError(errorMessage);
        const errorType = this.classifyError(status, errorMessage);

        if (!this.isRetryable(errorType, attempt)) {
          throw error;
        }

        const delayMs = this.calculateBackoffDelay(attempt);
        console.debug(
          `[GitHub] ${context} failed (${errorMessage}), retrying in ${delayMs}ms (attempt ${attempt + 1}/${this.retryConfig.maxAttempts})`
        );

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError || new Error(`${context} failed after ${this.retryConfig.maxAttempts} attempts`);
  }

  /**
   * Extract HTTP status from error message
   */
  private extractStatusFromError(message: string): number {
    const match = message.match(/(\d{3})/);
    return match && match[1] ? parseInt(match[1], 10) : 0;
  }

  /**
   * Make authenticated GitHub API request with retry and timeout
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    return this.retry(async () => {
      const url = `https://api.github.com${endpoint}`;
      const controller = new AbortController();
      const timeoutId: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), this.requestTimeoutMs);

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
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
          if (response.status === 429 && remaining === '0') {
            throw new Error(`GitHub API 429 rate limit exceeded (reset at ${new Date(this.rateLimitInfo?.reset || 0).toISOString()})`);
          }
          if (response.status === 401) {
            throw new Error('GitHub API 401 authentication failed - token may be invalid or revoked');
          }
          if (response.status === 404) {
            throw new Error(`GitHub API 404 resource not found: ${endpoint}`);
          }
          if (response.status >= 500) {
            throw new Error(`GitHub API 500 server error: ${response.status} - retrying...`);
          }
          const text = await response.text();
          throw new Error(`GitHub API ${response.status} error: ${text}`);
        }

        return (await response.json()) as T;
      } catch (error) {
        if (error instanceof TypeError && error.message.includes('aborted')) {
          throw new Error(`GitHub API request timeout after ${this.requestTimeoutMs}ms`);
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    }, `${options.method || 'GET'} ${endpoint}`);
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
   * Set retry configuration
   */
  setRetryConfig(config: Partial<RetryConfig>): void {
    this.retryConfig = { ...this.retryConfig, ...config };
  }

  /**
   * Set request timeout
   */
  setRequestTimeout(timeoutMs: number): void {
    this.requestTimeoutMs = timeoutMs;
  }

  /**
   * Get current retry configuration
   */
  getRetryConfig(): RetryConfig {
    return { ...this.retryConfig };
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
