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
 * | Alt+Enter      | \x1b\r             | input='\r' + key.meta=true|
 * | Cmd+Left       | \x01 (Ctrl+A)      | input='\x01'              |
 * | Cmd+Right      | \x05 (Ctrl+E)      | input='\x05'              |
 * | Option+Left    | \x1bb              | input='b' + key.meta=true |
 * | Option+Right   | \x1bf              | input='f' + key.meta=true |
 * | Ctrl+U         | \x15               | input='\x15'              |
 * | Ctrl+W         | \x17               | input='\x17'              |
 * | Ctrl+K         | \x0b               | input='\x0b'              |
 * | Option+Delete  | (varies)           | key.meta + key.delete     | (Mac - delete word backward)
 * | Alt+D          | \x1bd              | input='d' + key.meta      | (delete word forward)
 * | Ctrl+Backspace | (varies)           | key.ctrl + key.backspace  | (Linux)
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
 * Shift+Enter or Alt+Enter detection (for inserting newlines)
 *
 * Shift+Enter: Ghostty sends \x1b[27;2;13~ (fixterms). Different Ink versions handle this differently:
 * - Ink 5: input='\r' (char code 13) with all key flags false
 * - Ink 4: input='\r' with key.meta=true
 *
 * Alt+Enter: Terminal.app and others send \x1b\r (ESC + carriage return)
 * - Ink delivers: input='\r' with key.meta=true
 *
 * Note: Alt+Enter provides a fallback for terminals like macOS Terminal.app
 * where Shift+Enter sends the same sequence as regular Enter.
 */
export function isShiftOrAltEnter(input: string, key: InkKey): boolean {
  return (
    (input === '\r' && key.return !== true) ||  // Ink 5: char 13 without return flag
    (input === '\r' && key.meta === true) ||    // Ink 4: Ghostty/modern terminals + Alt+Enter
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
 * Raw Ctrl+C sends '\x03' (ETX, ASCII 3) in raw mode
 */
export function isCancel(input: string, key: InkKey): boolean {
  return key.escape === true || input === '\x03' || (key.ctrl === true && input === 'c');
}

/**
 * Ctrl+R - Reverse history search
 * Standard terminal shortcut for searching command history
 */
export function isHistorySearch(input: string, key: InkKey): boolean {
  return (key.ctrl === true && input === 'r') || input === '\x12';
}

/**
 * Ctrl+G - Abort (alternative cancel, commonly used in search)
 */
export function isAbort(input: string, key: InkKey): boolean {
  return (key.ctrl === true && input === 'g') || input === '\x07';
}

/**
 * Delete word backward - Option+Delete (Mac), Ctrl+W, Ctrl+Backspace (Linux)
 *
 * Mac Note: The "Delete" key on Mac acts as backspace, but Ink reports it
 * as key.delete=true (not key.backspace) when used with Option.
 *
 * Option+Delete (Mac): Ink delivers key.meta=true + key.delete=true + input=""
 *
 * Ctrl+W: Standard readline delete-word-backward (works on all platforms)
 * - Raw: \x17 (ASCII 23, W is 23rd letter)
 *
 * Ctrl+Backspace (Linux): Varies by terminal
 * - Often: \x08 with ctrl, or \x7f with ctrl
 */
export function isDeleteWordBackward(input: string, key: InkKey): boolean {
  // Ctrl+W (most common, works everywhere)
  if (input === '\x17' || (key.ctrl === true && input === 'w')) {
    return true;
  }
  // Option+Delete on Mac - Ink reports key.delete=true (not backspace) with meta
  if (key.meta === true && key.delete === true) {
    return true;
  }
  // Fallback: Option+Delete might also send \x7f with meta in some terminals
  if (key.meta === true && (key.backspace === true || input === '\x7f')) {
    return true;
  }
  // Ctrl+Backspace variations (Linux)
  if (key.ctrl === true && (key.backspace === true || input === '\x08' || input === '\x7f')) {
    return true;
  }
  return false;
}

/**
 * Delete word forward - Alt+D (Mac/Linux), Ctrl+Delete (Linux)
 *
 * Alt+D / Option+D: Standard readline kill-word (ESC+d)
 * - Ink delivers: input='d' with key.meta=true
 * - Works on both Mac and Linux
 *
 * Note: On Mac, Option+Fn+Delete would be forward-delete + Option,
 * but Alt+D is the standard readline way and works everywhere.
 *
 * Ctrl+Delete (Linux): \x1b[3;5~ or similar
 */
export function isDeleteWordForward(input: string, key: InkKey): boolean {
  // Alt+D / Option+D (ESC + d) - standard readline
  if (key.meta === true && input === 'd') {
    return true;
  }
  // Raw ESC+d
  if (input === '\x1bd') {
    return true;
  }
  // Ctrl+Delete (CSI sequence) - Linux
  if (input === '[3;5~') {
    return true;
  }
  // Ctrl+Delete with key flag - Linux
  if (key.ctrl === true && key.delete === true) {
    return true;
  }
  return false;
}

/**
 * Kill to end of line - Ctrl+K
 * Standard readline kill-line (deletes from cursor to end of line)
 *
 * Ctrl+K: \x0b (ASCII 11, K is 11th letter)
 */
export function isKillToEnd(input: string, key: InkKey): boolean {
  return input === '\x0b' || (key.ctrl === true && input === 'k');
}

/**
 * Shift+Tab - Toggle safe mode
 * Terminal sends \x1b[Z (CSI Z) for Shift+Tab
 * Ink delivers: input='[Z' with key.tab=true and key.shift=true (or just input='[Z')
 */
export function isShiftTab(input: string, key: InkKey): boolean {
  return input === '[Z' || (key.tab === true && key.shift === true);
}

/**
 * Ctrl+L - Clear screen
 * Standard terminal shortcut for clearing the screen
 * Ctrl+L: \x0c (ASCII 12, L is 12th letter)
 */
export function isClearScreen(input: string, key: InkKey): boolean {
  return input === '\x0c' || (key.ctrl === true && input === 'l');
}

/**
 * Ctrl+D - Exit (EOF)
 * Standard terminal shortcut for end-of-file/exit
 * Ctrl+D: \x04 (ASCII 4, D is 4th letter)
 */
export function isExit(input: string, key: InkKey): boolean {
  return input === '\x04' || (key.ctrl === true && input === 'd');
}

/**
 * Ctrl+S - Toggle Safe Mode
 * Ctrl+S: \x13 (ASCII 19, S is 19th letter)
 */
export function isSafeModeToggle(input: string, key: InkKey): boolean {
  return input === '\x13' || (key.ctrl === true && input === 's');
}
