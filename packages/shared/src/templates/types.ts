// packages/shared/src/templates/types.ts

export interface SessionTemplate {
  id: string;                    // UUID
  name: string;                  // User-visible name
  description?: string;          // Optional description
  scope: 'workspace' | 'global'; // Where it's stored
  workspaceId?: string;          // Only for workspace-scoped

  // Session Configuration
  initialPrompt?: string;        // Pre-filled in input box
  gatherContext?: string;        // Instructions for Claude about what info to gather from user
  skillIds?: string[];           // Skills to attach
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  model?: string;                // e.g., 'claude-sonnet-4-20250514'
  thinkingLevel?: number;        // 0-5
  workingDirectory?: string;     // Default working directory
  taskListId?: string;           // Task list ID for coordinating multi-agent workflows

  // Metadata
  createdAt: string;             // ISO timestamp
  updatedAt: string;
  usageCount?: number;           // Track popularity
}

export interface CreateTemplateOptions {
  name: string;
  description?: string;
  scope: 'workspace' | 'global';
  workspaceId?: string;
  initialPrompt?: string;
  gatherContext?: string;        // Instructions for Claude about what info to gather
  skillIds?: string[];
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  model?: string;
  thinkingLevel?: number;
  workingDirectory?: string;
  taskListId?: string;           // Task list ID for coordinating multi-agent workflows
}

export interface SaveSessionAsTemplateOptions {
  sessionId: string;
  name: string;
  description?: string;
  scope: 'workspace' | 'global';
  includeInitialPrompt?: boolean; // Whether to capture first user message
}
