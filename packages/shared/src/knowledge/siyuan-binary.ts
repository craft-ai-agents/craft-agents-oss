/**
 * Pure SiYuan binary discovery helpers (no process spawn).
 *
 * Used by server-core kernel bootstrap and unit-tested without FS side effects
 * via injectable existsSync / pathEnv / platform / homeDir.
 */

import { existsSync } from 'node:fs'

/** Official download page for install CTAs when no binary is found. */
export const SIYUAN_INSTALL_URL = 'https://b3log.org/siyuan/'

/** Default external-local kernel base URL (matches core SIYUAN_DEFAULT_BASE_URL). */
export const SIYUAN_LOCAL_BASE_URL = 'http://127.0.0.1:6806'

export interface DetectSiyuanBinaryOptions {
  /** Override platform (default process.platform). */
  platform?: NodeJS.Platform
  /** Override PATH (default process.env.PATH). */
  pathEnv?: string
  /** Override home directory (darwin Applications under /Applications + ~/Applications). */
  homeDir?: string
  /** Injected exists check (default fs.existsSync). */
  existsSync?: (path: string) => boolean
  /** Extra candidate absolute paths prepended to the search list. */
  extraCandidates?: string[]
}

function pathSep(platform: NodeJS.Platform): string {
  return platform === 'win32' ? '\\' : '/'
}

function pathDelimiter(platform: NodeJS.Platform): string {
  return platform === 'win32' ? ';' : ':'
}

function joinPath(platform: NodeJS.Platform, ...parts: string[]): string {
  const sep = pathSep(platform)
  const cleaned = parts
    .filter((p) => p.length > 0)
    .map((p, i) => {
      let s = p.replace(/[\\/]+/g, sep)
      if (i > 0) s = s.replace(new RegExp(`^[${sep === '\\' ? '\\\\' : '/'}]+`), '')
      if (i < parts.length - 1) s = s.replace(new RegExp(`[${sep === '\\' ? '\\\\' : '/'}]+$`), '')
      return s
    })
  return cleaned.join(sep)
}

/**
 * Build ordered candidate paths for a SiYuan kernel/app binary.
 * Pure: does not touch the filesystem. Path joining follows the *target*
 * platform so unit tests can simulate win32/linux from darwin hosts.
 */
export function siyuanBinaryCandidates(options: DetectSiyuanBinaryOptions = {}): string[] {
  const platform = options.platform ?? process.platform
  const homeDir = options.homeDir ?? ''
  const pathEnv = options.pathEnv ?? ''
  const out: string[] = []

  if (options.extraCandidates) {
    for (const p of options.extraCandidates) {
      if (p) out.push(p)
    }
  }

  if (platform === 'darwin') {
    out.push(
      '/Applications/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel',
      '/Applications/SiYuan.app/Contents/MacOS/SiYuan',
    )
    if (homeDir) {
      out.push(
        joinPath(platform, homeDir, 'Applications/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel'),
        joinPath(platform, homeDir, 'Applications/SiYuan.app/Contents/MacOS/SiYuan'),
      )
    }
  } else if (platform === 'linux') {
    out.push(
      '/usr/local/bin/siyuan',
      '/usr/bin/siyuan',
      '/opt/siyuan/siyuan',
      '/opt/SiYuan/siyuan',
    )
    if (homeDir) {
      out.push(
        joinPath(platform, homeDir, '.local/bin/siyuan'),
        joinPath(platform, homeDir, 'siyuan/siyuan'),
      )
    }
  } else if (platform === 'win32') {
    out.push(
      'C:\\Program Files\\SiYuan\\SiYuan.exe',
      'C:\\Program Files (x86)\\SiYuan\\SiYuan.exe',
    )
    if (homeDir) {
      out.push(joinPath(platform, homeDir, 'AppData\\Local\\Programs\\SiYuan\\SiYuan.exe'))
    }
  }

  const pathNames =
    platform === 'win32'
      ? ['siyuan.exe', 'SiYuan.exe', 'SiYuan-Kernel.exe', 'siyuan-kernel.exe']
      : ['siyuan', 'SiYuan', 'SiYuan-Kernel', 'siyuan-kernel']

  for (const dir of pathEnv.split(pathDelimiter(platform))) {
    if (!dir) continue
    for (const name of pathNames) {
      out.push(joinPath(platform, dir, name))
    }
  }

  // Dedup while preserving order
  const seen = new Set<string>()
  const unique: string[] = []
  for (const p of out) {
    if (seen.has(p)) continue
    seen.add(p)
    unique.push(p)
  }
  return unique
}

/**
 * Return the first existing SiYuan binary path, or null when none is installed.
 * Pure given an injected existsSync.
 */
export function detectSiyuanBinary(options: DetectSiyuanBinaryOptions = {}): string | null {
  const exists = options.existsSync ?? existsSync
  for (const candidate of siyuanBinaryCandidates(options)) {
    try {
      if (exists(candidate)) return candidate
    } catch {
      // ignore permission / IO errors on individual candidates
    }
  }
  return null
}

/**
 * Whether CRAFT_SIYUAN_AUTO_START enables background kernel start.
 * - Explicit "0"/"false"/"off" → disabled
 * - Explicit "1"/"true"/"on" → enabled
 * - Unset → default on for darwin when a binary is found (caller still gates on binary)
 */
export function shouldAutoStartSiyuan(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  const raw = env.CRAFT_SIYUAN_AUTO_START
  if (raw === undefined || raw === '') {
    return platform === 'darwin'
  }
  const v = raw.trim().toLowerCase()
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true
  return platform === 'darwin'
}
