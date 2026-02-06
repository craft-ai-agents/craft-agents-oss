#!/usr/bin/env node
/**
 * Session MCP Server
 *
 * This MCP server provides session-scoped tools to Codex via stdio transport.
 * It uses the shared handlers from @craft-agent/session-tools-core to ensure
 * feature parity with Claude's session-scoped tools.
 *
 * Callback Communication:
 * Tools that need to communicate with the main Electron process (e.g., SubmitPlan
 * triggering a plan display, OAuth triggers pausing execution) send structured
 * JSON messages to stderr with a "__CALLBACK__" prefix. The main process monitors
 * stderr and handles these callbacks.
 *
 * Usage:
 *   node session-mcp-server.js --session-id <id> --workspace-root <path> --plans-folder <path>
 *
 * Arguments:
 *   --session-id: Unique session identifier
 *   --workspace-root: Path to workspace folder (~/.craft-agent/workspaces/{id})
 *   --plans-folder: Path to session's plans folder
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

// Import from session-tools-core
import {
  type SessionToolContext,
  type CallbackMessage,
  type AuthRequest,
  type SourceConfig,
  type LlmCallParams,
  type LlmCallResult,
  // Handlers
  handleSubmitPlan,
  handleConfigValidate,
  handleSkillValidate,
  handleMermaidValidate,
  handleSourceTest,
  handleSourceOAuthTrigger,
  handleGoogleOAuthTrigger,
  handleSlackOAuthTrigger,
  handleMicrosoftOAuthTrigger,
  handleCredentialPrompt,
  handleCallLlm,
  // Helpers
  loadSourceConfig as loadSourceConfigFromHelpers,
  errorResponse,
} from '@craft-agent/session-tools-core';

// ============================================================
// Types
// ============================================================

interface SessionConfig {
  sessionId: string;
  workspaceRootPath: string;
  plansFolderPath: string;
}

// ============================================================
// Callback Communication
// ============================================================

/**
 * Send a callback message to the main process via stderr.
 * These messages are parsed by the main process to trigger UI actions.
 */
function sendCallback(callback: CallbackMessage): void {
  // Write to stderr as a single line JSON (main process parses this)
  console.error(`__CALLBACK__${JSON.stringify(callback)}`);
}

// ============================================================
// Codex Context Factory
// ============================================================

/**
 * Create a SessionToolContext for the Codex MCP server.
 * This provides the context needed by all handlers.
 */
function createCodexContext(config: SessionConfig): SessionToolContext {
  const { sessionId, workspaceRootPath, plansFolderPath } = config;

  // File system implementation
  const fs = {
    exists: (path: string) => existsSync(path),
    readFile: (path: string) => readFileSync(path, 'utf-8'),
    readFileBuffer: (path: string) => readFileSync(path),
    writeFile: (path: string, content: string) => writeFileSync(path, content, 'utf-8'),
    isDirectory: (path: string) => existsSync(path) && statSync(path).isDirectory(),
    readdir: (path: string) => readdirSync(path),
    stat: (path: string) => {
      const stats = statSync(path);
      return {
        size: stats.size,
        isDirectory: () => stats.isDirectory(),
      };
    },
  };

  // Callback implementation using stderr
  const callbacks = {
    onPlanSubmitted: (planPath: string) => {
      sendCallback({
        __callback__: 'plan_submitted',
        sessionId,
        planPath,
      });
    },
    onAuthRequest: (request: AuthRequest) => {
      sendCallback({
        __callback__: 'auth_request',
        ...request,
      });
    },
  };

  // LLM call implementation using Anthropic SDK
  const callLlm = async (params: LlmCallParams): Promise<LlmCallResult> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error: 'No ANTHROPIC_API_KEY environment variable set. Cannot call secondary LLM.',
      };
    }

    try {
      const client = new Anthropic({ apiKey });

      // Build message content with attachments
      const messageContent: Anthropic.MessageCreateParams['messages'][0]['content'] = [];

      // Process attachments if any
      if (params.attachments?.length) {
        for (const attachment of params.attachments) {
          const filePath = typeof attachment === 'string' ? attachment : attachment.path;
          const startLine = typeof attachment === 'object' ? attachment.startLine : undefined;
          const endLine = typeof attachment === 'object' ? attachment.endLine : undefined;

          if (!existsSync(filePath)) {
            return { success: false, error: `Attachment not found: ${filePath}` };
          }

          const content = readFileSync(filePath, 'utf-8');
          const lines = content.split('\n');

          let finalContent: string;
          if (startLine !== undefined || endLine !== undefined) {
            const start = (startLine || 1) - 1;
            const end = endLine || lines.length;
            finalContent = lines.slice(start, end).join('\n');
          } else {
            finalContent = content;
          }

          const filename = filePath.split('/').pop() || filePath;
          messageContent.push({
            type: 'text',
            text: `<file path="${filename}">\n${finalContent}\n</file>`,
          });
        }
      }

      // Add the prompt
      messageContent.push({ type: 'text', text: params.prompt });

      // Build request
      // Default to Haiku (fastest, most cost-effective)
      // TODO: Import HAIKU_MODEL_ID from @craft-agent/shared/config/models when dependency is added
      const model = params.model || 'claude-haiku-4-5-20251001';
      const maxTokens = params.maxTokens || 4096;

      const request: Anthropic.MessageCreateParams = {
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: messageContent }],
        ...(params.systemPrompt ? { system: params.systemPrompt } : {}),
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      };

      // Handle structured output via tool use
      if (params.outputFormat || params.outputSchema) {
        const schema = params.outputSchema || getOutputFormatSchema(params.outputFormat!);
        if (schema) {
          request.tools = [{
            name: 'structured_output',
            description: 'Output structured data matching the required schema',
            input_schema: schema as Anthropic.Tool['input_schema'],
          }];
          request.tool_choice = { type: 'tool', name: 'structured_output' };
        }
      }

      // Handle extended thinking
      if (params.thinking) {
        const thinkingBudget = params.thinkingBudget || 10000;
        request.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
        request.max_tokens = thinkingBudget + maxTokens;
        request.temperature = 1; // Required for thinking
      }

      const response = await client.messages.create(request);

      // Extract response
      if (params.outputFormat || params.outputSchema) {
        const toolUse = response.content.find(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        );
        if (toolUse) {
          return { success: true, content: JSON.stringify(toolUse.input, null, 2) };
        }
        return { success: false, error: 'Structured output expected but no tool_use block returned' };
      }

      if (params.thinking) {
        const thinkingBlock = response.content.find(
          (block): block is Anthropic.ThinkingBlock => block.type === 'thinking'
        );
        const textBlock = response.content.find(
          (block): block is Anthropic.TextBlock => block.type === 'text'
        );

        const parts: string[] = [];
        if (thinkingBlock) {
          parts.push(`<thinking>\n${thinkingBlock.thinking}\n</thinking>`);
        }
        if (textBlock) {
          parts.push(textBlock.text);
        }

        return { success: true, content: parts.join('\n\n') || '(Empty response)' };
      }

      // Standard text response
      const textContent = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('\n');

      return { success: true, content: textContent || '(Empty response)' };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        return { success: false, error: `API Error (${error.status}): ${error.message}` };
      }
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  };

  // Build context
  return {
    sessionId,
    workspacePath: workspaceRootPath,
    get sourcesPath() { return join(workspaceRootPath, 'sources'); },
    get skillsPath() { return join(workspaceRootPath, 'skills'); },
    plansFolderPath,
    callbacks,
    fs,
    callLlm,
    loadSourceConfig: (sourceSlug: string): SourceConfig | null => {
      return loadSourceConfigFromHelpers(workspaceRootPath, sourceSlug);
    },
    // Note: saveSourceConfig, credentialManager, validators, renderMermaid
    // are not available in Codex context (require Electron internals)
  };
}

// ============================================================
// Output Format Schemas
// ============================================================

function getOutputFormatSchema(format: string): Record<string, unknown> | null {
  const schemas: Record<string, Record<string, unknown>> = {
    summary: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Concise summary' },
        key_points: { type: 'array', items: { type: 'string' }, description: 'Main points' },
        word_count: { type: 'number', description: 'Approximate word count of source' },
      },
      required: ['summary', 'key_points'],
    },
    classification: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Primary category' },
        confidence: { type: 'number', description: 'Confidence 0-1' },
        reasoning: { type: 'string', description: 'Why this classification' },
      },
      required: ['category', 'confidence', 'reasoning'],
    },
    extraction: {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'object' }, description: 'Extracted items' },
        count: { type: 'number', description: 'Number of items found' },
      },
      required: ['items', 'count'],
    },
    analysis: {
      type: 'object',
      properties: {
        findings: { type: 'array', items: { type: 'string' }, description: 'Key findings' },
        issues: { type: 'array', items: { type: 'string' }, description: 'Problems found' },
        recommendations: { type: 'array', items: { type: 'string' }, description: 'Suggested actions' },
      },
      required: ['findings'],
    },
    comparison: {
      type: 'object',
      properties: {
        similarities: { type: 'array', items: { type: 'string' } },
        differences: { type: 'array', items: { type: 'string' } },
        verdict: { type: 'string', description: 'Overall comparison result' },
      },
      required: ['similarities', 'differences', 'verdict'],
    },
    validation: {
      type: 'object',
      properties: {
        valid: { type: 'boolean', description: 'Whether input is valid' },
        errors: { type: 'array', items: { type: 'string' }, description: 'Validation errors' },
        warnings: { type: 'array', items: { type: 'string' }, description: 'Warnings' },
      },
      required: ['valid', 'errors', 'warnings'],
    },
  };

  return schemas[format] || null;
}

// ============================================================
// Tool Definitions
// ============================================================

function createTools(): Tool[] {
  return [
    {
      name: 'SubmitPlan',
      description: `Submit a plan for user review.

Call this after you have written your plan to a markdown file using the Write tool.
The plan will be displayed to the user in a special formatted view.

**IMPORTANT:** After calling this tool:
- Execution will be **automatically paused** to present the plan to the user
- No further tool calls or text output will be processed after this tool returns
- The conversation will resume when the user responds`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          planPath: {
            type: 'string',
            description: 'Absolute path to the plan markdown file you wrote',
          },
        },
        required: ['planPath'],
      },
    },
    {
      name: 'config_validate',
      description: `Validate Craft Agent configuration files.

**Targets:**
- config: Validates ~/.craft-agent/config.json
- sources: Validates source config.json files
- statuses: Validates statuses config
- preferences: Validates preferences.json
- permissions: Validates workspace permissions.json
- tool-icons: Validates tool-icons.json
- all: Validates all configuration files`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          target: {
            type: 'string',
            enum: ['config', 'sources', 'statuses', 'preferences', 'permissions', 'tool-icons', 'all'],
            description: 'Which config file(s) to validate',
          },
          sourceSlug: {
            type: 'string',
            description: 'Validate a specific source by slug (used with target "sources")',
          },
        },
        required: ['target'],
      },
    },
    {
      name: 'skill_validate',
      description: `Validate a skill's SKILL.md file.

Checks slug format, SKILL.md existence, YAML frontmatter, and required fields.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          skillSlug: {
            type: 'string',
            description: 'The slug of the skill to validate',
          },
        },
        required: ['skillSlug'],
      },
    },
    {
      name: 'mermaid_validate',
      description: `Validate Mermaid diagram syntax before outputting.

Use this when creating complex diagrams or debugging syntax issues.
Uses @craft-agent/mermaid parser for accurate validation.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          code: {
            type: 'string',
            description: 'The mermaid diagram code to validate',
          },
        },
        required: ['code'],
      },
    },
    {
      name: 'source_oauth_trigger',
      description: `Start OAuth authentication for an MCP source.

**IMPORTANT:** After calling this tool, execution will be paused while OAuth completes.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          sourceSlug: {
            type: 'string',
            description: 'The slug of the source to authenticate',
          },
        },
        required: ['sourceSlug'],
      },
    },
    {
      name: 'source_google_oauth_trigger',
      description: `Trigger Google OAuth authentication for a Google API source (Gmail, Calendar, Drive).

**IMPORTANT:** After calling this tool, execution will be paused while OAuth completes.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          sourceSlug: {
            type: 'string',
            description: 'The slug of the Google API source to authenticate',
          },
        },
        required: ['sourceSlug'],
      },
    },
    {
      name: 'source_slack_oauth_trigger',
      description: `Trigger Slack OAuth authentication for a Slack API source.

**IMPORTANT:** After calling this tool, execution will be paused while OAuth completes.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          sourceSlug: {
            type: 'string',
            description: 'The slug of the Slack API source to authenticate',
          },
        },
        required: ['sourceSlug'],
      },
    },
    {
      name: 'source_microsoft_oauth_trigger',
      description: `Trigger Microsoft OAuth authentication for a Microsoft API source (Outlook, OneDrive, Teams).

**IMPORTANT:** After calling this tool, execution will be paused while OAuth completes.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          sourceSlug: {
            type: 'string',
            description: 'The slug of the Microsoft API source to authenticate',
          },
        },
        required: ['sourceSlug'],
      },
    },
    {
      name: 'source_credential_prompt',
      description: `Prompt the user to enter credentials for a source.

**Auth Modes:**
- bearer: Single token field (Bearer Token, API Key)
- basic: Username and Password fields
- header: API Key with custom header name
- query: API Key for query parameter auth

**IMPORTANT:** After calling this tool, execution will be paused for user input.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          sourceSlug: {
            type: 'string',
            description: 'The slug of the source to authenticate',
          },
          mode: {
            type: 'string',
            enum: ['bearer', 'basic', 'header', 'query'],
            description: 'Type of credential input',
          },
          labels: {
            type: 'object',
            description: 'Custom field labels',
            properties: {
              credential: { type: 'string' },
              username: { type: 'string' },
              password: { type: 'string' },
            },
          },
          description: {
            type: 'string',
            description: 'Description shown to user',
          },
          hint: {
            type: 'string',
            description: 'Hint about where to find credentials',
          },
          passwordRequired: {
            type: 'boolean',
            description: 'For basic auth: whether password is required (default: true)',
          },
        },
        required: ['sourceSlug', 'mode'],
      },
    },
    {
      name: 'source_test',
      description: `Validate and test a source configuration.

**Performs:**
1. Schema validation - validates config.json structure
2. Completeness check - warns about missing guide.md/icon
3. Connection test - tests if source endpoint is reachable
4. Auth status - checks if source is authenticated

**Returns:** Detailed validation report with errors and warnings.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          sourceSlug: {
            type: 'string',
            description: 'The slug of the source to test',
          },
        },
        required: ['sourceSlug'],
      },
    },
    {
      name: 'call_llm',
      description: `Invoke a secondary Claude model for focused subtasks. Use for:
- Cost optimization: haiku for simple tasks (summarization, classification)
- Structured output: guaranteed JSON schema compliance
- Extended thinking: deep reasoning for specific subtasks
- Parallel processing: call multiple times in one message - all run simultaneously
- Context isolation: process content without polluting main context

Pass file paths via 'attachments' - the tool loads content automatically.
For large files (>2000 lines), use {path, startLine, endLine} to select a portion.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          prompt: {
            type: 'string',
            description: 'Instructions for Claude',
          },
          attachments: {
            type: 'array',
            description: 'File/image paths (max 20). Use {path, startLine, endLine} for large text files.',
            items: {
              oneOf: [
                { type: 'string', description: 'Simple file path' },
                {
                  type: 'object',
                  properties: {
                    path: { type: 'string', description: 'File path' },
                    startLine: { type: 'number', description: 'First line to include (1-indexed)' },
                    endLine: { type: 'number', description: 'Last line to include (1-indexed)' },
                  },
                  required: ['path'],
                },
              ],
            },
          },
          model: {
            type: 'string',
            // TODO: Import from @craft-agent/shared/config/models when dependency is added
            enum: ['claude-opus-4-6', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'],
            description: 'Model to use. Defaults to Haiku (fastest, most cost-effective)',
          },
          systemPrompt: {
            type: 'string',
            description: 'Optional system prompt',
          },
          maxTokens: {
            type: 'number',
            description: 'Max output tokens (1-64000). Defaults to 4096',
          },
          temperature: {
            type: 'number',
            description: 'Sampling temperature 0-1. Ignored if thinking=true (forced to 1)',
          },
          thinking: {
            type: 'boolean',
            description: 'Enable extended thinking. Incompatible with outputFormat/outputSchema',
          },
          thinkingBudget: {
            type: 'number',
            description: 'Token budget for thinking (1024-100000). Defaults to 10000',
          },
          outputFormat: {
            type: 'string',
            enum: ['summary', 'classification', 'extraction', 'analysis', 'comparison', 'validation'],
            description: 'Predefined output format. Incompatible with thinking',
          },
          outputSchema: {
            type: 'object',
            description: 'Custom JSON Schema. Incompatible with thinking',
            properties: {
              type: { type: 'string', const: 'object' },
              properties: { type: 'object' },
              required: { type: 'array', items: { type: 'string' } },
            },
            required: ['type', 'properties'],
          },
        },
        required: ['prompt'],
      },
    },
  ];
}

// ============================================================
// MCP Server Setup
// ============================================================

function setupSignalHandlers(): void {
  const shutdown = (signal: string) => {
    console.error(`Session MCP Server received ${signal}, shutting down gracefully`);
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection in session MCP server:', reason);
  });
}

async function main() {
  setupSignalHandlers();

  // Parse command line arguments
  const args = process.argv.slice(2);
  let sessionId: string | undefined;
  let workspaceRootPath: string | undefined;
  let plansFolderPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--session-id' && args[i + 1]) {
      sessionId = args[i + 1];
      i++;
    } else if (args[i] === '--workspace-root' && args[i + 1]) {
      workspaceRootPath = args[i + 1];
      i++;
    } else if (args[i] === '--plans-folder' && args[i + 1]) {
      plansFolderPath = args[i + 1];
      i++;
    }
  }

  if (!sessionId || !workspaceRootPath || !plansFolderPath) {
    console.error('Usage: session-mcp-server --session-id <id> --workspace-root <path> --plans-folder <path>');
    process.exit(1);
  }

  const config: SessionConfig = {
    sessionId,
    workspaceRootPath,
    plansFolderPath,
  };

  // Create the Codex context
  const ctx = createCodexContext(config);

  // Create MCP server
  const server = new Server(
    {
      name: 'craft-agent-session',
      version: '0.3.1',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: createTools(),
  }));

  // Handle tool calls - route to shared handlers
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: toolArgs } = request.params;

    try {
      switch (name) {
        case 'SubmitPlan':
          return await handleSubmitPlan(ctx, toolArgs as { planPath: string });

        case 'config_validate':
          return await handleConfigValidate(ctx, toolArgs as { target: 'config' | 'sources' | 'statuses' | 'preferences' | 'permissions' | 'tool-icons' | 'all'; sourceSlug?: string });

        case 'skill_validate':
          return await handleSkillValidate(ctx, toolArgs as { skillSlug: string });

        case 'mermaid_validate':
          return await handleMermaidValidate(ctx, toolArgs as { code: string });

        case 'source_oauth_trigger':
          return await handleSourceOAuthTrigger(ctx, toolArgs as { sourceSlug: string });

        case 'source_google_oauth_trigger':
          return await handleGoogleOAuthTrigger(ctx, toolArgs as { sourceSlug: string });

        case 'source_slack_oauth_trigger':
          return await handleSlackOAuthTrigger(ctx, toolArgs as { sourceSlug: string });

        case 'source_microsoft_oauth_trigger':
          return await handleMicrosoftOAuthTrigger(ctx, toolArgs as { sourceSlug: string });

        case 'source_credential_prompt':
          return await handleCredentialPrompt(ctx, toolArgs as {
            sourceSlug: string;
            mode: 'bearer' | 'basic' | 'header' | 'query';
            labels?: { credential?: string; username?: string; password?: string };
            description?: string;
            hint?: string;
            passwordRequired?: boolean;
          });

        case 'source_test':
          return await handleSourceTest(ctx, toolArgs as { sourceSlug: string });

        case 'call_llm':
          return await handleCallLlm(ctx, toolArgs as {
            prompt: string;
            attachments?: Array<string | { path: string; startLine?: number; endLine?: number }>;
            model?: string;
            systemPrompt?: string;
            maxTokens?: number;
            temperature?: number;
            thinking?: boolean;
            thinkingBudget?: number;
            outputFormat?: 'summary' | 'classification' | 'extraction' | 'analysis' | 'comparison' | 'validation';
            outputSchema?: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
          });

        default:
          return errorResponse(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return errorResponse(
        `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`Session MCP Server started for session ${sessionId}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
