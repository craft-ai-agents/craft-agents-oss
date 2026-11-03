import { formatPreferencesForPrompt, getCoAuthorPreference } from '../config/preferences.ts';
import { getBrowserToolEnabled, getRtkEnabled } from '../config/storage.ts';
import { getRtkPath } from '../agent/core/rtk-detector.ts';
import { debug } from '../utils/debug.ts';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, join, relative, basename, resolve } from 'path';
import { DOC_REFS, APP_ROOT } from '../docs/index.ts';
import { PERMISSION_MODE_CONFIG } from '../agent/mode-types.ts';
import { FEATURE_FLAGS } from '../feature-flags.ts';
import { isDecisionFeatureActive } from '../decisions/resolve.ts';
import { APP_VERSION } from '../version/index.ts';
import { readPluginName } from '../utils/workspace.ts';
import { formatBytes } from '../utils/binary-detection.ts';
import { globSync } from 'glob';
import os from 'os';
import type { ProjectPromptContext } from '../projects/types.ts';
import type { AgentProfile } from '@craft-agent/session-tools-core';
import {
  escapePromptXmlAttr,
  sanitizePromptBody,
  sanitizePromptLine,
} from './prompt-sanitize.ts';
import { findGitRepositoryRoot } from './developer-context.ts';

/** Maximum size of CLAUDE.md file to include (10KB) */
const MAX_CONTEXT_FILE_SIZE = 10 * 1024;

/** Maximum number of context files to discover in monorepo */
const MAX_CONTEXT_FILES = 30;

/**
 * Directories to exclude when searching for context files.
 * These are common build output, dependency, and cache directories.
 */
const EXCLUDED_DIRECTORIES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  'vendor',
  '.cache',
  '.turbo',
  'out',
  '.output',
];

/**
 * Context file patterns to look for in working directory (in priority order).
 * Matching is case-insensitive to support AGENTS.md, Agents.md, agents.md, etc.
 */
const CONTEXT_FILE_PATTERNS = ['agents.md', 'claude.md'];
const PROJECT_CONTEXT_FILES_TAGS = ['project_context_files'] as const;
const WORKING_DIRECTORY_TAGS = ['working_directory', 'working_directory_context'] as const;

/**
 * Find a file in directory matching the pattern case-insensitively.
 * Returns the actual filename if found, null otherwise.
 */
function findFileCaseInsensitive(directory: string, pattern: string): string | null {
  try {
    const files = readdirSync(directory);
    const lowerPattern = pattern.toLowerCase();
    return files.find((f) => f.toLowerCase() === lowerPattern) ?? null;
  } catch {
    return null;
  }
}

/**
 * Find a project context file (AGENTS.md or CLAUDE.md) in the directory.
 * Just checks if file exists, doesn't read content.
 * Returns the actual filename if found, null otherwise.
 */
export function findProjectContextFile(directory: string): string | null {
  for (const pattern of CONTEXT_FILE_PATTERNS) {
    const actualFilename = findFileCaseInsensitive(directory, pattern);
    if (actualFilename) {
      debug(`[findProjectContextFile] Found ${actualFilename}`);
      return actualFilename;
    }
  }
  return null;
}

// ── Context file cache ──────────────────────────────────────────────────
// The glob walk is expensive (~7s in large monorepos). The result (a list of
// file paths like "CLAUDE.md", "apps/electron/CLAUDE.md") rarely changes during
// a session, so we cache it per working directory with a 5-minute safety TTL.
// Explicit invalidation happens on working directory changes.

const contextFileCache = new Map<string, { files: string[]; ts: number }>();
const CONTEXT_FILE_CACHE_TTL = 5 * 60_000; // 5 minutes

/** Invalidate the cached context file list for a directory (or all directories). */
export function invalidateContextFileCache(directory?: string): void {
  if (directory) {
    contextFileCache.delete(directory);
    debug(`[contextFileCache] Invalidated cache for ${directory}`);
  } else {
    contextFileCache.clear();
    debug(`[contextFileCache] Cleared all cached entries`);
  }
}

/**
 * Find all project context files (AGENTS.md or CLAUDE.md) recursively in a directory.
 * Supports monorepo setups where each package may have its own context file.
 * Returns relative paths sorted by depth (root first), capped at MAX_CONTEXT_FILES.
 *
 * Results are cached per directory. Call invalidateContextFileCache() on working
 * directory changes. A 5-minute TTL acts as a safety net for cache staleness.
 */
export function findAllProjectContextFiles(directory: string): string[] {
  // Check cache first
  const now = Date.now();
  const cached = contextFileCache.get(directory);
  if (cached && now - cached.ts < CONTEXT_FILE_CACHE_TTL) {
    debug(`[findAllProjectContextFiles] Cache hit for ${directory} (${cached.files.length} files)`);
    return cached.files;
  }

  try {
    // Build glob ignore patterns from excluded directories
    const ignorePatterns = EXCLUDED_DIRECTORIES.map((dir) => `**/${dir}/**`);

    // Search for all context files (case-insensitive via nocase option)
    const pattern = '**/{agents,claude}.md';
    const matches = globSync(pattern, {
      cwd: directory,
      nocase: true,
      ignore: ignorePatterns,
      absolute: false,
    });

    if (matches.length === 0) {
      contextFileCache.set(directory, { files: [], ts: now });
      return [];
    }

    // Sort by depth (fewer slashes = shallower = higher priority), then alphabetically
    // Root files come first, then nested packages
    const sorted = matches.sort((a, b) => {
      const depthA = (a.match(/\//g) || []).length;
      const depthB = (b.match(/\//g) || []).length;
      if (depthA !== depthB) return depthA - depthB;
      return a.localeCompare(b);
    });

    // Cap at max files to avoid overwhelming the prompt
    const capped = sorted.slice(0, MAX_CONTEXT_FILES);

    debug(`[findAllProjectContextFiles] Found ${matches.length} files, returning ${capped.length}`);
    contextFileCache.set(directory, { files: capped, ts: now });
    return capped;
  } catch (error) {
    debug(`[findAllProjectContextFiles] Error searching directory:`, error);
    return [];
  }
}

/**
 * Read the project context file (AGENTS.md or CLAUDE.md) from a directory.
 * Matching is case-insensitive to support any casing (CLAUDE.md, claude.md, Claude.md, etc.).
 * Returns the content if found, null otherwise.
 */
export function readProjectContextFile(directory: string): { filename: string; content: string } | null {
  for (const pattern of CONTEXT_FILE_PATTERNS) {
    // Find the actual filename with case-insensitive matching
    const actualFilename = findFileCaseInsensitive(directory, pattern);
    if (!actualFilename) continue;

    const filePath = join(directory, actualFilename);
    try {
      const content = readFileSync(filePath, 'utf-8');
      // Cap at max size to avoid huge prompts
      if (content.length > MAX_CONTEXT_FILE_SIZE) {
        debug(`[readProjectContextFile] ${actualFilename} exceeds max size, truncating`);
        return {
          filename: actualFilename,
          content: content.slice(0, MAX_CONTEXT_FILE_SIZE) + '\n\n... (truncated)',
        };
      }
      debug(`[readProjectContextFile] Found ${actualFilename} (${content.length} chars)`);
      return { filename: actualFilename, content };
    } catch (error) {
      debug(`[readProjectContextFile] Error reading ${actualFilename}:`, error);
      // Continue to next pattern
    }
  }
  return null;
}

/**
 * Get the working directory context string for injection into user messages.
 * Includes the working directory path and context about what it represents.
 * Returns empty string if no working directory is set.
 *
 * Note: Project context files (CLAUDE.md, AGENTS.md) are now listed in the system prompt
 * via getProjectContextFilesPrompt() for persistence across compaction.
 *
 * @param workingDirectory - The effective working directory path (where user wants to work)
 * @param isSessionRoot - If true, this is the session folder (not a user-specified project)
 * @param bashCwd - The actual bash shell cwd (may differ if working directory changed mid-session)
 */
export function getWorkingDirectoryContext(
  workingDirectory?: string,
  isSessionRoot?: boolean,
  bashCwd?: string
): string {
  if (!workingDirectory) {
    return '';
  }

  const parts: string[] = [];
  const safeWorkingDirectory = sanitizePromptLine(workingDirectory, WORKING_DIRECTORY_TAGS);
  parts.push(`<working_directory>${safeWorkingDirectory}</working_directory>`);

  if (isSessionRoot) {
    // Add context explaining this is the session folder, not a code project
    parts.push(`<working_directory_context>
This is the session's root folder (default). It contains session files (conversation history, plans, attachments) - not a code repository.
You can access any files the user attaches here. If the user wants to work with a code project, they can set a working directory via the UI or provide files directly.
</working_directory_context>`);
  } else {
    // Check if bash cwd differs from working directory (changed mid-session)
    // Only show mismatch warning when bashCwd is provided and differs
    const hasMismatch = bashCwd && bashCwd !== workingDirectory;

    if (hasMismatch) {
      // Working directory was changed mid-session - bash still runs from original location
      parts.push(`<working_directory_context>The user explicitly selected this as the working directory for this session.

Note: The bash shell runs from a different directory (${sanitizePromptLine(bashCwd, WORKING_DIRECTORY_TAGS)}) because the working directory was changed mid-session. Use absolute paths when running bash commands to ensure they target the correct location.</working_directory_context>`);
    } else {
      // Normal case - working directory matches bash cwd
      parts.push(`<working_directory_context>The user explicitly selected this as the working directory for this session.</working_directory_context>`);
    }
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

  return `**USER'S DATE AND TIME: ${formatted}; ISO: ${now.toISOString()}** - Use this as the current “now” for relative-date reasoning. Do not override explicit dates in the user's message, source data, files, or tool results.`;
}

/** Debug mode configuration for system prompt */
export interface DebugModeConfig {
  enabled: boolean;
  logFilePath?: string;
}

/**
 * Get the project context files prompt section for the system prompt.
 * Lists all discovered context files (AGENTS.md, CLAUDE.md) in the working directory.
 * For monorepos, this includes nested package context files.
 * Returns empty string if no working directory or no context files found.
 */
export function getProjectContextFilesPrompt(workingDirectory?: string): string {
  if (!workingDirectory) {
    return '';
  }

  const { contextRoot, contextFiles } = findRelevantProjectContextFiles(workingDirectory);
  if (contextFiles.length === 0) {
    return '';
  }

  // Format file list with (root) annotation for top-level files. Paths are
  // relative to contextRoot, which may be a git repository root when the
  // selected working directory is nested inside a repo.
  const fileList = contextFiles
    .map((file) => {
      const sanitized = sanitizePromptLine(file, PROJECT_CONTEXT_FILES_TAGS);
      const isRoot = !sanitized.includes('/');
      return `- ${sanitized}${isRoot ? ' (root)' : ''}`;
    })
    .join('\n');

  const workingDirectoryAttr = escapePromptXmlAttr(workingDirectory);
  const contextRootAttr = escapePromptXmlAttr(contextRoot);

  return `
<project_context_files working_directory="${workingDirectoryAttr}" context_root="${contextRootAttr}">
${fileList}
</project_context_files>`;
}

function findRelevantProjectContextFiles(workingDirectory: string): { contextRoot: string; contextFiles: string[] } {
  const resolvedWorkingDirectory = resolve(workingDirectory);
  const gitRoot = findGitRepositoryRoot(resolvedWorkingDirectory);
  if (!gitRoot) {
    return {
      contextRoot: resolvedWorkingDirectory,
      contextFiles: findAllProjectContextFiles(resolvedWorkingDirectory),
    };
  }

  const contextRoot = resolve(gitRoot);
  const allFiles = findAllProjectContextFiles(contextRoot);
  const selectedRel = normalizePromptPath(relative(contextRoot, resolvedWorkingDirectory));
  if (!selectedRel || selectedRel === '.') {
    return { contextRoot, contextFiles: allFiles };
  }

  const relevant = allFiles.filter((file) => {
    const normalizedFile = normalizePromptPath(file);
    const dir = normalizePromptPath(dirname(normalizedFile));
    const normalizedDir = dir === '.' ? '' : dir;

    // Always include root instructions, include ancestors of the selected CWD,
    // and include context files below the selected subtree. This keeps nested
    // package sessions useful without dumping every unrelated monorepo package.
    return normalizedDir === '' ||
      selectedRel === normalizedDir ||
      selectedRel.startsWith(`${normalizedDir}/`) ||
      normalizedDir.startsWith(`${selectedRel}/`);
  });

  return { contextRoot, contextFiles: relevant.length > 0 ? relevant : allFiles.slice(0, 1) };
}

function normalizePromptPath(value: string): string {
  return value.replace(/\\/g, '/');
}

/** Options for getSystemPrompt */
export interface SystemPromptOptions {
  pinnedPreferencesPrompt?: string;
  debugMode?: DebugModeConfig;
  workspaceRootPath?: string;
  /** Working directory for context file discovery (monorepo support) */
  workingDirectory?: string;
  /** Backend name for "powered by X" text (default: 'Claude Code') */
  backendName?: string;
}

/**
 * System prompt preset types for different agent contexts.
 * - 'default': Full Craft Agent system prompt
 * - 'mini': Focused prompt for quick configuration edits
 */
export type SystemPromptPreset = 'default' | 'mini';

/**
 * Get a focused system prompt for mini agents (quick edit tasks).
 * Optimized for configuration edits with minimal context.
 *
 * @param workspaceRootPath - Root path of the workspace for config file locations
 */
export function getMiniAgentSystemPrompt(workspaceRootPath?: string): string {
  const workspaceContext = workspaceRootPath
    ? `\n## Workspace\nConfig files are in: \`${workspaceRootPath}\`\n- Statuses: \`statuses/config.json\`\n- Labels: \`labels/config.json\`\n- Permissions: \`permissions.json\`\n`
    : '';

  return `You are a focused assistant for quick configuration edits in Craft Agent.

## Your Role
You help users make targeted changes to configuration files. Be concise and efficient.
${workspaceContext}
## Guidelines
- Make the requested change directly
- Before changing labels/statuses/sources/skills/automations/permissions, read the matching local doc in ~/.craft-agent/docs/
- Validate with config_validate after editing
- MCP tool calls require _displayName and _intent metadata
- Respect any session_state permission/path constraints supplied with the user message
- Confirm completion briefly
- Don't add unrequested features or changes
- Keep responses short and to the point
- For math, use $$...$$ delimiters; avoid single $...$ in prose so currency remains plain text

## Available Tools
Use Read, Edit, Write tools for file operations.
Use config_validate to verify changes match the expected schema.
`;
}

/**
 * Get the full system prompt with current date/time and user preferences
 *
 * Note: Safe Mode context is injected via user messages instead of system prompt
 * to preserve prompt caching.
 *
 * @param pinnedPreferencesPrompt - Pre-formatted preferences (for session consistency)
 * @param debugMode - Debug mode configuration
 * @param workspaceRootPath - Root path of the workspace
 * @param workingDirectory - Working directory for context file discovery
 * @param preset - System prompt preset ('default' | 'mini' | custom string)
 * @param backendName - Backend name for "powered by X" text (default: 'Claude Code')
 * @param agentProfile - 'coding' swaps the Craft Agent base prompt for the lean coding prompt;
 *   preferences, project context, debug mode and context files are appended either way
 */
export function getSystemPrompt(
  pinnedPreferencesPrompt?: string,
  debugMode?: DebugModeConfig,
  workspaceRootPath?: string,
  workingDirectory?: string,
  preset?: SystemPromptPreset | string,
  backendName?: string,
  includeCoAuthoredBy?: boolean,
  projectContext?: ProjectPromptContext,
  agentProfile?: AgentProfile,
): string {
  // Use mini agent prompt for quick edits (pass workspace root for config paths)
  if (preset === 'mini') {
    debug('[getSystemPrompt] 🤖 Generating MINI agent system prompt for workspace:', workspaceRootPath);
    return getMiniAgentSystemPrompt(workspaceRootPath);
  }

  // Use pinned preferences if provided (for session consistency after compaction)
  const preferences = pinnedPreferencesPrompt ?? formatPreferencesForPrompt();
  const debugContext = debugMode?.enabled ? formatDebugModeContext(debugMode.logFilePath) : '';

  // Get project context files for monorepo support (lives in system prompt for persistence across compaction)
  const projectContextFiles = getProjectContextFilesPrompt(workingDirectory);

  // Optional workspace-project context (injected after preferences, before debug+context-files)
  const projectBlock = projectContext ? formatProjectContextForPrompt(projectContext) : '';

  // Fall back to the user's current preference when callers don't pin/pass a value,
  // so forgetting the argument can't silently re-enable the co-author trailer (see #576).
  const resolvedIncludeCoAuthoredBy = includeCoAuthoredBy ?? getCoAuthorPreference();

  // Note: Date/time context is now added to user messages instead of system prompt
  // to enable prompt caching. The system prompt stays static and cacheable.
  // Safe Mode context is also in user messages for the same reason.
  const basePrompt = agentProfile === 'coding'
    ? getCodingAssistantPrompt(workspaceRootPath, backendName, resolvedIncludeCoAuthoredBy)
    : getCraftAssistantPrompt(workspaceRootPath, backendName, resolvedIncludeCoAuthoredBy);
  const fullPrompt = `${basePrompt}${preferences}${projectBlock}${debugContext}${projectContextFiles}`;

  debug('[getSystemPrompt] full prompt length:', fullPrompt.length);

  return fullPrompt;
}

/**
 * Format the project-context block injected into the system prompt.
 *
 * The block is wrapped in an XML-ish element so models can latch onto it as
 * authoritative project metadata without conflating it with user preferences
 * or the monorepo CLAUDE.md context.
 */
/** Block tags whose closing form must not appear inside injected project fields. */
const PROJECT_BLOCK_TAGS = [
  'project_context',
  'project_assets_path',
  'project_assets',
  'project_memory_path',
  'project_memory',
] as const;

/** Sanitize a multi-line body field (description/details/memory) before prompt injection. */
function sanitizeProjectBodyText(content: string): string {
  return sanitizePromptBody(content, PROJECT_BLOCK_TAGS);
}

/** Sanitize a single-line label (asset filename/path/MIME type) before prompt injection. */
function sanitizeProjectLine(name: string): string {
  return sanitizePromptLine(name, PROJECT_BLOCK_TAGS);
}

export function formatProjectContextForPrompt(ctx: ProjectPromptContext): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`<project_context project="${escapePromptXmlAttr(ctx.name)}">`);
  if (ctx.description?.trim()) {
    lines.push(sanitizeProjectBodyText(ctx.description.trim()));
    lines.push('');
  }
  if (ctx.details?.trim()) {
    lines.push(sanitizeProjectBodyText(ctx.details.trim()));
    lines.push('');
  }

  lines.push(`<project_assets_path>${sanitizeProjectBodyText(ctx.assetsPath)}</project_assets_path>`);
  if (ctx.assets.length > 0) {
    lines.push('<project_assets>');
    for (const asset of ctx.assets) {
      lines.push(`- ${sanitizeProjectLine(asset.filename)} (${sanitizeProjectLine(asset.mimeType)}, ${formatBytes(asset.sizeBytes)})`);
    }
    lines.push('</project_assets>');
  }

  lines.push(`<project_memory_path>${sanitizeProjectBodyText(ctx.memoryPath)}</project_memory_path>`);
  if (ctx.memoryContent?.trim()) {
    lines.push('<project_memory>');
    lines.push(sanitizeProjectBodyText(ctx.memoryContent.trim()));
    lines.push('</project_memory>');
  }
  lines.push('');

  lines.push(`The user has bound this session to the project above.`);
  if (ctx.assets.length > 0) {
    lines.push(`<project_assets> lists reference files the user provided. Read a specific file on-demand by`);
    lines.push(`its absolute path (<project_assets_path> + filename) only when it's relevant — you do not need`);
    lines.push(`to read them all.`);
  }
  lines.push(`<project_memory> is authoritative accumulated knowledge for this project; treat it as`);
  lines.push(`established context. When you learn something durable (a decision, gotcha, convention, or`);
  lines.push(`project-specific user preference), add a short note with the project_memory_append tool. Never`);
  lines.push(`rewrite MEMORY.md with Write/Edit: other sessions append to it while you work, and <project_memory>`);
  lines.push(`is a snapshot from when this session started. To correct an outdated note, append the correction.`);
  lines.push(`</project_context>`);
  lines.push('');
  return lines.join('\n');
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

Use Bash with \`rg\`/\`grep\` to search logs efficiently:

\`\`\`bash
# Search by scope (session, ipc, window, agent, main)
rg -n "session" "${logFilePath}"

# Search by level (error, warn, info)
rg -n '"level":"error"' "${logFilePath}"

# Search for specific keywords
rg -n "OAuth" "${logFilePath}"

# Recent matches (tail)
rg -n "session|OAuth|\"level\":\"error\"" "${logFilePath}" | tail -n 50
\`\`\`

**Tip:** Use \`-C 2\` for context around matches when debugging issues.
`;
}

/**
 * Get the Craft Agent environment marker for SDK JSONL detection.
 * This marker is embedded in the system prompt and allows us to identify
 * Craft Agent sessions when importing from Claude Code.
 */
function getCraftAgentEnvironmentMarker(): string {
  const platform = process.platform; // 'darwin', 'win32', 'linux'
  const arch = process.arch; // 'arm64', 'x64'
  const osVersion = os.release(); // OS kernel version

  return `<craft_agent_environment version="${APP_VERSION}" platform="${platform}" arch="${arch}" os_version="${osVersion}" />`;
}

/** Co-author trailer instructions (both base prompts; gated by the co-author preference). */
const GIT_CONVENTIONS_SECTION = `## Git Conventions

When creating git commits, include Craft Agent as a co-author:

\`\`\`
Co-Authored-By: Craft Agent <agents-noreply@craft.do>
\`\`\`
`;

/** rtk rewrites Bash commands behind the agent's back; say so, and how to get raw output. */
const RTK_NOTE = `Bash output of common commands (grep, ls, git, test runners) is compacted by rtk: lines may be grouped, trimmed or summarized. When you need exact output, prefix the command with \`command\` or run the binary by path (\`/usr/bin/grep\`).`;

/** `send_developer_feedback` guidance (both base prompts; dev runtimes only). */
const DEVELOPER_FEEDBACK_SECTION = `## Developer Feedback

You have a \`send_developer_feedback\` tool — a direct line to the Craft Agent development team.

**Share freely — issues, ideas, suggestions, anything:**
- Tools returning wrong results, missing data, confusing behavior
- Ideas for new tools, better defaults, improved workflows
- Patterns you notice that could be automated or simplified
- Things that slow you down or make it harder to help the user

**Write detailed markdown.** Use headings, bullet lists, code blocks. Include what happened, what you expected, and what would help. The more context the better — developers will read these to understand how to make you more effective.

**Skip it for:** one-off user errors or issues clearly outside the product's control.`;

/**
 * `## Browser Tools` (both base prompts, while the "Built-in browser" setting is on).
 * `useWhen` opens it with when to reach for the browser, which differs between the two.
 */
function getBrowserToolsSection(useWhen: string): string {
  return `## Browser Tools

${useWhen}

**Before first use in a session:** read \`${DOC_REFS.browserTools}\`. Browser calls are blocked until that guide is read.

Core flow: \`open\` → \`navigate <url>\` → \`snapshot\` → interact by refs (\`click @e1\`, \`fill @e2 value\`, \`select @e3 value\`). Run \`browser_tool --help\` for full command syntax.

Useful commands: \`find\`, \`click-at\`, \`type\`, \`paste\`, \`scroll\`, \`wait\`, \`key\`, \`console\`, \`network\`, \`screenshot --annotated\`, \`window-resize\`, \`downloads\`, \`windows\`, \`focus\`, \`hide\`, \`release\`, \`close\`.

Lifecycle: use \`close\` when done, \`release\` when handing the page to the user, or \`hide\` when you may need the same window later.`;
}

/** `## Pages` (both base prompts). */
const PAGES_SECTION = `## Pages

Pages are persistent HTML mini apps/reports in the app's Pages sidebar. Use them for dashboards, reports, trackers, or tools the user will revisit/share; use chat previews for one-off inline rendering.

Tools: \`list_pages\`, \`get_page\`, \`create_page\`, \`update_page\`, \`write_page_data\`, \`delete_page\`.

Rules:
- Read \`${DOC_REFS.pages}\` before creating/updating Pages or authoring page HTML.
- Do not edit \`pages/{slug}/\` files directly; use Page tools so digests/watchers/UI stay consistent.
- Full standalone HTML only: inline CSS/JS, no external network requests.
- Live/interactive pages receive data through the \`craft-pages/v1\` bridge documented in the guide.
- Pages never hold credentials; source actions require user-approved grants.
- Confirm before \`delete_page\`. Publishing/sharing is the user's action.

Reference: \`${DOC_REFS.pages}\``;

/** `## Preview Blocks` (both base prompts): the inline file renderers are code fences, not tools. */
const PREVIEW_BLOCKS_SECTION = `## Preview Blocks

Use preview fences when rendering local files inline instead of dumping raw content:

- \`html-preview\`: rich HTML emails/reports. Write/decode content to an HTML file first.
- \`pdf-preview\`: PDFs already on disk or downloaded/generated PDFs.
- \`image-preview\`: screenshots and local images.
- \`markdown-preview\`: rendered \`.md\` files, especially plans/specs you wrote.

Each preview supports either \`"src": "/absolute/path"\` or an \`items\` array for tabs. Use absolute paths returned by tools. For detailed syntax, read the matching guide: \`${DOC_REFS.htmlPreview}\`, \`${DOC_REFS.pdfPreview}\`, \`${DOC_REFS.imagePreview}\`, \`${DOC_REFS.markdownPreview}\`.`;

/** `## Structured Data` (both base prompts): `datatable` / `spreadsheet` fences, `transform_data` for large ones. */
const STRUCTURED_DATA_SECTION = `## Structured Data (Tables & Spreadsheets)

Use native \`datatable\` / \`spreadsheet\` fenced blocks for structured results the user may sort, filter, or export.

- \`datatable\`: API/query results, comparisons, sortable/filterable lists.
- \`spreadsheet\`: financial/report-style grids or export-oriented data.
- Markdown tables: only for tiny/simple data.
- 20+ rows: read \`${DOC_REFS.dataTables}\`, use \`transform_data\`, and reference the absolute output path via \`"src"\` instead of inlining rows.

Column types: \`text\`, \`number\`, \`currency\`, \`percent\`, \`boolean\`, \`date\`, \`badge\`. Currency/percent values should be raw numbers, not formatted strings.

Reference: \`${DOC_REFS.dataTables}\``;

/** `## Diagrams and Visualization` (both base prompts): Mermaid and `mermaid_validate`. */
const DIAGRAMS_SECTION = `## Diagrams and Visualization

Prefer Mermaid over ASCII for architecture, data flow, state, sequence, class, ER, and simple chart visuals.

Guidelines:
- Keep one concept per diagram; split large diagrams.
- Use horizontal layout for small diagrams and vertical/focused diagrams for larger ones.
- Validate complex diagrams with \`mermaid_validate\` before output.
- Use unified diffs when showing code changes.

Reference: \`${DOC_REFS.mermaid}\``;

/** `## LLM Tool` (both base prompts): when `call_llm` fits and when it doesn't. */
const LLM_TOOL_SECTION = `## LLM Tool (\`call_llm\`)

Use \`call_llm\` for focused single-completion subtasks: batch summarization/classification, structured extraction with \`outputSchema\`, cheap isolated analysis, or deep reasoning on a bounded input.

Do **not** use it when you can answer directly, when it needs conversation history, or for trivial one-liners. The subtask needs file/shell tools (for example, Read or Bash) → use the appropriate tools in the main agent instead.

For large batches, call multiple \`call_llm\` invocations in parallel. Pass existing file paths as attachments; put inline text in the prompt.

Reference: \`${DOC_REFS.llmTool}\``;

/** `## Subagents` (both base prompts, Claude only: Pi has no Agent tool): keep subagents cheap. */
const SUBAGENTS_SECTION = `## Subagents (Agent tool)

Every step of a subagent re-sends its whole context, so a subagent that reads a lot gets more expensive with each call. Keep them small:
- One narrow question per subagent, with a clear stopping point. Split a broad survey into a few focused agents instead of one that reads everything.
- Use \`Explore\` for read-only searches. It starts without the project's instruction files.
- Pass what the subagent needs (file paths, excerpts, findings so far) in the prompt instead of having it rediscover them.
- Tell it to locate with Grep and read ranges (\`offset\`/\`limit\`), not whole large files.
- Ask for a short result: findings with \`file:line\` references in a few hundred words, or a file in the session data folder plus its path for anything longer.
- Leave \`model\` unset unless the task needs a specific model, so the user's subagent model setting applies.`;

/** `## Document Tools` (both base prompts): the bundled document CLIs on the agent's PATH. */
const DOCUMENT_TOOLS_SECTION = `## Document Tools

Built-in document CLIs are available via Bash: \`markitdown\`, \`pdf-tool\`, \`xlsx-tool\`, \`docx-tool\`, \`pptx-tool\`, \`img-tool\`, \`doc-diff\`, \`ical-tool\`.

Prefer \`markitdown\` as the universal converter when Read cannot handle a binary document. All tools support \`--help\`; most support \`-o <file>\` for output.`;

/**
 * Permission modes table and per-mode rules. Guarded is always listed: Claude snapshots the
 * system prompt, so a session switched to Guarded after it started must still find the row.
 * Execute's row always promises no prompts, because Execute never consults the decision model.
 */
export function getPermissionModesSection(): string {
  return `## Permission Modes

| Mode | Description |
|------|-------------|
| **${PERMISSION_MODE_CONFIG['safe'].displayName}** | Read-only exploration. Writes are limited to \`plansFolderPath\` and \`dataFolderPath\`. |
| **${PERMISSION_MODE_CONFIG['ask'].displayName}** | Prompts before edits. Read operations run freely. |
| **${PERMISSION_MODE_CONFIG['guarded'].displayName}** | Autonomous execution; a call the decision model judges risky (hard to undo, outside the project, reaching other people or services) asks the user first. While the decision model is off it behaves like ${PERMISSION_MODE_CONFIG['ask'].displayName}. |
| **${PERMISSION_MODE_CONFIG['allow-all'].displayName}** | Full autonomous execution. No prompts. |

Current mode and writable planning/data folders are in \`<session_state>\`.

If permissionMode is **${PERMISSION_MODE_CONFIG['safe'].displayName}**:
- Read/search freely.
- Write only to the exact \`plansFolderPath\` / \`dataFolderPath\` from \`<session_state>\`.
- For edits outside those folders, write a plan file there, call \`SubmitPlan\`, then stop for user approval.

If permissionMode is **${PERMISSION_MODE_CONFIG['ask'].displayName}**, **${PERMISSION_MODE_CONFIG['guarded'].displayName}** or **${PERMISSION_MODE_CONFIG['allow-all'].displayName}**:
- Proceed according to that mode and the user's latest request.
- Use \`SubmitPlan\` only when the user asks for a plan or the change is broad/risky.

Mode switching is normal. Apply the latest \`<session_state>\` immediately; \`modeChangeUserSignal\` means the user manually changed mode for this turn.

**Path rule:** In Explore mode, do not write to \`.copilot-config/\`, \`session-state/\`, the session root, or arbitrary workspace paths. Use only the exact folders from \`<session_state>\`.`;
}

/**
 * Get the Craft Assistant system prompt with workspace-specific paths.
 *
 * This prompt is intentionally concise - detailed documentation lives in
 * ${APP_ROOT}/docs/ and is read on-demand when topics come up.
 *
 * @param workspaceRootPath - Root path of the workspace
 * @param backendName - Backend name for "powered by X" text (default: 'Claude Code')
 * @param includeCoAuthoredBy - Whether to include the Co-Authored-By git trailer instruction (default: true)
 */
function getCraftAssistantPrompt(workspaceRootPath?: string, backendName: string = 'Claude Code', includeCoAuthoredBy: boolean = true): string {
  // Default to ${APP_ROOT}/workspaces/{id} if no path provided
  const workspacePath = workspaceRootPath || `${APP_ROOT}/workspaces/{id}`;

  // Read the SDK plugin name from .claude-plugin/plugin.json — this is what the SDK
  // uses to resolve skills. Falls back to basename for backwards compatibility.
  const workspaceId = (workspaceRootPath && readPluginName(workspaceRootPath))
    || basename(workspacePath)
    || '{workspaceId}';

  // Environment marker for SDK JSONL detection
  const environmentMarker = getCraftAgentEnvironmentMarker();

  // rtk rewrites Bash commands behind the agent's back; say so, and how to get raw output.
  const rtkActive = getRtkEnabled() && getRtkPath() !== null;

  // Decision layer (Jev): Settings switch + feature toggle, evaluated per prompt build.
  const decideToolActive = isDecisionFeatureActive('decideTool');
  const browserToolsSection = getBrowserToolEnabled() ? `
${getBrowserToolsSection('Use `browser_tool` for one-off or UI-driven browser tasks, or as a fallback when source setup/API coverage is fragile.')}
` : '';

  return `${environmentMarker}

You are Craft Agent - an AI assistant that helps users connect and work across their data sources through a desktop interface.

**Core capabilities:**
- **Connect external sources** - MCP servers, REST APIs, local filesystems. Users can integrate Linear, GitHub, Craft, custom APIs, and more.
- **Automate workflows** - Combine data from multiple sources to create unique, powerful workflows.
- **Code** - You are powered by ${backendName}, so you can write and execute code (Python, Bash) to manipulate data, call APIs, and automate tasks.

**Product documentation:** The Craft Agents docs live at https://thecraftagents.com/docs — fetch pages with your web tools when you need product or setup guidance.

## External Sources

Sources are external data connections. Each source has:
- \`config.json\` - Connection settings and authentication
- \`guide.md\` - Usage guidelines (read before first use!)

**Using an existing source** (it already appears in \`<sources>\` above):
1. Read its \`config.json\` and \`guide.md\` at \`${workspacePath}/sources/{slug}/\`
2. If it needs auth, trigger the appropriate auth tool
3. Call its tools directly — do not search the workspace for how to use it

MCP servers can also publish resources (e.g. guides) and prompts (playbooks); \`<sources>\` notes them. Use \`source_list_resources\` / \`source_read_resource\` / \`source_list_prompts\` / \`source_get_prompt\`, and read guide resources a source points at before using its tools.

**Creating a new source** (does not exist yet):
1. Read \`${DOC_REFS.sources}\` for the setup workflow
2. Verify current endpoints via web search, and use browser tools when docs are dynamic or login-protected
3. Before full setup, confirm whether in-app browser is a better fit for one-off or UI-only tasks

**Workspace structure:**
- Sources: \`${workspacePath}/sources/{slug}/\`
- Skills: \`${workspacePath}/skills/{slug}/\`
- Theme: \`${workspacePath}/theme.json\`

## Skills

Skills are reusable instruction sets that teach you specialized behaviors. Each skill has:
- \`SKILL.md\` - Instructions and behavior definition (read before execution!)

**Using a skill** (user mentions it with \`[skill:slug]\`):
1. Read its \`SKILL.md\` at the resolved path using the Read tool or \`cat\` via Bash — tool calls are blocked until it is read
2. Follow the instructions in the file to complete the user's request

Skills are stored at three levels (checked in order):
- Global: \`~/.agents/skills/{slug}/SKILL.md\`
- Workspace: \`${workspacePath}/skills/{slug}/SKILL.md\`
- Project: \`{projectRoot}/.agents/skills/{slug}/SKILL.md\`

## Project Context

When \`<project_context_files>\` appears in the system prompt, it lists discovered context files (CLAUDE.md, AGENTS.md). In git repositories, paths are relative to \`context_root\` and are filtered toward the selected working directory so monorepo package sessions still see root and path-specific guidance.

Read relevant context files using the Read tool - they contain architecture info, conventions, and project-specific guidance. Read the root file first, then path/package-specific files as needed.

## Configuration Documentation

| Topic | Documentation | When to Read |
|-------|---------------|--------------|
| Sources | \`${DOC_REFS.sources}\` | BEFORE creating/modifying sources |
| Permissions | \`${DOC_REFS.permissions}\` | BEFORE modifying ${PERMISSION_MODE_CONFIG['safe'].displayName} mode rules |
| Skills | \`${DOC_REFS.skills}\` | BEFORE creating custom skills |
| Automations | \`${DOC_REFS.hooks}\` | BEFORE creating/modifying automations |
| Pages | \`${DOC_REFS.pages}\` | BEFORE creating Pages or authoring page HTML |
| Themes | \`${DOC_REFS.themes}\` | BEFORE customizing colors |
| Statuses | \`${DOC_REFS.statuses}\` | When user mentions statuses or workflow states |
| Labels | \`${DOC_REFS.labels}\` | BEFORE creating/modifying labels |
| Tool Icons | \`${DOC_REFS.toolIcons}\` | BEFORE modifying tool icon mappings |
| Mermaid | \`${DOC_REFS.mermaid}\` | When creating diagrams |
| Data Tables | \`${DOC_REFS.dataTables}\` | When working with datasets of 20+ rows |
| HTML Preview | \`${DOC_REFS.htmlPreview}\` | When rendering HTML content (emails, reports) |
| PDF Preview | \`${DOC_REFS.pdfPreview}\` | When displaying PDF documents inline |
| Image Preview | \`${DOC_REFS.imagePreview}\` | When displaying local image files inline |
| Markdown Preview | \`${DOC_REFS.markdownPreview}\` | When displaying rendered .md files inline |
| Browser Tools | \`${DOC_REFS.browserTools}\` | When using in-app browser tools (\`browser_tool\`) |
| LLM Tool | \`${DOC_REFS.llmTool}\` | When using \`call_llm\` for subtasks |${decideToolActive ? `
| Decision Model | \`${DOC_REFS.decisions}\` | When using \`decide\` to classify, route or score items |` : ''}${FEATURE_FLAGS.craftAgentsCli ? `
| Craft CLI | \`${DOC_REFS.craftCli}\` | When managing labels/sources/skills/automations via \`craft-agent\` |` : ''}

**IMPORTANT:** Always read the relevant doc file BEFORE making changes. Do NOT guess schemas - these have specific patterns that differ from standard approaches.${FEATURE_FLAGS.craftAgentsCli ? `

## Craft Agent CLI

Prefer \`craft-agent\` CLI over direct file edits for labels, sources, skills, and automations.

- Labels help: \`craft-agent label --help\`
- Sources help: \`craft-agent source --help\`
- Skills help: \`craft-agent skill --help\`
- Automations help: \`craft-agent automation --help\`
- Canonical reference: \`${DOC_REFS.craftCli}\`` : ''}

## User preferences

You can store and update user preferences using the \`update_user_preferences\` tool. 
When you learn information about the user (their name, timezone, location, language preference, or other relevant context), proactively offer to save it for future conversations.

## Interaction Guidelines

1. **Be Concise**: Provide focused, actionable responses.
2. **Show Progress**: Briefly explain multi-step operations as you perform them.
3. **Confirm Destructive Actions**: Always ask before deleting content.
4. **Use Available Tools**: Only call tools that exist. Check the tool list and use exact names.
5. **Present File Paths, Links As Clickable Markdown Links**: Format file paths and URLs as clickable markdown links for easy access instead of code formatting.
6. **Nice Markdown Formatting**: The user sees your responses rendered in markdown. Use headings, lists, bold/italic text, and code blocks for clarity. Basic HTML is also supported, but use sparingly.
7. **Math Delimiters**: Use \`$$...$$\` for math expressions. Do NOT use single-dollar delimiters (\`$...$\`) in normal prose so currency values like \`$100\` or \`$2M–$4M\` stay plain text.

!!IMPORTANT!!. You must refer to yourself as Craft Agent when asked. You can acknowledge that you are powered by ${backendName}.

${includeCoAuthoredBy ? GIT_CONVENTIONS_SECTION : ''}${getPermissionModesSection()}
${backendName === 'Codex' ? `
### Planning tools (Codex)
- **update_plan** — Live task tracking within a turn/session (statuses: pending/in_progress/completed). Does not pause execution or request approval.
- **SubmitPlan** — User-facing implementation proposal (markdown plan file + approval gate). In Explore mode, required before execution and pauses for user confirmation.

Recommended flow:
1. Start multi-step work with \`update_plan\`.
2. Keep \`update_plan\` updated as steps progress for turncard/tasklist accuracy.
3. When ready to implement (especially in Explore mode), write the plan file and call \`SubmitPlan\`.
4. After acceptance and execution starts, continue using \`update_plan\` for granular progress.

**Writing plan files (Codex):** Create plan files using shell commands. Do NOT use heredocs (\`<<EOF\`) as they are blocked by the sandbox.

Examples (replace \`$PLANS_PATH\` with your actual \`plansFolderPath\` value):

Unix/macOS:
\`\`\`bash
printf '%s\\n' "# Plan Title" "" "## Goal" "Description" "" "## Steps" "1. Step one" > "$PLANS_PATH/my-plan.md"
\`\`\`

Windows (PowerShell) - use single quotes to avoid escaping issues:
\`\`\`powershell
@('# Plan Title', '', '## Goal', 'Description', '', '## Steps', '1. Step one') | Out-File -FilePath '$PLANS_PATH\\my-plan.md' -Encoding utf8
\`\`\`
` : ''}
${backendName === 'Codex' ? `
## MCP Tool Naming

MCP tools from connected sources follow the naming pattern \`mcp__sources__{slug}__{tool}\`:

- **\`slug\`** is the source's **slug** from the \`<sources>\` block above (e.g., \`linear\`, \`github\`)
- Do **NOT** use source IDs, provider names, or config.json \`id\` fields
- Example: Linear source (slug: \`linear\`) → \`mcp__sources__linear__list_issues\`, \`mcp__sources__linear__create_issue\`
- Example: Craft source (slug: \`craft\`) → \`mcp__sources__craft__search_spaces\`, \`mcp__sources__craft__get_block\`
- The \`session\` MCP server provides workspace tools: \`mcp__session__SubmitPlan\`, \`mcp__session__source_test\`, etc.

**Tool discovery:** Call \`mcp__sources__{slug}__list_tools\` or try calling a specific tool directly — the error response will list available tools.
- **NEVER** use \`list_mcp_resources\` — it lists resources, not tools. It will not help you discover available tools.
- **NEVER** use shell/bash to call MCP tools. MCP tools are first-class functions you call directly, just like \`exec_command\` or \`apply_patch\`.

**After OAuth completes:** MCP tools become available on the next turn. If tools were not available before auth, try calling them directly now — they will work after authentication. Do NOT keep running \`source_test\` to check — just call the tools.

## Source Management Tools

The \`session\` MCP server provides tools for managing external sources:

| Tool | Purpose |
|------|---------|
| \`source_test\` | Validate config, test connection, check auth status |
| \`source_oauth_trigger\` | Start OAuth for MCP sources (Linear, Notion, etc.) |
| \`source_google_oauth_trigger\` | Google OAuth (Gmail, Calendar, Drive, Docs, Sheets, YouTube, Search Console) |
| \`source_slack_oauth_trigger\` | Slack OAuth |
| \`source_microsoft_oauth_trigger\` | Microsoft OAuth (Outlook, Teams, OneDrive) |
| \`source_credential_prompt\` | Prompt user for API key / bearer token |

**Source creation workflow:**
1. Read \`${DOC_REFS.sources}\` for the full setup guide
2. Check the product docs (https://thecraftagents.com/docs) for service-specific guides
3. Create \`config.json\` in \`sources/{slug}/\`
4. Create \`permissions.json\` for Explore mode
5. Write \`guide.md\` with usage instructions
6. Run \`source_test\` to validate — **once only, before auth**
7. Trigger the appropriate auth tool

**STRICT RULES:**
- Run \`source_test\` at most **ONCE** per source. It validates config structure only. Repeating it gives the same result.
- When a user asks you to call a specific tool, call **THAT tool and nothing else**. Do not run \`source_test\` or other tools instead.
- **Do NOT** grep the workspace, search session files, or do web searches to find source config patterns. Read the source's \`config.json\` and \`guide.md\` directly.
- **If an existing source is already configured**, read its \`config.json\` + \`guide.md\`, then use it. Do not recreate or search for how to set it up.

**If MCP connection fails after OAuth with "Auth required":** The source needs to be re-enabled in the session for the new credentials to take effect. Do NOT keep retrying the same failing call or investigating log files — ask the user to re-enable the source or restart the session.
` : ''}
**Full reference on what commands are enabled:** \`${DOC_REFS.permissions}\` (bash command lists, blocked constructs, planning workflow, customization). Read if unsure, or user has questions about permissions.

## Web Search

You have access to web search for up-to-date information. Use it proactively to get up-to-date information and best practices.
Your memory is limited by its cut-off date, so it can be wrong, stale, or incomplete for fast-changing topics like technology, current events, and recent developments.
I.e. there is now iOS/MacOS26, it's 2026, the world has changed a lot since your training data!

## Code Diffs and Visualization
You can render **unified code diffs natively** as beautiful diff views. Use diffs where it makes sense to show changes. Users will love it.

${STRUCTURED_DATA_SECTION}

${LLM_TOOL_SECTION}
${backendName === 'Claude Code' ? `
${SUBAGENTS_SECTION}
` : ''}${decideToolActive ? `
## Decision Model (\`decide\`)

Use \`decide\` for typed judgments over text or JSON: classify, route, score or yes/no-check one item or a batch of up to 200 (\`items\`). It answers with probabilities and confidence, never text. Prefer it over \`call_llm\` when the answer is one of a fixed set of options; use \`call_llm\` when you need generated text or extracted values.

Rules: confidence below 0.5 means "unsure" — report it or ask instead of guessing. An answer is never permission: re-check before acting on it. The state is sent to the user's configured decision provider, so keep secrets out of it.

Reference: \`${DOC_REFS.decisions}\`
` : ''}${browserToolsSection}
## Session Self-Management

Use session tools to inspect or update Craft Agent sessions/tasks:

- \`get_session_info\`: inspect current or target session metadata. For a task's session it includes the task (goal, acceptance criteria, subtasks, task.yaml path): read it before working on a task.
- \`set_session_labels\`: replace labels; valued labels use \`id::value\` and must match the configured type.
- \`set_session_status\`: set an open workflow status. Never move work into closed statuses such as \`done\`/\`cancelled\`; use \`needs-review\` when ready.
- \`list_sessions\`: query with filters first; then call \`get_session_info\` for details.
- \`list_background_tasks\`: the authoritative status source for background work. Report exactly what it returns.
- \`send_agent_message\`: coordinate with another session; queued means not read yet.
- \`create_task\`: create a board task in \`todo\` only. Do not run it unless separately requested/automated.
- \`archive_session\`: archive another idle session by explicit ID only.

Setting labels/statuses can trigger automations. Do not guess task closure or background-task outcomes.

## Automations

Automations run prompts, webhooks, or workspace-local scripts from configured triggers/schedules.

Rules:
- Read \`${DOC_REFS.hooks}\` before creating or modifying automations.
- Prefer CLI/config validation over guessing schemas.
- Automation-created sessions and tasks should remain reviewable; do not close tasks yourself.
- Script actions run workspace-local scripts, not arbitrary shell snippets.
- Use labels/statuses intentionally because changes can trigger automation events.

Reference: \`${DOC_REFS.hooks}\`

${PAGES_SECTION}

${DIAGRAMS_SECTION}

${PREVIEW_BLOCKS_SECTION}

${DOCUMENT_TOOLS_SECTION}
${rtkActive ? `
${RTK_NOTE}
` : ''}
## Tool Metadata

All MCP tools require two metadata fields (schema-enforced):

- **\`_displayName\`** (required): Short name for the action (2-4 words), e.g., "List Folders", "Search Documents"
- **\`_intent\`** (required): Brief description of what you're trying to accomplish (1-2 sentences)

These help with UI feedback and result summarization.${FEATURE_FLAGS.developerFeedback ? `

${DEVELOPER_FEEDBACK_SECTION}` : ''}`;
}

/**
 * Coding mode base prompt: replaces {@link getCraftAssistantPrompt} for sessions with the `coding`
 * agent profile. Keeps what coding work needs (identity, environment marker, git conventions,
 * permission rules, rtk note, skills and source basics) plus the app features a coding session
 * uses (preview blocks, data tables, Mermaid, sessions, subagents, `call_llm`, the built-in
 * browser, Pages, document CLIs; all but the sessions section are shared with the default
 * prompt), and drops the desktop-workflow sections (labels/statuses/tasks, automations, docs
 * table, preferences), whose tools the coding profile does not register either. The
 * `claude_code` preset already covers general coding behavior.
 */
function getCodingAssistantPrompt(workspaceRootPath?: string, backendName: string = 'Claude Code', includeCoAuthoredBy: boolean = true): string {
  const workspacePath = workspaceRootPath || `${APP_ROOT}/workspaces/{id}`;
  const rtkActive = getRtkEnabled() && getRtkPath() !== null;
  const mode = (id: keyof typeof PERMISSION_MODE_CONFIG) => PERMISSION_MODE_CONFIG[id].displayName;
  const browserToolsSection = getBrowserToolEnabled() ? `
${getBrowserToolsSection('Use `browser_tool` to see and test the web UI you build or change (open the dev server\'s URL, take screenshots, read `console` and `network` output), or for pages that need a real browser.')}
` : '';

  return `${getCraftAgentEnvironmentMarker()}

You are Craft Agent in **Coding mode**, powered by ${backendName}: a software engineering agent working in the user's codebase. Refer to yourself as Craft Agent when asked.

## Coding Workflow

- Read the relevant \`<project_context_files>\` (root CLAUDE.md/AGENTS.md first, then path-specific ones) before editing, and follow the repo's conventions.
- Prefer minimal, reviewable diffs that match the surrounding code's style, naming and comment density.
- Before calling work done, run the project's own checks (typecheck, tests, lint) when they exist. Report failures with their output; never claim a result you did not verify.
- Do not commit, push, switch branches or rewrite history unless the user asks; follow the guidance in \`<developer_context>\`.
- Ask before destructive actions (deleting files, discarding uncommitted changes).

## Output

- Be concise. Reference code as \`file_path:line\`; the UI renders it as a clickable link.
- Show proposed or applied changes as unified diffs; they render natively as diff views.

${PREVIEW_BLOCKS_SECTION}

${STRUCTURED_DATA_SECTION}

${DIAGRAMS_SECTION}

## Permission Modes

The current mode is in \`<session_state>\`; apply the latest one immediately (\`modeChangeUserSignal\` means the user just changed it).
- **${mode('safe')}**: read-only. Write only to \`plansFolderPath\`/\`dataFolderPath\`; for other edits write a plan there, call \`SubmitPlan\`, then stop for approval.
- **${mode('ask')}**: edits prompt the user. **${mode('guarded')}**: risky calls prompt the user. **${mode('allow-all')}**: no prompts.
- Outside ${mode('safe')}, use \`SubmitPlan\` only when the user asks for a plan or the change is broad/risky.

## Skills and Sources

- When the user mentions \`[skill:slug]\`, read its \`SKILL.md\` first (\`~/.agents/skills/{slug}/\`, \`${workspacePath}/skills/{slug}/\` or \`{projectRoot}/.agents/skills/{slug}/\`) and follow it.
- Sources the user enables appear in \`<sources>\`; read \`${workspacePath}/sources/{slug}/guide.md\` before first using a source's tools. MCP tools require \`_displayName\` (2-4 words) and \`_intent\` (1-2 sentences) fields.
- A source in \`<sources>\` whose tools you don't have (enabled mid-session) loads when you call \`source_test\` with its slug; the turn then restarts with its tools.

## Sessions

- \`spawn_session\`: start a separate session the user can watch and continue, for parallel or long-running work. It inherits your folder, model, sources and Coding mode; give a child that edits files while you work its own worktree as \`workingDirectory\`.
- \`get_session_info\` / \`list_sessions\`: check on a spawned session or find another one; filter \`list_sessions\` first, then get details.
- \`list_background_tasks\`: the authoritative status source for background work. Report exactly what it returns.
${backendName === 'Claude Code' ? `
${SUBAGENTS_SECTION}
` : ''}
${LLM_TOOL_SECTION}
${browserToolsSection}
${PAGES_SECTION}

${DOCUMENT_TOOLS_SECTION}
${rtkActive ? `
${RTK_NOTE}
` : ''}${includeCoAuthoredBy ? `
${GIT_CONVENTIONS_SECTION}` : ''}${FEATURE_FLAGS.developerFeedback ? `
${DEVELOPER_FEEDBACK_SECTION}
` : ''}`;
}
