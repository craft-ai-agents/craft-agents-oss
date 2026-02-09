/**
 * @g4os/shared
 *
 * Shared business logic for G4 OS.
 * Used by the Electron app.
 *
 * Import specific modules via subpath exports:
 *   import { G4Agent } from '@g4os/shared/agent';
 *   import { loadStoredConfig } from '@g4os/shared/config';
 *   import { getCredentialManager } from '@g4os/shared/credentials';
 *   import { G4OSMcpClient } from '@g4os/shared/mcp';
 *   import { debug } from '@g4os/shared/utils';
 *   import { loadSource, createSource, getSourceCredentialManager } from '@g4os/shared/sources';
 *   import { createWorkspace, loadWorkspace } from '@g4os/shared/workspaces';
 *
 * Available modules:
 *   - agent: G4Agent SDK wrapper, plan tools
 *   - auth: OAuth, token management, auth state
 *   - clients: G4 OS API client
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
