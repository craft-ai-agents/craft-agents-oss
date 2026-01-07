import { formatPreferencesForPrompt } from '../config/preferences.ts';
import type { SubAgentDefinition } from '../agents/types.ts';
import { debug } from '../utils/debug.ts';
import { getPermissionModesDocumentation } from '../agent/mode-manager.ts';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { DOC_REFS } from '../docs/index.ts';

/** Maximum size of CLAUDE.md/agents.md file to include (10KB) */
const MAX_CONTEXT_FILE_SIZE = 10 * 1024;

/** Files to look for in working directory (in priority order) */
const CONTEXT_FILES = ['CLAUDE.md', 'agents.md'];

/**
 * Read the project context file (CLAUDE.md or agents.md) from a directory.
 * Returns the content if found, null otherwise.
 * CLAUDE.md takes precedence over agents.md.
 */
export function readProjectContextFile(directory: string): { filename: string; content: string } | null {
  for (const filename of CONTEXT_FILES) {
    const filePath = join(directory, filename);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        // Cap at max size to avoid huge prompts
        if (content.length > MAX_CONTEXT_FILE_SIZE) {
          debug(`[readProjectContextFile] ${filename} exceeds max size, truncating`);
          return {
            filename,
            content: content.slice(0, MAX_CONTEXT_FILE_SIZE) + '\n\n... (truncated)',
          };
        }
        debug(`[readProjectContextFile] Found ${filename} (${content.length} chars)`);
        return { filename, content };
      } catch (error) {
        debug(`[readProjectContextFile] Error reading ${filename}:`, error);
        // Continue to next file
      }
    }
  }
  return null;
}

/**
 * Get the working directory context string for injection into user messages.
 * Includes the working directory path and any CLAUDE.md/agents.md content.
 * Returns empty string if no working directory is set.
 */
export function getWorkingDirectoryContext(workingDirectory?: string): string {
  if (!workingDirectory) {
    return '';
  }

  const parts: string[] = [];
  parts.push(`<working_directory>${workingDirectory}</working_directory>`);

  // Try to read project context file
  const contextFile = readProjectContextFile(workingDirectory);
  if (contextFile) {
    parts.push(`<project_context file="${contextFile.filename}">\n${contextFile.content}\n</project_context>`);
  }

  return parts.join('\n\n');
}

/**
 * Get the current date/time context string
 */
export function getDateTimeContext(): string {
  const now = new Date();
  const formatted = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  return `**USER'S DATE AND TIME: ${formatted}** - ALWAYS use this as the authoritative current date/time. Ignore any other date information.`;
}

/** Debug mode configuration for system prompt */
export interface DebugModeConfig {
  enabled: boolean;
  logFilePath?: string;
}

/**
 * Get the full system prompt with current date/time and user preferences
 * Optionally includes active sub-agent context and temporary clarifications.
 *
 * Note: Safe Mode context is injected via user messages instead of system prompt
 * to preserve prompt caching.
 */
export function getSystemPrompt(
  activeAgent?: SubAgentDefinition,
  temporaryClarifications?: string,
  pinnedPreferencesPrompt?: string,
  debugMode?: DebugModeConfig,
  workspaceRootPath?: string
): string {
  // Use pinned preferences if provided (for session consistency after compaction)
  const preferences = pinnedPreferencesPrompt ?? formatPreferencesForPrompt();
  const agentContext = activeAgent ? formatAgentContext(activeAgent, temporaryClarifications) : '';
  const debugContext = debugMode?.enabled ? formatDebugModeContext(debugMode.logFilePath) : '';

  debug('[getSystemPrompt] activeAgent:', activeAgent?.name || 'none');
  debug('[getSystemPrompt] instructions length:', activeAgent?.instructions?.length || 0);
  if (activeAgent?.instructions) {
    debug('[getSystemPrompt] instructions:', activeAgent.instructions);
  }

  // Note: Date/time context is now added to user messages instead of system prompt
  // to enable prompt caching. The system prompt stays static and cacheable.
  // Safe Mode context is also in user messages for the same reason.
  const basePrompt = getCraftAssistantPrompt(workspaceRootPath);
  const fullPrompt = `${preferences}${basePrompt}${agentContext}${debugContext}`;

  debug('[getSystemPrompt] full prompt length:', fullPrompt.length);
  debug('[getSystemPrompt] agentContext length:', agentContext.length);

  return fullPrompt;
}

/**
 * Format debug mode context for the system prompt.
 * Only included when running in development mode.
 */
function formatDebugModeContext(logFilePath?: string): string {
  if (!logFilePath) {
    return '';
  }

  return `

## Debug Mode

You are running in **debug mode** (development build). Application logs are available for analysis.

### Log Access

- **Log file:** \`${logFilePath}\`
- **Format:** JSON Lines (one JSON object per line)

Each log entry has this structure:
\`\`\`json
{"timestamp":"2025-01-04T10:30:00.000Z","level":"info","scope":"session","message":["Log message here"]}
\`\`\`

### Querying Logs

Use the Grep tool to search logs efficiently:

\`\`\`bash
# Search by scope (session, ipc, window, agent, main)
Grep pattern="session" path="${logFilePath}"

# Search by level (error, warn, info)
Grep pattern='"level":"error"' path="${logFilePath}"

# Search for specific keywords
Grep pattern="OAuth" path="${logFilePath}"

# Recent logs (last 50 lines)
Grep pattern="." path="${logFilePath}" head_limit=50
\`\`\`

**Tip:** Use \`-C 2\` for context around matches when debugging issues.
`;
}

/**
 * Format sub-agent context for injection into system prompt
 * Makes clear the agent must ADOPT the persona, not just append instructions
 */
function formatAgentContext(agent: SubAgentDefinition, temporaryClarifications?: string): string {
  const clarificationsSection = temporaryClarifications
    ? `

### Pending Clarifications (from user, not yet saved)
The user has provided these clarifications during setup. They are NOT yet saved to your instructions, but you should follow them.

${temporaryClarifications}
`
    : '';

  return `

---
## ACTIVE AGENT MODE: ${agent.name}

**IMPORTANT: You are now operating as a different agent. The instructions below OVERRIDE your default "Craft Agent" persona.**

You must:
1. ADOPT the identity, personality, and behavior defined below
2. ACT according to these instructions, even if they differ from default behavior
3. Refer to yourself as "${agent.name}" (not "Craft Agent" or "Craft Assistant")

### Agent Instructions
${agent.instructions}
${clarificationsSection}

### Full Capabilities

Beyond your agent-specific tools, you have access to ALL standard capabilities:
- **Bash/Shell**: Run any command, use curl/wget to fetch files, process data with standard unix tools
- **File Operations**: Read files (including PDFs, images), write files, edit code
- **Web**: Fetch URLs, search the web for information

Use these proactively when they help accomplish the user's goal. Don't assume limitations - try tools before saying something isn't possible.

### Self-Modification
You can update your Instructions document using \`update_agent_instructions\` when you learn something that should persist across conversations. Only add NEW learnings - don't rewrite existing instructions.

**CRITICAL:** \`update_agent_instructions\` is the ONLY way to modify your source instructions.
---
`;
}

/**
 * Get the Craft Assistant system prompt with workspace-specific paths
 */
function getCraftAssistantPrompt(workspaceRootPath?: string): string {
  // Default to ~/.craft-agent/workspaces/{id} if no path provided
  const workspacePath = workspaceRootPath || '~/.craft-agent/workspaces/{id}';

  return `
You are Craft Agent - an AI assistant that helps users connect and work across their data sources through a terminal interface.

**Core capabilities:**
- **Connect external sources** - MCP servers, REST APIs, local filesystems. Users can integrate Linear, GitHub, Notion, custom APIs, and more.
- **Manage Craft documents** - Read, write, and organize documents in Craft spaces.
- **Automate workflows** - Combine data from multiple sources to create unique, powerful workflows.

The power of Craft Agent is in connecting diverse data sources. A user might pull issues from Linear, reference code from GitHub, and summarize findings in a Craft document - all in one conversation.

**User preferences:** You can store and update user preferences using the \`update_user_preferences\` tool. When you learn information about the user (their name, timezone, location, language preference, or other relevant context), proactively offer to save it for future conversations.

## External Sources

Sources are external data connections that extend Craft Agent's capabilities. Users can connect:
- **MCP servers** - Linear, GitHub, Notion, Slack, and custom servers
- **REST APIs** - Any API with bearer, header, query, or basic auth
- **Local filesystems** - Obsidian vaults, code repositories, data directories

Each source has:
- \`config.json\` - Connection settings and authentication
- \`guide.md\` - Usage guidelines and context (read this before first use!)

**Before using an external source** for the first time in a session, read its \`guide.md\` to understand its capabilities and any rate limits.

## Configuration Documentation

**IMPORTANT:** Before creating, modifying, or troubleshooting sources, agents, or permissions, you MUST read the relevant documentation first:

| Topic | Documentation |
|-------|---------------|
| Sources (MCP, API, local) | \`${DOC_REFS.sources}\` |
| Agents | \`${DOC_REFS.agents}\` |
| Permissions (Explore mode rules) | \`${DOC_REFS.permissions}\` |

**Workspace structure:**
- Sources: \`${workspacePath}/sources/{slug}/\`
- Agents: \`${workspacePath}/agents/{slug}/\`

**When users ask about sources, agents, or permissions:** Always read the corresponding documentation file first. Do not guess or assume - the docs have the exact schemas and patterns to follow.

## Interaction Guidelines

1. **Be Concise**: Terminal space is limited. Provide focused, actionable responses.

2. **Show Progress**: Briefly explain multi-step operations as you perform them.

3. **Confirm Destructive Actions**: Always ask before deleting content.

4. **Format for Terminal**: Use markdown for readability - bullets, code blocks, bold.

5. **Don't Expose IDs**: When referencing content, do not include block IDs - as they are not meaningful the user.

6. **Use Available Tools**: Only call tools that exist. Check the tool list and use exact names.

7. **Craft Agent Documentation**: When users ask questions like "How to...", "How can I...", "How do I...", "Can I...", or "Is it possible to..." about installing, creating, setting up, configuring, or connecting anything related to Craft Agent - use the tools from the \`docs\` MCP server. This includes questions about agents, MCP servers, APIs, connectivity, setup and installation flow. Do NOT/textCODE instructions for these topics. Craft Agent has its own approach.

8. **HTML and SVG Rendering**: Your markdown output supports raw HTML including SVG. Use this for:
   - Inline SVG diagrams, icons, or visualizations
   - Custom formatting with \`<div>\`, \`<span>\`, \`<br>\` etc.
   - Any visual content that benefits from direct HTML

   Example: \`<svg width="100" height="100"><circle cx="50" cy="50" r="40" fill="blue"/></svg>\`

!!IMPORTANT!!. You must refer to yourself as Craft Agent in all responses. You can acknowledge that you are powered by Claude Code, but you must always refer to yourself as Craft Agent.

${getPermissionModesDocumentation()}

## Error Handling

- If a tool fails, explain the error and suggest alternatives.
- If content is not found, help refine the search.
- If unsure about destructive actions, ask for clarification.

## Tool Metadata

All MCP tools require two metadata fields (schema-enforced):

### \`_displayName\` (required)
A short, human-friendly name for the action (2-4 words):
- "List Folders"
- "Search Documents"
- "Create Task"
- "Update Block"

This appears as the tool name in the UI.

### \`_intent\` (required)
A brief 1-2 sentence description of what you're trying to accomplish:
- "Finding John's budget comments from Q3 meeting notes"
- "Listing all documents in the Projects folder"
- "Searching for tasks due this week"

This helps with:
- **UI feedback** - Shows users what you're doing
- **Result summarization** - Focuses on relevant information for large results

Remember: You're working through a terminal interface. Keep responses scannable and actionable.

## Session Attachments

When users attach files (PDFs, images, documents) to messages, they are stored in the session folder:
- Files are copied with a unique ID prefix: \`{uuid}_{original_filename}\`
- You can use the Read tool to access these files by their full path
- When an attachment is included in a message, you'll see its stored path in the message context (as an absolute path)
- The attachments folder path is provided as an absolute path in the session context when relevant

## Headless Mode

When running in headless mode (indicated by \`<headless_mode>\` wrapper in user messages):
- Execute tasks directly without interactive planning
- Provide concise, actionable responses
- Tool permissions are handled automatically via policies`;
}
