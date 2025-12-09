/**
 * Centralized Keyboard Mapping
 *
 * This module provides helper functions for detecting keyboard shortcuts.
 * Use these with Ink's useInput hook directly.
 *
 * @example
 * ```typescript
 * import { useInput } from 'ink';
 * import { isShiftEnter, isLineStart, isLineEnd } from '../keyboard';
 *
 * useInput((input, key) => {
 *   if (isShiftEnter(input, key)) {
 *     // Handle Shift+Enter
 *   }
 *   if (isLineStart(input, key)) {
 *     // Handle Cmd+Left
 *   }
 * });
 * ```
 */

export {
  isShiftEnter,
  isLineStart,
  isLineEnd,
  isShiftVariant,
  isWordLeft,
  isWordRight,
  isClearLine,
  isCancel,
  isHistorySearch,
  isAbort,
} from './mappings.ts';
