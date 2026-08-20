/**
 * Local SiYuan kernel bootstrap — detect binary, probe health, spawn detached
 * (or `open -a SiYuan` on macOS GUI app), seed default connection.
 *
 * Does not block app start: spawn is fire-and-forget; callers poll via
 * ENGINE_STATUS / probeKernelHealth.
 */

import { spawn, execFile } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { CONFIG_DIR } from '@craft-agent/shared/config/paths'
import {
  detectSiyuanBinary,
  shouldAutoStartSiyuan,
  SIYUAN_INSTALL_URL,
  SIYUAN_LOCAL_BASE_URL,
} from '@craft-agent/shared/knowledge/siyuan-binary'
import { KnowledgeConnectionsStore } from './connections-store'

/** Stable id for the auto-seeded local connection. */
export const SIYUAN_LOCAL_CONNECTION_ID = 'siyuan-local'

export const SIYUAN_DEFAULT_BASE_URL = SIYUAN_LOCAL_BASE_URL

export { SIYUAN_INSTALL_URL, detectSiyuanBinary, shouldAutoStartSiyuan }

export type KernelStartMethod = 'kernel-serve' | 'open-app' | 'none'

export interface KernelBootstrapStatus {
  running: boolean
  version?: string
  binaryFound: boolean
  binaryPath: string | null
  installUrl: string
  starting: boolean
  startMethod: KernelStartMethod
  dataDir: string
  baseUrl: string
  error?: string
}

export interface EnsureLocalKernelResult {
  ok: boolean
  started: boolean
  alreadyRunning: boolean
  method: KernelStartMethod
  binaryPath: string | null
  baseUrl: string
  connectionId: string
  version?: string
  error?: string
}

/** Module-level start lock so concurrent CTA/auto-start don't double-spawn. */
let startInFlight: Promise<EnsureLocalKernelResult> | null = null
let lastStartAt = 0
const START_COOLDOWN_MS = 8_000

export interface BootstrapDeps {
  configDir?: string
  platform?: NodeJS.Platform
  pathEnv?: string
  homeDir?: string
  existsSync?: (path: string) => boolean
  fetchImpl?: typeof fetch
  env?: NodeJS.ProcessEnv
  /** Injected spawn for tests. */
  spawnFn?: typeof spawn
  /** Injected open -a runner for tests. */
  openAppFn?: (appName: string) => Promise<void>
  /** Clock for cooldown. */
  now?: () => number
  log?: { debug?: (msg: string) => void; info?: (msg: string) => void; warn?: (msg: string) => void }
}

function resolveConfigDir(deps: BootstrapDeps): string {
  return deps.configDir ?? (process.env.CRAFT_CONFIG_DIR || CONFIG_DIR)
}

/** Workspace data dir for managed kernel serve: {CONFIG_DIR}/siyuan-workspace */
export function siyuanDataDir(configDir?: string): string {
  return join(configDir ?? (process.env.CRAFT_CONFIG_DIR || CONFIG_DIR), 'siyuan-workspace')
}

/**
 * Probe POST /api/system/version without requiring a token.
 * Many local kernels answer unauthenticated version; failures → not running.
 */
export async function probeKernelHealth(
  baseUrl: string = SIYUAN_LOCAL_BASE_URL,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ running: boolean; version?: string }> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const timeoutMs = options.timeoutMs ?? 2_500
  const url = `${baseUrl.replace(/\/+$/, '')}/api/system/version`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: controller.signal,
    })
    if (!res.ok) return { running: false }
    const envelope = (await res.json()) as { code?: number; data?: unknown }
    if (typeof envelope?.code === 'number' && envelope.code !== 0) {
      // Kernel is up but rejected — still "running" for bootstrap purposes
      return { running: true }
    }
    let version: string | undefined
    if (typeof envelope?.data === 'string') {
      version = envelope.data
    } else if (envelope?.data && typeof envelope.data === 'object' && 'version' in envelope.data) {
      const v = (envelope.data as { version: unknown }).version
      if (typeof v === 'string') version = v
    }
    return { running: true, ...(version ? { version } : {}) }
  } catch {
    return { running: false }
  } finally {
    clearTimeout(timer)
  }
}

function isKernelBinary(path: string): boolean {
  const name = basename(path).toLowerCase()
  return name.includes('kernel') || name === 'siyuan' || name === 'siyuan.exe'
}

function isMacAppBundleBinary(path: string): boolean {
  return path.includes('.app/Contents/MacOS/')
}

function defaultOpenApp(appName: string): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  execFile('open', ['-a', appName], (err) => {
    if (err) reject(err)
    else resolve()
  })
  return promise
}

/**
 * Spawn local SiYuan. Prefer kernel `serve --port 6806 -w <dataDir>`;
 * on macOS GUI app binary fall back to `open -a SiYuan`.
 */
export function spawnLocalSiyuan(
  binaryPath: string,
  options: {
    dataDir: string
    platform?: NodeJS.Platform
    spawnFn?: typeof spawn
    openAppFn?: (appName: string) => Promise<void>
    log?: BootstrapDeps['log']
  },
): { method: KernelStartMethod; pid?: number } {
  const platform = options.platform ?? process.platform
  const spawnFn = options.spawnFn ?? spawn
  const log = options.log

  mkdirSync(options.dataDir, { recursive: true })

  // macOS GUI wrapper is unreliable as CLI — open the app bundle.
  if (platform === 'darwin' && isMacAppBundleBinary(binaryPath)) {
    const openApp = options.openAppFn ?? defaultOpenApp
    void openApp('SiYuan').catch((err) => {
      log?.warn?.(`siyuan bootstrap open -a SiYuan failed: ${err instanceof Error ? err.message : String(err)}`)
    })
    return { method: 'open-app' }
  }

  // Prefer sibling kernel binary next to MacOS/SiYuan when we detected the app binary via PATH edge cases
  let kernelPath = binaryPath
  if (platform === 'darwin' && binaryPath.includes('SiYuan.app') && !isKernelBinary(binaryPath)) {
    const sibling = join(dirname(dirname(binaryPath)), 'Resources', 'kernel', 'SiYuan-Kernel')
    if (existsSync(sibling)) kernelPath = sibling
  }

  if (isKernelBinary(kernelPath) || !isMacAppBundleBinary(kernelPath)) {
    try {
      const child = spawnFn(
        kernelPath,
        ['serve', '--port', '6806', '-w', options.dataDir, '--wd', dirname(kernelPath)],
        {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env },
        },
      )
      child.unref()
      log?.info?.(`siyuan bootstrap: spawned kernel pid=${child.pid} path=${kernelPath}`)
      return { method: 'kernel-serve', pid: child.pid ?? undefined }
    } catch (err) {
      log?.warn?.(`siyuan bootstrap kernel spawn failed: ${err instanceof Error ? err.message : String(err)}`)
      if (platform === 'darwin') {
        const openApp = options.openAppFn ?? defaultOpenApp
        void openApp('SiYuan').catch(() => {})
        return { method: 'open-app' }
      }
      throw err
    }
  }

  if (platform === 'darwin') {
    const openApp = options.openAppFn ?? defaultOpenApp
    void openApp('SiYuan').catch((err) => {
      log?.warn?.(`siyuan bootstrap open -a failed: ${err instanceof Error ? err.message : String(err)}`)
    })
    return { method: 'open-app' }
  }

  return { method: 'none' }
}

/**
 * Ensure a default local connection record exists (id=siyuan-local, 127.0.0.1:6806).
 * Does not overwrite an existing record's baseUrl if the user changed it.
 */
export function ensureDefaultLocalConnection(
  store: KnowledgeConnectionsStore = new KnowledgeConnectionsStore(),
  options: { workspaceId?: string; baseUrl?: string } = {},
): { connectionId: string; created: boolean } {
  const existing = store.get(SIYUAN_LOCAL_CONNECTION_ID)
  if (existing) {
    return { connectionId: existing.id, created: false }
  }
  // Prefer any existing siyuan connection — don't double-seed
  const list = store.list()
  const first = list.find((c) => c.provider === 'siyuan')
  if (first) {
    return { connectionId: first.id, created: false }
  }

  const workspaceId = options.workspaceId?.trim() || 'default'
  const baseUrl = options.baseUrl ?? SIYUAN_LOCAL_BASE_URL
  const saved = store.save({
    id: SIYUAN_LOCAL_CONNECTION_ID,
    baseUrl,
    credentialRef: `source_bearer::${workspaceId}::${SIYUAN_LOCAL_CONNECTION_ID}`,
    provider: 'siyuan',
    mode: 'external-local',
    status: 'unknown',
  })
  return { connectionId: saved.id, created: true }
}

export async function getKernelBootstrapStatus(deps: BootstrapDeps = {}): Promise<KernelBootstrapStatus> {
  const configDir = resolveConfigDir(deps)
  const dataDir = siyuanDataDir(configDir)
  const platform = deps.platform ?? process.platform
  const binaryPath = detectSiyuanBinary({
    platform,
    pathEnv: deps.pathEnv ?? process.env.PATH,
    homeDir: deps.homeDir ?? homedir(),
    existsSync: deps.existsSync,
  })
  const health = await probeKernelHealth(SIYUAN_LOCAL_BASE_URL, { fetchImpl: deps.fetchImpl })
  return {
    running: health.running,
    ...(health.version ? { version: health.version } : {}),
    binaryFound: binaryPath != null,
    binaryPath,
    installUrl: SIYUAN_INSTALL_URL,
    starting: startInFlight != null,
    startMethod: 'none',
    dataDir,
    baseUrl: SIYUAN_LOCAL_BASE_URL,
  }
}

/**
 * Start local kernel if down. Seeds default connection. Safe to call repeatedly.
 * Never throws for "not installed" — returns ok:false with install guidance.
 */
export async function ensureLocalKernel(deps: BootstrapDeps = {}): Promise<EnsureLocalKernelResult> {
  if (startInFlight) return startInFlight

  const now = deps.now ?? Date.now
  if (now() - lastStartAt < START_COOLDOWN_MS) {
    const health = await probeKernelHealth(SIYUAN_LOCAL_BASE_URL, { fetchImpl: deps.fetchImpl })
    const { connectionId } = ensureDefaultLocalConnection(
      new KnowledgeConnectionsStore(resolveConfigDir(deps)),
    )
    return {
      ok: health.running,
      started: false,
      alreadyRunning: health.running,
      method: 'none',
      binaryPath: detectSiyuanBinary({
        platform: deps.platform,
        pathEnv: deps.pathEnv,
        homeDir: deps.homeDir,
        existsSync: deps.existsSync,
      }),
      baseUrl: SIYUAN_LOCAL_BASE_URL,
      connectionId,
      ...(health.version ? { version: health.version } : {}),
    }
  }

  const run = (async (): Promise<EnsureLocalKernelResult> => {
    const configDir = resolveConfigDir(deps)
    const store = new KnowledgeConnectionsStore(configDir)
    const { connectionId } = ensureDefaultLocalConnection(store)
    const health = await probeKernelHealth(SIYUAN_LOCAL_BASE_URL, { fetchImpl: deps.fetchImpl })
    if (health.running) {
      return {
        ok: true,
        started: false,
        alreadyRunning: true,
        method: 'none',
        binaryPath: detectSiyuanBinary({
          platform: deps.platform,
          pathEnv: deps.pathEnv,
          homeDir: deps.homeDir,
          existsSync: deps.existsSync,
        }),
        baseUrl: SIYUAN_LOCAL_BASE_URL,
        connectionId,
        ...(health.version ? { version: health.version } : {}),
      }
    }

    const binaryPath = detectSiyuanBinary({
      platform: deps.platform ?? process.platform,
      pathEnv: deps.pathEnv ?? process.env.PATH,
      homeDir: deps.homeDir ?? homedir(),
      existsSync: deps.existsSync,
    })
    if (!binaryPath) {
      return {
        ok: false,
        started: false,
        alreadyRunning: false,
        method: 'none',
        binaryPath: null,
        baseUrl: SIYUAN_LOCAL_BASE_URL,
        connectionId,
        error: 'siyuan-not-installed',
      }
    }

    try {
      const { method } = spawnLocalSiyuan(binaryPath, {
        dataDir: siyuanDataDir(configDir),
        platform: deps.platform,
        spawnFn: deps.spawnFn,
        openAppFn: deps.openAppFn,
        log: deps.log,
      })
      lastStartAt = now()
      return {
        ok: true,
        started: true,
        alreadyRunning: false,
        method,
        binaryPath,
        baseUrl: SIYUAN_LOCAL_BASE_URL,
        connectionId,
      }
    } catch (err) {
      return {
        ok: false,
        started: false,
        alreadyRunning: false,
        method: 'none',
        binaryPath,
        baseUrl: SIYUAN_LOCAL_BASE_URL,
        connectionId,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })()

  startInFlight = run
  try {
    return await run
  } finally {
    startInFlight = null
  }
}

/**
 * Non-blocking auto-start: when policy allows and kernel is down and binary
 * exists, kick ensureLocalKernel without awaiting readiness.
 */
export function maybeAutoStartLocalKernel(deps: BootstrapDeps = {}): void {
  const env = deps.env ?? process.env
  const platform = deps.platform ?? process.platform
  if (!shouldAutoStartSiyuan(env, platform)) return

  void (async () => {
    try {
      const health = await probeKernelHealth(SIYUAN_LOCAL_BASE_URL, { fetchImpl: deps.fetchImpl })
      if (health.running) {
        // Still seed connection so UI has a row
        ensureDefaultLocalConnection(new KnowledgeConnectionsStore(resolveConfigDir(deps)))
        return
      }
      const binary = detectSiyuanBinary({
        platform,
        pathEnv: deps.pathEnv ?? process.env.PATH,
        homeDir: deps.homeDir ?? homedir(),
        existsSync: deps.existsSync,
      })
      if (!binary) return
      deps.log?.info?.('siyuan bootstrap: auto-starting local kernel')
      await ensureLocalKernel(deps)
    } catch (err) {
      deps.log?.debug?.(
        `siyuan bootstrap auto-start failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  })()
}

/** Test-only: reset module start lock/cooldown. */
export function __resetSiyuanBootstrapForTests(): void {
  startInFlight = null
  lastStartAt = 0
}
