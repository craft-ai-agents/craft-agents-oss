/**
 * GitHub Data Types
 *
 * Core data models for GitHub issues, pull requests, and team members
 */

/**
 * GitHub Issue from REST API
 */
export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  assignees: GitHubUser[];
  labels: { name: string }[];
  created_at: string;
  updated_at: string;
  closed_at?: string;
  reactions?: {
    '+1': number;
    '-1': number;
    laugh: number;
    hooray: number;
    confused: number;
    heart: number;
    eyes: number;
    rocket: number;
  };
  comments?: number;
  html_url?: string;
  repository_url?: string;
}

/**
 * GitHub Pull Request
 */
export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  draft?: boolean;
  assignees: GitHubUser[];
  labels: { name: string }[];
  created_at: string;
  updated_at: string;
  closed_at?: string;
  merged_at?: string;
  review_comments?: number;
  comments?: number;
  commits?: number;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  html_url?: string;
  repository_url?: string;
}

/**
 * GitHub User
 */
export interface GitHubUser {
  id: number;
  login: string;
  name?: string;
  email?: string;
  avatar_url?: string;
  bio?: string;
  company?: string;
  location?: string;
  html_url?: string;
}

/**
 * GitHub Repository
 */
export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  owner: GitHubUser;
  private: boolean;
  description?: string;
  fork: boolean;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  homepage?: string;
  size: number;
  stargazers_count: number;
  watchers_count: number;
  language?: string;
  forks_count: number;
  open_issues_count: number;
  default_branch: string;
  html_url: string;
}

/**
 * Daily Report - aggregates GitHub activity for a day
 */
export interface DailyReport {
  id: string;
  workspaceId: string;
  date: number; // timestamp
  github?: {
    repoOwner: string;
    repoName: string;
    issues: GitHubIssue[];
    pullRequests: GitHubPullRequest[];
    teamMembers: GitHubUser[];
    errors?: GitHubError[];
  };
  teamCapacity?: {
    availableDevelopers: number;
    hoursPerDay: number;
  };
  status: 'draft' | 'submitted' | 'triaged';
  createdAt: number;
  submittedAt?: number;
}

/**
 * GitHub Error during fetch
 */
export interface GitHubError {
  type: 'rate_limit' | 'auth' | 'not_found' | 'network' | 'unknown';
  message: string;
  timestamp: number;
}

/**
 * GitHub OAuth result
 */
export interface GitHubOAuthResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  login?: string;
  email?: string;
  error?: string;
}

/**
 * GitHub connection status
 */
export interface GitHubConnectionStatus {
  isConnected: boolean;
  login?: string;
  email?: string;
  connectedAt?: number;
  lastActivityAt?: number;
  rateLimitRemaining?: number;
  rateLimitReset?: number;
  error?: string;
}

/**
 * GitHub API response for recent activity
 */
export interface GitHubActivityResponse {
  issues: GitHubIssue[];
  pullRequests: GitHubPullRequest[];
  teamMembers: GitHubUser[];
  errors: GitHubError[];
}
