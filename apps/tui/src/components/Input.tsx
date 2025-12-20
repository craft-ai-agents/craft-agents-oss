import React, { useState, useCallback, memo, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { getCommandHint, getAgentHint, getTabCompletion, getHintDescription, type HintData } from '../utils/filtering.ts';
import { TextInput } from './TextInput.tsx';
import { isHistorySearch, isAbort } from '../keyboard/index.ts';
import { debug } from '@craft-agent/shared/utils';

export interface InputProps {
  onSubmit: (input: string) => void;
  onPaste?: () => void;
  onRemoveAttachment?: () => void;
  onClearAttachments?: () => void;
  onPastedText?: (text: string) => void;
  /** Callback when Ctrl+C is pressed (for double-press exit behavior) */
  onCtrlC?: () => void;
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

// Memoized prompt character - shows regular prompt even when disabled
// (the Messages component handles showing the thinking indicator)
const InputPrompt = memo<{ disabled: boolean }>(({ disabled }) => (
  <Text color={disabled ? 'gray' : 'blue'} bold>
    {'>'}{' '}
  </Text>
));


export const Input: React.FC<InputProps> = ({
  onSubmit,
  onPaste,
  onRemoveAttachment,
  onClearAttachments,
  onPastedText,
  onCtrlC,
  disabled = false,
  history = [],
  placeholder,
  attachmentCount = 0,
  attachmentLabel,
  availableAgents = [],
  activeAgentName,
  columns = 80,
}) => {
  const [value, setValueRaw] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [hintIndex, setHintIndex] = useState(0);

  // Search mode state
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchIndex, setSearchMatchIndex] = useState(-1);
  const [savedInputBeforeSearch, setSavedInputBeforeSearch] = useState('');

  // Wrap setValue to reset history and hint indices when value changes
  const setValue = useCallback((newValue: string) => {
    setValueRaw(newValue);
    setHintIndex(0); // Reset hint selection on input change
    if (newValue === '') {
      setHistoryIndex(-1);
    }
  }, []);

  // Find matching history item (reverse search from startIndex)
  const findMatch = useCallback((query: string, startIndex: number): number => {
    if (!query || history.length === 0) return -1;
    const lowerQuery = query.toLowerCase();

    // Search backwards from startIndex (or end of history if -1)
    const start = startIndex >= 0 ? startIndex - 1 : history.length - 1;
    for (let i = start; i >= 0; i--) {
      if (history[i]?.toLowerCase().includes(lowerQuery)) {
        return i;
      }
    }
    return -1; // No match
  }, [history]);

  // Enter search mode
  const startSearch = useCallback(() => {
    setSavedInputBeforeSearch(value);
    setIsSearching(true);
    setSearchQuery('');
    setSearchMatchIndex(-1);
  }, [value]);

  // Exit search mode and accept current match
  const acceptSearch = useCallback(() => {
    if (searchMatchIndex >= 0 && history[searchMatchIndex]) {
      setValue(history[searchMatchIndex]);
    }
    setIsSearching(false);
    setSearchQuery('');
    setSearchMatchIndex(-1);
  }, [searchMatchIndex, history, setValue]);

  // Exit search mode and cancel (restore original input)
  const cancelSearch = useCallback(() => {
    setValue(savedInputBeforeSearch);
    setIsSearching(false);
    setSearchQuery('');
    setSearchMatchIndex(-1);
  }, [savedInputBeforeSearch, setValue]);

  // Update search query and find match
  const updateSearchQuery = useCallback((newQuery: string) => {
    setSearchQuery(newQuery);
    const matchIndex = findMatch(newQuery, -1); // Start from newest
    setSearchMatchIndex(matchIndex);
  }, [findMatch]);

  // Find next (older) match, wrapping around to newest when reaching the end
  const findNextMatch = useCallback(() => {
    if (searchMatchIndex >= 0) {
      const nextIndex = findMatch(searchQuery, searchMatchIndex);
      if (nextIndex >= 0) {
        setSearchMatchIndex(nextIndex);
      } else {
        // No more older matches, wrap around to newest match
        const newestMatch = findMatch(searchQuery, -1);
        if (newestMatch >= 0) {
          setSearchMatchIndex(newestMatch);
        }
      }
    }
  }, [searchQuery, searchMatchIndex, findMatch]);

  // Count all matches in history for display
  const searchMatchInfo = useMemo(() => {
    if (!searchQuery || history.length === 0) return { total: 0, current: 0 };
    const lowerQuery = searchQuery.toLowerCase();
    const matchingIndices: number[] = [];
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i]?.toLowerCase().includes(lowerQuery)) {
        matchingIndices.push(i);
      }
    }
    const current = searchMatchIndex >= 0 ? matchingIndices.indexOf(searchMatchIndex) + 1 : 0;
    return { total: matchingIndices.length, current };
  }, [searchQuery, history, searchMatchIndex]);

  // Memoize command/mention hint to avoid recalculation
  // Defined early so it can be used in useInput handler
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

  // Combine all hints into a single navigable list
  const allHints = useMemo((): string[] => {
    if (!hintData) return [];
    const hints: string[] = [];
    if (hintData.selected) hints.push(hintData.selected);
    hints.push(...hintData.others);
    return hints;
  }, [hintData]);

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
      if (disabled) {
        debug('[Input] useInput disabled, ignoring input');
        return;
      }

      // Handle Ctrl+C for exit warning / double-press exit
      const isCtrlC = input === '\x03' || (key.ctrl && input === 'c');
      debug('[Input] useInput received:', { input: input.charCodeAt(0), isCtrlC, hasOnCtrlC: !!onCtrlC, disabled });
      if (isCtrlC && onCtrlC) {
        debug('[Input] Ctrl+C detected, calling onCtrlC');
        // Clear input if there's text
        if (value.length > 0) {
          setValue('');
        }
        if (onClearAttachments) {
          onClearAttachments();
        }
        onCtrlC();
        return;
      }

      // Handle Ctrl+R for history search
      if (isHistorySearch(input, key)) {
        if (isSearching) {
          // Already searching - find next match
          findNextMatch();
        } else {
          // Enter search mode
          startSearch();
        }
        return;
      }

      // Handle search mode keyboard events
      if (isSearching) {
        // Escape or Ctrl+G cancels search
        if (key.escape || isAbort(input, key)) {
          cancelSearch();
          return;
        }

        // Left/Right arrows, Enter, or Tab accept match and exit search mode
        // TextInput will handle cursor movement on the next render
        if (key.leftArrow || key.rightArrow || key.return || key.tab) {
          acceptSearch();
          return;
        }

        // Backspace removes from search query
        // Check key.backspace, key.delete, or raw character codes (127=DEL, 8=BS)
        const charCode = input.charCodeAt(0);
        if (key.backspace || key.delete || charCode === 127 || charCode === 8) {
          if (searchQuery.length > 0) {
            updateSearchQuery(searchQuery.slice(0, -1));
          }
          return;
        }

        // Regular printable characters update search query
        if (input.length === 1 && input.charCodeAt(0) >= 32 && !key.ctrl && !key.meta) {
          updateSearchQuery(searchQuery + input);
          return;
        }

        // Ignore other keys in search mode
        return;
      }

      // Handle Tab for auto-completion
      // If hints are visible, use the keyboard-navigated selection
      if (key.tab) {
        if (allHints.length > 0) {
          // Use keyboard-navigated hint from allHints
          const idx = Math.min(hintIndex, allHints.length - 1);
          const completion = allHints[idx];
          if (completion) {
            // Add space after completion for commands/mentions
            setValue(completion + ' ');
            setHistoryIndex(-1);
          }
        } else {
          // Fallback to original tab completion (for partial matches without hints)
          const completion = getTabCompletion(value, availableAgents);
          if (completion) {
            setValue(completion);
            setHistoryIndex(-1);
          }
        }
        return;
      }

      // Handle up/down arrows for hint navigation when hints are visible
      if (key.upArrow && !key.meta && !key.shift) {
        if (allHints.length > 0) {
          // Navigate hints (wrap around)
          setHintIndex(prev => (prev - 1 + allHints.length) % allHints.length);
          return;
        } else if (history.length > 0) {
          // Navigate history
          const newIndex = Math.min(historyIndex + 1, history.length - 1);
          setHistoryIndex(newIndex);
          const histValue = history[history.length - 1 - newIndex] || '';
          setValueRaw(histValue); // Use setValueRaw to avoid resetting hintIndex
        }
        return;
      }

      if (key.downArrow && !key.meta && !key.shift) {
        if (allHints.length > 0) {
          // Navigate hints (wrap around)
          setHintIndex(prev => (prev + 1) % allHints.length);
          return;
        } else if (historyIndex > -1) {
          // Navigate history
          const newIndex = historyIndex - 1;
          setHistoryIndex(newIndex);
          if (newIndex < 0) {
            setValueRaw('');
          } else {
            const histValue = history[history.length - 1 - newIndex] || '';
            setValueRaw(histValue);
          }
        }
        return;
      }

      // Handle Escape to clear input and attachments (when not processing - App handles interrupt)
      if (key.escape && !disabled) {
        if (value.length > 0) {
          setValue('');  // This also resets history index
        }
        if (onClearAttachments) {
          onClearAttachments();
        }
      }

      // Handle paste from clipboard
      // Ctrl+V (ASCII 22 / 0x16) - often intercepted by terminal
      // Ctrl+P (ASCII 16 / 0x10) - alternative that works in more terminals
      const pasteCharCode = input.charCodeAt(0);
      const isCtrlV = pasteCharCode === 22 || input === '\x16' || (key.ctrl && (input === 'v' || input === 'V'));
      const isCtrlP = pasteCharCode === 16 || input === '\x10' || (key.ctrl && (input === 'p' || input === 'P'));
      if (isCtrlV || isCtrlP) {
        if (onPaste) onPaste();
      }
    },
    { isActive: !disabled }
  );

  // Determine placeholder text - dynamic based on active agent
  // Don't show "Thinking..." when disabled - the Messages component has its own ThinkingIndicator
  const placeholderText = disabled
    ? ''
    : placeholder
      ? placeholder
      : activeAgentName
        ? `Message @${activeAgentName}...`
        : 'Message Craft...';

  // Check if we have any hint to show
  const hasHint = hintData && (hintData.selected || hintData.others.length > 0);

  // Clamp hintIndex to valid range
  const effectiveHintIndex = allHints.length > 0 ? Math.min(hintIndex, allHints.length - 1) : 0;

  // Calculate visible window for dropdown (max 5 items)
  const maxVisibleHints = 5;
  const scrollOffset = Math.max(0, effectiveHintIndex - maxVisibleHints + 1);
  const visibleHints = allHints.slice(scrollOffset, scrollOffset + maxVisibleHints);
  const visibleSelectedIndex = effectiveHintIndex - scrollOffset;
  const hasMoreAbove = scrollOffset > 0;
  const hasMoreBelow = scrollOffset + maxVisibleHints < allHints.length;

  // Border color based on state
  const borderColor = disabled ? 'gray' : 'blue';

  // Separator line width (account for parent paddingX={1} = 2 chars)
  const separatorWidth = Math.max(1, columns - 2);

  // Get the current search result text for display
  const searchResultText = searchMatchIndex >= 0 ? history[searchMatchIndex] : null;

  return (
    <Box flexDirection="column" width="100%">
      {/* Search mode UI */}
      {isSearching && (
        <Box flexDirection="column" marginBottom={1}>
          <Box paddingLeft={2}>
            <Text color="yellow">(search): </Text>
            <Text>{searchQuery}</Text>
            <Text color="gray">▏</Text>
            {searchMatchInfo.total > 0 && (
              <Text dimColor> [{searchMatchInfo.current}/{searchMatchInfo.total}]</Text>
            )}
          </Box>
          {searchResultText ? (
            <Box paddingLeft={2}>
              <Text dimColor>  → </Text>
              <Text>{searchResultText.length > columns - 10 ? searchResultText.slice(0, columns - 13) + '...' : searchResultText}</Text>
              {searchMatchInfo.total > 1 && (
                <Text dimColor>  (Ctrl+R next)</Text>
              )}
            </Box>
          ) : searchQuery ? (
            <Box paddingLeft={2}>
              <Text color="red" dimColor>  no match</Text>
            </Box>
          ) : (
            <Box paddingLeft={2}>
              <Text dimColor>  type to search history...</Text>
            </Box>
          )}
        </Box>
      )}
      {/* Top separator - exact terminal width */}
      <Text color={isSearching ? 'yellow' : borderColor}>{'─'.repeat(separatorWidth)}</Text>
      {/* Input row - use justifyContent="space-between" to fill full width */}
      <Box justifyContent="space-between">
        <Box>
          {isSearching ? (
            // In search mode, show the matched result (or empty) as preview
            <>
              <Text color="yellow" bold>{'>'} </Text>
              <Text dimColor>{searchResultText || savedInputBeforeSearch || placeholderText}</Text>
            </>
          ) : (
            // Normal input mode
            <>
              <InputPrompt disabled={disabled} />
              {attachmentCount > 0 && (
                <Text color="cyan">
                  [{attachmentLabel || (attachmentCount === 1 ? '1 file' : `${attachmentCount} files`)}]{' '}
                </Text>
              )}
              <TextInput
                value={value}
                onChange={setValue}
                onSubmit={handleSubmit}
                onBackspaceEmpty={onRemoveAttachment}
                onPastedText={onPastedText}
                placeholder={placeholderText}
                disabled={disabled}
                detectFilePaths
                multiline
              />
            </>
          )}
        </Box>
        <Box />
      </Box>
      {/* Bottom separator - exact terminal width */}
      <Text color={borderColor}>{'─'.repeat(separatorWidth)}</Text>
      {/* Command/mention hints dropdown (only when not searching) */}
      {!isSearching && !disabled && hasHint && allHints.length > 0 && (() => {
        // Calculate max hint width for alignment
        const maxHintWidth = Math.max(...visibleHints.map(h => h.length));
        return (
          <Box flexDirection="column" paddingLeft={2}>
            {hasMoreAbove && (
              <Text dimColor>  ↑ more</Text>
            )}
            {visibleHints.map((hint, idx) => {
              const isSelected = idx === visibleSelectedIndex;
              const description = getHintDescription(hint);
              const padding = ' '.repeat(maxHintWidth - hint.length + 2);
              return (
                <Box key={hint}>
                  <Text
                    color={isSelected ? 'blue' : undefined}
                    bold={isSelected}
                    inverse={isSelected}
                  >
                    {' '}{hint}{padding}{description || ''}{' '}
                  </Text>
                </Box>
              );
            })}
            {hasMoreBelow && (
              <Text dimColor>  ↓ more</Text>
            )}
          </Box>
        );
      })()}
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
        ←→ move | ⌥←→ word | ⌘←→ line | ⇧ select | ⇧↵ newline | ↑↓ history | ^R search | Ctrl+C exit
      </Text>
      <Box />
    </Box>
  );
});
