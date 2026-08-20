/**
 * Fail-soft SiYuan plugin.json / craft bridge manifest parsing (W6).
 */

import type {
  CompatLevel,
  SiYuanBridgeCraftBlock,
  SiYuanBridgeManifest,
} from './types.ts'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Resolve a localized string field preferring `prefer`, then en, then first value. */
export function localizedText(
  value: Record<string, string> | string | undefined,
  prefer = 'en',
): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (!isObject(value)) return undefined
  const preferred = value[prefer]
  if (typeof preferred === 'string' && preferred.trim()) return preferred.trim()
  const en = value.en
  if (typeof en === 'string' && en.trim()) return en.trim()
  for (const v of Object.values(value)) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

function parseCraftBlock(raw: unknown): SiYuanBridgeCraftBlock | undefined {
  if (!isObject(raw)) return undefined
  const level = raw.level
  if (level !== 2 && level !== 3) return undefined

  const craft: SiYuanBridgeCraftBlock = { level }
  if (typeof raw.requiresFullChrome === 'boolean') {
    craft.requiresFullChrome = raw.requiresFullChrome
  }
  if (Array.isArray(raw.gracefulDegrade)) {
    craft.gracefulDegrade = raw.gracefulDegrade.filter((x): x is string => typeof x === 'string')
  }
  if (isObject(raw.contributes)) {
    // Loose validation — projection layer decides what is usable.
    craft.contributes = raw.contributes as SiYuanBridgeCraftBlock['contributes']
  }
  return craft
}

/**
 * Fail-soft parse of a SiYuan plugin.json (+ optional craft bridge block).
 * Requires name + version strings; returns null otherwise.
 */
export function parseSiYuanPluginManifest(raw: unknown): SiYuanBridgeManifest | null {
  if (!isObject(raw)) return null
  const name = raw.name
  const version = raw.version
  if (typeof name !== 'string' || !name.trim()) return null
  if (typeof version !== 'string' || !version.trim()) return null

  const manifest: SiYuanBridgeManifest = {
    ...raw,
    name: name.trim(),
    version: version.trim(),
  }

  if (typeof raw.author === 'string') manifest.author = raw.author
  if (raw.displayName !== undefined) {
    manifest.displayName = raw.displayName as SiYuanBridgeManifest['displayName']
  }
  if (raw.description !== undefined) {
    manifest.description = raw.description as SiYuanBridgeManifest['description']
  }
  if (typeof raw.minAppVersion === 'string') manifest.minAppVersion = raw.minAppVersion
  if (Array.isArray(raw.backends)) {
    manifest.backends = raw.backends.filter((x): x is string => typeof x === 'string')
  }
  if (Array.isArray(raw.frontends)) {
    manifest.frontends = raw.frontends.filter((x): x is string => typeof x === 'string')
  }
  if (typeof raw.disabledInPublish === 'boolean') {
    manifest.disabledInPublish = raw.disabledInPublish
  }

  if ('craft' in raw) {
    const craft = parseCraftBlock(raw.craft)
    if (craft) manifest.craft = craft
    else delete manifest.craft
  }

  return manifest
}

/**
 * Detect compatibility level for a SiYuan plugin bridge manifest.
 *
 * - null/invalid → L0
 * - no craft → L1 if name+version else L0
 * - requiresFullChrome or capabilityProbeFailed → max L1
 * - craft.level 2|3 → that level when craft is present and valid
 */
export function detectCompatLevel(
  manifest: SiYuanBridgeManifest | null,
  opts?: { capabilityProbeFailed?: boolean },
): CompatLevel {
  if (!manifest) return 0
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) return 0
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) return 0

  const hasNameVersion = true
  const craft = manifest.craft
  const craftLevel =
    craft && (craft.level === 2 || craft.level === 3) ? craft.level : undefined

  // Clamp to L1 when full chrome required or capability probe failed.
  if (opts?.capabilityProbeFailed || craft?.requiresFullChrome) {
    return hasNameVersion ? 1 : 0
  }

  if (craftLevel === 2 || craftLevel === 3) return craftLevel

  // Valid plugin.json without craft bridge block → L1 discovery only.
  return 1
}
