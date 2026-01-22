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
import { isDebugEnabled } from '../utils/debug.ts';
import { getAppVersion } from '../version/app-version.ts';

const CONFIG_DIR = join(homedir(), '.craft-agent');
const DOCS_DIR = join(CONFIG_DIR, 'docs');

// Track if docs have been initialized this session (prevents re-init on hot reload)
let docsInitialized = false;

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
  permissions: '~/.craft-agent/docs/permissions.md',
  skills: '~/.craft-agent/docs/skills.md',
  themes: '~/.craft-agent/docs/themes.md',
  statuses: '~/.craft-agent/docs/statuses.md',
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
 * - Debug mode: Always overwrite docs (once per session)
 * - Production: Only update if bundled version is newer
 */
export function initializeDocs(): void {
  // Skip if already initialized this session (prevents re-init on hot reload)
  if (docsInitialized) {
    return;
  }
  docsInitialized = true;

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
}

// ============================================================
// Bundled Documentation
// ============================================================

const SOURCES_MD = `# Sources Configuration Guide

This guide explains how to configure sources (MCP servers, APIs, local filesystems) in Craft Agent.

## Source Setup Process

When a user wants to add a new source, follow this conversational setup process to create a tailored, well-documented integration.

### 0. Search for Specialized Source Guide (REQUIRED FIRST STEP)

**Before doing anything else**, search for a specialized guide using the craft-agents-docs MCP:

\`\`\`
mcp__craft-agents-docs__SearchCraftAgents({ query: "{service} source setup" })
\`\`\`

**Available guides:** GitHub, Linear, Slack, Gmail, Google Calendar, Google Drive, Google Docs, Google Sheets, Outlook, Microsoft Calendar, Teams, SharePoint, Craft, Filesystem, Brave Search, Memory

**If a guide exists for the service:**
1. **Read the guide content** carefully
2. **Pay special attention to the "Setup Hints" section** - it contains critical instructions
3. **Follow any CRITICAL/MANDATORY instructions** before proceeding (e.g., GitHub requires checking for \`gh\` CLI first)
4. **ALWAYS verify current API endpoints via WebSearch** - URLs change frequently

**Why this matters:** Some services have important prerequisites or gotchas that MUST be checked before creating a source. Skipping this step can lead to failed setups or redundant configurations.

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

Based on research and user intent, create \`config.json\` with **ALL required fields**:

**Required fields:**
- \`name\`, \`slug\`, \`provider\`, \`type\` - Basic identification
- \`icon\` - **REQUIRED**: URL to the service's favicon, logo, or app icon. Search the web to find an appropriate icon that looks like an app icon. The icon is auto-downloaded and cached locally. Use an emoji as fallback.
- \`tagline\` - **REQUIRED**: Short description for agent context (e.g., "Issue tracking, sprint planning, and project management")
- Type-specific config (\`mcp\`, \`api\`, or \`local\`)
- Authentication method appropriate for the service

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

### 6. Test and Validate (MANDATORY)

**You MUST use the \`source_test\` tool after creating any source.** This applies to ALL source types - MCP, API, and local filesystem sources. This is not optional.

\`\`\`
mcp__session__source_test({ sourceSlug: "{slug}" })
\`\`\`

The \`source_test\` tool:
1. **Validates config.json** against the schema
2. **Downloads and caches the icon** if a URL was provided
3. **Tests the connection** to verify the source is reachable
4. **Reports missing fields** (icon, tagline) that should be added

After validation passes, trigger the appropriate auth flow:
- OAuth sources: \`source_oauth_trigger({ sourceSlug: "{slug}" })\`
- Bearer/API key: \`source_credential_prompt({ sourceSlug: "{slug}", mode: "bearer" })\`
- Google services: \`source_google_oauth_trigger({ sourceSlug: "{slug}" })\`
- Microsoft services: \`source_microsoft_oauth_trigger({ sourceSlug: "{slug}" })\`
- Slack: \`source_slack_oauth_trigger({ sourceSlug: "{slug}" })\`

**Do NOT skip validation** - it catches config errors before they cause runtime failures.

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

Agent: [FIRST: Searches for Linear guide]
       mcp__craft-agents-docs__SearchCraftAgents({ query: "linear source setup" })

Agent: I found the Linear setup guide! A few questions:
1. What will you primarily use Linear for? (issue tracking, sprint planning, reporting?)
2. Are there specific teams or projects you want to focus on?
3. Should I set it up for read-only exploration or full access?

User: Issue tracking for my iOS team, project called "Craft iOS"

Agent: [Uses WebSearch to verify current Linear MCP URL]
Agent: [Creates config.json with:
        - icon: (searches web for app icon or uses favicon)
        - tagline: "Issue tracking for the Craft iOS team"
        - OAuth authentication]
Agent: [Writes guide.md mentioning "Craft iOS" project and iOS team context]
Agent: [Sets up permissions.json for read-only listing in Explore mode]
Agent: [MANDATORY: Runs source_test to validate]
       mcp__session__source_test({ sourceSlug: "linear" })
Agent: [Triggers source_oauth_trigger for authentication]
       mcp__session__source_oauth_trigger({ sourceSlug: "linear" })

Agent: Linear is now set up! I've configured it to focus on the "Craft iOS" project.
You can use it to:
- Search and view issues in Craft iOS
- Track sprint progress for the iOS team
- Create and update issues

Would you like me to show you what issues are currently open?
\`\`\`

## Overview

Sources are stored as folders under:
- \`~/.craft-agent/workspaces/{workspaceId}/sources/{sourceSlug}/\`

Each source folder contains:
- \`config.json\` - Source configuration (required)
- \`guide.md\` - Usage documentation for Claude (optional)
- \`permissions.json\` - Custom permission rules for Explore mode (optional)
- \`icon.svg\`, \`icon.png\`, \`icon.jpg\`, or \`icon.jpeg\` - Source icon (optional)

## config.json Schema

\`\`\`json
{
  "id": "uuid",
  "name": "Human-readable name",
  "slug": "url-safe-identifier",
  "enabled": true,
  "provider": "provider-name",
  "type": "mcp" | "api" | "local",

  // REQUIRED: Icon and tagline for UI and agent context
  "icon": "https://example.com/favicon.ico",  // URL (auto-downloaded) or emoji
  "tagline": "Brief description for agent context",

  // For MCP sources:
  "mcp": {
    "url": "https://mcp.example.com",
    "authType": "oauth" | "bearer" | "none"
  },

  // For API sources:
  "api": {
    "baseUrl": "https://api.example.com/",  // MUST have trailing slash
    "authType": "bearer" | "header" | "query" | "basic" | "none",
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

  // Icon: emoji or URL (auto-downloaded to local icon.* file)
  // Local icon files are auto-discovered, no config needed
  "icon": "🔧",                      // Emoji icon (optional)

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

**Stdio transport (local command):**

For MCP servers that run locally via command line (npx, node, python), use the stdio transport.

Users often provide configs in Claude Desktop / Claude Code format:
\`\`\`json
{
  "mcpServers": {
    "airbnb": {
      "command": "npx",
      "args": ["-y", "@openbnb/mcp-server-airbnb"]
    }
  }
}
\`\`\`

Convert to native format:
\`\`\`json
{
  "type": "mcp",
  "name": "Airbnb",
  "provider": "airbnb",
  "mcp": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@openbnb/mcp-server-airbnb"],
    "authType": "none"
  }
}
\`\`\`

With environment variables:
\`\`\`json
{
  "type": "mcp",
  "name": "Brave Search",
  "provider": "brave",
  "mcp": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-brave-search"],
    "env": {
      "BRAVE_API_KEY": "your-api-key"
    },
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
    "baseUrl": "https://api.exa.ai/",
    "authType": "header",
    "headerName": "x-api-key",
    "testEndpoint": {
      "method": "POST",
      "path": "search",
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
    "baseUrl": "https://api.openai.com/v1/",
    "authType": "bearer",
    "testEndpoint": {
      "method": "GET",
      "path": "models"
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
    "baseUrl": "https://api.weather.com/",
    "authType": "query",
    "queryParam": "apikey",
    "testEndpoint": {
      "method": "GET",
      "path": "v1/current"
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
    "baseUrl": "https://your-domain.atlassian.net/rest/api/3/",
    "authType": "basic",
    "testEndpoint": {
      "method": "GET",
      "path": "myself"
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
    "path": "v1/me",           // Path relative to baseUrl (NO leading slash)
    "body": { ... }            // Optional: request body for POST
  }
}
\`\`\`

**IMPORTANT URL formatting:**
- \`baseUrl\` MUST have a trailing slash: \`https://api.example.com/v1/\`
- \`testEndpoint.path\` must NOT have a leading slash: \`users/me\`

**Choose an endpoint that:**
- Requires authentication (to verify credentials work)
- Is lightweight (doesn't fetch much data)
- Returns quickly (health/status endpoints are ideal)

**Common patterns:**
- \`me\`, \`user\`, \`profile\` - User info endpoints
- \`v1/status\`, \`health\` - Status endpoints that require auth
- \`models\`, \`projects\` - List endpoints with minimal data

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

**After creating, run \`source_test\`** to validate the path exists and is accessible.

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

## Provider Domain Cache

For favicon resolution, a cache maps provider names to their canonical domains at:
\`~/.craft-agent/provider-domains.json\`

**Format:**
\`\`\`json
{
  "version": 1,
  "domains": {
    "linear": "linear.app",
    "notion": "notion.so",
    "brave": "brave.com"
  },
  "updatedAt": 1704067200000
}
\`\`\`

**When to update:** If a source's favicon appears incorrect (generic globe, wrong icon), add the provider→domain mapping to this file. The app loads this cache on startup.

**Example:** If "acme-mcp" source shows wrong icon, add:
\`\`\`json
"acme": "acme.com"
\`\`\`

## Common Providers

### Gmail
Provider: \`gmail\`, Type: \`api\`
Uses OAuth via \`source_gmail_oauth_trigger\`.

### Linear
Provider: \`linear\`, Type: \`mcp\`
URL: \`https://mcp.linear.app\`, OAuth auth.

### GitHub
Provider: \`github\`, Type: \`mcp\`
URL: \`https://api.githubcopilot.com/mcp/\`, **bearer auth** (PAT required - OAuth will fail).

### Exa (Search)
Provider: \`exa\`, Type: \`api\`
Base URL: \`https://api.exa.ai\`, header auth with \`x-api-key\`.

### Brave Search
Provider: \`brave\`, Type: \`mcp\`
Transport: \`stdio\`, Command: \`npx -y @modelcontextprotocol/server-brave-search\`, requires \`BRAVE_API_KEY\` env.

### Memory
Provider: \`memory\`, Type: \`mcp\`
Transport: \`stdio\`, Command: \`npx -y @modelcontextprotocol/server-memory\`, no auth.

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

const SKILLS_MD = `# Skills Configuration Guide

This guide explains how to create and configure skills in Craft Agent.

## What Are Skills?

Skills are specialized instructions that extend Claude's capabilities for specific tasks. They use **the exact same SKILL.md format as the Claude Code SDK** - making skills fully compatible between systems.

**Key points:**
- Skills are invoked via slash commands (e.g., \`/commit\`, \`/review-pr\`)
- Skills can be automatically triggered by file patterns (globs)
- Skills can pre-approve specific tools to run without prompting
- The SKILL.md format is identical to what Claude Code uses internally

## Same Format as Claude Code SDK

Craft Agent uses **the identical SKILL.md format** as the Claude Code SDK. This means:

1. **Format compatibility**: Any skill written for Claude Code works in Craft Agent
2. **Same frontmatter fields**: \`name\`, \`description\`, \`globs\`, \`alwaysAllow\`
3. **Same content structure**: Markdown body with instructions for Claude

**What Craft Agent adds:**
- **Visual icons**: Display custom icons in the UI for each skill
- **Workspace organization**: Skills are scoped to workspaces
- **UI management**: Browse, edit, and validate skills through the interface

## Skill Precedence

When a skill is invoked (e.g., \`/commit\`):

1. **Workspace skill checked first** - If \`~/.craft-agent/workspaces/{id}/skills/commit/SKILL.md\` exists, it's used
2. **SDK skill as fallback** - If no workspace skill exists, the built-in SDK skill is used

This allows you to:
- **Override SDK skills** - Create a workspace skill with the same slug to replace built-in behavior
- **Extend SDK skills** - Reference SDK behavior in your custom skill and add workspace-specific instructions
- **Create new skills** - Add entirely new skills not in the SDK

## Skill Storage

Skills are stored as folders:
\`\`\`
~/.craft-agent/workspaces/{workspaceId}/skills/{slug}/
├── SKILL.md          # Required: Skill definition (same format as Claude Code SDK)
├── icon.svg          # Recommended: Skill icon for UI display
├── icon.png          # Alternative: PNG icon
└── (other files)     # Optional: Additional resources
\`\`\`

## SKILL.md Format

The format is identical to Claude Code SDK skills:

\`\`\`yaml
---
name: "Skill Display Name"
description: "Brief description shown in skill list"
globs: ["*.ts", "*.tsx"]     # Optional: file patterns that trigger skill
alwaysAllow: ["Bash"]        # Optional: tools to always allow
---

# Skill Instructions

Your skill content goes here. This is injected into Claude's context
when the skill is active.

## Guidelines

- Specific instructions for Claude
- Best practices to follow
- Things to avoid

## Examples

Show Claude how to perform the task correctly.
\`\`\`

## Metadata Fields

### name (required)
Display name for the skill. Shown in the UI and skill list.

### description (required)
Brief description (1-2 sentences) explaining what the skill does.

### globs (optional)
Array of glob patterns. When a file matching these patterns is being worked on,
the skill may be automatically suggested or activated.

\`\`\`yaml
globs:
  - "*.test.ts"           # Test files
  - "*.spec.tsx"          # React test files
  - "**/__tests__/**"     # Test directories
\`\`\`

### alwaysAllow (optional)
Array of tool names that are automatically allowed when this skill is active.
Useful for skills that require specific tools without prompting.

\`\`\`yaml
alwaysAllow:
  - "Bash"                # Allow bash commands
  - "Write"               # Allow file writes
\`\`\`

## Creating a Skill

### 1. Create the skill directory

\`\`\`bash
mkdir -p ~/.craft-agent/workspaces/{ws}/skills/my-skill
\`\`\`

### 2. Write SKILL.md

\`\`\`markdown
---
name: "Code Review"
description: "Review code changes for quality, security, and best practices"
globs: ["*.ts", "*.tsx", "*.js", "*.jsx"]
---

# Code Review Skill

When reviewing code, focus on:

## Quality Checks
- Consistent code style
- Clear naming conventions
- Appropriate abstractions

## Security Checks
- Input validation
- Authentication/authorization
- Sensitive data handling

## Best Practices
- Error handling
- Performance considerations
- Test coverage
\`\`\`

### 3. Add an icon (IMPORTANT)

Every skill should have a visually relevant icon. This helps users quickly identify skills in the UI.

**Icon requirements:**
- **Filename**: Must be \`icon.svg\`, \`icon.png\`, \`icon.jpg\`, or \`icon.jpeg\`
- **Format**: SVG preferred (scalable, crisp at all sizes)
- **Size**: For PNG/JPG, use at least 64x64 pixels

**How to get an icon:**

1. **Search online icon libraries:**
   - [Heroicons](https://heroicons.com/) - MIT licensed
   - [Feather Icons](https://feathericons.com/) - MIT licensed
   - [Simple Icons](https://simpleicons.org/) - Brand icons (git, npm, etc.)

2. **Use WebFetch to download:**
   \`\`\`
   # Find an appropriate icon URL and download it
   WebFetch to get SVG content, then save to icon.svg
   \`\`\`

3. **Match the skill's purpose:**
   - Git/commit skill → git icon or commit icon
   - Test skill → checkmark or test tube icon
   - Deploy skill → rocket or cloud icon
   - Review skill → magnifying glass or eye icon

### 4. Validate the skill

**IMPORTANT**: Always validate after creating or editing a skill:

\`\`\`
skill_validate({ skillSlug: "my-skill" })
\`\`\`

This validates:
- Slug format (lowercase, alphanumeric, hyphens only)
- SKILL.md exists and is readable
- YAML frontmatter is valid
- Required fields present (name, description)
- Content is non-empty
- Icon format (if present)

## Example Skills

### Commit Message Skill

\`\`\`yaml
---
name: "Commit"
description: "Create well-formatted git commit messages"
alwaysAllow: ["Bash"]
---

# Commit Message Guidelines

When creating commits:

1. **Format**: Use conventional commits
   - \`feat:\` New feature
   - \`fix:\` Bug fix
   - \`docs:\` Documentation
   - \`refactor:\` Code refactoring
   - \`test:\` Adding tests

2. **Style**:
   - Keep subject line under 72 characters
   - Use imperative mood ("Add feature" not "Added feature")
   - Explain why, not what (the diff shows what)

3. **Co-authorship**:
   Always include: \`Co-Authored-By: Claude <noreply@anthropic.com>\`
\`\`\`

**Recommended icon**: Git commit icon from Heroicons or Simple Icons

### Team Standards Skill

\`\`\`yaml
---
name: "Team Standards"
description: "Enforce team coding conventions and patterns"
globs: ["src/**/*.ts", "src/**/*.tsx"]
---

# Team Coding Standards

## File Organization
- One component per file
- Co-locate tests with source files
- Use barrel exports (index.ts)

## Naming Conventions
- Components: PascalCase
- Hooks: camelCase with \`use\` prefix
- Constants: SCREAMING_SNAKE_CASE

## Import Order
1. External packages
2. Internal packages (@company/*)
3. Relative imports
\`\`\`

**Recommended icon**: Clipboard list or checklist icon

## Overriding SDK Skills

To customize a built-in SDK skill like \`/commit\`:

1. Create \`~/.craft-agent/workspaces/{ws}/skills/commit/SKILL.md\`
2. Write your custom instructions
3. Add an icon
4. Run \`skill_validate({ skillSlug: "commit" })\`

Your skill will be used instead of the SDK's built-in version.

This is useful for:
- Adding team-specific commit message formats
- Enforcing project-specific coding standards
- Customizing review criteria for your codebase

## Best Practices

1. **Be specific**: Give Claude clear, actionable instructions
2. **Include examples**: Show the expected output format
3. **Set boundaries**: Explain what NOT to do
4. **Keep focused**: One skill = one specific task or domain
5. **Add a relevant icon**: Makes skills easily identifiable in the UI
6. **Always validate**: Run \`skill_validate\` after creating or editing

## Troubleshooting

**Skill not loading:**
- Check slug format (lowercase, alphanumeric, hyphens only)
- Verify SKILL.md exists and is readable
- Run \`skill_validate\` for detailed errors

**Skill not triggering:**
- Check glob patterns match your files
- Verify skill is in correct workspace

**Icon not showing:**
- Use supported formats: svg, png, jpg, jpeg
- File must be named \`icon.{ext}\` (not \`my-icon.svg\`)
- Check icon file is not corrupted
- For SVG, ensure valid XML structure
`;

const PERMISSIONS_MD = `# Permissions Configuration Guide

This guide explains how to configure custom permission rules for Explore mode.

## Overview

Explore mode is a read-only mode that blocks potentially destructive operations.
Custom permission rules let you allow specific operations that would otherwise be blocked.

Permission files are located at:
- Workspace: \`~/.craft-agent/workspaces/{slug}/permissions.json\`
- Source: \`~/.craft-agent/workspaces/{slug}/sources/{source}/permissions.json\`

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
- TodoWrite
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

const THEMES_MD = `# Theme Configuration Guide

This guide explains how to customize the visual theme of Craft Agent.

## Overview

Craft Agent uses a 6-color theme system. You can override specific colors or install preset themes with complete visual styles.

- **Theme overrides**: \`~/.craft-agent/theme.json\` - Override specific colors
- **Preset themes**: \`~/.craft-agent/themes/{name}.json\` - Complete theme packages

Both are optional - the app has sensible built-in defaults.

## 6-Color System

| Color | Purpose | Usage |
|-------|---------|-------|
| \`background\` | Surface/page background | Light/dark surface color |
| \`foreground\` | Text and icons | Primary text color |
| \`accent\` | Brand color, Execute mode | Highlights, active states, purple UI elements |
| \`info\` | Warnings, Ask mode | Amber indicators, attention states |
| \`success\` | Connected status | Green checkmarks, success states |
| \`destructive\` | Errors, delete actions | Red alerts, failed states |

## Color Formats

Any valid CSS color format is supported:
- **Hex**: \`#8b5cf6\`, \`#8b5cf6cc\` (with alpha)
- **RGB**: \`rgb(139, 92, 246)\`, \`rgba(139, 92, 246, 0.8)\`
- **HSL**: \`hsl(262, 83%, 58%)\`
- **OKLCH**: \`oklch(0.58 0.22 293)\` (recommended)
- **Named**: \`purple\`, \`rebeccapurple\`

**Recommendation**: Use OKLCH for perceptually uniform colors that look consistent across light/dark modes.

## Theme Override File

Create \`~/.craft-agent/theme.json\` to override specific colors:

\`\`\`json
{
  "accent": "oklch(0.58 0.22 293)",
  "dark": {
    "accent": "oklch(0.65 0.22 293)"
  }
}
\`\`\`

All fields are optional. Only specify colors you want to override.

## Dark Mode

The \`dark\` object provides optional overrides for dark mode. When the user's system is in dark mode:
1. Base colors (top-level) are used as defaults
2. Any colors defined in \`dark\` override the base colors

This allows partial dark mode customization - only override what needs to differ.

## Preset Themes

Preset themes are complete theme packages stored at \`~/.craft-agent/themes/\`. Each preset is a JSON file with theme colors and metadata.

### Preset Theme Schema

\`\`\`json
{
  "name": "Dracula",
  "description": "A dark theme with vibrant colors",
  "author": "Zeno Rocha",
  "license": "MIT",
  "source": "https://draculatheme.com",
  "supportedModes": ["dark"],

  "background": "oklch(0.22 0.02 280)",
  "foreground": "oklch(0.95 0.01 270)",
  "accent": "oklch(0.70 0.20 320)",
  "info": "oklch(0.78 0.14 70)",
  "success": "oklch(0.72 0.18 145)",
  "destructive": "oklch(0.65 0.22 28)",

  "shikiTheme": {
    "light": "github-light",
    "dark": "dracula"
  }
}
\`\`\`

### Preset Metadata Fields

| Field | Description |
|-------|-------------|
| \`name\` | Display name for the theme |
| \`description\` | Short description |
| \`author\` | Theme creator |
| \`license\` | License type (MIT, etc.) |
| \`source\` | URL to original theme |
| \`supportedModes\` | Array of \`"light"\`, \`"dark"\`, or both |
| \`shikiTheme\` | Syntax highlighting theme (light/dark variants) |

### Installing Preset Themes

1. Download or create a theme JSON file
2. Save it to \`~/.craft-agent/themes/{name}.json\`
3. Select the theme in Settings → Appearance

## Scenic Mode

Scenic mode displays a full-window background image with glass-style panels. This creates a visually immersive experience.

### Enabling Scenic Mode

\`\`\`json
{
  "mode": "scenic",
  "backgroundImage": "mountains.jpg",

  "background": "oklch(0.15 0.02 270 / 0.8)",
  "paper": "oklch(0.18 0.02 270 / 0.6)",
  "navigator": "oklch(0.12 0.02 270 / 0.7)",
  "popoverSolid": "oklch(0.18 0.02 270)"
}
\`\`\`

### Scenic Mode Properties

| Property | Description |
|----------|-------------|
| \`mode\` | Set to \`"scenic"\` (default is \`"solid"\`) |
| \`backgroundImage\` | Image filename (relative to theme file) or URL |

### Surface Colors for Glass Panels

Scenic mode benefits from semi-transparent surface colors:

| Color | Purpose |
|-------|---------|
| \`paper\` | AI messages, cards, elevated content |
| \`navigator\` | Left sidebar background |
| \`input\` | Input field background |
| \`popover\` | Dropdowns, modals, context menus |
| \`popoverSolid\` | Guaranteed 100% opaque popover background |

**Note:** Scenic themes automatically force dark mode for better contrast with background images.

## Default Theme

The built-in default theme uses OKLCH colors optimized for accessibility:

**Light Mode:**
- Background: \`oklch(0.98 0.003 265)\` - Very light gray with slight purple tint
- Foreground: \`oklch(0.185 0.01 270)\` - Near-black for high contrast
- Accent: \`oklch(0.58 0.22 293)\` - Vibrant purple
- Info: \`oklch(0.75 0.16 70)\` - Warm amber
- Success: \`oklch(0.55 0.17 145)\` - Clear green
- Destructive: \`oklch(0.58 0.24 28)\` - Alert red

**Dark Mode:**
- Background: \`oklch(0.145 0.015 270)\` - Deep dark with purple tint
- Foreground: \`oklch(0.95 0.01 270)\` - Near-white
- Accent/Info/Success/Destructive: Slightly brighter versions for visibility

## Examples

### Minimal: Just change accent color
\`\`\`json
{
  "accent": "#3b82f6"
}
\`\`\`

### Custom brand colors
\`\`\`json
{
  "accent": "oklch(0.55 0.25 250)",
  "info": "oklch(0.70 0.15 200)",
  "dark": {
    "accent": "oklch(0.65 0.25 250)",
    "info": "oklch(0.75 0.12 200)"
  }
}
\`\`\`

### High contrast theme
\`\`\`json
{
  "background": "#ffffff",
  "foreground": "#000000",
  "dark": {
    "background": "#000000",
    "foreground": "#ffffff"
  }
}
\`\`\`

## Live Updates

Theme changes are applied immediately - no restart needed. Edit theme.json and the UI updates automatically.

## Creating a Theme

1. Create \`~/.craft-agent/theme.json\` for overrides or \`~/.craft-agent/themes/{name}.json\` for a preset
2. Add only the colors you want to customize
3. Optionally add \`dark\` overrides for dark mode

**Tips:**
- Start with just \`accent\` to quickly personalize
- Use OKLCH for predictable color behavior
- Test in both light and dark modes
- Keep contrast ratios accessible (foreground vs background)

## Troubleshooting

**Theme not applying:**
- Verify JSON syntax is valid
- Check file is in correct location (\`~/.craft-agent/theme.json\` for overrides, \`~/.craft-agent/themes/\` for presets)
- Ensure color values are valid CSS colors

**Colors look wrong in dark mode:**
- Add explicit \`dark\` overrides
- OKLCH colors may need higher lightness values for dark mode
- Check if preset has \`supportedModes\` that excludes your current mode

**Background image not showing:**
- Ensure \`mode\` is set to \`"scenic"\`
- Check image path is relative to theme file or a valid URL
- Verify image file exists and is readable

## OKLCH Color Reference

OKLCH format: \`oklch(lightness chroma hue)\`
- **Lightness**: 0-1 (0 = black, 1 = white)
- **Chroma**: 0-0.4 (0 = gray, higher = more saturated)
- **Hue**: 0-360 (color wheel angle)

Common hues:
- Red: ~25
- Orange: ~70
- Yellow: ~100
- Green: ~145
- Cyan: ~195
- Blue: ~250
- Purple: ~293
- Pink: ~330
`;

const STATUSES_MD = `# Status Configuration

Session statuses represent workflow states. Each workspace has its own status configuration.

## Storage Locations

- Config: \`~/.craft-agent/workspaces/{id}/statuses/config.json\`
- Icons: \`~/.craft-agent/workspaces/{id}/statuses/icons/\`

## Default Statuses

| ID | Label | Default Color | Category | Type |
|----|-------|---------------|----------|------|
| \`backlog\` | Backlog | text-foreground/50 | open | Default |
| \`todo\` | Todo | text-foreground | open | Fixed |
| \`needs-review\` | Needs Review | text-info | open | Default |
| \`done\` | Done | text-accent | closed | Fixed |
| \`cancelled\` | Cancelled | text-foreground/50 | closed | Fixed |

**Note:** Color is optional. When omitted, the design system default is used.

## Status Types

- **Fixed** (\`isFixed: true\`): Cannot be deleted or renamed. Required statuses: \`todo\`, \`done\`, \`cancelled\`.
- **Default** (\`isDefault: true\`): Ships with app, can be modified but not deleted.
- **Custom** (\`isFixed: false, isDefault: false\`): User-created, fully editable and deletable.

## Category System

- **open**: Session appears in inbox/active list
- **closed**: Session appears in archive/completed list

## config.json Schema

\`\`\`json
{
  "version": 1,
  "statuses": [
    {
      "id": "todo",
      "label": "Todo",
      "category": "open",
      "isFixed": true,
      "isDefault": false,
      "order": 0
    }
  ],
  "defaultStatusId": "todo"
}
\`\`\`

**Note:** The \`icon\` field is optional. Default statuses use auto-discovered SVG files from \`statuses/icons/{id}.svg\`.

## Status Properties

| Property | Type | Description |
|----------|------|-------------|
| \`id\` | string | Unique slug (lowercase, hyphens) |
| \`label\` | string | Display name |
| \`color\` | string? | Optional color (hex or Tailwind class). Uses design system default if omitted. |
| \`icon\` | string? | Optional emoji (e.g., \`"🔥"\`) or URL. Omit to use auto-discovered file. |
| \`category\` | \`"open"\` \\| \`"closed"\` | Inbox vs archive |
| \`isFixed\` | boolean | Cannot delete/rename if true |
| \`isDefault\` | boolean | Ships with app, cannot delete |
| \`order\` | number | Display order (lower = first) |

## Icon Configuration

Icon resolution priority:
1. **Local file** - Auto-discovered from \`statuses/icons/{id}.svg\` (or .png, .jpg, .jpeg)
2. **Emoji** - If \`icon\` field is an emoji string (e.g., \`"🔥"\`)
3. **Fallback** - Bullet character if no icon found

**File-based icons (recommended for default statuses):**
- Place SVG in \`statuses/icons/{status-id}.svg\`
- No config needed - auto-discovered by status ID
- Example: \`statuses/icons/blocked.svg\` for status ID \`blocked\`

**Emoji icons (quick and easy):**
\`\`\`json
"icon": "🔥"
\`\`\`

**URL icons (auto-downloaded):**
\`\`\`json
"icon": "https://example.com/icon.svg"
\`\`\`
URLs are automatically downloaded to \`statuses/icons/{id}.{ext}\`.

**⚠️ Icon Sourcing Rules:**
- **DO** generate custom SVG files following the guidelines below
- **DO** download icons from the web (e.g., Heroicons, Feather, Simple Icons)
- **DO** use emoji for quick, universal icons

## Adding Custom Statuses

Edit the workspace's \`statuses/config.json\`:

\`\`\`json
{
  "id": "blocked",
  "label": "Blocked",
  "color": "#EF4444",
  "icon": "🚫",
  "category": "open",
  "isFixed": false,
  "isDefault": false,
  "order": 3
}
\`\`\`

Adjust \`order\` values for existing statuses as needed.

## SVG Icon Guidelines

- Size: 24x24
- Use \`currentColor\` for stroke/fill (theming support)
- stroke-width: 2
- stroke-linecap: round
- stroke-linejoin: round

## Self-Healing

- Missing icon files are auto-recreated from embedded defaults
- Invalid status IDs on sessions fallback to \`todo\`
- Corrupted configs reset to defaults

## Validation

**IMPORTANT**: Always validate after creating or editing statuses:

\`\`\`
config_validate({ target: "statuses" })
\`\`\`

This validates:
- Required fixed statuses exist (\`todo\`, \`done\`, \`cancelled\`)
- No duplicate status IDs
- \`defaultStatusId\` references an existing status
- Icon files exist when referenced
- At least one status in each category (open/closed)

Invalid configs will fall back to defaults at runtime, but validation catches issues before they cause problems.
`;

/**
 * Map of bundled documentation files
 */
const BUNDLED_DOCS: Record<string, string> = {
  'sources.md': SOURCES_MD,
  'permissions.md': PERMISSIONS_MD,
  'skills.md': SKILLS_MD,
  'themes.md': THEMES_MD,
  'statuses.md': STATUSES_MD,
};

export { BUNDLED_DOCS };

// Re-export source guides utilities (parsing only - bundled guides removed)
export {
  parseSourceGuide,
  getSourceGuide,
  getSourceGuideForDomain,
  getSourceKnowledge,
  extractDomainFromSource,
  extractDomainFromUrl,
  type ParsedSourceGuide,
  type SourceGuideFrontmatter,
} from './source-guides.ts';

// Re-export doc links (for UI help popovers)
export {
  getDocUrl,
  getDocInfo,
  DOCS,
  type DocFeature,
  type DocInfo,
} from './doc-links.ts';
