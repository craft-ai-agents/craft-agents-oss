# Plan: Subagent Tool Priority

## Problem Statement

When a subagent is active (e.g., Dropbox agent), its tools should take priority over base Craft MCP tools when there are semantic conflicts. For example:
- User asks "list my folders" while Dropbox agent is active
- Both Craft MCP and Dropbox MCP have folder-listing tools
- Currently: Claude chooses arbitrarily based on tool names
- Desired: Dropbox tools should be preferred unless user explicitly mentions "Craft" or similar

## Current Architecture

### MCP Server Merging (craft-agent.ts:509-521)
```typescript
const mcpServers: Options['mcpServers'] = {
  craft: { type: 'http', url: mcpUrl, headers: {...} },
  preferences: getPreferencesServer(),
  documentation: getDocumentationServer(),
  ...agentMcpServers,    // Subagent HTTP/SSE servers
  ...agentApiServers,    // Subagent REST API servers (in-process)
};
```

### Existing Tool Fetching Infrastructure
The codebase already has infrastructure to fetch tool lists from MCP servers:

1. **`McpServerConfig.tools?: string[]`** (types.ts:71) - Field exists but not always populated
2. **`SubAgentManager.fetchMcpServerTools()`** (manager.ts:562-617) - Creates temporary MCP client to list tools
3. **`useAgent.fetchAgentTools()`** (useAgent.ts:1466-1471) - Exposed to UI, used for `/agent info`

Currently, tools are fetched on-demand for display but **not stored** on `SubAgentDefinition` during activation.

### System Prompt (system.ts:65-99)
When a subagent is active, instructions are appended with:
- Agent identity and instructions
- Note to "still use your Craft MCP tools, but through the lens of this agent's purpose"

## Analysis

The issue is **semantic**, not technical name collision. Different MCP servers have different tool names, but they may have overlapping functionality:
- Craft: `folders_list` - lists Craft folders
- Dropbox: `files_list_folder` - lists Dropbox folders

Claude sees both tools and must decide which to use. Without explicit guidance, it may choose the wrong one.

## Proposed Solution: Return Tools from Validation + System Prompt

The `validateMcpConnection()` function already fetches tools for schema validation (lines 204-223 in validation.ts). Instead of fetching again during activation, we should **return the tool list from validation** and store it.

### Implementation Steps

#### Step 1: Return Tools from Validation

**File: `src/mcp/validation.ts`**

Add `tools?: string[]` to `McpValidationResult` and return tool names:

```typescript
export interface McpValidationResult {
  success: boolean;
  error?: string;
  errorType?: 'failed' | 'needs-auth' | 'pending' | 'invalid-schema' | 'unknown';
  serverInfo?: { name: string; version: string };
  invalidProperties?: InvalidProperty[];
  tools?: string[];  // NEW: Tool names from the server
}

// In validateMcpConnection(), after listTools():
const tools = await mcpClient.listTools();
const toolNames = tools.map(t => t.name);  // Extract names

// Return in success case:
return {
  success: true,
  serverInfo: status.serverInfo,
  tools: toolNames,  // NEW
};
```

#### Step 2: Store Tools During Agent Activation

**File: `src/tui/hooks/useAgent.ts`** (or wherever validation is called during activation)

When validation succeeds, store the returned tools on the `McpServerConfig`:

```typescript
const result = await validateMcpConnection(config);
if (result.success && result.tools) {
  serverConfig.tools = result.tools;
}
```

This avoids a second connection since validation already did the work.

#### Step 3: Update System Prompt with Tool Priority Guidance

**File: `src/prompts/system.ts`**

Modify `formatAgentContext()` to include explicit tool lists and priority instructions:

```typescript
function formatAgentContext(agent: SubAgentDefinition, temporaryClarifications?: string): string {
  // ... existing code ...

  // Generate tool priority section if agent has MCP servers with tools
  const toolPrioritySection = generateToolPrioritySection(agent);

  return `
---
## ACTIVE AGENT MODE: ${agent.name}
...
### Agent Instructions
${agent.instructions}

${toolPrioritySection}
...
`;
}

function generateToolPrioritySection(agent: SubAgentDefinition): string {
  const serverTools: string[] = [];

  // Collect MCP server tools
  if (agent.mcpServers) {
    for (const server of agent.mcpServers) {
      if (server.tools && server.tools.length > 0) {
        serverTools.push(`**${server.name}**: ${server.tools.join(', ')}`);
      }
    }
  }

  // Collect API tools
  if (agent.apis) {
    for (const api of agent.apis) {
      const tools = api.endpoints.map(e => `${api.name}_${e.name}`);
      serverTools.push(`**${api.name}** (API): ${tools.join(', ')}`);
    }
  }

  if (serverTools.length === 0) {
    return '';
  }

  return `
### Tool Priority

This agent provides the following tools:
${serverTools.join('\n')}

**IMPORTANT**: When the user asks for operations that match this agent's purpose (based on its name and instructions), prefer using the agent's tools over Craft tools.

Only use Craft MCP tools when:
1. The user explicitly mentions "Craft", "Craft document", "Craft folder", or similar
2. The operation is Craft-specific (blocks, daily notes, collections, document editing)
3. The agent doesn't have a tool for the requested operation

For example:
- "${agent.name}" agent active + "list my folders" → Use ${agent.name}'s folder tools
- "${agent.name}" agent active + "list my Craft folders" → Use Craft's folders_list
`;
}
```

#### Step 3: Handle API Tools (Already Covered)

API tools are already enumerated in `SubAgentDefinition.apis[].endpoints[]`, so they can be included in the prompt without additional fetching.

### Files to Modify

| File | Changes |
|------|---------|
| `src/mcp/validation.ts` | Add `tools?: string[]` to `McpValidationResult`, return tool names |
| `src/tui/hooks/useAgent.ts` | Store `result.tools` on `McpServerConfig` after validation |
| `src/prompts/system.ts` | Add `generateToolPrioritySection()`, update `formatAgentContext()` |

### Why This Approach

1. **Zero extra network calls** - Validation already fetches tools for schema checking
2. **No SDK changes** - Works within current architecture
3. **Explicit tool listing** - Claude sees exactly which tools belong to the agent
4. **Natural language guidance** - Priority rules are clear and overridable
5. **Minimal changes** - 3 files, validation change is trivial (just return existing data)

## Testing

1. Activate Dropbox agent
2. Ask "list my folders" → Should use Dropbox's `files_list_folder`
3. Ask "list my Craft folders" → Should use Craft's `folders_list`
4. Ask "show my documents" → Should use Craft (Dropbox doesn't have docs)
5. Deactivate agent, ask "list my folders" → Should use Craft

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Claude ignores priority instructions | Make instructions explicit with examples, test different phrasings |
| Over-aggressive priority (never uses Craft) | Clear exceptions for Craft-specific operations |
| Tool list stale if server changes | Refresh on `/agent reload` (re-validates and re-fetches tools) |

## Future Enhancements (Optional)

1. **User override syntax**: `@craft list folders` to force Craft tools
2. **Tool categories**: Group tools by function (files, search, etc.) for smarter matching
3. **Cache tool lists**: Store in agent definition cache to persist across sessions
