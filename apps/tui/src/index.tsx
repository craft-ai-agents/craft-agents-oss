#!/usr/bin/env bun
import React, { useState, useCallback, useEffect } from 'react';
import { render } from 'ink';
import { createHash } from 'crypto';
import meow from 'meow';
import { App } from './App.tsx';
import { Setup } from './components/Setup.tsx';
import {
  loadStoredConfig,
  getActiveWorkspace,
  getWorkspaceByNameOrId,
  getWorkspaces,
  setActiveWorkspace,
  getAnthropicApiKey,
  getClaudeOAuthToken,
  listSessions,
  loadSession,
  createSession,
  getOrCreateLatestSession,
  setActiveSession,
  cleanupLegacyConversations,
  type StoredConfig,
  type Workspace,
  type AuthType,
  type Session,
} from '@craft-agent/shared/config';
import { getAuthState, getSetupNeeds, type AuthState, type SetupNeeds } from '@craft-agent/shared/auth';
import type { CraftAgentConfig } from '@craft-agent/shared/agent';
import { debug, enableDebug } from '@craft-agent/shared/utils';
import { install } from '@craft-agent/shared/version';
import { getCurrentVersion } from '@craft-agent/shared/version';
import { DEFAULT_MODEL } from '@craft-agent/shared/config';
import { setAnthropicOptionsEnv } from '@craft-agent/shared/agent';
import { getCraftToken } from '@craft-agent/shared/auth';

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
  Craft Agent - A Claude Code-like agent for Craft documents

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
    --model, -m <model>     Claude model to use (default: ${DEFAULT_MODEL})
    --debug                 Enable debug logging to /tmp/craft-debug.log
    --session <id>          resume (or create) a specific session by ID (only within given workspace, if provided)
    
  Interactive Mode Options
    --new                Start a new session (instead of resuming)
    --list-sessions      List available sessions and exit (sessions of the specified workspace, or if not specified, of the last used workspace)
    --token, -t          Bearer token for MCP authentication (overrides saved config)
    --help               Show this help message
    --version            Show version number

  Print Mode (non-interactive, exits after response)
    --print, -p <query>     Execute prompt and exit (non-interactive)
    --output-format <fmt>   Output format: text, json, stream-json (default: text)
    --permission-policy     Permission handling: deny-all, allow-safe, allow-all (default: deny-all)
    --session-resume        Resume the last session (in the given workspace, if provided) (default: fresh session)

  First Run
    On first run, you'll be guided through an interactive setup to configure
    your Anthropic API key and Craft MCP server connection.

  Configuration
    Settings are stored in ~/.craft-agent/config.json
    Sessions are stored in ~/.craft-agent/sessions/

  Session Behavior
    - Interactive (REPL): Resumes latest session by default
      Use --new to start fresh, --session <id> to resume specific session
    - Print mode: Fresh session by default (predictable for scripts)
      Use --session-resume to continue the last session
      Use --session <id> for explicit session management

  Examples
    $ craft                                    # Resume latest session
    $ craft --new                              # Start fresh session
    $ craft --session abc123                   # Resume specific session
    $ craft --list-sessions                    # List all sessions
    $ craft "What documents do I have?"        # Interactive with initial prompt
    $ craft -a writer "Help me draft an email" # Activate agent + prompt
    $ craft -w work -p "list my documents"     # Print mode with specific workspace
    $ craft -w https://mcp.example.com -p "query"  # Use MCP URL directly
    $ craft -p "summarize" -a writer           # Print mode with agent
    $ craft -p "query" --session-resume        # Print mode, resume session
    $ craft -p "query" --output-format json    # JSON output for scripts
    $ craft install 0.0.1                      # Install specific version
`,
  {
    importMeta: import.meta,
    version: getCurrentVersion(),
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
      sessionResume: {
        type: 'boolean',
        default: false,
      },
      workspace: {
        type: 'string',
        shortFlag: 'w',
      },
      // Interactive mode flags
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
      // Session flags (interactive mode)
      new: {
        type: 'boolean',
        default: false,
      },
      session: {
        type: 'string',
      },
      listSessions: {
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
  /** Unified auth state from getAuthState() */
  authState: AuthState;
  /** Derived setup needs from getSetupNeeds() */
  setupNeeds: SetupNeeds;
  /** Agent to auto-activate on startup (without @ prefix) */
  initialAgent?: string;
  /** Prompt to auto-send after agent activation */
  initialPrompt?: string;
}

const Root: React.FC<RootProps> = ({ initialConfig, cliFlags, authState, setupNeeds, initialAgent, initialPrompt }) => {
  // Show setup if: not fully configured
  const [showSetup, setShowSetup] = useState(!setupNeeds.isFullyConfigured);
  const [config, setConfig] = useState<StoredConfig | null>(initialConfig);
  // Track current auth state (may be updated after setup)
  const [currentAuthState, setCurrentAuthState] = useState<AuthState>(authState);

  const { billing } = currentAuthState;
  useEffect(() => {
    // Skip credential setup when showing Setup wizard - credentials don't exist yet
    if (showSetup) {
      debug(`[Root] Skipping credential setup - showing Setup wizard`);
      return;
    }

    debug(`billing type: ${billing.type}`);

    (async () => {
      if (billing.type === 'craft_credits') {
        const token = await getCraftToken();
        setAnthropicOptionsEnv({
          USE_CRAFT_AI_GATEWAY: 'true',
          CRAFT_API_GATEWAY_TOKEN: token,
        });
        // Set placeholder API key so SDK starts - the cache-ttl-interceptor
        // will replace the auth header with the real Craft token
        process.env.ANTHROPIC_API_KEY = 'craft-credits-placeholder';
        debug(`Set Craft API Gateway Token`);
      } else if (billing.type === 'oauth_token' && billing.claudeOAuthToken) {
        // Use Claude Max subscription via OAuth token
        process.env.CLAUDE_CODE_OAUTH_TOKEN = billing.claudeOAuthToken;
        // Clear API key and Craft Gateway settings to ensure SDK uses OAuth token
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.USE_CRAFT_AI_GATEWAY;
        delete process.env.CRAFT_API_GATEWAY_TOKEN;
        debug(`Set Claude Max OAuth Token`);
      } else if (billing.apiKey) {
        // Use API key (pay-as-you-go)
        process.env.ANTHROPIC_API_KEY = billing.apiKey;
        // Clear OAuth token and Craft Gateway settings if set
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
        delete process.env.USE_CRAFT_AI_GATEWAY;
        delete process.env.CRAFT_API_GATEWAY_TOKEN;
        debug(`Set Anthropic API Key`);
      }
    })();
  }, [showSetup, billing.type, billing.apiKey, billing.claudeOAuthToken]);

  const handleSetupComplete = useCallback(async (newConfig: StoredConfig) => {
    setConfig(newConfig);
    // Reload auth state after setup
    try {
      const newAuthState = await getAuthState();
      setCurrentAuthState(newAuthState);
    } catch (err) {
      // Log error but continue - setup may have completed successfully
      console.error('Failed to reload auth state:', err);
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
    // Compute current setup needs (may have changed since initial render)
    const currentNeeds = getSetupNeeds(currentAuthState);
    return (
      <Setup
        onComplete={handleSetupComplete}
        onCancel={handleSetupCancel}
        authState={currentAuthState}
        setupNeeds={currentNeeds}
      />
    );
  }

  // At this point we should have a valid config and workspace
  // (setupNeeds.isFullyConfigured was true)
  if (!config || !currentAuthState.workspace.active) {
    // Shouldn't happen, but fallback to setup
    const currentNeeds = getSetupNeeds(currentAuthState);
    return (
      <Setup
        onComplete={handleSetupComplete}
        onCancel={handleSetupCancel}
        authState={currentAuthState}
        setupNeeds={currentNeeds}
      />
    );
  }

  // Use workspace from current auth state
  const activeWorkspace = currentAuthState.workspace.active;

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

  return (
    <App
      config={agentConfig}
      onRequestSetup={handleRequestSetup}
      // Cancel initial agent/prompt if workspace lookup failed
      initialAgent={workspaceError ? undefined : initialAgent}
      initialPrompt={workspaceError ? undefined : initialPrompt}
      initialError={workspaceError}
      // Session flags from CLI
      newSession={cliFlags.new}
      sessionId={cliFlags.session}
    />
  );
};

async function main() {
  // Handle install command
  if (cli.input[0] === 'install') {
    const version = cli.input[1] || 'latest';
    console.log(`Installing Craft Agent ${version === 'latest' ? '(latest)' : `v${version}`}...`);
    const result = await install(version);
    if (result.success) {
      console.log('Installation complete. Restart to use the new version.');
    } else {
      console.error(`Installation failed: ${result.error}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // Handle --list-sessions command
  if (cli.flags.listSessions) {
    const workspaceId = cli.flags.workspace
      ? getWorkspaceByNameOrId(cli.flags.workspace)?.id
      : getActiveWorkspace()?.id;

    const sessions = listSessions(workspaceId);

    if (sessions.length === 0) {
      console.log('No sessions found.');
    } else {
      console.log('Sessions:\n');
      for (const session of sessions) {
        const date = new Date(session.lastUsedAt).toLocaleString();
        const messageCount = session.messageCount;
        const preview = session.preview || '(empty)';
        const workspaceName = getWorkspaces().find(w => w.id === session.workspaceId)?.name || session.workspaceId;

        console.log(`  ${session.id}`);
        console.log(`    Workspace: ${workspaceName}`);
        console.log(`    Last used: ${date}`);
        console.log(`    Messages: ${messageCount}`);
        console.log(`    Preview: ${preview.substring(0, 60)}${preview.length > 60 ? '...' : ''}`);
        console.log('');
      }
    }
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
    const { HeadlessRunner, writeStreamingOutput } = await import('@craft-agent/shared/headless');

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
        console.error('Error: No configuration found. Run `craft` first in interactive mode, or use -w <url> for zero-config mode.');
        process.exit(1);
      }
      workspace = getActiveWorkspace();
    }

    if (!workspace) {
      console.error('Error: No workspace configured. Run `craft` first in interactive mode, or use -w <url> for zero-config mode.');
      process.exit(1);
    }

    // Get credentials (from env vars or credential store)
    const apiKey = await getAnthropicApiKey();
    const oauthToken = await getClaudeOAuthToken();

    if (!apiKey && !oauthToken) {
      console.error('Error: No Anthropic credentials found. Set ANTHROPIC_API_KEY or CRAFT_ANTHROPIC_API_KEY env var, or run `craft` in interactive mode to configure credentials for AI usage.');
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
      sessionId: cli.flags.session,
      sessionResume: cli.flags.sessionResume,
    });

    const result = await writeStreamingOutput(runner.runStreaming(), outputFormat);
    process.exit(result.success ? 0 : 1);
  }

  // ========================================
  // INTERACTIVE MODE (TUI)
  // ========================================

  // Clean up legacy workspace-based conversations (now using session-based storage)
  cleanupLegacyConversations();

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
  // Note: Don't handle SIGINT here - let Ink's useInput handle Ctrl+C
  // so we can implement double-press-to-exit behavior
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  // Get unified auth state
  const storedConfig = loadStoredConfig();
  const authState = await getAuthState();
  const setupNeeds = getSetupNeeds(authState);

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
      authState={authState}
      setupNeeds={setupNeeds}
      initialAgent={initialAgent}
      initialPrompt={initialPrompt}
    />,
    { exitOnCtrlC: false } // Let useInput handle Ctrl+C for double-press-to-exit
  );

  await waitUntilExit();
  cleanup();
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
