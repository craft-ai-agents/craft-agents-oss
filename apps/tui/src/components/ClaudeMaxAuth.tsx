import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { AnimatedSpinner } from './Spinner.tsx';
import { getExistingClaudeToken, isClaudeCliInstalled, runClaudeSetupToken } from '@craft-agent/shared/auth';

export interface ClaudeMaxAuthProps {
  onSubmit: (token: string) => void;
  onCancel: () => void;
}

type ViewMode = 'loading' | 'select' | 'running-setup' | 'no-options';

export const ClaudeMaxAuth: React.FC<ClaudeMaxAuthProps> = ({
  onSubmit,
  onCancel,
}) => {
  const [mode, setMode] = useState<ViewMode>('loading');
  const [existingToken, setExistingToken] = useState<string | null>(null);
  const [hasClaudeCli, setHasClaudeCli] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [setupStatus, setSetupStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Check for existing token and CLI on mount
  useEffect(() => {
    const token = getExistingClaudeToken();
    const cliInstalled = isClaudeCliInstalled();

    setExistingToken(token);
    setHasClaudeCli(cliInstalled);

    // If no options available, show error
    if (!token && !cliInstalled) {
      setMode('no-options');
    } else {
      setMode('select');
    }
  }, []);

  // Build options based on what's available
  const options: { id: string; label: string; desc: string; action: () => void }[] = [];

  if (existingToken) {
    options.push({
      id: 'existing',
      label: 'Use existing token',
      desc: `Found: ${existingToken.slice(0, 20)}...`,
      action: () => onSubmit(existingToken),
    });
  }

  if (hasClaudeCli) {
    options.push({
      id: 'setup',
      label: 'Run claude setup-token',
      desc: 'Opens browser to authenticate',
      action: () => handleRunSetupToken(),
    });
  }

  const handleRunSetupToken = useCallback(async () => {
    setMode('running-setup');
    setError(null);

    const result = await runClaudeSetupToken((status) => {
      setSetupStatus(status);
    });

    if (result.success && result.token) {
      onSubmit(result.token);
    } else {
      setError(result.error || 'Failed to get token');
      setMode('select');
    }
  }, [onSubmit]);

  // Handle keyboard navigation in select mode
  useInput((_input, key) => {
    if (mode === 'no-options') {
      if (key.escape) {
        onCancel();
      }
      return;
    }

    if (mode !== 'select') return;

    if (key.upArrow && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    } else if (key.downArrow && selectedIndex < options.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    } else if (key.return) {
      options[selectedIndex]?.action();
    } else if (key.escape) {
      onCancel();
    }
  }, { isActive: mode === 'select' || mode === 'no-options' });

  if (mode === 'loading') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor>Checking for existing Claude token...</Text>
      </Box>
    );
  }

  if (mode === 'running-setup') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold>Claude Max Authentication</Text>
        </Box>
        <Box marginY={1}>
          <AnimatedSpinner />
          <Text> {setupStatus || 'Opening browser...'}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Complete authentication in your browser</Text>
        </Box>
      </Box>
    );
  }

  if (mode === 'no-options') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold>Claude Max Authentication</Text>
        </Box>

        <Box marginY={1}>
          <Text color="yellow">Claude CLI is required for Claude Max authentication.</Text>
        </Box>

        <Box flexDirection="column" marginY={1}>
          <Text dimColor>To use Claude Max, install the Claude CLI:</Text>
          <Box marginTop={1} marginLeft={2}>
            <Text color="cyan">npm install -g @anthropic-ai/claude-code</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Then run this setup again.</Text>
          </Box>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  // Select mode
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>Claude Max Authentication</Text>
      </Box>

      <Text dimColor>Choose how to provide your Claude Max token:</Text>

      {error && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginY={1}>
        {options.map((opt, i) => (
          <Box key={opt.id} flexDirection="column">
            <Box>
              <Text color={selectedIndex === i ? 'cyan' : undefined}>
                {selectedIndex === i ? '› ' : '  '}
              </Text>
              <Text color={selectedIndex === i ? 'cyan' : 'white'} bold={selectedIndex === i}>
                {opt.label}
              </Text>
            </Box>
            {selectedIndex === i && (
              <Box marginLeft={4}>
                <Text dimColor>{opt.desc}</Text>
              </Box>
            )}
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate • ↵ select • Esc cancel</Text>
      </Box>
    </Box>
  );
};
