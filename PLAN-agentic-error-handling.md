# Agentic Error Handling Implementation Plan

## Overview

This plan introduces a comprehensive error handling system that clearly communicates issues to users. The goal is **clarity over resolution** - users should understand exactly what went wrong and why, even if they need to fix it manually.

---

## Error Categories

The system will categorize all errors into these user-understandable categories:

| Category | Icon | Description | Examples |
|----------|------|-------------|----------|
| `connection` | 🔌 | Network/connectivity issues | ECONNREFUSED, timeout, DNS failures |
| `authentication` | 🔐 | Auth/credential problems | OAuth failures, expired tokens, invalid API keys |
| `permission` | 🚫 | Access denied | Bash command denied, insufficient permissions |
| `configuration` | ⚙️ | Setup/config issues | Missing MCP server, invalid URL, malformed config |
| `api` | 📡 | External API errors | Rate limits, quota exceeded, API errors |
| `session` | 💾 | Conversation/session issues | Session expired, history corruption |
| `tool` | 🔧 | Tool execution failures | Tool not found, invalid parameters |
| `internal` | ⚠️ | Unexpected internal errors | Code bugs, unexpected states |

---

## Architecture

### New Files to Create

```
src/
├── errors/
│   ├── index.ts              # Public exports
│   ├── types.ts              # Error types, interfaces, category definitions
│   ├── CraftError.ts         # Base error class with rich context
│   ├── detector.ts           # Error detection and classification logic
│   ├── messages.ts           # User-friendly message templates
│   └── recovery.ts           # Recovery suggestions per error type
└── tui/
    └── components/
        └── ErrorDisplay.tsx  # Enhanced error display component
```

### Files to Modify

```
src/
├── agent/craft-agent.ts      # Wrap errors with CraftError, emit rich error events
├── agents/
│   ├── manager.ts            # Surface agent loading errors
│   ├── extractor.ts          # Surface extraction errors
│   └── api-tools.ts          # Categorize API errors
├── auth/oauth.ts             # Wrap OAuth errors with context
├── mcp/client.ts             # Categorize MCP connection errors
├── tui/
│   ├── hooks/useAgent.ts     # Handle new error types, surface silent failures
│   └── components/
│       ├── Messages.tsx      # Use new ErrorDisplay component
│       └── WorkspaceAdd.tsx  # Use structured errors
└── config/storage.ts         # Surface config errors
```

---

## Implementation Details

### Phase 1: Error Foundation

#### 1.1 Create Error Types (`src/errors/types.ts`)

```typescript
export type ErrorCategory =
  | 'connection'
  | 'authentication'
  | 'permission'
  | 'configuration'
  | 'api'
  | 'session'
  | 'tool'
  | 'internal';

export interface ErrorContext {
  // What was happening when the error occurred
  operation: string;

  // Relevant identifiers for debugging
  workspaceId?: string;
  agentName?: string;
  toolName?: string;
  mcpServer?: string;
  apiName?: string;

  // Technical details (shown in verbose mode)
  requestId?: string;
  statusCode?: number;
  responseBody?: string;

  // Original error for stack traces
  cause?: Error;
}

export interface ErrorRecovery {
  // What the user can do
  suggestion: string;

  // Actionable steps
  steps?: string[];

  // Relevant command to run (e.g., "/workspace" to re-add)
  command?: string;

  // Documentation link if applicable
  docsUrl?: string;
}

export interface CraftErrorData {
  category: ErrorCategory;
  code: string;           // e.g., "MCP_CONNECTION_REFUSED"
  message: string;        // User-friendly message
  context: ErrorContext;
  recovery?: ErrorRecovery;
  timestamp: number;
}
```

#### 1.2 Create CraftError Class (`src/errors/CraftError.ts`)

```typescript
import { ErrorCategory, ErrorContext, ErrorRecovery, CraftErrorData } from './types';

export class CraftError extends Error {
  readonly category: ErrorCategory;
  readonly code: string;
  readonly context: ErrorContext;
  readonly recovery?: ErrorRecovery;
  readonly timestamp: number;

  constructor(
    category: ErrorCategory,
    code: string,
    message: string,
    context: ErrorContext,
    recovery?: ErrorRecovery
  ) {
    super(message);
    this.name = 'CraftError';
    this.category = category;
    this.code = code;
    this.context = context;
    this.recovery = recovery;
    this.timestamp = Date.now();

    // Preserve original stack if available
    if (context.cause?.stack) {
      this.stack = `${this.stack}\nCaused by: ${context.cause.stack}`;
    }
  }

  toData(): CraftErrorData {
    return {
      category: this.category,
      code: this.code,
      message: this.message,
      context: this.context,
      recovery: this.recovery,
      timestamp: this.timestamp,
    };
  }

  // Format for display
  toUserMessage(): string {
    const lines = [this.message];
    if (this.recovery?.suggestion) {
      lines.push('', `Suggestion: ${this.recovery.suggestion}`);
    }
    if (this.recovery?.steps?.length) {
      lines.push('', 'Steps to resolve:');
      this.recovery.steps.forEach((step, i) => {
        lines.push(`  ${i + 1}. ${step}`);
      });
    }
    if (this.recovery?.command) {
      lines.push('', `Try: ${this.recovery.command}`);
    }
    return lines.join('\n');
  }
}
```

#### 1.3 Create Error Detector (`src/errors/detector.ts`)

This module detects and classifies errors from various sources:

```typescript
import { CraftError } from './CraftError';
import { ErrorCategory, ErrorContext } from './types';
import { getRecoverySuggestion } from './recovery';
import { getUserMessage } from './messages';

// Network error patterns
const NETWORK_ERRORS = {
  ECONNREFUSED: 'connection',
  ECONNRESET: 'connection',
  ETIMEDOUT: 'connection',
  EHOSTUNREACH: 'connection',
  ENOTFOUND: 'connection',
  EAI_AGAIN: 'connection',
  CERT_HAS_EXPIRED: 'connection',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'connection',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'connection',
} as const;

// HTTP status code mappings
const HTTP_STATUS_CATEGORIES: Record<number, ErrorCategory> = {
  400: 'configuration',
  401: 'authentication',
  403: 'permission',
  404: 'configuration',
  429: 'api',
  500: 'api',
  502: 'connection',
  503: 'connection',
  504: 'connection',
};

export function detectErrorCategory(error: unknown): ErrorCategory {
  if (error instanceof CraftError) {
    return error.category;
  }

  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  // Check network error codes
  for (const [code, category] of Object.entries(NETWORK_ERRORS)) {
    if (message.includes(code)) {
      return category;
    }
  }

  // Check for common patterns
  if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
    return 'connection';
  }
  if (lowerMessage.includes('fetch failed') || lowerMessage.includes('network')) {
    return 'connection';
  }
  if (lowerMessage.includes('oauth') || lowerMessage.includes('token') ||
      lowerMessage.includes('unauthorized') || lowerMessage.includes('authentication')) {
    return 'authentication';
  }
  if (lowerMessage.includes('permission') || lowerMessage.includes('denied') ||
      lowerMessage.includes('forbidden')) {
    return 'permission';
  }
  if (lowerMessage.includes('rate limit') || lowerMessage.includes('quota') ||
      lowerMessage.includes('too many requests')) {
    return 'api';
  }
  if (lowerMessage.includes('session') || lowerMessage.includes('expired')) {
    return 'session';
  }
  if (lowerMessage.includes('mcp') || lowerMessage.includes('server')) {
    return 'configuration';
  }

  return 'internal';
}

export function createCraftError(
  error: unknown,
  context: Partial<ErrorContext>
): CraftError {
  const category = detectErrorCategory(error);
  const code = generateErrorCode(error, category);
  const fullContext: ErrorContext = {
    operation: context.operation || 'unknown operation',
    ...context,
    cause: error instanceof Error ? error : undefined,
  };

  const message = getUserMessage(code, error);
  const recovery = getRecoverySuggestion(code, fullContext);

  return new CraftError(category, code, message, fullContext, recovery);
}

function generateErrorCode(error: unknown, category: ErrorCategory): string {
  const message = error instanceof Error ? error.message : String(error);

  // Generate specific codes based on error patterns
  if (message.includes('ECONNREFUSED')) return 'CONNECTION_REFUSED';
  if (message.includes('ETIMEDOUT')) return 'CONNECTION_TIMEOUT';
  if (message.includes('ENOTFOUND')) return 'DNS_RESOLUTION_FAILED';
  if (message.includes('CERT_')) return 'SSL_CERTIFICATE_ERROR';
  if (message.includes('OAuth timeout')) return 'OAUTH_TIMEOUT';
  if (message.includes('OAuth state mismatch')) return 'OAUTH_STATE_MISMATCH';
  if (message.includes('401')) return 'UNAUTHORIZED';
  if (message.includes('403')) return 'FORBIDDEN';
  if (message.includes('429')) return 'RATE_LIMITED';
  if (message.includes('session')) return 'SESSION_ERROR';

  // Fallback to category-based code
  return `${category.toUpperCase()}_ERROR`;
}
```

#### 1.4 Create User Messages (`src/errors/messages.ts`)

```typescript
const ERROR_MESSAGES: Record<string, string | ((error: unknown) => string)> = {
  // Connection errors
  CONNECTION_REFUSED: 'Cannot connect to the server. The server may be down or the URL may be incorrect.',
  CONNECTION_TIMEOUT: 'Connection timed out. The server is taking too long to respond.',
  DNS_RESOLUTION_FAILED: 'Cannot resolve the server address. Check if the URL is correct.',
  SSL_CERTIFICATE_ERROR: 'SSL certificate error. The server\'s security certificate is invalid or untrusted.',

  // Authentication errors
  OAUTH_TIMEOUT: 'OAuth authentication timed out. The browser login was not completed within 5 minutes.',
  OAUTH_STATE_MISMATCH: 'OAuth security check failed. This may indicate a security issue - please try again.',
  OAUTH_REGISTRATION_FAILED: 'Failed to register with the OAuth server. The server may not support dynamic registration.',
  UNAUTHORIZED: 'Authentication failed. Your credentials may be invalid or expired.',
  TOKEN_EXPIRED: 'Your authentication token has expired.',
  TOKEN_REFRESH_FAILED: 'Failed to refresh authentication token.',

  // Permission errors
  FORBIDDEN: 'Access denied. You don\'t have permission to perform this action.',
  BASH_PERMISSION_DENIED: 'Bash command was not authorized.',

  // Configuration errors
  MCP_NOT_CONFIGURED: 'MCP server is not configured for this workspace.',
  INVALID_MCP_URL: 'The MCP server URL is invalid.',
  WORKSPACE_NOT_FOUND: 'Workspace not found.',
  AGENT_NOT_FOUND: 'Agent not found in this workspace.',

  // API errors
  RATE_LIMITED: 'Rate limit exceeded. Please wait before making more requests.',
  QUOTA_EXCEEDED: 'API quota exceeded.',
  API_ERROR: (error) => {
    const message = error instanceof Error ? error.message : String(error);
    const statusMatch = message.match(/(\d{3})/);
    return statusMatch
      ? `API returned error ${statusMatch[1]}.`
      : 'API request failed.';
  },

  // Session errors
  SESSION_ERROR: 'Session error. Your conversation history may need to be cleared.',
  SESSION_EXPIRED: 'Your session has expired.',

  // Tool errors
  TOOL_NOT_FOUND: 'The requested tool was not found.',
  TOOL_EXECUTION_FAILED: 'Tool execution failed.',

  // Internal errors
  INTERNAL_ERROR: 'An unexpected error occurred.',
};

export function getUserMessage(code: string, error: unknown): string {
  const template = ERROR_MESSAGES[code];

  if (typeof template === 'function') {
    return template(error);
  }

  if (template) {
    return template;
  }

  // Fallback to original error message
  return error instanceof Error ? error.message : String(error);
}
```

#### 1.5 Create Recovery Suggestions (`src/errors/recovery.ts`)

```typescript
import { ErrorContext, ErrorRecovery } from './types';

const RECOVERY_SUGGESTIONS: Record<string, (ctx: ErrorContext) => ErrorRecovery> = {
  // Connection errors
  CONNECTION_REFUSED: (ctx) => ({
    suggestion: 'Check if the server is running and the URL is correct.',
    steps: [
      'Verify the MCP server URL in your workspace settings',
      'Check if the server is accessible from your network',
      'Try reconnecting with /workspace',
    ],
    command: '/workspace',
  }),

  CONNECTION_TIMEOUT: () => ({
    suggestion: 'The server is not responding. It may be overloaded or unreachable.',
    steps: [
      'Wait a moment and try again',
      'Check your network connection',
      'Verify the server is operational',
    ],
  }),

  DNS_RESOLUTION_FAILED: (ctx) => ({
    suggestion: 'The server hostname could not be resolved.',
    steps: [
      'Check if the URL is spelled correctly',
      'Verify your DNS settings',
      'Try using the IP address instead',
    ],
    command: '/workspace',
  }),

  SSL_CERTIFICATE_ERROR: () => ({
    suggestion: 'The server\'s SSL certificate is not trusted.',
    steps: [
      'If this is a development server, you may need to trust the certificate',
      'Contact the server administrator if unexpected',
    ],
  }),

  // Authentication errors
  OAUTH_TIMEOUT: () => ({
    suggestion: 'Complete the browser login within 5 minutes.',
    steps: [
      'Run the command again',
      'Complete the login in the browser window that opens',
      'Return to the terminal after successful login',
    ],
  }),

  OAUTH_STATE_MISMATCH: () => ({
    suggestion: 'Try the authentication flow again.',
    steps: [
      'Close any pending OAuth tabs in your browser',
      'Run the authentication command again',
      'Use only the most recent browser tab',
    ],
  }),

  UNAUTHORIZED: (ctx) => ({
    suggestion: 'Re-authenticate with your workspace.',
    steps: [
      'Your credentials may have expired',
      'Re-add the workspace to refresh authentication',
    ],
    command: '/workspace add',
  }),

  TOKEN_EXPIRED: (ctx) => ({
    suggestion: 'Your session has expired. Please re-authenticate.',
    command: ctx.workspaceId ? '/workspace' : '/setup',
  }),

  TOKEN_REFRESH_FAILED: () => ({
    suggestion: 'Token refresh failed. You may need to re-authenticate.',
    steps: [
      'Your refresh token may have expired',
      'Re-add the workspace to get new credentials',
    ],
    command: '/workspace add',
  }),

  // Permission errors
  BASH_PERMISSION_DENIED: () => ({
    suggestion: 'You can approve bash commands when prompted.',
    steps: [
      'Commands require explicit approval for security',
      'Check "Always Allow" to approve similar commands in the future',
    ],
  }),

  FORBIDDEN: (ctx) => ({
    suggestion: 'You may not have permission for this operation.',
    steps: ctx.toolName
      ? [`The tool "${ctx.toolName}" requires additional permissions`]
      : ['Check your account permissions'],
  }),

  // Configuration errors
  MCP_NOT_CONFIGURED: (ctx) => ({
    suggestion: 'Configure the MCP server for this workspace.',
    steps: [
      'Add a workspace with a valid MCP server URL',
      'Ensure the server supports the required protocol',
    ],
    command: '/workspace add',
  }),

  AGENT_NOT_FOUND: (ctx) => ({
    suggestion: `Agent "${ctx.agentName}" was not found.`,
    steps: [
      'Check the agent name spelling',
      'Ensure the agent exists in your Agents folder',
      'Use /agent to see available agents',
    ],
    command: '/agent',
  }),

  // API errors
  RATE_LIMITED: () => ({
    suggestion: 'Wait before making more requests.',
    steps: [
      'The API has rate limits to prevent overuse',
      'Wait a few seconds and try again',
      'Consider reducing the frequency of requests',
    ],
  }),

  // Session errors
  SESSION_ERROR: () => ({
    suggestion: 'Clear your conversation and start fresh.',
    steps: [
      'Your conversation history may be corrupted',
      'Use /clear to start a new conversation',
    ],
    command: '/clear',
  }),

  SESSION_EXPIRED: () => ({
    suggestion: 'Your session has expired. Start a new conversation.',
    command: '/clear',
  }),

  // Tool errors
  TOOL_EXECUTION_FAILED: (ctx) => ({
    suggestion: `Tool "${ctx.toolName || 'unknown'}" failed to execute.`,
    steps: [
      'Check if the tool parameters are correct',
      'The external service may be unavailable',
    ],
  }),
};

export function getRecoverySuggestion(
  code: string,
  context: ErrorContext
): ErrorRecovery | undefined {
  const suggestionFn = RECOVERY_SUGGESTIONS[code];
  if (suggestionFn) {
    return suggestionFn(context);
  }

  // Generic recovery based on category
  return {
    suggestion: 'An error occurred. Please try again or contact support if the issue persists.',
  };
}
```

---

### Phase 2: Enhanced Error Display

#### 2.1 Create ErrorDisplay Component (`src/tui/components/ErrorDisplay.tsx`)

```typescript
import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { CraftErrorData, ErrorCategory } from '../../errors/types';

const CATEGORY_ICONS: Record<ErrorCategory, string> = {
  connection: '🔌',
  authentication: '🔐',
  permission: '🚫',
  configuration: '⚙️',
  api: '📡',
  session: '💾',
  tool: '🔧',
  internal: '⚠️',
};

const CATEGORY_COLORS: Record<ErrorCategory, string> = {
  connection: 'yellow',
  authentication: 'red',
  permission: 'red',
  configuration: 'yellow',
  api: 'yellow',
  session: 'yellow',
  tool: 'red',
  internal: 'red',
};

interface ErrorDisplayProps {
  error: CraftErrorData | string;
  showDetails?: boolean;
}

export const ErrorDisplay: React.FC<ErrorDisplayProps> = memo(({
  error,
  showDetails = false
}) => {
  // Handle legacy string errors
  if (typeof error === 'string') {
    return (
      <Box marginTop={1} marginBottom={1}>
        <Box borderStyle="round" borderColor="red" paddingX={1}>
          <Text color="red" bold>Error: </Text>
          <Text color="red">{error}</Text>
        </Box>
      </Box>
    );
  }

  const icon = CATEGORY_ICONS[error.category];
  const color = CATEGORY_COLORS[error.category];
  const categoryLabel = error.category.charAt(0).toUpperCase() + error.category.slice(1);

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box borderStyle="round" borderColor={color} paddingX={1} flexDirection="column">
        {/* Header with category */}
        <Box>
          <Text color={color} bold>
            {icon} {categoryLabel} Error
          </Text>
          {error.code && showDetails && (
            <Text color="gray" dimColor> [{error.code}]</Text>
          )}
        </Box>

        {/* Main message */}
        <Box marginTop={1}>
          <Text color={color}>{error.message}</Text>
        </Box>

        {/* Context (what was happening) */}
        {error.context.operation && (
          <Box marginTop={1}>
            <Text dimColor>While: {error.context.operation}</Text>
          </Box>
        )}

        {/* Recovery suggestion */}
        {error.recovery && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="cyan" bold>💡 {error.recovery.suggestion}</Text>

            {/* Recovery steps */}
            {error.recovery.steps && error.recovery.steps.length > 0 && (
              <Box flexDirection="column" marginLeft={2} marginTop={1}>
                {error.recovery.steps.map((step, i) => (
                  <Text key={i} dimColor>
                    {i + 1}. {step}
                  </Text>
                ))}
              </Box>
            )}

            {/* Suggested command */}
            {error.recovery.command && (
              <Box marginTop={1}>
                <Text dimColor>Try: </Text>
                <Text color="green">{error.recovery.command}</Text>
              </Box>
            )}
          </Box>
        )}

        {/* Technical details (when showDetails is true) */}
        {showDetails && error.context.statusCode && (
          <Box marginTop={1}>
            <Text dimColor>HTTP Status: {error.context.statusCode}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
});

ErrorDisplay.displayName = 'ErrorDisplay';
```

#### 2.2 Update Messages Component (`src/tui/components/Messages.tsx`)

Add support for the new error type in the Message interface and update the rendering:

```typescript
// Update Message type to support rich errors
interface Message {
  id: string;
  type: 'user' | 'assistant' | 'tool' | 'error' | 'status' | 'system';
  content: string;
  // Add optional rich error data
  errorData?: CraftErrorData;
  // ... other fields
}

// Update the error rendering in the Messages component:
{message.type === 'error' && (
  message.errorData
    ? <ErrorDisplay error={message.errorData} />
    : <ErrorDisplay error={message.content} />
)}
```

---

### Phase 3: Agent Layer Integration

#### 3.1 Update AgentEvent Type (`src/agent/craft-agent.ts`)

```typescript
// Update the error event type to include rich error data
type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'text_delta'; text: string }
  | { type: 'text_complete'; text: string }
  | { type: 'tool_start'; toolName: string; toolUseId: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; result: unknown; isError: boolean }
  | { type: 'permission_request'; requestId: string; toolName: string; command: string }
  | { type: 'ask_user'; requestId: string; questions: Question[] }
  | { type: 'error'; message: string; errorData?: CraftErrorData }  // Enhanced
  | { type: 'complete'; usage?: TokenUsage };
```

#### 3.2 Wrap Errors in CraftAgent (`src/agent/craft-agent.ts`)

Add error wrapping at key points:

**MCP Connection Errors (around line 450-459):**
```typescript
private async getAuthToken(): Promise<string> {
  try {
    // ... existing token retrieval logic
  } catch (error) {
    throw createCraftError(error, {
      operation: 'retrieving authentication token',
      workspaceId: this.workspaceId,
    });
  }
}
```

**Session Resume Failures (around line 734-739):**
```typescript
catch (error) {
  if (error instanceof Error && error.message.includes('session')) {
    const craftError = createCraftError(error, {
      operation: 'resuming conversation session',
      workspaceId: this.workspaceId,
    });
    yield { type: 'error', message: craftError.message, errorData: craftError.toData() };
    // Clear session and continue
    this.sessionId = undefined;
    await this.saveSession();
  }
  // ... rest of error handling
}
```

**Token Refresh Failures (make visible instead of silent):**
```typescript
private async refreshTokenIfNeeded(): Promise<string | null> {
  try {
    // ... existing refresh logic
  } catch (error) {
    // Instead of silently returning existing token, emit a warning
    const craftError = createCraftError(error, {
      operation: 'refreshing authentication token',
      workspaceId: this.workspaceId,
    });
    // Store for later emission as a status message
    this.pendingWarning = craftError;
    return existingToken; // Still fall back, but user will be warned
  }
}
```

#### 3.3 Update useAgent Hook (`src/tui/hooks/useAgent.ts`)

**Enhanced Network Error Detection:**
```typescript
// Replace the simple string matching with proper detection
catch (err) {
  const craftError = createCraftError(err, {
    operation: 'sending message to agent',
    workspaceId: activeWorkspace?.id,
  });

  setError(craftError.message);

  // Set connection status based on error category
  if (craftError.category === 'connection') {
    setConnected(false);
  }

  setMessages((prev) => [...prev, {
    id: `error-${Date.now()}`,
    type: 'error',
    content: craftError.message,
    errorData: craftError.toData(),
    timestamp: Date.now(),
  }]);
}
```

**Handle Rich Error Events:**
```typescript
case 'error':
  const errorData = event.errorData;
  setError(event.message);
  setMessages((prev) => [...prev, {
    id: `error-${Date.now()}`,
    type: 'error',
    content: event.message,
    errorData: errorData,  // Preserve rich error data
    timestamp: Date.now(),
  }]);
  break;
```

---

### Phase 4: MCP and API Error Handling

#### 4.1 Update MCP Client (`src/mcp/client.ts`)

```typescript
import { createCraftError } from '../errors/detector';

export class MCPClient {
  async connect(): Promise<void> {
    try {
      // ... existing connection logic
      await this.client.listTools();
    } catch (error) {
      throw createCraftError(error, {
        operation: 'connecting to MCP server',
        mcpServer: this.serverUrl,
      });
    }
  }
}
```

#### 4.2 Update API Tools (`src/agents/api-tools.ts`)

```typescript
import { createCraftError } from '../errors/detector';

// In the tool execution:
try {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw createCraftError(
      new Error(`HTTP ${response.status}: ${await response.text()}`),
      {
        operation: `calling ${apiConfig.name} API`,
        apiName: apiConfig.name,
        statusCode: response.status,
      }
    );
  }
  // ... rest of processing
} catch (error) {
  if (error instanceof CraftError) {
    throw error;
  }
  throw createCraftError(error, {
    operation: `calling ${apiConfig.name} API`,
    apiName: apiConfig.name,
  });
}
```

#### 4.3 Update OAuth Flow (`src/auth/oauth.ts`)

```typescript
import { createCraftError } from '../errors/detector';

// Wrap OAuth errors with context:
async function performOAuth(): Promise<TokenResult> {
  try {
    // ... OAuth flow
  } catch (error) {
    throw createCraftError(error, {
      operation: 'performing OAuth authentication',
      workspaceId: workspaceId,
    });
  }
}
```

---

### Phase 5: Agent Extraction Errors

#### 5.1 Update Agent Manager (`src/agents/manager.ts`)

Surface extraction errors to users instead of logging silently:

```typescript
async activateAgent(name: string): Promise<ActivationResult> {
  try {
    const definition = await this.getDefinition(name);
    // ... activation logic
  } catch (error) {
    const craftError = createCraftError(error, {
      operation: `activating agent "${name}"`,
      agentName: name,
      workspaceId: this.workspaceId,
    });

    return {
      success: false,
      error: craftError,
      messages: [`Failed to activate agent: ${craftError.message}`],
    };
  }
}
```

#### 5.2 Update Extractor (`src/agents/extractor.ts`)

```typescript
export async function extractAgentDefinition(
  documentId: string,
  options: ExtractionOptions
): Promise<ExtractionResult> {
  try {
    // ... extraction logic
  } catch (error) {
    const craftError = createCraftError(error, {
      operation: 'extracting agent definition from document',
      agentName: options.agentName,
    });

    return {
      success: false,
      error: craftError,
      definition: null,
    };
  }
}
```

---

## Error Codes Reference

### Connection Errors (1xx)
| Code | Description |
|------|-------------|
| `CONNECTION_REFUSED` | Server refused the connection |
| `CONNECTION_TIMEOUT` | Connection attempt timed out |
| `CONNECTION_RESET` | Connection was reset by peer |
| `DNS_RESOLUTION_FAILED` | Could not resolve hostname |
| `SSL_CERTIFICATE_ERROR` | SSL/TLS certificate issue |
| `HOST_UNREACHABLE` | Host is not reachable |

### Authentication Errors (2xx)
| Code | Description |
|------|-------------|
| `UNAUTHORIZED` | 401 - Invalid credentials |
| `TOKEN_EXPIRED` | Authentication token expired |
| `TOKEN_REFRESH_FAILED` | Could not refresh token |
| `OAUTH_TIMEOUT` | OAuth flow timed out |
| `OAUTH_STATE_MISMATCH` | OAuth state validation failed |
| `OAUTH_REGISTRATION_FAILED` | Dynamic client registration failed |
| `INVALID_API_KEY` | API key is invalid |

### Permission Errors (3xx)
| Code | Description |
|------|-------------|
| `FORBIDDEN` | 403 - Access denied |
| `BASH_PERMISSION_DENIED` | Bash command not authorized |
| `INSUFFICIENT_PERMISSIONS` | Lacking required permissions |

### Configuration Errors (4xx)
| Code | Description |
|------|-------------|
| `MCP_NOT_CONFIGURED` | MCP server not set up |
| `INVALID_MCP_URL` | MCP URL is malformed |
| `WORKSPACE_NOT_FOUND` | Workspace doesn't exist |
| `AGENT_NOT_FOUND` | Agent doesn't exist |
| `INVALID_CONFIGURATION` | Configuration is invalid |

### API Errors (5xx)
| Code | Description |
|------|-------------|
| `RATE_LIMITED` | 429 - Too many requests |
| `QUOTA_EXCEEDED` | API quota used up |
| `API_ERROR` | Generic API error |
| `API_UNAVAILABLE` | API service unavailable |

### Session Errors (6xx)
| Code | Description |
|------|-------------|
| `SESSION_EXPIRED` | Session no longer valid |
| `SESSION_CORRUPTED` | Session data corrupted |
| `HISTORY_LOAD_FAILED` | Could not load conversation |

### Tool Errors (7xx)
| Code | Description |
|------|-------------|
| `TOOL_NOT_FOUND` | Tool doesn't exist |
| `TOOL_EXECUTION_FAILED` | Tool failed to execute |
| `INVALID_TOOL_PARAMS` | Tool parameters invalid |

### Internal Errors (8xx)
| Code | Description |
|------|-------------|
| `INTERNAL_ERROR` | Unexpected internal error |
| `UNKNOWN_ERROR` | Could not classify error |

---

## Implementation Order

### Step 1: Foundation (Create new files)
1. `src/errors/types.ts` - Type definitions
2. `src/errors/CraftError.ts` - Error class
3. `src/errors/detector.ts` - Error detection
4. `src/errors/messages.ts` - User messages
5. `src/errors/recovery.ts` - Recovery suggestions
6. `src/errors/index.ts` - Public exports

### Step 2: UI Layer
7. `src/tui/components/ErrorDisplay.tsx` - New component
8. Update `src/tui/components/Messages.tsx` - Use ErrorDisplay

### Step 3: Agent Layer
9. Update `src/agent/craft-agent.ts` - Wrap errors, emit rich events
10. Update `src/tui/hooks/useAgent.ts` - Handle rich errors

### Step 4: MCP/API Layer
11. Update `src/mcp/client.ts` - Wrap MCP errors
12. Update `src/agents/api-tools.ts` - Wrap API errors
13. Update `src/auth/oauth.ts` - Wrap OAuth errors

### Step 5: Agent System
14. Update `src/agents/manager.ts` - Surface activation errors
15. Update `src/agents/extractor.ts` - Surface extraction errors

### Step 6: Configuration
16. Update `src/config/storage.ts` - Wrap config errors

---

## Testing Scenarios

After implementation, test these scenarios to verify error handling:

1. **Connection Errors**
   - Start app with invalid MCP URL
   - Disconnect network mid-conversation
   - Use unreachable host

2. **Authentication Errors**
   - Use expired OAuth token
   - Use invalid API key
   - Cancel OAuth flow mid-process

3. **Permission Errors**
   - Deny bash command
   - Try accessing restricted tool

4. **Configuration Errors**
   - Delete workspace mid-session
   - Use malformed config file

5. **API Errors**
   - Trigger rate limit (if testable)
   - Use invalid API endpoint

6. **Session Errors**
   - Corrupt conversation.json manually
   - Clear session mid-conversation

---

## Summary

This plan introduces:

- **8 error categories** with distinct visual styling
- **30+ specific error codes** for precise identification
- **Rich error context** including operation, identifiers, and technical details
- **Recovery suggestions** with actionable steps and commands
- **Enhanced UI** with icons, colors, and structured error display
- **Silent failure elimination** - all errors surface to users

The implementation focuses on **clarity for users** rather than automatic resolution. Users will always know:
1. **What category** of error occurred
2. **What was happening** when it occurred
3. **What they can do** to resolve it
