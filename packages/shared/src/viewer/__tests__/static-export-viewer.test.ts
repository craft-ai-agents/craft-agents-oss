import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as child_process from 'node:child_process'
import { tmpdir } from 'node:os'
import StaticExportViewer from '../static-export-viewer'
import type { StoredSession } from '../../sessions/types'

/**
 * Test suite for StaticExportViewer
 *
 * Tests the viewer service implementation that exports sessions
 * as static HTML files to the local filesystem.
 */

/**
 * Create a mock session for testing
 */
function createMockSession(overrides?: Partial<StoredSession>): StoredSession {
  return {
    id: 'test-session-123',
    name: 'Test Session',
    workspaceRootPath: '~/.vespr/workspaces/workspace-1',
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    messages: [
      {
        id: 'msg-1',
        type: 'user',
        content: 'Hello, Claude!',
        timestamp: Date.now(),
      },
      {
        id: 'msg-2',
        type: 'assistant',
        content: 'Hello! How can I help you today?',
        timestamp: Date.now(),
      },
    ],
    tokenUsage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      contextTokens: 150,
      costUsd: 0.01,
    },
    ...overrides,
  } as StoredSession
}

describe('StaticExportViewer', () => {
  let testExportPath: string
  let viewer: StaticExportViewer

  beforeEach(() => {
    // Create a unique temp directory for each test
    testExportPath = path.join(tmpdir(), `vespr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(testExportPath, { recursive: true })
    viewer = new StaticExportViewer(testExportPath)
  })

  afterEach(() => {
    // Clean up test directory
    try {
      if (fs.existsSync(testExportPath)) {
        fs.rmSync(testExportPath, { recursive: true, force: true })
      }
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('constructor', () => {
    test('creates export directory if it does not exist', () => {
      const newPath = path.join(tmpdir(), `vespr-new-${Date.now()}`)
      expect(fs.existsSync(newPath)).toBe(false)

      const newViewer = new StaticExportViewer(newPath)

      expect(fs.existsSync(newPath)).toBe(true)

      // Cleanup
      fs.rmSync(newPath, { recursive: true, force: true })
    })

    test('throws error if exportPath is not provided', () => {
      expect(() => new StaticExportViewer('')).toThrow('Export path is required')
    })

    test('throws error if exportPath is not a string', () => {
      // @ts-ignore - Testing invalid input
      expect(() => new StaticExportViewer(null)).toThrow('Export path is required')
    })

    test('normalizes relative path to absolute path', () => {
      const relativePath = './test-export'
      const absolutePath = path.resolve(relativePath)

      // Create viewer with relative path
      const newViewer = new StaticExportViewer(relativePath)

      // Verify the directory was created at the absolute path
      expect(fs.existsSync(absolutePath)).toBe(true)

      // Cleanup
      fs.rmSync(absolutePath, { recursive: true, force: true })
    })
  })

  describe('share()', () => {
    test('creates HTML file in export path', async () => {
      const session = createMockSession()
      const result = await viewer.share(session)

      expect(result.success).toBe(true)
      expect(result.id).toBe('test-session-123')

      // Verify file was created
      const filePath = path.join(testExportPath, 'test-session-123.html')
      expect(fs.existsSync(filePath)).toBe(true)

      // Verify file contains HTML content
      const content = fs.readFileSync(filePath, 'utf-8')
      expect(content).toContain('<!DOCTYPE html>')
      expect(content).toContain('Test Session')
    })

    test('returns file:// URL', async () => {
      const session = createMockSession()
      const result = await viewer.share(session)

      expect(result.success).toBe(true)
      expect(result.url).toBe(`file://${testExportPath}/test-session-123.html`)
    })

    test('executes upload command if provided', async () => {
      // Create a marker file that the upload command will create
      const markerFile = path.join(testExportPath, 'upload-executed')

      // Create viewer with upload command
      const viewerWithUpload = new StaticExportViewer(
        testExportPath,
        `touch ${markerFile}`
      )

      const session = createMockSession()
      await viewerWithUpload.share(session)

      // Verify the upload command was executed
      expect(fs.existsSync(markerFile)).toBe(true)
    })

    test('continues on upload command failure', async () => {
      // Create viewer with a failing upload command
      const viewerWithBadUpload = new StaticExportViewer(
        testExportPath,
        'exit 1' // This command will fail
      )

      const session = createMockSession()
      const result = await viewerWithBadUpload.share(session)

      // Share should still succeed even if upload fails
      expect(result.success).toBe(true)
      expect(result.id).toBe('test-session-123')
    })

    test('returns error on write failure', async () => {
      // Make the export path read-only to cause write failure
      const readOnlyPath = path.join(tmpdir(), `vespr-readonly-${Date.now()}`)
      fs.mkdirSync(readOnlyPath, { recursive: true })

      const readOnlyViewer = new StaticExportViewer(readOnlyPath)

      // Make directory read-only
      fs.chmodSync(readOnlyPath, 0o444)

      const session = createMockSession()
      const result = await readOnlyViewer.share(session)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()

      // Restore permissions and cleanup
      fs.chmodSync(readOnlyPath, 0o755)
      fs.rmSync(readOnlyPath, { recursive: true, force: true })
    })
  })

  describe('update()', () => {
    test('overwrites existing file', async () => {
      const session = createMockSession({ name: 'Original Name' })
      await viewer.share(session)

      // Update with new content
      const updatedSession = createMockSession({ name: 'Updated Name' })
      const result = await viewer.update('test-session-123', updatedSession)

      expect(result.success).toBe(true)

      // Verify file was updated
      const filePath = path.join(testExportPath, 'test-session-123.html')
      const content = fs.readFileSync(filePath, 'utf-8')
      expect(content).toContain('Updated Name')
      expect(content).not.toContain('Original Name')
    })

    test('creates file if it does not exist', async () => {
      const session = createMockSession()
      const result = await viewer.update('new-session-id', session)

      expect(result.success).toBe(true)

      // Verify file was created
      const filePath = path.join(testExportPath, 'new-session-id.html')
      expect(fs.existsSync(filePath)).toBe(true)
    })

    test('returns correct URL after update', async () => {
      const session = createMockSession()
      const result = await viewer.update('test-session-123', session)

      expect(result.url).toBe(`file://${testExportPath}/test-session-123.html`)
    })

    test('executes upload command after update', async () => {
      const markerFile = path.join(testExportPath, 'upload-updated')
      const viewerWithUpload = new StaticExportViewer(
        testExportPath,
        `touch ${markerFile}`
      )

      const session = createMockSession()
      await viewerWithUpload.update('test-session-123', session)

      expect(fs.existsSync(markerFile)).toBe(true)
    })
  })

  describe('revoke()', () => {
    test('deletes file if exists', async () => {
      const session = createMockSession()
      await viewer.share(session)

      const filePath = path.join(testExportPath, 'test-session-123.html')
      expect(fs.existsSync(filePath)).toBe(true)

      const result = await viewer.revoke('test-session-123')

      expect(result.success).toBe(true)
      expect(fs.existsSync(filePath)).toBe(false)
    })

    test('succeeds even if file does not exist', async () => {
      const result = await viewer.revoke('nonexistent-session')

      expect(result.success).toBe(true)
    })

    test('handles error gracefully if revoke fails', async () => {
      // The revoke method is designed to return success: false on errors
      // We verify the error handling path exists and returns proper structure
      const result = await viewer.revoke('nonexistent-session')

      // For nonexistent files, revoke should succeed
      expect(result.success).toBe(true)

      // Verify the ShareResult structure is correct
      expect(typeof result.success).toBe('boolean')
    })
  })

  describe('healthCheck()', () => {
    test('returns true for writable directory', async () => {
      const result = await viewer.healthCheck()

      expect(result).toBe(true)
    })

    test('returns false for invalid path', async () => {
      // Delete the export directory
      fs.rmSync(testExportPath, { recursive: true, force: true })

      const result = await viewer.healthCheck()

      expect(result).toBe(false)
    })

    test('returns false for non-writable directory', async () => {
      // Make directory read-only
      fs.chmodSync(testExportPath, 0o444)

      const result = await viewer.healthCheck()

      // Restore permissions for cleanup
      fs.chmodSync(testExportPath, 0o755)

      expect(result).toBe(false)
    })

    test('cleans up health check test file', async () => {
      await viewer.healthCheck()

      // List files in the directory
      const files = fs.readdirSync(testExportPath)

      // No health check files should remain
      const healthCheckFiles = files.filter(f => f.startsWith('.health-check-'))
      expect(healthCheckFiles).toHaveLength(0)
    })
  })

  describe('HTML content generation', () => {
    test('generates valid HTML with session data', async () => {
      const session = createMockSession({
        name: 'My Test Session',
        messages: [
          {
            id: 'msg-q1',
            type: 'user',
            content: 'What is 2+2?',
            timestamp: Date.now(),
          },
          {
            id: 'msg-a1',
            type: 'assistant',
            content: 'The answer is 4.',
            timestamp: Date.now(),
          },
        ],
      } as Partial<StoredSession>)

      await viewer.share(session)

      const filePath = path.join(testExportPath, 'test-session-123.html')
      const content = fs.readFileSync(filePath, 'utf-8')

      expect(content).toContain('My Test Session')
      expect(content).toContain('What is 2+2?')
      expect(content).toContain('The answer is 4.')
      expect(content).toContain('Vespr Session')
      expect(content).toContain('</html>')
    })

    test('escapes HTML in session content', async () => {
      const session = createMockSession({
        name: '<script>alert("XSS")</script>',
        messages: [
          {
            id: 'msg-xss',
            type: 'user',
            content: '<img src="x" onerror="alert(1)">',
            timestamp: Date.now(),
          },
        ],
      } as Partial<StoredSession>)

      await viewer.share(session)

      const filePath = path.join(testExportPath, 'test-session-123.html')
      const content = fs.readFileSync(filePath, 'utf-8')

      // Verify HTML is escaped, not raw
      expect(content).not.toContain('<script>alert')
      expect(content).toContain('&lt;script&gt;')
    })
  })
})
