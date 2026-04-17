/**
 * ConfigStore — workspace-scoped messaging config.json persistence.
 *
 * Stored at `{storageDir}/config.json`. Shape is `MessagingConfig`.
 * One-shot migration from a legacy directory is supported (mirrors BindingStore).
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_MESSAGING_CONFIG, type MessagingConfig } from './types'

export class ConfigStore {
  private readonly dirPath: string
  private readonly filePath: string
  private config: MessagingConfig

  constructor(storageDir: string, legacyDir?: string) {
    this.dirPath = storageDir
    this.filePath = join(storageDir, 'config.json')
    this.migrateLegacy(legacyDir)
    this.config = this.load()
  }

  get(): MessagingConfig {
    return { ...this.config, platforms: { ...this.config.platforms } }
  }

  update(partial: Partial<MessagingConfig>): MessagingConfig {
    const next: MessagingConfig = {
      enabled: partial.enabled ?? this.config.enabled,
      platforms: {
        ...this.config.platforms,
        ...(partial.platforms ?? {}),
      },
    }
    this.config = next
    this.save()
    return this.get()
  }

  private migrateLegacy(legacyDir?: string): void {
    if (!legacyDir) return
    const legacyFile = join(legacyDir, 'config.json')
    if (existsSync(this.filePath)) return
    if (!existsSync(legacyFile)) return
    try {
      if (!existsSync(this.dirPath)) mkdirSync(this.dirPath, { recursive: true })
      copyFileSync(legacyFile, this.filePath)
      console.log('[MessagingGateway] Migrated config:', legacyFile, '→', this.filePath)
    } catch (err) {
      console.error('[MessagingGateway] Config migration failed:', err)
    }
  }

  private load(): MessagingConfig {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<MessagingConfig>
        return {
          enabled: parsed.enabled ?? DEFAULT_MESSAGING_CONFIG.enabled,
          platforms: parsed.platforms ?? { ...DEFAULT_MESSAGING_CONFIG.platforms },
        }
      }
    } catch (err) {
      console.error('[MessagingGateway] Failed to load config:', err)
    }
    return { ...DEFAULT_MESSAGING_CONFIG, platforms: {} }
  }

  private save(): void {
    try {
      if (!existsSync(this.dirPath)) mkdirSync(this.dirPath, { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch (err) {
      console.error('[MessagingGateway] Failed to save config:', err)
    }
  }
}
