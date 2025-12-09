/**
 * MCP Connection Validation using Claude Agent SDK
 *
 * Uses the SDK's mcpServerStatus() method to validate MCP connections
 * using the same code path as actual agent usage.
 */

import { query, type McpServerStatus } from '@anthropic-ai/claude-agent-sdk';
import { CraftMcpClient } from './client.js';
import { debug } from '@/tui/utils/debug.js';

export interface InvalidProperty {
  toolName: string;
  propertyPath: string;
  propertyKey: string;
}

export interface McpValidationResult {
  success: boolean;
  error?: string;
  errorType?: 'failed' | 'needs-auth' | 'pending' | 'invalid-schema' | 'unknown';
  serverInfo?: {
    name: string;
    version: string;
  };
  invalidProperties?: InvalidProperty[];
}

/**
 * Pattern for valid property names in tool input schemas.
 * Must match: letters, numbers, underscores, dots, hyphens (1-64 chars)
 *
 * This pattern is enforced server-side by the Anthropic API.
 * It is NOT defined in the MCP specification (which has no naming constraints).
 * It is NOT exported by @anthropic-ai/sdk or @anthropic-ai/claude-agent-sdk.
 *
 * API error when violated:
 * "tools.0.custom.input_schema.properties: Property keys should match pattern '^[a-zA-Z0-9_.-]{1,64}$'"
 *
 * @see https://github.com/modelcontextprotocol/go-sdk/issues/169 - confirms this is Claude-specific
 * @see https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
 */
export const ANTHROPIC_PROPERTY_NAME_PATTERN = /^[a-zA-Z0-9_.-]{1,64}$/;

/**
 * Recursively finds invalid property names in a JSON schema.
 * Returns an array of invalid properties with their paths.
 */
function findInvalidProperties(
  schema: Record<string, unknown>,
  path = ''
): { path: string; key: string }[] {
  const invalid: { path: string; key: string }[] = [];

  if (!schema || typeof schema !== 'object') {
    return invalid;
  }

  // Check properties object
  if (schema.properties && typeof schema.properties === 'object') {
    const properties = schema.properties as Record<string, unknown>;
    for (const key of Object.keys(properties)) {
      if (!ANTHROPIC_PROPERTY_NAME_PATTERN.test(key)) {
        invalid.push({
          path: path ? `${path}.${key}` : key,
          key,
        });
      }
      // Recurse into nested schemas
      const nestedSchema = properties[key];
      if (nestedSchema && typeof nestedSchema === 'object') {
        invalid.push(
          ...findInvalidProperties(
            nestedSchema as Record<string, unknown>,
            path ? `${path}.${key}` : key
          )
        );
      }
    }
  }

  // Check items for arrays
  if (schema.items && typeof schema.items === 'object') {
    invalid.push(
      ...findInvalidProperties(
        schema.items as Record<string, unknown>,
        path ? `${path}[]` : '[]'
      )
    );
  }

  // Check additionalProperties if it's a schema object
  if (
    schema.additionalProperties &&
    typeof schema.additionalProperties === 'object'
  ) {
    invalid.push(
      ...findInvalidProperties(
        schema.additionalProperties as Record<string, unknown>,
        path ? `${path}.<additionalProperties>` : '<additionalProperties>'
      )
    );
  }

  return invalid;
}

export interface McpValidationConfig {
  /** MCP server URL */
  mcpUrl: string;
  /** Access token for MCP server (OAuth or bearer) */
  mcpAccessToken?: string;
  /** Anthropic API key (for API key auth) */
  claudeApiKey?: string;
  /** Claude OAuth token (for Max subscription auth) */
  claudeOAuthToken?: string;
  /** Model to use for validation (defaults to sonnet) */
  model?: string;
}

/**
 * Validates an MCP connection using the Claude Agent SDK.
 *
 * Creates a minimal query with the MCP server configured, then uses
 * mcpServerStatus() to check if the server is connected. The query
 * is aborted immediately after getting the status.
 */
export async function validateMcpConnection(
  config: McpValidationConfig
): Promise<McpValidationResult> {
  debug('Validating MCP connection to', config.mcpUrl);
  // Store original env vars to restore later
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  const originalOAuthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;

  try {
    // Set Claude credentials for SDK (temporarily)
    if (config.claudeApiKey) {
      process.env.ANTHROPIC_API_KEY = config.claudeApiKey;
      // Clear OAuth token if API key is provided
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    } else if (config.claudeOAuthToken) {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = config.claudeOAuthToken;
      // Clear API key if OAuth token is provided
      delete process.env.ANTHROPIC_API_KEY;
    }

    // Normalize MCP URL (ensure /mcp suffix)
    let mcpUrl = config.mcpUrl;
    if (!mcpUrl.endsWith('/mcp')) {
      mcpUrl = mcpUrl.replace(/\/$/, '') + '/mcp';
    }

    // Build MCP server config
    const mcpServers = {
      validation_target: {
        type: 'http' as const,
        url: mcpUrl,
        ...(config.mcpAccessToken
          ? { headers: { Authorization: `Bearer ${config.mcpAccessToken}` } }
          : {}),
      },
    };

    // Create abort controller to stop query after getting status
    const abortController = new AbortController();

    // Create minimal query with MCP server
    const q = query({
      prompt: '',
      options: {
        mcpServers,
        model: config.model || 'claude-sonnet-4-20250514',
        abortController,
      },
    });

    try {
      // Get server status (this connects to MCP servers)
      const statuses = await q.mcpServerStatus();
      const status = statuses.find((s) => s.name === 'validation_target');

      // Abort query immediately - we don't need to continue
      abortController.abort();

      if (!status) {
        return {
          success: false,
          error: 'Server not found in status response',
          errorType: 'unknown',
        };
      }

      if (status.status === 'connected') {
        // Connection successful - now validate tool schemas
        // Use direct MCP client to fetch tools (SDK already validated connection)
        const mcpClient = new CraftMcpClient({
          url: mcpUrl,
          headers: config.mcpAccessToken
            ? { Authorization: `Bearer ${config.mcpAccessToken}` }
            : undefined,
        });

        try {
          const tools = await mcpClient.listTools();
          const allInvalidProperties: InvalidProperty[] = [];

          debug(`Validating schemas for ${tools.length} tools`);

          for (const tool of tools) {
            if (tool.inputSchema && typeof tool.inputSchema === 'object') {
              const invalidProps = findInvalidProperties(
                tool.inputSchema as Record<string, unknown>
              );
              for (const prop of invalidProps) {
                allInvalidProperties.push({
                  toolName: tool.name,
                  propertyPath: prop.path,
                  propertyKey: prop.key,
                });
              }
            }
          }

          await mcpClient.close();

          if (allInvalidProperties.length > 0) {
            // Group by tool for error message
            const toolsWithIssues = [
              ...new Set(allInvalidProperties.map((p) => p.toolName)),
            ];
            return {
              success: false,
              error: `Server has ${allInvalidProperties.length} invalid property name(s) in ${toolsWithIssues.length} tool(s): ${toolsWithIssues.join(', ')}. Property names must match ^[a-zA-Z0-9_.-]{1,64}$`,
              errorType: 'invalid-schema',
              serverInfo: status.serverInfo,
              invalidProperties: allInvalidProperties,
            };
          }

          return {
            success: true,
            serverInfo: status.serverInfo,
          };
        } catch (err) {
          // If we can't list tools, for now report connection success
          // The schema validation is a bonus check, need to evaluate errors here later
          debug(
            'WARNING: Could not validate tool schemas:',
            err instanceof Error ? err.message : err
          );
          await mcpClient.close().catch(() => {});
          return {
            success: true,
            serverInfo: status.serverInfo,
          };
        }
      }

      return {
        success: false,
        error: getValidationErrorMessage({
          success: false,
          errorType: status.status,
        }),
        errorType: status.status,
      };
    } catch (err) {
      // Abort on error
      abortController.abort();

      return {
        success: false,
        error: err instanceof Error ? err.message : 'Validation failed',
        errorType: 'unknown',
      };
    }
  } finally {
    // Restore original env vars
    if (originalApiKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }

    if (originalOAuthToken !== undefined) {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = originalOAuthToken;
    } else {
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    }
  }
}

/**
 * Get a user-friendly error message based on the validation result.
 */
export function getValidationErrorMessage(result: McpValidationResult): string {
  switch (result.errorType) {
    case 'failed':
      return 'Could not connect to server - check the URL and your network.';
    case 'needs-auth':
      return 'Server requires authentication - credentials may be invalid.';
    case 'pending':
      return 'Connection is still pending - please try again.';
    case 'invalid-schema':
      return result.error || 'Server has tools with invalid property names.';
    case 'unknown':
    default:
      return result.error || 'Connection failed for an unknown reason.';
  }
}
