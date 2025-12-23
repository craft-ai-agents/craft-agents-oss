/**
 * IPC Schema - Single Source of Truth for IPC Types
 *
 * This file defines all IPC channels with their parameter and return types.
 * Benefits:
 * 1. Type-safe IPC calls - TypeScript ensures params/returns match
 * 2. Single definition - Channel, params, and return type in one place
 * 3. Reduced boilerplate - Helper functions generate preload methods
 *
 * Adding a new IPC channel:
 * 1. Add to IpcSchema below with params and return type
 * 2. Add handler in main/ipc.ts using the channel name
 * 3. That's it! ElectronAPI interface is auto-generated
 */

import type {
  Session,
  Workspace,
  SubAgentMetadata,
  SubAgentDefinition,
  AgentStatus,
  AgentActivateOptions,
  AgentSetupStatus,
  AgentAuthRequirements,
  OAuthResult,
  McpValidationResult,
  FileAttachment,
  StoredAttachment,
  SendMessageOptions,
  TodoState,
  Mode,
  SessionEvent,
  AskQuestionResponse,
  DeepLinkNavigation,
  AuthState,
  SetupNeeds,
  AuthType,
  DiffPreviewData,
  CodePreviewData,
  TerminalPreviewData,
  MarkdownPreviewData,
} from './types'

// ============================================
// IPC Schema Definition
// ============================================

/**
 * IPC Schema - defines all channels with their parameter and return types.
 *
 * Format:
 *   'channel:name': {
 *     params: [param1Type, param2Type, ...] (use ? for optional)
 *     returns: ReturnType
 *   }
 *
 * The schema is used to:
 * 1. Generate type-safe preload methods
 * 2. Ensure main handlers have correct signatures
 * 3. Provide IntelliSense for IPC calls
 */
export const IpcSchema = {
  // ============================================
  // Session Management
  // ============================================
  'sessions:get': {
    params: [] as const,
    returns: null as unknown as Session[],
  },
  'sessions:create': {
    params: null as unknown as [workspaceId: string, agentId?: string, agentName?: string],
    returns: null as unknown as Session,
  },
  'sessions:delete': {
    params: null as unknown as [sessionId: string],
    returns: null as unknown as boolean,
  },
  'sessions:rename': {
    params: null as unknown as [sessionId: string, name: string],
    returns: null as unknown as void,
  },
  'sessions:sendMessage': {
    params: null as unknown as [sessionId: string, message: string, attachments?: FileAttachment[], storedAttachments?: StoredAttachment[], options?: SendMessageOptions],
    returns: null as unknown as void,
  },
  'sessions:cancel': {
    params: null as unknown as [sessionId: string],
    returns: null as unknown as void,
  },
  'sessions:flag': {
    params: null as unknown as [sessionId: string],
    returns: null as unknown as void,
  },
  'sessions:unflag': {
    params: null as unknown as [sessionId: string],
    returns: null as unknown as void,
  },
  'sessions:setSkipPermissions': {
    params: null as unknown as [sessionId: string, enabled: boolean],
    returns: null as unknown as void,
  },
  'sessions:setTodoState': {
    params: null as unknown as [sessionId: string, state: TodoState],
    returns: null as unknown as void,
  },
  'sessions:markRead': {
    params: null as unknown as [sessionId: string],
    returns: null as unknown as void,
  },
  'sessions:markUnread': {
    params: null as unknown as [sessionId: string],
    returns: null as unknown as void,
  },
  'sessions:respondToPermission': {
    params: null as unknown as [sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean],
    returns: null as unknown as void,
  },
  'sessions:setMode': {
    params: null as unknown as [sessionId: string, mode: Mode, enabled: boolean],
    returns: null as unknown as void,
  },
  'sessions:respondToAskQuestion': {
    params: null as unknown as [sessionId: string, requestId: string, answers: AskQuestionResponse],
    returns: null as unknown as void,
  },

  // ============================================
  // Workspace Management
  // ============================================
  'workspaces:get': {
    params: [] as const,
    returns: null as unknown as Workspace[],
  },

  // ============================================
  // Window Management
  // ============================================
  'window:getWorkspace': {
    params: [] as const,
    returns: null as unknown as string | null,
  },
  'window:getMode': {
    params: [] as const,
    returns: null as unknown as string | null,
  },
  'window:openWorkspace': {
    params: null as unknown as [workspaceId: string],
    returns: null as unknown as void,
  },
  'window:openAddWorkspace': {
    params: [] as const,
    returns: null as unknown as void,
  },
  'window:close': {
    params: [] as const,
    returns: null as unknown as void,
  },

  // ============================================
  // Agent Management
  // ============================================
  'agents:get': {
    params: null as unknown as [workspaceId: string],
    returns: null as unknown as SubAgentMetadata[],
  },
  'agents:refresh': {
    params: null as unknown as [workspaceId: string],
    returns: null as unknown as SubAgentMetadata[],
  },
  'agents:checkAuth': {
    params: null as unknown as [workspaceId: string, agentId: string],
    returns: null as unknown as boolean,
  },
  'agents:getSetupStatus': {
    params: null as unknown as [workspaceId: string, agentId: string],
    returns: null as unknown as AgentSetupStatus,
  },
  'agents:getAuthStatus': {
    params: null as unknown as [workspaceId: string, agentId: string],
    returns: null as unknown as { needsAuth: boolean; reason?: string },
  },
  'agents:getDefinition': {
    params: null as unknown as [workspaceId: string, agentId: string],
    returns: null as unknown as SubAgentDefinition | null,
  },
  'agents:reloadAgent': {
    params: null as unknown as [workspaceId: string, agentId: string],
    returns: null as unknown as void,
  },
  'agents:resetAgent': {
    params: null as unknown as [workspaceId: string, agentId: string],
    returns: null as unknown as void,
  },

  // ============================================
  // Agent Authentication
  // ============================================
  'agents:getAuthRequirements': {
    params: null as unknown as [workspaceId: string, agentId: string],
    returns: null as unknown as AgentAuthRequirements,
  },
  'agents:startMcpOAuth': {
    params: null as unknown as [workspaceId: string, agentId: string, serverUrl: string, serverName: string],
    returns: null as unknown as OAuthResult,
  },
  'agents:saveMcpBearer': {
    params: null as unknown as [workspaceId: string, agentId: string, serverName: string, token: string],
    returns: null as unknown as void,
  },
  'agents:saveApiCredentials': {
    params: null as unknown as [workspaceId: string, agentId: string, apiName: string, credential: string],
    returns: null as unknown as void,
  },
  'agents:validateMcpConnection': {
    params: null as unknown as [serverUrl: string, accessToken?: string],
    returns: null as unknown as McpValidationResult,
  },

  // ============================================
  // Agent State Machine
  // ============================================
  'agent:getStatus': {
    params: null as unknown as [workspaceId: string, agentId: string],
    returns: null as unknown as AgentStatus,
  },
  'agent:activate': {
    params: null as unknown as [workspaceId: string, agentId: string, options?: AgentActivateOptions],
    returns: null as unknown as AgentStatus,
  },
  'agent:continueReview': {
    params: null as unknown as [workspaceId: string, agentId: string, answers: Record<string, unknown>],
    returns: null as unknown as AgentStatus,
  },
  'agent:continueMcpAuth': {
    params: null as unknown as [workspaceId: string, agentId: string],
    returns: null as unknown as AgentStatus,
  },
  'agent:continueApiAuth': {
    params: null as unknown as [workspaceId: string, agentId: string],
    returns: null as unknown as AgentStatus,
  },
  'agent:deactivate': {
    params: null as unknown as [workspaceId: string, agentId: string],
    returns: null as unknown as void,
  },
  'agent:reload': {
    params: null as unknown as [workspaceId: string, agentId: string],
    returns: null as unknown as AgentStatus,
  },
  'agent:reset': {
    params: null as unknown as [workspaceId: string, agentId: string],
    returns: null as unknown as void,
  },
  'agent:markActive': {
    params: null as unknown as [workspaceId: string, agentId: string],
    returns: null as unknown as void,
  },

  // ============================================
  // File Operations
  // ============================================
  'file:read': {
    params: null as unknown as [path: string],
    returns: null as unknown as string,
  },
  'file:openDialog': {
    params: [] as const,
    returns: null as unknown as string[] | null,
  },
  'file:readAttachment': {
    params: null as unknown as [path: string],
    returns: null as unknown as FileAttachment,
  },
  'file:storeAttachment': {
    params: null as unknown as [sessionId: string, attachment: FileAttachment],
    returns: null as unknown as StoredAttachment,
  },
  'file:generateThumbnail': {
    params: null as unknown as [base64: string, mimeType: string],
    returns: null as unknown as string,
  },

  // ============================================
  // Theme
  // ============================================
  'theme:getSystemPreference': {
    params: [] as const,
    returns: null as unknown as 'light' | 'dark',
  },

  // ============================================
  // Shell Operations
  // ============================================
  'shell:openUrl': {
    params: null as unknown as [url: string],
    returns: null as unknown as void,
  },
  'shell:openFile': {
    params: null as unknown as [path: string],
    returns: null as unknown as void,
  },
  'shell:showInFolder': {
    params: null as unknown as [path: string],
    returns: null as unknown as void,
  },

  // ============================================
  // Auth
  // ============================================
  'auth:logout': {
    params: [] as const,
    returns: null as unknown as void,
  },
  'auth:showLogoutConfirmation': {
    params: [] as const,
    returns: null as unknown as boolean,
  },
  'auth:showDeleteSessionConfirmation': {
    params: [] as const,
    returns: null as unknown as boolean,
  },

  // ============================================
  // Onboarding
  // ============================================
  'onboarding:getAuthState': {
    params: [] as const,
    returns: null as unknown as AuthState,
  },
  'onboarding:startCraftOAuth': {
    params: [] as const,
    returns: null as unknown as OAuthResult,
  },
  'onboarding:getCraftProfile': {
    params: [] as const,
    returns: null as unknown as { name: string; email: string } | null,
  },
  'onboarding:getMcpLinks': {
    params: null as unknown as [spaceId: string],
    returns: null as unknown as Array<{ id: string; name: string; url: string }>,
  },
  'onboarding:createMcpLink': {
    params: null as unknown as [spaceId: string, name: string],
    returns: null as unknown as { id: string; url: string },
  },
  'onboarding:validateMcp': {
    params: null as unknown as [url: string, accessToken?: string],
    returns: null as unknown as McpValidationResult,
  },
  'onboarding:startMcpOAuth': {
    params: null as unknown as [workspaceId: string, serverUrl: string],
    returns: null as unknown as OAuthResult,
  },
  'onboarding:saveConfig': {
    params: null as unknown as [config: { authType: AuthType; workspaceId: string; workspaceName: string; mcpUrl: string }],
    returns: null as unknown as void,
  },
  'onboarding:getExistingClaudeToken': {
    params: [] as const,
    returns: null as unknown as string | null,
  },
  'onboarding:isClaudeCliInstalled': {
    params: [] as const,
    returns: null as unknown as boolean,
  },
  'onboarding:runClaudeSetupToken': {
    params: [] as const,
    returns: null as unknown as { success: boolean; token?: string; error?: string },
  },

  // ============================================
  // Settings
  // ============================================
  'settings:getBillingMethod': {
    params: [] as const,
    returns: null as unknown as AuthType | null,
  },
  'settings:updateBillingMethod': {
    params: null as unknown as [method: AuthType, apiKey?: string],
    returns: null as unknown as void,
  },
  'settings:getCreditsUrl': {
    params: [] as const,
    returns: null as unknown as string | null,
  },
  'settings:getModel': {
    params: [] as const,
    returns: null as unknown as string | null,
  },
  'settings:setModel': {
    params: null as unknown as [model: string],
    returns: null as unknown as void,
  },
  'settings:getDefaultModes': {
    params: [] as const,
    returns: null as unknown as Mode[],
  },
  'settings:setDefaultModes': {
    params: null as unknown as [modes: Mode[]],
    returns: null as unknown as void,
  },
  'settings:getDefaultSkipPermissions': {
    params: [] as const,
    returns: null as unknown as boolean,
  },
  'settings:setDefaultSkipPermissions': {
    params: null as unknown as [enabled: boolean],
    returns: null as unknown as void,
  },

  // ============================================
  // User Preferences
  // ============================================
  'preferences:read': {
    params: [] as const,
    returns: null as unknown as Record<string, unknown> | null,
  },
  'preferences:write': {
    params: null as unknown as [prefs: Record<string, unknown>],
    returns: null as unknown as void,
  },

  // ============================================
  // Session Drafts
  // ============================================
  'drafts:get': {
    params: null as unknown as [sessionId: string],
    returns: null as unknown as string | null,
  },
  'drafts:set': {
    params: null as unknown as [sessionId: string, draft: string],
    returns: null as unknown as void,
  },
  'drafts:delete': {
    params: null as unknown as [sessionId: string],
    returns: null as unknown as void,
  },
  'drafts:getAll': {
    params: [] as const,
    returns: null as unknown as Map<string, string>,
  },

  // ============================================
  // Preview Windows
  // ============================================
  'markdownPreview:open': {
    params: null as unknown as [data: MarkdownPreviewData],
    returns: null as unknown as void,
  },
  'markdownPreview:getData': {
    params: [] as const,
    returns: null as unknown as MarkdownPreviewData | null,
  },
  'markdownPreview:save': {
    params: null as unknown as [filePath: string, content: string],
    returns: null as unknown as void,
  },
  'diffPreview:open': {
    params: null as unknown as [data: DiffPreviewData],
    returns: null as unknown as void,
  },
  'diffPreview:getData': {
    params: [] as const,
    returns: null as unknown as DiffPreviewData | null,
  },
  'codePreview:open': {
    params: null as unknown as [data: CodePreviewData],
    returns: null as unknown as void,
  },
  'codePreview:getData': {
    params: [] as const,
    returns: null as unknown as CodePreviewData | null,
  },
  'terminalPreview:open': {
    params: null as unknown as [data: TerminalPreviewData],
    returns: null as unknown as void,
  },
  'terminalPreview:getData': {
    params: [] as const,
    returns: null as unknown as TerminalPreviewData | null,
  },
} as const

// ============================================
// Type Utilities
// ============================================

/** All IPC channel names */
export type IpcChannel = keyof typeof IpcSchema

/** Get parameter types for a channel */
export type IpcParams<K extends IpcChannel> = typeof IpcSchema[K]['params']

/** Get return type for a channel */
export type IpcReturn<K extends IpcChannel> = typeof IpcSchema[K]['returns']

/** IPC invoke function type */
export type IpcInvoke = <K extends IpcChannel>(
  channel: K,
  ...args: IpcParams<K>
) => Promise<IpcReturn<K>>

// ============================================
// Event Channels (main → renderer)
// ============================================

/**
 * Event channels that push data from main to renderer.
 * These use ipcRenderer.on() / webContents.send() instead of invoke/handle.
 */
export const IpcEventChannels = {
  'session:event': null as unknown as SessionEvent,
  'agent:statusChanged': null as unknown as [workspaceId: string, agentId: string, status: AgentStatus],
  'agent:authChanged': null as unknown as [workspaceId: string, agentId: string],
  'theme:systemChanged': null as unknown as boolean,
  'menu:newChat': null as unknown as void,
  'menu:openSettings': null as unknown as void,
  'menu:keyboardShortcuts': null as unknown as void,
  'menu:openHelp': null as unknown as void,
  'deeplink:navigate': null as unknown as DeepLinkNavigation,
} as const

export type IpcEventChannel = keyof typeof IpcEventChannels
export type IpcEventData<K extends IpcEventChannel> = typeof IpcEventChannels[K]
