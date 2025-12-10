/**
 * Agentic agent definition extractor
 *
 * Uses Claude Agent SDK to agentically fetch and extract agent instructions
 * from Craft documents. Claude uses MCP tools to read the document and
 * intelligently extracts the relevant content.
 */

import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { getDefaultOptions } from '../agent/options.ts';
import type { McpServerConfig, ApiConfig, Concern } from './types.ts';
import { debug } from '../tui/utils/debug.ts';

export interface ExtractionResult {
  instructions: string;
  instructionsBlockId?: string;
  mcpServers?: McpServerConfig[];
  apis?: ApiConfig[];  // REST API configurations extracted from curl examples or docs
  info?: string[];  // Info messages for users (warnings, notices, etc.)
  concerns?: Concern[];  // Issues identified that need user clarification
  capabilities?: string[];  // Auto-generated list of key capabilities
}

export interface ExtractionProgressEvent {
  type: 'tool_start' | 'tool_complete' | 'status';
  toolName?: string;
  message: string;
}

/**
 * Format tool name into a human-readable progress message
 */
function formatToolMessage(toolName: string): string {
  if (toolName === 'mcp__craft__blocks_get') {
    return 'Reading document blocks...';
  }
  if (toolName === 'mcp__craft__document_get') {
    return 'Fetching document...';
  }
  if (toolName.startsWith('mcp__craft__')) {
    return `Running ${toolName.replace('mcp__craft__', '')}...`;
  }
  return `Running ${toolName}...`;
}

/**
 * Extract agent definition using agentic approach
 *
 * Claude will:
 * 1. Use Craft MCP tools to read the document
 * 2. Navigate the document structure as needed
 * 3. Extract and return structured JSON
 */
export async function extractAgentDefinition(
  documentId: string,
  agentName: string,
  model: string,
  mcpUrl: string,
  mcpToken?: string,
  onProgress?: (event: ExtractionProgressEvent) => void,
): Promise<ExtractionResult> {
  debug('[extractor] Starting agentic extraction for agent:', agentName, 'documentId:', documentId);

  try {
    // Configure Craft MCP server for the agent query
    const mcpServers: Options['mcpServers'] = {
      craft: {
        type: 'http',
        url: mcpUrl,
        ...(mcpToken ? { headers: { Authorization: `Bearer ${mcpToken}` } } : {}),
      },
    };

    // System prompt for the extractor agent
    const systemPrompt = `You are an agent definition extractor. You ONLY output JSON, never explanations.

Your task:
1. Use mcp__craft__blocks_get to read Craft documents
2. Extract agent instructions from the content
3. Return ONLY a JSON object - no text before or after

CRITICAL: Your final message must be ONLY valid JSON. No "Perfect!", no explanations, no markdown.
Just the raw JSON object starting with { and ending with }.`;

    const prompt = `Extract agent definition from Craft document ID "${documentId}" (agent: "${agentName}").

CRITICAL ID DISTINCTION:
- Document ID: "${documentId}" - This is the ID of the agent's document. Use this when referring to "the document" or "this document".
- Block IDs: The nested blocks inside the document have their own IDs (e.g., for Instructions subpage). Use these only when referring to specific blocks within the document.
- NEVER use a block ID when you mean the document ID. They are different!

=== INCREMENTAL LOADING STRATEGY ===

Use a conservative, step-by-step approach to minimize unnecessary data loading:

STEP 1: Get Document Outline (REQUIRED)
- Call mcp__craft__blocks_get with id="${documentId}" and maxDepth=1
- This gives you the top-level structure: document title and immediate children
- Examine the block titles/content to identify:
  * "Instructions" section (PRIORITY - this contains the agent behavior)
  * "MCP Servers" or similar sections (may contain server configs)
  * Code blocks at the top level (may contain inline configs)
  * Any section names suggesting APIs, integrations, or configurations

STEP 2: Load Instructions Content (REQUIRED if found)
- If you found an "Instructions" block in Step 1:
  * Note its block ID (this will be different from ${documentId})
  * Call mcp__craft__blocks_get with id="[instructions_block_id]" and maxDepth=2
  * This loads the full instructions content including nested subpages
- If NO "Instructions" section exists:
  * Add info message: "No Instructions section found in document."
  * The document root content may BE the instructions - use what you loaded in Step 1

STEP 3: Selectively Load Additional Sections (CONDITIONAL)
Only load additional sections if Step 1 revealed potentially relevant content:

a) MCP Server Sections:
   - If you see a section like "MCP Servers", "Servers", "Integrations", "Configuration":
     * Load that specific block with maxDepth=1 or maxDepth=2
   - If top-level code blocks exist, they may already contain server configs from Step 1

b) API Documentation Sections:
   - If you see sections like "APIs", "REST APIs", "Endpoints", "Integration Guide":
     * Load that specific block with maxDepth=2
   - Look for sections containing words: curl, fetch, API, endpoint, request

c) Code Blocks Discovery:
   - If you saw code blocks in Step 1 outline but couldn't read their content:
     * Load those specific blocks to see if they contain MCP or API configs

STEP 4: Final Pass (ONLY IF NEEDED)
- If after Steps 1-3 you still haven't found expected content:
  * You may load the full document with maxDepth=3 as a fallback
  * But ONLY do this if the incremental approach failed to find Instructions
- Most documents should NOT need this step

=== DECISION GUIDELINES ===

DO load a section if:
- It's named "Instructions" (always load this)
- It contains the word "MCP", "Server", "API", "Config", "Integration"
- It's a code block that might contain configuration
- The outline suggests it has relevant content

DO NOT load a section if:
- It's clearly unrelated (e.g., "Meeting Notes", "Archive", "Drafts")
- It's a large section with no indication of agent-relevant content
- You already have the information you need

=== EXTRACTION REQUIREMENTS ===

From the loaded content, extract:

1. INSTRUCTIONS (Primary Goal)
Extract the EXACT original instructions without modification. Critical rules:
- Do NOT prepend any identity context - that is added at runtime
- Do NOT add document IDs or agent names to the instructions
- Preserve the EXACT wording, structure, and formatting from the original document
- Fix only obvious formatting issues (e.g., broken markdown)
- Keep human-friendly references like "this document", "this page", "the Instructions section"

2. MCP SERVER CONFIGURATIONS
- Look for MCP server configurations in code blocks (YAML, JSON, or plain URLs)
- ONLY include servers with HTTP/HTTPS URLs in the mcpServers array
- if authentication type (OAuth, API token, or public) is not specified or implied by the MCP configuration, assume the server is authenticated with OAuth.
- UNSUPPORTED server types (do NOT include in mcpServers):
  * npx commands (e.g., "npx -y @modelcontextprotocol/server-filesystem")
  * command/args configs (e.g., { "command": "npx", "args": [...] })
  * stdio transports
  * Any server config without an http:// or https:// URL

3. REST API DETECTION
Look for REST API configurations. These are NOT MCP servers, but regular HTTP APIs.
Detect APIs from:
- curl examples (e.g., curl -X POST https://api.example.com/search -H "x-api-key: KEY" -d '{"query": "test"}')
- fetch() calls or axios requests
- Inline API documentation describing endpoints
- Links to API documentation pages

For each API found, extract:
- name: Short identifier (e.g., "exa", "openai") - derive from hostname if not explicit
- baseUrl: Base URL without path (e.g., "https://api.exa.ai")
- auth: Authentication config if detected:
  - type: "header" for -H "x-api-key: ...", "bearer" for -H "Authorization: Bearer ...", "query" for ?api_key=...
  - headerName: The header name for type="header" (e.g., "x-api-key")
  - queryParam: The query param for type="query" (e.g., "api_key")
- endpoints: Array of endpoints, each with:
  - name: Endpoint name derived from path (e.g., "search" from /search)
  - method: HTTP method (GET, POST, etc.)
  - path: Path relative to baseUrl (e.g., "/search")
  - description: CRITICAL - Write a rich, actionable description that helps Claude use this endpoint effectively:
    * Start with what the endpoint DOES (not just its name)
    * Explain WHEN to use it (use cases, scenarios)
    * List KEY PARAMETERS with their purpose and valid values
    * PAGINATION/LIMITS ARE CRITICAL: Always prominently mention any limit/count/numResults parameters. Large responses can overwhelm context. Recommend conservative defaults (e.g., "numResults: 1-100, default 10, START WITH 5-10 to avoid huge responses")
    * Include any important CONSTRAINTS (rate limits, max results, etc.)
    * Mention RELATED endpoints if relevant
    BAD: "Search the Exa API"
    GOOD: "Search the web using Exa's neural search engine. Use this for finding recent articles, research papers, news, or any web content. Key parameters: query (search string), numResults (1-100, default 10, START WITH 5-10 to avoid huge responses), type ('neural' for semantic search, 'keyword' for exact match), category (optional: 'news', 'research paper', 'company', 'github'). Returns URLs, titles, and snippets. For full page content, follow up with exa_contents using the returned URLs."
  - exampleParams: Example request body extracted from curl -d or request body (as object, not string)

4. INFO MESSAGES
Use the "info" array to communicate important information to the user. You MUST add info messages for:
- Unsupported MCP servers: "MCP server '[name]' uses npx/stdio which is not supported. Only HTTP/HTTPS servers work."
- Missing or empty Instructions section: "No Instructions section found in document."
- Malformed or unparseable MCP configs: "Could not parse MCP server config in code block."
- APIs found: "Found API '[name]' with [N] endpoints."
- Unsupported automation features (see below): Add info message explaining the limitation
- Any other issues or warnings the user should know about during agent setup

PLATFORM LIMITATIONS - IMPORTANT:
This is an interactive CLI tool. It CANNOT:
- Run automatically or on a schedule (no cron, no background tasks)
- Wake up or trigger itself (no webhooks, no event listeners)
- Run continuously in the background
- Send notifications or alerts proactively
- Set or schedule reminders
- Monitor things over time without user interaction

If the instructions mention ANY of these features, add an info message like:
"Note: '[feature]' requires automation/scheduling which is not supported. This agent only responds when you interact with it."

EXTERNAL SERVICE INTEGRATIONS:
If instructions mention external services (email, Slack, Discord, GitHub, calendar, etc.) that aren't already configured:
- Add info: "To enable [service] integration, add an API config (curl examples or API docs) or MCP server config as a code block in this document."
- Common examples:
  * Email: "To send emails, add an API config for SendGrid, Resend, or similar email service."
  * Slack/Discord: "To post messages, add a Slack/Discord API config or MCP server."
  * GitHub: "To interact with GitHub, add the GitHub API or an MCP server config."
- Do NOT treat missing integrations as concerns - just provide helpful guidance.

Do NOT create concerns or ask questions about these limitations - they cannot be resolved. Just inform the user.

5. CAPABILITIES SUMMARY
Analyze the instructions and extract a list of 3-8 key capabilities this agent has.
Each capability should be a concise phrase (5-15 words) describing what the agent can do.
Examples: "Search the web using Exa neural search", "Create and edit Craft documents", "Write and debug TypeScript code"

6. CONCERNS EXTRACTION - BE SELECTIVE
ONLY extract concerns that are ACTUAL issues that could prevent the agent from working correctly.
DO NOT include trivial, obvious, or non-actionable items. Quality over quantity.

CRITICAL: Concerns must be based on EXISTING content in the document.
- If no Instructions section is found, DO NOT create concerns asking "What should this agent do?"
- If instructions are empty or minimal, DO NOT suggest general capabilities or features
- Suggested answers must NEVER imply new functionality not already in the document
- A concern is about CLARIFYING existing content, not ADDING new content

When NO instructions are found:
- Return empty concerns array []
- Use the info array to notify: "No Instructions section found in document."
- The user can add instructions themselves - do not prompt them with suggestions

Types:
1. CONFUSING: Instructions that could genuinely be interpreted multiple ways
2. CONFLICTING: Clear contradictions that need resolution
3. MISSING: Critical info WITHOUT which existing functionality cannot work
4. GENERAL: Significant risks or issues (not minor edge cases)

For each concern, include:
- type: One of the four types above
- description: Concise explanation of the actual issue
- context: The relevant text from instructions (if applicable)
- suggestedQuestion: A clear question to ask the user
- suggestedAnswers: Array of 2-4 MEANINGFUL pre-defined answers (MAX 4, user can always type custom)
  Examples:
  - For "Which API version?" → ["v1 (stable)", "v2 (latest features)", "Both with fallback"]
  - For "When to confirm deletions?" → ["Always", "Only for important items", "Never"]
  Skip suggestedAnswers if no logical options exist (open-ended questions).
  IMPORTANT: Maximum 4 suggested answers. The UI always shows a "Custom" option for free-form input.

If instructions are clear and complete, return empty concerns array []. Do NOT invent concerns.

REMEMBER: "${documentId}" is the DOCUMENT ID. The instructionsBlockId will be a DIFFERENT number (the block ID of the Instructions subpage within the document).

=== OUTPUT FORMAT ===

Return ONLY valid JSON:
{
  "instructions": "[EXACT instruction content from document - no identity prefix added]",
  "instructionsBlockId": "[block ID of Instructions subpage, NOT ${documentId}]",
  "mcpServers": [{ "name": "myserver", "url": "https://example.com/mcp", "requiresAuth": false }],
  "apis": [{
    "name": "exa",
    "baseUrl": "https://api.exa.ai",
    "description": "Exa AI search API for finding web content",
    "auth": { "type": "header", "headerName": "x-api-key" },
    "endpoints": [{
      "name": "search",
      "method": "POST",
      "path": "/search",
      "description": "Search the web using Exa's neural search engine...",
      "exampleParams": { "query": "search query", "numResults": 10 }
    }]
  }],
  "info": ["Found API 'exa' with 1 endpoint."],
  "capabilities": ["Search the web using Exa neural search", "Process and analyze search results"],
  "concerns": [{
    "type": "confusing",
    "description": "Unclear when to use neural vs keyword search",
    "context": "type ('neural' for semantic search, 'keyword' for exact match)",
    "suggestedQuestion": "When should I use neural search vs keyword search?",
    "suggestedAnswers": ["Always use neural search", "Use keyword for exact phrases, neural otherwise", "Ask user each time"]
  }]
}

Rules:
- mcpServers: Empty array [] if no HTTP/HTTPS MCP servers found
- apis: Empty array [] if no REST APIs found. Include APIs even if only one endpoint is detected.
- info: Empty array [] if nothing to report. MUST contain messages for any issues, warnings, or important information.
- capabilities: List of 3-8 key capabilities. Empty array [] if instructions are empty.
- concerns: Empty array [] if instructions are clear and complete. Do NOT invent concerns.
- instructions: Empty string "" if document is empty or not found`;

    const options: Options = {
      ...getDefaultOptions(),
      model: model || 'claude-sonnet-4-20250514',
      systemPrompt,
      mcpServers,
      maxTurns: 10, // Allow multiple tool calls if needed
      // Use Claude Code toolset for full capabilities
      tools: { type: 'preset', preset: 'claude_code' },
      // Allow all tools without permission prompts
      permissionMode: 'acceptEdits',
      canUseTool: async (_toolName, input) => {
        return { behavior: 'allow' as const, updatedInput: input as Record<string, unknown> };
      },
      // Capture stderr from SDK subprocess for debugging
      stderr: (data: string) => {
        debug('[extractor] SDK stderr:', data);
      },
      // Structured output guarantees valid JSON matching schema
      outputFormat: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            instructions: {
              type: 'string',
              description: 'The complete agent instructions, prepended with agent identity context',
            },
            instructionsBlockId: {
              type: 'string',
              description: 'Block ID of the instructions section for self-modification',
            },
            mcpServers: {
              type: 'array',
              description: 'MCP server configurations found in the document',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  url: { type: 'string' },
                  requiresAuth: { type: 'boolean' },
                },
              },
            },
            apis: {
              type: 'array',
              description: 'REST APIs detected from curl examples or documentation',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Short name like "exa", "openai"' },
                  baseUrl: { type: 'string', description: 'Base URL without path' },
                  description: { type: 'string' },
                  auth: {
                    type: 'object',
                    properties: {
                      type: { type: 'string', enum: ['header', 'bearer', 'query'] },
                      headerName: { type: 'string', description: 'Header name for type=header' },
                      queryParam: { type: 'string', description: 'Query param for type=query' },
                    },
                  },
                  endpoints: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string', description: 'Endpoint name, e.g., "search"' },
                        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
                        path: { type: 'string', description: 'Path like "/search"' },
                        description: {
                          type: 'string',
                          description: 'CRITICAL: Rich description explaining what this endpoint does, when to use it, key parameters with valid values, constraints, and related endpoints. This becomes the tool description that helps Claude use the API effectively.',
                        },
                        exampleParams: { type: 'object', description: 'Example request body' },
                      },
                      required: ['name', 'method', 'path', 'description'],
                    },
                  },
                },
                required: ['name', 'baseUrl', 'endpoints'],
              },
            },
            info: {
              type: 'array',
              description: 'User-facing info messages about the extraction (warnings, notices, etc.)',
              items: { type: 'string' },
            },
            capabilities: {
              type: 'array',
              description: 'List of 3-8 key capabilities this agent has',
              items: { type: 'string' },
            },
            concerns: {
              type: 'array',
              description: 'Concerns identified during extraction that need user clarification',
              items: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['confusing', 'conflicting', 'missing', 'general'],
                    description: 'Type of concern',
                  },
                  description: {
                    type: 'string',
                    description: 'Concise explanation of the actual issue',
                  },
                  context: {
                    type: 'string',
                    description: 'Relevant text from instructions',
                  },
                  suggestedQuestion: {
                    type: 'string',
                    description: 'Clear question to ask the user',
                  },
                  suggestedAnswers: {
                    type: 'array',
                    items: { type: 'string' },
                    maxItems: 4,
                    description: 'Max 4 meaningful pre-defined answers if logical choices exist',
                  },
                },
                required: ['type', 'description'],
              },
            },
          },
          required: ['instructions', 'instructionsBlockId'],
        },
      },
    };

    debug('[extractor] Running agentic query with MCP URL:', mcpUrl);

    // Run agentic query - Claude will use MCP tools to read the document
    let result: ExtractionResult | null = null;

    for await (const message of query({ prompt, options })) {
      // Log tool usage for debugging and emit progress events
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            debug('[extractor] Tool call:', block.name, JSON.stringify(block.input));

            // Emit progress event
            debug('[extractor] Emitting progress event for tool:', block.name);
            onProgress?.({
              type: 'tool_start',
              toolName: block.name,
              message: formatToolMessage(block.name),
            });
          }
        }
      }

      // Log result message details
      if (message.type === 'result') {
        debug('[extractor] Result message subtype:', message.subtype);
        debug('[extractor] Result message has structured_output:', 'structured_output' in message);
        if (message.subtype === 'success') {
          debug('[extractor] Success result:', message.result);
          debug('[extractor] structured_output:', message.structured_output);
        } else {
          debug('[extractor] Error result, errors:', (message as any).errors);
        }
      }

      // Access structured output from result message
      if (message.type === 'result' && message.subtype === 'success') {
        if (message.structured_output) {
          // SDK parsed it for us
          debug('[extractor] Got structured_output from SDK');
          result = message.structured_output as ExtractionResult;
        } else if (message.result) {
          // Fallback: parse the result text (SDK may not populate structured_output with claude_code preset)
          debug('[extractor] Falling back to parsing result text');
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
            result = JSON.parse(jsonText) as ExtractionResult;
            debug('[extractor] Parsed result text successfully');
          } catch (parseError) {
            debug('[extractor] Failed to parse result text:', parseError);
          }
        }
      }
    }

    if (!result) {
      debug('[extractor] No structured output received');
      return { instructions: '', mcpServers: [], apis: [], concerns: [], capabilities: [] };
    }

    debug(
      '[extractor] Extracted',
      result.instructions?.length || 0,
      'chars of instructions,',
      result.mcpServers?.length || 0,
      'MCP servers,',
      result.apis?.length || 0,
      'APIs,',
      result.info?.length || 0,
      'info messages,',
      result.capabilities?.length || 0,
      'capabilities,',
      result.concerns?.length || 0,
      'concerns',
    );

    return {
      instructions: result.instructions || '',
      instructionsBlockId: result.instructionsBlockId || undefined,
      mcpServers: result.mcpServers || [],
      apis: result.apis || [],
      info: result.info || [],
      concerns: result.concerns || [],
      capabilities: result.capabilities || [],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    debug('[extractor] Agentic extraction failed:', errorMessage);
    debug('[extractor] Error stack:', error instanceof Error ? error.stack : 'no stack');
    return {
      instructions: '',
      mcpServers: [],
      apis: [],
      concerns: [],
      capabilities: [],
    };
  }
}
