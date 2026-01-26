# JSON Render MCP Data Binding

The JSON Rendering System supports dynamic data binding with MCP (Model Context Protocol) sources through the `mcp_fetch` action. This allows AI-generated UI components to fetch live data from connected MCP servers.

## Overview

The `mcp_fetch` action enables Button components to trigger MCP tool calls and fetch data from connected sources. This creates dynamic, interactive UIs that can display real-time data from GitHub, databases, APIs, and other MCP-compatible services.

## Architecture

### Data Flow

```
Button Click → mcp_fetch Action → IPC Handler → MCP Client → MCP Server → Response
```

1. **User clicks Button**: Button component triggers `mcp_fetch` action
2. **Action Handler**: `JSONRenderView.tsx` processes the action
3. **IPC Call**: Renderer calls `SOURCES_CALL_MCP_TOOL` via IPC
4. **Main Process**: IPC handler creates MCP client with authentication
5. **MCP Tool Call**: Client calls the specified tool on the MCP server
6. **Response**: Result is returned to the UI

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `JSONRenderView.tsx` | `apps/electron/src/renderer/components/json-render/` | Action handler for `mcp_fetch` |
| `catalog.ts` | `apps/electron/src/renderer/components/json-render/` | Action definition |
| `ipc.ts` | `apps/electron/src/main/` | IPC handler `SOURCES_CALL_MCP_TOOL` |
| `preload/index.ts` | `apps/electron/src/preload/` | Exposes `callMcpTool` API |

## Usage

### Basic Example

```typescript
{
  "root": "button1",
  "elements": {
    "button1": {
      "type": "Button",
      "props": {
        "label": "Fetch GitHub Issues",
        "action": {
          "name": "mcp_fetch",
          "params": {
            "source": "github",
            "tool": "list_issues",
            "args": {
              "owner": "atherslabs",
              "repo": "vesper"
            }
          }
        }
      }
    }
  }
}
```

### Action Parameters

The `mcp_fetch` action accepts the following parameters:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source` | string | Yes | Source slug of the connected MCP server |
| `tool` | string | Yes | Name of the MCP tool to call |
| `args` | object | No | Arguments to pass to the tool |

### Return Value

The action handler returns:

```typescript
{
  success: boolean
  data?: any        // Tool result if successful
  error?: string    // Error message if failed
}
```

## Authentication

The IPC handler automatically handles authentication for MCP sources:

### OAuth Sources

```typescript
// OAuth tokens are retrieved from CredentialManager
const credential = await credentialManager.get({
  type: 'source_oauth',
  workspaceId: workspace.id,
  sourceId: sourceSlug
})
```

### Bearer Token Sources

```typescript
// Bearer tokens are retrieved from CredentialManager
const credential = await credentialManager.get({
  type: 'source_bearer',
  workspaceId: workspace.id,
  sourceId: sourceSlug
})
```

### Stdio Sources

No authentication is required for stdio-based MCP servers.

## Transport Support

The IPC handler supports both MCP transport types:

### HTTP Transport

```typescript
client = new CraftMcpClient({
  transport: 'http',
  url: source.config.mcp.url,
  headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
})
```

### Stdio Transport

```typescript
client = new CraftMcpClient({
  transport: 'stdio',
  command: source.config.mcp.command,
  args: source.config.mcp.args,
  env: source.config.mcp.env,
})
```

## Error Handling

The action handler provides user-friendly error messages via toast notifications:

### Connection Errors

```typescript
if (source.config.connectionStatus === 'needs_auth') {
  return { success: false, error: 'Source requires authentication' }
}

if (source.config.connectionStatus === 'failed') {
  return { success: false, error: source.config.connectionError || 'Connection failed' }
}
```

### Missing Parameters

```typescript
if (!source || !tool) {
  toast.error('MCP fetch failed', { description: 'Missing source or tool name' })
  return { error: 'Missing source or tool' }
}
```

### Network Errors

```typescript
try {
  const result = await client.callTool(toolName, toolArgs)
  return { success: true, data: result }
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown error'
  toast.error('MCP fetch failed', { id: toastId, description: message })
  return { error: message }
}
```

## Complete Examples

### Example 1: GitHub Issues Dashboard

```typescript
{
  "root": "card1",
  "elements": {
    "card1": {
      "type": "Card",
      "props": {
        "title": "GitHub Issues",
        "description": "Recent issues from vesper repository"
      },
      "children": ["stack1"]
    },
    "stack1": {
      "type": "Stack",
      "props": { "gap": "md" },
      "children": ["button1", "button2"]
    },
    "button1": {
      "type": "Button",
      "props": {
        "label": "Fetch Open Issues",
        "variant": "default",
        "action": {
          "name": "mcp_fetch",
          "params": {
            "source": "github",
            "tool": "list_issues",
            "args": {
              "owner": "atherslabs",
              "repo": "vesper",
              "state": "open"
            }
          }
        }
      }
    },
    "button2": {
      "type": "Button",
      "props": {
        "label": "Fetch Closed Issues",
        "variant": "secondary",
        "action": {
          "name": "mcp_fetch",
          "params": {
            "source": "github",
            "tool": "list_issues",
            "args": {
              "owner": "atherslabs",
              "repo": "vesper",
              "state": "closed",
              "per_page": 10
            }
          }
        }
      }
    }
  }
}
```

### Example 2: Database Query

```typescript
{
  "root": "card1",
  "elements": {
    "card1": {
      "type": "Card",
      "props": {
        "title": "User Analytics",
        "description": "Query user data from database"
      },
      "children": ["button1"]
    },
    "button1": {
      "type": "Button",
      "props": {
        "label": "Fetch Active Users",
        "action": {
          "name": "mcp_fetch",
          "params": {
            "source": "database",
            "tool": "query",
            "args": {
              "sql": "SELECT * FROM users WHERE active = true LIMIT 100"
            }
          }
        }
      }
    }
  }
}
```

### Example 3: Weather API

```typescript
{
  "root": "stack1",
  "elements": {
    "stack1": {
      "type": "Stack",
      "props": { "gap": "md" },
      "children": ["metric1", "button1"]
    },
    "metric1": {
      "type": "Metric",
      "props": {
        "label": "Current Temperature",
        "value": "--",
        "suffix": "°C"
      }
    },
    "button1": {
      "type": "Button",
      "props": {
        "label": "Fetch Weather",
        "action": {
          "name": "mcp_fetch",
          "params": {
            "source": "weather",
            "tool": "get_current",
            "args": {
              "city": "San Francisco"
            }
          }
        }
      }
    }
  }
}
```

## Implementation Details

### Action Handler (JSONRenderView.tsx)

```typescript
// MCP tool call action - fetches data from an MCP source
mcp_fetch: async (params) => {
  const source = params?.source as string
  const tool = params?.tool as string
  const args = (params?.args as Record<string, unknown>) || {}

  if (!source || !tool) {
    toast.error('MCP fetch failed', { description: 'Missing source or tool name' })
    return { error: 'Missing source or tool' }
  }

  const toastId = toast.loading('Fetching from MCP...', { description: `${source}.${tool}` })

  try {
    // Get current workspace ID from window context
    const workspaceId = await window.electronAPI?.getWindowWorkspace?.()
    if (!workspaceId) {
      toast.error('MCP fetch failed', { id: toastId, description: 'No workspace context' })
      return { error: 'No workspace context' }
    }

    // Call the MCP tool via IPC
    const result = await window.electronAPI?.callMcpTool?.(workspaceId, source, tool, args)

    if (!result?.success) {
      toast.error('MCP fetch failed', { id: toastId, description: result?.error || 'Unknown error' })
      return { error: result?.error }
    }

    toast.success('MCP data fetched', { id: toastId, description: `${source}.${tool}` })
    console.log('[JSONRender] MCP result:', result.data)
    return result.data
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    toast.error('MCP fetch failed', { id: toastId, description: message })
    return { error: message }
  }
}
```

### IPC Handler (ipc.ts)

```typescript
ipcMain.handle(IPC_CHANNELS.SOURCES_CALL_MCP_TOOL, async (
  _event,
  workspaceId: string,
  sourceSlug: string,
  toolName: string,
  toolArgs: Record<string, unknown>
) => {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) return { success: false, error: 'Workspace not found' }

  try {
    // Load source config
    const sources = await loadWorkspaceSources(workspace.rootPath)
    const source = sources.find(s => s.config.slug === sourceSlug)
    if (!source) return { success: false, error: 'Source not found' }
    if (source.config.type !== 'mcp') return { success: false, error: 'Source is not an MCP server' }

    // Check connection status
    if (source.config.connectionStatus === 'needs_auth') {
      return { success: false, error: 'Source requires authentication' }
    }
    if (source.config.connectionStatus === 'failed') {
      return { success: false, error: source.config.connectionError || 'Connection failed' }
    }

    // Create MCP client (HTTP or stdio)
    const { CraftMcpClient } = await import('@vesper/shared/mcp')
    let client: InstanceType<typeof CraftMcpClient>

    if (source.config.mcp.transport === 'stdio') {
      client = new CraftMcpClient({
        transport: 'stdio',
        command: source.config.mcp.command,
        args: source.config.mcp.args,
        env: source.config.mcp.env,
      })
    } else {
      // HTTP transport with authentication
      let accessToken: string | undefined
      if (source.config.mcp.authType === 'oauth' || source.config.mcp.authType === 'bearer') {
        const credentialManager = getCredentialManager()
        const credentialId = source.config.mcp.authType === 'oauth'
          ? { type: 'source_oauth' as const, workspaceId: source.workspaceId, sourceId: sourceSlug }
          : { type: 'source_bearer' as const, workspaceId: source.workspaceId, sourceId: sourceSlug }
        const credential = await credentialManager.get(credentialId)
        accessToken = credential?.value
      }

      client = new CraftMcpClient({
        transport: 'http',
        url: source.config.mcp.url,
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      })
    }

    // Call the tool
    const result = await client.callTool(toolName, toolArgs)
    await client.close()

    return { success: true, data: result }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to call tool'
    return { success: false, error: errorMessage }
  }
})
```

## Testing

### Manual Testing

1. **Connect an MCP Source**: Add a GitHub or database MCP source in Settings
2. **Create UI with mcp_fetch**: Use the render_ui tool to create a Button with mcp_fetch action
3. **Click Button**: Verify the tool is called and data is returned
4. **Check Toast Notifications**: Verify loading/success/error toasts appear
5. **Console Logging**: Check browser console for MCP result logs

### Error Cases to Test

- Missing source parameter
- Missing tool parameter
- Invalid source slug (source not found)
- Source requires authentication
- Source connection failed
- Network timeout
- MCP tool not found
- Invalid tool arguments

## Security Considerations

### Authentication

- OAuth tokens and Bearer tokens are stored encrypted in CredentialManager
- Tokens are never exposed to the renderer process
- Authentication is handled entirely in the main process

### Permission Checks

- MCP sources have connection status validation
- Sources requiring auth show `needs_auth` status
- Failed connections are tracked and reported

### Input Validation

- Source slug and tool name are validated before calling
- Tool arguments are passed as-is to the MCP client
- MCP client performs its own validation

## Best Practices

### 1. Handle Loading States

Always show loading indicators when calling MCP tools:

```typescript
{
  "type": "Button",
  "props": {
    "label": "Fetch Data",
    "action": { "name": "mcp_fetch", "params": {...} }
  }
}
// Button automatically shows "Loading..." when action is executing
```

### 2. Provide User Feedback

Use toast notifications for success/error states (handled automatically by action handler).

### 3. Validate Arguments

Ensure required arguments are provided for the MCP tool:

```typescript
{
  "name": "mcp_fetch",
  "params": {
    "source": "github",
    "tool": "list_issues",
    "args": {
      "owner": "required-field",
      "repo": "required-field",
      "state": "optional-field"
    }
  }
}
```

### 4. Handle Errors Gracefully

Check the response before using data:

```typescript
const result = await onAction('mcp_fetch', params)
if (result?.error) {
  // Handle error case
  return
}
// Use result.data
```

## Troubleshooting

### "Source requires authentication"

**Cause**: The MCP source needs OAuth or API credentials.

**Solution**: Go to Settings → Sources and authenticate the source.

### "Source not found"

**Cause**: The source slug doesn't match any connected sources.

**Solution**: Check the source slug in Settings → Sources and use the exact slug.

### "No workspace context"

**Cause**: The window doesn't have a workspace ID (rare).

**Solution**: Reload the window or check window manager state.

### "MCP tool not found"

**Cause**: The tool name doesn't exist on the MCP server.

**Solution**: Check the MCP server documentation for available tools.

## Related Documentation

- [JSON Rendering System](./json-render.md) - Overview of the JSON rendering system
- [MCP Integration](./mcp-integration.md) - MCP source configuration
- [Session-Scoped Tools](../api/session-scoped-tools.md) - render_ui tool reference
- [IPC Channels](../api/ipc-channels.md) - SOURCES_CALL_MCP_TOOL reference

## Changelog

### 2026-01-25 - Initial Implementation (Commit 494877b)

- Add SOURCES_CALL_MCP_TOOL IPC handler to call MCP tools from renderer
- Expose callMcpTool in preload API
- Add mcp_fetch action handler that fetches data from connected MCP sources
- Support both HTTP and stdio MCP transports with authentication
- Enable Button actions to trigger MCP tool calls with params
