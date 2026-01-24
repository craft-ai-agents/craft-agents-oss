/**
 * Utilities for parsing [bracket] mentions from chat messages
 *
 * Mention types:
 * - Skills:  [skill:slug]
 * - Sources: [source:slug]
 *
 * Bracket syntax allows mentions anywhere in text without word boundaries.
 */

import type { ContentBadge } from '@craft-agent/core'
import type { MentionItemType } from '@/components/ui/mention-menu'
import type { LoadedSkill, LoadedSource } from '../../shared/types'
import { getSourceIconSync, getSkillIconSync } from './icon-cache'

// ============================================================================
// Types
// ============================================================================

export interface ParsedMentions {
  /** Skill slugs mentioned via @skill-slug */
  skills: string[]
  /** Source slugs mentioned via @src:slug */
  sources: string[]
  /** File paths mentioned via [file:path] */
  files: string[]
  /** Folder paths mentioned via [folder:path] */
  folders: string[]
}

export interface MentionMatch {
  type: MentionItemType
  id: string
  /** Full match text including @ prefix */
  fullMatch: string
  /** Start index in the original text */
  startIndex: number
}

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parse all mentions from message text
 *
 * @param text - The message text to parse
 * @param availableSkillSlugs - Valid skill slugs to match against
 * @param availableSourceSlugs - Valid source slugs to match against
 * @returns Parsed mentions by type
 *
 * @example
 * parseMentions('[skill:commit] [source:linear]', ['commit'], ['linear'])
 * // Returns: { skills: ['commit'], sources: ['linear'] }
 */
export function parseMentions(
  text: string,
  availableSkillSlugs: string[],
  availableSourceSlugs: string[]
): ParsedMentions {
  const result: ParsedMentions = {
    skills: [],
    sources: [],
    files: [],
    folders: [],
  }

  // Match source mentions: [source:slug]
  const sourcePattern = /\[source:([\w-]+)\]/g
  let match
  while ((match = sourcePattern.exec(text)) !== null) {
    const slug = match[1]
    if (availableSourceSlugs.includes(slug) && !result.sources.includes(slug)) {
      result.sources.push(slug)
    }
  }

  // Match skill mentions: [skill:slug] or [skill:workspaceId:slug]
  // The pattern captures the last component (slug) after any number of colons
  const skillPattern = /\[skill:(?:[\w-]+:)?([\w-]+)\]/g
  while ((match = skillPattern.exec(text)) !== null) {
    const slug = match[1]
    if (availableSkillSlugs.includes(slug) && !result.skills.includes(slug)) {
      result.skills.push(slug)
    }
  }

  // Match file mentions: [file:path] (path can contain any chars except ])
  const filePattern = /\[file:([^\]]+)\]/g
  while ((match = filePattern.exec(text)) !== null) {
    const filePath = match[1]
    if (!result.files.includes(filePath)) {
      result.files.push(filePath)
    }
  }

  // Match folder mentions: [folder:path]
  const folderPattern = /\[folder:([^\]]+)\]/g
  while ((match = folderPattern.exec(text)) !== null) {
    const folderPath = match[1]
    if (!result.folders.includes(folderPath)) {
      result.folders.push(folderPath)
    }
  }

  return result
}

/**
 * Find all mention matches in text with their positions
 *
 * @param text - The message text to search
 * @param availableSkillSlugs - Valid skill slugs
 * @param availableSourceSlugs - Valid source slugs
 * @returns Array of mention matches with positions
 */
export function findMentionMatches(
  text: string,
  availableSkillSlugs: string[],
  availableSourceSlugs: string[]
): MentionMatch[] {
  const matches: MentionMatch[] = []

  // Match source mentions: [source:slug]
  const sourcePattern = /(\[source:([\w-]+)\])/g
  let match
  while ((match = sourcePattern.exec(text)) !== null) {
    const slug = match[2]
    if (availableSourceSlugs.includes(slug)) {
      matches.push({
        type: 'source',
        id: slug,
        fullMatch: match[1],
        startIndex: match.index,
      })
    }
  }

  // Match skill mentions: [skill:slug] or [skill:workspaceId:slug]
  // The pattern captures the full match and extracts the slug (last component)
  const skillPattern = /(\[skill:(?:[\w-]+:)?([\w-]+)\])/g
  while ((match = skillPattern.exec(text)) !== null) {
    const slug = match[2]
    if (availableSkillSlugs.includes(slug)) {
      matches.push({
        type: 'skill',
        id: slug,
        fullMatch: match[1],
        startIndex: match.index,
      })
    }
  }

  // Match file mentions: [file:path]
  const filePattern = /(\[file:([^\]]+)\])/g
  while ((match = filePattern.exec(text)) !== null) {
    matches.push({
      type: 'file',
      id: match[2],
      fullMatch: match[1],
      startIndex: match.index,
    })
  }

  // Match folder mentions: [folder:path]
  const folderPattern = /(\[folder:([^\]]+)\])/g
  while ((match = folderPattern.exec(text)) !== null) {
    matches.push({
      type: 'folder',
      id: match[2],
      fullMatch: match[1],
      startIndex: match.index,
    })
  }

  // Sort by position
  return matches.sort((a, b) => a.startIndex - b.startIndex)
}

/**
 * Remove a specific mention from text
 *
 * @param text - The message text
 * @param type - Type of mention to remove
 * @param id - ID of the mention (slug or path)
 * @returns Text with the mention removed
 */
export function removeMention(text: string, type: MentionItemType, id: string): string {
  let pattern: RegExp

  switch (type) {
    case 'source':
      pattern = new RegExp(`\\[source:${escapeRegExp(id)}\\]`, 'g')
      break
    case 'file':
      pattern = new RegExp(`\\[file:${escapeRegExp(id)}\\]`, 'g')
      break
    case 'folder':
      pattern = new RegExp(`\\[folder:${escapeRegExp(id)}\\]`, 'g')
      break
    case 'skill':
    default:
      // Match both [skill:slug] and [skill:workspaceId:slug]
      pattern = new RegExp(`\\[skill:(?:[\\w-]+:)?${escapeRegExp(id)}\\]`, 'g')
      break
  }

  return text
    .replace(pattern, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Strip all mentions from text
 *
 * @param text - The message text with mentions
 * @returns Text with all [bracket] mentions removed
 */
export function stripAllMentions(text: string): string {
  return text
    // Remove [source:slug]
    .replace(/\[source:[\w-]+\]/g, '')
    // Remove [skill:slug] or [skill:workspaceId:slug]
    .replace(/\[skill:(?:[\w-]+:)?[\w-]+\]/g, '')
    // Remove [file:path]
    .replace(/\[file:[^\]]+\]/g, '')
    // Remove [folder:path]
    .replace(/\[folder:[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Check if text contains any valid mentions
 */
export function hasMentions(
  text: string,
  availableSkillSlugs: string[],
  availableSourceSlugs: string[]
): boolean {
  const mentions = parseMentions(text, availableSkillSlugs, availableSourceSlugs)
  return mentions.skills.length > 0 || mentions.sources.length > 0 || mentions.files.length > 0 || mentions.folders.length > 0
}

// ============================================================================
// Legacy compatibility - parseSkillMentions
// ============================================================================

/**
 * Extract valid [skill:...] mentions from message text (legacy API)
 *
 * @deprecated Use parseMentions() instead
 */
export function parseSkillMentions(text: string, availableSlugs: string[]): string[] {
  return parseMentions(text, availableSlugs, []).skills
}

/**
 * Remove [bracket] mentions from message text (legacy API)
 *
 * @deprecated Use stripAllMentions() instead
 */
export function stripSkillMentions(text: string): string {
  return stripAllMentions(text)
}

// ============================================================================
// Badge Extraction
// ============================================================================

/**
 * Extract ContentBadge array from message text.
 * Used when sending messages to store badge metadata for display.
 *
 * Each badge is self-contained with label, icon (base64), and position.
 *
 * @param text - Message text with mentions
 * @param skills - Available skills (for label lookup)
 * @param sources - Available sources (for label lookup)
 * @param workspaceId - Workspace ID (for icon lookup)
 * @returns Array of ContentBadge objects
 */
export function extractBadges(
  text: string,
  skills: LoadedSkill[],
  sources: LoadedSource[],
  workspaceId: string
): ContentBadge[] {
  const skillSlugs = skills.map(s => s.slug)
  const sourceSlugs = sources.map(s => s.config.slug)
  const matches = findMentionMatches(text, skillSlugs, sourceSlugs)

  return matches.map(match => {
    let label = match.id
    let iconDataUrl: string | undefined
    let filePath: string | undefined

    if (match.type === 'skill') {
      const skill = skills.find(s => s.slug === match.id)
      label = skill?.metadata.name || match.id

      // Get cached icon as data URL (preserves mime type for SVG, PNG, etc.)
      iconDataUrl = getSkillIconSync(workspaceId, match.id) ?? undefined
    } else if (match.type === 'source') {
      const source = sources.find(s => s.config.slug === match.id)
      label = source?.config.name || match.id

      // Get cached icon as data URL (preserves mime type for SVG, PNG, etc.)
      iconDataUrl = getSourceIconSync(workspaceId, match.id) ?? undefined
    } else if (match.type === 'file') {
      // Show filename as label, full relative path stored for tooltip
      label = match.id.split('/').pop() || match.id
      filePath = match.id
    } else if (match.type === 'folder') {
      // Show folder name as label, full relative path stored for tooltip
      label = match.id.split('/').pop() || match.id
      filePath = match.id
    }

    // For skills, create fully-qualified rawText (workspaceId:slug) so the agent
    // receives the correct format for the SDK's Skill tool. The SDK requires
    // fully-qualified names to resolve skills. Display label stays as the friendly name.
    let rawText = match.fullMatch
    if (match.type === 'skill') {
      rawText = `[skill:${workspaceId}:${match.id}]`
    }

    return {
      type: match.type as 'source' | 'skill' | 'file' | 'folder',
      label,
      rawText,
      iconDataUrl,
      filePath,
      start: match.startIndex,
      end: match.startIndex + match.fullMatch.length,
    }
  })
}

// ============================================================================
// Helpers
// ============================================================================

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
