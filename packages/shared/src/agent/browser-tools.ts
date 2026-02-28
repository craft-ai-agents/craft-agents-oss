/**
 * Browser Tools (browser_navigate, browser_snapshot, browser_click, etc.)
 *
 * Session-scoped tools that enable the agent to interact with the built-in
 * in-app browser windows. Each tool delegates to BrowserPaneFns callbacks which are
 * wired by the Electron session manager to BrowserPaneManager.
 *
 * The session → browser instance mapping is handled by the callback provider
 * (getOrCreateForSession pattern), so tools don't need instance IDs.
 */

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

// Tool result type - matches MCP CallToolResult content blocks
type ToolResult = {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  >;
  isError?: boolean;
};

function errorResponse(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

function successResponse(text: string): ToolResult {
  return {
    content: [{ type: 'text', text }],
  };
}

const BROWSER_RELEASE_HINT = '\n\nWhen you are done using the browser, call browser_tool with command "close" to close the window entirely, or "release" to dismiss the overlay and let the user continue browsing.';

/** Success response with release hint appended for browser tools. */
function browserSuccessResponse(text: string): ToolResult {
  return {
    content: [{ type: 'text', text: text + BROWSER_RELEASE_HINT }],
  };
}

// ============================================================================
// Browser Pane Function Interface
// ============================================================================

/**
 * Abstraction over BrowserPaneManager for use in session-scoped tools.
 * The Electron session manager creates this by binding to a specific session's
 * browser instance via getOrCreateForSession(sessionId).
 */
export interface BrowserScreenshotArgs {
  mode?: 'raw' | 'agent'
  refs?: string[]
  includeLastAction?: boolean
  includeMetadata?: boolean
}

export interface BrowserScreenshotResult {
  png: Buffer
  metadata?: Record<string, unknown>
}

export interface BrowserConsoleArgs {
  level?: 'all' | 'log' | 'info' | 'warn' | 'error'
  limit?: number
}

export interface BrowserScreenshotRegionArgs {
  x?: number
  y?: number
  width?: number
  height?: number
  ref?: string
  selector?: string
  padding?: number
}

export interface BrowserWindowResizeArgs {
  width: number
  height: number
}

export interface BrowserNetworkArgs {
  limit?: number
  status?: 'all' | 'failed' | '2xx' | '3xx' | '4xx' | '5xx'
  method?: string
  resourceType?: string
}

export interface BrowserWaitArgs {
  kind: 'selector' | 'text' | 'url' | 'network-idle'
  value?: string
  timeoutMs?: number
  pollMs?: number
  idleMs?: number
}

export interface BrowserKeyArgs {
  key: string
  modifiers?: Array<'shift' | 'control' | 'alt' | 'meta'>
}

export interface BrowserDownloadsArgs {
  action?: 'list' | 'wait'
  limit?: number
  timeoutMs?: number
}

function validateScreenshotRegionArgs(args: BrowserScreenshotRegionArgs): string | null {
  const hasAnyCoord = args.x != null || args.y != null || args.width != null || args.height != null;
  const hasAllCoords = args.x != null && args.y != null && args.width != null && args.height != null;
  const hasRef = typeof args.ref === 'string' && args.ref.trim().length > 0;
  const hasSelector = typeof args.selector === 'string' && args.selector.trim().length > 0;

  if (hasAnyCoord && !hasAllCoords) {
    return 'Coordinate mode requires x, y, width, and height together.';
  }

  const modeCount = Number(hasAllCoords) + Number(hasRef) + Number(hasSelector);
  if (modeCount === 0) {
    return 'Provide exactly one target mode: coordinates (x,y,width,height), ref, or selector.';
  }
  if (modeCount > 1) {
    return 'Target mode is ambiguous. Provide only one of coordinates, ref, or selector.';
  }

  if (hasAllCoords && ((args.width as number) <= 0 || (args.height as number) <= 0)) {
    return 'Coordinate mode width and height must be greater than 0.';
  }

  return null;
}

export interface BrowserPaneFns {
  openPanel: (options?: { background?: boolean }) => Promise<{ instanceId: string }>;
  navigate: (url: string) => Promise<{ url: string; title: string }>;
  snapshot: () => Promise<{ url: string; title: string; nodes: Array<{ ref: string; role: string; name: string; value?: string; description?: string; focused?: boolean; checked?: boolean; disabled?: boolean }> }>;
  click: (ref: string, options?: { waitFor?: 'none' | 'navigation' | 'network-idle'; timeoutMs?: number }) => Promise<void>;
  fill: (ref: string, value: string) => Promise<void>;
  select: (ref: string, value: string) => Promise<void>;
  screenshot: (args?: BrowserScreenshotArgs) => Promise<BrowserScreenshotResult>;
  screenshotRegion: (args: BrowserScreenshotRegionArgs) => Promise<BrowserScreenshotResult>;
  getConsoleLogs: (args?: BrowserConsoleArgs) => Promise<Array<{ timestamp: number; level: 'log' | 'info' | 'warn' | 'error'; message: string }>>;
  windowResize: (args: BrowserWindowResizeArgs) => Promise<{ width: number; height: number }>;
  getNetworkLogs: (args?: BrowserNetworkArgs) => Promise<Array<{ timestamp: number; method: string; url: string; status: number; resourceType: string; ok: boolean }>>;
  waitFor: (args: BrowserWaitArgs) => Promise<{ ok: true; kind: string; elapsedMs: number; detail: string }>;
  sendKey: (args: BrowserKeyArgs) => Promise<void>;
  getDownloads: (args?: BrowserDownloadsArgs) => Promise<Array<{ id: string; timestamp: number; url: string; filename: string; state: string; bytesReceived: number; totalBytes: number; mimeType: string; savePath?: string }>>;
  scroll: (direction: 'up' | 'down' | 'left' | 'right', amount?: number) => Promise<void>;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  evaluate: (expression: string) => Promise<unknown>;
  releaseControl: () => Promise<void>;
  closeWindow: () => Promise<void>;
  hideWindow: () => Promise<void>;
  listWindows: () => Promise<Array<{
    id: string;
    title: string;
    url: string;
    isVisible: boolean;
    ownerType: 'session' | 'manual';
    ownerSessionId: string | null;
    boundSessionId: string | null;
    agentControlActive?: boolean;
  }>>;
}

// ============================================================================
// Tool Factory Options
// ============================================================================

export interface BrowserToolsOptions {
  sessionId: string;
  /**
   * Lazy resolver for browser pane functions.
   * Called at execution time to get the current callback from the session registry.
   */
  getBrowserPaneFns: () => BrowserPaneFns | undefined;
}

// ============================================================================
// Tool Descriptions
// ============================================================================

const BROWSER_DESCRIPTIONS = {
  browser_open: `Open (or ensure) an in-app browser window.

Creates or reuses the session's browser instance in the background.
Returns the browser instance ID.`,

  browser_navigate: `Navigate the built-in browser to a URL.

The built-in browser windows run real Chromium content inside the app. Use this to load web pages for inspection, testing, or data extraction.

If the browser UI may be hidden, call \`browser_open\` first.

Returns the final URL and page title after navigation completes.`,

  browser_snapshot: `Get an accessibility tree snapshot of the current browser page.

Returns a structured list of interactive elements (buttons, links, inputs, etc.) and content nodes (headings, paragraphs, images) with ref IDs like @e1, @e2.

Use these refs with browser_click and browser_fill to interact with elements. The snapshot is the primary way to understand page structure — prefer it over screenshots for element interaction.`,

  browser_click: `Click an element in the browser by its ref ID (e.g., @e1).

Get refs from browser_snapshot first. This performs a real mouse click at the element's center coordinates.

Optional wait behavior:
- waitFor: "none" (default), "navigation", or "network-idle"
- timeoutMs: maximum wait time for waitFor modes`,

  browser_fill: `Fill a text input or textarea in the browser by its ref ID.

Clears the existing value first, then types the new value character by character. Get refs from browser_snapshot first.`,

  browser_select: `Select an option in a <select> dropdown by its ref ID.

Pass the option's value attribute. Get refs from browser_snapshot first.`,

  browser_screenshot: `Take a screenshot of the current browser page.

Supports optional agent-focused annotations:
- mode: "raw" (default) or "agent"
- refs: specific refs to annotate from browser_snapshot
- includeLastAction: include last interaction target when available
- includeMetadata: render compact metadata overlay and return metadata payload

Use browser_snapshot instead when you need to interact with elements — screenshots are primarily for visual verification.`,

  browser_screenshot_region: `Take a screenshot of a specific region or element in the current browser page.

Supports three target modes:
- Coordinates: x, y, width, height
- Ref: ref from browser_snapshot (e.g., @e12)
- Selector: CSS selector (e.g., div[data-testid="chart"]) — resolves to the first visible match (falls back to first match)

Optional padding expands the capture box around the target.
Returns PNG image content and metadata with the resolved target box.`,

  browser_console: `Get recent console messages from the current browser page.

Use this to inspect page errors/warnings and runtime logs without opening DevTools.

Supports filtering by level and limiting number of entries.`,

  browser_window_resize: `Resize the in-app browser window viewport.

Sets the browser content area size to the requested width and height in pixels.
Useful before screenshots to capture deterministic layouts.`,

  browser_scroll: `Scroll the browser page in a given direction.

Useful for revealing content below the fold before taking a snapshot. Default scroll amount is 500 pixels.`,

  browser_back: `Navigate the browser back to the previous page in history.`,

  browser_forward: `Navigate the browser forward to the next page in history.`,

  browser_evaluate: `Execute JavaScript in the browser page and return the result.

Use this for advanced interactions not covered by other browser tools, like reading computed styles, extracting data from the DOM, or triggering custom events.

The expression is evaluated in the page context. Return values are serialized to JSON.`,

  browser_network: `Get recent network request activity from the current browser page.

Supports filtering by status class, method, and resource type. Useful for debugging failed API calls and understanding what a click/navigation triggered.`,

  browser_wait: `Wait for a browser condition to become true.

Supported kinds:
- selector: waits for CSS selector to exist
- text: waits for page text to appear
- url: waits until URL contains a substring
- network-idle: waits until in-flight requests settle for an idle window

Use this after click/navigation for reliability.`,

  browser_key: `Send keyboard input to the browser page.

Use this for shortcuts and key-driven flows (Enter, Escape, Cmd+K, etc.).`,

  browser_downloads: `Inspect download activity for the current browser window.

Actions:
- list (default): return recent download entries
- wait: wait for a terminal download state before returning`,

  browser_tool: `Run browser actions using a CLI-like command string.

This is a convenience wrapper around browser_* tools with strict validation and actionable feedback.

Examples:
- \`--help\`
- \`open\`
- \`navigate https://example.com\`
- \`snapshot\`
- \`click @e12\`
- \`fill @e5 user@example.com\`
- \`select @e3 optionValue\`
- \`scroll down 800\`
- \`evaluate document.title\`
- \`console 50 error\`
- \`screenshot-region 100 200 640 480\`
- \`screenshot-region --ref @e12 --padding 8\`
- \`screenshot-region --selector div[data-testid="chart"]\`
- \`window-resize 1440 900\`
- \`network 50 failed\`
- \`wait network-idle 8000\`
- \`key Enter\`
- \`key k meta\`
- \`downloads wait 15000\`
- \`windows\` — list current browser windows and ownership state
- \`release\` — dismiss the agent control overlay when done

Prefer direct browser_* tools when exact structured arguments are available.`,
} as const;

// ============================================================================
// Tool Factories
// ============================================================================

export function createBrowserTools(options: BrowserToolsOptions) {
  function getBrowserFns(): BrowserPaneFns {
    const fns = options.getBrowserPaneFns();
    if (!fns) {
      throw new Error('Browser window controls are not available. This tool requires the desktop app.');
    }
    return fns;
  }

  function browserToolHelp(): string {
    return [
      'browser_tool command help',
      '',
      'Usage:',
      '  --help',
      '  open [--foreground|-f]                         open browser (background by default)',
      '  navigate <url>',
      '  snapshot',
      '  click <ref> [none|navigation|network-idle] [timeoutMs]',
      '  fill <ref> <value>',
      '  select <ref> <value>',
      '  screenshot',
      '  screenshot-region <x> <y> <width> <height>',
      '  screenshot-region --ref <@eN> [--padding <px>]',
      '  screenshot-region --selector <css-selector> [--padding <px>]',
      '  console [limit] [level]',
      '  window-resize <width> <height>',
      '  network [limit] [status]',
      '  wait <selector|text|url|network-idle> <value?> [timeoutMs]',
      '  key <key> [modifiers]',
      '  downloads [list|wait] [limit|timeoutMs]',
      '  scroll <up|down|left|right> [amount]',
      '  back',
      '  forward',
      '  evaluate <expression>',
      '  windows',
      '  release                                        dismiss agent overlay (user keeps browsing)',
      '  close                                          close & destroy the browser window',
      '  hide                                           hide the window (keeps state, "open" re-shows)',
      '',
      'Examples:',
      '  navigate https://example.com',
      '  click @e12',
      '  fill @e5 user@example.com',
      '  scroll down 800',
      '  evaluate document.title',
      '  screenshot-region --ref @e9 --padding 12',
      '  screenshot-region --selector div[data-testid="chart"]',
      '  console 100 warn',
      '  window-resize 1280 720',
      '  network 50 failed',
      '  wait network-idle 8000',
      '  key Enter',
      '  downloads wait 15000',
      '  windows',
    ].join('\n');
  }

  async function runBrowserCommand(command: string): Promise<{ output: string; appendReleaseHint: boolean }> {
    const fns = getBrowserFns();
    const trimmed = command.trim();
    if (!trimmed) {
      throw new Error('Missing command. Use "--help" to see supported browser_tool commands.');
    }

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
      return { output: browserToolHelp(), appendReleaseHint: false };
    }

    if (cmd === 'open') {
      const foreground = parts.includes('--foreground') || parts.includes('-f');
      const result = await fns.openPanel({ background: !foreground });
      const mode = foreground ? 'foreground' : 'background';
      return { output: `Opened in-app browser window in ${mode} (instance: ${result.instanceId})`, appendReleaseHint: true };
    }

    if (cmd === 'navigate') {
      const url = parts.slice(1).join(' ').trim();
      if (!url) throw new Error('navigate requires a URL. Example: navigate https://example.com');
      const result = await fns.navigate(url);
      return { output: `Navigated to: ${result.url}\nTitle: ${result.title}`, appendReleaseHint: true };
    }

    if (cmd === 'snapshot') {
      const snapshot = await fns.snapshot();
      const lines: string[] = [
        `URL: ${snapshot.url}`,
        `Title: ${snapshot.title}`,
        '',
        `Elements (${snapshot.nodes.length}):`,
      ];
      for (const node of snapshot.nodes) {
        let line = `  ${node.ref} [${node.role}] "${node.name}"`;
        if (node.value !== undefined) line += ` value="${node.value}"`;
        if (node.focused) line += ' (focused)';
        if (node.checked) line += ' (checked)';
        if (node.disabled) line += ' (disabled)';
        if (node.description) line += ` — ${node.description}`;
        lines.push(line);
      }
      return { output: lines.join('\n'), appendReleaseHint: true };
    }

    if (cmd === 'click') {
      const ref = parts[1];
      if (!ref) throw new Error('click requires a ref. Example: click @e1');
      const waitForRaw = parts[2] as 'none' | 'navigation' | 'network-idle' | undefined;
      const timeoutRaw = parts[3];
      const waitFor = waitForRaw && ['none', 'navigation', 'network-idle'].includes(waitForRaw)
        ? waitForRaw
        : undefined;
      if (waitForRaw && !waitFor) {
        throw new Error('click waitFor must be one of: none, navigation, network-idle');
      }
      const timeoutMs = timeoutRaw ? Number(timeoutRaw) : undefined;
      if (timeoutRaw && Number.isNaN(timeoutMs)) {
        throw new Error(`Invalid click timeout "${timeoutRaw}". Expected a number.`);
      }
      await fns.click(ref, { waitFor, timeoutMs });
      return { output: `Clicked element ${ref}${waitFor ? ` (waitFor=${waitFor})` : ''}`, appendReleaseHint: true };
    }

    if (cmd === 'fill') {
      const ref = parts[1];
      const value = parts.slice(2).join(' ');
      if (!ref || value === undefined) throw new Error('fill requires ref and value. Example: fill @e5 hello world');
      await fns.fill(ref, value);
      return { output: `Filled element ${ref} with "${value}"`, appendReleaseHint: true };
    }

    if (cmd === 'select') {
      const ref = parts[1];
      const value = parts.slice(2).join(' ');
      if (!ref || !value) throw new Error('select requires ref and value. Example: select @e3 optionValue');
      await fns.select(ref, value);
      return { output: `Selected "${value}" in element ${ref}`, appendReleaseHint: true };
    }

    if (cmd === 'screenshot') {
      const result = await fns.screenshot();
      return { output: `Screenshot captured (${Math.round(result.png.length / 1024)}KB PNG)`, appendReleaseHint: true };
    }

    if (cmd === 'screenshot-region') {
      const rest = parts.slice(1);
      if (rest.length === 0) {
        throw new Error('screenshot-region requires either coordinates, --ref, or --selector.');
      }

      const parsePadding = (tokens: string[]) => {
        const idx = tokens.findIndex((t) => t === '--padding');
        if (idx === -1) return { padding: undefined as number | undefined, cleaned: tokens };
        const raw = tokens[idx + 1];
        if (!raw) throw new Error('Missing value for --padding');
        const padding = Number(raw);
        if (Number.isNaN(padding)) throw new Error(`Invalid padding "${raw}". Expected a number.`);
        const cleaned = [...tokens.slice(0, idx), ...tokens.slice(idx + 2)];
        return { padding, cleaned };
      };

      const { padding, cleaned } = parsePadding(rest);

      let args: BrowserScreenshotRegionArgs;
      if (cleaned[0] === '--ref') {
        const ref = cleaned[1];
        if (!ref) throw new Error('screenshot-region --ref requires a ref value.');
        args = { ref, padding };
      } else if (cleaned[0] === '--selector') {
        const selector = cleaned.slice(1).join(' ').trim();
        if (!selector) throw new Error('screenshot-region --selector requires a CSS selector value.');
        args = { selector, padding };
      } else {
        if (cleaned.length < 4) {
          throw new Error('screenshot-region coordinates require: x y width height');
        }
        const [xRaw, yRaw, widthRaw, heightRaw] = cleaned;
        const x = Number(xRaw);
        const y = Number(yRaw);
        const width = Number(widthRaw);
        const height = Number(heightRaw);
        if ([x, y, width, height].some((n) => Number.isNaN(n))) {
          throw new Error('screenshot-region coordinates must be numbers.');
        }
        args = { x, y, width, height, padding };
      }

      const result = await fns.screenshotRegion(args);
      return { output: `Region screenshot captured (${Math.round(result.png.length / 1024)}KB PNG)`, appendReleaseHint: true };
    }

    if (cmd === 'console') {
      const limitRaw = parts[1];
      const levelRaw = parts[2];
      const limit = limitRaw ? Number(limitRaw) : undefined;
      if (limitRaw && Number.isNaN(limit)) {
        throw new Error(`Invalid console limit "${limitRaw}". Expected a number.`);
      }
      const level = (levelRaw ?? 'all') as NonNullable<BrowserConsoleArgs['level']>;
      if (!['all', 'log', 'info', 'warn', 'error'].includes(level)) {
        throw new Error(`Invalid console level "${String(levelRaw)}". Use one of: all, log, info, warn, error.`);
      }

      const entries = await fns.getConsoleLogs({ limit, level });
      const lines: string[] = [`Console entries (${entries.length}):`];
      for (const entry of entries) {
        lines.push(`[${new Date(entry.timestamp).toISOString()}] [${entry.level}] ${entry.message}`);
      }
      return { output: lines.join('\n'), appendReleaseHint: true };
    }

    if (cmd === 'window-resize') {
      const widthRaw = parts[1];
      const heightRaw = parts[2];
      if (!widthRaw || !heightRaw) throw new Error('window-resize requires width and height. Example: window-resize 1280 720');
      const width = Number(widthRaw);
      const height = Number(heightRaw);
      if (Number.isNaN(width) || Number.isNaN(height)) {
        throw new Error('window-resize width and height must be numbers.');
      }
      const resized = await fns.windowResize({ width, height });
      return { output: `Window resized to ${resized.width}x${resized.height}`, appendReleaseHint: true };
    }

    if (cmd === 'network') {
      const limitRaw = parts[1];
      const statusRaw = parts[2] as BrowserNetworkArgs['status'] | undefined;
      const limit = limitRaw ? Number(limitRaw) : undefined;
      if (limitRaw && Number.isNaN(limit)) {
        throw new Error(`Invalid network limit "${limitRaw}". Expected a number.`);
      }
      const status = statusRaw ?? 'all';
      if (!['all', 'failed', '2xx', '3xx', '4xx', '5xx'].includes(status)) {
        throw new Error(`Invalid network status "${String(statusRaw)}". Use one of: all, failed, 2xx, 3xx, 4xx, 5xx.`);
      }
      const entries = await fns.getNetworkLogs({ limit, status });
      const lines: string[] = [`Network entries (${entries.length}):`];
      for (const entry of entries) {
        lines.push(`[${new Date(entry.timestamp).toISOString()}] ${entry.method} ${entry.status} ${entry.resourceType} ${entry.url}`);
      }
      return { output: lines.join('\n'), appendReleaseHint: true };
    }

    if (cmd === 'wait') {
      const kind = parts[1] as BrowserWaitArgs['kind'] | undefined;
      if (!kind || !['selector', 'text', 'url', 'network-idle'].includes(kind)) {
        throw new Error('wait requires kind: selector|text|url|network-idle');
      }

      let value: string | undefined;
      let timeoutMs: number | undefined;
      if (kind === 'network-idle') {
        const timeoutRaw = parts[2];
        timeoutMs = timeoutRaw ? Number(timeoutRaw) : undefined;
        if (timeoutRaw && Number.isNaN(timeoutMs)) {
          throw new Error(`Invalid wait timeout "${timeoutRaw}". Expected a number.`);
        }
      } else {
        value = parts[2];
        if (!value) throw new Error(`wait ${kind} requires a value.`);
        const timeoutRaw = parts[3];
        timeoutMs = timeoutRaw ? Number(timeoutRaw) : undefined;
        if (timeoutRaw && Number.isNaN(timeoutMs)) {
          throw new Error(`Invalid wait timeout "${timeoutRaw}". Expected a number.`);
        }
      }

      const result = await fns.waitFor({ kind, value, timeoutMs });
      return { output: `Wait succeeded (${result.kind}) in ${result.elapsedMs}ms — ${result.detail}`, appendReleaseHint: true };
    }

    if (cmd === 'key') {
      const key = parts[1];
      if (!key) throw new Error('key requires key value. Example: key Enter');
      const modifiers = (parts[2] ? parts[2].split('+') : []) as Array<'shift' | 'control' | 'alt' | 'meta'>;
      for (const m of modifiers) {
        if (!['shift', 'control', 'alt', 'meta'].includes(m)) {
          throw new Error(`Invalid key modifier "${m}". Use shift|control|alt|meta`);
        }
      }
      await fns.sendKey({ key, modifiers });
      return { output: `Key sent: ${key}${modifiers.length ? ` (${modifiers.join('+')})` : ''}`, appendReleaseHint: true };
    }

    if (cmd === 'downloads') {
      const actionRaw = parts[1] as BrowserDownloadsArgs['action'] | undefined;
      const action = actionRaw && ['list', 'wait'].includes(actionRaw) ? actionRaw : 'list';
      const valueRaw = parts[2];
      const valueNum = valueRaw ? Number(valueRaw) : undefined;
      if (valueRaw && Number.isNaN(valueNum)) {
        throw new Error(`Invalid downloads numeric value "${valueRaw}".`);
      }
      const entries = await fns.getDownloads({
        action,
        ...(action === 'wait' ? { timeoutMs: valueNum } : { limit: valueNum }),
      });
      const lines: string[] = [`Downloads (${entries.length}):`];
      for (const entry of entries) {
        lines.push(`[${new Date(entry.timestamp).toISOString()}] [${entry.state}] ${entry.filename} (${entry.bytesReceived}/${entry.totalBytes})`);
      }
      return { output: lines.join('\n'), appendReleaseHint: true };
    }

    if (cmd === 'scroll') {
      const direction = parts[1] as 'up' | 'down' | 'left' | 'right' | undefined;
      const amountRaw = parts[2];
      if (!direction || !['up', 'down', 'left', 'right'].includes(direction)) {
        throw new Error('scroll requires direction up|down|left|right. Example: scroll down 800');
      }
      const amount = amountRaw ? Number(amountRaw) : undefined;
      if (amountRaw && Number.isNaN(amount)) {
        throw new Error(`Invalid scroll amount "${amountRaw}". Expected a number.`);
      }
      await fns.scroll(direction, amount);
      return { output: `Scrolled ${direction}${amount != null ? ` by ${amount}px` : ''}`, appendReleaseHint: true };
    }

    if (cmd === 'back') {
      await fns.goBack();
      return { output: 'Navigated back', appendReleaseHint: true };
    }

    if (cmd === 'forward') {
      await fns.goForward();
      return { output: 'Navigated forward', appendReleaseHint: true };
    }

    if (cmd === 'evaluate') {
      const expression = parts.slice(1).join(' ').trim();
      if (!expression) throw new Error('evaluate requires an expression. Example: evaluate document.title');
      const result = await fns.evaluate(expression);
      return {
        output: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        appendReleaseHint: true,
      };
    }

    if (cmd === 'windows') {
      const windows = await fns.listWindows();
      const lines: string[] = [`Browser windows (${windows.length}):`];

      for (const w of windows) {
        const lockState = w.boundSessionId ? `locked-session(${w.boundSessionId})` : 'unlocked'
        const availableToSession = !w.boundSessionId || w.boundSessionId === options.sessionId
        lines.push(
          '',
          `- ${w.id}`,
          `  title: ${w.title || 'New Tab'}`,
          `  url: ${w.url || 'about:blank'}`,
          `  visible: ${w.isVisible}`,
          `  ownerType: ${w.ownerType}`,
          `  ownerSessionId: ${w.ownerSessionId ?? 'none'}`,
          `  boundSessionId: ${w.boundSessionId ?? 'none'}`,
          `  lockState: ${lockState}`,
          `  availableToSession: ${availableToSession}`,
          `  agentControlActive: ${!!w.agentControlActive}`,
        );
      }

      return { output: lines.join('\n'), appendReleaseHint: false };
    }

    if (cmd === 'release') {
      await fns.releaseControl();
      return { output: 'Browser control released. Agent overlay dismissed.', appendReleaseHint: false };
    }

    if (cmd === 'close') {
      await fns.closeWindow();
      return { output: 'Browser window closed and destroyed.', appendReleaseHint: false };
    }

    if (cmd === 'hide') {
      await fns.hideWindow();
      return { output: 'Browser window hidden. Use "open" to show it again.', appendReleaseHint: false };
    }

    throw new Error(`Unknown browser_tool command "${cmd}". Use "--help" to see supported commands.`);
  }

  return [
    // browser_open
    tool(
      'browser_open',
      BROWSER_DESCRIPTIONS.browser_open,
      {},
      async () => {
        try {
          const fns = getBrowserFns();
          const result = await fns.openPanel({ background: true });
          return browserSuccessResponse(`Opened in-app browser window in background (instance: ${result.instanceId})`);
        } catch (error) {
          return errorResponse(error instanceof Error ? error.message : String(error));
        }
      },
    ),

    // browser_navigate
    tool(
      'browser_navigate',
      BROWSER_DESCRIPTIONS.browser_navigate,
      {
        url: z.string().min(1).describe('URL to navigate to (e.g., "https://example.com" or "example.com")'),
      },
      async (args) => {
        try {
          const fns = getBrowserFns();
          const result = await fns.navigate(args.url);
          return browserSuccessResponse(`Navigated to: ${result.url}\nTitle: ${result.title}`);
        } catch (error) {
          return errorResponse(error instanceof Error ? error.message : String(error));
        }
      },
    ),

    // browser_snapshot
    tool(
      'browser_snapshot',
      BROWSER_DESCRIPTIONS.browser_snapshot,
      {},
      async () => {
        try {
          const fns = getBrowserFns();
          const snapshot = await fns.snapshot();

          // Format as readable text for the agent
          const lines: string[] = [
            `URL: ${snapshot.url}`,
            `Title: ${snapshot.title}`,
            ``,
            `Elements (${snapshot.nodes.length}):`,
          ];

          for (const node of snapshot.nodes) {
            let line = `  ${node.ref} [${node.role}] "${node.name}"`;
            if (node.value !== undefined) line += ` value="${node.value}"`;
            if (node.focused) line += ' (focused)';
            if (node.checked) line += ' (checked)';
            if (node.disabled) line += ' (disabled)';
            if (node.description) line += ` — ${node.description}`;
            lines.push(line);
          }

          return browserSuccessResponse(lines.join('\n'));
        } catch (error) {
          return errorResponse(error instanceof Error ? error.message : String(error));
        }
      },
    ),

    // browser_click
    tool(
      'browser_click',
      BROWSER_DESCRIPTIONS.browser_click,
      {
        ref: z.string().describe('Element ref from browser_snapshot (e.g., "@e1")'),
        waitFor: z.enum(['none', 'navigation', 'network-idle']).optional().describe('Optional wait mode after click'),
        timeoutMs: z.number().optional().describe('Optional wait timeout in milliseconds for waitFor modes'),
      },
      async (args) => {
        try {
          const fns = getBrowserFns();
          await fns.click(args.ref, { waitFor: args.waitFor, timeoutMs: args.timeoutMs });
          return browserSuccessResponse(`Clicked element ${args.ref}${args.waitFor ? ` (waitFor=${args.waitFor})` : ''}`);
        } catch (error) {
          return errorResponse(error instanceof Error ? error.message : String(error));
        }
      },
    ),

    // browser_fill
    tool(
      'browser_fill',
      BROWSER_DESCRIPTIONS.browser_fill,
      {
        ref: z.string().describe('Element ref from browser_snapshot (e.g., "@e5")'),
        value: z.string().describe('Text to type into the element'),
      },
      async (args) => {
        try {
          const fns = getBrowserFns();
          await fns.fill(args.ref, args.value);
          return browserSuccessResponse(`Filled element ${args.ref} with "${args.value}"`);
        } catch (error) {
          return errorResponse(error instanceof Error ? error.message : String(error));
        }
      },
    ),

    // browser_select
    tool(
      'browser_select',
      BROWSER_DESCRIPTIONS.browser_select,
      {
        ref: z.string().describe('Element ref from browser_snapshot (e.g., "@e3")'),
        value: z.string().describe('Option value to select'),
      },
      async (args) => {
        try {
          const fns = getBrowserFns();
          await fns.select(args.ref, args.value);
          return browserSuccessResponse(`Selected "${args.value}" in element ${args.ref}`);
        } catch (error) {
          return errorResponse(error instanceof Error ? error.message : String(error));
        }
      },
    ),

    // browser_screenshot
    tool(
      'browser_screenshot',
      BROWSER_DESCRIPTIONS.browser_screenshot,
      {
        mode: z.enum(['raw', 'agent']).optional().describe('Capture mode. raw=plain screenshot, agent=adds semantic annotations and metadata'),
        refs: z.array(z.string()).optional().describe('Element refs from browser_snapshot to annotate'),
        includeLastAction: z.boolean().optional().describe('Include last browser action target when available'),
        includeMetadata: z.boolean().optional().describe('Include compact metadata overlay and metadata payload in response text'),
      },
      async (args) => {
        try {
          const fns = getBrowserFns();
          const result = await fns.screenshot(args);
          const base64 = result.png.toString('base64');

          const lines = [
            `Screenshot captured (${Math.round(result.png.length / 1024)}KB PNG)`,
          ];
          if (result.metadata) {
            lines.push('', 'Metadata:', JSON.stringify(result.metadata, null, 2));
          }

          return {
            content: [
              { type: 'text' as const, text: lines.join('\n') + BROWSER_RELEASE_HINT },
              { type: 'image' as const, data: base64, mimeType: 'image/png' },
            ],
          };
        } catch (error) {
          return errorResponse(error instanceof Error ? error.message : String(error));
        }
      },
    ),

    // browser_screenshot_region
    tool(
      'browser_screenshot_region',
      BROWSER_DESCRIPTIONS.browser_screenshot_region,
      {
        x: z.number().optional().describe('Region left coordinate in pixels (for coordinate mode)'),
        y: z.number().optional().describe('Region top coordinate in pixels (for coordinate mode)'),
        width: z.number().positive().optional().describe('Region width in pixels (for coordinate mode, > 0)'),
        height: z.number().positive().optional().describe('Region height in pixels (for coordinate mode, > 0)'),
        ref: z.string().min(1).optional().describe('Element ref from browser_snapshot (for ref mode, e.g., "@e12")'),
        selector: z.string().min(1).optional().describe('CSS selector for target element (for selector mode)'),
        padding: z.number().optional().describe('Optional padding around the resolved target box in pixels'),
      },
      async (args) => {
        try {
          const fns = getBrowserFns();
          const validationError = validateScreenshotRegionArgs(args);
          if (validationError) {
            throw new Error(validationError);
          }
          const result = await fns.screenshotRegion(args);
          const base64 = result.png.toString('base64');

          const lines = [
            `Region screenshot captured (${Math.round(result.png.length / 1024)}KB PNG)`,
          ];
          if (result.metadata) {
            lines.push('', 'Metadata:', JSON.stringify(result.metadata, null, 2));
          }

          return {
            content: [
              { type: 'text' as const, text: lines.join('\n') + BROWSER_RELEASE_HINT },
              { type: 'image' as const, data: base64, mimeType: 'image/png' },
            ],
          };
        } catch (error) {
          return errorResponse(error instanceof Error ? error.message : String(error));
        }
      },
    ),

    // browser_console
    tool(
      'browser_console',
      BROWSER_DESCRIPTIONS.browser_console,
      {
        level: z.enum(['all', 'log', 'info', 'warn', 'error']).optional().describe('Filter by console level. all includes every level.'),
        limit: z.number().optional().describe('Maximum number of recent entries to return (default: 50)'),
      },
      async (args) => {
        try {
          const fns = getBrowserFns();
          const entries = await fns.getConsoleLogs(args);
          const lines: string[] = [`Console entries (${entries.length}):`];
          for (const entry of entries) {
            lines.push(`[${new Date(entry.timestamp).toISOString()}] [${entry.level}] ${entry.message}`);
          }
          return browserSuccessResponse(lines.join('\n'));
        } catch (error) {
          return errorResponse(error instanceof Error ? error.message : String(error));
        }
      },
    ),

    // browser_window_resize
    tool(
      'browser_window_resize',
      BROWSER_DESCRIPTIONS.browser_window_resize,
      {
        width: z.number().describe('Viewport width in pixels'),
        height: z.number().describe('Viewport height in pixels'),
      },
      async (args) => {
        try {
          const fns = getBrowserFns();
          const result = await fns.windowResize({ width: args.width, height: args.height });
          return browserSuccessResponse(`Window resized to ${result.width}x${result.height}`);
        } catch (error) {
          return errorResponse(error instanceof Error ? error.message : String(error));
        }
      },
    ),

    // browser_network
    tool(
      'browser_network',
      BROWSER_DESCRIPTIONS.browser_network,
      {
        limit: z.number().optional().describe('Maximum number of entries to return (default: 50)'),
        status: z.enum(['all', 'failed', '2xx', '3xx', '4xx', '5xx']).optional().describe('Status filter for network entries'),
        method: z.string().optional().describe('Optional HTTP method filter (e.g., GET, POST)'),
        resourceType: z.string().optional().describe('Optional resource type filter (e.g., xhr, fetch, document)'),
      },
      async (args) => {
        try {
          const fns = getBrowserFns();
          const entries = await fns.getNetworkLogs(args);
          const lines: string[] = [`Network entries (${entries.length}):`];
          for (const entry of entries) {
            lines.push(`[${new Date(entry.timestamp).toISOString()}] ${entry.method} ${entry.status} ${entry.resourceType} ${entry.url}`);
          }
          return browserSuccessResponse(lines.join('\n'));
        } catch (error) {
          return errorResponse(error instanceof Error ? error.message : String(error));
        }
      },
    ),

    // browser_wait
    tool(
      'browser_wait',
      BROWSER_DESCRIPTIONS.browser_wait,
      {
        kind: z.enum(['selector', 'text', 'url', 'network-idle']).describe('Condition kind to wait for'),
        value: z.string().optional().describe('Condition value for selector/text/url waits'),
        timeoutMs: z.number().optional().describe('Wait timeout in milliseconds (default: 10000)'),
        pollMs: z.number().optional().describe('Polling interval for selector/text/url waits (default: 100)'),
        idleMs: z.number().optional().describe('Idle window for network-idle waits (default: 700)'),
      },
      async (args) => {
        try {
          const fns = getBrowserFns();
          const result = await fns.waitFor(args);
          return browserSuccessResponse(`Wait succeeded (${result.kind}) in ${result.elapsedMs}ms — ${result.detail}`);
        } catch (error) {
          return errorResponse(error instanceof Error ? error.message : String(error));
        }
      },
    ),

    // browser_key
    tool(
      'browser_key',
      BROWSER_DESCRIPTIONS.browser_key,
      {
        key: z.string().describe('Key to send (e.g., Enter, Escape, k)'),
        modifiers: z.array(z.enum(['shift', 'control', 'alt', 'meta'])).optional().describe('Optional modifier keys'),
      },
      async (args) => {
        try {
          const fns = getBrowserFns();
          await fns.sendKey(args);
          return browserSuccessResponse(`Key sent: ${args.key}${args.modifiers?.length ? ` (${args.modifiers.join('+')})` : ''}`);
        } catch (error) {
          return errorResponse(error instanceof Error ? error.message : String(error));
        }
      },
    ),

    // browser_downloads
    tool(
      'browser_downloads',
      BROWSER_DESCRIPTIONS.browser_downloads,
      {
        action: z.enum(['list', 'wait']).optional().describe('list returns recent downloads, wait waits for terminal state first'),
        limit: z.number().optional().describe('Maximum entries for list action (default: 20)'),
        timeoutMs: z.number().optional().describe('Wait timeout for wait action (default: 10000)'),
      },
      async (args) => {
        try {
          const fns = getBrowserFns();
          const entries = await fns.getDownloads(args);
          const lines: string[] = [`Downloads (${entries.length}):`];
          for (const entry of entries) {
            lines.push(`[${new Date(entry.timestamp).toISOString()}] [${entry.state}] ${entry.filename} (${entry.bytesReceived}/${entry.totalBytes})`);
          }
          return browserSuccessResponse(lines.join('\n'));
        } catch (error) {
          return errorResponse(error instanceof Error ? error.message : String(error));
        }
      },
    ),

    // browser_scroll
    tool(
      'browser_scroll',
      BROWSER_DESCRIPTIONS.browser_scroll,
      {
        direction: z.enum(['up', 'down', 'left', 'right']).describe('Scroll direction'),
        amount: z.number().optional().describe('Scroll amount in pixels (default: 500)'),
      },
      async (args) => {
        try {
          const fns = getBrowserFns();
          await fns.scroll(args.direction, args.amount);
          return browserSuccessResponse(`Scrolled ${args.direction}${args.amount ? ` by ${args.amount}px` : ''}`);
        } catch (error) {
          return errorResponse(error instanceof Error ? error.message : String(error));
        }
      },
    ),

    // browser_back
    tool(
      'browser_back',
      BROWSER_DESCRIPTIONS.browser_back,
      {},
      async () => {
        try {
          const fns = getBrowserFns();
          await fns.goBack();
          return browserSuccessResponse('Navigated back');
        } catch (error) {
          return errorResponse(error instanceof Error ? error.message : String(error));
        }
      },
    ),

    // browser_forward
    tool(
      'browser_forward',
      BROWSER_DESCRIPTIONS.browser_forward,
      {},
      async () => {
        try {
          const fns = getBrowserFns();
          await fns.goForward();
          return browserSuccessResponse('Navigated forward');
        } catch (error) {
          return errorResponse(error instanceof Error ? error.message : String(error));
        }
      },
    ),

    // browser_evaluate
    tool(
      'browser_evaluate',
      BROWSER_DESCRIPTIONS.browser_evaluate,
      {
        expression: z.string().describe('JavaScript expression to evaluate in the page context'),
      },
      async (args) => {
        try {
          const fns = getBrowserFns();
          const result = await fns.evaluate(args.expression);
          const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
          return browserSuccessResponse(text);
        } catch (error) {
          return errorResponse(error instanceof Error ? error.message : String(error));
        }
      },
    ),

    // browser_tool
    tool(
      'browser_tool',
      BROWSER_DESCRIPTIONS.browser_tool,
      {
        command: z.string().describe('CLI-like browser command (e.g., "navigate https://example.com", "click @e1", "--help")'),
      },
      async (args) => {
        try {
          const result = await runBrowserCommand(args.command);
          return result.appendReleaseHint
            ? browserSuccessResponse(result.output)
            : successResponse(result.output);
        } catch (error) {
          return errorResponse(error instanceof Error ? error.message : String(error));
        }
      },
    ),
  ];
}
