/**
 * BindingStore — workspace-scoped persistence for channel bindings.
 *
 * Stores bindings in an explicit storage directory (passed by the caller).
 * In Electron this is `~/.craft-agent/workspaces/{wsId}/messaging/`, but tests
 * can point it at any directory.
 *
 * One-shot migration: if a legacy path is provided and contains a bindings.json
 * that the new path does not, the legacy file is copied forward on construction.
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ChannelBinding, PlatformType, BindingConfig, ResponseMode } from './types'
import { DEFAULT_BINDING_CONFIG } from './types'

export class BindingStore {
  private bindings: ChannelBinding[] = []
  private readonly filePath: string
  private readonly dirPath: string
  private changeListener?: () => void

  /**
   * @param storageDir  Absolute path to the directory where bindings.json is stored.
   * @param legacyDir   Optional legacy directory. If its bindings.json exists and
   *                    the new location does not, the file is copied forward once.
   */
  constructor(storageDir: string, legacyDir?: string) {
    this.dirPath = storageDir
    this.filePath = join(storageDir, 'bindings.json')
    this.migrateLegacy(legacyDir)
    this.load()
  }

  /** Register a callback fired after any mutation is persisted. */
  onChange(fn: () => void): void {
    this.changeListener = fn
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  findByChannel(platform: PlatformType, channelId: string): ChannelBinding | undefined {
    return this.bindings.find(
      (b) => b.platform === platform && b.channelId === channelId && b.enabled,
    )
  }

  findBySession(sessionId: string): ChannelBinding[] {
    return this.bindings.filter((b) => b.sessionId === sessionId && b.enabled)
  }

  getAll(): ChannelBinding[] {
    return [...this.bindings]
  }

  // -------------------------------------------------------------------------
  // Mutation
  // -------------------------------------------------------------------------

  bind(
    workspaceId: string,
    sessionId: string,
    platform: PlatformType,
    channelId: string,
    channelName?: string,
    config?: Partial<BindingConfig>,
  ): ChannelBinding {
    // One channel → one session: evict any existing binding for the channel.
    this.bindings = this.bindings.filter(
      (b) => !(b.platform === platform && b.channelId === channelId),
    )

    const binding: ChannelBinding = {
      id: randomUUID(),
      workspaceId,
      sessionId,
      platform,
      channelId,
      channelName,
      enabled: true,
      createdAt: Date.now(),
      config: { ...DEFAULT_BINDING_CONFIG, ...config },
    }

    this.bindings.push(binding)
    this.save()
    return binding
  }

  unbind(platform: PlatformType, channelId: string): boolean {
    const before = this.bindings.length
    this.bindings = this.bindings.filter(
      (b) => !(b.platform === platform && b.channelId === channelId),
    )
    if (this.bindings.length !== before) {
      this.save()
      return true
    }
    return false
  }

  unbindSession(sessionId: string, platform?: PlatformType): number {
    const before = this.bindings.length
    this.bindings = this.bindings.filter((b) => {
      if (b.sessionId !== sessionId) return true
      if (platform && b.platform !== platform) return true
      return false
    })
    const removed = before - this.bindings.length
    if (removed > 0) this.save()
    return removed
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private migrateLegacy(legacyDir?: string): void {
    if (!legacyDir) return
    const legacyFile = join(legacyDir, 'bindings.json')
    if (existsSync(this.filePath)) return
    if (!existsSync(legacyFile)) return
    try {
      if (!existsSync(this.dirPath)) {
        mkdirSync(this.dirPath, { recursive: true })
      }
      copyFileSync(legacyFile, this.filePath)
      console.log('[MessagingGateway] Migrated bindings:', legacyFile, '→', this.filePath)
    } catch (err) {
      console.error('[MessagingGateway] Binding migration failed:', err)
    }
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8')
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          this.bindings = parsed.map(normalizeBinding)
        }
      }
    } catch {
      this.bindings = []
    }
  }

  private save(): void {
    try {
      if (!existsSync(this.dirPath)) {
        mkdirSync(this.dirPath, { recursive: true })
      }
      writeFileSync(this.filePath, JSON.stringify(this.bindings, null, 2), 'utf-8')
    } catch (err) {
      console.error('[MessagingGateway] Failed to save bindings:', err)
    }
    this.changeListener?.()
  }
}

// ---------------------------------------------------------------------------
// Migration helpers
// ---------------------------------------------------------------------------

/**
 * Fill in fields that were added after the binding was first persisted.
 *
 * `responseMode` was introduced alongside the `progress` rendering mode.
 * Records written before that field existed get a conservative default:
 *   - `streamResponses === false` → `final_only` (user had opted out of streaming)
 *   - otherwise → `streaming` (preserve today's behaviour)
 *
 * New bindings (created via `bind()`) always receive `DEFAULT_BINDING_CONFIG`
 * directly, which sets `responseMode: 'progress'`.
 */
function normalizeBinding(raw: ChannelBinding): ChannelBinding {
  const cfg = (raw.config ?? {}) as Partial<BindingConfig>
  if (cfg.responseMode) return raw
  const responseMode: ResponseMode = cfg.streamResponses === false ? 'final_only' : 'streaming'
  return {
    ...raw,
    config: {
      ...DEFAULT_BINDING_CONFIG,
      ...cfg,
      responseMode,
    },
  }
}
