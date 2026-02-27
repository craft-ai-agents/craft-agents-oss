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

// ============================================================================
// Browser Pane Function Interface
// ============================================================================

/**
 * Abstraction over BrowserPaneManager for use in session-scoped tools.
 * The Electron session manager creates this by binding to a specific session's
 * browser instance via getOrCreateForSession(sessionId).
 */
export interface BrowserPaneFns {
  openPanel: () => Promise<{ instanceId: string }>;
  navigate: (url: string) => Promise<{ url: string; title: string }>;
  snapshot: () => Promise<{ url: string; title: string; nodes: Array<{ ref: string; role: string; name: string; value?: string; description?: string; focused?: boolean; checked?: boolean; disabled?: boolean }> }>;
  click: (ref: string) => Promise<void>;
  fill: (ref: string, value: string) => Promise<void>;
  select: (ref: string, value: string) => Promise<void>;
  screenshot: () => Promise<Buffer>;
  scroll: (direction: 'up' | 'down' | 'left' | 'right', amount?: number) => Promise<void>;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  evaluate: (expression: string) => Promise<unknown>;
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
  browser_open: `Open (or focus) an in-app browser window.

Ensures the session's browser instance is visible and focused.
Returns the browser instance ID that was opened/focused.`,

  browser_navigate: `Navigate the built-in browser to a URL.

The built-in browser windows run real Chromium content inside the app. Use this to load web pages for inspection, testing, or data extraction.

If the browser UI may be hidden, call \`browser_open\` first.

Returns the final URL and page title after navigation completes.`,

  browser_snapshot: `Get an accessibility tree snapshot of the current browser page.

Returns a structured list of interactive elements (buttons, links, inputs, etc.) and content nodes (headings, paragraphs, images) with ref IDs like @e1, @e2.

Use these refs with browser_click and browser_fill to interact with elements. The snapshot is the primary way to understand page structure — prefer it over screenshots for element interaction.`,

  browser_click: `Click an element in the browser by its ref ID (e.g., @e1).

Get refs from browser_snapshot first. This performs a real mouse click at the element's center coordinates.`,

  browser_fill: `Fill a text input or textarea in the browser by its ref ID.

Clears the existing value first, then types the new value character by character. Get refs from browser_snapshot first.`,

  browser_select: `Select an option in a <select> dropdown by its ref ID.

Pass the option's value attribute. Get refs from browser_snapshot first.`,

  browser_screenshot: `Take a screenshot of the current browser page.

Returns the screenshot as a base64-encoded PNG. Use browser_snapshot instead when you need to interact with elements — screenshots are better for visual verification.`,

  browser_scroll: `Scroll the browser page in a given direction.

Useful for revealing content below the fold before taking a snapshot. Default scroll amount is 500 pixels.`,

  browser_back: `Navigate the browser back to the previous page in history.`,

  browser_forward: `Navigate the browser forward to the next page in history.`,

  browser_evaluate: `Execute JavaScript in the browser page and return the result.

Use this for advanced interactions not covered by other browser tools, like reading computed styles, extracting data from the DOM, or triggering custom events.

The expression is evaluated in the page context. Return values are serialized to JSON.`,
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

  return [
    // browser_open
    tool(
      'browser_open',
      BROWSER_DESCRIPTIONS.browser_open,
      {},
      async () => {
        try {
          const fns = getBrowserFns();
          const result = await fns.openPanel();
          return successResponse(`Opened in-app browser window (instance: ${result.instanceId})`);
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
          return successResponse(`Navigated to: ${result.url}\nTitle: ${result.title}`);
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

          return successResponse(lines.join('\n'));
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
      },
      async (args) => {
        try {
          const fns = getBrowserFns();
          await fns.click(args.ref);
          return successResponse(`Clicked element ${args.ref}`);
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
          return successResponse(`Filled element ${args.ref} with "${args.value}"`);
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
          return successResponse(`Selected "${args.value}" in element ${args.ref}`);
        } catch (error) {
          return errorResponse(error instanceof Error ? error.message : String(error));
        }
      },
    ),

    // browser_screenshot
    tool(
      'browser_screenshot',
      BROWSER_DESCRIPTIONS.browser_screenshot,
      {},
      async () => {
        try {
          const fns = getBrowserFns();
          const png = await fns.screenshot();
          const base64 = png.toString('base64');
          return {
            content: [
              { type: 'text' as const, text: `Screenshot captured (${Math.round(png.length / 1024)}KB PNG)` },
              { type: 'image' as const, data: base64, mimeType: 'image/png' },
            ],
          };
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
          return successResponse(`Scrolled ${args.direction}${args.amount ? ` by ${args.amount}px` : ''}`);
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
          return successResponse('Navigated back');
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
          return successResponse('Navigated forward');
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
          return successResponse(text);
        } catch (error) {
          return errorResponse(error instanceof Error ? error.message : String(error));
        }
      },
    ),
  ];
}
