import { describe, expect, it } from 'bun:test'
import { preferredWorkspaceIdForDesktopAccount } from '../desktop-workspace-selection'

describe('preferredWorkspaceIdForDesktopAccount', () => {
  it('keeps the current local workspace for a local development account', () => {
    expect(preferredWorkspaceIdForDesktopAccount({
      workspaceId: 'account-server-workspace',
    })).toBeNull()
  })

  it('uses the remote workspace for a managed ERP account', () => {
    expect(preferredWorkspaceIdForDesktopAccount({
      workspaceId: 'erp-managed-workspace',
      executionMode: 'server_only',
    })).toBe('erp-managed-workspace')
  })
})
