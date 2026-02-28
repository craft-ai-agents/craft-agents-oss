/**
 * Tests for browser tool permission handling across permission modes.
 *
 * Browser tools should be allowed in safe/Explore mode because they are
 * interactive browsing operations and do not mutate local files/system state.
 */
import { describe, it, expect } from 'bun:test';
import { shouldAllowToolInMode } from '../../agent/mode-manager.ts';

const nativeBrowserTools = [
  'browser_open',
  'browser_navigate',
  'browser_snapshot',
  'browser_click',
  'browser_fill',
  'browser_select',
  'browser_screenshot',
  'browser_screenshot_region',
  'browser_console',
  'browser_window_resize',
  'browser_network',
  'browser_wait',
  'browser_key',
  'browser_downloads',
  'browser_scroll',
  'browser_back',
  'browser_forward',
  'browser_evaluate',
  'browser_tool',
] as const;

const sessionBrowserTools = nativeBrowserTools.map((name) => `mcp__session__${name}`);

describe('browser tools permission mode handling', () => {
  it('allows native browser tools in safe mode', () => {
    for (const toolName of nativeBrowserTools) {
      const result = shouldAllowToolInMode(toolName, {}, 'safe');
      expect(result.allowed).toBe(true);
    }
  });

  it('allows session browser tools in safe mode', () => {
    for (const toolName of sessionBrowserTools) {
      const result = shouldAllowToolInMode(toolName, {}, 'safe');
      expect(result.allowed).toBe(true);
    }
  });

  it('allows browser tools in ask mode without requiring permission', () => {
    for (const toolName of [...nativeBrowserTools, ...sessionBrowserTools]) {
      const result = shouldAllowToolInMode(toolName, {}, 'ask');
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.requiresPermission).toBeFalsy();
      }
    }
  });

  it('allows browser tools in allow-all mode', () => {
    for (const toolName of [...nativeBrowserTools, ...sessionBrowserTools]) {
      const result = shouldAllowToolInMode(toolName, {}, 'allow-all');
      expect(result.allowed).toBe(true);
    }
  });
});
