#!/usr/bin/env bun
import React, { useState, useCallback } from 'react';
import { render } from 'ink';
import meow from 'meow';
import { App } from './tui/App.tsx';
import { Setup } from './tui/components/Setup.tsx';
import {
  loadStoredConfig,
  getActiveWorkspace,
  getAnthropicApiKey,
  getClaudeOAuthToken,
  hasValidCredentials,
  type StoredConfig,
  type Workspace,
  type AuthType,
} from './config/storage.ts';
import type { CraftAgentConfig } from './agent/craft-agent.ts';
import { enableDebug } from './tui/utils/debug.ts';
import { initializeTracing, getTracingManager } from './tracing/index.ts';

const cli = meow(
  `
  Craft Document Assistant - A Claude Code-like TUI for Craft documents

  Usage
    $ craft-agent [options]

  Options
    --setup         Run the setup wizard (reconfigure)
    --url, -u       Craft MCP server URL (overrides saved config)
    --token, -t     Bearer token for authentication (overrides saved config)
    --model, -m     Claude model to use (default: claude-sonnet-4-5-20250929)
    --debug         Enable debug logging to /tmp/craft-debug.log
    --help          Show this help message
    --version       Show version number

  First Run
    On first run, you'll be guided through an interactive setup to configure
    your Anthropic API key and Craft MCP server connection.

  Configuration
    Settings are stored in ~/.craft-agent/config.json
    Run with --setup to reconfigure at any time.

  Examples
    $ craft-agent
    $ craft-agent --setup
    $ craft-agent --url http://localhost:3000/v1/links/abc123/mcp
`,
  {
    importMeta: import.meta,
    flags: {
      setup: {
        type: 'boolean',
        default: false,
      },
      url: {
        type: 'string',
        shortFlag: 'u',
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
  }
);

// Root component that handles setup vs main app
interface RootProps {
  initialConfig: StoredConfig | null;
  cliFlags: typeof cli.flags;
  forceSetup: boolean;
  initialCredentials: { apiKey: string | null; oauthToken: string | null } | null;
  initialHasValidCredentials: boolean;
}

const Root: React.FC<RootProps> = ({ initialConfig, cliFlags, forceSetup, initialCredentials, initialHasValidCredentials }) => {
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
  // If CLI URL is provided, create a temporary workspace object for it
  const workspace: Workspace = cliFlags.url
    ? {
        id: 'cli-override',
        name: 'CLI Override',
        mcpUrl: cliFlags.url,
        isPublic: true, // Assume public for CLI override
        createdAt: Date.now(),
      }
    : activeWorkspace;

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

  return <App config={agentConfig} onRequestSetup={handleRequestSetup} />;
};

async function main() {
  // Enable debug logging if --debug flag is passed
  if (cli.flags.debug) {
    enableDebug();
  }

  await initializeTracing();

  // Clear screen and move cursor to top-left
  process.stdout.write('\x1b[2J\x1b[H');

  // Enable bracketed paste mode for better paste/drag-drop handling
  // This wraps pasted text with escape sequences so we can detect it
  process.stdout.write('\x1b[?2004h');

  // Ensure we clean up on exit
  const cleanup = () => {
    process.stdout.write('\x1b[?2004l'); // Disable bracketed paste mode
    getTracingManager().flush().catch(() => {});
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

  // Render the root component
  const { waitUntilExit } = render(
    <Root
      initialConfig={storedConfig}
      cliFlags={cli.flags}
      forceSetup={forceSetup}
      initialCredentials={initialCredentials}
      initialHasValidCredentials={initialHasValidCredentials}
    />
  );

  await waitUntilExit();
  cleanup();
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
