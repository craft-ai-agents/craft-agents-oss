#!/usr/bin/env bun
/**
 * Craft Agents CLI
 *
 * A simple command-line interface for interacting with Claude via the Claude Agent SDK.
 * Uses the SDK CLI directly for reliable execution.
 */

import { parseArgs } from 'util';
import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import {
  getWorkspaces,
  getActiveWorkspace,
  getWorkspaceByNameOrId,
  loadStoredConfig,
  ensureConfigDir,
  DEFAULT_MODEL,
} from '@craft-agent/shared/config';
import { getCredentialManager } from '@craft-agent/shared/credentials';
import type { Workspace } from '@craft-agent/core/types';

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

/**
 * Find the SDK CLI path
 */
function findSdkCliPath(): string | null {
  const possiblePaths = [
    join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js'),
    join(import.meta.dir, '..', '..', '..', '..', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js'),
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) return p;
  }
  return null;
}

function printHelp(): void {
  console.log(`
${colors.cyan}Craft Agents CLI${colors.reset}

${colors.yellow}Usage:${colors.reset}
  craft [options] <prompt>
  craft [options] --interactive

${colors.yellow}Options:${colors.reset}
  -w, --workspace <name|id>  Use specific workspace (default: active workspace)
  -m, --model <model>        Model to use (default: ${DEFAULT_MODEL})
  -c, --continue             Continue the most recent conversation
  -p, --print                Print mode (non-interactive, single response)
  -a, --allowedTools <tools> Tools to allow (e.g., "Bash(git:*) Edit")
  -l, --list-workspaces      List available workspaces
  -v, --verbose              Verbose output
  -h, --help                 Show this help message

${colors.yellow}Examples:${colors.reset}
  craft "What files are in this directory?"
  craft -w my-project "Explain the codebase structure"
  craft -c "Continue our conversation"
  craft -p "What is 2+2?"

${colors.yellow}Note:${colors.reset}
  This CLI wraps the Claude Agent SDK CLI for reliable execution.
  For interactive mode, run without --print flag.
`);
}

function printWorkspaces(workspaces: Workspace[], activeId: string | null): void {
  console.log(`\n${colors.cyan}Available Workspaces:${colors.reset}\n`);

  if (workspaces.length === 0) {
    console.log(`  ${colors.dim}No workspaces configured.${colors.reset}`);
    console.log(`  ${colors.dim}Create one using the Craft Agents desktop app.${colors.reset}`);
    return;
  }

  for (const ws of workspaces) {
    const isActive = ws.id === activeId;
    const marker = isActive ? `${colors.green}*${colors.reset}` : ' ';
    const name = isActive ? `${colors.green}${ws.name}${colors.reset}` : ws.name;
    console.log(`  ${marker} ${name}`);
    console.log(`    ${colors.dim}ID: ${ws.id}${colors.reset}`);
    console.log(`    ${colors.dim}Path: ${ws.rootPath}${colors.reset}`);
  }
  console.log();
}

async function getApiKey(): Promise<string | null> {
  // Check environment variable first
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }
  // Then check credential manager
  const credentialManager = getCredentialManager();
  return await credentialManager.getApiKey();
}

async function runSdkCli(
  cliPath: string,
  prompt: string,
  options: {
    workingDir: string;
    model?: string;
    continueConversation?: boolean;
    printMode?: boolean;
    allowedTools?: string;
    verbose?: boolean;
    apiKey: string;
  }
): Promise<void> {
  const args: string[] = [];

  // Add flags
  if (options.printMode) {
    args.push('-p');
  }
  if (options.continueConversation) {
    args.push('-c');
  }
  if (options.model) {
    args.push('--model', options.model);
  }
  if (options.allowedTools) {
    args.push('--allowedTools', options.allowedTools);
  }
  // Note: -d (debug) flag conflicts with -p (print) mode in SDK CLI
  // Only enable debug for interactive mode
  if (options.verbose && !options.printMode) {
    args.push('-d');
  }

  // Add the prompt (only if not empty)
  if (prompt) {
    args.push(prompt);
  }

  if (options.verbose) {
    console.error(`${colors.dim}Running: node ${cliPath}${colors.reset}`);
    console.error(`${colors.dim}Args: ${JSON.stringify(args)}${colors.reset}`);
    console.error(`${colors.dim}Working directory: ${options.workingDir}${colors.reset}`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn('node', [cliPath, ...args], {
      cwd: options.workingDir,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: options.apiKey,
      },
      stdio: ['inherit', 'inherit', 'inherit'],
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`CLI exited with code ${code}`));
      }
    });
  });
}

async function main(): Promise<void> {
  // Ensure config directory exists
  ensureConfigDir();

  const { values, positionals } = parseArgs({
    options: {
      workspace: { type: 'string', short: 'w' },
      model: { type: 'string', short: 'm' },
      continue: { type: 'boolean', short: 'c', default: false },
      print: { type: 'boolean', short: 'p', default: false },
      allowedTools: { type: 'string', short: 'a' },
      'list-workspaces': { type: 'boolean', short: 'l', default: false },
      verbose: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  // Help
  if (values.help) {
    printHelp();
    process.exit(0);
  }

  // List workspaces
  if (values['list-workspaces']) {
    const config = loadStoredConfig();
    const workspaces = getWorkspaces();
    printWorkspaces(workspaces, config?.activeWorkspaceId ?? null);
    process.exit(0);
  }

  // Find SDK CLI
  const cliPath = findSdkCliPath();
  if (!cliPath) {
    console.error(`${colors.red}Error: Could not find Claude Agent SDK CLI.${colors.reset}`);
    console.error(`${colors.dim}Make sure @anthropic-ai/claude-agent-sdk is installed.${colors.reset}`);
    process.exit(1);
  }

  // Check for API key
  const apiKey = await getApiKey();
  if (!apiKey) {
    console.error(`${colors.red}Error: No Anthropic API key configured.${colors.reset}`);
    console.error(`${colors.dim}Set ANTHROPIC_API_KEY environment variable or configure in the desktop app.${colors.reset}`);
    process.exit(1);
  }

  // Get workspace
  let workspace: Workspace | null = null;

  if (values.workspace) {
    workspace = getWorkspaceByNameOrId(values.workspace);
    if (!workspace) {
      console.error(`${colors.red}Error: Workspace not found: ${values.workspace}${colors.reset}`);
      console.error(`${colors.dim}Use --list-workspaces to see available workspaces.${colors.reset}`);
      process.exit(1);
    }
  } else {
    workspace = getActiveWorkspace();
    if (!workspace) {
      const workspaces = getWorkspaces();
      if (workspaces.length > 0) {
        workspace = workspaces[0]!;
      }
    }
  }

  // Use workspace root or current directory
  const workingDir = workspace?.rootPath ?? process.cwd();

  // Get prompt from positional arguments
  const prompt = positionals.join(' ').trim();

  // If no prompt, run in interactive mode
  if (!prompt && !values.continue) {
    // Run SDK CLI in interactive mode
    try {
      await runSdkCli(cliPath, '', {
        workingDir,
        model: values.model,
        continueConversation: values.continue,
        printMode: false,
        allowedTools: values.allowedTools,
        verbose: values.verbose,
        apiKey,
      });
    } catch (err) {
      console.error(`${colors.red}Error: ${err instanceof Error ? err.message : String(err)}${colors.reset}`);
      process.exit(1);
    }
    return;
  }

  // Run with prompt
  try {
    await runSdkCli(cliPath, prompt, {
      workingDir,
      model: values.model,
      continueConversation: values.continue,
      printMode: values.print || !!prompt, // Default to print mode if prompt provided
      allowedTools: values.allowedTools,
      verbose: values.verbose,
      apiKey,
    });
  } catch (err) {
    console.error(`${colors.red}Error: ${err instanceof Error ? err.message : String(err)}${colors.reset}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${colors.red}Fatal error: ${err instanceof Error ? err.message : String(err)}${colors.reset}`);
  process.exit(1);
});
