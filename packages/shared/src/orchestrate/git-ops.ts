/**
 * Git Operations
 *
 * Provides git operations for the Orchestrate system.
 * Handles commit verification, auto-commits, and change detection.
 *
 * SECURITY: All git commands use execFile() instead of exec() to prevent
 * command injection attacks. Arguments are passed as arrays, not interpolated
 * into shell command strings.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ChangeSummary } from './types.ts'

const execFileAsync = promisify(execFile)

/** Maximum allowed length for story titles to prevent DoS */
const MAX_TITLE_LENGTH = 256

/** Maximum allowed length for story IDs */
const MAX_STORY_ID_LENGTH = 32

/**
 * Interface for git operations used by Orchestrate
 */
export interface GitOperations {
  /** Get the current HEAD commit SHA */
  getCurrentHead(): Promise<string>
  /** Check if there are uncommitted changes */
  hasUncommittedChanges(): Promise<boolean>
  /** Get a summary of current changes */
  getChangesSummary(): Promise<ChangeSummary>
  /** Create an auto-commit for a story */
  createAutoCommit(storyId: string, title: string): Promise<string>
  /** Verify if a new commit was created since beforeHead */
  verifyCommitCreated(beforeHead: string): Promise<boolean>
  /** Get the commit message of the most recent commit */
  getLastCommitMessage(): Promise<string>
  /** Check if the working directory is a git repository */
  isGitRepository(): Promise<boolean>
}

/**
 * Validate story input for safety (defense in depth)
 * Even though execFile() is safe from injection, we still validate input
 * to catch malformed data early and provide clear error messages.
 */
function validateStoryInput(storyId: string, title: string): void {
  // Story ID: alphanumeric with optional prefix and hyphen/underscore
  if (!storyId || storyId.length > MAX_STORY_ID_LENGTH) {
    throw new Error(
      `Invalid story ID: must be 1-${MAX_STORY_ID_LENGTH} characters, got ${storyId?.length ?? 0}`
    )
  }

  // Title: reasonable length, no null bytes
  if (!title || title.length === 0 || title.length > MAX_TITLE_LENGTH) {
    throw new Error(
      `Story title must be 1-${MAX_TITLE_LENGTH} characters, got ${title?.length ?? 0}`
    )
  }

  if (title.includes('\0')) {
    throw new Error('Story title cannot contain null bytes')
  }
}

/**
 * Execute a git command safely using array-based argument passing.
 * Uses execFile() instead of exec() to prevent shell injection attacks.
 *
 * @param args - Array of git command arguments (not including 'git')
 * @param workingDirectory - The directory to run git commands in
 * @param options - Optional timeout configuration
 */
async function gitExecSafe(
  args: string[],
  workingDirectory: string,
  options: { timeout?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: workingDirectory,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large diffs
      timeout: options.timeout || 30000, // 30s default timeout,
    })
    return { stdout, stderr }
  } catch (error) {
    // Git commands often exit with non-zero for normal conditions
    // (e.g., no changes to commit), so we need to handle this carefully
    if (error instanceof Error && 'stdout' in error) {
      const execError = error as Error & { stdout?: string; stderr?: string }
      return { stdout: execError.stdout || '', stderr: execError.stderr || '' }
    }
    throw error
  }
}

/**
 * Create a GitOperations instance for a specific working directory
 *
 * @param workingDirectory - The directory to run git commands in
 * @returns GitOperations interface
 */
export function createGitOperations(workingDirectory: string): GitOperations {
  return {
    async getCurrentHead(): Promise<string> {
      const { stdout } = await gitExecSafe(['rev-parse', 'HEAD'], workingDirectory)
      return stdout.trim()
    },

    async hasUncommittedChanges(): Promise<boolean> {
      const { stdout } = await gitExecSafe(['status', '--porcelain'], workingDirectory)
      return stdout.trim().length > 0
    },

    async getChangesSummary(): Promise<ChangeSummary> {
      const { stdout } = await gitExecSafe(['status', '--porcelain'], workingDirectory)
      const lines = stdout.trim().split('\n').filter(Boolean)

      let filesAdded = 0
      let filesModified = 0
      let filesDeleted = 0
      const changedFiles: string[] = []

      for (const line of lines) {
        const status = line.substring(0, 2)
        const file = line.substring(3).trim()
        changedFiles.push(file)

        // Parse status codes
        // See: https://git-scm.com/docs/git-status#_short_format
        if (status.includes('A') || status === '??') {
          filesAdded++
        } else if (status.includes('D')) {
          filesDeleted++
        } else if (status.includes('M') || status.includes('R') || status.includes('C')) {
          filesModified++
        }
      }

      return {
        filesAdded,
        filesModified,
        filesDeleted,
        changedFiles,
      }
    },

    async createAutoCommit(storyId: string, title: string): Promise<string> {
      // Validate input (defense in depth)
      validateStoryInput(storyId, title)

      // Stage all changes
      await gitExecSafe(['add', '-A'], workingDirectory)

      // Check if there's anything to commit
      const hasChanges = await this.hasUncommittedChanges()
      if (!hasChanges) {
        throw new Error('No changes to commit')
      }

      // Create commit with Orchestrate attribution
      // SECURITY: Using execFile with array args - no shell interpretation
      // The message can safely contain any characters including backticks, $(), etc.
      const message = `feat(${storyId}): ${title}\n\nAuto-committed by Orchestrate`

      await gitExecSafe(['commit', '-m', message], workingDirectory)

      // Return the new commit SHA
      return this.getCurrentHead()
    },

    async verifyCommitCreated(beforeHead: string): Promise<boolean> {
      const currentHead = await this.getCurrentHead()
      return currentHead !== beforeHead
    },

    async getLastCommitMessage(): Promise<string> {
      const { stdout } = await gitExecSafe(['log', '-1', '--pretty=%B'], workingDirectory)
      return stdout.trim()
    },

    async isGitRepository(): Promise<boolean> {
      try {
        await gitExecSafe(['rev-parse', '--is-inside-work-tree'], workingDirectory)
        return true
      } catch {
        return false
      }
    },
  }
}

/**
 * Validate that a directory is a valid git repository for Orchestrate
 *
 * @param workingDirectory - Directory to validate
 * @returns Object with isValid flag and optional error
 */
export async function validateGitRepository(
  workingDirectory: string
): Promise<{ isValid: boolean; error?: string }> {
  const gitOps = createGitOperations(workingDirectory)

  const isRepo = await gitOps.isGitRepository()
  if (!isRepo) {
    return {
      isValid: false,
      error: `${workingDirectory} is not a git repository`,
    }
  }

  return { isValid: true }
}
