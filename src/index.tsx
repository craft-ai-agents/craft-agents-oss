#!/usr/bin/env bun
import React, { useState, useCallback } from 'react';
import { render } from 'ink';
import meow from 'meow';
import { App } from './tui/App.tsx';
import { Setup } from './tui/components/Setup.tsx';
import { loadStoredConfig, type StoredConfig } from './config/storage.ts';
import type { CraftAgentConfig } from './agent/craft-agent.ts';

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
    },
  }
);

// Root component that handles setup vs main app
interface RootProps {
  initialConfig: StoredConfig | null;
  cliFlags: typeof cli.flags;
  forceSetup: boolean;
}

const Root: React.FC<RootProps> = ({ initialConfig, cliFlags, forceSetup }) => {
  const [showSetup, setShowSetup] = useState(forceSetup || !initialConfig);
  const [config, setConfig] = useState<StoredConfig | null>(initialConfig);

  const handleSetupComplete = useCallback((newConfig: StoredConfig) => {
    setConfig(newConfig);
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

  // Build agent config from stored config + CLI overrides
  const agentConfig: CraftAgentConfig = {
    mcpUrl: cliFlags.url || config.craftMcpUrl,
    // Token can come from CLI flag (for testing) - OAuth tokens are loaded from storage in the agent
    mcpToken: cliFlags.token,
    model: cliFlags.model || config.model,
  };

  // Set API key in environment for the SDK
  process.env.ANTHROPIC_API_KEY = config.anthropicApiKey;

  return <App config={agentConfig} onRequestSetup={handleRequestSetup} />;
};

async function main() {
  // Clear screen
  console.clear();

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

  // Check for existing config
  const storedConfig = loadStoredConfig();
  const forceSetup = cli.flags.setup;

  // Render the root component
  const { waitUntilExit } = render(
    <Root
      initialConfig={storedConfig}
      cliFlags={cli.flags}
      forceSetup={forceSetup}
    />
  );

  await waitUntilExit();
  cleanup();
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
