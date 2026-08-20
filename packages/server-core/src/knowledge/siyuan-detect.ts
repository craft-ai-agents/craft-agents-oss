/**
 * SiYuan external-local process assist (P7-prep) — detect install paths and
 * whether something answers on the default kernel port.
 *
 * HARD RULE (G2 / 08-licensing): never download, vendor, spawn, or bundle a
 * SiYuan binary. Detection is path existence + TCP connect only. Optional
 * macOS `open -a SiYuan` is gated on an existing app bundle and is not wired
 * into auto-start.
 *
 * Data dirs (plugins/petals live under these — see siyuan-plugins-fs.ts):
 *   darwin: ~/Library/Application Support/SiYuan/data
 *   win32:  %APPDATA%/SiYuan/data
 *   linux:  ~/.config/siyuan/data, ~/.config/SiYuan/data, ~/.siyuan/data, ~/SiYuan/data
 * Override: CRAFT_SIYUAN_DATA_DIRS (path list, `:` / `;` on win32).
 */
import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const SIYUAN_DEFAULT_PORT = 6806
export const SIYUAN_DEFAULT_BASE_URL = `http://127.0.0.1:${SIYUAN_DEFAULT_PORT}`

/** Official install docs — user installs SiYuan themselves; we never download. */
export const SIYUAN_INSTALL_DOCS_URL = 'https://b3log.org/siyuan/'

export interface SiyuanDetectResult {
  installed: boolean
  runningOnDefaultPort: boolean
  suggestedBaseUrl: string
  installPathsFound: string[]
  /** Platform of the answering host (for Settings copy). */
  platform: NodeJS.Platform
  /** True only when a macOS .app bundle was found (open -a is possible). */
  canOpenApp: boolean
  /** Official SiYuan install docs — Craft never downloads the binary. */
  installDocsUrl: string
}

function candidateInstallPaths(platform: NodeJS.Platform = process.platform): string[] {
  const home = homedir()
  switch (platform) {
    case 'darwin':
      return [
        '/Applications/SiYuan.app',
        join(home, 'Applications', 'SiYuan.app'),
      ]
    case 'win32': {
      const pf = process.env.ProgramFiles ?? 'C:\\Program Files'
      const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
      const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
      return [
        join(pf, 'SiYuan', 'SiYuan.exe'),
        join(pf86, 'SiYuan', 'SiYuan.exe'),
        join(local, 'Programs', 'SiYuan', 'SiYuan.exe'),
        join(local, 'SiYuan', 'SiYuan.exe'),
      ]
    }
    default:
      // linux + others
      return [
        '/usr/bin/siyuan',
        '/usr/local/bin/siyuan',
        join(home, '.local', 'bin', 'siyuan'),
        '/opt/siyuan/siyuan',
        '/opt/SiYuan/siyuan',
        join(home, 'siyuan', 'siyuan'),
      ]
  }
}

export function findSiyuanInstallPaths(platform: NodeJS.Platform = process.platform): string[] {
  return candidateInstallPaths(platform).filter((p) => {
    try {
      return existsSync(p)
    } catch {
      return false
    }
  })
}

/**
 * Short TCP connect to host:port. Resolves true if the connect succeeds
 * (something is listening), false on timeout/refused/error.
 */
export function probeTcpPort(
  host: string,
  port: number,
  timeoutMs = 400,
): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>()
  let settled = false
  const finish = (value: boolean) => {
    if (settled) return
    settled = true
    try {
      socket.destroy()
    } catch {
      /* ignore */
    }
    resolve(value)
  }
  const socket = connect({ host, port })
  socket.setTimeout(timeoutMs)
  socket.once('connect', () => finish(true))
  socket.once('timeout', () => finish(false))
  socket.once('error', () => finish(false))
  return promise
}

export async function detectSiyuanEngine(options?: {
  platform?: NodeJS.Platform
  host?: string
  port?: number
  timeoutMs?: number
}): Promise<SiyuanDetectResult> {
  const platform = options?.platform ?? process.platform
  const host = options?.host ?? '127.0.0.1'
  const port = options?.port ?? SIYUAN_DEFAULT_PORT
  const installPathsFound = findSiyuanInstallPaths(platform)
  const runningOnDefaultPort = await probeTcpPort(host, port, options?.timeoutMs ?? 400)
  const canOpenApp =
    platform === 'darwin' && installPathsFound.some((p) => p.endsWith('.app'))
  return {
    installed: installPathsFound.length > 0,
    runningOnDefaultPort,
    suggestedBaseUrl: `http://${host === 'localhost' ? '127.0.0.1' : host}:${port}`,
    installPathsFound,
    platform,
    canOpenApp,
    installDocsUrl: SIYUAN_INSTALL_DOCS_URL,
  }
}

/**
 * Optional macOS helper: open the SiYuan app bundle if present.
 * NEVER downloads. Returns false when the app is missing or open fails.
 */
export async function tryOpenSiyuanApp(options?: {
  platform?: NodeJS.Platform
}): Promise<{ ok: boolean; reason?: string }> {
  const platform = options?.platform ?? process.platform
  if (platform !== 'darwin') {
    return { ok: false, reason: 'open-app only supported on macOS' }
  }
  const paths = findSiyuanInstallPaths('darwin')
  const app = paths.find((p) => p.endsWith('.app'))
  if (!app) {
    return { ok: false, reason: 'SiYuan.app not found in common install locations' }
  }
  try {
    await execFileAsync('open', ['-a', app], { timeout: 5_000 })
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}
