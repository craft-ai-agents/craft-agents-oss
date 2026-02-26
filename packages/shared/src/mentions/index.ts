/**
 * Mention Parsing Utilities
 *
 * Pure string-parsing functions for [bracket] mentions in chat messages.
 * No renderer/browser dependencies — safe to use in any context.
 *
 * Mention types:
 * - Skills:  [skill:slug] or [skill:workspaceId:slug]
 * - Sources: [source:slug]
 * - Files:   [file:path]
 * - Folders: [folder:path]
 */

// ============================================================================
// Constants
// ============================================================================

// Workspace ID character class for regex: word chars, spaces (NOT newlines), hyphens, dots
// Using literal space instead of \s to avoid matching newlines which would break parsing
export const WS_ID_CHARS = '[\\w .-]'

// ============================================================================
// Types
// ============================================================================

export interface ParsedMentions {
  /** Skill slugs mentioned via [skill:slug] */
  skills: string[]
  /** Invalid skill slugs mentioned but not found in availableSkillSlugs */
  invalidSkills: string[]
  /** Source slugs mentioned via [source:slug] */
  sources: string[]
  /** File paths mentioned via [file:path] */
  files: string[]
  /** Folder paths mentioned via [folder:path] */
  folders: string[]
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
    invalidSkills: [],
    sources: [],
    files: [],
    folders: [],
  }

  // Match source mentions: [source:slug]
  const sourcePattern = /\[source:([\w-]+)\]/g
  let match: RegExpExecArray | null
  while ((match = sourcePattern.exec(text)) !== null) {
    const slug = match[1]!
    if (availableSourceSlugs.includes(slug) && !result.sources.includes(slug)) {
      result.sources.push(slug)
    }
  }

  // Match skill mentions: [skill:slug] or [skill:workspaceId:slug]
  // The pattern captures the last component (slug) after any number of colons
  // Workspace IDs can contain spaces, hyphens, underscores, and dots
  const skillPattern = new RegExp(`\\[skill:(?:${WS_ID_CHARS}+:)?([\\w-]+)\\]`, 'g')
  while ((match = skillPattern.exec(text)) !== null) {
    const slug = match[1]!
    if (availableSkillSlugs.includes(slug)) {
      if (!result.skills.includes(slug)) {
        result.skills.push(slug)
      }
    } else {
      if (!result.invalidSkills.includes(slug)) {
        result.invalidSkills.push(slug)
      }
    }
  }

  // Match file mentions: [file:path] (path can contain any chars except ])
  const filePattern = /\[file:([^\]]+)\]/g
  while ((match = filePattern.exec(text)) !== null) {
    const filePath = match[1]!
    if (!result.files.includes(filePath)) {
      result.files.push(filePath)
    }
  }

  // Match folder mentions: [folder:path]
  const folderPattern = /\[folder:([^\]]+)\]/g
  while ((match = folderPattern.exec(text)) !== null) {
    const folderPath = match[1]!
    if (!result.folders.includes(folderPath)) {
      result.folders.push(folderPath)
    }
  }

  return result
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
    // Workspace IDs can contain spaces, hyphens, underscores, and dots
    .replace(new RegExp(`\\[skill:(?:${WS_ID_CHARS}+:)?[\\w-]+\\]`, 'g'), '')
    // Remove [file:path]
    .replace(/\[file:[^\]]+\]/g, '')
    // Remove [folder:path]
    .replace(/\[folder:[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Strip only skill and source mentions from text, preserving file/folder paths.
 *
 * Unlike stripAllMentions, this converts [file:path] and [folder:path] to their
 * plain paths so the agent can still act on them (e.g. read the file).
 *
 * @param text - The message text with mentions
 * @returns Text with skill/source mentions removed and file/folder mentions replaced by their paths
 */
export function stripSkillAndSourceMentions(text: string): string {
  return text
    // Remove [source:slug]
    .replace(/\[source:[\w-]+\]/g, '')
    // Remove [skill:slug] or [skill:workspaceId:slug]
    .replace(new RegExp(`\\[skill:(?:${WS_ID_CHARS}+:)?[\\w-]+\\]`, 'g'), '')
    // Replace [file:path] with the bare path so the agent can read it
    .replace(/\[file:([^\]]+)\]/g, '$1')
    // Replace [folder:path] with the bare path
    .replace(/\[folder:([^\]]+)\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}
