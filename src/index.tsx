#!/usr/bin/env bun
// Cache TTL interceptor - MUST be first import (patches fetch before SDK loads)
// Works in both dev (bunfig.toml preload) and compiled mode (direct import)
import './cache-ttl-interceptor.ts';

import React, { useState, useCallback } from 'react';
import { render } from 'ink';
import { createHash } from 'crypto';
import meow from 'meow';
import { App } from './tui/App.tsx';
import { Setup } from './tui/components/Setup.tsx';
import {
  loadStoredConfig,
  getActiveWorkspace,
  getWorkspaceByNameOrId,
  getWorkspaces,
  setActiveWorkspace,
  getAnthropicApiKey,
  getClaudeOAuthToken,
  hasValidCredentials,
  type StoredConfig,
  type Workspace,
  type AuthType,
} from './config/storage.ts';
import type { CraftAgentConfig } from './agent/craft-agent.ts';
import { enableDebug } from './tui/utils/debug.ts';
import { install } from './version/install.ts';

/**
 * Generate a deterministic workspace ID from a URL.
 * Same URL always produces the same ID (for caching), different URLs get different IDs.
 */
function generateUrlWorkspaceId(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').substring(0, 12);
  return `cli-ws-url-${hash}`;
}

/**
 * Check if a string is an MCP server URL (starts with http:// or https://)
 */
function isUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

/**
 * Create a temporary workspace from a URL
 */
function createUrlWorkspace(url: string): Workspace {
  return {
    id: generateUrlWorkspaceId(url),
    name: url, // Show URL as name in header
    mcpUrl: url,
    isPublic: true,
    createdAt: Date.now(),
  };
}

const cli = meow(
  `
  Craft Document Assistant - A Claude Code-like TUI for Craft documents

  Usage
    $ craft [options]                     Interactive mode
    $ craft [options] "prompt"            Interactive mode with initial prompt
    $ craft -a agent "prompt"             Activate agent and send prompt
    $ craft -p "query"                    Print mode: execute and exit
    $ craft -p "query" -a agent           Print mode with agent

  Commands
    install [version]  Install a specific version (defaults to "latest")

  Common Options (both modes)
    --agent, -a <name>      Agent to activate (with or without @ prefix)
    --workspace, -w <name>  Select workspace by name, ID, or MCP server URL (http/https)
    --model, -m <model>     Claude model to use (default: claude-sonnet-4-5-20250929)
    --debug                 Enable debug logging to /tmp/craft-debug.log

  Print Mode (non-interactive, exits after response)
    --print, -p <query>     Execute prompt and exit (non-interactive)
    --output-format <fmt>   Output format: text, json, stream-json (default: text)
    --permission-policy     Permission handling: deny-all, allow-safe, allow-all (default: deny-all)
    --session-id <uuid>     Use explicit session ID (for workflow management)
    --session-resume        Resume workspace's saved session (default: fresh session)

  Interactive Mode Options
    --setup         Run the setup wizard (reconfigure)
    --token, -t     Bearer token for MCP authentication (overrides saved config)
    --help          Show this help message
    --version       Show version number

  First Run
    On first run, you'll be guided through an interactive setup to configure
    your Anthropic API key and Craft MCP server connection.

  Configuration
    Settings are stored in ~/.craft-agent/config.json
    Run with --setup to reconfigure at any time.

  Session Behavior
    - Interactive (REPL): Always resumes workspace session
    - Print mode: Fresh session by default (predictable for scripts)
      Use --session-resume to continue workspace session
      Use --session-id <uuid> for explicit session management

  Examples
    $ craft                                    # Interactive mode
    $ craft "What documents do I have?"        # Interactive with initial prompt
    $ craft -a writer "Help me draft an email" # Activate agent + prompt
    $ craft -w work -p "list my documents"     # Print mode with specific workspace
    $ craft -w https://mcp.example.com -p "query"  # Use MCP URL directly
    $ craft -p "summarize" -a writer           # Print mode with agent
    $ craft -p "query" --session-resume        # Print mode, resume session
    $ craft -p "query" --output-format json    # JSON output for scripts
    $ craft --setup                            # Reconfigure
    $ craft install 0.0.1                      # Install specific version
`,
  {
    importMeta: import.meta,
    flags: {
      // Print mode flags
      print: {
        type: 'string',
        shortFlag: 'p',
      },
      agent: {
        type: 'string',
        shortFlag: 'a',
      },
      outputFormat: {
        type: 'string',
        default: 'text',
      },
      permissionPolicy: {
        type: 'string',
        default: 'deny-all',
      },
      sessionId: {
        type: 'string',
      },
      sessionResume: {
        type: 'boolean',
        default: false,
      },
      workspace: {
        type: 'string',
        shortFlag: 'w',
      },
      // Interactive mode flags
      setup: {
        type: 'boolean',
        default: false,
      },
      token: {
        type: 'string',
        shortFlag: 't',
      },
      model: {
        type: 'string',
        shortFlag: 'm',
      },
      debug: {
        type: 'boolean',
        default: false,
      },
    },
    allowUnknownFlags: false,
  }
);

// Root component that handles setup vs main app
interface RootProps {
  initialConfig: StoredConfig | null;
  cliFlags: typeof cli.flags;
  forceSetup: boolean;
  initialCredentials: { apiKey: string | null; oauthToken: string | null } | null;
  initialHasValidCredentials: boolean;
  /** Agent to auto-activate on startup (without @ prefix) */
  initialAgent?: string;
  /** Prompt to auto-send after agent activation */
  initialPrompt?: string;
}

const Root: React.FC<RootProps> = ({ initialConfig, cliFlags, forceSetup, initialCredentials, initialHasValidCredentials, initialAgent, initialPrompt }) => {
  // Show setup if: forced, no config, or no valid credentials in keychain
  const [showSetup, setShowSetup] = useState(forceSetup || !initialConfig || !initialHasValidCredentials);
  const [config, setConfig] = useState<StoredConfig | null>(initialConfig);
  const [credentials, setCredentials] = useState(initialCredentials);

  const handleSetupComplete = useCallback(async (newConfig: StoredConfig) => {
    setConfig(newConfig);
    // Reload credentials from keychain after setup
    try {
      const apiKey = await getAnthropicApiKey();
      const oauthToken = await getClaudeOAuthToken();
      setCredentials({ apiKey, oauthToken });
    } catch (err) {
      // Log error but continue - credentials may have been saved successfully
      console.error('Failed to reload credentials:', err);
    }
    setShowSetup(false);
  }, []);

  const handleSetupCancel = useCallback(() => {
    if (config) {
      // User cancelled but has existing config - go to app
      setShowSetup(false);
    }
    // If no config, stay in setup (can't run without config)
  }, [config]);

  const handleRequestSetup = useCallback(() => {
    setShowSetup(true);
  }, []);

  if (showSetup) {
    return (
      <Setup
        onComplete={handleSetupComplete}
        onCancel={handleSetupCancel}
      />
    );
  }

  if (!config) {
    // Should not happen, but just in case
    return (
      <Setup
        onComplete={handleSetupComplete}
        onCancel={handleSetupCancel}
      />
    );
  }

  // Get active workspace
  const activeWorkspace = getActiveWorkspace();
  if (!activeWorkspace) {
    // No workspaces available - need to run setup
    return (
      <Setup
        onComplete={handleSetupComplete}
        onCancel={handleSetupCancel}
      />
    );
  }

  // Build agent config from stored config + CLI overrides
  // Priority: -w URL > -w workspace name/ID > active workspace
  let workspace: Workspace;
  let workspaceError: string | undefined;
  if (cliFlags.workspace) {
    if (isUrl(cliFlags.workspace)) {
      // -w with URL creates a temporary workspace
      workspace = createUrlWorkspace(cliFlags.workspace);
    } else {
      // -w with name/ID: lookup existing workspace
      const found = getWorkspaceByNameOrId(cliFlags.workspace);
      if (!found) {
        // Workspace not found - fall back to active workspace, cancel initial agent/prompt
        const available = getWorkspaces();
        const names = available.map(w => w.name).join(', ') || 'none';
        workspaceError = `Workspace '${cliFlags.workspace}' not found. Available: ${names}. Using '${activeWorkspace.name}' instead.`;
        workspace = activeWorkspace;
      } else {
        workspace = found;
        // Update last active workspace for REPL mode (user is interactively working here now)
        setActiveWorkspace(found.id);
      }
    }
  } else {
    workspace = activeWorkspace;
  }

  const agentConfig: CraftAgentConfig = {
    workspace,
    // Token can come from CLI flag (for testing) - OAuth tokens are loaded from storage in the agent
    mcpToken: cliFlags.token,
    model: cliFlags.model || config.model,
  };

  // Set authentication in environment for the SDK based on auth type
  // Credentials are now loaded from keychain (passed in from main())
  const authType: AuthType = config.authType || 'api_key';
  if (authType === 'oauth_token' && credentials?.oauthToken) {
    // Use Claude Max subscription via OAuth token
    process.env.CLAUDE_CODE_OAUTH_TOKEN = credentials.oauthToken;
    // Clear API key to ensure SDK uses OAuth token
    delete process.env.ANTHROPIC_API_KEY;
  } else if (credentials?.apiKey) {
    // Use API key (pay-as-you-go)
    process.env.ANTHROPIC_API_KEY = credentials.apiKey;
    // Clear OAuth token if set
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  }

  return (
    <App
      config={agentConfig}
      onRequestSetup={handleRequestSetup}
      // Cancel initial agent/prompt if workspace lookup failed
      initialAgent={workspaceError ? undefined : initialAgent}
      initialPrompt={workspaceError ? undefined : initialPrompt}
      initialError={workspaceError}
    />
  );
};

async function main() {
  // Handle install command
  if (cli.input[0] === 'install') {
    const version = cli.input[1] || 'latest';
    await install(version);
    process.exit(0);
  }

  // Enable debug logging if --debug flag is passed
  if (cli.flags.debug) {
    enableDebug();
  }

  // ========================================
  // HEADLESS MODE (-p flag)
  // ========================================
  if (cli.flags.print !== undefined) {
    const { HeadlessRunner, writeStreamingOutput } = await import('./headless/index.ts');

    // Check if using URL workspace (allows skipping config requirement)
    const isUrlWorkspace = cli.flags.workspace && isUrl(cli.flags.workspace);

    // Get workspace: -w URL > -w workspace name/ID > active workspace
    let workspace: Workspace | null = null;
    if (cli.flags.workspace) {
      if (isUrlWorkspace) {
        // -w with URL creates a temporary workspace (no config required)
        workspace = createUrlWorkspace(cli.flags.workspace);
      } else {
        // -w with name/ID: lookup existing workspace (requires config)
        workspace = getWorkspaceByNameOrId(cli.flags.workspace);
        if (!workspace) {
          const available = getWorkspaces();
          const names = available.map(w => w.name).join(', ') || 'none';
          console.error(`Error: Workspace '${cli.flags.workspace}' not found. Available: ${names}`);
          process.exit(1);
        }
      }
    } else {
      // No -w flag: need config for active workspace
      const storedConfig = loadStoredConfig();
      if (!storedConfig) {
        console.error('Error: No configuration found. Run `craft --setup` first, or use -w <url> for zero-config mode.');
        process.exit(1);
      }
      workspace = getActiveWorkspace();
    }

    if (!workspace) {
      console.error('Error: No workspace configured. Run `craft --setup` first, or use -w <url> for zero-config mode.');
      process.exit(1);
    }

    // Get credentials (from env vars or keychain)
    const apiKey = await getAnthropicApiKey();
    const oauthToken = await getClaudeOAuthToken();

    if (!apiKey && !oauthToken) {
      console.error('Error: No Anthropic credentials found. Set CRAFT_ANTHROPIC_API_KEY env var, or run `craft --setup`.');
      process.exit(1);
    }

    // Set up auth env vars for SDK (prefer OAuth if available, else API key)
    if (oauthToken) {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
      delete process.env.ANTHROPIC_API_KEY;
    } else if (apiKey) {
      process.env.ANTHROPIC_API_KEY = apiKey;
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    }

    // Normalize agent name (strip @ prefix if present)
    // Note: meow exposes short flags under their short name when used
    const agentFlag = cli.flags.agent ?? (cli.flags as Record<string, unknown>).a as string | undefined;
    const agentName = agentFlag?.replace(/^@/, '');

    // Validate output format
    const outputFormat = cli.flags.outputFormat as 'text' | 'json' | 'stream-json';
    if (!['text', 'json', 'stream-json'].includes(outputFormat)) {
      console.error(`Error: Invalid output format '${outputFormat}'. Use: text, json, or stream-json`);
      process.exit(1);
    }

    // Validate permission policy
    const permissionPolicy = cli.flags.permissionPolicy as 'deny-all' | 'allow-safe' | 'allow-all';
    if (!['deny-all', 'allow-safe', 'allow-all'].includes(permissionPolicy)) {
      console.error(`Error: Invalid permission policy '${permissionPolicy}'. Use: deny-all, allow-safe, or allow-all`);
      process.exit(1);
    }

    // Get model (from flag, config, or default)
    const storedConfig = loadStoredConfig();
    const model = cli.flags.model || storedConfig?.model;

    // Create and run headless runner
    const runner = new HeadlessRunner({
      prompt: cli.flags.print,
      workspace,
      agentName,
      model,
      outputFormat,
      permissionPolicy,
      sessionId: cli.flags.sessionId,
      sessionResume: cli.flags.sessionResume,
    });

    const result = await writeStreamingOutput(runner.runStreaming(), outputFormat);
    process.exit(result.success ? 0 : 1);
  }

  // ========================================
  // INTERACTIVE MODE (TUI)
  // ========================================

  // Clear screen and move cursor to top-left
  process.stdout.write('\x1b[2J\x1b[H');

  // Enable bracketed paste mode for better paste/drag-drop handling
  // This wraps pasted text with escape sequences so we can detect it
  process.stdout.write('\x1b[?2004h');

  // Ensure we clean up on exit
  const cleanup = () => {
    process.stdout.write('\x1b[?2004l'); // Disable bracketed paste mode
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  // Check for existing config and credentials
  const storedConfig = loadStoredConfig();
  const forceSetup = cli.flags.setup;
  const initialHasValidCredentials = await hasValidCredentials();

  // Load actual credentials from keychain (needed for env vars later)
  let initialCredentials: { apiKey: string | null; oauthToken: string | null } | null = null;
  if (storedConfig) {
    const apiKey = await getAnthropicApiKey();
    const oauthToken = await getClaudeOAuthToken();
    initialCredentials = { apiKey, oauthToken };
  }

  // Extract initial agent and prompt for interactive mode
  // Agent comes from -a flag (strip @ prefix if present)
  // Prompt comes from positional arguments (cli.input)
  const initialAgent = cli.flags.agent?.replace(/^@/, '');
  const initialPrompt = cli.input.length > 0 ? cli.input.join(' ') : undefined;

  // Render the root component
  const { waitUntilExit } = render(
    <Root
      initialConfig={storedConfig}
      cliFlags={cli.flags}
      forceSetup={forceSetup}
      initialCredentials={initialCredentials}
      initialHasValidCredentials={initialHasValidCredentials}
      initialAgent={initialAgent}
      initialPrompt={initialPrompt}
    />
  );

  await waitUntilExit();
  cleanup();
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
