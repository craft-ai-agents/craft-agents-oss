/**
 * PRD Parser
 *
 * Parses PRD (Product Requirements Document) markdown files into structured
 * Story objects. Supports the Ralph Loop checkbox format:
 *
 * ### [ ] US-001: Story title
 * Story content...
 *
 * ### [x] US-002: Completed story
 * Story content...
 */

import type { PRD, Story, StoryStatus } from './types.ts'

/**
 * Regex pattern for matching story headers
 * Matches: ### [ ] US-XXX: Title or ### [x] US-XXX: Title
 * Also supports variations like:
 * - ### [ ] 001: Title (numeric only)
 * - ### [ ] STORY-001: Title (custom prefix)
 */
const STORY_HEADER_PATTERN = /^###\s*\[([ xX])\]\s*([A-Za-z]*-?\d+):\s*(.+)$/

/**
 * Parse a PRD markdown string into a structured PRD object
 *
 * @param markdown - The PRD markdown content
 * @returns Parsed PRD with extracted stories
 */
export function parsePRD(markdown: string): PRD {
  const lines = markdown.split('\n')
  const stories: Story[] = []

  let currentStory: Partial<Story> | null = null
  let contentLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const lineNumber = i + 1 // 1-indexed for user display
    const match = line.match(STORY_HEADER_PATTERN)

    if (match) {
      // Save previous story if exists
      if (currentStory && currentStory.id) {
        stories.push({
          ...currentStory,
          content: contentLines.join('\n').trim(),
        } as Story)
      }

      // Start new story
      const checkbox = match[1]!
      const id = match[2]!
      const title = match[3]!
      const isCompleted = checkbox.toLowerCase() === 'x'

      currentStory = {
        id,
        title: title.trim(),
        lineNumber,
        status: isCompleted ? 'completed' : 'pending',
      }
      contentLines = []
    } else if (currentStory) {
      // Accumulate content for current story
      contentLines.push(line)
    }
  }

  // Don't forget the last story
  if (currentStory && currentStory.id) {
    stories.push({
      ...currentStory,
      content: contentLines.join('\n').trim(),
    } as Story)
  }

  // Calculate metadata
  const completedStories = stories.filter((s) => s.status === 'completed').length
  const failedStories = stories.filter((s) => s.status === 'failed').length
  const pendingStories = stories.filter((s) => s.status === 'pending').length

  return {
    source: markdown,
    stories,
    metadata: {
      totalStories: stories.length,
      completedStories,
      pendingStories,
      failedStories,
    },
  }
}

/**
 * Mark a story as complete in the PRD
 * Returns a new PRD with updated source and story status
 *
 * @param prd - The PRD to update
 * @param storyId - ID of the story to mark complete
 * @returns New PRD with story marked complete
 */
export function markStoryComplete(prd: PRD, storyId: string): PRD {
  const story = prd.stories.find((s) => s.id === storyId)
  if (!story) {
    return prd
  }

  // Update the source markdown
  const lines = prd.source.split('\n')
  const lineIndex = story.lineNumber - 1 // Convert to 0-indexed

  if (lineIndex >= 0 && lineIndex < lines.length) {
    // Replace [ ] with [x] in the story header
    lines[lineIndex] = lines[lineIndex]!.replace(/\[\s\]/, '[x]')
  }

  const newSource = lines.join('\n')

  // Update stories array
  const newStories = prd.stories.map((s) =>
    s.id === storyId ? { ...s, status: 'completed' as StoryStatus } : s
  )

  // Recalculate metadata
  const completedStories = newStories.filter((s) => s.status === 'completed').length
  const failedStories = newStories.filter((s) => s.status === 'failed').length
  const pendingStories = newStories.filter((s) => s.status === 'pending').length

  return {
    source: newSource,
    stories: newStories,
    metadata: {
      totalStories: newStories.length,
      completedStories,
      pendingStories,
      failedStories,
    },
  }
}

/**
 * Mark a story as failed in the PRD
 * Returns a new PRD with updated story status (source unchanged - keeps [ ])
 *
 * @param prd - The PRD to update
 * @param storyId - ID of the story to mark failed
 * @returns New PRD with story marked failed
 */
export function markStoryFailed(prd: PRD, storyId: string): PRD {
  const story = prd.stories.find((s) => s.id === storyId)
  if (!story) {
    return prd
  }

  // Update stories array (don't modify source - keep [ ] for retry)
  const newStories = prd.stories.map((s) =>
    s.id === storyId ? { ...s, status: 'failed' as StoryStatus } : s
  )

  // Recalculate metadata
  const completedStories = newStories.filter((s) => s.status === 'completed').length
  const failedStories = newStories.filter((s) => s.status === 'failed').length
  const pendingStories = newStories.filter((s) => s.status === 'pending').length

  return {
    source: prd.source,
    stories: newStories,
    metadata: {
      totalStories: newStories.length,
      completedStories,
      pendingStories,
      failedStories,
    },
  }
}

/**
 * Mark a story as skipped in the PRD
 *
 * @param prd - The PRD to update
 * @param storyId - ID of the story to mark skipped
 * @returns New PRD with story marked skipped
 */
export function markStorySkipped(prd: PRD, storyId: string): PRD {
  const story = prd.stories.find((s) => s.id === storyId)
  if (!story) {
    return prd
  }

  const newStories = prd.stories.map((s) =>
    s.id === storyId ? { ...s, status: 'skipped' as StoryStatus } : s
  )

  const completedStories = newStories.filter((s) => s.status === 'completed').length
  const failedStories = newStories.filter((s) => s.status === 'failed').length
  const pendingStories = newStories.filter((s) => s.status === 'pending').length

  return {
    source: prd.source,
    stories: newStories,
    metadata: {
      totalStories: newStories.length,
      completedStories,
      pendingStories,
      failedStories,
    },
  }
}

/**
 * Get the next pending story in the PRD
 *
 * @param prd - The PRD to search
 * @returns Next pending story or null if all complete/failed
 */
export function getNextPendingStory(prd: PRD): Story | null {
  return prd.stories.find((s) => s.status === 'pending') || null
}

/**
 * Get a story by its ID
 *
 * @param prd - The PRD to search
 * @param storyId - ID of the story to find
 * @returns Story if found, null otherwise
 */
export function getStoryById(prd: PRD, storyId: string): Story | null {
  return prd.stories.find((s) => s.id === storyId) || null
}

/**
 * Get the index of a story in the PRD
 *
 * @param prd - The PRD to search
 * @param storyId - ID of the story to find
 * @returns 0-indexed position or -1 if not found
 */
export function getStoryIndex(prd: PRD, storyId: string): number {
  return prd.stories.findIndex((s) => s.id === storyId)
}

/**
 * Validate that a string is a valid PRD format
 *
 * @param markdown - The markdown content to validate
 * @returns Object with isValid flag and optional error message
 */
export function validatePRD(markdown: string): { isValid: boolean; error?: string } {
  if (!markdown || markdown.trim().length === 0) {
    return { isValid: false, error: 'PRD content is empty' }
  }

  const prd = parsePRD(markdown)

  if (prd.stories.length === 0) {
    return {
      isValid: false,
      error: 'No stories found. Stories should be formatted as: ### [ ] US-001: Story title',
    }
  }

  // Check for duplicate story IDs
  const ids = prd.stories.map((s) => s.id)
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
  if (duplicates.length > 0) {
    return {
      isValid: false,
      error: `Duplicate story IDs found: ${[...new Set(duplicates)].join(', ')}`,
    }
  }

  return { isValid: true }
}

/**
 * Generate a prompt for the agent to work on a story
 *
 * @param story - The story to generate a prompt for
 * @param prdPath - Optional path to the PRD file for context
 * @returns Formatted prompt string
 */
export function generateStoryPrompt(story: Story, prdPath?: string): string {
  const lines = [
    `# Task: ${story.id} - ${story.title}`,
    '',
    '## Instructions',
    '',
    'Complete the following user story. When done, make sure to commit your changes.',
    '',
    '## Story Details',
    '',
    story.content || '(No additional details provided)',
    '',
    '## Requirements',
    '',
    '1. Implement the feature/fix described above',
    '2. Write tests if applicable',
    '3. Commit your changes with a descriptive message',
    '4. The commit message should follow the format: feat(${story.id}): <description>',
  ]

  if (prdPath) {
    lines.push('', `PRD Location: ${prdPath}`)
  }

  return lines.join('\n')
}
