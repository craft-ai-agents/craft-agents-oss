#!/usr/bin/env bun
/**
 * Standalone utility to view and upload Claude Agent SDK transcripts to Langsmith.
 *
 * Usage:
 *   bun tools/langsmith-upload.ts                     # List recent sessions (uses last by default)
 *   bun tools/langsmith-upload.ts view [sessionId]    # View session (last if omitted)
 *   bun tools/langsmith-upload.ts upload [sessionId]  # Upload to Langsmith (last if omitted)
 *
 * Environment:
 *   LANGSMITH_API_KEY    - Required for upload
 *   LANGSMITH_ENDPOINT   - Optional, defaults to https://api.smith.langchain.com
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

// ============================================================================
// Types
// ============================================================================

interface SDKMessage {
  type: 'user' | 'assistant' | 'queue-operation' | 'file-history-snapshot';
  sessionId?: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  requestId?: string;
  gitBranch?: string;
  cwd?: string;
  message?: {
    role: string;
    model?: string;
    content: ContentBlock[] | string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  toolUseResult?: unknown;
  isApiErrorMessage?: boolean;
  error?: string;
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | ContentBlock[];
}

interface LangsmithRun {
  id: string;
  name: string;
  run_type: 'llm' | 'tool' | 'chain';
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error?: string;
  start_time: string;
  end_time?: string;
  parent_run_id?: string;
  session_name?: string;
  extra?: Record<string, unknown>;
}

interface SessionInfo {
  id: string;
  path: string;
  mtime: Date;
  size: number;
  branch?: string;
}

// ============================================================================
// Session Discovery
// ============================================================================

function getSessionsDir(): string {
  // Find the sessions directory for the current project
  const cwd = process.cwd();
  const encodedPath = cwd.replace(/\//g, '-');
  return join(homedir(), '.claude', 'projects', encodedPath);
}

function listSessions(limit = 10): SessionInfo[] {
  const dir = getSessionsDir();

  try {
    const files = readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const path = join(dir, f);
        const stats = statSync(path);
        const id = basename(f, '.jsonl');

        // Read first few lines to get branch info
        let branch: string | undefined;
        try {
          const content = readFileSync(path, 'utf-8');
          const firstLine = content.split('\n').find(l => l.includes('"gitBranch"'));
          if (firstLine) {
            const parsed = JSON.parse(firstLine);
            branch = parsed.gitBranch;
          }
        } catch {
          // Ignore parsing errors
        }

        return {
          id,
          path,
          mtime: stats.mtime,
          size: stats.size,
          branch,
        };
      })
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
      .slice(0, limit);

    return files;
  } catch {
    return [];
  }
}

function findSession(idPrefix?: string): SessionInfo | null {
  const sessions = listSessions(100);

  if (!idPrefix) {
    // Return the most recent session
    return sessions[0] || null;
  }

  // Find by prefix match
  const match = sessions.find(s => s.id.startsWith(idPrefix));
  return match || null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDate(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ============================================================================
// Parsing
// ============================================================================

function parseSession(path: string): SDKMessage[] {
  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n').filter(Boolean);

  return lines
    .map(line => {
      try {
        return JSON.parse(line) as SDKMessage;
      } catch {
        return null;
      }
    })
    .filter((m): m is SDKMessage =>
      m !== null &&
      m.type !== 'queue-operation' &&
      m.type !== 'file-history-snapshot'
    );
}

/**
 * Normalize content to array format (handles string content)
 */
function normalizeContent(content: ContentBlock[] | string | undefined): ContentBlock[] {
  if (!content) return [];
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  return content;
}

// ============================================================================
// Conversion to Langsmith Format
// ============================================================================

function convertToLangsmithRuns(messages: SDKMessage[], sessionId: string): LangsmithRun[] {
  const runs: LangsmithRun[] = [];
  const messageMap = new Map<string, SDKMessage>();
  const toolResults = new Map<string, { result: unknown; timestamp: string }>();

  // Build lookup maps
  for (const msg of messages) {
    if (msg.uuid) {
      messageMap.set(msg.uuid, msg);
    }

    // Collect tool results
    if (msg.type === 'user' && msg.message?.content) {
      const content = normalizeContent(msg.message.content);
      for (const block of content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          toolResults.set(block.tool_use_id, {
            result: block.content || msg.toolUseResult,
            timestamp: msg.timestamp || '',
          });
        }
      }
    }
  }

  // Create a root chain run for the session
  const firstMsg = messages.find(m => m.timestamp);
  const lastMsg = [...messages].reverse().find(m => m.timestamp);

  const chainRun: LangsmithRun = {
    id: sessionId,
    name: 'session',
    run_type: 'chain',
    inputs: { session_id: sessionId },
    outputs: {},
    start_time: firstMsg?.timestamp || new Date().toISOString(),
    end_time: lastMsg?.timestamp,
  };
  runs.push(chainRun);

  // Process assistant messages
  for (const msg of messages) {
    if (msg.type !== 'assistant' || !msg.message?.content || !msg.uuid) continue;
    if (msg.isApiErrorMessage) continue;

    const content = normalizeContent(msg.message.content);

    // Create LLM run
    const textContent = content
      .filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
      .map(b => b.text)
      .join('');

    const toolUses = content.filter(
      (b): b is ContentBlock & { type: 'tool_use' } => b.type === 'tool_use'
    );

    // Find the user message that triggered this response
    const parentMsg = msg.parentUuid ? messageMap.get(msg.parentUuid) : null;
    const parentContent = normalizeContent(parentMsg?.message?.content);
    const userInput = parentContent
      .filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
      .map(b => b.text)
      .join('');

    const llmRun: LangsmithRun = {
      id: msg.uuid,
      name: msg.message.model || 'claude',
      run_type: 'llm',
      inputs: {
        messages: userInput ? [{ role: 'user', content: userInput }] : [],
      },
      outputs: {
        content: textContent,
        tool_calls: toolUses.map(t => ({ id: t.id, name: t.name, input: t.input })),
      },
      start_time: msg.timestamp || '',
      parent_run_id: sessionId,
      extra: {
        model: msg.message.model,
        request_id: msg.requestId,
        usage: msg.message.usage,
      },
    };

    // Find end time from next message or tool result
    const nextMsgIndex = messages.indexOf(msg) + 1;
    if (nextMsgIndex < messages.length) {
      llmRun.end_time = messages[nextMsgIndex].timestamp;
    }

    runs.push(llmRun);

    // Create tool runs
    for (const toolUse of toolUses) {
      if (!toolUse.id) continue;

      const result = toolResults.get(toolUse.id);

      const toolRun: LangsmithRun = {
        id: toolUse.id,
        name: toolUse.name || 'unknown_tool',
        run_type: 'tool',
        inputs: toolUse.input || {},
        outputs: result ? { result: result.result } : undefined,
        start_time: msg.timestamp || '',
        end_time: result?.timestamp,
        parent_run_id: msg.uuid,
      };

      runs.push(toolRun);
    }
  }

  return runs;
}

// ============================================================================
// Viewing
// ============================================================================

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
};

function viewSession(session: SessionInfo, jsonOutput = false): void {
  const messages = parseSession(session.path);

  if (jsonOutput) {
    const runs = convertToLangsmithRuns(messages, session.id);
    console.log(JSON.stringify(runs, null, 2));
    return;
  }

  // Header
  console.log(`\n${COLORS.cyan}Session:${COLORS.reset} ${session.id}`);
  if (session.branch) {
    console.log(`${COLORS.cyan}Branch:${COLORS.reset} ${session.branch}`);
  }
  console.log(`${COLORS.cyan}Started:${COLORS.reset} ${formatDate(session.mtime)}`);
  console.log(`${COLORS.cyan}Size:${COLORS.reset} ${formatSize(session.size)}`);
  console.log();

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheRead = 0;
  let llmCalls = 0;

  for (const msg of messages) {
    const content = normalizeContent(msg.message?.content);

    if (msg.type === 'user' && content.length > 0 && !msg.toolUseResult) {
      // User message (not tool result)
      const text = content
        .filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim();

      if (text) {
        const preview = text.length > 100 ? text.slice(0, 100) + '...' : text;
        console.log(`${COLORS.yellow}[user]${COLORS.reset} ${preview}`);
        console.log();
      }
    } else if (msg.type === 'assistant' && content.length > 0) {
      if (msg.isApiErrorMessage) {
        const errorText = content
          .filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
          .map(b => b.text)
          .join('');
        console.log(`${COLORS.red}[error]${COLORS.reset} ${errorText}`);
        console.log();
        continue;
      }

      llmCalls++;
      const usage = msg.message?.usage;
      if (usage) {
        totalInputTokens += usage.input_tokens + (usage.cache_read_input_tokens || 0);
        totalOutputTokens += usage.output_tokens;
        totalCacheRead += usage.cache_read_input_tokens || 0;
      }

      // Model and tokens
      const model = msg.message?.model || 'claude';
      const tokenInfo = usage
        ? `${usage.input_tokens.toLocaleString()} in${usage.cache_read_input_tokens ? ` (${usage.cache_read_input_tokens.toLocaleString()} cache)` : ''} / ${usage.output_tokens.toLocaleString()} out`
        : '';

      console.log(`${COLORS.blue}[llm]${COLORS.reset} ${model} ${COLORS.dim}${tokenInfo}${COLORS.reset}`);

      // Tool uses
      const toolUses = content.filter(
        (b): b is ContentBlock & { type: 'tool_use' } => b.type === 'tool_use'
      );

      for (const tool of toolUses) {
        const inputPreview = JSON.stringify(tool.input || {});
        const truncated = inputPreview.length > 80 ? inputPreview.slice(0, 80) + '...' : inputPreview;
        console.log(`  ${COLORS.green}[tool]${COLORS.reset} ${tool.name}`);
        console.log(`    ${COLORS.dim}Input: ${truncated}${COLORS.reset}`);
      }

      // Text response
      const text = content
        .filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim();

      if (text) {
        const preview = text.length > 200 ? text.slice(0, 200) + '...' : text;
        console.log(`  ${COLORS.dim}Response: ${preview}${COLORS.reset}`);
      }

      console.log();
    }
  }

  // Summary
  console.log(`${COLORS.cyan}─────────────────────────────────────────${COLORS.reset}`);
  console.log(
    `${COLORS.cyan}Total:${COLORS.reset} ${llmCalls} LLM calls | ${totalInputTokens.toLocaleString()} in / ${totalOutputTokens.toLocaleString()} out${totalCacheRead ? ` (${totalCacheRead.toLocaleString()} cache)` : ''}`
  );
  console.log();
}

// ============================================================================
// Upload to Langsmith
// ============================================================================

async function uploadToLangsmith(session: SessionInfo, project: string): Promise<number> {
  const apiKey = process.env.LANGSMITH_API_KEY;
  if (!apiKey) {
    throw new Error('LANGSMITH_API_KEY environment variable not set');
  }

  const endpoint = process.env.LANGSMITH_ENDPOINT || 'https://api.smith.langchain.com';

  const messages = parseSession(session.path);
  const runs = convertToLangsmithRuns(messages, session.id);

  // Add project name to all runs
  const runsWithProject = runs.map(run => ({
    ...run,
    session_name: project,
  }));

  console.log(`Uploading ${runs.length} runs to Langsmith project "${project}"...`);

  const response = await fetch(`${endpoint}/runs/batch`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      post: runsWithProject,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload failed: ${response.status} ${text}`);
  }

  return runs.length;
}

// ============================================================================
// CLI
// ============================================================================

function printHelp(): void {
  console.log(`
${COLORS.cyan}craft-trace${COLORS.reset} - View and upload Claude Agent SDK transcripts to Langsmith

${COLORS.yellow}Usage:${COLORS.reset}
  bun tools/langsmith-upload.ts                     List recent sessions
  bun tools/langsmith-upload.ts view [sessionId]    View session (last if omitted)
  bun tools/langsmith-upload.ts upload [sessionId]  Upload to Langsmith (last if omitted)

${COLORS.yellow}Options:${COLORS.reset}
  --json              Output as JSON (view only)
  --project, -p       Langsmith project name (default: "craft-tui-agent")
  --help, -h          Show this help

${COLORS.yellow}Environment:${COLORS.reset}
  LANGSMITH_API_KEY   Required for upload
  LANGSMITH_ENDPOINT  Optional, defaults to https://api.smith.langchain.com

${COLORS.yellow}Examples:${COLORS.reset}
  bun tools/langsmith-upload.ts                     # List sessions
  bun tools/langsmith-upload.ts view                # View last session
  bun tools/langsmith-upload.ts view abc123         # View by ID prefix
  bun tools/langsmith-upload.ts upload              # Upload last session
  bun tools/langsmith-upload.ts upload --project "My Project"
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse flags
  let jsonOutput = false;
  let project = 'craft-tui-agent';
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      jsonOutput = true;
    } else if (arg === '--project' || arg === '-p') {
      project = args[++i] || project;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  const command = positional[0];
  const sessionIdArg = positional[1];

  // Default: list sessions
  if (!command) {
    const sessions = listSessions(10);
    if (sessions.length === 0) {
      console.log('No sessions found.');
      console.log(`Looking in: ${getSessionsDir()}`);
      return;
    }

    console.log(`\n${COLORS.cyan}Recent sessions:${COLORS.reset}\n`);
    sessions.forEach((s, i) => {
      const branchInfo = s.branch ? ` | ${s.branch}` : '';
      console.log(
        `  ${i + 1}. ${s.id.slice(0, 8)}... | ${formatDate(s.mtime)} | ${formatSize(s.size)}${branchInfo}`
      );
    });
    console.log(`\n${COLORS.dim}Use "view [id]" or "upload [id]" with session ID prefix${COLORS.reset}\n`);
    return;
  }

  // View command
  if (command === 'view') {
    const session = findSession(sessionIdArg);
    if (!session) {
      console.error(sessionIdArg ? `Session not found: ${sessionIdArg}` : 'No sessions found');
      process.exit(1);
    }
    viewSession(session, jsonOutput);
    return;
  }

  // Upload command
  if (command === 'upload') {
    const session = findSession(sessionIdArg);
    if (!session) {
      console.error(sessionIdArg ? `Session not found: ${sessionIdArg}` : 'No sessions found');
      process.exit(1);
    }

    try {
      const count = await uploadToLangsmith(session, project);
      console.log(`${COLORS.green}Successfully uploaded ${count} runs${COLORS.reset}`);
    } catch (error) {
      console.error(`${COLORS.red}Upload failed:${COLORS.reset}`, error instanceof Error ? error.message : error);
      process.exit(1);
    }
    return;
  }

  // Unknown command - treat as session ID for view
  const session = findSession(command);
  if (session) {
    viewSession(session, jsonOutput);
  } else {
    console.error(`Unknown command or session: ${command}`);
    printHelp();
    process.exit(1);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
