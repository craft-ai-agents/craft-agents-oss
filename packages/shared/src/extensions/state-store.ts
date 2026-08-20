/**
 * Extension enable/disable state store.
 *
 * Path: `{configDir}/extensions/state.json`
 * Does NOT rewrite skills/sources/automations files — bookkeeping only.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ExtensionStateFile } from './types.ts'

const FILE_VERSION = 1 as const
const REL_PATH = join('extensions', 'state.json')

function emptyState(): ExtensionStateFile {
  return { version: FILE_VERSION, enabled: {}, updatedAt: new Date().toISOString() }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseState(raw: unknown): ExtensionStateFile {
  if (!isObject(raw)) return emptyState()
  const enabled: Record<string, boolean> = {}
  if (isObject(raw.enabled)) {
    for (const [k, v] of Object.entries(raw.enabled)) {
      if (typeof k === 'string' && typeof v === 'boolean') enabled[k] = v
    }
  }
  return {
    version: FILE_VERSION,
    enabled,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
  }
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, path)
}

export interface ExtensionStateStoreOptions {
  configDir: string
}

export class ExtensionStateStore {
  readonly path: string
  private cache: ExtensionStateFile | null = null

  constructor(options: ExtensionStateStoreOptions) {
    this.path = join(options.configDir, REL_PATH)
  }

  /** Read current state (cached after first load). */
  getState(): ExtensionStateFile {
    if (this.cache) return this.cache
    if (!existsSync(this.path)) {
      this.cache = emptyState()
      return this.cache
    }
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as unknown
      this.cache = parseState(raw)
    } catch {
      this.cache = emptyState()
    }
    return this.cache
  }

  /** Persist full state. */
  saveState(state: ExtensionStateFile): ExtensionStateFile {
    const next: ExtensionStateFile = {
      version: FILE_VERSION,
      enabled: { ...state.enabled },
      updatedAt: new Date().toISOString(),
    }
    atomicWrite(this.path, `${JSON.stringify(next, null, 2)}\n`)
    this.cache = next
    return next
  }

  /** Whether an extension is enabled. Absent key → defaultEnabled (true). */
  isEnabled(id: string, defaultEnabled = true): boolean {
    const state = this.getState()
    const v = state.enabled[id]
    return v === undefined ? defaultEnabled : v
  }

  /** Set enable flag for one extension id. */
  setEnabled(id: string, enabled: boolean): ExtensionStateFile {
    const state = this.getState()
    const next: ExtensionStateFile = {
      version: FILE_VERSION,
      enabled: { ...state.enabled, [id]: enabled },
      updatedAt: new Date().toISOString(),
    }
    return this.saveState(next)
  }

  /** Drop enable flag (revert to default). */
  clearEnabled(id: string): ExtensionStateFile {
    const state = this.getState()
    if (!(id in state.enabled)) return state
    const enabled = { ...state.enabled }
    delete enabled[id]
    return this.saveState({ version: FILE_VERSION, enabled })
  }

  /** Test helper — drop in-memory cache. */
  resetCache(): void {
    this.cache = null
  }
}

const stores = new Map<string, ExtensionStateStore>()

export function getExtensionStateStore(configDir: string): ExtensionStateStore {
  let store = stores.get(configDir)
  if (!store) {
    store = new ExtensionStateStore({ configDir })
    stores.set(configDir, store)
  }
  return store
}

export function resetExtensionStateStoreCache(): void {
  stores.clear()
}

export function extensionStatePath(configDir: string): string {
  return join(configDir, REL_PATH)
}
