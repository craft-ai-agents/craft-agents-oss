/**
 * @vesper/shared
 *
 * Shared business logic for Vesper.
 * Used by the Electron app.
 *
 * Import specific modules via subpath exports:
 *   import { VesperAgent } from '@vesper/shared/agent';
 *   import { loadStoredConfig } from '@vesper/shared/config';
 *   import { getCredentialManager } from '@vesper/shared/credentials';
 *   import { CraftMcpClient } from '@vesper/shared/mcp';
 *   import { debug } from '@vesper/shared/utils';
 *   import { loadSource, createSource, getSourceCredentialManager } from '@vesper/shared/sources';
 *   import { createWorkspace, loadWorkspace } from '@vesper/shared/workspaces';
 *
 * Available modules:
 *   - agent: VesperAgent SDK wrapper, plan tools
 *   - auth: OAuth, token management, auth state
 *   - clients: Craft API client
 *   - config: Storage, models, preferences
 *   - credentials: Encrypted credential storage
 *   - headless: Non-interactive execution mode
 *   - mcp: MCP client, connection validation
 *   - prompts: System prompt generation
 *   - sources: Workspace-scoped source management (MCP, API, local)
 *   - utils: Debug logging, file handling, summarization
 *   - validation: URL validation
 *   - version: Version and installation management
 *   - workspaces: Workspace management (top-level organizational unit)
 */

// Export branding (standalone, no dependencies)
export * from './branding.ts';
