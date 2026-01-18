/**
 * Fetch interceptor that captures the system prompt and writes it to a temp file.
 * This file is loaded via bunfig.toml preload to intercept subprocess fetch calls.
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const CAPTURE_FILE = '/tmp/claude-system-prompt-capture.json';
const LOG_FILE = '/tmp/claude-extract-debug.log';

// Only capture if extraction mode is enabled
const EXTRACT_MODE = process.env.CLAUDE_EXTRACT_SYSTEM_PROMPT === '1';

function log(msg: string) {
  if (!EXTRACT_MODE) return;
  const timestamp = new Date().toISOString();
  try {
    const fd = Bun.file(LOG_FILE);
    const existing = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf-8') : '';
    writeFileSync(LOG_FILE, existing + `${timestamp} ${msg}\n`);
  } catch {
    // Ignore
  }
}

if (EXTRACT_MODE) {
  log('[capture-interceptor] Loaded in extraction mode');

  const originalFetch = globalThis.fetch.bind(globalThis);

  async function interceptFetch(
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    log(`[fetch] ${init?.method || 'GET'} ${url}`);

    // Intercept Anthropic messages API
    if (url.includes('api.anthropic.com') && url.includes('/messages') && init?.method?.toUpperCase() === 'POST' && init?.body) {
      try {
        const body = JSON.parse(init.body as string);
        if (body.system && Array.isArray(body.system)) {
          log(`[capture] Found system prompt with ${body.system.length} blocks`);

          // Check if this is the main Claude Code prompt (not a subagent)
          // Join all blocks to search for key phrases
          const allText = body.system.map((b: { text?: string }) => b.text || '').join('\n');
          const isMainPrompt = allText.includes('interactive CLI tool that helps users') &&
                               !allText.includes('software architect and planning specialist') &&
                               !allText.includes('READ-ONLY MODE');

          if (!isMainPrompt) {
            log(`[capture] Skipping subagent prompt`);
          } else {
            // Write to capture file
            const capture = {
              timestamp: new Date().toISOString(),
              model: body.model,
              systemBlocks: body.system,
            };
            writeFileSync(CAPTURE_FILE, JSON.stringify(capture, null, 2));
            log(`[capture] Written to ${CAPTURE_FILE}`);
          }
        }
      } catch (e) {
        log(`[capture] Error: ${e}`);
      }
    }

    return originalFetch(input, init);
  }

  // Create proxy
  const fetchProxy = new Proxy(interceptFetch, {
    apply(target, thisArg, args) {
      return Reflect.apply(target, thisArg, args);
    },
    get(target, prop, receiver) {
      if (prop in originalFetch) {
        return (originalFetch as unknown as Record<string | symbol, unknown>)[prop];
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  (globalThis as unknown as { fetch: unknown }).fetch = fetchProxy;
  log('[capture-interceptor] Fetch patched');
}
