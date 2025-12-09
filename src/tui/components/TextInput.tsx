import React, { useState, useRef } from 'react';
import { Text, useInput } from 'ink';
import { isShiftEnter, isLineStart, isLineEnd, isShiftVariant, isWordLeft, isWordRight, isClearLine, isCancel } from '../keyboard/index.ts';

export interface TextInputProps {
  // Required
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;

  // Optional callbacks
  onBackspaceEmpty?: () => void;
  onPastedText?: (text: string) => void;
  onCancel?: () => void;  // Called on Escape or Ctrl+C

  // Display
  placeholder?: string;
  disabled?: boolean;

  // Masking (for passwords/API keys)
  mask?: string | boolean;  // true = '*', string = custom char
  maskReveal?: { first?: number; last?: number };

  // Navigation (all default to true)
  enableNavigation?: boolean;
  enableSelection?: boolean;
  enableWordNavigation?: boolean;

  // File path detection (default false)
  // When true, pasted/submitted file paths call onPastedText instead of normal handling
  detectFilePaths?: boolean;

  // Cursor style
  cursorStyle?: 'block' | 'bar';  // default: 'block'
  cursorColor?: string;           // default: 'blue'

  isActive?: boolean;

  // Multiline support (default false)
  // When true, shift+return inserts newline instead of submit
  multiline?: boolean;
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

// Helper: Get line info for multiline navigation
const getLineInfo = (text: string, pos: number): { lineStart: number; lineEnd: number; column: number; lineIndex: number } => {
  let lineStart = 0;
  let lineIndex = 0;

  // Find the start of the current line
  for (let i = 0; i < pos; i++) {
    if (text[i] === '\n') {
      lineStart = i + 1;
      lineIndex++;
    }
  }

  // Find the end of the current line
  let lineEnd = text.indexOf('\n', pos);
  if (lineEnd === -1) lineEnd = text.length;

  return { lineStart, lineEnd, column: pos - lineStart, lineIndex };
};

// Helper: Move cursor to previous line (for up arrow)
const moveToPrevLine = (text: string, pos: number): number => {
  const { lineStart, column } = getLineInfo(text, pos);
  if (lineStart === 0) return pos; // Already on first line

  // Find the previous line
  const prevLineEnd = lineStart - 1; // Position of \n
  const prevLineStart = text.lastIndexOf('\n', prevLineEnd - 1) + 1;
  const prevLineLength = prevLineEnd - prevLineStart;

  // Move to same column or end of line if shorter
  return prevLineStart + Math.min(column, prevLineLength);
};

// Helper: Move cursor to next line (for down arrow)
const moveToNextLine = (text: string, pos: number): number => {
  const { lineEnd, column } = getLineInfo(text, pos);
  if (lineEnd === text.length) return pos; // Already on last line

  // Find the next line
  const nextLineStart = lineEnd + 1;
  let nextLineEnd = text.indexOf('\n', nextLineStart);
  if (nextLineEnd === -1) nextLineEnd = text.length;
  const nextLineLength = nextLineEnd - nextLineStart;

  // Move to same column or end of line if shorter
  return nextLineStart + Math.min(column, nextLineLength);
};

// Helper: Get masked display value
const getMaskedDisplay = (
  value: string,
  mask?: string | boolean,
  maskReveal?: { first?: number; last?: number }
): string => {
  if (!mask) return value;

  const maskChar = typeof mask === 'string' ? mask : '*';

  if (!maskReveal) {
    return maskChar.repeat(value.length);
  }

  const { first = 0, last = 0 } = maskReveal;
  if (value.length <= first + last) {
    return value; // Too short to mask anything
  }

  const start = value.slice(0, first);
  const middle = maskChar.repeat(value.length - first - last);
  const end = value.slice(-last);
  return start + middle + end;
};

/**
 * Shared text input component with cursor navigation, selection, and masking support.
 *
 * Features:
 * - Full arrow key navigation (left/right)
 * - Cmd+arrows for line start/end
 * - Option+arrows for word boundaries
 * - Shift+arrows for text selection
 * - Shift+Enter for newlines (multiline mode)
 * - Password masking with optional reveal
 * - Block or bar cursor styles
 */
export const TextInput: React.FC<TextInputProps> = ({
  value,
  onChange,
  onSubmit,
  onBackspaceEmpty,
  onPastedText,
  onCancel,
  placeholder = '',
  disabled = false,
  mask,
  maskReveal,
  enableNavigation = true,
  enableSelection = true,
  enableWordNavigation = true,
  detectFilePaths = false,
  cursorStyle = 'block',
  cursorColor = 'blue',
  isActive = true,
  multiline = false,
}) => {
  // Cursor ref is the SINGLE SOURCE OF TRUTH - never synced from state
  const cursorRef = useRef(value.length);
  // Selection tracks anchor (fixed point) and active (cursor) positions
  const selectionRef = useRef<{ anchor: number; active: number } | null>(null);

  // Force re-render when cursor/selection changes (without syncing back)
  const [, forceUpdate] = useState(0);
  const triggerRender = () => forceUpdate(n => n + 1);

  // Reset cursor when value changes externally (e.g., history navigation, parent reset)
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

      // Handle Cancel (Escape or Ctrl+C)
      if (isCancel(input, key)) {
        if (onCancel) {
          onCancel();
        }
        return;
      }

      // Handle Ctrl+U to clear line
      if (isClearLine(input, key)) {
        cursorRef.current = 0;
        selectionRef.current = null;
        prevValueRef.current = '';
        onChange('');
        return;
      }

      // Word navigation via Option+arrow (escape sequences)
      if (enableNavigation && enableWordNavigation) {
        if (isWordLeft(input, key)) {
          selectionRef.current = null;
          cursorRef.current = findPrevWordBoundary(value, cursor);
          triggerRender();
          return;
        }

        if (isWordRight(input, key)) {
          selectionRef.current = null;
          cursorRef.current = findNextWordBoundary(value, cursor);
          triggerRender();
          return;
        }
      }

      // Handle Shift+Enter for newline (multiline mode)
      if (isShiftEnter(input, key)) {
        if (multiline) {
          const before = value.substring(0, cursor);
          const after = value.substring(cursor);
          const newValue = before + '\n' + after;
          cursorRef.current = cursor + 1;
          selectionRef.current = null;
          prevValueRef.current = newValue;
          onChange(newValue);
        }
        return;
      }

      // Handle Return/Enter
      if (key.return) {
        // Check for file path pattern (only if detectFilePaths is enabled)
        if (detectFilePaths && onPastedText) {
          const trimmed = value.trim();
          const looksLikeFilePath = trimmed.startsWith('~/') ||
            (trimmed.startsWith('/') && trimmed.length > 2 && trimmed.slice(1).includes('/'));

          if (trimmed && looksLikeFilePath) {
            onPastedText(trimmed);
            onChange('');
            cursorRef.current = 0;
            selectionRef.current = null;
            prevValueRef.current = '';
            return;
          }
        }
        onSubmit(value);
        return;
      }

      // Handle backspace/delete
      if (key.backspace || key.delete) {
        if (sel) {
          const selStart = Math.min(sel.anchor, sel.active);
          const selEnd = Math.max(sel.anchor, sel.active);
          const newValue = value.slice(0, selStart) + value.slice(selEnd);
          cursorRef.current = selStart;
          selectionRef.current = null;
          prevValueRef.current = newValue;
          onChange(newValue);
        } else if (cursor > 0) {
          const newValue = value.slice(0, cursor - 1) + value.slice(cursor);
          cursorRef.current = cursor - 1;
          prevValueRef.current = newValue;
          onChange(newValue);
        } else if (value.length > 0) {
          // Fallback: cursor is 0 but value has content - delete from end
          const newValue = value.slice(0, -1);
          cursorRef.current = newValue.length;
          prevValueRef.current = newValue;
          onChange(newValue);
        } else if (onBackspaceEmpty) {
          onBackspaceEmpty();
        }
        return;
      }

      // Line navigation via Cmd+arrow (Ctrl+A/E) or Cmd+Shift+arrow (CSI sequences)
      if (enableNavigation) {
        if (isLineStart(input, key)) {
          // Use isShiftVariant for Cmd+Shift+Left (Ghostty sends [1;10D, not key.shift)
          if (enableSelection && isShiftVariant(input, key)) {
            const anchor = sel ? sel.anchor : cursor;
            cursorRef.current = 0;
            if (0 !== anchor) {
              selectionRef.current = { anchor, active: 0 };
            } else {
              selectionRef.current = null;
            }
          } else {
            selectionRef.current = null;
            cursorRef.current = 0;
          }
          triggerRender();
          return;
        }

        if (isLineEnd(input, key)) {
          // Use isShiftVariant for Cmd+Shift+Right (Ghostty sends [1;10C, not key.shift)
          if (enableSelection && isShiftVariant(input, key)) {
            const anchor = sel ? sel.anchor : cursor;
            cursorRef.current = value.length;
            if (value.length !== anchor) {
              selectionRef.current = { anchor, active: value.length };
            } else {
              selectionRef.current = null;
            }
          } else {
            selectionRef.current = null;
            cursorRef.current = value.length;
          }
          triggerRender();
          return;
        }
      }

      // Arrow key navigation
      if (enableNavigation) {
        if (key.leftArrow) {
          if (enableSelection && key.shift) {
            // When extending selection, anchor stays fixed, active moves
            const anchor = sel ? sel.anchor : cursor;
            const newPos = Math.max(0, cursor - 1);
            cursorRef.current = newPos;
            if (newPos !== anchor) {
              selectionRef.current = { anchor, active: newPos };
            } else {
              selectionRef.current = null;
            }
          } else {
            if (sel) {
              // Collapse selection to start
              cursorRef.current = Math.min(sel.anchor, sel.active);
              selectionRef.current = null;
            } else {
              cursorRef.current = Math.max(0, cursor - 1);
            }
          }
          triggerRender();
          return;
        }

        if (key.rightArrow) {
          if (enableSelection && key.shift) {
            // When extending selection, anchor stays fixed, active moves
            const anchor = sel ? sel.anchor : cursor;
            const newPos = Math.min(value.length, cursor + 1);
            cursorRef.current = newPos;
            if (newPos !== anchor) {
              selectionRef.current = { anchor, active: newPos };
            } else {
              selectionRef.current = null;
            }
          } else {
            if (sel) {
              // Collapse selection to end
              cursorRef.current = Math.max(sel.anchor, sel.active);
              selectionRef.current = null;
            } else {
              cursorRef.current = Math.min(value.length, cursor + 1);
            }
          }
          triggerRender();
          return;
        }
      }

      // Up/Down arrow navigation (multiline mode)
      if (multiline && key.upArrow) {
        const newPos = moveToPrevLine(value, cursor);
        if (newPos !== cursor) {
          selectionRef.current = null;
          cursorRef.current = newPos;
          triggerRender();
        }
        return;
      }

      if (multiline && key.downArrow) {
        const newPos = moveToNextLine(value, cursor);
        if (newPos !== cursor) {
          selectionRef.current = null;
          cursorRef.current = newPos;
          triggerRender();
        }
        return;
      }

      // Ignore up/down arrows in non-multiline mode
      if (key.upArrow || key.downArrow) {
        return;
      }

      // Handle printable input
      // Note: process this BEFORE checking for meta key due to bracketed pastes
      if (input && input.length >= 1) {
        // Strip bracketed paste markers - both raw and after Ink strips \x1b
        // Raw form: \x1b[200~ and \x1b[201~
        let chars = input
          .replace(/\x1b\[200~/g, '')   // Raw start marker
          .replace(/\x1b\[201~/g, '')   // Raw end marker
          .replace(/\[200~/g, '')       // After Ink strips \x1b (start)
          .replace(/\[201~/g, '');      // After Ink strips \x1b (end)

        // Check if this was a paste (markers present)
        const wasPaste = chars !== input;

        // If this wasn't a paste and meta/ctrl are set, let other handlers deal with it
        // (still allow single characters like Option+b for word navigation which are handled above)
        if (!wasPaste && (key.ctrl || key.meta)) {
          return;
        }

        // If the entire input was just paste markers, nothing to process
        if (chars.length === 0) {
          return;
        }

        // Filter to printable characters (charCode >= 32 or newlines for multiline)
        const printable = chars.split('').filter(c => {
          const code = c.charCodeAt(0);
          return code >= 32 || (multiline && c === '\n');
        }).join('');

        if (printable) {
          // Check for pasted file path (only if detectFilePaths is enabled)
          if (detectFilePaths && onPastedText && printable.length > 1) {
            const looksLikePastedPath = printable.startsWith('~/') ||
              (printable.startsWith('/') && printable.length > 2 && printable.slice(1).includes('/'));

            if (looksLikePastedPath) {
              onPastedText(printable);
              return;
            }
          }
          // Normal text input
          let newValue: string;
          let newCursor: number;
          if (sel) {
            const selStart = Math.min(sel.anchor, sel.active);
            const selEnd = Math.max(sel.anchor, sel.active);
            newValue = value.slice(0, selStart) + printable + value.slice(selEnd);
            newCursor = selStart + printable.length;
            selectionRef.current = null;
          } else {
            newValue = value.slice(0, cursor) + printable + value.slice(cursor);
            newCursor = cursor + printable.length;
          }
          cursorRef.current = newCursor;
          prevValueRef.current = newValue;
          onChange(newValue);
        }
      }
    },
    { isActive: isActive && !disabled }
  );

  // Get display value (possibly masked)
  const displayValue = getMaskedDisplay(value, mask, maskReveal);
  const cursor = cursorRef.current;
  const selection = selectionRef.current;

  // Bar cursor style (simpler rendering)
  if (cursorStyle === 'bar') {
    if (displayValue.length === 0) {
      if (disabled) {
        return <Text dimColor>{placeholder}</Text>;
      }
      return (
        <Text>
          <Text color={cursorColor}>|</Text>
          <Text dimColor>{placeholder}</Text>
        </Text>
      );
    }

    // For bar cursor, show cursor at position
    const before = displayValue.slice(0, cursor);
    const after = displayValue.slice(cursor);

    return (
      <Text>
        {before}
        {!disabled && <Text color={cursorColor}>|</Text>}
        {after}
      </Text>
    );
  }

  // Block cursor style (character-by-character rendering)
  if (displayValue.length === 0) {
    if (disabled) {
      return <Text dimColor>{placeholder}</Text>;
    }
    return (
      <Text>
        <Text backgroundColor={cursorColor} color="white"> </Text>
        <Text dimColor>{placeholder}</Text>
      </Text>
    );
  }

  const parts: React.ReactNode[] = [];
  const selStart = selection ? Math.min(selection.anchor, selection.active) : -1;
  const selEnd = selection ? Math.max(selection.anchor, selection.active) : -1;

  for (let i = 0; i <= displayValue.length; i++) {
    const char = i < displayValue.length ? displayValue[i]! : ' ';
    const isAtCursor = i === cursor && !disabled;
    const isSelected = selection && i >= selStart && i < selEnd;
    // For newlines, show a visible space when cursor/selected, otherwise render the newline
    const isNewline = char === '\n';
    const displayChar = isNewline ? ' ' : char;

    if (i === displayValue.length) {
      if (isAtCursor) {
        parts.push(<Text key={i} backgroundColor={cursorColor} color="white"> </Text>);
      }
    } else if (isAtCursor) {
      // Show space for newline so cursor is visible, then add the actual newline
      parts.push(<Text key={i} backgroundColor={cursorColor} color="white">{displayChar}</Text>);
      if (isNewline) parts.push(<Text key={`${i}-nl`}>{'\n'}</Text>);
    } else if (isSelected) {
      parts.push(<Text key={i} backgroundColor="cyan" color="black">{displayChar}</Text>);
      if (isNewline) parts.push(<Text key={`${i}-nl`}>{'\n'}</Text>);
    } else {
      parts.push(<Text key={i}>{char}</Text>);
    }
  }

  return <Text>{parts}</Text>;
};
