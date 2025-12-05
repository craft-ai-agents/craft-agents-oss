import React, { useState, useCallback, memo, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';

export interface InputProps {
  onSubmit: (input: string) => void;
  onPaste?: () => void;
  onRemoveAttachment?: () => void;
  onClearAttachments?: () => void;
  onPastedText?: (text: string) => void;
  disabled?: boolean;
  history?: string[];
  placeholder?: string;
  attachmentCount?: number;
  attachmentLabel?: string;
  columns?: number;
}

// Simple custom text input without cursor animation
const SimpleTextInput: React.FC<{
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onBackspaceEmpty?: () => void;
  onPastedText?: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
}> = ({ value, onChange, onSubmit, onBackspaceEmpty, onPastedText, placeholder = '', disabled = false }) => {
  useInput(
    (input, key) => {
      if (disabled) return;

      if (key.return) {
        // Check if the current input looks like a file path (not a slash command)
        // File paths: /Users/..., ~/Documents/... but NOT /clear, /help, etc.
        const trimmed = value.trim();
        const looksLikeFilePath = trimmed.startsWith('~/') ||
          (trimmed.startsWith('/') && trimmed.length > 2 && trimmed.slice(1).includes('/'));

        if (onPastedText && trimmed && looksLikeFilePath) {
          onPastedText(trimmed);
          onChange('');
          return;
        }
        onSubmit(value);
        return;
      }

      if (key.backspace || key.delete) {
        if (value.length === 0 && onBackspaceEmpty) {
          onBackspaceEmpty();
        } else {
          onChange(value.slice(0, -1));
        }
        return;
      }

      // Ignore control characters
      if (key.ctrl || key.meta || key.escape || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
        return;
      }

      // Get printable input
      if (input && input.length >= 1) {
        // Strip bracketed paste markers
        const chars = input.replace(/\x1b\[200~/g, '').replace(/\x1b\[201~/g, '');
        // Filter to printable characters
        const printable = chars.split('').filter(c => c.charCodeAt(0) >= 32).join('');

        if (printable) {
          // Check if this is a pasted file path (multi-char input with path structure)
          const looksLikePastedPath = printable.startsWith('~/') ||
            (printable.startsWith('/') && printable.length > 2 && printable.slice(1).includes('/'));

          if (onPastedText && printable.length > 1 && looksLikePastedPath) {
            onPastedText(printable);
          } else {
            onChange(value + printable);
          }
        }
      }
    },
    { isActive: !disabled }
  );

  const displayValue = value || '';
  const showPlaceholder = displayValue.length === 0;

  return (
    <Text>
      {showPlaceholder ? (
        <>
          {!disabled && <Text color="blue">▌</Text>}
          <Text dimColor>{placeholder}</Text>
        </>
      ) : (
        <>
          <Text>{displayValue}</Text>
          {!disabled && <Text color="blue">▌</Text>}
        </>
      )}
    </Text>
  );
};

// Horizontal line for top/bottom borders
const HorizontalLine: React.FC<{ color: string; columns: number }> = ({ color, columns }) => {
  const width = Math.max(20, columns - 6);
  return (
    <Text color={color}>{'─'.repeat(width)}</Text>
  );
};

// Memoized prompt character
const InputPrompt = memo<{ disabled: boolean }>(({ disabled }) => (
  <Text color={disabled ? 'gray' : 'blue'} bold>
    {disabled ? '◌' : '>'}{' '}
  </Text>
));

export const Input: React.FC<InputProps> = ({
  onSubmit,
  onPaste,
  onRemoveAttachment,
  onClearAttachments,
  onPastedText,
  disabled = false,
  history = [],
  placeholder,
  attachmentCount = 0,
  attachmentLabel,
  columns = 80,
}) => {
  const [value, setValue] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);

  const handleSubmit = useCallback(
    (input: string) => {
      if (input.trim() && !disabled) {
        onSubmit(input.trim());
        setValue('');
        setHistoryIndex(-1);
      }
    },
    [onSubmit, disabled]
  );

  useInput(
    (input, key) => {
      if (disabled) return;

      // Handle up arrow for history
      if (key.upArrow && history.length > 0) {
        const newIndex = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(newIndex);
        setValue(history[history.length - 1 - newIndex] || '');
      }

      // Handle down arrow for history
      if (key.downArrow && historyIndex > -1) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        if (newIndex < 0) {
          setValue('');
        } else {
          setValue(history[history.length - 1 - newIndex] || '');
        }
      }

      // Handle Ctrl+U to clear line (Ctrl+U = ASCII 21 = '\x15')
      if (input === '\x15' || (key.ctrl && input === 'u')) {
        setValue('');
        setHistoryIndex(-1);
      }

      // Handle Escape to clear input and attachments (when not processing - App handles interrupt)
      if (key.escape && !disabled) {
        if (value.length > 0) {
          setValue('');
          setHistoryIndex(-1);
        }
        if (onClearAttachments) {
          onClearAttachments();
        }
      }

      // Handle paste from clipboard
      // Ctrl+V (ASCII 22 / 0x16) - often intercepted by terminal
      // Ctrl+P (ASCII 16 / 0x10) - alternative that works in more terminals
      const charCode = input.charCodeAt(0);
      const isCtrlV = charCode === 22 || input === '\x16' || (key.ctrl && (input === 'v' || input === 'V'));
      const isCtrlP = charCode === 16 || input === '\x10' || (key.ctrl && (input === 'p' || input === 'P'));
      if (isCtrlV || isCtrlP) {
        if (onPaste) onPaste();
      }
    },
    { isActive: !disabled }
  );

  // Determine placeholder text
  const placeholderText = disabled
    ? 'Thinking...'
    : placeholder || 'Message Craft...';

  // Memoize command hint to avoid recalculation
  const commandHint = useMemo(() => {
    if (!value.startsWith('/')) return null;
    return getCommandHint(value);
  }, [value]);

  const lineColor = disabled ? 'gray' : 'blue';

  return (
    <Box flexDirection="column" width="100%">
      {!disabled && commandHint && (
        <Box paddingLeft={2} marginBottom={1}>
          <Text dimColor>{commandHint}</Text>
        </Box>
      )}
      {/* Top line */}
      <HorizontalLine color={lineColor} columns={columns} />
      {/* Input row */}
      <Box paddingX={1}>
        <InputPrompt disabled={disabled} />
        {attachmentCount > 0 && (
          <Text color="cyan">
            [{attachmentLabel || (attachmentCount === 1 ? '1 file' : `${attachmentCount} files`)}]{' '}
          </Text>
        )}
        <SimpleTextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          onBackspaceEmpty={onRemoveAttachment}
          onPastedText={onPastedText}
          placeholder={placeholderText}
          disabled={disabled}
        />
      </Box>
      {/* Bottom line */}
      <HorizontalLine color={lineColor} columns={columns} />
    </Box>
  );
};

/**
 * Get hint text for slash commands
 */
function getCommandHint(input: string): string {
  const cmd = input.toLowerCase().trim();

  if (cmd === '/') {
    return 'Commands: /help /clear /paste /tools /config /prefs /model /cost /exit';
  }

  const commands: Record<string, string> = {
    '/help': 'Show help and available commands',
    '/clear': 'Clear conversation history',
    '/paste': 'Paste files/images from clipboard',
    '/image': 'Paste files/images from clipboard',
    '/tools': 'List available Craft MCP tools',
    '/config': 'Show current configuration',
    '/prefs': 'Show user preferences',
    '/setup': 'Reconfigure API keys and MCP settings',
    '/compact': 'Toggle compact mode for tool output',
    '/model': 'Show or change the Claude model',
    '/cost': 'Show token usage and estimated cost',
    '/web': 'Toggle web search capability',
    '/fetch': 'Toggle web fetch capability',
    '/code': 'Toggle code execution capability',
    '/exit': 'Exit the application',
    '/quit': 'Exit the application',
    '/q': 'Exit the application',
  };

  // Find matching commands
  const matches = Object.entries(commands)
    .filter(([c]) => c.startsWith(cmd))
    .map(([c, desc]) => `${c}: ${desc}`);

  if (matches.length === 1 && matches[0]) {
    return matches[0];
  } else if (matches.length > 1 && matches.length <= 4) {
    return matches.map(m => m.split(':')[0] || '').join(' | ');
  }

  return '';
}

/**
 * Multiline input hint component
 */
export const InputHint: React.FC<{ visible?: boolean }> = memo(({ visible = true }) => {
  if (!visible) return null;

  return (
    <Box paddingX={1} marginTop={1}>
      <Text dimColor>
        Enter send | ↑↓ history | /paste or drag files | ⌫ remove file | Ctrl+C exit
      </Text>
    </Box>
  );
});
