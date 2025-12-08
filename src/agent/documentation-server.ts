import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

// Lazy-initialized singleton
let documentationServerInstance: ReturnType<typeof createSdkMcpServer> | null = null;

/**
 * Get the documentation MCP server with the get_craft_documentation tool.
 * This provides on-demand documentation for Craft TUI Agent features,
 * avoiding the need to embed lengthy instructions in the system prompt.
 */
export function getDocumentationServer() {
  if (!documentationServerInstance) {
    documentationServerInstance = createSdkMcpServer({
      name: 'documentation',
      version: '1.0.0',
      tools: [
        tool(
          'get_craft_documentation',
          `Get Craft TUI Agent documentation. Use this when users ask about:
- How to connect/add MCP servers
- How to add REST APIs
- How to create agents
- Configuration, authentication, or setup
- Differences from Claude Code

IMPORTANT: Always call this tool BEFORE answering questions about MCP servers, APIs, or setup. Do NOT use Claude Code instructions for these topics.`,
          {
            topic: z.enum([
              'mcp_servers',
              'rest_apis',
              'creating_agents',
              'authentication',
              'configuration',
              'all'
            ]).describe('Documentation topic to retrieve'),
          },
          async ({ topic }) => {
            const docs = getDocumentation(topic);
            return { content: [{ type: 'text' as const, text: docs }] };
          }
        ),
      ],
    });
  }
  return documentationServerInstance;
}

function getDocumentation(topic: string): string {
  const sections: Record<string, string> = {
    mcp_servers: `## Adding MCP Servers in Craft TUI Agent

MCP servers are configured via Craft documents, NOT config files.

### Steps:
1. Create/open an agent document in the "Agents" folder
2. Add a code block with server configuration:

**Plain URL:**
\`\`\`
https://example.com/mcp
\`\`\`

**YAML format:**
\`\`\`yaml
- name: myserver
  url: https://example.com/mcp
  requiresAuth: true
\`\`\`

**JSON format:**
\`\`\`json
{"name": "myserver", "url": "https://...", "requiresAuth": true}
\`\`\`

### Important:
- Only HTTP/HTTPS URLs supported (NOT npx/stdio commands)
- Set requiresAuth: true for OAuth-protected servers
- First activation prompts for OAuth login
- Credentials stored in OS keychain (not config files)
- DO NOT mention ~/.claude/settings.json or Claude Code MCP setup`,

    rest_apis: `## Adding REST APIs in Craft TUI Agent

REST APIs are auto-detected from Craft documents and converted to tools.

### Steps:
1. Create/open an agent document in the "Agents" folder
2. Include API documentation in any of these formats:

**Curl examples (recommended):**
\`\`\`bash
curl -X POST https://api.exa.ai/search \\
  -H "x-api-key: YOUR_KEY" \\
  -d '{"query": "...", "numResults": 10}'
\`\`\`

**Fetch/axios calls**
**Links to API documentation**
**Inline API descriptions**

### Authentication types detected:
- Header: \`-H "x-api-key: KEY"\`
- Bearer: \`-H "Authorization: Bearer KEY"\`
- Query param: \`?api_key=KEY\`

### Important:
- First activation prompts for API keys
- Keys stored in OS keychain (not environment variables)
- Include endpoint descriptions for better tool usage
- Mention pagination/limit params to avoid large responses`,

    creating_agents: `## Creating Agents in Craft TUI Agent

Agents are defined in Craft documents (not code files).

### Steps:
1. Create a document in the "Agents" folder
2. Document title = agent name (e.g., "Research Writer")
3. Create "Instructions" subpage with agent's system prompt
4. Optionally add MCP servers and REST APIs (see those topics)

### Activating agents:
- \`@agentname\` in chat
- \`/agent activate agentname\`
- \`/agent list\` to see available agents

### Returning to default:
- \`@main\`
- \`/agent clear\``,

    authentication: `## Authentication in Craft TUI Agent

All credentials stored in OS keychain (NOT config files or env vars).

### Credential storage:
- **macOS:** Keychain Access
- **Linux:** Secret Service (GNOME Keyring/KWallet)
- **Windows:** Credential Manager

### MCP server auth:
- OAuth 2.0 with PKCE (dynamic client registration)
- Static bearer token (if server supports it)
- Prompted on first activation

### REST API auth:
- API keys prompted on first use
- Supports header, bearer, or query param auth
- Keys saved per-agent in keychain

### Re-authenticate:
- \`/auth\` command to re-enter credentials
- Automatic token refresh when possible`,

    configuration: `## Craft TUI Agent Configuration

**IMPORTANT:** Craft TUI Agent uses different paths than Claude Code.

### Config directory:
- Craft TUI Agent: \`~/.craft-agent/\`
- NOT \`~/.claude/\`

### Key differences from Claude Code:
| Feature | Craft TUI Agent | Claude Code |
|---------|-----------------|-------------|
| Config dir | ~/.craft-agent/ | ~/.claude/ |
| MCP servers | Craft documents | settings.json |
| API keys | OS keychain | env variables |
| Agents | Craft documents | code files |
| Sessions | Workspaces | sessions |

### Available commands:
\`/help\`, \`/clear\`, \`/tools\`, \`/config\`, \`/prefs\`,
\`/setup\`, \`/model\`, \`/workspace\`, \`/agent\`, \`/auth\`, \`/exit\`

### DO NOT reference:
- ~/.claude/ directory
- settings.json or mcp.json
- ANTHROPIC_API_KEY environment variable
- Claude Code's MCP configuration methods`,
  };

  if (topic === 'all') {
    return Object.values(sections).join('\n\n---\n\n');
  }
  return sections[topic] || 'Topic not found. Use: mcp_servers, rest_apis, creating_agents, authentication, configuration, or all';
}
