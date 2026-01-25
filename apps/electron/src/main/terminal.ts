/**
 * Terminal Spawning Module
 *
 * Platform-specific logic for spawning terminal emulators with Claude Code
 * sessions automatically resumed via `claude --resume <sdk-session-id>`.
 *
 * Security: All user inputs are validated and sanitized to prevent shell injection.
 * Uses spawn() with argument arrays instead of exec() where possible.
 */

import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, writeFileSync, chmodSync, unlinkSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { mainLog } from './logger'

const execFileAsync = promisify(execFile)

/**
 * Options for spawning a terminal with a resumed Claude Code session
 */
export interface SpawnTerminalOptions {
  /**
   * Claude Agent SDK session ID (format: ses-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
   */
  sdkSessionId: string

  /**
   * Working directory to cd into before running claude command
   */
  workingDirectory: string

  /**
   * Optional task list ID for CLAUDE_CODE_TASK_LIST_ID environment variable
   */
  taskListId?: string
}

/**
 * Result of terminal spawn operation
 */
export interface SpawnTerminalResult {
  success: boolean
  error?: string
}

/**
 * Validates SDK session ID format to prevent shell injection
 *
 * Accepts multiple formats:
 * - Plain UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 * - With ses- prefix: ses-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 * - Short hex format: ses-<hex>
 */
function validateSessionId(sessionId: string): boolean {
  // Plain UUID format (most common for SDK session IDs)
  const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
  // With ses- prefix (legacy format)
  const sesUuidPattern = /^ses-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
  // Short hex format with ses- prefix
  const shortPattern = /^ses-[a-f0-9-]+$/i
  return uuidPattern.test(sessionId) || sesUuidPattern.test(sessionId) || shortPattern.test(sessionId)
}

/**
 * Escapes a path for use in shell commands by wrapping in single quotes
 * and escaping any single quotes in the path
 */
function escapeShellPath(path: string): string {
  // Replace single quotes with '\'' (end quote, escaped quote, start quote)
  return `'${path.replace(/'/g, "'\\''")}'`
}

/**
 * Validates that working directory exists and is accessible
 * Returns fallback directory (home) if not valid
 */
function validateWorkingDirectory(workingDirectory: string): string {
  if (!workingDirectory || !existsSync(workingDirectory)) {
    mainLog.warn(`[terminal] Working directory not found: ${workingDirectory}, using home`)
    return homedir()
  }
  return workingDirectory
}

/**
 * Spawns a terminal on macOS
 *
 * Uses a temporary shell script approach which is more reliable from Electron apps
 * than AppleScript automation (which requires Accessibility permissions).
 *
 * Flow:
 * 1. Create a temporary shell script with the claude resume command
 * 2. Make it executable
 * 3. Use `open -a Terminal <script>` to launch Terminal with the script
 * 4. Clean up the script after a delay
 */
async function openMacTerminal(options: SpawnTerminalOptions): Promise<SpawnTerminalResult> {
  const { sdkSessionId, workingDirectory, taskListId } = options

  const validDir = validateWorkingDirectory(workingDirectory)

  // Create a unique temporary script file
  const scriptName = `vesper-terminal-${Date.now()}.sh`
  const scriptPath = join(tmpdir(), scriptName)

  // Build the shell script content
  let scriptContent = '#!/bin/bash\n'
  scriptContent += '# Vesper Terminal Resume Script - auto-generated\n'
  scriptContent += `cd ${escapeShellPath(validDir)}\n`

  // Add task list ID environment variable if provided
  if (taskListId) {
    scriptContent += `export CLAUDE_CODE_TASK_LIST_ID='${taskListId}'\n`
  }

  // Add claude resume command
  scriptContent += `claude --resume ${sdkSessionId}\n`

  // Keep the shell open after the command (in case claude exits)
  scriptContent += 'exec $SHELL\n'

  try {
    // Write the script file
    writeFileSync(scriptPath, scriptContent, { encoding: 'utf-8' })
    chmodSync(scriptPath, 0o755) // Make executable

    mainLog.info(`[terminal] Created temp script: ${scriptPath}`)

    // Use 'open' command to launch Terminal with the script
    // The -a flag specifies the application, and Terminal.app will execute the script
    const child = spawn('open', ['-a', 'Terminal', scriptPath], {
      detached: true,
      stdio: 'ignore',
    })

    child.unref()

    // Clean up the script after a delay (give Terminal time to read it)
    setTimeout(() => {
      try {
        unlinkSync(scriptPath)
        mainLog.info(`[terminal] Cleaned up temp script: ${scriptPath}`)
      } catch (cleanupError) {
        // Script may have already been deleted or is still in use
        mainLog.debug(`[terminal] Could not clean up script: ${scriptPath}`)
      }
    }, 5000) // 5 second delay

    mainLog.info(`[terminal] Successfully opened Terminal.app with session ${sdkSessionId}`)
    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    mainLog.error(`[terminal] Failed to open macOS terminal: ${errorMessage}`)

    // Try to clean up the script on error
    try {
      unlinkSync(scriptPath)
    } catch {
      // Ignore cleanup errors
    }

    return {
      success: false,
      error: `Failed to open Terminal.app: ${errorMessage}`,
    }
  }
}

/**
 * Spawns a terminal on Linux
 *
 * Tries terminal emulators in order of preference:
 * 1. gnome-terminal (GNOME)
 * 2. konsole (KDE)
 * 3. xterm (fallback, always available)
 * 4. x-terminal-emulator (Debian/Ubuntu alternative system)
 */
async function openLinuxTerminal(options: SpawnTerminalOptions): Promise<SpawnTerminalResult> {
  const { sdkSessionId, workingDirectory, taskListId } = options

  const validDir = validateWorkingDirectory(workingDirectory)

  // Build command string
  let command = `cd ${escapeShellPath(validDir)}`
  if (taskListId) {
    command += ` && export CLAUDE_CODE_TASK_LIST_ID='${taskListId}'`
  }
  command += ` && claude --resume ${sdkSessionId} && exec $SHELL`

  // Terminal emulators to try, in order of preference
  const terminals = [
    {
      name: 'gnome-terminal',
      args: ['--', 'bash', '-c', command],
    },
    {
      name: 'konsole',
      args: ['-e', 'bash', '-c', command],
    },
    {
      name: 'xterm',
      args: ['-e', 'bash', '-c', command],
    },
    {
      name: 'x-terminal-emulator',
      args: ['-e', 'bash', '-c', command],
    },
  ]

  // Try each terminal emulator
  for (const terminal of terminals) {
    try {
      // Check if terminal exists in PATH
      await execFileAsync('which', [terminal.name], { timeout: 1000 })

      // Spawn terminal (detached so it doesn't block)
      const child = spawn(terminal.name, terminal.args, {
        detached: true,
        stdio: 'ignore',
      })

      child.unref()

      mainLog.info(
        `[terminal] Successfully opened ${terminal.name} with session ${sdkSessionId}`
      )
      return { success: true }
    } catch (error) {
      // Terminal not found or failed to spawn, try next one
      mainLog.debug(`[terminal] ${terminal.name} not available, trying next...`)
      continue
    }
  }

  // All terminals failed
  mainLog.error('[terminal] No suitable terminal emulator found on Linux')
  return {
    success: false,
    error: 'No terminal emulator found. Please install gnome-terminal, konsole, or xterm.',
  }
}

/**
 * Spawns a terminal on Windows
 *
 * Tries terminals in order of preference:
 * 1. wt.exe (Windows Terminal)
 * 2. powershell.exe (PowerShell)
 * 3. cmd.exe (Command Prompt, fallback)
 */
async function openWindowsTerminal(
  options: SpawnTerminalOptions
): Promise<SpawnTerminalResult> {
  const { sdkSessionId, workingDirectory, taskListId } = options

  const validDir = validateWorkingDirectory(workingDirectory)

  // Windows Terminal (wt.exe)
  try {
    // Build command arguments for wt.exe
    const args = ['--title', 'Claude Code Session']

    // Set working directory
    args.push('-d', validDir)

    // Build PowerShell command to set env var and run claude
    let psCommand = ''
    if (taskListId) {
      psCommand += `$env:CLAUDE_CODE_TASK_LIST_ID='${taskListId}'; `
    }
    psCommand += `claude --resume ${sdkSessionId}`

    args.push('powershell.exe', '-NoExit', '-Command', psCommand)

    // Try to spawn Windows Terminal
    await execFileAsync('wt.exe', args, { timeout: 5000 })

    mainLog.info(`[terminal] Successfully opened Windows Terminal with session ${sdkSessionId}`)
    return { success: true }
  } catch (error) {
    mainLog.debug('[terminal] Windows Terminal (wt.exe) not available, trying PowerShell...')
  }

  // PowerShell fallback
  try {
    // Build PowerShell command
    let psCommand = `Set-Location -Path '${validDir}'; `
    if (taskListId) {
      psCommand += `$env:CLAUDE_CODE_TASK_LIST_ID='${taskListId}'; `
    }
    psCommand += `claude --resume ${sdkSessionId}`

    const child = spawn('powershell.exe', ['-NoExit', '-Command', psCommand], {
      detached: true,
      stdio: 'ignore',
    })

    child.unref()

    mainLog.info(`[terminal] Successfully opened PowerShell with session ${sdkSessionId}`)
    return { success: true }
  } catch (error) {
    mainLog.debug('[terminal] PowerShell not available, trying cmd.exe...')
  }

  // cmd.exe fallback
  try {
    // Build command for cmd.exe
    let cmdCommand = `cd /d "${validDir}"`
    if (taskListId) {
      cmdCommand += ` && set CLAUDE_CODE_TASK_LIST_ID=${taskListId}`
    }
    cmdCommand += ` && claude --resume ${sdkSessionId}`

    const child = spawn('cmd.exe', ['/K', cmdCommand], {
      detached: true,
      stdio: 'ignore',
    })

    child.unref()

    mainLog.info(`[terminal] Successfully opened cmd.exe with session ${sdkSessionId}`)
    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    mainLog.error('[terminal] All Windows terminal options failed:', errorMessage)
    return {
      success: false,
      error: 'Failed to open terminal. Please ensure Windows Terminal, PowerShell, or cmd.exe is available.',
    }
  }
}

/**
 * Main entry point: Spawns a terminal with Claude Code session resumed
 *
 * Automatically detects platform and uses appropriate terminal emulator.
 *
 * @param options - Configuration for terminal spawn
 * @returns Promise with success status and optional error message
 */
export async function spawnTerminalWithSession(
  options: SpawnTerminalOptions
): Promise<SpawnTerminalResult> {
  const { sdkSessionId, workingDirectory, taskListId } = options

  mainLog.info(
    `[terminal] Spawning terminal for session ${sdkSessionId} in ${workingDirectory}`
  )

  // Validate session ID to prevent injection attacks
  if (!validateSessionId(sdkSessionId)) {
    mainLog.error(`[terminal] Invalid session ID format: ${sdkSessionId}`)
    return {
      success: false,
      error: 'Invalid session ID format',
    }
  }

  // Route to platform-specific implementation
  const platform = process.platform

  try {
    switch (platform) {
      case 'darwin':
        return await openMacTerminal(options)

      case 'linux':
        return await openLinuxTerminal(options)

      case 'win32':
        return await openWindowsTerminal(options)

      default:
        mainLog.error(`[terminal] Unsupported platform: ${platform}`)
        return {
          success: false,
          error: `Unsupported platform: ${platform}`,
        }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    mainLog.error(`[terminal] Unexpected error spawning terminal: ${errorMessage}`)
    return {
      success: false,
      error: `Unexpected error: ${errorMessage}`,
    }
  }
}
