/**
 * Documentation Utilities
 *
 * Provides access to built-in documentation that Claude can reference
 * when performing configuration tasks (sources, agents, permissions, etc.).
 *
 * Docs are stored at ~/.craft-agent/docs/ and copied on first run.
 */

import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import { isDebugEnabled, debug } from '../utils/debug.ts';
import { getAppVersion } from '../version/app-version.ts';
import { initializeSourceGuides } from './source-guides.ts';

const CONFIG_DIR = join(homedir(), '.craft-agent');
const DOCS_DIR = join(CONFIG_DIR, 'docs');

/**
 * Get the docs directory path
 */
export function getDocsDir(): string {
  return DOCS_DIR;
}

/**
 * Get path to a specific doc file
 */
export function getDocPath(filename: string): string {
  return join(DOCS_DIR, filename);
}

/**
 * Documentation file references for use in error messages and tool descriptions.
 * Use these constants instead of hardcoding paths to keep references in sync.
 */
export const DOC_REFS = {
  sources: '~/.craft-agent/docs/sources.md',
  agents: '~/.craft-agent/docs/agents.md',
  permissions: '~/.craft-agent/docs/permissions.md',
  sourceGuides: '~/.craft-agent/docs/source-guides/',
  docsDir: '~/.craft-agent/docs/',
} as const;

/**
 * Check if docs directory exists
 */
export function docsExist(): boolean {
  return existsSync(DOCS_DIR);
}

/**
 * List available doc files
 */
export function listDocs(): string[] {
  if (!existsSync(DOCS_DIR)) return [];
  return readdirSync(DOCS_DIR).filter(f => f.endsWith('.md'));
}

/**
 * Extract version from a doc file's first line.
 * Expected format: <!-- version: X.Y.Z -->
 */
function extractVersion(content: string): string | null {
  const match = content.match(/^<!--\s*version:\s*([^\s]+)\s*-->/);
  return match?.[1] ?? null;
}

/**
 * Compare semver versions. Returns:
 *  1 if a > b
 *  0 if a == b
 * -1 if a < b
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

/**
 * Initialize docs directory with bundled documentation.
 * - Debug mode: Always overwrite docs
 * - Production: Only update if bundled version is newer
 */
export function initializeDocs(): void {
  if (!existsSync(DOCS_DIR)) {
    mkdirSync(DOCS_DIR, { recursive: true });
  }

  const appVersion = getAppVersion();
  const debugMode = isDebugEnabled();

  for (const [filename, content] of Object.entries(BUNDLED_DOCS)) {
    const docPath = join(DOCS_DIR, filename);
    const versionedContent = `<!-- version: ${appVersion} -->\n${content}`;

    if (!existsSync(docPath)) {
      // File doesn't exist - create it
      writeFileSync(docPath, versionedContent, 'utf-8');
      console.log(`[docs] Created ${filename} (v${appVersion})`);
      continue;
    }

    if (debugMode) {
      // Debug mode - always overwrite
      writeFileSync(docPath, versionedContent, 'utf-8');
      console.log(`[docs] Updated ${filename} (v${appVersion}, debug mode)`);
      continue;
    }

    // Production - check version
    try {
      const existingContent = readFileSync(docPath, 'utf-8');
      const installedVersion = extractVersion(existingContent);

      if (!installedVersion || compareVersions(appVersion, installedVersion) > 0) {
        // No version or bundled is newer - update
        writeFileSync(docPath, versionedContent, 'utf-8');
        console.log(`[docs] Updated ${filename} (v${installedVersion || 'none'} → v${appVersion})`);
      }
    } catch {
      // Error reading - overwrite
      writeFileSync(docPath, versionedContent, 'utf-8');
      console.log(`[docs] Recreated ${filename} (v${appVersion})`);
    }
  }

  // Also initialize source guides
  initializeSourceGuides();
}

// ============================================================
// Bundled Documentation
// ============================================================

const SOURCES_MD = `# Sources Configuration Guide

This guide explains how to configure sources (MCP servers, APIs, local filesystems) in Craft Agent.

## Source Setup Process

When a user wants to add a new source, follow this conversational setup process to create a tailored, well-documented integration.

### 1. Understand User Intent

Before creating any configuration, ask questions to understand:
- **Primary purpose**: What do they want to accomplish with this source?
- **Scope**: Specific projects, teams, repositories, or data to focus on?
- **Common tasks**: What operations will they perform most often?
- **Access level**: Read-only exploration or full access?

Example questions:
> "I'd be happy to help set up Linear! A few questions:
> 1. What will you primarily use Linear for? (issue tracking, sprint planning, etc.)
> 2. Are there specific teams or projects you want to focus on?
> 3. Should I set it up for read-only exploration or full access?"

### 2. Research the Service

Use available tools to learn about the service:
- **WebSearch**: Find official documentation, API references, best practices
- **Look up**: Rate limits, quotas, authentication methods
- **Identify**: Key endpoints or tools relevant to user's stated goals
- **Note**: Any limitations or gotchas to document

### 3. Configure Intelligently

Based on research and user intent:
- Create \`config.json\` with appropriate settings
- Choose the right authentication method
- Download/cache icon for visual identification

### 4. Configure Explore Mode Permissions (REQUIRED)

Sources should work in Explore mode by default. Create \`permissions.json\` to allow read-only operations.

**How it works:** Patterns in a source's \`permissions.json\` are automatically scoped to that source. Write simple patterns like \`list\` - the system converts them to \`mcp__<sourceSlug>__.*list\` internally. This prevents cross-source leakage.

**For MCP sources:**
1. After connecting, list the server's available tools
2. Identify read-only tools (list, get, search, find, query operations)
3. Create simple patterns for those operations

\`\`\`json
{
  "allowedMcpPatterns": [
    { "pattern": "list", "comment": "All list operations" },
    { "pattern": "get", "comment": "All get/read operations" },
    { "pattern": "search", "comment": "All search operations" },
    { "pattern": "find", "comment": "All find operations" }
  ]
}
\`\`\`

**For API sources:**
\`\`\`json
{
  "allowedApiEndpoints": [
    { "method": "GET", "path": ".*", "comment": "All GET requests are read-only" },
    { "method": "POST", "path": "^/search", "comment": "Search endpoint (read-only despite POST)" }
  ]
}
\`\`\`

**For local sources:**
\`\`\`json
{
  "allowedBashPatterns": [
    { "pattern": "^(ls|cat|head|tail|grep|find|tree)\\\\s", "comment": "Read-only commands" }
  ]
}
\`\`\`

> **Goal:** Sources should be fully functional in Explore mode. Allow all read operations by default. Only block actual mutations (create, update, delete).

### 5. Write Comprehensive guide.md

Create a guide.md tailored to the user's context:
- Summarize the source's purpose in their specific use case
- Document capabilities relevant to their workflow
- Include specific project/team/scope references they mentioned
- Add usage examples tailored to their tasks
- Note rate limits, quotas, or limitations

### 6. Test and Validate

Complete the setup:
- Run \`source_test\` to validate configuration
- Trigger appropriate auth flow (\`source_oauth_trigger\`, \`source_credential_prompt\`, etc.)
- Verify connection works
- Confirm the source appears in their workspace

## guide.md Best Practices

The guide.md file is critical—it helps Claude understand how to use the source effectively in future sessions.

### Structure

\`\`\`markdown
# Source Name

Brief description of what this source provides and the user's specific use case.

## Scope

What data/functionality this provides. Include:
- Specific projects, teams, or repos the user mentioned
- Relevant filters or defaults
- Any limitations on access

## Guidelines

- Best practices for this source
- Rate limits or quotas to be aware of
- Common patterns the user will need
- Things to avoid or be careful about

## Examples

Concrete examples tailored to the user's workflow:
- "To find issues in the Craft iOS project: ..."
- "To search for recent commits by the mobile team: ..."
\`\`\`

### Key Principles

1. **Be specific to user context**: Reference the projects, teams, and tasks they mentioned
2. **Include concrete examples**: Use their actual project names and workflows
3. **Document user preferences**: Any preferences they shared for future sessions
4. **Note scope boundaries**: What the source can and cannot do
5. **Keep it actionable**: Focus on what Claude needs to know to help effectively

## Example Conversational Flow

\`\`\`
User: I want to add Linear

Agent: I'd be happy to help set up Linear! A few questions:
1. What will you primarily use Linear for? (issue tracking, sprint planning, reporting?)
2. Are there specific teams or projects you want to focus on?
3. Should I set it up for read-only exploration or full access?

User: Issue tracking for my iOS team, project called "Craft iOS"

Agent: [Uses WebSearch to research Linear MCP capabilities]
Agent: [Creates config.json with OAuth authentication]
Agent: [Writes guide.md mentioning "Craft iOS" project and iOS team context]
Agent: [Sets up permissions.json for read-only listing in Explore mode]
Agent: [Runs source_test to validate]
Agent: [Triggers source_oauth_trigger for authentication]

Agent: Linear is now set up! I've configured it to focus on the "Craft iOS" project.
You can use it to:
- Search and view issues in Craft iOS
- Track sprint progress for the iOS team
- Create and update issues

Would you like me to show you what issues are currently open?
\`\`\`

## Overview

Sources are stored as folders under:
- Workspace sources: \`~/.craft-agent/workspaces/{workspaceId}/sources/{sourceSlug}/\`
- Agent-scoped sources: \`~/.craft-agent/workspaces/{workspaceId}/agents/{agentSlug}/sources/{sourceSlug}/\`

Each source folder contains:
- \`config.json\` - Source configuration (required)
- \`guide.md\` - Usage documentation for Claude (optional)
- \`permissions.json\` - Custom permission rules for Explore mode (optional)
- \`icon.png\` or \`icon.svg\` - Source icon (optional)

## config.json Schema

\`\`\`json
{
  "id": "uuid",
  "name": "Human-readable name",
  "slug": "url-safe-identifier",
  "enabled": true,
  "provider": "provider-name",
  "type": "mcp" | "api" | "local",

  // For MCP sources:
  "mcp": {
    "url": "https://mcp.example.com",
    "authType": "oauth" | "bearer" | "none"
  },

  // For API sources:
  "api": {
    "baseUrl": "https://api.example.com",
    "authType": "bearer" | "header" | "query" | "basic" | "oauth" | "none",
    "headerName": "X-API-Key",      // For header auth
    "queryParam": "api_key",         // For query auth
    "authScheme": "Bearer"           // For bearer auth (default: "Bearer")
  },

  // For local sources:
  "local": {
    "path": "/path/to/folder"
  },

  // Status (updated by source_test):
  "isAuthenticated": true,
  "connectionStatus": "connected" | "needs_auth" | "failed" | "untested",
  "lastTestedAt": 1704067200000,

  // Icon handling:
  "iconUrl": "./icon.png",           // Relative path to cached icon
  "iconSourceUrl": "https://...",    // Original URL for re-fetching

  // Timestamps:
  "createdAt": 1704067200000,
  "updatedAt": 1704067200000
}
\`\`\`

## Source Types

### MCP Sources

Model Context Protocol servers provide tools via HTTP/SSE.

**OAuth authentication (recommended):**
\`\`\`json
{
  "type": "mcp",
  "provider": "linear",
  "mcp": {
    "url": "https://mcp.linear.app",
    "authType": "oauth"
  }
}
\`\`\`

After creating, use \`source_oauth_trigger\` to authenticate.

**Bearer token authentication:**
\`\`\`json
{
  "type": "mcp",
  "provider": "custom-mcp",
  "mcp": {
    "url": "https://my-mcp-server.com",
    "authType": "bearer"
  }
}
\`\`\`

After creating, use \`source_credential_prompt\` with mode "bearer".

**Public (no auth):**
\`\`\`json
{
  "type": "mcp",
  "provider": "public-mcp",
  "mcp": {
    "url": "https://public-mcp.example.com",
    "authType": "none"
  }
}
\`\`\`

### API Sources

REST APIs become flexible tools that Claude can call.

**IMPORTANT:** Authenticated API sources require a \`testEndpoint\` to validate credentials during \`source_test\`. Without it, we cannot verify your credentials work.

**Header authentication (X-API-Key style):**
\`\`\`json
{
  "type": "api",
  "provider": "exa",
  "api": {
    "baseUrl": "https://api.exa.ai",
    "authType": "header",
    "headerName": "x-api-key",
    "testEndpoint": {
      "method": "POST",
      "path": "/search",
      "body": { "query": "test", "numResults": 1 }
    }
  }
}
\`\`\`

**Bearer token (Authorization header):**
\`\`\`json
{
  "type": "api",
  "provider": "openai",
  "api": {
    "baseUrl": "https://api.openai.com/v1",
    "authType": "bearer",
    "testEndpoint": {
      "method": "GET",
      "path": "/models"
    }
  }
}
\`\`\`

**Query parameter:**
\`\`\`json
{
  "type": "api",
  "provider": "weather",
  "api": {
    "baseUrl": "https://api.weather.com",
    "authType": "query",
    "queryParam": "apikey",
    "testEndpoint": {
      "method": "GET",
      "path": "/v1/current"
    }
  }
}
\`\`\`

**Basic authentication:**
\`\`\`json
{
  "type": "api",
  "provider": "jira",
  "api": {
    "baseUrl": "https://your-domain.atlassian.net/rest/api/3",
    "authType": "basic",
    "testEndpoint": {
      "method": "GET",
      "path": "/myself"
    }
  }
}
\`\`\`

### testEndpoint Configuration

The \`testEndpoint\` specifies which endpoint to call when validating credentials:

\`\`\`json
{
  "testEndpoint": {
    "method": "GET",           // "GET" or "POST"
    "path": "/v1/me",          // Path relative to baseUrl
    "body": { ... }            // Optional: request body for POST
  }
}
\`\`\`

**Choose an endpoint that:**
- Requires authentication (to verify credentials work)
- Is lightweight (doesn't fetch much data)
- Returns quickly (health/status endpoints are ideal)

**Common patterns:**
- \`/me\`, \`/user\`, \`/profile\` - User info endpoints
- \`/v1/status\`, \`/health\` - Status endpoints that require auth
- \`/models\`, \`/projects\` - List endpoints with minimal data

**Public APIs (authType: 'none')** don't require testEndpoint - we test by hitting the base URL.

### Local Sources

Filesystem access for local folders.

\`\`\`json
{
  "type": "local",
  "provider": "obsidian",
  "local": {
    "path": "/Users/me/Documents/ObsidianVault"
  }
}
\`\`\`

## guide.md Format

The guide.md file helps Claude understand how to use the source effectively.

\`\`\`markdown
# Source Name

Brief description of what this source provides.

## Scope

What data/functionality this source provides access to.

## Guidelines

- Best practices for using this source
- Rate limits or quotas to be aware of
- Common patterns and examples

## API Reference

For API sources, document the available endpoints:

### POST /search
Search for content.

**Parameters:**
- \`query\` (string, required): Search query
- \`limit\` (number, optional): Max results (default: 10)

**Example:**
\\\`\\\`\\\`json
{
  "query": "machine learning",
  "limit": 5
}
\\\`\\\`\\\`
\`\`\`

## permissions.json Format

Custom rules to extend Explore mode permissions for this source.

\`\`\`json
{
  "allowedMcpPatterns": [
    {
      "pattern": "^mcp__linear__list",
      "comment": "Allow listing resources in Explore mode"
    }
  ],
  "allowedApiEndpoints": [
    {
      "method": "GET",
      "path": "^/search",
      "comment": "Allow search endpoint in Explore mode"
    },
    {
      "method": "POST",
      "path": "^/v1/query$",
      "comment": "POST allowed for query-only endpoints"
    }
  ],
  "allowedBashPatterns": [
    {
      "pattern": "^ls\\\\s",
      "comment": "Allow ls commands"
    }
  ]
}
\`\`\`

## Icon Handling

Icons can be specified in several ways:

1. **Relative path:** \`"iconUrl": "./icon.png"\` - Already downloaded to source folder
2. **Direct URL:** \`"iconUrl": "https://example.com/logo.png"\` - Will be downloaded and cached
3. **Domain for favicon:** \`"iconUrl": "linear.app"\` - Fetches favicon from domain

When using URLs or domains, \`source_test\` will download and cache the icon locally.

## Common Providers

### Gmail
Provider: \`gmail\`, Type: \`api\`
Uses OAuth via \`source_gmail_oauth_trigger\`.

### Linear
Provider: \`linear\`, Type: \`mcp\`
URL: \`https://mcp.linear.app\`, OAuth auth.

### GitHub
Provider: \`github\`, Type: \`mcp\`
URL: \`https://mcp.github.com\`, OAuth auth.

### Exa (Search)
Provider: \`exa\`, Type: \`api\`
Base URL: \`https://api.exa.ai\`, header auth with \`x-api-key\`.

## Workflow

### Creating a Source

**Always follow the conversational setup process** (see above). The key steps:

1. **Ask before creating**: Understand user intent, scope, and common tasks
2. **Research before configuring**: Use WebSearch to find docs, best practices, limitations
3. **Tailor guide.md to context**: Include specific projects/teams the user mentioned
4. **Test before declaring done**: Validate config, trigger auth, verify connection

Technical steps:

1. Create the source folder:
   \`\`\`bash
   mkdir -p ~/.craft-agent/workspaces/{ws}/sources/my-source
   \`\`\`

2. Write \`config.json\` with appropriate settings (see schemas above)

3. Write \`guide.md\` tailored to user's context and use case

4. **Create \`permissions.json\` for Explore mode** - List the source's tools, identify read-only operations (list, get, search), and add simple patterns. Patterns are auto-scoped to this source.

5. Run \`source_test\` to validate configuration and test connection

6. If auth is required, trigger the appropriate flow:
   - \`source_oauth_trigger\` for MCP OAuth
   - \`source_gmail_oauth_trigger\` for Gmail
   - \`source_credential_prompt\` for API keys/tokens

7. Confirm with user that the source is working as expected

### Testing a Source

Use \`source_test\` with the source slug:
- Validates config.json schema
- Tests connectivity
- Downloads icon if needed
- Updates connectionStatus

### Troubleshooting

**"needs_auth" status:**
- Source requires authentication
- Use appropriate auth trigger tool

**"failed" status:**
- Check \`connectionError\` in config.json
- Verify URL is correct
- Check network connectivity

**Icon not showing:**
- Ensure iconUrl is valid
- Run \`source_test\` to re-download
- Check file exists in source folder
`;

const AGENTS_MD = `# Agents Configuration Guide

This guide explains how to configure agents in Craft Agent.

## Overview

Agents are stored at:
\`~/.craft-agent/workspaces/{workspaceId}/agents/{agentSlug}/\`

Each agent folder contains:
- \`config.json\` - Agent configuration (required)
- \`instructions.md\` - Agent instructions/system prompt (required)
- \`theme.json\` - Agent-specific theme overrides (optional)
- \`sources/\` - Agent-scoped sources (optional)

## config.json Schema

\`\`\`json
{
  "name": "Research Assistant",
  "slug": "research-assistant",
  "enabled": true,
  "useSources": ["exa", "web-archive"],
  "source": {
    "type": "local"
  },
  "createdAt": 1704067200000,
  "updatedAt": 1704067200000
}
\`\`\`

### Fields

- **name** (string, required): Display name
- **slug** (string, required): URL-safe identifier
- **enabled** (boolean): Whether agent is active (default: true)
- **useSources** (string[]): Workspace source slugs to attach
- **source**: Origin tracking for synced agents

## instructions.md

The instructions file contains the agent's system prompt in markdown:

\`\`\`markdown
# Research Assistant

You are a research assistant specialized in deep research tasks.

## Capabilities

- Search the web using Exa
- Access archived web pages
- Synthesize information from multiple sources

## Guidelines

- Always cite sources
- Prefer recent information
- Cross-reference claims across sources
\`\`\`

## Agent-Scoped Sources

Agents can have their own sources at:
\`~/.craft-agent/workspaces/{ws}/agents/{agent}/sources/{source}/\`

These sources are only available when the agent is active.

## Source Attachment

Agents can use workspace sources via \`useSources\`:

\`\`\`json
{
  "useSources": ["exa", "linear", "github"]
}
\`\`\`

These sources are loaded when the agent activates.

## Theme Customization

Agents can override the UI theme:

\`\`\`json
{
  "accent": "#6366f1"
}
\`\`\`

## Workflow

### Creating an Agent

1. Create the agent folder:
   \`\`\`bash
   mkdir -p ~/.craft-agent/workspaces/{ws}/agents/my-agent
   \`\`\`

2. Write config.json:
   \`\`\`json
   {
     "name": "My Agent",
     "slug": "my-agent",
     "enabled": true
   }
   \`\`\`

3. Write instructions.md with the agent's behavior

4. Optionally add agent-scoped sources

### Activating an Agent

Use \`@agent-name\` in a message or \`--agent\` CLI flag.
`;

const PERMISSIONS_MD = `# Permissions Configuration Guide

This guide explains how to configure custom permission rules for Explore mode.

## Overview

Explore mode is a read-only mode that blocks potentially destructive operations.
Custom permission rules let you allow specific operations that would otherwise be blocked.

Permission files are located at:
- Workspace: \`~/.craft-agent/workspaces/{slug}/permissions.json\`
- Source: \`~/.craft-agent/workspaces/{slug}/sources/{source}/permissions.json\`
- Agent: \`~/.craft-agent/workspaces/{slug}/agents/{agent}/permissions.json\`

## Auto-Scoping for Source Permissions

**Important:** MCP patterns in a source's \`permissions.json\` are automatically scoped to that source.

When you write:
\`\`\`json
{ "pattern": "list", "comment": "Allow list operations" }
\`\`\`

The system converts it to \`mcp__<sourceSlug>__.*list\` internally. This means:
- Simple patterns like \`list\` only affect tools from that source
- No risk of accidentally allowing \`list\` tools from other sources
- Workspace-level patterns still apply globally (for intentional cross-source rules)

## permissions.json Schema

\`\`\`json
{
  "allowedMcpPatterns": [
    { "pattern": "list", "comment": "Allow list operations" },
    { "pattern": "get", "comment": "Allow get operations" },
    { "pattern": "search", "comment": "Allow search operations" }
  ],
  "allowedApiEndpoints": [
    { "method": "GET", "path": ".*", "comment": "All GET requests" },
    { "method": "POST", "path": "^/search", "comment": "Search POST" }
  ],
  "allowedBashPatterns": [
    { "pattern": "^ls\\\\s", "comment": "Allow ls commands" }
  ],
  "blockedTools": [
    "dangerous_tool"
  ],
  "allowedWritePaths": [
    "/tmp/**",
    "~/.craft-agent/**"
  ]
}
\`\`\`

## Rule Types

### allowedMcpPatterns

Regex patterns for MCP tool names to allow in Explore mode.

For **source-level** permissions.json, use simple patterns (auto-scoped):
\`\`\`json
{
  "allowedMcpPatterns": [
    { "pattern": "list", "comment": "All list operations for this source" },
    { "pattern": "get", "comment": "All get operations for this source" },
    { "pattern": "search", "comment": "All search operations for this source" }
  ]
}
\`\`\`

For **workspace-level** permissions.json (global rules), use full patterns:
\`\`\`json
{
  "allowedMcpPatterns": [
    { "pattern": "^mcp__.*__list", "comment": "List operations across all sources" }
  ]
}
\`\`\`

### allowedApiEndpoints

Fine-grained rules for API source requests.

\`\`\`json
{
  "allowedApiEndpoints": [
    { "method": "GET", "path": ".*", "comment": "All GET requests" },
    { "method": "POST", "path": "^/search", "comment": "Search POST" },
    { "method": "POST", "path": "^/v1/query$", "comment": "Query endpoint" }
  ]
}
\`\`\`

### allowedBashPatterns

Regex patterns for bash commands to allow.

\`\`\`json
{
  "allowedBashPatterns": [
    { "pattern": "^ls\\\\s", "comment": "ls commands" },
    { "pattern": "^git\\\\s+status", "comment": "git status" },
    { "pattern": "^pwd$", "comment": "pwd command" }
  ]
}
\`\`\`

### blockedTools

Additional tools to block (rarely needed).

\`\`\`json
{
  "blockedTools": ["risky_tool_name"]
}
\`\`\`

### allowedWritePaths

Glob patterns for directories where writes are allowed.

\`\`\`json
{
  "allowedWritePaths": [
    "/tmp/**",
    "~/.craft-agent/**",
    "/path/to/project/output/**"
  ]
}
\`\`\`

## Default Behavior in Explore Mode

**Blocked by default:**
- Bash commands (except patterns in allowedBashPatterns)
- Write, Edit, MultiEdit tools
- MCP tools with write semantics
- API POST/PUT/DELETE requests

**Allowed by default:**
- Read, Glob, Grep
- WebFetch, WebSearch
- TodoWrite, AskUserQuestion
- MCP tools with read semantics (list, get, search)

## Cascading Rules

Rules cascade from workspace → source → agent:
1. Workspace rules apply globally
2. Source rules extend workspace rules for that source
3. Agent rules extend both for that agent's session

Rules are additive - they can only allow more operations, not restrict further.

## Best Practices

1. **Be specific with patterns** - Use anchors (^, $) to avoid over-matching
2. **Add comments** - Explain why each rule exists
3. **Test patterns** - Verify regex matches expected tool names
4. **Minimal permissions** - Only allow what's needed

## Examples

### Read-only Linear access:
\`\`\`json
{
  "allowedMcpPatterns": [
    { "pattern": "^mcp__linear__(list|get|search)", "comment": "Read operations" }
  ]
}
\`\`\`

### Search-only API:
\`\`\`json
{
  "allowedApiEndpoints": [
    { "method": "GET", "path": ".*" },
    { "method": "POST", "path": "^/search" }
  ]
}
\`\`\`

### Safe git commands:
\`\`\`json
{
  "allowedBashPatterns": [
    { "pattern": "^git\\\\s+(status|log|diff|branch)", "comment": "Read-only git" }
  ]
}
\`\`\`
`;

/**
 * Map of bundled documentation files
 */
const BUNDLED_DOCS: Record<string, string> = {
  'sources.md': SOURCES_MD,
  'agents.md': AGENTS_MD,
  'permissions.md': PERMISSIONS_MD,
};

export { BUNDLED_DOCS };

// Re-export source guides utilities
export {
  parseSourceGuide,
  getSourceGuide,
  getSourceGuideForDomain,
  getSourceKnowledge,
  extractDomainFromSource,
  extractDomainFromUrl,
  getSourceGuidesDir,
  BUNDLED_SOURCE_GUIDES,
  type ParsedSourceGuide,
  type SourceGuideFrontmatter,
} from './source-guides.ts';
