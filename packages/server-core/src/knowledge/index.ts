/**
 * File-backed knowledge stores (spec K-04 §3.3) — the only modules in the
 * knowledge domain that touch the filesystem. RPC handlers reach them through
 * the bridge service (K-04 §3.5 «единый писатель»), never directly.
 */
export * from './connections-store'
export * from './snapshots-store'
export * from './proposals-store'
export * from './knowledge-audit'
export * from './drafts-store'
export * from './publications-store'
export * from './links-store'
export * from './publication-service'
export * from './work-envelopes-store'
export * from './automation-loop-guard'
export * from './change-watcher'
export * from './automation-actions'
export * from './bridge-registry'
export * from './metrics-store'
export * from './siyuan-detect'
export * from './siyuan-plugins-fs'
export * from './notes-migration'
// Named exports only — siyuan-bootstrap re-exports SIYUAN_DEFAULT_BASE_URL which
// collides with siyuan-detect (TS2308).
export {
  SIYUAN_LOCAL_CONNECTION_ID,
  SIYUAN_INSTALL_URL,
  ensureDefaultLocalConnection,
  ensureLocalKernel,
  getKernelBootstrapStatus,
  maybeAutoStartLocalKernel,
  probeKernelHealth,
  siyuanDataDir,
  spawnLocalSiyuan,
  type EnsureLocalKernelResult,
  type KernelBootstrapStatus,
  type KernelStartMethod,
  type BootstrapDeps,
} from './siyuan-bootstrap'
