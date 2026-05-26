import { describe, expect, test } from 'bun:test'
import type { AppShellContextType } from '@/context/AppShellContext'
import { createPanelSlotHeaderContext } from '../panel-slot-header-context'

const parentContext = {
  workspaces: [],
  activeWorkspaceId: 'workspace-1',
  activeWorkspaceSlug: 'workspace-1',
  llmConnections: [],
  refreshLlmConnections: async () => {},
  pendingPermissions: new Map(),
  pendingCredentials: new Map(),
  getDraft: () => '',
  getDraftAttachmentRefs: () => [],
  hydrateDraftAttachments: async () => [],
  sessionOptions: new Map(),
  onCreateSession: async () => ({ id: 'session-1' }),
  onSendMessage: () => {},
  onRenameSession: () => {},
  onFlagSession: () => {},
  onUnflagSession: () => {},
  onArchiveSession: () => {},
  onUnarchiveSession: () => {},
  onMarkSessionRead: () => {},
  onMarkSessionUnread: () => {},
  onSetActiveViewingSession: () => {},
  onSessionStatusChange: () => {},
  onDeleteSession: async () => true,
  onOpenFile: () => {},
  onOpenUrl: () => {},
  onSelectWorkspace: () => {},
  onOpenSettings: () => {},
  onOpenKeyboardShortcuts: () => {},
  onOpenStoredUserPreferences: () => {},
  onReset: () => {},
  onSsoLogout: async () => {},
  onSessionOptionsChange: () => {},
  onInputChange: () => {},
  onAttachmentsChange: () => {},
} as unknown as AppShellContextType

describe('PanelSlot header context', () => {
  test('does not add a close action to the panel header context', () => {
    const context = createPanelSlotHeaderContext(parentContext, {
      leadingAction: undefined,
      isFocusedPanel: true,
    })

    expect(context.rightSidebarButton).toBeUndefined()
  })

  test('keeps the compact back button as the leading header action', () => {
    const backButton = 'back-button'
    const context = createPanelSlotHeaderContext(parentContext, {
      leadingAction: backButton,
      isFocusedPanel: true,
    })

    expect(context.leadingAction).toBe(backButton)
  })
})
