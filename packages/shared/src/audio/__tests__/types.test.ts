/**
 * Tests for CESP v1.0 types and event mapping.
 *
 * Validates:
 * - Category constants are consistent
 * - Manifest validation logic
 * - Event → category mapping
 * - Default sound settings structure
 */

import { describe, it, expect } from 'bun:test'
import {
  CESP_CORE_CATEGORIES,
  CESP_EXTENDED_CATEGORIES,
  CESP_ALL_CATEGORIES,
  type CespCategory,
  type CespManifest,
  type CespSoundEntry,
  type CespCategoryDef,
  mapEventToCategory,
  DEFAULT_SOUND_SETTINGS,
  AUDIO_MAGIC_BYTES,
  SUPPORTED_AUDIO_EXTENSIONS,
} from '../types.js'

// ---------------------------------------------------------------------------
// Category Constants
// ---------------------------------------------------------------------------

describe('CESP Categories', () => {
  it('core categories contain exactly 6 entries', () => {
    expect(CESP_CORE_CATEGORIES.length).toBe(6)
  })

  it('extended categories contain exactly 3 entries', () => {
    expect(CESP_EXTENDED_CATEGORIES.length).toBe(3)
  })

  it('all categories = core + extended', () => {
    expect(CESP_ALL_CATEGORIES).toEqual([
      ...CESP_CORE_CATEGORIES,
      ...CESP_EXTENDED_CATEGORIES,
    ])
  })

  it('core categories contain expected values', () => {
    expect(CESP_CORE_CATEGORIES).toContain('session.start')
    expect(CESP_CORE_CATEGORIES).toContain('task.acknowledge')
    expect(CESP_CORE_CATEGORIES).toContain('task.complete')
    expect(CESP_CORE_CATEGORIES).toContain('task.error')
    expect(CESP_CORE_CATEGORIES).toContain('input.required')
    expect(CESP_CORE_CATEGORIES).toContain('resource.limit')
  })

  it('extended categories contain expected values', () => {
    expect(CESP_EXTENDED_CATEGORIES).toContain('user.spam')
    expect(CESP_EXTENDED_CATEGORIES).toContain('session.end')
    expect(CESP_EXTENDED_CATEGORIES).toContain('task.progress')
  })

  it('no duplicate categories', () => {
    const set = new Set(CESP_ALL_CATEGORIES)
    expect(set.size).toBe(CESP_ALL_CATEGORIES.length)
  })
})

// ---------------------------------------------------------------------------
// Event → Category Mapping
// ---------------------------------------------------------------------------

describe('mapEventToCategory', () => {
  it('maps SessionStart → session.start', () => {
    expect(mapEventToCategory('SessionStart')).toBe('session.start')
  })

  it('maps UserPromptSubmit → task.acknowledge', () => {
    expect(mapEventToCategory('UserPromptSubmit')).toBe('task.acknowledge')
  })

  it('maps Stop → task.complete', () => {
    expect(mapEventToCategory('Stop')).toBe('task.complete')
  })

  it('maps PostToolUseFailure → task.error', () => {
    expect(mapEventToCategory('PostToolUseFailure')).toBe('task.error')
  })

  it('maps PermissionRequest → input.required', () => {
    expect(mapEventToCategory('PermissionRequest')).toBe('input.required')
  })

  it('maps PreCompact → resource.limit', () => {
    expect(mapEventToCategory('PreCompact')).toBe('resource.limit')
  })

  it('maps SessionEnd → session.end', () => {
    expect(mapEventToCategory('SessionEnd')).toBe('session.end')
  })

  it('returns null for unknown events', () => {
    expect(mapEventToCategory('UnknownEvent')).toBeNull()
    expect(mapEventToCategory('')).toBeNull()
    expect(mapEventToCategory('RandomThing')).toBeNull()
  })

  it('returns null for events without sound mapping', () => {
    // These automation events exist but have no sound mapping
    expect(mapEventToCategory('PostToolUse')).toBeNull()
    expect(mapEventToCategory('SubagentStart')).toBeNull()
    expect(mapEventToCategory('SubagentStop')).toBeNull()
    expect(mapEventToCategory('Setup')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Default Sound Settings
// ---------------------------------------------------------------------------

describe('DEFAULT_SOUND_SETTINGS', () => {
  it('has enabled: true by default', () => {
    expect(DEFAULT_SOUND_SETTINGS.enabled).toBe(true)
  })

  it('has volume between 0 and 1', () => {
    expect(DEFAULT_SOUND_SETTINGS.volume).toBeGreaterThanOrEqual(0)
    expect(DEFAULT_SOUND_SETTINGS.volume).toBeLessThanOrEqual(1)
  })

  it('has a valid default pack name', () => {
    expect(DEFAULT_SOUND_SETTINGS.defaultPack).toBe('default')
    expect(typeof DEFAULT_SOUND_SETTINGS.defaultPack).toBe('string')
  })

  it('has a non-negative cooldown', () => {
    expect(DEFAULT_SOUND_SETTINGS.cooldownMs).toBeGreaterThanOrEqual(0)
  })

  it('has noRepeat enabled by default', () => {
    expect(DEFAULT_SOUND_SETTINGS.noRepeat).toBe(true)
  })

  it('core categories are enabled by default', () => {
    const categories = DEFAULT_SOUND_SETTINGS.categories
    expect(categories['session.start']?.enabled).toBe(true)
    expect(categories['task.complete']?.enabled).toBe(true)
    expect(categories['task.error']?.enabled).toBe(true)
    expect(categories['input.required']?.enabled).toBe(true)
    expect(categories['resource.limit']?.enabled).toBe(true)
  })

  it('extended categories are disabled by default', () => {
    const categories = DEFAULT_SOUND_SETTINGS.categories
    expect(categories['user.spam']?.enabled).toBe(false)
    expect(categories['session.end']?.enabled).toBe(false)
    expect(categories['task.progress']?.enabled).toBe(false)
  })

  it('task.acknowledge is disabled by default (avoids notification fatigue)', () => {
    expect(DEFAULT_SOUND_SETTINGS.categories['task.acknowledge']?.enabled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Audio Format Constants
// ---------------------------------------------------------------------------

describe('Audio Format Constants', () => {
  it('AUDIO_MAGIC_BYTES has expected formats', () => {
    expect(AUDIO_MAGIC_BYTES.wav).toBeDefined()
    expect(AUDIO_MAGIC_BYTES.mp3_id3).toBeDefined()
    expect(AUDIO_MAGIC_BYTES.mp3_sync).toBeDefined()
    expect(AUDIO_MAGIC_BYTES.ogg).toBeDefined()
  })

  it('SUPPORTED_AUDIO_EXTENSIONS includes expected formats', () => {
    expect(SUPPORTED_AUDIO_EXTENSIONS).toContain('.wav')
    expect(SUPPORTED_AUDIO_EXTENSIONS).toContain('.mp3')
    expect(SUPPORTED_AUDIO_EXTENSIONS).toContain('.ogg')
    expect(SUPPORTED_AUDIO_EXTENSIONS).toContain('.oga')
  })
})

// ---------------------------------------------------------------------------
// Manifest Type Validation (structural)
// ---------------------------------------------------------------------------

describe('CESP Manifest Structure', () => {
  function createValidManifest(overrides?: Partial<CespManifest>): CespManifest {
    return {
      cesp_version: '1.0',
      name: 'test-pack',
      display_name: 'Test Pack',
      version: '1.0.0',
      categories: {
        'session.start': {
          sounds: [{ file: 'start.mp3', label: 'Session Start' }],
        },
        'task.complete': {
          sounds: [{ file: 'complete.mp3' }],
        },
      },
      ...overrides,
    }
  }

  it('creates a valid manifest with minimal fields', () => {
    const manifest = createValidManifest()
    expect(manifest.cesp_version).toBe('1.0')
    expect(manifest.name).toBe('test-pack')
    expect(manifest.categories['session.start']).toBeDefined()
  })

  it('manifest can include optional fields', () => {
    const manifest = createValidManifest({
      description: 'A test pack',
      author: { name: 'Test Author', github: 'testauthor' },
      language: 'en',
      category_aliases: [{ from: 'complete', to: 'task.complete' }],
    })

    expect(manifest.description).toBe('A test pack')
    expect(manifest.author?.name).toBe('Test Author')
    expect(manifest.language).toBe('en')
    expect(manifest.category_aliases?.length).toBe(1)
  })

  it('category can have multiple sounds', () => {
    const manifest = createValidManifest({
      categories: {
        'task.complete': {
          sounds: [
            { file: 'complete-1.mp3' },
            { file: 'complete-2.mp3' },
            { file: 'complete-3.wav' },
          ],
        },
      },
    })

    expect(manifest.categories['task.complete']?.sounds.length).toBe(3)
  })

  it('sound entries can have optional sha256 and label', () => {
    const entry: CespSoundEntry = {
      file: 'test.mp3',
      label: 'Test Sound',
      sha256: 'abc123def456',
    }

    expect(entry.file).toBe('test.mp3')
    expect(entry.label).toBe('Test Sound')
    expect(entry.sha256).toBe('abc123def456')
  })
})
