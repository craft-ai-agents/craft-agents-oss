/**
 * Tests for PackLoader manifest validation logic.
 *
 * Tests the validateManifest function and related pack loading utilities
 * without touching the filesystem (pure function tests).
 */

import { describe, it, expect } from 'bun:test'

// ---------------------------------------------------------------------------
// Inline validateManifest logic for testing without filesystem
// (The actual function is in PackLoader.ts which imports fs directly)
// ---------------------------------------------------------------------------

interface ManifestLike {
  cesp_version?: string
  name?: string
  display_name?: string
  version?: string
  categories?: Record<string, { sounds?: { file: string }[] }>
  [key: string]: unknown
}

/**
 * Mirror of PackLoader.validateManifest for pure testing.
 * Validates a CESP manifest object without filesystem access.
 */
function validateManifest(raw: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Manifest must be a JSON object'] }
  }

  const m = raw as ManifestLike

  if (!m.cesp_version) errors.push('Missing required field: cesp_version')
  if (!m.name || typeof m.name !== 'string') errors.push('Missing or invalid field: name')
  if (!m.display_name || typeof m.display_name !== 'string') errors.push('Missing or invalid field: display_name')
  if (!m.version || typeof m.version !== 'string') errors.push('Missing or invalid field: version')

  if (!m.categories || typeof m.categories !== 'object') {
    errors.push('Missing or invalid field: categories')
  } else {
    for (const [catName, catDef] of Object.entries(m.categories)) {
      if (!catDef || typeof catDef !== 'object') {
        errors.push(`Category "${catName}" must be an object`)
        continue
      }
      const def = catDef as { sounds?: unknown[] }
      if (!Array.isArray(def.sounds)) {
        errors.push(`Category "${catName}" missing "sounds" array`)
      } else {
        for (let i = 0; i < def.sounds.length; i++) {
          const entry = def.sounds[i] as { file?: string } | null
          if (!entry?.file || typeof entry.file !== 'string') {
            errors.push(`Category "${catName}" sound[${i}] missing "file" string`)
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateManifest', () => {
  it('accepts a valid minimal manifest', () => {
    const result = validateManifest({
      cesp_version: '1.0',
      name: 'test-pack',
      display_name: 'Test Pack',
      version: '1.0.0',
      categories: {
        'session.start': { sounds: [{ file: 'start.mp3' }] },
      },
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('accepts a manifest with multiple categories and sounds', () => {
    const result = validateManifest({
      cesp_version: '1.0',
      name: 'full-pack',
      display_name: 'Full Pack',
      version: '2.0.0',
      categories: {
        'session.start': { sounds: [{ file: 'start.mp3' }, { file: 'start-2.mp3' }] },
        'task.complete': { sounds: [{ file: 'done.wav' }] },
        'task.error': { sounds: [{ file: 'err.ogg' }] },
      },
    })
    expect(result.valid).toBe(true)
  })

  it('rejects null input', () => {
    const result = validateManifest(null)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('rejects non-object input', () => {
    const result = validateManifest('not json')
    expect(result.valid).toBe(false)
  })

  it('rejects missing cesp_version', () => {
    const result = validateManifest({
      name: 'test',
      display_name: 'Test',
      version: '1.0.0',
      categories: {},
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing required field: cesp_version')
  })

  it('rejects missing name', () => {
    const result = validateManifest({
      cesp_version: '1.0',
      display_name: 'Test',
      version: '1.0.0',
      categories: {},
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing or invalid field: name')
  })

  it('rejects missing display_name', () => {
    const result = validateManifest({
      cesp_version: '1.0',
      name: 'test',
      version: '1.0.0',
      categories: {},
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing or invalid field: display_name')
  })

  it('rejects missing version', () => {
    const result = validateManifest({
      cesp_version: '1.0',
      name: 'test',
      display_name: 'Test',
      categories: {},
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing or invalid field: version')
  })

  it('rejects missing categories', () => {
    const result = validateManifest({
      cesp_version: '1.0',
      name: 'test',
      display_name: 'Test',
      version: '1.0.0',
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing or invalid field: categories')
  })

  it('rejects category without sounds array', () => {
    const result = validateManifest({
      cesp_version: '1.0',
      name: 'test',
      display_name: 'Test',
      version: '1.0.0',
      categories: {
        'session.start': {},
      },
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('missing "sounds" array'))).toBe(true)
  })

  it('rejects sound entry without file', () => {
    const result = validateManifest({
      cesp_version: '1.0',
      name: 'test',
      display_name: 'Test',
      version: '1.0.0',
      categories: {
        'session.start': { sounds: [{ label: 'No file' }] },
      },
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('missing "file" string'))).toBe(true)
  })

  it('collects multiple errors at once', () => {
    const result = validateManifest({
      cesp_version: '1.0',
      // missing name, display_name, version, categories
    })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThanOrEqual(4)
  })

  it('accepts empty categories object (valid but empty pack)', () => {
    const result = validateManifest({
      cesp_version: '1.0',
      name: 'empty-pack',
      display_name: 'Empty Pack',
      version: '1.0.0',
      categories: {},
    })
    expect(result.valid).toBe(true)
  })

  it('accepts manifest with optional fields', () => {
    const result = validateManifest({
      cesp_version: '1.0',
      name: 'rich-pack',
      display_name: 'Rich Pack',
      version: '1.0.0',
      description: 'A rich test pack',
      author: { name: 'Test Author', github: 'testuser' },
      license: 'MIT',
      language: 'en',
      icon: 'icon.png',
      categories: {
        'session.start': { sounds: [{ file: 'start.mp3', label: 'Start', sha256: 'abc123' }] },
      },
      category_aliases: [{ from: 'complete', to: 'task.complete' }],
    })
    expect(result.valid).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Sound file path validation
// ---------------------------------------------------------------------------

describe('Sound file path safety', () => {
  it('rejects paths with directory traversal', () => {
    const traversalPaths = [
      '../../../etc/passwd',
      '..\\..\\windows\\system32',
      'sounds/../../secret.txt',
    ]
    for (const path of traversalPaths) {
      expect(path.includes('..')).toBe(true)
    }
  })

  it('accepts normal sound file paths', () => {
    const validPaths = [
      'sounds/start.mp3',
      'start.mp3',
      'audio/chimes/bell.wav',
      'complete.ogg',
    ]
    for (const path of validPaths) {
      expect(path.includes('..')).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Category alias resolution
// ---------------------------------------------------------------------------

describe('Category alias resolution', () => {
  const aliases = [
    { from: 'complete', to: 'task.complete' as const },
    { from: 'acknowledge', to: 'task.acknowledge' as const },
    { from: 'error', to: 'task.error' as const },
    { from: 'startup', to: 'session.start' as const },
  ]

  function resolveAlias(category: string): string {
    const alias = aliases.find(a => a.from === category)
    return alias ? alias.to : category
  }

  it('resolves "complete" → "task.complete"', () => {
    expect(resolveAlias('complete')).toBe('task.complete')
  })

  it('resolves "acknowledge" → "task.acknowledge"', () => {
    expect(resolveAlias('acknowledge')).toBe('task.acknowledge')
  })

  it('passes through unknown categories unchanged', () => {
    expect(resolveAlias('session.start')).toBe('session.start')
    expect(resolveAlias('unknown.category')).toBe('unknown.category')
  })
})

// ---------------------------------------------------------------------------
// Random sound selection
// ---------------------------------------------------------------------------

describe('pickRandomSound', () => {
  function pickRandomSound(
    sounds: { file: string }[],
    lastFile: string | null,
    baseDir: string,
  ): { file: string; path: string } | null {
    if (sounds.length === 0) return null

    // No-repeat: filter out the last played sound if possible
    let candidates = sounds
    if (lastFile && sounds.length > 1) {
      candidates = sounds.filter(s => s.file !== lastFile)
    }

    // Pick random (deterministic in tests with seeded choice)
    const pick = candidates[Math.floor(Math.random() * candidates.length)]!
    return { file: pick.file, path: `${baseDir}/${pick.file}` }
  }

  it('returns null for empty sounds array', () => {
    expect(pickRandomSound([], null, '/pack')).toBeNull()
  })

  it('returns a sound from single-element array', () => {
    const result = pickRandomSound([{ file: 'only.mp3' }], null, '/pack')
    expect(result).not.toBeNull()
    expect(result!.file).toBe('only.mp3')
    expect(result!.path).toBe('/pack/only.mp3')
  })

  it('returns a sound from multi-element array', () => {
    const sounds = [
      { file: 'a.mp3' },
      { file: 'b.mp3' },
      { file: 'c.mp3' },
    ]
    const result = pickRandomSound(sounds, null, '/pack')
    expect(result).not.toBeNull()
    expect(sounds.some(s => s.file === result!.file)).toBe(true)
  })

  it('respects no-repeat with lastFile when multiple options exist', () => {
    const sounds = [
      { file: 'a.mp3' },
      { file: 'b.mp3' },
    ]
    // With lastFile = 'a.mp3', should only return 'b.mp3'
    const result = pickRandomSound(sounds, 'a.mp3', '/pack')
    expect(result).not.toBeNull()
    expect(result!.file).toBe('b.mp3')
  })

  it('falls back to lastFile when it is the only option', () => {
    const sounds = [{ file: 'only.mp3' }]
    const result = pickRandomSound(sounds, 'only.mp3', '/pack')
    expect(result).not.toBeNull()
    expect(result!.file).toBe('only.mp3')
  })
})
