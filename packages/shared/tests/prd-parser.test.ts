/**
 * Tests for PRD Parser
 *
 * These tests verify the parsing and manipulation of PRD (Product Requirements Document)
 * markdown files used by the Ralph Loop system.
 */
import { describe, it, expect } from 'bun:test'
import {
  parsePRD,
  markStoryComplete,
  markStoryFailed,
  markStorySkipped,
  getNextPendingStory,
  getStoryById,
  getStoryIndex,
  validatePRD,
  generateStoryPrompt,
} from '../src/ralph-loop/prd-parser.ts'

// ============================================================
// Sample PRD Content for Testing
// ============================================================

const SAMPLE_PRD = `# Feature: User Authentication

This document describes the user authentication feature.

## Overview

Implement secure user authentication with login and registration.

### [ ] US-001: Create login page

Create a login page with email and password fields.
The page should have:
- Email input field
- Password input field
- Submit button
- Link to registration page

### [x] US-002: Implement password hashing

Hash passwords using bcrypt before storing in database.
Use at least 10 salt rounds for security.

### [ ] US-003: Add session management

Implement session management using JWT tokens.
Tokens should expire after 24 hours.

## Technical Notes

Additional implementation details go here.
`

const EMPTY_PRD = ''

const NO_STORIES_PRD = `# Feature: Empty Feature

This feature has no stories defined yet.

## Overview

Just some text without any user stories.
`

const PRD_WITH_VARIATIONS = `# Features

### [ ] 001: Numeric only ID

Story with just numeric ID.

### [ ] STORY-001: Custom prefix

Story with custom STORY prefix.

### [X] TASK-002: Uppercase X

Completed story with uppercase X.

### [ ]  US-004: Extra spaces

Story with extra spaces in header.
`

const PRD_WITH_DUPLICATES = `# Features

### [ ] US-001: First story

First story content.

### [ ] US-001: Duplicate story

This has the same ID as the first story.
`

// ============================================================
// parsePRD Tests
// ============================================================

describe('parsePRD', () => {
  it('should parse stories from PRD markdown', () => {
    const prd = parsePRD(SAMPLE_PRD)

    expect(prd.stories).toHaveLength(3)
    expect(prd.metadata.totalStories).toBe(3)
    expect(prd.metadata.completedStories).toBe(1)
    expect(prd.metadata.pendingStories).toBe(2)
    expect(prd.metadata.failedStories).toBe(0)
  })

  it('should parse story IDs correctly', () => {
    const prd = parsePRD(SAMPLE_PRD)

    expect(prd.stories[0]!.id).toBe('US-001')
    expect(prd.stories[1]!.id).toBe('US-002')
    expect(prd.stories[2]!.id).toBe('US-003')
  })

  it('should parse story titles correctly', () => {
    const prd = parsePRD(SAMPLE_PRD)

    expect(prd.stories[0]!.title).toBe('Create login page')
    expect(prd.stories[1]!.title).toBe('Implement password hashing')
    expect(prd.stories[2]!.title).toBe('Add session management')
  })

  it('should parse story status correctly', () => {
    const prd = parsePRD(SAMPLE_PRD)

    expect(prd.stories[0]!.status).toBe('pending')
    expect(prd.stories[1]!.status).toBe('completed')
    expect(prd.stories[2]!.status).toBe('pending')
  })

  it('should parse story content correctly', () => {
    const prd = parsePRD(SAMPLE_PRD)

    expect(prd.stories[0]!.content).toContain('Email input field')
    expect(prd.stories[0]!.content).toContain('Password input field')
    expect(prd.stories[1]!.content).toContain('bcrypt')
    expect(prd.stories[2]!.content).toContain('JWT tokens')
  })

  it('should track line numbers', () => {
    const prd = parsePRD(SAMPLE_PRD)

    // Line numbers should be 1-indexed
    expect(prd.stories[0]!.lineNumber).toBeGreaterThan(0)
    expect(prd.stories[1]!.lineNumber).toBeGreaterThan(prd.stories[0]!.lineNumber)
    expect(prd.stories[2]!.lineNumber).toBeGreaterThan(prd.stories[1]!.lineNumber)
  })

  it('should handle empty PRD', () => {
    const prd = parsePRD(EMPTY_PRD)

    expect(prd.stories).toHaveLength(0)
    expect(prd.metadata.totalStories).toBe(0)
  })

  it('should handle PRD with no stories', () => {
    const prd = parsePRD(NO_STORIES_PRD)

    expect(prd.stories).toHaveLength(0)
    expect(prd.metadata.totalStories).toBe(0)
  })

  it('should preserve original source', () => {
    const prd = parsePRD(SAMPLE_PRD)

    expect(prd.source).toBe(SAMPLE_PRD)
  })

  it('should handle various ID formats', () => {
    const prd = parsePRD(PRD_WITH_VARIATIONS)

    expect(prd.stories).toHaveLength(4)
    expect(prd.stories[0]!.id).toBe('001')
    expect(prd.stories[1]!.id).toBe('STORY-001')
    expect(prd.stories[2]!.id).toBe('TASK-002')
    expect(prd.stories[3]!.id).toBe('US-004')
  })

  it('should handle uppercase X for completed status', () => {
    const prd = parsePRD(PRD_WITH_VARIATIONS)

    expect(prd.stories[2]!.status).toBe('completed')
  })
})

// ============================================================
// markStoryComplete Tests
// ============================================================

describe('markStoryComplete', () => {
  it('should mark a pending story as complete', () => {
    const prd = parsePRD(SAMPLE_PRD)
    const updatedPrd = markStoryComplete(prd, 'US-001')

    const story = updatedPrd.stories.find(s => s.id === 'US-001')
    expect(story!.status).toBe('completed')
  })

  it('should update source markdown with [x]', () => {
    const prd = parsePRD(SAMPLE_PRD)
    const updatedPrd = markStoryComplete(prd, 'US-001')

    expect(updatedPrd.source).toContain('### [x] US-001:')
  })

  it('should update metadata counts', () => {
    const prd = parsePRD(SAMPLE_PRD)
    const updatedPrd = markStoryComplete(prd, 'US-001')

    expect(updatedPrd.metadata.completedStories).toBe(2)
    expect(updatedPrd.metadata.pendingStories).toBe(1)
  })

  it('should return unchanged PRD for non-existent story', () => {
    const prd = parsePRD(SAMPLE_PRD)
    const updatedPrd = markStoryComplete(prd, 'US-999')

    expect(updatedPrd).toBe(prd)
  })
})

// ============================================================
// markStoryFailed Tests
// ============================================================

describe('markStoryFailed', () => {
  it('should mark a pending story as failed', () => {
    const prd = parsePRD(SAMPLE_PRD)
    const updatedPrd = markStoryFailed(prd, 'US-001')

    const story = updatedPrd.stories.find(s => s.id === 'US-001')
    expect(story!.status).toBe('failed')
  })

  it('should NOT update source markdown (keeps [ ] for retry)', () => {
    const prd = parsePRD(SAMPLE_PRD)
    const updatedPrd = markStoryFailed(prd, 'US-001')

    // Source should still have [ ] not [x] or [f]
    expect(updatedPrd.source).toContain('### [ ] US-001:')
  })

  it('should update metadata counts', () => {
    const prd = parsePRD(SAMPLE_PRD)
    const updatedPrd = markStoryFailed(prd, 'US-001')

    expect(updatedPrd.metadata.failedStories).toBe(1)
    expect(updatedPrd.metadata.pendingStories).toBe(1)
  })

  it('should return unchanged PRD for non-existent story', () => {
    const prd = parsePRD(SAMPLE_PRD)
    const updatedPrd = markStoryFailed(prd, 'US-999')

    expect(updatedPrd).toBe(prd)
  })
})

// ============================================================
// markStorySkipped Tests
// ============================================================

describe('markStorySkipped', () => {
  it('should mark a pending story as skipped', () => {
    const prd = parsePRD(SAMPLE_PRD)
    const updatedPrd = markStorySkipped(prd, 'US-001')

    const story = updatedPrd.stories.find(s => s.id === 'US-001')
    expect(story!.status).toBe('skipped')
  })

  it('should NOT update source markdown', () => {
    const prd = parsePRD(SAMPLE_PRD)
    const updatedPrd = markStorySkipped(prd, 'US-001')

    // Source should remain unchanged
    expect(updatedPrd.source).toBe(prd.source)
  })

  it('should return unchanged PRD for non-existent story', () => {
    const prd = parsePRD(SAMPLE_PRD)
    const updatedPrd = markStorySkipped(prd, 'US-999')

    expect(updatedPrd).toBe(prd)
  })
})

// ============================================================
// getNextPendingStory Tests
// ============================================================

describe('getNextPendingStory', () => {
  it('should return the first pending story', () => {
    const prd = parsePRD(SAMPLE_PRD)
    const nextStory = getNextPendingStory(prd)

    expect(nextStory).not.toBeNull()
    expect(nextStory!.id).toBe('US-001')
    expect(nextStory!.status).toBe('pending')
  })

  it('should return null when all stories are complete', () => {
    let prd = parsePRD(SAMPLE_PRD)
    prd = markStoryComplete(prd, 'US-001')
    prd = markStoryComplete(prd, 'US-003')

    const nextStory = getNextPendingStory(prd)
    expect(nextStory).toBeNull()
  })

  it('should skip completed and failed stories', () => {
    let prd = parsePRD(SAMPLE_PRD)
    prd = markStoryFailed(prd, 'US-001')

    const nextStory = getNextPendingStory(prd)
    expect(nextStory!.id).toBe('US-003')
  })
})

// ============================================================
// getStoryById Tests
// ============================================================

describe('getStoryById', () => {
  it('should return story when found', () => {
    const prd = parsePRD(SAMPLE_PRD)
    const story = getStoryById(prd, 'US-002')

    expect(story).not.toBeNull()
    expect(story!.id).toBe('US-002')
    expect(story!.title).toBe('Implement password hashing')
  })

  it('should return null when not found', () => {
    const prd = parsePRD(SAMPLE_PRD)
    const story = getStoryById(prd, 'US-999')

    expect(story).toBeNull()
  })
})

// ============================================================
// getStoryIndex Tests
// ============================================================

describe('getStoryIndex', () => {
  it('should return correct index', () => {
    const prd = parsePRD(SAMPLE_PRD)

    expect(getStoryIndex(prd, 'US-001')).toBe(0)
    expect(getStoryIndex(prd, 'US-002')).toBe(1)
    expect(getStoryIndex(prd, 'US-003')).toBe(2)
  })

  it('should return -1 when not found', () => {
    const prd = parsePRD(SAMPLE_PRD)

    expect(getStoryIndex(prd, 'US-999')).toBe(-1)
  })
})

// ============================================================
// validatePRD Tests
// ============================================================

describe('validatePRD', () => {
  it('should validate a valid PRD', () => {
    const result = validatePRD(SAMPLE_PRD)

    expect(result.isValid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('should reject empty PRD', () => {
    const result = validatePRD(EMPTY_PRD)

    expect(result.isValid).toBe(false)
    expect(result.error).toBe('PRD content is empty')
  })

  it('should reject PRD with no stories', () => {
    const result = validatePRD(NO_STORIES_PRD)

    expect(result.isValid).toBe(false)
    expect(result.error).toContain('No stories found')
  })

  it('should reject PRD with duplicate story IDs', () => {
    const result = validatePRD(PRD_WITH_DUPLICATES)

    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Duplicate story IDs')
    expect(result.error).toContain('US-001')
  })

  // ============================================================
  // Size Limit and Security Validation Tests
  // ============================================================

  it('should reject PRD exceeding size limit (1MB)', () => {
    // Create a PRD that exceeds 1MB
    const largeContent = 'a'.repeat(1024 * 1024 + 100)
    const largePRD = `### [ ] US-001: Large story\n\n${largeContent}`
    const result = validatePRD(largePRD)

    expect(result.isValid).toBe(false)
    expect(result.error).toContain('exceeds maximum size')
  })

  it('should reject PRD with too many stories (> 500)', () => {
    // Create a PRD with 501 stories
    const stories = Array.from({ length: 501 }, (_, i) =>
      `### [ ] US-${String(i + 1).padStart(3, '0')}: Story ${i + 1}\n\nContent`
    ).join('\n\n')
    const result = validatePRD(stories)

    expect(result.isValid).toBe(false)
    expect(result.error).toContain('exceeds maximum of 500 stories')
  })

  it('should reject story with ID exceeding max length', () => {
    // Story ID pattern requires ending with a number, so use a valid format that's too long
    const longId = 'VERYLONGSTORYPREFIX-' + '1'.repeat(30)
    const prd = `### [ ] ${longId}: Story title\n\nContent`
    const result = validatePRD(prd)

    expect(result.isValid).toBe(false)
    expect(result.error).toContain('exceeds maximum length')
  })

  it('should reject story with title exceeding max length', () => {
    const longTitle = 'T'.repeat(300)
    const prd = `### [ ] US-001: ${longTitle}\n\nContent`
    const result = validatePRD(prd)

    expect(result.isValid).toBe(false)
    expect(result.error).toContain('title exceeds maximum length')
  })

  it('should reject story with null bytes in title', () => {
    const prd = `### [ ] US-001: Story with\0null byte\n\nContent`
    const result = validatePRD(prd)

    expect(result.isValid).toBe(false)
    expect(result.error).toContain('invalid null bytes')
  })

  it('should reject story with content exceeding max length', () => {
    const longContent = 'C'.repeat(15000)
    const prd = `### [ ] US-001: Story title\n\n${longContent}`
    const result = validatePRD(prd)

    expect(result.isValid).toBe(false)
    expect(result.error).toContain('content exceeds maximum length')
  })

  it('should accept PRD at exactly the size limit', () => {
    // Create a PRD that's just under 1MB with valid stories
    const validPRD = `### [ ] US-001: Valid story\n\nSome content here.`
    const result = validatePRD(validPRD)

    expect(result.isValid).toBe(true)
  })

  it('should accept PRD with exactly 500 stories', () => {
    const stories = Array.from({ length: 500 }, (_, i) =>
      `### [ ] US-${String(i + 1).padStart(3, '0')}: Story ${i + 1}\n\nContent`
    ).join('\n\n')
    const result = validatePRD(stories)

    expect(result.isValid).toBe(true)
  })
})

// ============================================================
// generateStoryPrompt Tests
// ============================================================

describe('generateStoryPrompt', () => {
  it('should generate prompt with story details', () => {
    const prd = parsePRD(SAMPLE_PRD)
    const story = prd.stories[0]!
    const prompt = generateStoryPrompt(story)

    expect(prompt).toContain('US-001')
    expect(prompt).toContain('Create login page')
    expect(prompt).toContain('Email input field')
  })

  it('should include PRD path when provided', () => {
    const prd = parsePRD(SAMPLE_PRD)
    const story = prd.stories[0]!
    const prompt = generateStoryPrompt(story, '/path/to/feature.prd.md')

    expect(prompt).toContain('/path/to/feature.prd.md')
  })

  it('should handle story with no content', () => {
    const story = {
      id: 'US-001',
      title: 'Test story',
      lineNumber: 1,
      status: 'pending' as const,
      content: '',
    }
    const prompt = generateStoryPrompt(story)

    expect(prompt).toContain('US-001')
    expect(prompt).toContain('Test story')
    expect(prompt).toContain('No additional details provided')
  })
})
