/**
 * Session Tool Definitions — Single Source of Truth
 *
 * Canonical Zod schemas, descriptions, and handler registry for all
 * session-scoped tools. Consumers derive what they need:
 *
 * - Claude SDK  → `.shape` extracts the plain `{ key: z.string() }` literal
 * - MCP / Pi    → `getToolDefsAsJsonSchema()` auto-converts to JSON Schema
 *
 * Adding a new tool: define the schema, description, handler import, and
 * one entry in SESSION_TOOL_DEFS.
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { SessionToolContext } from './context.ts';
import type { ToolResult } from './types.ts';

// Handlers
import { handleSubmitPlan } from './handlers/submit-plan.ts';
import { handleConfigValidate } from './handlers/config-validate.ts';
import { handleSkillValidate } from './handlers/skill-validate.ts';
import { handleMermaidValidate } from './handlers/mermaid-validate.ts';
import { handleSourceTest } from './handlers/source-test.ts';
import {
  handleSourceOAuthTrigger,
  handleGoogleOAuthTrigger,
  handleSlackOAuthTrigger,
  handleMicrosoftOAuthTrigger,
} from './handlers/source-oauth.ts';
import { handleCredentialPrompt } from './handlers/credential-prompt.ts';
import { handleUpdatePreferences } from './handlers/update-preferences.ts';
import { handleTransformData } from './handlers/transform-data.ts';
import { handleRenderTemplate } from './handlers/render-template.ts';

// ============================================================
// Canonical Zod Schemas
// ============================================================

export const SubmitPlanSchema = z.object({
  planPath: z.string().describe('Absolute path to the plan markdown file you wrote'),
});

export const ConfigValidateSchema = z.object({
  target: z.enum(['config', 'sources', 'statuses', 'preferences', 'permissions', 'automations', 'tool-icons', 'all'])
    .describe('Which config file(s) to validate'),
  sourceSlug: z.string().optional().describe('Validate a specific source by slug'),
});

export const SkillValidateSchema = z.object({
  skillSlug: z.string().describe('The slug of the skill to validate'),
});

export const MermaidValidateSchema = z.object({
  code: z.string().describe('The mermaid diagram code to validate'),
  render: z.boolean().optional().describe('Also attempt to render (catches layout errors)'),
});

export const SourceTestSchema = z.object({
  sourceSlug: z.string().describe('The slug of the source to test'),
});

export const SourceOAuthTriggerSchema = z.object({
  sourceSlug: z.string().describe('The slug of the source to authenticate'),
});

export const CredentialPromptSchema = z.object({
  sourceSlug: z.string().describe('The slug of the source to authenticate'),
  mode: z.enum(['bearer', 'basic', 'header', 'query', 'multi-header']).describe('Type of credential input'),
  labels: z.object({
    credential: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
  }).optional().describe('Custom field labels'),
  description: z.string().optional().describe('Description shown to user'),
  hint: z.string().optional().describe('Hint about where to find credentials'),
  headerNames: z.array(z.string()).optional().describe('Header names for multi-header auth (e.g., ["DD-API-KEY", "DD-APPLICATION-KEY"])'),
  passwordRequired: z.boolean().optional().describe('For basic auth: whether password is required'),
});

export const CallLlmSchema = z.object({
  prompt: z.string().describe('Instructions for the LLM'),
  attachments: z.array(z.union([
    z.string().describe('Simple file path'),
    z.object({
      path: z.string().describe('File path'),
      startLine: z.number().optional().describe('First line (1-indexed)'),
      endLine: z.number().optional().describe('Last line (1-indexed)'),
    }),
  ])).optional().describe('File paths on disk to attach (max 20). NOT for inline text — put text in prompt instead. Use {path, startLine, endLine} for large files.'),
  model: z.string().optional().describe('Model ID or short name. Defaults to a fast model.'),
  systemPrompt: z.string().optional().describe('Optional system prompt'),
  maxTokens: z.number().optional().describe('Max output tokens (1-64000). Defaults to 4096'),
  temperature: z.number().optional().describe('Sampling temperature 0-1'),
  thinking: z.boolean().optional().describe('Enable extended thinking. Incompatible with outputFormat/outputSchema'),
  thinkingBudget: z.number().optional().describe('Token budget for thinking (1024-100000). Defaults to 10000'),
  outputFormat: z.enum(['summary', 'classification', 'extraction', 'analysis', 'comparison', 'validation']).optional()
    .describe('Predefined output format'),
  outputSchema: z.object({
    type: z.literal('object'),
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()).optional(),
  }).optional().describe('Custom JSON Schema for structured output'),
});

export const UpdatePreferencesSchema = z.object({
  name: z.string().optional().describe("The user's preferred name or how they'd like to be addressed"),
  timezone: z.string().optional().describe("The user's timezone in IANA format (e.g., 'America/New_York', 'Europe/London')"),
  city: z.string().optional().describe("The user's city"),
  region: z.string().optional().describe("The user's state/region/province"),
  country: z.string().optional().describe("The user's country"),
  language: z.string().optional().describe("The user's preferred language for responses"),
  notes: z.string().optional().describe('Additional notes about the user that would be helpful to remember (preferences, context, etc.). Replaces any existing notes.'),
});

export const TransformDataSchema = z.object({
  language: z.enum(['python3', 'node', 'bun']).describe('Script runtime to use'),
  script: z.string().describe('Transform script source code. Receives input file paths as command-line args (sys.argv[1:] or process.argv.slice(2)), last arg is the output file path.'),
  inputFiles: z.array(z.string()).describe('Input file paths relative to session dir (e.g., "long_responses/stripe_txns.txt")'),
  outputFile: z.string().describe('Output file name relative to session data/ dir (e.g., "transactions.json")'),
});

export const RenderTemplateSchema = z.object({
  source: z.string().describe('Source slug (e.g., "linear", "gmail")'),
  template: z.string().describe('Template ID (e.g., "issue-detail", "issue-list")'),
  data: z.record(z.string(), z.unknown()).describe('JSON data to render into the template'),
});

// Browser tool schemas (backend-specific — requires BrowserPaneManager in Electron)
export const BrowserOpenSchema = z.object({});

export const BrowserNavigateSchema = z.object({
  url: z.string().describe('URL to navigate to (e.g., "https://example.com" or "example.com")'),
});

export const BrowserClickSchema = z.object({
  ref: z.string().describe('Element ref from browser_snapshot (e.g., "@e1")'),
  waitFor: z.enum(['none', 'navigation', 'network-idle']).optional().describe('Optional wait mode after click'),
  timeoutMs: z.number().optional().describe('Optional wait timeout in milliseconds for waitFor modes'),
});

export const BrowserFillSchema = z.object({
  ref: z.string().describe('Element ref from browser_snapshot (e.g., "@e5")'),
  value: z.string().describe('Text to type into the element'),
});

export const BrowserSelectSchema = z.object({
  ref: z.string().describe('Element ref from browser_snapshot (e.g., "@e3")'),
  value: z.string().describe('Option value to select'),
});

export const BrowserScrollSchema = z.object({
  direction: z.enum(['up', 'down', 'left', 'right']).describe('Scroll direction'),
  amount: z.number().optional().describe('Scroll amount in pixels (default: 500)'),
});

export const BrowserEvaluateSchema = z.object({
  expression: z.string().describe('JavaScript expression to evaluate in the page context'),
});

export const BrowserToolSchema = z.object({
  command: z.string().describe('CLI-like browser command (e.g., "navigate https://example.com", "click @e1", "--help")'),
});

export const BrowserSnapshotSchema = z.object({});
export const BrowserScreenshotSchema = z.object({
  mode: z.enum(['raw', 'agent']).optional().describe('Capture mode. raw=plain screenshot, agent=adds semantic annotations and metadata'),
  refs: z.array(z.string()).optional().describe('Element refs from browser_snapshot to annotate'),
  includeLastAction: z.boolean().optional().describe('Include last browser action target when available'),
  includeMetadata: z.boolean().optional().describe('Include compact metadata overlay and metadata payload in response text'),
});
export const BrowserScreenshotRegionSchema = z.object({
  x: z.number().optional().describe('Region left coordinate in pixels (coordinate mode)'),
  y: z.number().optional().describe('Region top coordinate in pixels (coordinate mode)'),
  width: z.number().positive().optional().describe('Region width in pixels (coordinate mode, > 0)'),
  height: z.number().positive().optional().describe('Region height in pixels (coordinate mode, > 0)'),
  ref: z.string().min(1).optional().describe('Element ref from browser_snapshot (ref mode)'),
  selector: z.string().min(1).optional().describe('CSS selector for target element (selector mode)'),
  padding: z.number().optional().describe('Optional padding around the target in pixels'),
});
export const BrowserConsoleSchema = z.object({
  level: z.enum(['all', 'log', 'info', 'warn', 'error']).optional().describe('Filter by console level. all includes every level.'),
  limit: z.number().optional().describe('Maximum number of recent entries to return (default: 50)'),
});
export const BrowserWindowResizeSchema = z.object({
  width: z.number().describe('Viewport width in pixels'),
  height: z.number().describe('Viewport height in pixels'),
});
export const BrowserNetworkSchema = z.object({
  limit: z.number().optional().describe('Maximum number of entries to return (default: 50)'),
  status: z.enum(['all', 'failed', '2xx', '3xx', '4xx', '5xx']).optional().describe('Status filter for network entries'),
  method: z.string().optional().describe('Optional HTTP method filter (e.g., GET, POST)'),
  resourceType: z.string().optional().describe('Optional resource type filter (e.g., xhr, fetch, document)'),
});
export const BrowserWaitSchema = z.object({
  kind: z.enum(['selector', 'text', 'url', 'network-idle']).describe('Condition kind to wait for'),
  value: z.string().optional().describe('Condition value for selector/text/url waits'),
  timeoutMs: z.number().optional().describe('Wait timeout in milliseconds (default: 10000)'),
  pollMs: z.number().optional().describe('Polling interval for selector/text/url waits (default: 100)'),
  idleMs: z.number().optional().describe('Idle window for network-idle waits (default: 700)'),
});
export const BrowserKeySchema = z.object({
  key: z.string().describe('Key to send (e.g., Enter, Escape, k)'),
  modifiers: z.array(z.enum(['shift', 'control', 'alt', 'meta'])).optional().describe('Optional modifier keys'),
});
export const BrowserDownloadsSchema = z.object({
  action: z.enum(['list', 'wait']).optional().describe('list returns recent downloads, wait waits for terminal state first'),
  limit: z.number().optional().describe('Maximum entries for list action (default: 20)'),
  timeoutMs: z.number().optional().describe('Wait timeout for wait action (default: 10000)'),
});
export const BrowserBackSchema = z.object({});
export const BrowserForwardSchema = z.object({});

export const SpawnSessionSchema = z.object({
  help: z.boolean().optional().describe('If true, returns available connections, models, and sources instead of creating a session'),
  prompt: z.string().optional().describe('Instructions for the new session (required when not in help mode)'),
  name: z.string().optional().describe('Session name'),
  llmConnection: z.string().optional().describe('Connection slug (e.g., "anthropic-api", "codex")'),
  model: z.string().optional().describe('Model ID override'),
  enabledSourceSlugs: z.array(z.string()).optional().describe('Source slugs to enable in the new session'),
  permissionMode: z.enum(['safe', 'ask', 'allow-all']).optional().describe('Permission mode for the new session'),
  labels: z.array(z.string()).optional().describe('Labels for the new session'),
  workingDirectory: z.string().optional().describe('Working directory for the new session'),
  attachments: z.array(z.object({
    path: z.string().describe('Absolute file path on disk'),
    name: z.string().optional().describe('Display name (defaults to file basename)'),
  })).optional().describe('Files to include with the prompt'),
});

// ============================================================
// Canonical Tool Descriptions (base — no DOC_REFS)
// ============================================================

export const TOOL_DESCRIPTIONS = {
  SubmitPlan: `Submit a plan for user review.

Call this after you have written your plan to a markdown file using the Write tool.
The plan will be displayed to the user in a special formatted view.

**IMPORTANT:** After calling this tool:
- Execution will be **automatically paused** to present the plan to the user
- No further tool calls or text output will be processed after this tool returns
- The conversation will resume when the user responds (accept, modify, or reject the plan)
- Do NOT include any text or tool calls after SubmitPlan - they will not be executed`,

  config_validate: `Validate Craft Agent configuration files.

Use this after editing configuration files to check for errors before they take effect.
Returns structured validation results with errors, warnings, and suggestions.

**Targets:**
- \`config\`: Validates config.json (workspaces, model, settings)
- \`sources\`: Validates all source config.json files
- \`statuses\`: Validates statuses config.json
- \`preferences\`: Validates preferences.json
- \`permissions\`: Validates permissions.json files
- \`automations\`: Validates automations.json configuration
- \`tool-icons\`: Validates tool-icons.json
- \`all\`: Validates all configuration files`,

  skill_validate: `Validate a skill's SKILL.md file.

Checks:
- Slug format (lowercase alphanumeric with hyphens)
- SKILL.md exists and is readable
- YAML frontmatter is valid with required fields (name, description)
- Content is non-empty after frontmatter
- Icon format if present (svg/png/jpg)`,

  mermaid_validate: `Validate Mermaid diagram syntax before outputting.

Use this when:
- Creating complex diagrams with many nodes/relationships
- Unsure about syntax for a specific diagram type
- Debugging a diagram that failed to render

Returns validation result with specific error messages if invalid.`,

  source_test: `Validate and test a source configuration.

**This tool performs:**
1. **Schema validation**: Validates config.json structure
2. **Icon handling**: Checks/downloads icon if configured
3. **Completeness check**: Warns about missing guide.md/icon/tagline
4. **Connection test**: Tests if the source is reachable
5. **Auth status**: Checks if source is authenticated`,

  source_oauth_trigger: `Start OAuth authentication for an MCP source.

This tool initiates the OAuth 2.0 + PKCE flow for sources that require authentication.

**Prerequisites:**
- Source must exist in the current workspace
- Source must be type 'mcp' with authType 'oauth'
- Source must have a valid MCP URL

**IMPORTANT:** After calling this tool, execution will be paused while OAuth completes.`,

  source_google_oauth_trigger: `Trigger Google OAuth authentication for a Google API source.

Opens a browser window for the user to sign in with their Google account.

**Supported services:** Gmail, Calendar, Drive

**IMPORTANT:** After calling this tool, execution will be paused while OAuth completes.`,

  source_slack_oauth_trigger: `Trigger Slack OAuth authentication for a Slack API source.

Opens a browser window for the user to sign in with their Slack account.

**IMPORTANT:** After calling this tool, execution will be paused while OAuth completes.`,

  source_microsoft_oauth_trigger: `Trigger Microsoft OAuth authentication for a Microsoft API source.

Opens a browser window for the user to sign in with their Microsoft account.

**Supported services:** Outlook, Calendar, OneDrive, Teams, SharePoint

**IMPORTANT:** After calling this tool, execution will be paused while OAuth completes.`,

  source_credential_prompt: `Prompt the user to enter credentials for a source.

Use this when a source requires authentication that isn't OAuth.
The user will see a secure input UI with appropriate fields based on the auth mode.

**Auth Modes:**
- \`bearer\`: Single token field (Bearer Token, API Key)
- \`basic\`: Username and Password fields
- \`header\`: API Key with custom header name shown
- \`query\`: API Key for query parameter auth
- \`multi-header\`: Multiple API keys with custom header names

**IMPORTANT:** After calling this tool, execution will be paused for user input.`,

  update_user_preferences: `Update stored user preferences. Use this when you learn information about the user that would be helpful to remember for future conversations. This includes their name, timezone, location, preferred language, or any other relevant notes. Only update fields you have confirmed information about - don't guess.`,

  transform_data: `Transform data files using a script and write structured output for datatable/spreadsheet blocks, or extract HTML content for html-preview blocks.

Use this tool when you need to transform large datasets (20+ rows) into structured JSON for display, or extract/decode HTML content for rendering. Write a transform script that reads the input file and produces an output file, then reference it via \`"src"\` in your datatable/spreadsheet/html-preview/pdf-preview block.

**Workflow:**
1. Call \`transform_data\` with a script that reads input files and writes output
2. Output a datatable/spreadsheet block with \`"src": "data/output.json"\`, an html-preview block with \`"src": "data/output.html"\`, or a pdf-preview block with \`"src": "data/output.pdf"\`

**Script conventions:**
- Input file paths are passed as command-line arguments (last arg = output file path)
- Python: \`sys.argv[1:-1]\` = input files, \`sys.argv[-1]\` = output path
- Node/Bun: \`process.argv.slice(2, -1)\` = input files, \`process.argv.at(-1)\` = output path
- For datatable/spreadsheet: output must be valid JSON: \`{"title": "...", "columns": [...], "rows": [...]}\`
- For html-preview: output is an HTML file (any valid HTML)

**Security:** Runs in an isolated subprocess with no access to API keys or credentials. 30-second timeout.`,

  render_template: `Render a source's HTML template with data.

Use this when a source provides HTML templates for rich rendering of its data (e.g., issue detail views, email threads, ticket summaries).

**Workflow:**
1. Fetch data from the source (via MCP tools or API calls)
2. Call \`render_template\` with the source slug, template ID, and data
3. Output an \`html-preview\` block with the returned file path as \`"src"\`

**Available templates** are documented in each source's \`guide.md\` under the "Templates" section.

Templates use Mustache syntax — the tool handles rendering and writes the output HTML to the session data folder.`,

  browser_open: `Open (or focus) an in-app browser window.

Ensures the session's browser instance is visible and focused.
Returns the browser instance ID that was opened/focused.`,

  browser_navigate: `Navigate the built-in browser to a URL.

The built-in browser windows run real Chromium content inside the app. Use this to load web pages for inspection, testing, or data extraction.

If the browser UI may be hidden, call \`browser_open\` first.

Returns the final URL and page title after navigation completes.`,

  browser_snapshot: `Get an accessibility tree snapshot of the current browser page.

Returns a structured list of interactive elements (buttons, links, inputs, etc.) and content nodes (headings, paragraphs, images) with ref IDs like @e1, @e2.

Use these refs with browser_click and browser_fill to interact with elements. The snapshot is the primary way to understand page structure — prefer it over screenshots for element interaction.`,

  browser_click: `Click an element in the browser by its ref ID (e.g., @e1).

Get refs from browser_snapshot first. This performs a real mouse click at the element's center coordinates.

Optional wait behavior:
- waitFor: "none" (default), "navigation", or "network-idle"
- timeoutMs: maximum wait time for waitFor modes`,

  browser_fill: `Fill a text input or textarea in the browser by its ref ID.

Clears the existing value first, then types the new value character by character. Get refs from browser_snapshot first.`,

  browser_select: `Select an option in a <select> dropdown by its ref ID.

Pass the option's value attribute. Get refs from browser_snapshot first.`,

  browser_screenshot: `Take a screenshot of the current browser page.

Supports optional agent-focused annotations and metadata:
- mode: "raw" (default) or "agent"
- refs: specific refs to annotate from browser_snapshot
- includeLastAction: include last interaction target when available
- includeMetadata: include compact overlay and metadata payload

Use browser_snapshot instead when you need to interact with elements — screenshots are better for visual verification.`,

  browser_screenshot_region: `Take a screenshot of a specific region or element in the current browser page.

Supports three target modes:
- Coordinates: x, y, width, height
- Ref: ref from browser_snapshot (e.g., @e12)
- Selector: CSS selector (e.g., div[data-testid="chart"]) — resolves to the first visible match (falls back to first match)

Optional padding expands the capture box around the target.
Returns PNG image content and metadata with the resolved target box.`,

  browser_console: `Get recent console messages from the current browser page.

Use this to inspect page errors/warnings and runtime logs without opening DevTools.

Supports filtering by level and limiting number of entries.`,

  browser_window_resize: `Resize the in-app browser window viewport.

Sets the browser content area size to the requested width and height in pixels.
Useful before screenshots to capture deterministic layouts.`,

  browser_network: `Get recent network request activity from the current browser page.

Supports filtering by status class, method, and resource type. Useful for debugging failed API calls and understanding what a click/navigation triggered.`,

  browser_wait: `Wait for a browser condition to become true.

Supported kinds:
- selector: waits for CSS selector to exist
- text: waits for page text to appear
- url: waits until URL contains a substring
- network-idle: waits until in-flight requests settle for an idle window

Use this after click/navigation for reliability.`,

  browser_key: `Send keyboard input to the browser page.

Use this for shortcuts and key-driven flows (Enter, Escape, Cmd+K, etc.).`,

  browser_downloads: `Inspect download activity for the current browser window.

Actions:
- list (default): return recent download entries
- wait: wait for a terminal download state before returning`,

  browser_scroll: `Scroll the browser page in a given direction.

Useful for revealing content below the fold before taking a snapshot. Default scroll amount is 500 pixels.`,

  browser_back: `Navigate the browser back to the previous page in history.`,

  browser_forward: `Navigate the browser forward to the next page in history.`,

  browser_evaluate: `Execute JavaScript in the browser page and return the result.

Use this for advanced interactions not covered by other browser tools, like reading computed styles, extracting data from the DOM, or triggering custom events.

The expression is evaluated in the page context. Return values are serialized to JSON.`,

  browser_tool: `Run browser actions using a CLI-like command string.

This is a convenience wrapper around browser_* tools with strict validation and actionable feedback.

Examples:
- \`--help\`
- \`open\`
- \`navigate https://example.com\`
- \`snapshot\`
- \`click @e12\`
- \`fill @e5 user@example.com\`
- \`select @e3 optionValue\`
- \`scroll down 800\`
- \`evaluate document.title\`
- \`console 50 error\`
- \`screenshot-region 100 200 640 480\`
- \`screenshot-region --ref @e12 --padding 8\`
- \`screenshot-region --selector div[data-testid="chart"]\`
- \`window-resize 1440 900\`
- \`network 50 failed\`
- \`wait network-idle 8000\`
- \`key Enter\`
- \`key k meta\`
- \`downloads wait 15000\`

Prefer direct browser_* tools when exact structured arguments are available.`,

  call_llm: `Invoke a secondary LLM for focused subtasks. Use for:
- Cost optimization: use a smaller model for simple tasks (summarization, classification)
- Structured output: JSON schema compliance via prompt instructions
- Parallel processing: call multiple times in one message - all run simultaneously
- Context isolation: process content without polluting main context

Put text/content directly in the 'prompt' parameter. Do NOT pass inline text via attachments.
Only use 'attachments' for existing file paths on disk - the tool loads file content automatically.
For large files (>2000 lines), use {path, startLine, endLine} to select a portion.`,

  spawn_session: `Create a new session that runs independently with its own prompt, connection, model, and sources.

Use this to delegate tasks to parallel sessions — research, analysis, drafts, or any work that benefits from separate context.

Call with help=true first to discover available connections, models, and sources.
When spawning, the 'prompt' parameter is required.

The spawned session appears in the session list and runs fire-and-forget.
Only use 'attachments' for existing file paths on disk — the tool reads them automatically.`,
} as const;

// ============================================================
// Tool Definition Type
// ============================================================

/** Handler function signature for session tools. */
export type SessionToolHandler = (ctx: SessionToolContext, args: any) => Promise<ToolResult>;

/** Where a session tool is executed. */
export type SessionToolExecutionMode = 'registry' | 'backend';

interface SessionToolDefBase {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
}

/** Tool executed from the canonical registry (requires a concrete handler). */
export interface RegistrySessionToolDef extends SessionToolDefBase {
  executionMode: 'registry';
  handler: SessionToolHandler;
}

/** Tool executed by backend-specific adapters (Pi/Claude/session-mcp-server). */
export interface BackendSessionToolDef extends SessionToolDefBase {
  executionMode: 'backend';
  handler: null;
}

/** A single session tool definition combining name, description, schema, mode, and handler. */
export type SessionToolDef = RegistrySessionToolDef | BackendSessionToolDef;

// ============================================================
// Canonical Tool Registry
// ============================================================

export const SESSION_TOOL_DEFS: SessionToolDef[] = [
  { name: 'SubmitPlan', description: TOOL_DESCRIPTIONS.SubmitPlan, inputSchema: SubmitPlanSchema, executionMode: 'registry', handler: handleSubmitPlan },
  { name: 'config_validate', description: TOOL_DESCRIPTIONS.config_validate, inputSchema: ConfigValidateSchema, executionMode: 'registry', handler: handleConfigValidate },
  { name: 'skill_validate', description: TOOL_DESCRIPTIONS.skill_validate, inputSchema: SkillValidateSchema, executionMode: 'registry', handler: handleSkillValidate },
  { name: 'mermaid_validate', description: TOOL_DESCRIPTIONS.mermaid_validate, inputSchema: MermaidValidateSchema, executionMode: 'registry', handler: handleMermaidValidate },
  { name: 'source_test', description: TOOL_DESCRIPTIONS.source_test, inputSchema: SourceTestSchema, executionMode: 'registry', handler: handleSourceTest },
  { name: 'source_oauth_trigger', description: TOOL_DESCRIPTIONS.source_oauth_trigger, inputSchema: SourceOAuthTriggerSchema, executionMode: 'registry', handler: handleSourceOAuthTrigger },
  { name: 'source_google_oauth_trigger', description: TOOL_DESCRIPTIONS.source_google_oauth_trigger, inputSchema: SourceOAuthTriggerSchema, executionMode: 'registry', handler: handleGoogleOAuthTrigger },
  { name: 'source_slack_oauth_trigger', description: TOOL_DESCRIPTIONS.source_slack_oauth_trigger, inputSchema: SourceOAuthTriggerSchema, executionMode: 'registry', handler: handleSlackOAuthTrigger },
  { name: 'source_microsoft_oauth_trigger', description: TOOL_DESCRIPTIONS.source_microsoft_oauth_trigger, inputSchema: SourceOAuthTriggerSchema, executionMode: 'registry', handler: handleMicrosoftOAuthTrigger },
  { name: 'source_credential_prompt', description: TOOL_DESCRIPTIONS.source_credential_prompt, inputSchema: CredentialPromptSchema, executionMode: 'registry', handler: handleCredentialPrompt },
  { name: 'update_user_preferences', description: TOOL_DESCRIPTIONS.update_user_preferences, inputSchema: UpdatePreferencesSchema, executionMode: 'registry', handler: handleUpdatePreferences },
  { name: 'transform_data', description: TOOL_DESCRIPTIONS.transform_data, inputSchema: TransformDataSchema, executionMode: 'registry', handler: handleTransformData },
  { name: 'render_template', description: TOOL_DESCRIPTIONS.render_template, inputSchema: RenderTemplateSchema, executionMode: 'registry', handler: handleRenderTemplate },
  { name: 'call_llm', description: TOOL_DESCRIPTIONS.call_llm, inputSchema: CallLlmSchema, executionMode: 'backend', handler: null },
  { name: 'spawn_session', description: TOOL_DESCRIPTIONS.spawn_session, inputSchema: SpawnSessionSchema, executionMode: 'backend', handler: null },
  // Browser tools (backend-specific — requires BrowserPaneManager in Electron)
  { name: 'browser_open', description: TOOL_DESCRIPTIONS.browser_open, inputSchema: BrowserOpenSchema, executionMode: 'backend', handler: null },
  { name: 'browser_navigate', description: TOOL_DESCRIPTIONS.browser_navigate, inputSchema: BrowserNavigateSchema, executionMode: 'backend', handler: null },
  { name: 'browser_snapshot', description: TOOL_DESCRIPTIONS.browser_snapshot, inputSchema: BrowserSnapshotSchema, executionMode: 'backend', handler: null },
  { name: 'browser_click', description: TOOL_DESCRIPTIONS.browser_click, inputSchema: BrowserClickSchema, executionMode: 'backend', handler: null },
  { name: 'browser_fill', description: TOOL_DESCRIPTIONS.browser_fill, inputSchema: BrowserFillSchema, executionMode: 'backend', handler: null },
  { name: 'browser_select', description: TOOL_DESCRIPTIONS.browser_select, inputSchema: BrowserSelectSchema, executionMode: 'backend', handler: null },
  { name: 'browser_screenshot', description: TOOL_DESCRIPTIONS.browser_screenshot, inputSchema: BrowserScreenshotSchema, executionMode: 'backend', handler: null },
  { name: 'browser_screenshot_region', description: TOOL_DESCRIPTIONS.browser_screenshot_region, inputSchema: BrowserScreenshotRegionSchema, executionMode: 'backend', handler: null },
  { name: 'browser_console', description: TOOL_DESCRIPTIONS.browser_console, inputSchema: BrowserConsoleSchema, executionMode: 'backend', handler: null },
  { name: 'browser_window_resize', description: TOOL_DESCRIPTIONS.browser_window_resize, inputSchema: BrowserWindowResizeSchema, executionMode: 'backend', handler: null },
  { name: 'browser_network', description: TOOL_DESCRIPTIONS.browser_network, inputSchema: BrowserNetworkSchema, executionMode: 'backend', handler: null },
  { name: 'browser_wait', description: TOOL_DESCRIPTIONS.browser_wait, inputSchema: BrowserWaitSchema, executionMode: 'backend', handler: null },
  { name: 'browser_key', description: TOOL_DESCRIPTIONS.browser_key, inputSchema: BrowserKeySchema, executionMode: 'backend', handler: null },
  { name: 'browser_downloads', description: TOOL_DESCRIPTIONS.browser_downloads, inputSchema: BrowserDownloadsSchema, executionMode: 'backend', handler: null },
  { name: 'browser_scroll', description: TOOL_DESCRIPTIONS.browser_scroll, inputSchema: BrowserScrollSchema, executionMode: 'backend', handler: null },
  { name: 'browser_back', description: TOOL_DESCRIPTIONS.browser_back, inputSchema: BrowserBackSchema, executionMode: 'backend', handler: null },
  { name: 'browser_forward', description: TOOL_DESCRIPTIONS.browser_forward, inputSchema: BrowserForwardSchema, executionMode: 'backend', handler: null },
  { name: 'browser_evaluate', description: TOOL_DESCRIPTIONS.browser_evaluate, inputSchema: BrowserEvaluateSchema, executionMode: 'backend', handler: null },
  { name: 'browser_tool', description: TOOL_DESCRIPTIONS.browser_tool, inputSchema: BrowserToolSchema, executionMode: 'backend', handler: null },
];

// ============================================================
// Derived Lookups
// ============================================================

/** Set of session tool names for quick membership checks. */
export const SESSION_TOOL_NAMES = new Set(SESSION_TOOL_DEFS.map(d => d.name));

/** Session tool names that must be handled by backend-specific adapters (Pi/Claude/session-mcp-server). */
export const SESSION_BACKEND_TOOL_NAMES = new Set(
  SESSION_TOOL_DEFS.filter(d => d.executionMode === 'backend').map(d => d.name)
);

/** Session tool names that are always executable from the canonical registry. */
export const SESSION_REGISTRY_TOOL_NAMES = new Set(
  SESSION_TOOL_DEFS.filter(d => d.executionMode === 'registry').map(d => d.name)
);

/** Map from tool name → definition for O(1) lookup. */
export const SESSION_TOOL_REGISTRY = new Map(SESSION_TOOL_DEFS.map(d => [d.name, d]));

// ============================================================
// JSON Schema Converter (for MCP / Pi consumers)
// ============================================================

export interface JsonSchemaToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Convert all session tool definitions to JSON Schema format.
 *
 * @param opts.prefix - Optional prefix for tool names (e.g., 'mcp__session__' for Pi)
 * @returns Array of tool definitions with JSON Schema inputSchema
 */
export function getToolDefsAsJsonSchema(opts?: { prefix?: string }): JsonSchemaToolDef[] {
  const prefix = opts?.prefix || '';
  return SESSION_TOOL_DEFS.map(def => {
    // Explicit `as any` avoids TS2589 ("type instantiation is excessively deep")
    // caused by zodToJsonSchema inferring deep generic chains from union schemas.
    const jsonSchema = zodToJsonSchema(def.inputSchema as any, { $refStrategy: 'none' }) as Record<string, unknown>;
    // Strip metadata not needed by MCP/Pi consumers
    delete jsonSchema.$schema;
    delete jsonSchema.additionalProperties;
    return {
      name: prefix + def.name,
      description: def.description,
      inputSchema: jsonSchema,
    };
  });
}
