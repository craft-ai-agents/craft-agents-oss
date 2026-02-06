/**
 * Git utilities for the main process
 */

import { execSync } from 'child_process'

export interface GitInfo {
  repoUrl: string
  repoKey: string
  branch: string
  commit: string
}

/**
 * Get git repository info from a directory
 * Returns null if not a git repo or not a GitHub repo
 */
export function getGitInfo(dirPath: string): GitInfo | null {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      cwd: dirPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim()

    const branch = execSync('git branch --show-current', {
      cwd: dirPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim()

    const commit = execSync('git rev-parse HEAD', {
      cwd: dirPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim()

    // Parse remote URL to get owner/repo
    // Handles: git@github.com:owner/repo.git and https://github.com/owner/repo.git
    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/)
    if (!match) {
      return null // Not a GitHub repo
    }

    return {
      repoUrl: remoteUrl,
      repoKey: `${match[1]}/${match[2]}`,
      branch: branch || 'main',
      commit,
    }
  } catch {
    // Not a git repo, git not installed, or other error
    return null
  }
}

/**
 * Get just the current branch name
 */
export function getGitBranch(dirPath: string): string | null {
  try {
    return execSync('git branch --show-current', {
      cwd: dirPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim() || null
  } catch {
    return null
  }
}
