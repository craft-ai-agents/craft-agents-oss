# Sources Configuration Guide

This guide explains how to configure sources (MCP servers, APIs, local filesystems) in Craft Agent.

## Source Setup Process

When a user wants to add a new source, follow this conversational setup process to create a tailored, well-documented integration.

### 0. Search for Specialized Source Guide (REQUIRED FIRST STEP)

**Before doing anything else**, search for a specialized guide using the craft-agents-docs MCP:

```
mcp__craft-agents-docs__SearchCraftAgents({ query: "{service} source setup" })
```

**Available guides:** GitHub, Linear, Slack, Gmail, Google Calendar, Google Drive, Google Docs, Google Sheets, Outlook, Microsoft Calendar, Teams, SharePoint, Craft, Filesystem, Brave Search, Memory

**If a guide exists for the service:**
1. **Read the guide content** carefully
2. **Pay special attention to the "Setup Hints" section** - it contains critical instructions
3. **Follow any CRITICAL/MANDATORY instructions** before proceeding (e.g., GitHub requires checking for `gh` CLI first)
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

Based on research and user intent, create `config.json` with **ALL required fields**:

**Required fields:**
- `id` - **REQUIRED**: Unique identifier string. Format: `{slug}_{random}` (e.g., `linear_a1b2c3d4`). Generate the random part with any method (e.g., 8 hex chars).
- `name`, `slug`, `provider`, `type` - Basic identification
- `icon` - **REQUIRED**: URL to the service's favicon, logo, or app icon. Search the web to find an appropriate icon that looks like an app icon. The icon is auto-downloaded and cached locally. Use an emoji as fallback.
- `tagline` - **REQUIRED**: Short description for agent context (e.g., "Issue tracking, sprint planning, and project management")
- Type-specific config (`mcp`, `api`, or `local`)
- Authentication method appropriate for the service

### 4. Configure Explore Mode Permissions (REQUIRED)

Sources should work in Explore mode by default. Create `permissions.json` to allow read-only operations.

**How it works:** Patterns in a source's `permissions.json` are automatically scoped to that source. Write simple patterns like `list` - the system converts them to `mcp__<sourceSlug>__.*list` internally. This prevents cross-source leakage.

**For MCP sources:**
1. After connecting, list the server's available tools
2. Identify read-only tools (list, get, search, find, query operations)
3. Create simple patterns for those operations

```json
{
  "allowedMcpPatterns": [
    { "pattern": "list", "comment": "All list operations" },
    { "pattern": "get", "comment": "All get/read operations" },
    { "pattern": "search", "comment": "All search operations" },
    { "pattern": "find", "comment": "All find operations" }
  ]
}
```

**For API sources:**
```json
{
  "allowedApiEndpoints": [
    { "method": "GET", "path": ".*", "comment": "All GET requests are read-only" },
    { "method": "POST", "path": "^/search", "comment": "Search endpoint (read-only despite POST)" }
  ]
}
```

**For local sources:**
```json
{
  "allowedBashPatterns": [
    { "pattern": "^(ls|cat|head|tail|grep|find|tree)\\s", "comment": "Read-only commands" }
  ]
}
```

> **Goal:** Sources should be fully functional in Explore mode. Allow all read operations by default. Only block actual mutations (create, update, delete).

### 5. Write Comprehensive guide.md

Create a guide.md tailored to the user's context:
- Summarize the source's purpose in their specific use case
- Document capabilities relevant to their workflow
- Include specific project/team/scope references they mentioned
- Add usage examples tailored to their tasks
- Note rate limits, quotas, or limitations

### 6. Test and Validate (MANDATORY)

**You MUST use the `source_test` tool after creating any source.** This applies to ALL source types - MCP, API, and local filesystem sources. This is not optional.

```
mcp__session__source_test({ sourceSlug: "{slug}" })
```

The `source_test` tool:
1. **Validates config.json** against the schema
2. **Downloads and caches the icon** if a URL was provided
3. **Tests the connection** to verify the source is reachable
4. **Reports missing fields** (icon, tagline) that should be added

After validation passes, trigger the appropriate auth flow:
- OAuth sources: `source_oauth_trigger({ sourceSlug: "{slug}" })`
- Bearer/API key: `source_credential_prompt({ sourceSlug: "{slug}", mode: "bearer" })`
- Google services: `source_google_oauth_trigger({ sourceSlug: "{slug}" })`
- Microsoft services: `source_microsoft_oauth_trigger({ sourceSlug: "{slug}" })`
- Slack: `source_slack_oauth_trigger({ sourceSlug: "{slug}" })`

**Do NOT skip validation** - it catches config errors before they cause runtime failures.

## guide.md Best Practices

The guide.md file is critical—it helps Claude understand how to use the source effectively in future sessions.

### Structure

```markdown
# Source Name

Brief description of what this source provides and the user's specific use case.

## Scope

What data/functionality this provides. Include:
- Specific projects, teams, or repos the user mentioned
- Relevant filters or defaults
- Any limitations on access

## Guidelines

- Best practices for using this source
- Rate limits or quotas to be aware of
- Common patterns the user will need
- Things to avoid or be careful about

## Examples

Concrete examples tailored to the user's workflow:
- "To find issues in the Craft iOS project: ..."
- "To search for recent commits by the mobile team: ..."
```

### Key Principles

1. **Be specific to user context**: Reference the projects, teams, and tasks they mentioned
2. **Include concrete examples**: Use their actual project names and workflows
3. **Document user preferences**: Any preferences they shared for future sessions
4. **Note scope boundaries**: What the source can and cannot do
5. **Keep it actionable**: Focus on what Claude needs to know to help effectively

## Example Conversational Flow

```
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
```

## Overview

Sources are stored as folders under:
- `~/.craft-agent/workspaces/{workspaceId}/sources/{sourceSlug}/`

Each source folder contains:
- `config.json` - Source configuration (required)
- `guide.md` - Usage documentation for Claude (optional)
- `permissions.json` - Custom permission rules for Explore mode (optional)
- `icon.svg`, `icon.png`, `icon.jpg`, or `icon.jpeg` - Source icon (optional)

## config.json Schema

```json
{
  "id": "linear_a1b2c3d4",        // Unique identifier: {slug}_{random}
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
```

## Source Types

### MCP Sources

Model Context Protocol servers provide tools via HTTP/SSE.

**OAuth authentication (recommended):**
```json
{
  "id": "linear_a1b2c3d4",
  "type": "mcp",
  "provider": "linear",
  "mcp": {
    "url": "https://mcp.linear.app",
    "authType": "oauth"
  }
}
```

After creating, use `source_oauth_trigger` to authenticate.

**Bearer token authentication:**
```json
{
  "type": "mcp",
  "provider": "custom-mcp",
  "mcp": {
    "url": "https://my-mcp-server.com",
    "authType": "bearer"
  }
}
```

After creating, use `source_credential_prompt` with mode "bearer".

**Public (no auth):**
```json
{
  "type": "mcp",
  "provider": "public-mcp",
  "mcp": {
    "url": "https://public-mcp.example.com",
    "authType": "none"
  }
}
```

**Stdio transport (local command):**

For MCP servers that run locally via command line (npx, node, python), use the stdio transport.

Users often provide configs in Claude Desktop / Claude Code format:
```json
{
  "mcpServers": {
    "airbnb": {
      "command": "npx",
      "args": ["-y", "@openbnb/mcp-server-airbnb"]
    }
  }
}
```

Convert to native format:
```json
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
```

With environment variables:
```json
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
```

### API Sources

REST APIs become flexible tools that Claude can call.

**IMPORTANT:** Authenticated API sources require a `testEndpoint` to validate credentials during `source_test`. Without it, we cannot verify your credentials work.

**Header authentication (X-API-Key style):**
```json
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
```

**Bearer token (Authorization header):**
```json
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
```

**Query parameter:**
```json
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
```

**Basic authentication:**
```json
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
```

### testEndpoint Configuration

The `testEndpoint` specifies which endpoint to call when validating credentials:

```json
{
  "testEndpoint": {
    "method": "GET",           // "GET" or "POST"
    "path": "v1/me",           // Path relative to baseUrl (NO leading slash)
    "body": { ... }            // Optional: request body for POST
  }
}
```

**IMPORTANT URL formatting:**
- `baseUrl` MUST have a trailing slash: `https://api.example.com/v1/`
- `testEndpoint.path` must NOT have a leading slash: `users/me`

**Choose an endpoint that:**
- Requires authentication (to verify credentials work)
- Is lightweight (doesn't fetch much data)
- Returns quickly (health/status endpoints are ideal)

**Common patterns:**
- `me`, `user`, `profile` - User info endpoints
- `v1/status`, `health` - Status endpoints that require auth
- `models`, `projects` - List endpoints with minimal data

**Public APIs (authType: 'none')** don't require testEndpoint - we test by hitting the base URL.

### Local Sources

Filesystem access for local folders.

```json
{
  "type": "local",
  "provider": "obsidian",
  "local": {
    "path": "/Users/me/Documents/ObsidianVault"
  }
}
```

**After creating, run `source_test`** to validate the path exists and is accessible.

## guide.md Format

The guide.md file helps Claude understand how to use the source effectively.

```markdown
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
- `query` (string, required): Search query
- `limit` (number, optional): Max results (default: 10)

**Example:**
\`\`\`json
{
  "query": "machine learning",
  "limit": 5
}
\`\`\`
```

## permissions.json Format

Custom rules to extend Explore mode permissions for this source.

```json
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
      "pattern": "^ls\\s",
      "comment": "Allow ls commands"
    }
  ]
}
```

## Icon Handling

The `config.icon` field controls the source icon. Resolution follows this priority:

| `config.icon` value | Behavior |
|---------------------|----------|
| Emoji (e.g., `"🔧"`) | Rendered as emoji text |
| Local path `"./icon.svg"` | Loads from `sources/{slug}/icon.svg` |
| URL `"https://..."` | Auto-downloaded to local `icon.*` file by `source_test` |
| Undefined/null | Auto-discovers `sources/{slug}/icon.{svg,png}`, falls back to favicon |

**Examples:**

```json
// Emoji icon
{ "icon": "📝" }

// Explicit local path (rarely needed - auto-discovery handles this)
{ "icon": "./icon.svg" }

// URL (downloaded automatically by source_test)
{ "icon": "https://linear.app/static/favicon.svg" }

// No icon field - auto-discovers icon.svg/icon.png or resolves favicon
{}
```

**Best practice:** Set `icon` to a URL when creating a source. Run `source_test` to download and cache it locally. The app then uses the local file for fast, offline-capable display.

## Provider Domain Cache

For favicon resolution, a cache maps provider names to their canonical domains at:
`~/.craft-agent/provider-domains.json`

**Format:**
```json
{
  "version": 1,
  "domains": {
    "linear": "linear.app",
    "notion": "notion.so",
    "brave": "brave.com"
  },
  "updatedAt": 1704067200000
}
```

**When to update:** If a source's favicon appears incorrect (generic globe, wrong icon), add the provider→domain mapping to this file. The app loads this cache on startup.

**Example:** If "acme-mcp" source shows wrong icon, add:
```json
"acme": "acme.com"
```

## Common Providers

### Gmail
Provider: `gmail`, Type: `api`
Uses OAuth via `source_gmail_oauth_trigger`.

### Linear
Provider: `linear`, Type: `mcp`
URL: `https://mcp.linear.app`, OAuth auth.

### GitHub
Provider: `github`, Type: `mcp`
URL: `https://api.githubcopilot.com/mcp/`, **bearer auth** (PAT required - OAuth will fail).

### Exa (Search)
Provider: `exa`, Type: `api`
Base URL: `https://api.exa.ai`, header auth with `x-api-key`.

### Brave Search
Provider: `brave`, Type: `mcp`
Transport: `stdio`, Command: `npx -y @modelcontextprotocol/server-brave-search`, requires `BRAVE_API_KEY` env.

### Memory
Provider: `memory`, Type: `mcp`
Transport: `stdio`, Command: `npx -y @modelcontextprotocol/server-memory`, no auth.

## Workflow

### Creating a Source

**Always follow the conversational setup process** (see above). The key steps:

1. **Ask before creating**: Understand user intent, scope, and common tasks
2. **Research before configuring**: Use WebSearch to find docs, best practices, limitations
3. **Tailor guide.md to context**: Include specific projects/teams the user mentioned
4. **Test before declaring done**: Validate config, trigger auth, verify connection

Technical steps:

1. Create the source folder:
   ```bash
   mkdir -p ~/.craft-agent/workspaces/{ws}/sources/my-source
   ```

2. Write `config.json` with appropriate settings (see schemas above)

3. Write `guide.md` tailored to user's context and use case

4. **Create `permissions.json` for Explore mode** - List the source's tools, identify read-only operations (list, get, search), and add simple patterns. Patterns are auto-scoped to this source.

5. Run `source_test` to validate configuration and test connection

6. If auth is required, trigger the appropriate flow:
   - `source_oauth_trigger` for MCP OAuth
   - `source_gmail_oauth_trigger` for Gmail
   - `source_credential_prompt` for API keys/tokens

7. Confirm with user that the source is working as expected

### Testing a Source

Use `source_test` with the source slug:
- Validates config.json schema
- Tests connectivity
- Downloads icon if needed
- Updates connectionStatus

### Troubleshooting

**"needs_auth" status:**
- Source requires authentication
- Use appropriate auth trigger tool

**"failed" status:**
- Check `connectionError` in config.json
- Verify URL is correct
- Check network connectivity

**Icon not showing:**
- Ensure iconUrl is valid
- Run `source_test` to re-download
- Check file exists in source folder
