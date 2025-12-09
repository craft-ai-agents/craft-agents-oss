/**
 * Keyboard Mappings
 *
 * Centralized detection logic for keyboard shortcuts.
 * These functions work with Ink's useInput callback parameters.
 *
 * IMPORTANT: Ink transforms escape sequences before we see them:
 * - Strips \x1b prefix from some sequences
 * - Sets key.return, key.escape, etc. for recognized keys
 *
 * Terminal Escape Sequence Reference:
 * | Key Combo      | Ghostty Sends      | Ink Delivers              |
 * |----------------|--------------------|--------------------------:|
 * | Shift+Enter    | \x1b[27;2;13~      | input='[27;2;13~'         |
 * | Cmd+Left       | \x01 (Ctrl+A)      | input='\x01'              |
 * | Cmd+Right      | \x05 (Ctrl+E)      | input='\x05'              |
 * | Option+Left    | \x1bb              | input='b' + key.meta=true |
 * | Option+Right   | \x1bf              | input='f' + key.meta=true |
 * | Ctrl+U         | \x15               | input='\x15'              |
 */

// Ink's Key type (subset of what we need)
interface InkKey {
  return?: boolean;
  escape?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  tab?: boolean;
  backspace?: boolean;
  delete?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
}

/**
 * Shift+Enter detection
 * Ghostty sends \x1b[27;2;13~ (fixterms). Different Ink versions handle this differently:
 * - Ink 5: input='\r' (char code 13) with all key flags false
 * - Ink 4: input='\r' with key.meta=true
 *
 * We detect Shift+Enter as: char code 13 WITHOUT key.return being set
 * (Regular Enter sets key.return=true, Shift+Enter doesn't in Ink 5)
 */
export function isShiftEnter(input: string, key: InkKey): boolean {
  return (
    (input === '\r' && key.return !== true) ||  // Ink 5: char 13 without return flag
    (input === '\r' && key.meta === true) ||    // Ink 4: Ghostty/modern terminals
    input === '[27;2;13~'                       // Raw fixterms if Ink doesn't parse
  );
}

/**
 * Cmd+Left / Home - Jump to line start
 * Ghostty: Cmd+Left → Ctrl+A (input='a'), Cmd+Shift+Left → [1;10D
 */
export function isLineStart(input: string, key: InkKey): boolean {
  return (key.ctrl === true && input === 'a') ||
         input === '\x01' ||
         (key.meta === true && input === '[1;10D');  // Cmd+Shift+Left (with selection)
}

/**
 * Cmd+Right / End - Jump to line end
 * Ghostty: Cmd+Right → Ctrl+E (input='e'), Cmd+Shift+Right → [1;10C
 */
export function isLineEnd(input: string, key: InkKey): boolean {
  return (key.ctrl === true && input === 'e') ||
         input === '\x05' ||
         (key.meta === true && input === '[1;10C');  // Cmd+Shift+Right (with selection)
}

/**
 * Check if this is a Cmd+Shift variant (for selection)
 * Used by TextInput to determine if shift selection should be applied
 */
export function isShiftVariant(input: string, _key: InkKey): boolean {
  return input === '[1;10D' || input === '[1;10C';
}

/**
 * Option+Left - Jump to previous word boundary
 * Terminal sends ESC+b (\x1bb), Ink delivers: input='b' with key.meta=true
 */
export function isWordLeft(input: string, key: InkKey): boolean {
  return (key.meta === true && input === 'b') || input === '\x1bb';
}

/**
 * Option+Right - Jump to next word boundary
 * Terminal sends ESC+f (\x1bf), Ink delivers: input='f' with key.meta=true
 */
export function isWordRight(input: string, key: InkKey): boolean {
  return (key.meta === true && input === 'f') || input === '\x1bf';
}

/**
 * Ctrl+U - Clear line (readline standard)
 */
export function isClearLine(input: string, key: InkKey): boolean {
  return input === '\x15' || (key.ctrl === true && input === 'u');
}

/**
 * Cancel - Escape or Ctrl+C
 */
export function isCancel(input: string, key: InkKey): boolean {
  return key.escape === true || (key.ctrl === true && input === 'c');
}
