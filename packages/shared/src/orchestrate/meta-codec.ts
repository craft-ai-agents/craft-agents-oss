/**
 * Meta Codec
 *
 * Encodes and decodes Orchestrate metadata in task descriptions.
 * Metadata is stored as an HTML comment to preserve it invisibly
 * while keeping descriptions readable.
 *
 * Format: <!-- orchestrate-meta: {"storyId":"...", ...} -->
 */

import type { OrchestrateMeta } from './types.ts'

/** HTML comment prefix for metadata */
const META_PREFIX = '<!-- orchestrate-meta: '
const META_SUFFIX = ' -->'

/** Regex pattern to extract metadata (non-greedy to handle edge cases) */
const META_PATTERN = /<!-- orchestrate-meta: ({[^}]+}) -->/

/**
 * Encode metadata into a description string
 *
 * @param content - Original story content
 * @param meta - Metadata to embed
 * @returns Content with embedded metadata as HTML comment
 */
export function encodeMeta(content: string, meta: OrchestrateMeta): string {
  const metaJson = JSON.stringify(meta)
  return `${content}\n\n${META_PREFIX}${metaJson}${META_SUFFIX}`
}

/**
 * Decode metadata from a description string
 *
 * @param description - Task description that may contain metadata
 * @returns Extracted metadata or null if not found
 */
export function decodeMeta(description: string): OrchestrateMeta | null {
  const match = description.match(META_PATTERN)
  if (!match || !match[1]) {
    return null
  }

  try {
    const parsed = JSON.parse(match[1])

    // Validate required fields
    if (
      typeof parsed.storyId !== 'string' ||
      typeof parsed.orchestrateId !== 'string' ||
      typeof parsed.lineNumber !== 'number'
    ) {
      return null
    }

    return parsed as OrchestrateMeta
  } catch {
    return null
  }
}

/**
 * Remove metadata from a description string
 *
 * @param description - Task description that may contain metadata
 * @returns Description with metadata removed
 */
export function stripMeta(description: string): string {
  return description.replace(META_PATTERN, '').trim()
}

/**
 * Check if a description contains Orchestrate metadata
 *
 * @param description - Task description to check
 * @returns True if metadata is present
 */
export function hasMeta(description: string): boolean {
  return META_PATTERN.test(description)
}
