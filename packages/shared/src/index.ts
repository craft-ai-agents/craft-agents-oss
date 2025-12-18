/**
 * @craft-agent/shared
 *
 * Shared business logic for Craft Agent.
 * Used by both TUI and Electron apps.
 *
 * Import specific modules via subpath exports:
 *   import { CraftAgent } from '@craft-agent/shared/agent';
 *   import { loadStoredConfig } from '@craft-agent/shared/config';
 *   import { getCredentialManager } from '@craft-agent/shared/credentials';
 *   import { CraftMcpClient } from '@craft-agent/shared/mcp';
 *   import { debug } from '@craft-agent/shared/utils';
 *
 * Available modules:
 *   - agent: CraftAgent SDK wrapper, plan tools
 *   - agents: Subagent system, extraction, state management
 *   - auth: OAuth, token management, auth state
 *   - clients: Craft API client
 *   - config: Storage, models, preferences
 *   - credentials: Encrypted credential storage
 *   - headless: Non-interactive execution mode
 *   - mcp: MCP client, connection validation
 *   - prompts: System prompt generation
 *   - subscription: Billing/subscription checks
 *   - utils: Debug logging, file handling, summarization
 *   - validation: URL validation
 *   - version: Version and installation management
 */

// Export branding (standalone, no dependencies)
export * from './branding.ts';
