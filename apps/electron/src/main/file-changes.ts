/**
 * IPC handlers for file change operations
 *
 * Provides methods to revert or apply file changes based on user actions
 * in the diff review UI.
 */

import { ipcMain } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'

/**
 * Register all file change IPC handlers
 */
export function registerFileChangeHandlers() {
  /**
   * Revert a file to its original content
   * Used when user rejects a change
   */
  ipcMain.handle('file-changes:revert', async (_, filePath: string, originalContent: string) => {
    try {
      // Ensure the file path is absolute
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath)

      // Write the original content back
      await fs.writeFile(absolutePath, originalContent, 'utf-8')

      return { success: true, filePath: absolutePath }
    } catch (error) {
      console.error('Failed to revert file:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  })

  /**
   * Apply new content to a file
   * Used when user accepts a change (though changes are already applied by the tool)
   * This is mainly for re-applying if reverted
   */
  ipcMain.handle('file-changes:apply', async (_, filePath: string, newContent: string) => {
    try {
      // Ensure the file path is absolute
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath)

      // Write the new content
      await fs.writeFile(absolutePath, newContent, 'utf-8')

      return { success: true, filePath: absolutePath }
    } catch (error) {
      console.error('Failed to apply file changes:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  })

  /**
   * Get current file content
   * Useful for verifying current state before reverting
   */
  ipcMain.handle('file-changes:read', async (_, filePath: string) => {
    try {
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath)
      const content = await fs.readFile(absolutePath, 'utf-8')

      return { success: true, content }
    } catch (error) {
      console.error('Failed to read file:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  })

  /**
   * Batch revert multiple files
   * More efficient than individual reverts
   */
  ipcMain.handle(
    'file-changes:revert-batch',
    async (_, changes: Array<{ filePath: string; originalContent: string }>) => {
      const results = await Promise.allSettled(
        changes.map(async ({ filePath, originalContent }) => {
          const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath)
          await fs.writeFile(absolutePath, originalContent, 'utf-8')
          return { filePath: absolutePath, success: true }
        })
      )

      return results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value
        } else {
          return {
            filePath: changes[index].filePath,
            success: false,
            error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
          }
        }
      })
    }
  )
}

/**
 * Unregister all file change IPC handlers
 * Called during app cleanup
 */
export function unregisterFileChangeHandlers() {
  ipcMain.removeHandler('file-changes:revert')
  ipcMain.removeHandler('file-changes:apply')
  ipcMain.removeHandler('file-changes:read')
  ipcMain.removeHandler('file-changes:revert-batch')
}
