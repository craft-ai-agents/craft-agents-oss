/**
 * Tests for the updateOnly guard in SETUP_LLM_CONNECTION.
 *
 * The updateOnly flag prevents accidental connection creation during
 * re-authentication flows. When set, the handler must reject if the
 * slug doesn't map to an existing connection.
 *
 * Since the handler is tightly coupled to the RPC server, we test the
 * guard logic by mocking the config/credential layer and invoking
 * the decision path directly.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { createBuiltInConnection } from '@craft-agent/server-core/domain'
import type { LlmConnectionSetup } from '@craft-agent/shared/protocol'

// ============================================================
// Simulated updateOnly guard logic
// (mirrors the handler code in llm-connections.ts)
// ============================================================

interface MockDeps {
  getLlmConnection: (slug: string) => unknown | null
  deleteLlmCredentials: (slug: string) => Promise<void>
  createBuiltInConnection: (slug: string, baseUrl?: string) => unknown
  addLlmConnection: (conn: unknown) => boolean
}

/**
 * Extracted guard logic from SETUP_LLM_CONNECTION handler.
 * Returns { action, error? } indicating what the handler would do.
 */
function evaluateSetupGuard(
  setup: Pick<LlmConnectionSetup, 'slug' | 'updateOnly'>,
  deps: MockDeps,
): { action: 'update' | 'create' | 'reject'; error?: string } {
  const connection = deps.getLlmConnection(setup.slug)
  if (connection) {
    return { action: 'update' }
  }
  if (setup.updateOnly) {
    // Handler would clean up orphaned credentials and reject
    deps.deleteLlmCredentials(setup.slug).catch(() => {})
    return { action: 'reject', error: 'Connection not found. Cannot re-authenticate a non-existent connection.' }
  }
  return { action: 'create' }
}

// ============================================================
// Tests
// ============================================================

describe('SETUP_LLM_CONNECTION updateOnly guard', () => {
  let mockDeleteCreds: ReturnType<typeof mock>

  beforeEach(() => {
    mockDeleteCreds = mock(() => Promise.resolve())
  })

  it('updateOnly=true + missing slug → rejects', () => {
    const result = evaluateSetupGuard(
      { slug: 'nonexistent', updateOnly: true },
      {
        getLlmConnection: () => null,
        deleteLlmCredentials: mockDeleteCreds as any,
        createBuiltInConnection,
        addLlmConnection: () => true,
      },
    )
    expect(result.action).toBe('reject')
    expect(result.error).toContain('Connection not found')
  })

  it('updateOnly=true + missing slug → cleans up orphaned credentials', () => {
    evaluateSetupGuard(
      { slug: 'chatgpt-plus-2', updateOnly: true },
      {
        getLlmConnection: () => null,
        deleteLlmCredentials: mockDeleteCreds as any,
        createBuiltInConnection,
        addLlmConnection: () => true,
      },
    )
    expect(mockDeleteCreds).toHaveBeenCalledWith('chatgpt-plus-2')
  })

  it('updateOnly=true + existing slug → updates normally', () => {
    const result = evaluateSetupGuard(
      { slug: 'chatgpt-plus', updateOnly: true },
      {
        getLlmConnection: () => ({ slug: 'chatgpt-plus', name: 'ChatGPT Plus' }),
        deleteLlmCredentials: mockDeleteCreds as any,
        createBuiltInConnection,
        addLlmConnection: () => true,
      },
    )
    expect(result.action).toBe('update')
    expect(mockDeleteCreds).not.toHaveBeenCalled()
  })

  it('default flow (no updateOnly) + missing slug → creates', () => {
    const result = evaluateSetupGuard(
      { slug: 'chatgpt-plus-2' },
      {
        getLlmConnection: () => null,
        deleteLlmCredentials: mockDeleteCreds as any,
        createBuiltInConnection,
        addLlmConnection: () => true,
      },
    )
    expect(result.action).toBe('create')
    expect(mockDeleteCreds).not.toHaveBeenCalled()
  })

  it('default flow + existing slug → updates', () => {
    const result = evaluateSetupGuard(
      { slug: 'chatgpt-plus' },
      {
        getLlmConnection: () => ({ slug: 'chatgpt-plus' }),
        deleteLlmCredentials: mockDeleteCreds as any,
        createBuiltInConnection,
        addLlmConnection: () => true,
      },
    )
    expect(result.action).toBe('update')
  })
})
