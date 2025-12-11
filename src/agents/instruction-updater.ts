/**
 * Agentic instruction updater
 *
 * Uses Claude Agent SDK to intelligently update agent instructions
 * in Craft documents. The embedded query reads the current document,
 * compares with the requested change, and writes back the update.
 */

import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { getDefaultOptions } from '../agent/options.ts';
import { getWorkspaceAccessTokenAsync } from '../config/storage.ts';
import { debug } from '../tui/utils/debug.ts';
import { INSTRUCTION_UPDATE_MODEL } from '../config/models.ts';

export interface UpdateInstructionsContext {
  /** The Craft document ID containing the agent definition */
  documentId: string;
  /** Block ID of the Instructions section (for targeting updates) */
  instructionsBlockId?: string;
  /** Current agent instructions (may be out of date vs document) */
  currentInstructions: string;
  /** Agent name for context */
  agentName: string;
  /** MCP server URL */
  mcpUrl: string;
  /** Workspace ID (for fetching fresh tokens) */
  workspaceId: string;
  /** Model to use for the embedded query */
  model: string;
}

export interface UpdateInstructionsResult {
  success: boolean;
  message: string;
  /** What was actually updated (for confirmation) */
  updatedContent?: string;
}

/** Progress events emitted during agentic instruction update */
export interface UpdateInstructionsProgressEvent {
  type: 'tool_start' | 'tool_complete' | 'status';
  toolName?: string;
  message: string;
}

/**
 * Format a tool name into a user-friendly progress message
 */
function formatToolProgressMessage(toolName: string): string {
  // Handle MCP tools (mcp__craft__blocks_get -> "Reading document...")
  if (toolName.includes('blocks_get')) {
    return 'Reading document structure...';
  }
  if (toolName.includes('blocks_update') || toolName.includes('markdown_add') || toolName.includes('markdown_replace')) {
    return 'Writing update to document...';
  }
  if (toolName.includes('blocks_add')) {
    return 'Adding content to document...';
  }
  // Default: clean up the tool name
  const cleanName = toolName.replace(/^mcp__\w+__/, '').replace(/_/g, ' ');
  return `Running ${cleanName}...`;
}

/**
 * Agentically update agent instructions in a Craft document
 *
 * This function:
 * 1. Uses an embedded Claude query with Craft MCP access
 * 2. Reads the current document content (source of truth)
 * 3. Compares with the requested update
 * 4. Intelligently writes back the update to the appropriate location
 */
export async function updateAgentInstructions(
  requestedUpdate: string,
  context: UpdateInstructionsContext,
  onProgress?: (event: UpdateInstructionsProgressEvent) => void,
): Promise<UpdateInstructionsResult> {
  debug('[instruction-updater] Starting agentic update for agent:', context.agentName);
  debug('[instruction-updater] Document ID:', context.documentId);
  debug('[instruction-updater] Instructions block ID:', context.instructionsBlockId || 'none');
  debug('[instruction-updater] Requested update:', requestedUpdate.substring(0, 100) + '...');

  try {
    // Fetch fresh token for the workspace
    const { authType, token: mcpToken } = await getWorkspaceAccessTokenAsync(context.workspaceId);
    if (authType !== 'public' && !mcpToken) {
      throw new Error('No authentication credentials found for workspace. Please re-add the workspace.');
    }
    debug('[instruction-updater] Got fresh token:', mcpToken ? 'yes' : 'no');

    // Configure Craft MCP server for the embedded query
    const mcpServers: Options['mcpServers'] = {
      craft: {
        type: 'http',
        url: context.mcpUrl,
        ...(mcpToken ? { headers: { Authorization: `Bearer ${mcpToken}` } } : {}),
      },
    };

    // System prompt for the updater agent
    const systemPrompt = `You are an agent instruction updater. Your task is to update agent instructions in a Craft document.

You have access to Craft MCP tools to read and modify documents:
IMPORTANT: You ONLY output JSON at the end. Any tool calls should be made, then return a final JSON result.`;

    // Build the detailed prompt with all context
    const prompt = `Update the agent instructions based on the following information:

### Context
You are updating instructions for an agent named "${context.agentName}".
- The agent's instructions are defined in Craft document ID: ${context.documentId}
${context.instructionsBlockId ? `- The Instructions section is in block ID: ${context.instructionsBlockId}` : '- The instructions are likely not in a dedicated subpage (eg may be on the root page, at the top), you will need to find them in the document.'}

### Requested Update or Learning
The user wants to add/update the following:
\`\`\`
${requestedUpdate}
\`\`\`

### Current Agent Instructions (Reference Only)
These are the currently loaded instructions. Note: They may be OUT OF DATE compared to the document content
Use this only as a reference to understand the structure (and the context of the change), NOT as source of truth.
\`\`\`
${context.currentInstructions}
\`\`\`

### Sources of Truth
1. **Document content** (read via MCP) = PRIMARY source of truth, except for the requested change
2. **Requested update** = Source of truth for what should change
3. **Current agent instructions above** = Reference ONLY, may be out of date

### Your Task
1. First, READ the current document content using blocks_get:
   - Call with id="${context.documentId}", format=markdown, depth: 1 to understand the top level structure
   - If an Instructions page exists, read its content ${context.instructionsBlockId ? ` (block ID: ${context.instructionsBlockId})` : ''}

2. If the document DOES NOT EXIST:
   - Do NOT try to create it or fall back to alternatives
   - Return a result explaining what was found (or not found)

2b. If you can't find any existing AI/Agent instructions in the document
   - Do NOT apply the change
   - Return a result explaining what was found (or not found)

3. If the document EXISTS, intelligently update it:
   - Compare the current document content with the requested update
   - Decide WHERE to place the update (append to end, add to a specific section, replace a part etc.)
   - Use the appropriate MCP tool to write the update:
   - Preserve existing content - only add/modify what's needed

4. Return a JSON result with:
   - success: boolean
   - message: Human-readable description of what was done
   - updatedContent: The content that was added/modified (if successful)

### Output Format
After completing your work, return ONLY valid JSON:
{
  "success": true,
  "message": "Added learning to the Instructions section.",
  "updatedContent": "The content that was added..."
}

Or if something went wrong:
{
  "success": false,
  "message": "Could not find Instructions section in document ID ${context.documentId}."
}`;

    const options: Options = {
      ...getDefaultOptions(),
      model: context.model || INSTRUCTION_UPDATE_MODEL,
      systemPrompt,
      mcpServers,
      maxTurns: 10, // Allow multiple tool calls
      tools: { type: 'preset', preset: 'claude_code' },
      permissionMode: 'acceptEdits',
      canUseTool: async (_toolName, input) => {
        return { behavior: 'allow' as const, updatedInput: input as Record<string, unknown> };
      },
      // Structured output for reliable JSON
      outputFormat: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              description: 'Whether the update was successful',
            },
            message: {
              type: 'string',
              description: 'Human-readable description of what happened',
            },
            updatedContent: {
              type: 'string',
              description: 'The content that was added or modified (if successful)',
            },
          },
          required: ['success', 'message'],
        },
      },
    };

    debug('[instruction-updater] Running embedded query...');

    // Run the embedded query
    let result: UpdateInstructionsResult | null = null;

    for await (const message of query({ prompt, options })) {
      // Log tool usage for debugging and emit progress events
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            debug('[instruction-updater] Tool call:', block.name, JSON.stringify(block.input));
            // Emit progress event for tool start
            onProgress?.({
              type: 'tool_start',
              toolName: block.name,
              message: formatToolProgressMessage(block.name),
            });
          }
        }
      }

      // Extract result from success message
      if (message.type === 'result' && message.subtype === 'success') {
        if (message.structured_output) {
          debug('[instruction-updater] Got structured_output from SDK');
          result = message.structured_output as UpdateInstructionsResult;
        } else if (message.result) {
          // Fallback: parse the result text
          debug('[instruction-updater] Falling back to parsing result text');
          try {
            let jsonText = message.result.trim();
            // Handle markdown code blocks
            if (jsonText.startsWith('```')) {
              const openMatch = jsonText.match(/^```(?:json)?\s*\n?/);
              if (openMatch) {
                const contentStart = openMatch[0].length;
                const lastFenceIndex = jsonText.lastIndexOf('\n```');
                const endFenceIndex = jsonText.endsWith('```') ? jsonText.length - 3 : lastFenceIndex + 1;
                if (endFenceIndex > contentStart) {
                  jsonText = jsonText.slice(contentStart, endFenceIndex).trim();
                }
              }
            }
            result = JSON.parse(jsonText) as UpdateInstructionsResult;
          } catch (parseError) {
            debug('[instruction-updater] Failed to parse result:', parseError);
          }
        }
      }
    }

    if (!result) {
      debug('[instruction-updater] No result received from embedded query');
      return {
        success: false,
        message: 'Failed to get a response from the instruction updater.',
      };
    }

    debug('[instruction-updater] Result:', result);
    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    debug('[instruction-updater] Error:', errorMessage);
    return {
      success: false,
      message: `Failed to update instructions: ${errorMessage}`,
    };
  }
}
