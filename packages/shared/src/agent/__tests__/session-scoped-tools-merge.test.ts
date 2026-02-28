import { describe, it, expect, beforeEach } from 'bun:test';
import {
  registerSessionScopedToolCallbacks,
  mergeSessionScopedToolCallbacks,
  getSessionScopedToolCallbacks,
  unregisterSessionScopedToolCallbacks,
} from '../session-scoped-tools.ts';

describe('session-scoped tool callback merge', () => {
  const sessionId = 'test-session-merge';

  beforeEach(() => {
    unregisterSessionScopedToolCallbacks(sessionId);
  });

  it('preserves existing browserPaneFns when merging turn-level callbacks', () => {
    const browserPaneFns = {
      openPanel: async () => ({ instanceId: 'browser-1' }),
      navigate: async () => ({ url: 'https://example.com', title: 'Example' }),
      snapshot: async () => ({ url: 'https://example.com', title: 'Example', nodes: [] }),
      click: async () => {},
      fill: async () => {},
      select: async () => {},
      screenshot: async () => ({ png: Buffer.from('png') }),
      screenshotRegion: async () => ({ png: Buffer.from('png') }),
      getConsoleLogs: async () => [],
      windowResize: async () => ({ width: 1280, height: 720 }),
      getNetworkLogs: async () => [],
      waitFor: async () => ({ ok: true as const, kind: 'network-idle', elapsedMs: 0, detail: 'ok' }),
      sendKey: async () => {},
      getDownloads: async () => [],
      scroll: async () => {},
      goBack: async () => {},
      goForward: async () => {},
      evaluate: async () => 'ok',
      releaseControl: async () => {},
      closeWindow: async () => {},
      hideWindow: async () => {},
      listWindows: async () => [],
    };

    registerSessionScopedToolCallbacks(sessionId, {
      browserPaneFns,
    });

    const queryFn = async () => ({ text: 'ok', model: 'test' });
    mergeSessionScopedToolCallbacks(sessionId, { queryFn });

    const merged = getSessionScopedToolCallbacks(sessionId);
    expect(merged).toBeTruthy();
    expect(merged?.browserPaneFns).toBe(browserPaneFns);
    expect(merged?.queryFn).toBe(queryFn);
  });
});
