# JSON Render Actions API Reference

This document provides the API reference for actions available in the JSON Rendering System.

## Overview

Actions are interactive behaviors that can be triggered by Button components in AI-generated UIs. Each action has a name and optional parameters.

## Action Format

Actions can be specified in two ways:

### String Format (Simple)

```typescript
{
  "type": "Button",
  "props": {
    "label": "Copy Text",
    "action": "copy"  // Simple action name
  }
}
```

### Object Format (With Parameters)

```typescript
{
  "type": "Button",
  "props": {
    "label": "Copy Text",
    "action": {
      "name": "copy",
      "params": {
        "text": "Hello, World!"
      }
    }
  }
}
```

## Available Actions

### copy

Copy text to the system clipboard.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | Yes | Text to copy to clipboard |

**Returns:** `void`

**Example:**

```typescript
{
  "name": "copy",
  "params": {
    "text": "This text will be copied to clipboard"
  }
}
```

**Toast Notification:**
- Success: "Copied to clipboard" with text preview
- Info: "Copy action triggered" if no text provided

---

### open_url

Open a URL in the default browser.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | URL to open in browser |

**Returns:** `void`

**Example:**

```typescript
{
  "name": "open_url",
  "params": {
    "url": "https://vesper.atherslabs.com"
  }
}
```

**Toast Notification:**
- Success: "Opening URL" with URL displayed
- Info: "Open URL action triggered" if no URL provided

**Security:** Opens in new tab with `noopener,noreferrer` flags.

---

### api_call

Make an HTTP request to an external API.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | API endpoint URL |
| `method` | string | No | HTTP method (default: "GET") |
| `body` | object | No | Request body (JSON) |
| `headers` | object | No | Additional headers |

**Returns:**

```typescript
{
  success: boolean
  status?: number
  data?: any        // Response data
  error?: any       // Error if failed
}
```

**Example:**

```typescript
{
  "name": "api_call",
  "params": {
    "url": "https://api.example.com/users",
    "method": "POST",
    "body": {
      "name": "John Doe",
      "email": "john@example.com"
    },
    "headers": {
      "X-API-Key": "secret-key"
    }
  }
}
```

**Toast Notifications:**
- Loading: "Making API request..." with method and URL
- Success: "API call successful" with status code
- Error: "API call failed" with status/error message

**Content Type:** Automatically sets `Content-Type: application/json` for requests with body.

**Response Handling:**
- JSON responses are automatically parsed
- Text responses are returned as strings
- Response is logged to browser console

---

### mcp_fetch

Fetch data from a connected MCP (Model Context Protocol) source.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source` | string | Yes | Source slug of the MCP server |
| `tool` | string | Yes | Name of the MCP tool to call |
| `args` | object | No | Arguments to pass to the tool |

**Returns:**

```typescript
{
  success?: boolean
  data?: any        // Tool result if successful
  error?: string    // Error message if failed
}
```

**Example:**

```typescript
{
  "name": "mcp_fetch",
  "params": {
    "source": "github",
    "tool": "list_issues",
    "args": {
      "owner": "atherslabs",
      "repo": "vesper",
      "state": "open",
      "per_page": 10
    }
  }
}
```

**Toast Notifications:**
- Loading: "Fetching from MCP..." with source.tool
- Success: "MCP data fetched" with source.tool
- Error: "MCP fetch failed" with error message

**Transport Support:**
- HTTP/SSE transport with OAuth/Bearer authentication
- Stdio transport (local MCP servers)

**Error Cases:**
- Missing source or tool parameter
- Source not found in workspace
- Source requires authentication
- Source connection failed
- Network/timeout errors
- Tool not found on MCP server

**Authentication:**
- OAuth tokens retrieved from CredentialManager
- Bearer tokens retrieved from CredentialManager
- Tokens handled securely in main process

**See Also:** [JSON Render MCP Data Binding](../developer/json-render-mcp.md)

---

### log

Log data to the browser console for debugging.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| (any) | any | No | Data to log |

**Returns:** `void`

**Example:**

```typescript
{
  "name": "log",
  "params": {
    "message": "Debug info",
    "value": 42,
    "data": { "foo": "bar" }
  }
}
```

**Toast Notification:**
- Info: "Action executed" with parameters preview

**Console Output:** `[JSONRender] Log action: { ... }`

---

### submit

Submit form data (for future use with form handling).

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| (any) | any | No | Form data to submit |

**Returns:** `void`

**Example:**

```typescript
{
  "name": "submit",
  "params": {
    "username": "john_doe",
    "email": "john@example.com"
  }
}
```

**Toast Notification:**
- Success: "Form submitted" with "Data logged to console"

**Console Output:** `[JSONRender] Submit action: { ... }`

**Note:** Currently logs to console. Future versions may support custom submit handlers.

---

### cancel

Cancel or dismiss an action.

**Parameters:** None

**Returns:** `void`

**Example:**

```typescript
{
  "name": "cancel"
}
```

**Toast Notification:**
- Info: "Action cancelled"

---

### refresh

Trigger a data refresh (for future use with data providers).

**Parameters:** None

**Returns:** `void`

**Example:**

```typescript
{
  "name": "refresh"
}
```

**Toast Notification:**
- Info: "Refreshing data..." with description

**Note:** Currently shows toast. Future versions may support custom refresh handlers.

---

## Custom Action Handlers

You can provide custom action handlers when using JSONRenderView:

```typescript
<JSONRenderView
  tree={uiTree}
  actionHandlers={{
    custom_action: async (params) => {
      // Your custom logic
      console.log('Custom action:', params)
      return { success: true }
    }
  }}
  onAction={(actionName, params) => {
    // Callback for all actions
    console.log('Action executed:', actionName, params)
  }}
/>
```

**Custom Handler Signature:**

```typescript
type ActionHandler = (params?: Record<string, unknown>) => Promise<any> | any
```

**Merging:** Custom handlers take precedence over default handlers.

## Action Handler Props

The `JSONRenderView` component accepts the following action-related props:

```typescript
interface JSONRenderViewProps {
  tree: UITree
  initialData?: Record<string, unknown>
  actionHandlers?: Record<string, ActionHandler>
  onAction?: (actionName: string, params?: Record<string, unknown>) => void
}
```

### actionHandlers

Custom action handlers to merge with or override default handlers.

**Type:** `Record<string, ActionHandler>`

**Example:**

```typescript
actionHandlers={{
  fetch_data: async (params) => {
    const response = await fetch('/api/data')
    return await response.json()
  }
}}
```

### onAction

Callback invoked when any action is executed (before the handler runs).

**Type:** `(actionName: string, params?: Record<string, unknown>) => void`

**Example:**

```typescript
onAction={(name, params) => {
  analytics.track('ui_action', { name, params })
}}
```

## Error Handling

All action handlers should handle errors gracefully:

```typescript
try {
  const result = await someAsyncOperation()
  toast.success('Operation successful')
  return { success: true, data: result }
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown error'
  toast.error('Operation failed', { description: message })
  return { error: message }
}
```

### Best Practices

1. **Return structured data**: Use `{ success, data?, error? }` format
2. **Show toast notifications**: Inform users of action status
3. **Log to console**: Use console.log for debugging
4. **Handle edge cases**: Validate parameters before use
5. **Use loading states**: Button shows "Loading..." during async actions

## Button Component Integration

Actions are typically used with Button components:

```typescript
{
  "type": "Button",
  "props": {
    "label": "Click Me",
    "variant": "default",
    "action": {
      "name": "api_call",
      "params": {
        "url": "https://api.example.com/endpoint"
      }
    },
    "disabled": false
  }
}
```

**Button Props:**

| Prop | Type | Description |
|------|------|-------------|
| `label` | string | Button text |
| `variant` | string | "default" \| "secondary" \| "outline" \| "destructive" \| "ghost" |
| `size` | string | "default" \| "sm" \| "lg" |
| `action` | string \| Action | Action to trigger on click |
| `disabled` | boolean | Disable button and prevent action |

**Loading State:** Button automatically shows "Loading..." when action is executing.

## TypeScript Types

```typescript
// Action definition
interface Action {
  name: string
  params?: Record<string, unknown>
}

// Action handler
type ActionHandler = (params?: Record<string, unknown>) => Promise<any> | any

// Action result (recommended)
interface ActionResult {
  success?: boolean
  data?: any
  error?: string
}

// mcp_fetch specific
interface McpFetchParams {
  source: string
  tool: string
  args?: Record<string, unknown>
}

interface McpFetchResult {
  success?: boolean
  data?: any
  error?: string
}

// api_call specific
interface ApiCallParams {
  url: string
  method?: string
  body?: Record<string, unknown>
  headers?: Record<string, string>
}

interface ApiCallResult {
  success: boolean
  status?: number
  data?: any
  error?: any
}
```

## Security Considerations

### CORS

API calls from the renderer process are subject to CORS restrictions. For cross-origin requests, the API server must include appropriate CORS headers.

### Authentication

- **MCP sources**: Authentication handled securely in main process
- **API calls**: Include credentials in `headers` parameter
- **OAuth tokens**: Never expose tokens in renderer; use MCP sources instead

### Input Validation

- Validate URLs before opening (open_url)
- Sanitize user input before API calls
- Use MCP sources for sensitive operations

### Content Security Policy

The application's CSP allows:
- Clipboard access (copy action)
- External navigation (open_url action)
- Fetch API (api_call action)

## Testing

### Unit Tests

Test action handlers in isolation:

```typescript
import { defaultActionHandlers } from './JSONRenderView'

describe('copy action', () => {
  it('should copy text to clipboard', async () => {
    await defaultActionHandlers.copy({ text: 'test' })
    const clipboardText = await navigator.clipboard.readText()
    expect(clipboardText).toBe('test')
  })
})
```

### Integration Tests

Test actions in the full JSONRenderView component:

```typescript
import { render, fireEvent } from '@testing-library/react'
import { JSONRenderView } from './JSONRenderView'

test('button triggers action', async () => {
  const onAction = jest.fn()
  const { getByText } = render(
    <JSONRenderView
      tree={{
        root: 'btn',
        elements: {
          btn: {
            type: 'Button',
            props: {
              label: 'Click',
              action: 'log'
            }
          }
        }
      }}
      onAction={onAction}
    />
  )

  fireEvent.click(getByText('Click'))
  expect(onAction).toHaveBeenCalledWith('log', undefined)
})
```

## Related Documentation

- [JSON Rendering System](../developer/json-render.md) - Overview of the JSON rendering system
- [JSON Render MCP Data Binding](../developer/json-render-mcp.md) - MCP integration details
- [Component Catalog](./json-render-components.md) - Available UI components
- [Session-Scoped Tools](./session-scoped-tools.md) - render_ui tool reference

## Changelog

### 2026-01-25 - MCP Data Binding

- Add `mcp_fetch` action for fetching data from MCP sources
- Support both HTTP and stdio MCP transports
- Automatic authentication handling (OAuth, Bearer tokens)

### 2025-01-24 - Initial Actions

- Add `copy`, `open_url`, `log`, `submit`, `cancel`, `refresh` actions
- Add `api_call` action for HTTP requests
- Implement default action handlers in JSONRenderView
