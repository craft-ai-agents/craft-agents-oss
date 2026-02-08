/**
 * MCP Connection Validation using Claude Agent SDK
 *
 * Uses the SDK's mcpServerStatus() method to validate MCP connections
 * using the same code path as actual agent usage.
 */

import { query, type McpServerStatus } from '@anthropic-ai/claude-agent-sdk';
import { spawn, type ChildProcess } from 'child_process';
import { getDefaultOptions } from '../agent/options.ts';
import { CraftMcpClient } from './client.js';
import { debug } from '../utils/debug.ts';
import { getDefaultSummarizationModel } from '../config/models.ts';
import { parseError, type AgentError } from '../agent/errors.ts';
import { getLastApiError } from '../network-interceptor.ts';

export interface InvalidProperty {
  toolName: string;
  propertyPath: string;
  propertyKey: string;
}

export interface McpValidationResult {
  success: boolean;
  error?: string;
  errorType?: 'failed' | 'needs-auth' | 'pending' | 'invalid-schema' | 'unknown';
  /** Typed error for API/billing failures - display as ErrorBanner */
  typedError?: AgentError;
  serverInfo?: {
    name: string;
    version: string;
  };
  invalidProperties?: InvalidProperty[];
  /** Tool names available on this server (populated on successful connection) */
  tools?: string[];
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
        ...getDefaultOptions(),
        mcpServers,
        model: config.model || getDefaultSummarizationModel(),
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
          transport: 'http',
          url: mcpUrl,
          headers: config.mcpAccessToken
            ? { Authorization: `Bearer ${config.mcpAccessToken}` }
            : undefined,
        });

        try {
          const tools = await mcpClient.listTools();
          const toolNames = tools.map((t) => t.name);
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
              tools: toolNames,
            };
          }

          return {
            success: true,
            serverInfo: status.serverInfo,
            tools: toolNames,
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

      // Use SDK's error field if available (new in v0.2.0), fallback to generic message
      return {
        success: false,
        error: status.error || getValidationErrorMessage({
          success: false,
          errorType: status.status,
        }),
        errorType: status.status,
      };
    } catch (err) {
      // Abort on error
      abortController.abort();

      // Check for captured API error from interceptor (most reliable source)
      const apiError = getLastApiError();
      if (apiError) {
        debug('[mcp-validation] Found captured API error:', apiError.status, apiError.message);
        const typedError = parseError(new Error(`${apiError.status} ${apiError.message}`));
        if (typedError.code !== 'unknown_error') {
          return {
            success: false,
            error: typedError.message,
            errorType: 'unknown',
            typedError,
          };
        }
      }

      // Fall back to parsing the thrown error
      const typedError = parseError(err);

      // For billing/auth errors, return the typed error for ErrorBanner display
      if (typedError.code !== 'unknown_error') {
        return {
          success: false,
          error: typedError.message,
          errorType: 'unknown',
          typedError,
        };
      }

      // For unknown errors, return just the error message
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

export interface StdioValidationConfig {
  /** Command to spawn (e.g., 'npx', 'node') */
  command: string;
  /** Arguments to pass to the command */
  args?: string[];
  /** Environment variables for the spawned process */
  env?: Record<string, string>;
  /** Timeout in ms (default: 30000) */
  timeout?: number;
}

/**
 * Validates a stdio MCP connection by spawning the process and listing tools.
 *
 * Unlike HTTP validation, this actually spawns the MCP server process,
 * connects via stdio transport, and validates the available tools.
 */
export async function validateStdioMcpConnection(
  config: StdioValidationConfig
): Promise<McpValidationResult> {
  const { command, args = [], env = {}, timeout = 30000 } = config;

  debug(`[stdio-validation] Spawning: ${command} ${args.join(' ')}`);

  // Dynamically import MCP SDK stdio transport
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import(
    '@modelcontextprotocol/sdk/client/stdio.js'
  );

  let childProcess: ChildProcess | null = null;
  let client: InstanceType<typeof Client> | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let stderrOutput = '';

  const cleanup = async () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (client) {
      try {
        await client.close();
      } catch {
        // Ignore close errors
      }
      client = null;
    }
    if (childProcess && !childProcess.killed) {
      // Platform-aware process termination (SIGTERM/SIGKILL don't exist on Windows)
      if (process.platform === 'win32') {
        childProcess.kill();
      } else {
        childProcess.kill('SIGTERM');
      }
      // Force kill after 1s if still alive
      setTimeout(() => {
        if (childProcess && !childProcess.killed) {
          if (process.platform === 'win32') {
            childProcess.kill();
          } else {
            childProcess.kill('SIGKILL');
          }
        }
      }, 1000);
    }
  };

  try {
    // Create promise that rejects on timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Timeout: Process did not respond within ${timeout}ms`));
      }, timeout);
    });

    // Spawn the process
    const spawnPromise = (async () => {
      childProcess = spawn(command, args, {
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Capture stderr for error messages
      childProcess.stderr?.on('data', (data) => {
        stderrOutput += data.toString();
        // Limit stderr capture to prevent memory issues
        if (stderrOutput.length > 10000) {
          stderrOutput = stderrOutput.slice(-10000);
        }
      });

      // Handle spawn errors
      const spawnError = await new Promise<Error | null>((resolve) => {
        childProcess!.on('error', (err) => resolve(err));
        // Give spawn a moment to fail
        setTimeout(() => resolve(null), 100);
      });

      if (spawnError) {
        throw spawnError;
      }

      // Check if process exited immediately
      if (childProcess.exitCode !== null) {
        const exitMsg = stderrOutput.trim() || `Process exited with code ${childProcess.exitCode}`;
        throw new Error(exitMsg);
      }

      // Create stdio transport
      // Filter out undefined values from process.env
      const processEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
          processEnv[key] = value;
        }
      }
      const transport = new StdioClientTransport({
        command,
        args,
        env: { ...processEnv, ...env },
      });

      // Create MCP client
      client = new Client(
        { name: 'craft-agent-validator', version: '1.0.0' },
        { capabilities: {} }
      );

      // Connect to the server
      await client.connect(transport);

      // List available tools
      const toolsResult = await client.listTools();
      const tools = toolsResult.tools || [];
      const toolNames = tools.map((t: { name: string }) => t.name);

      debug(`[stdio-validation] Found ${tools.length} tools`);

      // Validate tool schemas for property naming
      const allInvalidProperties: InvalidProperty[] = [];
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

      if (allInvalidProperties.length > 0) {
        const toolsWithIssues = [
          ...new Set(allInvalidProperties.map((p) => p.toolName)),
        ];
        return {
          success: false,
          error: `Server has ${allInvalidProperties.length} invalid property name(s) in ${toolsWithIssues.length} tool(s): ${toolsWithIssues.join(', ')}. Property names must match ^[a-zA-Z0-9_.-]{1,64}$`,
          errorType: 'invalid-schema' as const,
          invalidProperties: allInvalidProperties,
          tools: toolNames,
        };
      }

      return {
        success: true,
        tools: toolNames,
        serverInfo: {
          name: command,
          version: args.join(' '),
        },
      };
    })();

    // Race between spawn and timeout
    const result = await Promise.race([spawnPromise, timeoutPromise]);
    return result;
  } catch (err) {
    const error = err as Error;
    debug(`[stdio-validation] Error: ${error.message}`);

    // Determine error type based on error message
    let errorType: McpValidationResult['errorType'] = 'failed';
    let errorMessage = error.message;

    if (error.message.includes('ENOENT') || error.message.includes('not found')) {
      errorMessage = `Command not found: "${command}". Install the required dependency and try again.`;
    } else if (error.message.includes('EACCES') || error.message.includes('permission denied')) {
      errorMessage = `Permission denied running "${command}". Check file permissions.`;
    } else if (error.message.includes('Timeout')) {
      errorMessage = `Server startup timeout. The process may be hanging or waiting for input.`;
    } else if (stderrOutput.trim()) {
      // Include stderr output in error message
      errorMessage = `Process error: ${stderrOutput.trim().split('\n')[0]}`;
    }

    return {
      success: false,
      error: errorMessage,
      errorType,
    };
  } finally {
    await cleanup();
  }
}

/**
 * Get a user-friendly error message based on the validation result.
 * Accepts optional transport context to distinguish local (stdio) vs remote failures.
 */
export function getValidationErrorMessage(
  result: McpValidationResult,
  context?: { transport?: string }
): string {
  // Prefer the SDK's error field when available (most specific)
  if (result.error) return result.error;

  switch (result.errorType) {
    case 'failed':
      // Distinguish local stdio servers (crashed/not running) from remote (unreachable)
      if (context?.transport === 'stdio') {
        return 'Server process not running or failed to start.';
      }
      return 'Server unreachable - check the URL and your network.';
    case 'needs-auth':
      return 'Authentication expired or was revoked.';
    case 'pending':
      return 'Connection is still pending - try again.';
    case 'invalid-schema':
      return 'Server has tools with invalid property names.';
    case 'unknown':
    default:
      return 'Connection failed - check source configuration.';
  }
}
