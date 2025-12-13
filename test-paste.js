#!/usr/bin/env bun
// Test script to debug paste behavior with Ink's useInput
// This mimics how Ink processes input events

import React from 'react';
import { render, Text, useInput } from 'ink';

const PasteTest = () => {
  const [log, setLog] = React.useState([]);

  useInput((input, key) => {
    const logEntry = [
      `Input: ${JSON.stringify(input)}`,
      `Length: ${input.length}`,
      `Keys: ${JSON.stringify(key)}`,
    ].join(' | ');

    setLog(prev => [...prev.slice(-10), logEntry]); // Keep last 10 entries
  });

  return (
    <>
      <Text bold color="green">
        Paste test with Ink's useInput hook
      </Text>
      <Text dimColor>
        Paste some text with Cmd+V, then press Ctrl+C to exit
      </Text>
      <Text>{'\n'}</Text>
      {log.map((entry, i) => (
        <Text key={i}>{entry}</Text>
      ))}
    </>
  );
};

// Enable bracketed paste mode
process.stdout.write('\x1b[?2004h');

const { waitUntilExit } = render(<PasteTest />);

// Cleanup on exit
const cleanup = () => {
  process.stdout.write('\x1b[?2004l');
};

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

await waitUntilExit();
