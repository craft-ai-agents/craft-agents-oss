/**
 * Sound Notification Types
 *
 * Types for the native sound notification system.
 * Implements CESP v1.0 (Coding Event Sound Pack Specification).
 */

// ---------------------------------------------------------------------------
// CESP v1.0 Event Categories
// ---------------------------------------------------------------------------

/** CESP core categories — every compliant pack SHOULD provide these */
export const CESP_CORE_CATEGORIES = [
  'session.start',
  'task.acknowledge',
  'task.complete',
  'task.error',
  'input.required',
  'resource.limit',
] as const

/** CESP extended categories — packs MAY provide these */
export const CESP_EXTENDED_CATEGORIES = [
  'user.spam',
  'session.end',
  'task.progress',
] as const

/** All CESP v1.0 categories */
export const CESP_ALL_CATEGORIES = [
  ...CESP_CORE_CATEGORIES,
  ...CESP_EXTENDED_CATEGORIES,
] as const

export type CespCategory = (typeof CESP_ALL_CATEGORIES)[number]
export type CespCoreCategory = (typeof CESP_CORE_CATEGORIES)[number]
export type CespExtendedCategory = (typeof CESP_EXTENDED_CATEGORIES)[number]

// ---------------------------------------------------------------------------
// CESP Audio Format Validation
// ---------------------------------------------------------------------------

/** Magic byte signatures for supported audio formats */
export const AUDIO_MAGIC_BYTES: Record<string, { offset: number; bytes: number[] }> = {
  wav: { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF"
  mp3_id3: { offset: 0, bytes: [0x49, 0x44, 0x33] }, // "ID3"
  mp3_sync: { offset: 0, bytes: [0xff, 0xfb] }, // MPEG sync word
  ogg: { offset: 0, bytes: [0x4f, 0x67, 0x67, 0x53] }, // "OggS"
}

/** File extensions allowed in sound packs */
export const SUPPORTED_AUDIO_EXTENSIONS = ['.wav', '.mp3', '.ogg', '.oga'] as const

// ---------------------------------------------------------------------------
// CESP openpeon.json Manifest
// ---------------------------------------------------------------------------

export interface CespSoundEntry {
  file: string
  label?: string
  sha256?: string
}

export interface CespCategoryDef {
  sounds: CespSoundEntry[]
}

export interface CespAuthor {
  name: string
  github?: string
}

export interface CespCategoryAlias {
  /** Legacy category name */
  from: string
  /** Maps to this CESP category */
  to: CespCategory
}

/**
 * CESP v1.0 manifest — the openpeon.json format.
 * Any CESP-compliant pack uses this exact schema.
 */
export interface CespManifest {
  cesp_version: string
  name: string
  display_name: string
  version: string
  description?: string
  author?: CespAuthor
  license?: string
  language?: string
  icon?: string
  categories: Partial<Record<CespCategory, CespCategoryDef>>
  category_aliases?: CespCategoryAlias[]
}

// ---------------------------------------------------------------------------
// Sound Pack (loaded, resolved)
// ---------------------------------------------------------------------------

export interface SoundPack {
  /** Unique pack name (from manifest) */
  name: string
  /** Human-readable display name */
  displayName: string
  /** Pack version */
  version: string
  /** Absolute path to the pack directory on disk */
  directory: string
  /** Parsed manifest */
  manifest: CespManifest
  /** Total number of sounds across all categories */
  soundCount: number
  /** Total size in bytes of all audio files */
  totalSizeBytes: number
  /** Source of this pack */
  source: 'builtin' | 'installed' | 'imported' | 'peon-ping'
  /** Trust tier (from registry, for installed packs) */
  trustTier?: 'official' | 'community'
  /** Preview sound file names */
  previewSounds?: string[]
}

// ---------------------------------------------------------------------------
// Sound Settings
// ---------------------------------------------------------------------------

/** Per-category settings */
export interface SoundCategorySettings {
  enabled: boolean
  /** Override sound file path (absolute). If unset, uses the active pack's sound. */
  overrideFilePath?: string
  /** Volume override for this category (0.0–1.0). If unset, uses global volume. */
  volume?: number
}

/** Global sound notification settings */
export interface SoundSettings {
  /** Master enable/disable */
  enabled: boolean
  /** Default pack name */
  defaultPack: string
  /** Global volume (0.0–1.0) */
  volume: number
  /** Cooldown between same-category sounds in milliseconds */
  cooldownMs: number
  /** No-repeat: avoid playing the same sound twice in a row */
  noRepeat: boolean
  /** Per-category overrides */
  categories: Partial<Record<CespCategory, SoundCategorySettings>>
}

/** Default sound settings */
export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  enabled: true,
  defaultPack: 'default',
  volume: 0.8,
  cooldownMs: 2000,
  noRepeat: true,
  categories: {
    'session.start': { enabled: true },
    'task.acknowledge': { enabled: false },
    'task.complete': { enabled: true },
    'task.error': { enabled: true },
    'input.required': { enabled: true },
    'resource.limit': { enabled: true },
    'user.spam': { enabled: false },
    'session.end': { enabled: true },
    'task.progress': { enabled: false },
  },
}

// ---------------------------------------------------------------------------
// Event → Category Mapping
// ---------------------------------------------------------------------------

/**
 * Maps Craft Agents automation/agent events to CESP categories.
 * Returns null if the event has no sound mapping.
 */
export function mapEventToCategory(event: string): CespCategory | null {
  switch (event) {
    case 'SessionStart':
      return 'session.start'
    case 'UserPromptSubmit':
      return 'task.acknowledge'
    case 'Stop':
      return 'task.complete'
    case 'PostToolUseFailure':
      return 'task.error'
    case 'PermissionRequest':
      return 'input.required'
    case 'PreCompact':
      return 'resource.limit'
    case 'SessionEnd':
      return 'session.end'
    default:
      return null
  }
}
