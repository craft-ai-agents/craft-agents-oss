/**
 * Tool Executor
 *
 * In-process implementations of the standard development tools used by AI agents.
 * These tools mirror the tools provided by @anthropic-ai/claude-agent-sdk but are
 * implemented independently so that non-Anthropic backends (e.g. OpenAIAgent) can
 * use them without the Claude SDK dependency.
 *
 * Tools implemented:
 * - Read       — read a file (with optional line range)
 * - Write      — write/create a file
 * - Edit       — string-replace edit of a file
 * - Bash       — execute a shell command (with PermissionManager check)
 * - Glob       — find files by glob pattern
 * - Grep       — search file contents
 *
 * Each tool exposes:
 *  - execute(args, context) → Promise<string>   (result text or error text)
 *  - schema: OpenAI.Chat.ChatCompletionTool     (for sending to the LLM)
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PermissionManager } from './permission-manager.ts';

const execFileAsync = promisify(execFile);

// ============================================================
// Context passed to each tool execute() call
// ============================================================

export interface ToolExecutionContext {
  /** Working directory for the session */
  workingDirectory: string;
  /** Permission manager for Bash checks */
  permissionManager: PermissionManager;
  /**
   * Called when Bash requires interactive user approval.
   * Returns true if the user granted permission, false to deny.
   */
  requestPermission: (requestId: string, command: string, description: string) => Promise<boolean>;
}

// ============================================================
// Tool result type
// ============================================================

export interface ToolExecutionResult {
  /** Result text to send back to the LLM */
  text: string;
  /** Whether the execution produced an error (tool still returns, just flagged) */
  isError: boolean;
}

// ============================================================
// Read Tool
// ============================================================

export interface ReadArgs {
  file_path: string;
  offset?: number;
  limit?: number;
}

export async function executeRead(
  args: ReadArgs,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const filePath = resolveFilePath(args.file_path, context.workingDirectory);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const offset = args.offset ?? 0;
    const limit = args.limit ?? lines.length;
    const slice = lines.slice(offset, offset + limit);
    // Format with line numbers (1-indexed)
    const numbered = slice
      .map((line, i) => `${String(offset + i + 1).padStart(6)} ${line}`)
      .join('\n');
    return { text: numbered, isError: false };
  } catch (err) {
    return { text: `Error reading file: ${errorMessage(err)}`, isError: true };
  }
}

export const READ_SCHEMA = {
  type: 'function' as const,
  function: {
    name: 'Read',
    description: 'Read a file from the local filesystem. Returns the file contents with line numbers.',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the file to read.',
        },
        offset: {
          type: 'number',
          description: 'Line number to start reading from (0-indexed). Defaults to 0.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to read.',
        },
      },
      required: ['file_path'],
    },
  },
};

// ============================================================
// Write Tool
// ============================================================

export interface WriteArgs {
  file_path: string;
  content: string;
}

export async function executeWrite(
  args: WriteArgs,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const filePath = resolveFilePath(args.file_path, context.workingDirectory);
  const permResult = context.permissionManager.evaluateToolCall('Write', { file_path: args.file_path });
  if (permResult.requiresPermission) {
    const requestId = `write-${Date.now()}`;
    const granted = await context.requestPermission(
      requestId,
      args.file_path,
      permResult.description ?? `Write to file: ${args.file_path}`
    );
    if (!granted) {
      return { text: `Permission denied: write not allowed in current mode`, isError: true };
    }
  } else if (!permResult.allowed) {
    return { text: `Permission denied: ${permResult.reason ?? 'write not allowed'}`, isError: true };
  }
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, args.content, 'utf-8');
    return { text: `File written successfully: ${args.file_path}`, isError: false };
  } catch (err) {
    return { text: `Error writing file: ${errorMessage(err)}`, isError: true };
  }
}

export const WRITE_SCHEMA = {
  type: 'function' as const,
  function: {
    name: 'Write',
    description: 'Write content to a file on the local filesystem. Creates the file and any parent directories if they do not exist.',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the file to write.',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file.',
        },
      },
      required: ['file_path', 'content'],
    },
  },
};

// ============================================================
// Edit Tool
// ============================================================

export interface EditArgs {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export async function executeEdit(
  args: EditArgs,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const filePath = resolveFilePath(args.file_path, context.workingDirectory);
  const permResult = context.permissionManager.evaluateToolCall('Edit', { file_path: args.file_path });
  if (permResult.requiresPermission) {
    const requestId = `edit-${Date.now()}`;
    const granted = await context.requestPermission(
      requestId,
      args.file_path,
      permResult.description ?? `Edit file: ${args.file_path}`
    );
    if (!granted) {
      return { text: `Permission denied: edit not allowed in current mode`, isError: true };
    }
  } else if (!permResult.allowed) {
    return { text: `Permission denied: ${permResult.reason ?? 'edit not allowed'}`, isError: true };
  }
  try {
    let content = fs.readFileSync(filePath, 'utf-8');
    const occurrences = content.split(args.old_string).length - 1;
    if (occurrences === 0) {
      return { text: `Error: old_string not found in file: ${args.file_path}`, isError: true };
    }
    if (!args.replace_all && occurrences > 1) {
      return {
        text: `Error: old_string is not unique in file (${occurrences} occurrences). Use replace_all: true to replace all occurrences.`,
        isError: true,
      };
    }
    if (args.replace_all) {
      content = content.split(args.old_string).join(args.new_string);
    } else {
      content = content.replace(args.old_string, args.new_string);
    }
    fs.writeFileSync(filePath, content, 'utf-8');
    return { text: `File edited successfully: ${args.file_path}`, isError: false };
  } catch (err) {
    return { text: `Error editing file: ${errorMessage(err)}`, isError: true };
  }
}

export const EDIT_SCHEMA = {
  type: 'function' as const,
  function: {
    name: 'Edit',
    description: 'Perform an exact string replacement in a file. The old_string must uniquely match in the file unless replace_all is true.',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the file to edit.',
        },
        old_string: {
          type: 'string',
          description: 'The exact string to find and replace.',
        },
        new_string: {
          type: 'string',
          description: 'The replacement string.',
        },
        replace_all: {
          type: 'boolean',
          description: 'If true, replace all occurrences. Default is false (requires old_string to be unique).',
        },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
};

// ============================================================
// Bash Tool
// ============================================================

export interface BashArgs {
  command: string;
  timeout?: number;
}

const DEFAULT_BASH_TIMEOUT_MS = 120_000; // 2 minutes

export async function executeBash(
  args: BashArgs,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const permResult = context.permissionManager.evaluateToolCall('Bash', { command: args.command });
  if (permResult.requiresPermission) {
    const requestId = `bash-${Date.now()}`;
    const granted = await context.requestPermission(
      requestId,
      args.command,
      permResult.description ?? `Run command: ${args.command}`
    );
    if (!granted) {
      return { text: `Permission denied: command not allowed in current mode`, isError: true };
    }
  } else if (!permResult.allowed) {
    return { text: `Permission denied: ${permResult.reason ?? 'command blocked by permission mode'}`, isError: true };
  }

  const timeout = args.timeout ?? DEFAULT_BASH_TIMEOUT_MS;

  try {
    const { stdout, stderr } = await execFileAsync(
      'bash',
      ['-c', args.command],
      {
        cwd: context.workingDirectory,
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
        env: { ...process.env },
      }
    );
    const output = [stdout, stderr].filter(Boolean).join('\n');
    return { text: output || '(no output)', isError: false };
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; message?: string };
    const output = [execErr.stdout, execErr.stderr, execErr.message].filter(Boolean).join('\n');
    return { text: output || `Command failed: ${errorMessage(err)}`, isError: true };
  }
}

export const BASH_SCHEMA = {
  type: 'function' as const,
  function: {
    name: 'Bash',
    description: 'Execute a bash command in the current working directory. Use for running tests, build commands, git operations, and other shell tasks.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The bash command to execute.',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (max 600000). Defaults to 120000.',
        },
      },
      required: ['command'],
    },
  },
};

// ============================================================
// Glob Tool
// ============================================================

export interface GlobArgs {
  pattern: string;
  path?: string;
}

export async function executeGlob(
  args: GlobArgs,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const searchDir = args.path
    ? resolveFilePath(args.path, context.workingDirectory)
    : context.workingDirectory;
  try {
    // Use Bun's native Glob if available, otherwise fall back to rg --files
    if (typeof Bun !== 'undefined' && Bun.Glob) {
      const glob = new Bun.Glob(args.pattern);
      const matches: string[] = [];
      for await (const file of glob.scan({ cwd: searchDir, absolute: true, followSymlinks: false })) {
        if (!file.includes('/node_modules/') && !file.includes('/.git/')) {
          matches.push(file);
        }
      }
      if (matches.length === 0) {
        return { text: 'No files matched the pattern.', isError: false };
      }
      return { text: matches.join('\n'), isError: false };
    }
    // Fallback: use rg --files with glob filter
    const rgArgs = ['--files', '--glob', args.pattern, '--', searchDir];
    const { stdout } = await execFileAsync('rg', rgArgs, {
      cwd: context.workingDirectory,
      maxBuffer: 10 * 1024 * 1024,
    });
    const result = stdout.trim();
    return { text: result || 'No files matched the pattern.', isError: false };
  } catch (err: unknown) {
    const execErr = err as { code?: number };
    if (execErr.code === 1) {
      return { text: 'No files matched the pattern.', isError: false };
    }
    return { text: `Error running glob: ${errorMessage(err)}`, isError: true };
  }
}

export const GLOB_SCHEMA = {
  type: 'function' as const,
  function: {
    name: 'Glob',
    description: 'Find files matching a glob pattern. Returns a list of matching absolute file paths.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern to match files against (e.g. "**/*.ts", "src/**/*.tsx").',
        },
        path: {
          type: 'string',
          description: 'Directory to search in. Defaults to the current working directory.',
        },
      },
      required: ['pattern'],
    },
  },
};

// ============================================================
// Grep Tool
// ============================================================

export interface GrepArgs {
  pattern: string;
  path?: string;
  glob?: string;
  output_mode?: 'content' | 'files_with_matches' | 'count';
  context?: number;
  head_limit?: number;
  case_insensitive?: boolean;
}

export async function executeGrep(
  args: GrepArgs,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const searchDir = args.path
    ? resolveFilePath(args.path, context.workingDirectory)
    : context.workingDirectory;

  // Build ripgrep / grep command
  const rgArgs: string[] = ['--no-heading'];
  if (args.case_insensitive) rgArgs.push('-i');
  const outputMode = args.output_mode ?? 'files_with_matches';
  if (outputMode === 'files_with_matches') {
    rgArgs.push('-l');
  } else if (outputMode === 'count') {
    rgArgs.push('-c');
  } else {
    // content mode: show line numbers
    rgArgs.push('-n');
    if (args.context && args.context > 0) {
      rgArgs.push('-C', String(args.context));
    }
  }
  if (args.glob) {
    rgArgs.push('--glob', args.glob);
  }
  rgArgs.push('--', args.pattern, searchDir);

  try {
    const { stdout } = await execFileAsync('rg', rgArgs, {
      cwd: context.workingDirectory,
      maxBuffer: 10 * 1024 * 1024,
    });
    let result = stdout.trim();
    if (args.head_limit && args.head_limit > 0) {
      const lines = result.split('\n');
      result = lines.slice(0, args.head_limit).join('\n');
    }
    return { text: result || 'No matches found.', isError: false };
  } catch (err: unknown) {
    // rg exits with code 1 when no matches (not a real error)
    const execErr = err as { code?: number; stdout?: string };
    if (execErr.code === 1) {
      return { text: 'No matches found.', isError: false };
    }
    return { text: `Error running grep: ${errorMessage(err)}`, isError: true };
  }
}

export const GREP_SCHEMA = {
  type: 'function' as const,
  function: {
    name: 'Grep',
    description: 'Search file contents using regex patterns. By default returns a list of files with matches.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regular expression pattern to search for.',
        },
        path: {
          type: 'string',
          description: 'File or directory to search in. Defaults to the current working directory.',
        },
        glob: {
          type: 'string',
          description: 'Glob pattern to filter which files are searched (e.g. "*.ts", "**/*.tsx").',
        },
        output_mode: {
          type: 'string',
          enum: ['content', 'files_with_matches', 'count'],
          description: 'Output format. "files_with_matches" returns file paths (default), "content" returns matching lines, "count" returns match counts.',
        },
        context: {
          type: 'number',
          description: 'Number of context lines to show before and after each match (only for content mode).',
        },
        head_limit: {
          type: 'number',
          description: 'Limit output to first N lines.',
        },
        case_insensitive: {
          type: 'boolean',
          description: 'Perform case-insensitive search.',
        },
      },
      required: ['pattern'],
    },
  },
};

// ============================================================
// Tool registry
// ============================================================

export type ToolName = 'Read' | 'Write' | 'Edit' | 'Bash' | 'Glob' | 'Grep';

/** All tool schemas — pass directly to OpenAI as the `tools` parameter */
export const ALL_TOOL_SCHEMAS = [
  READ_SCHEMA,
  WRITE_SCHEMA,
  EDIT_SCHEMA,
  BASH_SCHEMA,
  GLOB_SCHEMA,
  GREP_SCHEMA,
] as const;

/**
 * Execute a tool by name with the given arguments.
 * Returns a ToolExecutionResult regardless of success/failure
 * so the caller can always send a tool result message back to the LLM.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  switch (toolName) {
    case 'Read':
      return executeRead(args as unknown as ReadArgs, context);
    case 'Write':
      return executeWrite(args as unknown as WriteArgs, context);
    case 'Edit':
      return executeEdit(args as unknown as EditArgs, context);
    case 'Bash':
      return executeBash(args as unknown as BashArgs, context);
    case 'Glob':
      return executeGlob(args as unknown as GlobArgs, context);
    case 'Grep':
      return executeGrep(args as unknown as GrepArgs, context);
    default:
      return { text: `Unknown tool: ${toolName}`, isError: true };
  }
}

// ============================================================
// Utilities
// ============================================================

function resolveFilePath(filePath: string, workingDirectory: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(workingDirectory, filePath);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
