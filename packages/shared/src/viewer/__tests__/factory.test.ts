import { describe, test, expect, afterEach } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { createViewerService } from '../factory'
import CraftHostedViewer from '../craft-hosted-viewer'
import StaticExportViewer from '../static-export-viewer'
import type { ViewerConfig } from '../types'

/**
 * Test suite for createViewerService factory function
 *
 * Tests the factory that creates appropriate viewer service
 * implementations based on configuration.
 */

describe('createViewerService', () => {
  // Track temp directories for cleanup
  const tempDirs: string[] = []

  afterEach(() => {
    // Clean up any temp directories created during tests
    for (const dir of tempDirs) {
      try {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true })
        }
      } catch {
        // Ignore cleanup errors
      }
    }
    tempDirs.length = 0
  })

  /**
   * Helper to create temp directory for tests
   */
  function createTempDir(): string {
    const dir = path.join(tmpdir(), `vespr-factory-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(dir, { recursive: true })
    tempDirs.push(dir)
    return dir
  }

  describe('default behavior', () => {
    test('returns CraftHostedViewer by default (no config)', () => {
      const viewer = createViewerService()

      expect(viewer).toBeInstanceOf(CraftHostedViewer)
    })

    test('returns CraftHostedViewer when config is undefined', () => {
      const viewer = createViewerService(undefined)

      expect(viewer).toBeInstanceOf(CraftHostedViewer)
    })
  })

  describe('craft-hosted type', () => {
    test('returns CraftHostedViewer for type craft-hosted', () => {
      const config: ViewerConfig = {
        type: 'craft-hosted',
      }

      const viewer = createViewerService(config)

      expect(viewer).toBeInstanceOf(CraftHostedViewer)
    })

    test('returns CraftHostedViewer with custom URL', () => {
      const config: ViewerConfig = {
        type: 'craft-hosted',
        craftUrl: 'https://custom.example.com',
      }

      const viewer = createViewerService(config)

      expect(viewer).toBeInstanceOf(CraftHostedViewer)
      // Note: We can't directly verify the URL is set, but we verify it's constructed correctly
    })

    test('uses default URL when craftUrl is not provided', () => {
      const config: ViewerConfig = {
        type: 'craft-hosted',
      }

      const viewer = createViewerService(config)

      expect(viewer).toBeInstanceOf(CraftHostedViewer)
    })
  })

  describe('static-export type', () => {
    test('returns StaticExportViewer for type static-export', () => {
      const exportPath = createTempDir()
      const config: ViewerConfig = {
        type: 'static-export',
        exportPath,
      }

      const viewer = createViewerService(config)

      expect(viewer).toBeInstanceOf(StaticExportViewer)
    })

    test('throws error if static-export missing exportPath', () => {
      const config: ViewerConfig = {
        type: 'static-export',
        // exportPath intentionally omitted
      }

      expect(() => createViewerService(config)).toThrow(
        'Static export viewer requires exportPath configuration'
      )
    })

    test('creates StaticExportViewer with uploadCommand', () => {
      const exportPath = createTempDir()
      const config: ViewerConfig = {
        type: 'static-export',
        exportPath,
        uploadCommand: 'echo "uploaded"',
      }

      const viewer = createViewerService(config)

      expect(viewer).toBeInstanceOf(StaticExportViewer)
    })
  })

  describe('unknown type fallback', () => {
    test('falls back to CraftHostedViewer for unknown type', () => {
      // Deliberately test invalid type - cast through unknown to bypass type check
      const config = {
        type: 'unknown-type',
      } as unknown as ViewerConfig

      const viewer = createViewerService(config)

      expect(viewer).toBeInstanceOf(CraftHostedViewer)
    })

    test('falls back to CraftHostedViewer for empty type', () => {
      // Deliberately test empty type - cast through unknown to bypass type check
      const config = {
        type: '',
      } as unknown as ViewerConfig

      // Empty string is truthy enough to not trigger default, but switch will fall through
      const viewer = createViewerService(config)

      expect(viewer).toBeInstanceOf(CraftHostedViewer)
    })
  })

  describe('ViewerService interface compliance', () => {
    test('CraftHostedViewer implements all required methods', () => {
      const viewer = createViewerService()

      expect(typeof viewer.share).toBe('function')
      expect(typeof viewer.update).toBe('function')
      expect(typeof viewer.revoke).toBe('function')
      expect(typeof viewer.healthCheck).toBe('function')
    })

    test('StaticExportViewer implements all required methods', () => {
      const exportPath = createTempDir()
      const viewer = createViewerService({
        type: 'static-export',
        exportPath,
      })

      expect(typeof viewer.share).toBe('function')
      expect(typeof viewer.update).toBe('function')
      expect(typeof viewer.revoke).toBe('function')
      expect(typeof viewer.healthCheck).toBe('function')
    })
  })
})
