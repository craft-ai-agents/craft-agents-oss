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
import { handleScriptSandbox } from './handlers/script-sandbox.ts';
import { handleRenderTemplate } from './handlers/render-template.ts';
import { handleSendDeveloperFeedback } from './handlers/send-developer-feedback.ts';
import { handleSetSessionLabels } from './handlers/set-session-labels.ts';
import { handleSetSessionStatus } from './handlers/set-session-status.ts';
import { handleGetSessionInfo } from './handlers/get-session-info.ts';
import { handleListSessions } from './handlers/list-sessions.ts';
import { handleListAgents } from './handlers/list-agents.ts';
import { handleListSkills } from './handlers/list-skills.ts';
import { handleListSources } from './handlers/list-sources.ts';
import { handleSendAgentMessage } from './handlers/send-agent-message.ts';
import { handleListMessagingChannels, handleUnbindMessagingChannel } from './handlers/messaging.ts';
import { handleCreateAgent } from './handlers/create-agent.ts';
import { handleCreateAutomation } from './handlers/create-automation.ts';
import {
  handleSaveMemory,
  handleUpdateMemory,
  handleForgetMemory,
} from './handlers/memory.ts';
import { handleCreateOutput } from './handlers/outputs.ts';
import {
  handleListWorkflows,
  handleGetWorkflow,
  handleStartWorkflow,
  handleGetWorkflowRun,
  handleCancelWorkflowRun,
} from './handlers/workflows.ts';

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
  autoEnable: z
    .boolean()
    .optional()
    .describe(
      'Automatically enable and activate the source in the current session on successful validation. Defaults to true. Pass false to keep pure validation behavior.'
    ),
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
  includeCoAuthoredBy: z.boolean().optional().describe("Whether to include 'Co-Authored-By: Craft Agent' trailer on git commits. Defaults to true."),
});

export const TransformDataSchema = z.object({
  language: z.enum(['python3', 'node', 'bun']).describe('Script runtime to use'),
  script: z.string().describe('Transform script source code. Receives input file paths as command-line args (sys.argv[1:] or process.argv.slice(2)), last arg is the output file path.'),
  inputFiles: z.array(z.string()).describe('Input file paths relative to session dir (e.g., "long_responses/stripe_txns.txt")'),
  outputFile: z.string().describe('Output file name relative to session data/ dir (e.g., "transactions.json")'),
});

export const ScriptSandboxSchema = z.object({
  language: z.enum(['python3', 'node', 'bun']).describe('Script runtime to use'),
  script: z.string().describe('Inline script source to execute in a sandboxed subprocess.'),
  inputFiles: z.array(z.string()).optional().describe('Optional input file paths relative to the session directory.'),
  stdin: z.string().optional().describe('Optional stdin payload passed to the script process.'),
  timeoutMs: z.number().min(1).max(15000).optional().describe('Optional timeout in milliseconds (default 5000, max 15000).'),
});

export const RenderTemplateSchema = z.object({
  source: z.string().describe('Source slug (e.g., "linear", "gmail")'),
  template: z.string().describe('Template ID (e.g., "issue-detail", "issue-list")'),
  data: z.record(z.string(), z.unknown()).describe('JSON data to render into the template'),
});

export const SendDeveloperFeedbackSchema = z.object({
  message: z.string().describe('Freeform markdown feedback — be detailed, use headings, lists, code blocks. Include what happened, what you expected, what would help, or any ideas/suggestions.'),
});

// Browser tool schema (single CLI-like tool for all browser actions)
export const BrowserToolSchema = z.object({
  command: z.union([
    z.string(),
    z.array(z.string()),
  ]).describe('Browser command as a string (e.g., "click @e1") or array (e.g., ["evaluate", "var x = 1; x + 2"]). Array mode preserves semicolons and whitespace in arguments.'),
});

export const SpawnSessionSchema = z.object({
  help: z.boolean().optional().describe('If true, returns available connections, models, and sources instead of creating a session'),
  prompt: z.string().optional().describe('Instructions for the new session (required when not in help mode)'),
  name: z.string().optional().describe('Session name'),
  llmConnection: z.string().optional().describe('Connection slug (e.g., "anthropic-api", "codex")'),
  model: z.string().optional().describe('Model ID override'),
  enabledSourceSlugs: z.array(z.string()).optional().describe('Source slugs to enable in the new session'),
  permissionMode: z.enum(['safe', 'ask', 'allow-all']).optional().describe('Permission mode for the new session'),
  thinkingLevel: z.enum(['off', 'low', 'medium', 'high', 'xhigh', 'max']).optional()
    .describe('Reasoning level for the new session. Silently ignored on non-reasoning models (e.g. gpt-4o, gemini-2.5-flash). Omit to inherit the workspace default.'),
  labels: z.array(z.string()).optional().describe('Labels for the new session'),
  workingDirectory: z.string().optional().describe('Working directory for the new session'),
  attachments: z.array(z.object({
    path: z.string().describe('Absolute file path on disk'),
    name: z.string().optional().describe('Display name (defaults to file basename)'),
  })).optional().describe('Files to include with the prompt'),
});

// Session self-management tools
export const SetSessionLabelsSchema = z.object({
  sessionId: z.string().optional().describe('Session ID to update. Omit to update the current session.'),
  labels: z.array(z.string()).describe('Labels to set (replaces all existing labels)'),
});

export const SetSessionStatusSchema = z.object({
  sessionId: z.string().optional().describe('Session ID to update. Omit to update the current session.'),
  status: z.string().describe('Status to set (e.g., "todo", "in_progress", "done")'),
});

export const GetSessionInfoSchema = z.object({
  sessionId: z.string().optional().describe('Session ID to query. Omit to get info about the current session.'),
});

export const ListSessionsSchema = z.object({
  status: z.string().optional().describe('Filter by status'),
  label: z.string().optional().describe('Filter by label'),
  search: z.string().optional().describe('Substring match on session name'),
  sortBy: z.enum(['recent', 'name', 'status']).optional().describe('Sort order (default: recent)'),
  limit: z.number().optional().describe('Max sessions to return (default 20, max 100)'),
  offset: z.number().optional().describe('Skip first N results (for pagination)'),
});

export const ListAgentsSchema = z.object({
  activeOnly: z.boolean().optional().describe('If true, return only agents active in the current workspace. Defaults to false.'),
  search: z.string().optional().describe('Optional case-insensitive search across slug, name, description, tags, inputs, and outputs.'),
  tags: z.array(z.string()).optional().describe('Optional capability tags to require. Matching is case-insensitive.'),
});

export const ListSkillsSchema = z.object({
  activeOnly: z.boolean().optional().describe('If true, return only skills currently active in this workspace (workspace + activated globals + project). Defaults to false, which also includes dormant skills from the global library.'),
  search: z.string().optional().describe('Optional case-insensitive search across slug, name, description, and tags.'),
  tags: z.array(z.string()).optional().describe('Optional tags to require (intersection — skill must have all). Case-insensitive.'),
});

export const ListSourcesSchema = z.object({
  activeOnly: z.boolean().optional().describe('If true, exclude global-dormant sources (those defined in the global library but not activated in this workspace). Defaults to false.'),
  search: z.string().optional().describe('Optional case-insensitive substring search across slug, name, description, and tags.'),
  tags: z.array(z.string()).optional().describe('Optional tags filter — every listed tag must be present on the source (case-insensitive).'),
  type: z.enum(['mcp', 'api', 'local']).optional().describe('Optional transport filter: mcp (Model Context Protocol server), api (HTTP API connector), or local (local-only connector).'),
});

export const ListWorkflowsSchema = z.object({
  activeOnly: z.boolean().optional().describe('If true, return only workflows active in the current workspace. Defaults to false.'),
  search: z.string().optional().describe('Optional case-insensitive search across slug, name, description, trigger inputs, and step agents.'),
});

export const GetWorkflowSchema = z.object({
  slug: z.string().describe('Workflow slug.'),
});

export const StartWorkflowSchema = z.object({
  slug: z.string().describe('Workflow slug to start.'),
  triggerInputs: z.record(z.string(), z.unknown()).optional().describe('Manual trigger inputs keyed by input name.'),
});

export const GetWorkflowRunSchema = z.object({
  runId: z.string().describe('Workflow run ID.'),
});

export const CancelWorkflowRunSchema = z.object({
  runId: z.string().describe('Workflow run ID to cancel.'),
});

// Inter-session messaging
export const SendAgentMessageSchema = z.object({
  sessionId: z.string().describe('Target session ID to send the message to'),
  message: z.string().describe('The message to send to the target session'),
  attachments: z.array(z.object({
    path: z.string().describe('Absolute file path on disk'),
    name: z.string().optional().describe('Display name (defaults to file basename)'),
  })).optional().describe('Files to include with the message'),
});

export const ListMessagingChannelsSchema = z.object({
  sessionId: z.string().optional().describe('Session ID to list bindings for. Defaults to current session.'),
});

export const UnbindMessagingChannelSchema = z.object({
  platform: z.enum(['telegram', 'whatsapp']).optional().describe('Platform to unbind. If omitted, unbinds all.'),
});

export const CreateAgentSchema = z.object({
  slug: z.string().describe('kebab-case slug (1-64 chars, lowercase + digits + hyphens).'),
  metadata: z.object({
    name: z.string().describe('Display name shown in pickers.'),
    description: z.string().describe('One-sentence description shown in lists.'),
    avatar: z.string().optional().describe('Single emoji avatar.'),
    permissionMode: z.enum(['safe', 'ask', 'allow-all']).optional().describe('Defaults to "ask". Only set "allow-all" with explicit user opt-in.'),
    thinkingLevel: z.enum(['off', 'low', 'medium', 'high', 'xhigh', 'max']).optional().describe('Reasoning depth. Default to "medium" for most agents.'),
    skills: z.array(z.string()).optional().describe('Skill slugs to bundle.'),
    sources: z.array(z.string()).optional().describe('Source slugs to bundle.'),
    inputs: z.string().optional().describe('One sentence describing expected inputs.'),
    outputs: z.string().optional().describe('One sentence describing produced outputs.'),
    tags: z.array(z.string()).optional().describe('1-8 lowercase capability tags.'),
    greeting: z.string().optional().describe('Optional opening line shown in the composer.'),
    model: z.string().optional().describe('Model ID override.'),
    llmConnection: z.string().optional().describe('LLM connection slug.'),
  }).describe('Agent frontmatter metadata.'),
  systemPrompt: z.string().describe('The agent persona / operating instructions. Required, non-empty.'),
  activateInWorkspace: z.boolean().optional().describe('Activate the new agent in the current workspace. Defaults to true.'),
  overwrite: z.boolean().optional().describe('If true, overwrite an existing agent with the same slug. Defaults to false.'),
});

const CreateAutomationActionSchema = z.union([
  z.object({
    type: z.literal('prompt'),
    prompt: z.string().describe('Prompt the spawned session receives. May reference $CRAFT_* env vars (e.g. $CRAFT_BODY, $CRAFT_TEXT).'),
    llmConnection: z.string().optional().describe('LLM connection slug to use for this run.'),
    model: z.string().optional().describe('Model ID override.'),
    thinkingLevel: z.enum(['off', 'low', 'medium', 'high', 'xhigh', 'max']).optional().describe('Reasoning depth for the run.'),
  }).passthrough(),
  z.object({
    type: z.literal('webhook'),
    url: z.string().describe('Outbound URL to POST. May reference $CRAFT_* env vars.'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    bodyFormat: z.enum(['json', 'form', 'raw']).optional(),
    body: z.unknown().optional(),
    captureResponse: z.boolean().optional(),
    auth: z.union([
      z.object({ type: z.literal('basic'), username: z.string(), password: z.string() }),
      z.object({ type: z.literal('bearer'), token: z.string() }),
    ]).optional(),
  }).passthrough(),
]);

export const CreateAutomationSchema = z.object({
  workspaceId: z.string().optional().describe('Target workspace ID. Defaults to the current workspace.'),
  eventName: z.enum(['SchedulerTick', 'WebhookReceive', 'FileWatch', 'PollUrl', 'MessageReceive'])
    .describe('Trigger event type for the automation.'),
  matcher: z.object({
    name: z.string().optional().describe('Display name for the automation.'),
    slug: z.string().optional().describe('Webhook slug (required for WebhookReceive). 1-64 chars: lowercase letters, digits, hyphens.'),
    secretEnv: z.string().optional().describe('Env var name holding the webhook HMAC shared secret (WebhookReceive). Required unless allowUnauthenticated is true.'),
    allowUnauthenticated: z.boolean().optional().describe('Explicitly allow unsigned WebhookReceive requests. Only safe for local/dev or trusted networks.'),
    allowedMethods: z.array(z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])).optional().describe('Allowed HTTP methods for WebhookReceive. Defaults to POST.'),
    cron: z.string().optional().describe('Cron expression in 5-field format (required for SchedulerTick).'),
    timezone: z.string().optional().describe('IANA timezone for cron evaluation (e.g. "America/New_York").'),
    watchPath: z.string().optional().describe('Path to watch (FileWatch).'),
    watchGlob: z.string().optional().describe('Glob filter (FileWatch).'),
    watchChangeTypes: z.array(z.enum(['add', 'change', 'remove'])).optional(),
    pollUrl: z.string().optional().describe('URL to poll (PollUrl).'),
    pollIntervalSec: z.number().optional().describe('Poll interval in seconds (min 30).'),
    matcher: z.string().optional().describe('Optional regex matcher applied to event payload.'),
    enabled: z.boolean().optional().describe('Defaults to true (enabled).'),
    permissionMode: z.enum(['safe', 'ask', 'allow-all']).optional().describe('Permission mode for spawned sessions. Default to "ask".'),
    actions: z.array(CreateAutomationActionSchema).min(1).describe('At least one prompt or webhook action.'),
  }).passthrough().describe('Matcher fields. Trigger-specific fields are passed through and validated server-side.'),
});

const MemoryScopeSchema = z.enum(['agent', 'user']).describe('Where to save: "agent" for this agent only, or "user" for cross-agent USER.md memory. Defaults to "agent".');
const MemoryNameSchema = z.string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/)
  .describe('Slug-shaped memory name, unique within the file: lowercase letters, digits, hyphens, 1-64 chars.');
const MemoryExpiresSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('Optional ISO date (YYYY-MM-DD) after which this memory is dropped during prompt injection.');

export const SaveMemorySchema = z.object({
  scope: MemoryScopeSchema.optional(),
  name: MemoryNameSchema,
  type: z.enum(['user', 'feedback', 'project', 'reference']).describe('Memory category: user preference/fact, feedback about collaboration, project state, or external reference.'),
  content: z.string().min(1).describe('Entry body as concise markdown. Usually 1-4 sentences; keep it factual and durable.'),
  expires: MemoryExpiresSchema.optional(),
});

export const UpdateMemorySchema = z.object({
  scope: MemoryScopeSchema.optional(),
  name: MemoryNameSchema.describe('Existing memory entry name. The name and type are immutable; create a new memory if those need to change.'),
  content: z.string().min(1).optional().describe('Replacement entry body. Omit to update only expires.'),
  expires: MemoryExpiresSchema.nullable().optional().describe('New expiration date, or null to clear expiration. Omit to leave unchanged.'),
});

export const ForgetMemorySchema = z.object({
  scope: MemoryScopeSchema.optional(),
  name: MemoryNameSchema.describe('Existing memory entry name to delete and tombstone.'),
});

const OutputKindSchema = z.enum([
  'report',
  'document',
  'image',
  'video',
  'audio',
  'dataset',
  'code',
  'receipt',
  'external-action',
  'collection',
  'other',
]).describe('The type of deliverable being published.');

const OutputAssetRoleSchema = z.enum(['primary', 'supporting', 'source', 'thumbnail', 'attachment']);

export const CreateOutputSchema = z.object({
  title: z.string().min(1).describe('Human-readable output title.'),
  kind: OutputKindSchema,
  summary: z.string().min(1).describe('Short summary shown in output lists and cards.'),
  content: z.string().optional().describe('Inline output content to persist as the primary asset.'),
  contentMimeType: z.enum(['text/markdown', 'text/plain', 'application/json']).optional().describe('MIME type for inline content. Defaults backend-side when omitted.'),
  files: z.array(z.object({
    path: z.string().min(1).describe('Path to a file that should be attached to this output.'),
    label: z.string().optional(),
    role: OutputAssetRoleSchema.optional(),
  })).optional(),
  links: z.array(z.object({
    label: z.string().min(1),
    url: z.string().url(),
    role: z.enum(['primary', 'source', 'related', 'external']).optional(),
  })).optional(),
  receipts: z.array(z.object({
    provider: z.string().min(1),
    action: z.string().min(1),
    status: z.enum(['succeeded', 'failed', 'pending']),
    externalId: z.string().optional(),
    url: z.string().url().optional(),
    displayText: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })).optional(),
  tags: z.array(z.string()).optional(),
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

  source_test: `Validate, test, and (by default) activate a source configuration.

**This tool performs:**
1. **Schema validation**: Validates config.json structure
2. **Icon handling**: Checks/downloads icon if configured
3. **Completeness check**: Warns about missing guide.md/icon/tagline
4. **Connection test**: Tests if the source is reachable
5. **Auth status**: Checks if source is authenticated
6. **Auto-enable** (default): If validation passes, flip \`enabled: true\` in config (if needed) and activate the source in the running session so its tools become available without a restart.

Pass \`autoEnable: false\` to keep pure validation behavior (no config or session mutations).`,

  source_oauth_trigger: `Start OAuth authentication for an MCP source.

This tool initiates the OAuth 2.0 + PKCE flow for sources that require authentication.

**Prerequisites:**
- Source must exist in the current workspace
- Source must be type 'mcp' with authType 'oauth'
- Source must have a valid MCP URL

**IMPORTANT:** After calling this tool, execution will be paused while OAuth completes.`,

  source_google_oauth_trigger: `Trigger Google OAuth authentication for a Google API source.

Opens a browser window for the user to sign in with their Google account.

**Supported services:** Gmail, Calendar, Drive, Docs, Sheets, YouTube, Search Console

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

Use this tool when you need to transform large datasets (20+ rows) into structured JSON for display, or extract/decode content for rich previews. Write a transform script that reads the input file and produces an output file, then reference it via \`"src"\` in your datatable/spreadsheet/html-preview/pdf-preview/image-preview block.

**Workflow:**
1. Call \`transform_data\` with a script that reads input files and writes output
2. Output a datatable/spreadsheet block with \`"src": "data/output.json"\`, an html-preview block with \`"src": "data/output.html"\`, a pdf-preview block with \`"src": "data/output.pdf"\`, or an image-preview block with \`"src": "data/output.png"\`

**Script conventions:**
- Input file paths are passed as command-line arguments (last arg = output file path)
- Python: \`sys.argv[1:-1]\` = input files, \`sys.argv[-1]\` = output path
- Node/Bun: \`process.argv.slice(2, -1)\` = input files, \`process.argv.at(-1)\` = output path
- For datatable/spreadsheet: output must be valid JSON: \`{"title": "...", "columns": [...], "rows": [...]}\`
- For html-preview: output is an HTML file (any valid HTML)

**Security:** Runs in an isolated subprocess with no access to API keys or credentials. 30-second timeout.`,

  script_sandbox: `Run quick inline diagnostics in a sandboxed subprocess with network isolation.

Use this for short Python/Node/Bun snippets when strict Explore-mode Bash parsing blocks inline diagnostics.

**Behavior:**
- Executes script source from \`script\` in a temporary file
- Returns stdout/stderr, exit code, duration, and timeout status
- Accepts optional input files and stdin
- Requires enforced network and filesystem isolation; if unsupported or unusable, execution is blocked

**Safety:**
- Sensitive credential env vars are stripped
- Input files are restricted to the current session directory
- Filesystem writes are restricted to the current session directory
- Timeout is capped (default 5000ms, max 15000ms)
- Network/filesystem isolation is required in all permission modes; if unavailable, execution is blocked`,

  render_template: `Render a source's HTML template with data.

Use this when a source provides HTML templates for rich rendering of its data (e.g., issue detail views, email threads, ticket summaries).

**Workflow:**
1. Fetch data from the source (via MCP tools or API calls)
2. Call \`render_template\` with the source slug, template ID, and data
3. Output an \`html-preview\` block with the returned file path as \`"src"\`

**Available templates** are documented in each source's \`guide.md\` under the "Templates" section.

Templates use Mustache syntax — the tool handles rendering and writes the output HTML to the session data folder.`,

  browser_tool: `Run browser actions using a CLI-like command (string or array input).

All browser interactions use this single tool with strict validation and actionable feedback.
String mode supports batching with semicolons: \`fill @e1 value; fill @e2 value; click @e3\`
Batch stops after navigation commands (click, navigate, back, forward) since page state may change.

Array mode bypasses string parsing and preserves raw arguments exactly (recommended for semicolons, tabs, and newlines):
- \`["evaluate", "var x = 1; var y = 2; x + y"]\`
- \`["paste", "Name\\tAge\\nAlice\\t30"]\`

Examples:
- \`--help\`
- \`open\`
- \`navigate https://example.com\`
- \`snapshot\`
- \`find login button\` — search elements by keyword
- \`click @e12\`
- \`click-at 350 200\` — click at pixel coordinates (for canvas elements)
- \`fill @e5 user@example.com\`
- \`type Hello World\` — type into currently focused element (no ref needed)
- \`select @e3 optionValue\`
- \`select @e75 CNAME --assert-text Target --timeout 3000\`
- \`set-clipboard Name\\tAge\\nAlice\\t30\` — write text to clipboard
- \`get-clipboard\` — read clipboard text content
- \`paste Name\\tAge\\nAlice\\t30\` — set clipboard and trigger Ctrl/Cmd+V
- \`scroll down 800\`
- \`evaluate document.title\`
- \`console 50 error\`
- \`screenshot\` — raw screenshot
- \`screenshot --annotated\` — screenshot with @eN labels overlaid on interactive elements
- \`screenshot-region 100 200 640 480\`
- \`screenshot-region --ref @e12 --padding 8\`
- \`screenshot-region --selector div[data-testid="chart"]\`
- \`window-resize 1440 900\`
- \`network 50 failed\`
- \`wait network-idle 8000\`
- \`key Enter\`
- \`key k meta\`
- \`downloads wait 15000\`
- \`focus [windowId]\` — focus existing browser window (no new window)
- \`windows\` — list current browser windows and ownership state
- \`release\` — dismiss the agent control overlay when done
- \`close\` — close and destroy the browser window
- \`hide\` — hide the window while preserving state`,

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

Optional overrides: \`model\`, \`llmConnection\`, \`permissionMode\`, \`thinkingLevel\`, \`enabledSourceSlugs\`, \`labels\`, \`workingDirectory\`. Omitted fields inherit from the spawning session or the workspace default.

\`thinkingLevel\` is silently ignored on non-reasoning models (e.g. gpt-4o, gemini-2.5-flash) — the SDK drops the reasoning param rather than erroring. Use it when you want to force deeper reasoning on a supported model, or set it to \`off\` when spawning a session that doesn't need to think.

The spawned session appears in the session list and runs fire-and-forget.
Only use 'attachments' for existing file paths on disk — the tool reads them automatically.`,

  send_developer_feedback: `Send freeform feedback to the Craft Agent development team.

Use this to share anything that would help improve the product — issues you hit, ideas for better tools, suggestions for improved workflows, or patterns you notice. Write in markdown with as much detail as possible. This is your direct line to the developers.`,

  set_session_labels: `Set labels on the current session or a specific session by ID. Replaces all existing labels.

Use this to tag sessions for filtering or to trigger label-based automations (LabelAdd/LabelRemove events).
Pass an empty array to clear all labels. Omit sessionId to target the current session.`,

  set_session_status: `Set the status of the current session or a specific session by ID (e.g., "todo", "in_progress", "done").

Use this to signal completion or trigger status-based automations (SessionStatusChange events).
Omit sessionId to target the current session.`,

  get_session_info: `Get metadata about the current session or a specific session by ID.

Returns labels, status, name, permission mode, and other details.
Call with no arguments to introspect your own session state.`,

  list_sessions: `List sessions in the workspace. Returns total count + paginated results.

Use filters (status, label, search) to narrow results instead of fetching everything. Default limit is 20 sessions.
Use get_session_info for full details on a specific session (list-then-detail pattern).`,

  list_agents: `List saved agents available to this workspace.

Use this before recommending which agent should handle a task. It returns each agent's slug, display name, description, active status, skills, sources, and capability fields (inputs, outputs, tags).

Prefer this over filesystem searches for AGENT.md files. For normal routing questions, call with activeOnly=true so recommendations come from the user's active workspace agents.`,

  list_skills: `List skills available in this workspace.

Use this before bundling skills into a new agent (via agent-creator) or recommending skills for the user to activate.

Each result includes slug, name, description, tags, and a 'source' field:
  - 'workspace'      → workspace-defined skill (overrides any global with same slug)
  - 'global'         → global library skill that is currently activated in this workspace
  - 'project'        → project-level skill from the current working directory
  - 'global-dormant' → global library skill NOT activated in this workspace; can be suggested for activation but cannot be referenced as a bundled slug yet

For agent creation, prefer activeOnly=true (workspace + activated globals + project). When the user wants help discovering skills they don't yet have, call without activeOnly to also see global-dormant entries.`,

  list_sources: `When the user (or another agent) is choosing which sources/tools (MCP servers, API connectors, local connectors) to bundle into an agent, asking "what sources should this agent have", "which tools does it need", or curating a focused source bundle. Also use during agent-creator's source-bundle step.

Returns each source's slug, display name, description, tags, type (mcp/api/local), tier, enabled flag, authStatus, and optional iconUrl. Tier is one of: workspace (defined in <workspace>/sources/<slug>/), global (defined in ~/.agents/sources/<slug>/ and activated in this workspace), global-dormant (defined globally but not activated here), or project (project-tier source).

For agents reasoning about what is currently spawnable, call with activeOnly=true to exclude global-dormant entries. Use search/tags/type to narrow further. Sources whose config declares auth:'none' short-circuit to enabled=true regardless of credential state; for auth-requiring sources, enabled reflects whether credentials and config gates pass.

Prefer this over filesystem searches for source configs.`,

  list_workflows: `List workflows available to this workspace. Returns active status, trigger inputs, and step summaries.

Use this before recommending or starting a workflow. For normal user-facing suggestions, call with activeOnly=true.`,

  get_workflow: `Get a workflow definition by slug, including trigger inputs, step details, and body notes.

Use this before starting a workflow when you need to explain what it will do or gather required trigger inputs.`,

  start_workflow: `Start a workflow run in the current workspace.

Only call this after the user explicitly asks to run a workflow or confirms the workflow and required trigger inputs.`,

  get_workflow_run: `Get the latest persisted workflow run snapshot by run ID.

Use this to inspect progress, step outputs, errors, and final state.`,

  cancel_workflow_run: `Cancel a running workflow run by run ID.

Use this only when the user asks to stop/cancel a workflow run.`,

  send_agent_message: `Send a message to another session. The message is delivered with your session ID so the target can reply back.

Use this to coordinate with spawned sessions, send follow-up instructions, or relay information between sessions.
Use list_sessions to find session IDs, or use the sessionId returned by spawn_session.

The target session receives your message with a sender envelope containing your session ID, so it can use send_agent_message to reply.`,

  list_messaging_channels: `List messaging channels (Telegram, WhatsApp) bound to a session.
Shows which external chat apps are connected and can send/receive messages.`,

  unbind_messaging_channel: `Disconnect a messaging channel from the current session.
Messages will no longer be forwarded between the chat app and this session.`,

  create_agent: `Create a new agent in the global agent library and activate it in the current workspace.

Use this only after walking the user through the agent-creator interview and getting explicit confirmation. Always show a complete draft (name, slug, avatar, system prompt, etc.) BEFORE calling this tool — never silent-write.

**Inputs:**
- \`slug\`: kebab-case (1-64 chars). If unsure, derive from the agent name.
- \`metadata\`: name + description are required; the rest are strongly preferred (avatar, permissionMode, thinkingLevel, inputs, outputs, tags) and free for you to infer sensibly.
- \`systemPrompt\`: the agent's identity + operating instructions. Required, non-empty.
- \`activateInWorkspace\` (default true): activate in this workspace immediately so the user sees it.
- \`overwrite\` (default false): only set true if the user explicitly asked to replace an existing agent.

**Refusals (returned as errors):**
- Built-in slug clash (\`concierge\`, \`orchestrator\`).
- Slug already exists without \`overwrite: true\` — tool will suggest a numbered variant like \`<slug>-v2\`.
- Empty \`systemPrompt\`.

After success, post a one-line confirmation to the user with a link to /agents/<slug>.`,

  create_automation: `Create a new automation matcher in the workspace's automations.json and activate it.

Use this only after walking the user through the automation-creator interview and getting explicit confirmation. Always show a complete draft (trigger type, schedule/slug/path, the action prompt, permission mode) BEFORE calling this tool.

**Trigger types:**
- \`SchedulerTick\` — cron-based. Required: \`matcher.cron\` (5-field). Optional: \`matcher.timezone\`.
- \`WebhookReceive\` — inbound HTTP. Required: \`matcher.slug\` (kebab-case), plus \`matcher.secretEnv\` unless \`matcher.allowUnauthenticated: true\` is explicitly set. Optional: \`matcher.allowedMethods\`.
- \`FileWatch\` — filesystem changes. Required: \`matcher.watchPath\`. Optional: \`matcher.watchGlob\`, \`matcher.watchChangeTypes\`.
- \`PollUrl\` — periodic URL polling. Required: \`matcher.pollUrl\`, \`matcher.pollIntervalSec\` (min 30).
- \`MessageReceive\` — inbound chat from a messaging gateway (Telegram/WhatsApp).

**Actions** (at least one required in \`matcher.actions\`):
- \`{ type: 'prompt', prompt, llmConnection?, model?, thinkingLevel? }\` — spawns a session with the rendered prompt. \`thinkingLevel\`: \`off\`, \`low\`, \`medium\`, \`high\`, \`xhigh\`, or \`max\`.
- \`{ type: 'webhook', url, method?, headers?, bodyFormat?, body?, captureResponse?, auth? }\` — sends an outbound HTTP request.

**Templating:** Action prompts and URLs use **shell-style \`$VAR\` / \`\${VAR}\` env-var expansion** (NOT mustache/handlebars). The trigger payload is exposed as \`CRAFT_*\` env vars:
- Always available: \`$CRAFT_EVENT\`, \`$CRAFT_EVENT_DATA\` (full JSON), \`$CRAFT_SESSION_ID\`, \`$CRAFT_WORKSPACE_ID\`.
- Payload fields become \`CRAFT_<SNAKE_CASE>\`. Examples by trigger:
  - \`SchedulerTick\` → \`$CRAFT_LOCAL_TIME\`, \`$CRAFT_LOCAL_DATE\`
  - \`WebhookReceive\` → \`$CRAFT_BODY\`, \`$CRAFT_HEADER_<KEY>\`, \`$CRAFT_QUERY_<KEY>\`
  - \`FileWatch\` → \`$CRAFT_RELATIVE_PATH\`, \`$CRAFT_CHANGE_TYPE\`
  - \`PollUrl\` → response fields exposed as \`$CRAFT_*\` (check \`$CRAFT_EVENT_DATA\` for the full payload)
  - \`MessageReceive\` → \`$CRAFT_TEXT\`, \`$CRAFT_PLATFORM\`, \`$CRAFT_CHANNEL_ID\`, \`$CRAFT_MESSAGE_ID\`, \`$CRAFT_SENDER_ID\`, \`$CRAFT_SENDER_NAME\`, \`$CRAFT_BOUND\`, \`$CRAFT_WAS_BOUND\`, \`$CRAFT_BOUND_AFTER_ROUTE\`, \`$CRAFT_ATTACHMENT_COUNT\`, \`$CRAFT_HAS_ATTACHMENT\`

**Refusals:**
- Unsupported \`eventName\`.
- Empty \`actions\` array, or any prompt action with empty \`prompt\`.
- \`SchedulerTick\` without a valid cron.
- \`WebhookReceive\` without a valid slug, or slug that already exists in the workspace.

After success, post a one-line confirmation. For SchedulerTick automations, surface the next-fire time.`,

  save_memory: `Persist a durable fact about the user, your collaboration, or the ongoing project.

Use this only when the information is likely to help future sessions. Every call is visible to the user and may require approval.

Save when:
- You learn a stable fact about who the user is, their role, or their preferences (\`type: user\`, usually \`scope: user\`)
- The user corrects your approach, gives reusable feedback, or confirms an unusual approach worked (\`type: feedback\`)
- Project state changes that will not be captured in code, git, docs, or config (\`type: project\`)
- The user points to an external system, canonical URL, account, document, dashboard, or other reference future agents need (\`type: reference\`)

Do NOT save:
- Anything already represented in code, git history, committed docs, config files, or visible project artifacts
- Ephemeral conversation context, temporary plans, debugging steps, or guesses
- Negative judgments about the user
- Generic project debugging recipes where the fix belongs in the commit or docs
- Sensitive secrets, credentials, access tokens, private keys, or passwords

## Choosing scope

The scope decision is about **audience**, not source. Ask: who else benefits from knowing this fact later?

Use \`scope: user\` (writes to USER.md — broadcast to every agent the user works with) when:
- The fact is about the user themselves: identity, role, expertise, working hours, durable preferences
- The fact is something a different specialist agent would also have wanted to know
- You're acting as a front-door / omniscient role (Concierge, Orchestrator) — your facts are usually about the user, not about you
- You're collaborating with other agents on a shared task and the fact would help them too

Use the default \`scope: agent\` (writes to your own MEMORY.md — only you see it) when:
- The fact is about your collaboration with the user *as this specific agent* (e.g., "user wants my critiques harsher than nice")
- The fact is operational to your role and not generally useful to other agents
- You're unsure — \`agent\` is the safe default; you can update or migrate the entry later

When in doubt, prefer \`scope: agent\`. Bias toward \`scope: user\` only when the fact obviously generalizes across agents.

Keep \`content\` concise and factual.`,

  update_memory: `Update an existing durable memory entry's content and/or expiration.

Use this when a remembered fact has changed, needs correction, or needs an expiry. Do not create a duplicate memory for the same fact; update the existing one. \`name\` and \`type\` are immutable identifiers, so only \`content\` and \`expires\` can change.

Do NOT use this for ephemeral conversation updates, information already in code/git/docs/config, negative judgments, or secrets. Pass \`expires: null\` to clear an existing expiration.`,

  forget_memory: `Delete an existing durable memory entry and record a tombstone so it is not automatically re-saved.

Use this when the user asks you to forget something, when a memory is wrong and should not be retained, or when a fact is no longer useful. Prefer \`update_memory\` when the fact is still useful but needs correction.

Do NOT use this for normal short-term context cleanup; only durable memory entries should be forgotten.`,

  create_output: `Publish a first-class user-facing output from this session.

Use this when you have produced a durable deliverable or external-action receipt that the user should find later from the Outputs area instead of hunting through chat.

Good outputs include research reports, generated media, exported datasets, code review reports, deployment receipts, published-post receipts, sent-message receipts, and final workflow deliverables.

Do NOT use this for ordinary chat replies, scratch notes, temporary plans, or files that are not intended as final deliverables. Prefer one concise primary output over dumping every intermediate artifact.`,
} as const;

// ============================================================
// Tool Definition Type
// ============================================================

/** Handler function signature for session tools. */
export type SessionToolHandler = (ctx: SessionToolContext, args: any) => Promise<ToolResult>;

/** Where a session tool is executed. */
export type SessionToolExecutionMode = 'registry' | 'backend';

/** Safe/Explore mode behavior for a session tool. */
export type SessionToolSafeMode = 'allow' | 'block';

interface SessionToolDefBase {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  /** Whether this tool is allowed in Explore/Safe mode. */
  safeMode: SessionToolSafeMode;
  /** Whether this tool only reads data (no side effects). Enables parallel execution in backends that support it. */
  readOnly?: boolean;
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
  { name: 'SubmitPlan', description: TOOL_DESCRIPTIONS.SubmitPlan, inputSchema: SubmitPlanSchema, executionMode: 'registry', safeMode: 'allow', handler: handleSubmitPlan },
  { name: 'config_validate', description: TOOL_DESCRIPTIONS.config_validate, inputSchema: ConfigValidateSchema, executionMode: 'registry', safeMode: 'allow', readOnly: true, handler: handleConfigValidate },
  { name: 'skill_validate', description: TOOL_DESCRIPTIONS.skill_validate, inputSchema: SkillValidateSchema, executionMode: 'registry', safeMode: 'allow', readOnly: true, handler: handleSkillValidate },
  { name: 'mermaid_validate', description: TOOL_DESCRIPTIONS.mermaid_validate, inputSchema: MermaidValidateSchema, executionMode: 'registry', safeMode: 'allow', readOnly: true, handler: handleMermaidValidate },
  { name: 'source_test', description: TOOL_DESCRIPTIONS.source_test, inputSchema: SourceTestSchema, executionMode: 'registry', safeMode: 'allow', handler: handleSourceTest },
  { name: 'source_oauth_trigger', description: TOOL_DESCRIPTIONS.source_oauth_trigger, inputSchema: SourceOAuthTriggerSchema, executionMode: 'registry', safeMode: 'block', handler: handleSourceOAuthTrigger },
  { name: 'source_google_oauth_trigger', description: TOOL_DESCRIPTIONS.source_google_oauth_trigger, inputSchema: SourceOAuthTriggerSchema, executionMode: 'registry', safeMode: 'block', handler: handleGoogleOAuthTrigger },
  { name: 'source_slack_oauth_trigger', description: TOOL_DESCRIPTIONS.source_slack_oauth_trigger, inputSchema: SourceOAuthTriggerSchema, executionMode: 'registry', safeMode: 'block', handler: handleSlackOAuthTrigger },
  { name: 'source_microsoft_oauth_trigger', description: TOOL_DESCRIPTIONS.source_microsoft_oauth_trigger, inputSchema: SourceOAuthTriggerSchema, executionMode: 'registry', safeMode: 'block', handler: handleMicrosoftOAuthTrigger },
  { name: 'source_credential_prompt', description: TOOL_DESCRIPTIONS.source_credential_prompt, inputSchema: CredentialPromptSchema, executionMode: 'registry', safeMode: 'block', handler: handleCredentialPrompt },
  { name: 'update_user_preferences', description: TOOL_DESCRIPTIONS.update_user_preferences, inputSchema: UpdatePreferencesSchema, executionMode: 'registry', safeMode: 'block', handler: handleUpdatePreferences },
  { name: 'transform_data', description: TOOL_DESCRIPTIONS.transform_data, inputSchema: TransformDataSchema, executionMode: 'registry', safeMode: 'allow', handler: handleTransformData },
  { name: 'script_sandbox', description: TOOL_DESCRIPTIONS.script_sandbox, inputSchema: ScriptSandboxSchema, executionMode: 'registry', safeMode: 'allow', handler: handleScriptSandbox },
  { name: 'render_template', description: TOOL_DESCRIPTIONS.render_template, inputSchema: RenderTemplateSchema, executionMode: 'registry', safeMode: 'allow', handler: handleRenderTemplate },
  { name: 'send_developer_feedback', description: TOOL_DESCRIPTIONS.send_developer_feedback, inputSchema: SendDeveloperFeedbackSchema, executionMode: 'registry', safeMode: 'allow', handler: handleSendDeveloperFeedback },
  { name: 'call_llm', description: TOOL_DESCRIPTIONS.call_llm, inputSchema: CallLlmSchema, executionMode: 'backend', safeMode: 'allow', readOnly: true, handler: null },
  { name: 'spawn_session', description: TOOL_DESCRIPTIONS.spawn_session, inputSchema: SpawnSessionSchema, executionMode: 'backend', safeMode: 'block', handler: null },
  // Browser tool (backend-specific — requires BrowserPaneManager in Electron)
  // Single CLI-like tool that handles all browser actions via command string.
  { name: 'browser_tool', description: TOOL_DESCRIPTIONS.browser_tool, inputSchema: BrowserToolSchema, executionMode: 'backend', safeMode: 'allow', handler: null },
  // Session self-management tools (registry — use context callbacks to reach SessionManager)
  { name: 'set_session_labels', description: TOOL_DESCRIPTIONS.set_session_labels, inputSchema: SetSessionLabelsSchema, executionMode: 'registry', safeMode: 'block', handler: handleSetSessionLabels },
  { name: 'set_session_status', description: TOOL_DESCRIPTIONS.set_session_status, inputSchema: SetSessionStatusSchema, executionMode: 'registry', safeMode: 'block', handler: handleSetSessionStatus },
  { name: 'get_session_info', description: TOOL_DESCRIPTIONS.get_session_info, inputSchema: GetSessionInfoSchema, executionMode: 'registry', safeMode: 'allow', readOnly: true, handler: handleGetSessionInfo },
  { name: 'list_sessions', description: TOOL_DESCRIPTIONS.list_sessions, inputSchema: ListSessionsSchema, executionMode: 'registry', safeMode: 'allow', readOnly: true, handler: handleListSessions },
  { name: 'list_agents', description: TOOL_DESCRIPTIONS.list_agents, inputSchema: ListAgentsSchema, executionMode: 'registry', safeMode: 'allow', readOnly: true, handler: handleListAgents },
  { name: 'list_skills', description: TOOL_DESCRIPTIONS.list_skills, inputSchema: ListSkillsSchema, executionMode: 'registry', safeMode: 'allow', readOnly: true, handler: handleListSkills },
  { name: 'list_sources', description: TOOL_DESCRIPTIONS.list_sources, inputSchema: ListSourcesSchema, executionMode: 'registry', safeMode: 'allow', readOnly: true, handler: handleListSources },
  { name: 'list_workflows', description: TOOL_DESCRIPTIONS.list_workflows, inputSchema: ListWorkflowsSchema, executionMode: 'registry', safeMode: 'allow', readOnly: true, handler: handleListWorkflows },
  { name: 'get_workflow', description: TOOL_DESCRIPTIONS.get_workflow, inputSchema: GetWorkflowSchema, executionMode: 'registry', safeMode: 'allow', readOnly: true, handler: handleGetWorkflow },
  { name: 'start_workflow', description: TOOL_DESCRIPTIONS.start_workflow, inputSchema: StartWorkflowSchema, executionMode: 'registry', safeMode: 'block', handler: handleStartWorkflow },
  { name: 'get_workflow_run', description: TOOL_DESCRIPTIONS.get_workflow_run, inputSchema: GetWorkflowRunSchema, executionMode: 'registry', safeMode: 'allow', readOnly: true, handler: handleGetWorkflowRun },
  { name: 'cancel_workflow_run', description: TOOL_DESCRIPTIONS.cancel_workflow_run, inputSchema: CancelWorkflowRunSchema, executionMode: 'registry', safeMode: 'block', handler: handleCancelWorkflowRun },
  // Inter-session messaging
  { name: 'send_agent_message', description: TOOL_DESCRIPTIONS.send_agent_message, inputSchema: SendAgentMessageSchema, executionMode: 'registry', safeMode: 'block', handler: handleSendAgentMessage },
  // Messaging gateway tools
  { name: 'list_messaging_channels', description: TOOL_DESCRIPTIONS.list_messaging_channels, inputSchema: ListMessagingChannelsSchema, executionMode: 'registry', safeMode: 'allow', readOnly: true, handler: handleListMessagingChannels },
  { name: 'unbind_messaging_channel', description: TOOL_DESCRIPTIONS.unbind_messaging_channel, inputSchema: UnbindMessagingChannelSchema, executionMode: 'registry', safeMode: 'block', handler: handleUnbindMessagingChannel },
  // Creator skills — agent-creator structured write tool
  { name: 'create_agent', description: TOOL_DESCRIPTIONS.create_agent, inputSchema: CreateAgentSchema, executionMode: 'registry', safeMode: 'block', handler: handleCreateAgent },
  { name: 'create_automation', description: TOOL_DESCRIPTIONS.create_automation, inputSchema: CreateAutomationSchema, executionMode: 'registry', safeMode: 'block', handler: handleCreateAutomation },
  { name: 'save_memory', description: TOOL_DESCRIPTIONS.save_memory, inputSchema: SaveMemorySchema, executionMode: 'registry', safeMode: 'block', handler: handleSaveMemory },
  { name: 'update_memory', description: TOOL_DESCRIPTIONS.update_memory, inputSchema: UpdateMemorySchema, executionMode: 'registry', safeMode: 'block', handler: handleUpdateMemory },
  { name: 'forget_memory', description: TOOL_DESCRIPTIONS.forget_memory, inputSchema: ForgetMemorySchema, executionMode: 'registry', safeMode: 'block', handler: handleForgetMemory },
  { name: 'create_output', description: TOOL_DESCRIPTIONS.create_output, inputSchema: CreateOutputSchema, executionMode: 'registry', safeMode: 'block', handler: handleCreateOutput },
];

export interface SessionToolFilterOptions {
  /** Include the experimental send_developer_feedback tool. */
  includeDeveloperFeedback?: boolean;
}

/**
 * Return session tools with optional feature filtering.
 *
 * Callers should use this helper instead of filtering ad hoc so tool visibility
 * stays consistent across Claude, Pi, and session-mcp-server backends.
 */
export function getSessionToolDefs(options?: SessionToolFilterOptions): SessionToolDef[] {
  const includeDeveloperFeedback = options?.includeDeveloperFeedback ?? true;

  return SESSION_TOOL_DEFS.filter(def => {
    if (!includeDeveloperFeedback && def.name === 'send_developer_feedback') {
      return false;
    }
    return true;
  });
}

/**
 * Build a name->definition registry with optional feature filtering.
 */
export function getSessionToolRegistry(options?: SessionToolFilterOptions): Map<string, SessionToolDef> {
  return new Map(getSessionToolDefs(options).map(def => [def.name, def]));
}

/**
 * Return session tool names with optional feature filtering.
 */
export function getSessionToolNames(options?: SessionToolFilterOptions): Set<string> {
  return new Set(getSessionToolDefs(options).map(def => def.name));
}

/**
 * Return backend-executed tool names with optional feature filtering.
 */
export function getSessionBackendToolNames(options?: SessionToolFilterOptions): Set<string> {
  return new Set(getSessionToolDefs(options).filter(d => d.executionMode === 'backend').map(d => d.name));
}

/**
 * Return registry-executed tool names with optional feature filtering.
 */
export function getSessionRegistryToolNames(options?: SessionToolFilterOptions): Set<string> {
  return new Set(getSessionToolDefs(options).filter(d => d.executionMode === 'registry').map(d => d.name));
}

export interface SessionToolNameOptions extends SessionToolFilterOptions {
  /** Optional name prefix for consumers (e.g. 'mcp__session__'). */
  prefix?: string;
}

/**
 * Return session tool names that are allowed in Explore/Safe mode.
 */
export function getSessionSafeAllowedToolNames(options?: SessionToolNameOptions): Set<string> {
  const prefix = options?.prefix ?? '';
  return new Set(
    getSessionToolDefs(options)
      .filter(def => def.safeMode === 'allow')
      .map(def => `${prefix}${def.name}`)
  );
}

/**
 * Return session tool names that are blocked in Explore/Safe mode.
 */
export function getSessionSafeBlockedToolNames(options?: SessionToolNameOptions): Set<string> {
  const prefix = options?.prefix ?? '';
  return new Set(
    getSessionToolDefs(options)
      .filter(def => def.safeMode === 'block')
      .map(def => `${prefix}${def.name}`)
  );
}

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

/** Session tool names allowed in Explore/Safe mode (unfiltered canonical set). */
export const SESSION_SAFE_ALLOWED_TOOL_NAMES = new Set(
  SESSION_TOOL_DEFS.filter(d => d.safeMode === 'allow').map(d => d.name)
);

/** Session tool names blocked in Explore/Safe mode (unfiltered canonical set). */
export const SESSION_SAFE_BLOCKED_TOOL_NAMES = new Set(
  SESSION_TOOL_DEFS.filter(d => d.safeMode === 'block').map(d => d.name)
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
 * Convert session tool definitions to JSON Schema format.
 *
 * @param opts.prefix - Optional prefix for tool names (e.g., 'mcp__session__' for Pi)
 * @param opts.includeDeveloperFeedback - Include experimental feedback tool in output
 * @returns Array of tool definitions with JSON Schema inputSchema
 */
export function getToolDefsAsJsonSchema(opts?: {
  prefix?: string;
  includeDeveloperFeedback?: boolean;
}): JsonSchemaToolDef[] {
  const prefix = opts?.prefix || '';
  const defs = getSessionToolDefs({ includeDeveloperFeedback: opts?.includeDeveloperFeedback });

  return defs.map(def => {
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
