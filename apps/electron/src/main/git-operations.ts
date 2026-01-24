import { ipcMain } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execAsync = promisify(exec)

export interface GitFileStatus {
  filePath: string
  status: 'staged' | 'unstaged' | 'untracked' | 'modified' | 'added' | 'deleted' | 'renamed' | 'unmodified'
  stagedStatus?: string
  unstagedStatus?: string
}

export interface GitStatusResult {
  success: boolean
  files?: GitFileStatus[]
  error?: string
}

export interface GitStageResult {
  success: boolean
  filePath?: string
  error?: string
}

export interface GitCommitResult {
  success: boolean
  commitHash?: string
  error?: string
}

/**
 * Parse git status --porcelain output
 * Format: XY filename
 * X = staged status, Y = unstaged status
 */
function parseGitStatus(output: string): GitFileStatus[] {
  const lines = output.trim().split('\n').filter(Boolean)

  return lines.map(line => {
    const stagedChar = line[0]
    const unstagedChar = line[1]
    const filePath = line.substring(3).trim()

    // Determine overall status
    let status: GitFileStatus['status'] = 'unmodified'

    if (stagedChar === '?' && unstagedChar === '?') {
      status = 'untracked'
    } else if (stagedChar !== ' ' && stagedChar !== '?') {
      status = 'staged'
    } else if (unstagedChar !== ' ' && unstagedChar !== '?') {
      status = 'unstaged'
    }

    return {
      filePath,
      status,
      stagedStatus: stagedChar,
      unstagedStatus: unstagedChar
    }
  })
}

export function registerGitOperationHandlers() {
  /**
   * Get git status for files
   */
  ipcMain.handle('git:status', async (_, cwd?: string): Promise<GitStatusResult> => {
    try {
      const workingDir = cwd || process.cwd()
      const { stdout } = await execAsync('git status --porcelain', { cwd: workingDir })

      const files = parseGitStatus(stdout)

      return { success: true, files }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  /**
   * Get git status for a specific file
   */
  ipcMain.handle('git:file-status', async (_, filePath: string, cwd?: string): Promise<GitStatusResult> => {
    try {
      const workingDir = cwd || process.cwd()
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(workingDir, filePath)
      const relativePath = path.relative(workingDir, absolutePath)

      const { stdout } = await execAsync(`git status --porcelain "${relativePath}"`, { cwd: workingDir })

      const files = parseGitStatus(stdout)

      return { success: true, files }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  /**
   * Stage a file
   */
  ipcMain.handle('git:stage', async (_, filePath: string, cwd?: string): Promise<GitStageResult> => {
    try {
      const workingDir = cwd || process.cwd()
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(workingDir, filePath)
      const relativePath = path.relative(workingDir, absolutePath)

      await execAsync(`git add "${relativePath}"`, { cwd: workingDir })

      return { success: true, filePath: absolutePath }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  /**
   * Unstage a file
   */
  ipcMain.handle('git:unstage', async (_, filePath: string, cwd?: string): Promise<GitStageResult> => {
    try {
      const workingDir = cwd || process.cwd()
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(workingDir, filePath)
      const relativePath = path.relative(workingDir, absolutePath)

      await execAsync(`git reset HEAD "${relativePath}"`, { cwd: workingDir })

      return { success: true, filePath: absolutePath }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  /**
   * Stage multiple files
   */
  ipcMain.handle('git:stage-batch', async (_, filePaths: string[], cwd?: string): Promise<GitStageResult> => {
    try {
      const workingDir = cwd || process.cwd()

      for (const filePath of filePaths) {
        const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(workingDir, filePath)
        const relativePath = path.relative(workingDir, absolutePath)
        await execAsync(`git add "${relativePath}"`, { cwd: workingDir })
      }

      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  /**
   * Create a commit
   */
  ipcMain.handle('git:commit', async (_, message: string, cwd?: string): Promise<GitCommitResult> => {
    try {
      const workingDir = cwd || process.cwd()

      // Escape the commit message for shell
      const escapedMessage = message.replace(/"/g, '\\"')

      const { stdout } = await execAsync(`git commit -m "${escapedMessage}"`, { cwd: workingDir })

      // Extract commit hash from output (format: [branch hash] message)
      const hashMatch = stdout.match(/\[.+ ([a-f0-9]+)\]/)
      const commitHash = hashMatch ? hashMatch[1] : undefined

      return { success: true, commitHash }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  /**
   * Check if directory is a git repository
   */
  ipcMain.handle('git:is-repo', async (_, cwd?: string): Promise<boolean> => {
    try {
      const workingDir = cwd || process.cwd()
      await execAsync('git rev-parse --git-dir', { cwd: workingDir })
      return true
    } catch {
      return false
    }
  })
}
