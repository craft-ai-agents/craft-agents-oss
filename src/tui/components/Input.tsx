import React, { useState, useCallback, memo, useMemo, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { getCommandHint, getAgentHint, getTabCompletion, type HintData } from '../utils/filtering.ts';

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
  /** Available sub-agent names for @mention autocomplete */
  availableAgents?: string[];
  /** Currently active agent name (for dynamic placeholder) */
  activeAgentName?: string;
  /** Terminal width in columns (for separator lines) */
  columns?: number;
}

// Helper: Find previous word boundary
const findPrevWordBoundary = (text: string, pos: number): number => {
  if (pos <= 0) return 0;
  let i = pos - 1;
  // Skip any whitespace first
  while (i > 0 && /\s/.test(text[i]!)) i--;
  // Then skip to the start of the word
  while (i > 0 && !/\s/.test(text[i - 1]!)) i--;
  return i;
};

// Helper: Find next word boundary
const findNextWordBoundary = (text: string, pos: number): number => {
  if (pos >= text.length) return text.length;
  let i = pos;
  // Skip current word
  while (i < text.length && !/\s/.test(text[i]!)) i++;
  // Skip whitespace to next word
  while (i < text.length && /\s/.test(text[i]!)) i++;
  return i;
};

// Text input with cursor navigation
// Uses ref as single source of truth for cursor (never synced from state)
const SimpleTextInput: React.FC<{
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onBackspaceEmpty?: () => void;
  onPastedText?: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
}> = ({
  value,
  onChange,
  onSubmit,
  onBackspaceEmpty,
  onPastedText,
  placeholder = '',
  disabled = false,
}) => {
  // Cursor ref is the SINGLE SOURCE OF TRUTH - never synced from state
  const cursorRef = useRef(value.length);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);

  // Force re-render when cursor/selection changes (without syncing back)
  const [, forceUpdate] = useState(0);
  const triggerRender = () => forceUpdate(n => n + 1);

  // Reset cursor when value changes externally (e.g., history navigation)
  const prevValueRef = useRef(value);
  if (value !== prevValueRef.current) {
    cursorRef.current = value.length;
    selectionRef.current = null;
    prevValueRef.current = value;
  }

  useInput(
    (input, key) => {
      if (disabled) return;

      const cursor = cursorRef.current;
      const sel = selectionRef.current;

      // Check for Option+arrow via escape sequences
      const isOptionLeft = input === 'b' && key.meta;
      const isOptionRight = input === 'f' && key.meta;
      const hasEscB = input === '\x1bb' || input === '\u001bb';
      const hasEscF = input === '\x1bf' || input === '\u001bf';

      if (isOptionLeft || hasEscB) {
        selectionRef.current = null;
        cursorRef.current = findPrevWordBoundary(value, cursor);
        triggerRender();
        return;
      }

      if (isOptionRight || hasEscF) {
        selectionRef.current = null;
        cursorRef.current = findNextWordBoundary(value, cursor);
        triggerRender();
        return;
      }

      if (key.return) {
        const trimmed = value.trim();
        const looksLikeFilePath = trimmed.startsWith('~/') ||
          (trimmed.startsWith('/') && trimmed.length > 2 && trimmed.slice(1).includes('/'));

        if (onPastedText && trimmed && looksLikeFilePath) {
          onPastedText(trimmed);
          onChange('');
          cursorRef.current = 0;
          selectionRef.current = null;
          prevValueRef.current = '';
          return;
        }
        onSubmit(value);
        return;
      }

      // Handle backspace/delete
      // Note: Some terminals send delete instead of backspace, so we treat delete-at-end as backspace
      const isActualBackspace = key.backspace || (key.delete && cursor === value.length);
      if (key.backspace || key.delete) {
        if (isActualBackspace) {
          if (sel) {
            const newValue = value.slice(0, sel.start) + value.slice(sel.end);
            onChange(newValue);
            cursorRef.current = sel.start;
            selectionRef.current = null;
            prevValueRef.current = newValue;
          } else if (cursor > 0) {
            const newValue = value.slice(0, cursor - 1) + value.slice(cursor);
            onChange(newValue);
            cursorRef.current = cursor - 1;
            prevValueRef.current = newValue;
          } else if (value.length > 0) {
            // Fallback: cursor is 0 but value has content - delete from end
            const newValue = value.slice(0, -1);
            onChange(newValue);
            cursorRef.current = newValue.length;
            prevValueRef.current = newValue;
          } else if (onBackspaceEmpty) {
            onBackspaceEmpty();
          }
        } else if (key.delete && cursor < value.length) {
          // Forward delete (only when not at end)
          if (sel) {
            const newValue = value.slice(0, sel.start) + value.slice(sel.end);
            onChange(newValue);
            cursorRef.current = sel.start;
            selectionRef.current = null;
            prevValueRef.current = newValue;
          } else if (cursor < value.length) {
            const newValue = value.slice(0, cursor) + value.slice(cursor + 1);
            onChange(newValue);
            prevValueRef.current = newValue;
          }
        }
        return;
      }

      // Arrow key navigation
      if (key.leftArrow) {
        const isCmdArrow = key.meta && input === '';

        if (key.shift) {
          const anchor = sel ? sel.start : cursor;
          const newPos = isCmdArrow ? 0 : Math.max(0, cursor - 1);
          cursorRef.current = newPos;
          if (newPos !== anchor) {
            selectionRef.current = { start: Math.min(anchor, newPos), end: Math.max(anchor, newPos) };
          } else {
            selectionRef.current = null;
          }
        } else {
          selectionRef.current = null;
          cursorRef.current = isCmdArrow ? 0 : Math.max(0, cursor - 1);
        }
        triggerRender();
        return;
      }

      if (key.rightArrow) {
        const isCmdArrow = key.meta && input === '';

        if (key.shift) {
          const anchor = sel ? sel.end : cursor;
          const newPos = isCmdArrow ? value.length : Math.min(value.length, cursor + 1);
          cursorRef.current = newPos;
          if (newPos !== (sel?.start ?? cursor)) {
            const start = sel ? sel.start : cursor;
            selectionRef.current = { start: Math.min(start, newPos), end: Math.max(start, newPos) };
          } else {
            selectionRef.current = null;
          }
        } else {
          selectionRef.current = null;
          cursorRef.current = isCmdArrow ? value.length : Math.min(value.length, cursor + 1);
        }
        triggerRender();
        return;
      }

      // Handle Ctrl+A to select all
      if (key.ctrl && input === 'a') {
        if (value.length > 0) {
          selectionRef.current = { start: 0, end: value.length };
          cursorRef.current = value.length;
          triggerRender();
        }
        return;
      }

      // Ignore other control keys
      if (key.escape || key.upArrow || key.downArrow || key.ctrl || key.meta) {
        return;
      }

      // Handle printable input
      if (input && input.length >= 1) {
        const chars = input.replace(/\x1b\[200~/g, '').replace(/\x1b\[201~/g, '');
        const printable = chars.split('').filter(c => c.charCodeAt(0) >= 32).join('');

        if (printable) {
          const looksLikePastedPath = printable.startsWith('~/') ||
            (printable.startsWith('/') && printable.length > 2 && printable.slice(1).includes('/'));

          if (onPastedText && printable.length > 1 && looksLikePastedPath) {
            onPastedText(printable);
          } else {
            let newValue: string;
            let newCursor: number;
            if (sel) {
              newValue = value.slice(0, sel.start) + printable + value.slice(sel.end);
              newCursor = sel.start + printable.length;
              selectionRef.current = null;
            } else {
              newValue = value.slice(0, cursor) + printable + value.slice(cursor);
              newCursor = cursor + printable.length;
            }
            onChange(newValue);
            cursorRef.current = newCursor;
            prevValueRef.current = newValue;
          }
        }
      }
    },
    { isActive: !disabled }
  );

  // Render the text with cursor and selection
  const cursor = cursorRef.current;
  const selection = selectionRef.current;

  if (value.length === 0) {
    if (disabled) {
      return <Text dimColor>{placeholder}</Text>;
    }
    return (
      <Text>
        <Text backgroundColor="blue" color="white"> </Text>
        <Text dimColor>{placeholder}</Text>
      </Text>
    );
  }

  const parts: React.ReactNode[] = [];

  for (let i = 0; i <= value.length; i++) {
    const char = i < value.length ? value[i]! : ' ';
    const isAtCursor = i === cursor && !disabled;
    const isSelected = selection && i >= selection.start && i < selection.end;

    if (i === value.length) {
      if (isAtCursor) {
        parts.push(<Text key={i} backgroundColor="blue" color="white"> </Text>);
      }
    } else if (isAtCursor) {
      parts.push(<Text key={i} backgroundColor="blue" color="white">{char}</Text>);
    } else if (isSelected) {
      parts.push(<Text key={i} backgroundColor="cyan" color="black">{char}</Text>);
    } else {
      parts.push(<Text key={i}>{char}</Text>);
    }
  }

  return <Text>{parts}</Text>;
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
  availableAgents = [],
  activeAgentName,
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

      // Handle Tab for auto-completion
      if (key.tab) {
        const completion = getTabCompletion(value, availableAgents);
        if (completion) {
          setValue(completion);
          setHistoryIndex(-1);
        }
        return;
      }

      // Handle up arrow for history (only if not using meta/shift modifiers)
      if (key.upArrow && !key.meta && !key.shift && history.length > 0) {
        const newIndex = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(newIndex);
        const histValue = history[history.length - 1 - newIndex] || '';
        setValue(histValue);
      }

      // Handle down arrow for history (only if not using meta/shift modifiers)
      if (key.downArrow && !key.meta && !key.shift && historyIndex > -1) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        if (newIndex < 0) {
          setValue('');
        } else {
          const histValue = history[history.length - 1 - newIndex] || '';
          setValue(histValue);
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

  // Determine placeholder text - dynamic based on active agent
  const placeholderText = disabled
    ? 'Thinking...'
    : placeholder
      ? placeholder
      : activeAgentName
        ? `Message @${activeAgentName}...`
        : 'Message Craft...';

  // Memoize command/mention hint to avoid recalculation
  const hintData = useMemo((): HintData | null => {
    // @mention hints
    if (value.startsWith('@')) {
      return getAgentHint(value.slice(1), availableAgents);
    }
    // Slash command hints
    if (value.startsWith('/')) {
      return getCommandHint(value);
    }
    return null;
  }, [value, availableAgents]);

  // Check if we have any hint to show
  const hasHint = hintData && (hintData.selected || hintData.others.length > 0);

  // Border color based on state
  const borderColor = disabled ? 'gray' : 'blue';

  // Separator line width (account for parent paddingX={1} = 2 chars)
  const separatorWidth = Math.max(1, columns - 2);

  return (
    <Box flexDirection="column" width="100%">
      {!disabled && hasHint && (
        <Box justifyContent="space-between" paddingLeft={2} marginBottom={1}>
          <Box>
            {hintData.selected ? (
              // Show selected (highlighted) + description + others
              <Text>
                <Text color="blue" bold>{hintData.selected}</Text>
                {hintData.description && <Text dimColor>: {hintData.description}</Text>}
                {hintData.others.length > 0 && (
                  <Text dimColor>  {hintData.others.join('  ')}</Text>
                )}
              </Text>
            ) : (
              // No selection, just show options
              <Text dimColor>{hintData.others.join('  ')}</Text>
            )}
          </Box>
          <Box />
        </Box>
      )}
      {/* Top separator - exact terminal width */}
      <Text color={borderColor}>{'─'.repeat(separatorWidth)}</Text>
      {/* Input row - use justifyContent="space-between" to fill full width */}
      <Box justifyContent="space-between">
        <Box>
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
        <Box />
      </Box>
      {/* Bottom separator - exact terminal width */}
      <Text color={borderColor}>{'─'.repeat(separatorWidth)}</Text>
    </Box>
  );
};

/**
 * Multiline input hint component
 */
export const InputHint: React.FC<{ visible?: boolean }> = memo(({ visible = true }) => {
  if (!visible) return null;

  return (
    <Box justifyContent="space-between" paddingX={1} marginTop={1}>
      <Text dimColor>
        ←→ move | ⌥←→ word | ⌘←→ line | ⇧ select | ↑↓ history | Ctrl+C exit
      </Text>
      <Box />
    </Box>
  );
});
