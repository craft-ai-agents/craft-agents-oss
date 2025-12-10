import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import open from 'open';
import { getAiCreditTopUpUrl } from '../../auth/balance.ts';

export interface BalanceProps {
  onClose: () => void;
}

type BalanceState =
  | { type: 'loading' }
  | { type: 'ready'; url: string }
  | { type: 'error'; message: string };

export const Balance: React.FC<BalanceProps> = ({ onClose }) => {
  const [state, setState] = useState<BalanceState>({ type: 'loading' });

  useEffect(() => {
    const fetchUrl = async () => {
      try {
        const url = await getAiCreditTopUpUrl();
        if (!url) {
          setState({
            type: 'error',
            message: 'Could not determine team ID. Please try again later.',
          });
          return;
        }
        setState({ type: 'ready', url });
      } catch (err) {
        setState({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to get balance URL',
        });
      }
    };
    fetchUrl();
  }, []);

  const openUrl = async (url: string) => {
    await open(url);
    onClose();
  };

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (state.type === 'ready') {
      if (key.return || input.toLowerCase() === 'o') {
        void openUrl(state.url);
      }
    }

    if (state.type === 'error' && key.return) {
      onClose();
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>AI Credits Top-up</Text>
      </Box>

      {state.type === 'loading' && (
        <Box>
          <Text dimColor>Loading...</Text>
        </Box>
      )}

      {state.type === 'ready' && (
        <>
          <Box flexDirection="column">
            <Text>URL: <Text color="cyan">{state.url}</Text></Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              Press <Text bold>o</Text> or <Text bold>Enter</Text> to open | <Text bold>Esc</Text> to go back
            </Text>
          </Box>
        </>
      )}

      {state.type === 'error' && (
        <>
          <Box>
            <Text color="red">{state.message}</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              Press <Text bold>Enter</Text> or <Text bold>Esc</Text> to go back
            </Text>
          </Box>
        </>
      )}
    </Box>
  );
};
