/**
 * Centralized Keyboard Mapping
 *
 * This module provides helper functions for detecting keyboard shortcuts.
 * Use these with Ink's useInput hook directly.
 *
 * @example
 * ```typescript
 * import { useInput } from 'ink';
 * import { isShiftOrAltEnter, isLineStart, isLineEnd } from '../keyboard';
 *
 * useInput((input, key) => {
 *   if (isShiftOrAltEnter(input, key)) {
 *     // Handle Shift+Enter or Alt+Enter (insert newline)
 *   }
 *   if (isLineStart(input, key)) {
 *     // Handle Cmd+Left
 *   }
 * });
 * ```
 */

export {
  isShiftOrAltEnter,
  isLineStart,
  isLineEnd,
  isShiftVariant,
  isWordLeft,
  isWordRight,
  isClearLine,
  isCancel,
  isHistorySearch,
  isAbort,
  isDeleteWordBackward,
  isDeleteWordForward,
  isKillToEnd,
} from './mappings.ts';
