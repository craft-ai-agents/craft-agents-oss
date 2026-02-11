/**
 * Bundled Developer Tools
 *
 * Detects whether git, node, and uv are available in the user's PATH.
 * If any are missing and a bundled version exists in vendor/, adds the
 * bundled binary's directory to PATH so agent subprocesses can use it.
 *
 * User's own installations always take priority — bundled tools are fallbacks only.
 *
 * Must be called after loadShellEnv() in main process startup, and before
 * any agent subprocesses are created (they inherit process.env).
 */

import { existsSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { app } from 'electron'
import { mainLog } from './logger'

/** Check if a command is available in PATH */
function isInPath(cmd: string): boolean {
  try {
    const which = process.platform === 'win32' ? 'where' : 'which'
    execSync(`${which} ${cmd}`, { stdio: 'ignore', timeout: 3000 })
    return true
  } catch {
    return false
  }
}

/** Get the base path for bundled vendor tools */
function getVendorBase(): string {
  // On Windows, vendor tools are in extraResources (process.resourcesPath) to avoid EBUSY errors.
  // On macOS/Linux, they're in the app files (app.getAppPath()). See electron-builder.yml.
  return process.platform === 'win32' ? process.resourcesPath : app.getAppPath()
}

/**
 * Initialize bundled tools — adds vendor paths to PATH for missing tools.
 * Call after loadShellEnv() in main process startup.
 * User's own installations always take priority.
 */
export function initBundledTools(): void {
  if (!app.isPackaged) return // Dev mode uses system tools

  const vendorBase = getVendorBase()

  const toolChecks = [
    { name: 'git', binSubdir: process.platform === 'win32' ? 'cmd' : 'bin' },
    { name: 'node', binSubdir: process.platform === 'win32' ? '' : 'bin' },
    { name: 'uv', binSubdir: '' },
  ]

  const pathAdditions: string[] = []

  for (const { name, binSubdir } of toolChecks) {
    if (isInPath(name)) {
      mainLog.info(`[bundled-tools] ${name}: using system installation`)
      continue
    }

    const toolDir = join(vendorBase, 'vendor', name)
    const binDir = binSubdir ? join(toolDir, binSubdir) : toolDir

    if (existsSync(binDir)) {
      pathAdditions.push(binDir)
      mainLog.info(`[bundled-tools] ${name}: using bundled version at ${binDir}`)
    } else {
      mainLog.warn(`[bundled-tools] ${name}: not found in system or bundle`)
    }
  }

  if (pathAdditions.length > 0) {
    const sep = process.platform === 'win32' ? ';' : ':'
    process.env.PATH = process.env.PATH + sep + pathAdditions.join(sep)
  }
}
