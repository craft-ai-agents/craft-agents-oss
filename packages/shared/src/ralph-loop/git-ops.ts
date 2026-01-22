/**
 * Git Operations
 *
 * Provides git operations for the Ralph Loop system.
 * Handles commit verification, auto-commits, and change detection.
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import type { ChangeSummary } from './types.ts'

const execAsync = promisify(exec)

/**
 * Interface for git operations used by Ralph Loop
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
 * Execute a git command in the specified working directory
 */
async function gitExec(
  command: string,
  workingDirectory: string
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execAsync(`git ${command}`, {
      cwd: workingDirectory,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large diffs
    })
    return result
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
      const { stdout } = await gitExec('rev-parse HEAD', workingDirectory)
      return stdout.trim()
    },

    async hasUncommittedChanges(): Promise<boolean> {
      const { stdout } = await gitExec('status --porcelain', workingDirectory)
      return stdout.trim().length > 0
    },

    async getChangesSummary(): Promise<ChangeSummary> {
      const { stdout } = await gitExec('status --porcelain', workingDirectory)
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
      // Stage all changes
      await gitExec('add -A', workingDirectory)

      // Check if there's anything to commit
      const hasChanges = await this.hasUncommittedChanges()
      if (!hasChanges) {
        throw new Error('No changes to commit')
      }

      // Create commit with Ralph Loop attribution
      const message = `feat(${storyId}): ${title}\n\nAuto-committed by Ralph Loop`
      const escapedMessage = message.replace(/"/g, '\\"')

      await gitExec(`commit -m "${escapedMessage}"`, workingDirectory)

      // Return the new commit SHA
      return this.getCurrentHead()
    },

    async verifyCommitCreated(beforeHead: string): Promise<boolean> {
      const currentHead = await this.getCurrentHead()
      return currentHead !== beforeHead
    },

    async getLastCommitMessage(): Promise<string> {
      const { stdout } = await gitExec('log -1 --pretty=%B', workingDirectory)
      return stdout.trim()
    },

    async isGitRepository(): Promise<boolean> {
      try {
        await gitExec('rev-parse --is-inside-work-tree', workingDirectory)
        return true
      } catch {
        return false
      }
    },
  }
}

/**
 * Validate that a directory is a valid git repository for Ralph Loop
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
