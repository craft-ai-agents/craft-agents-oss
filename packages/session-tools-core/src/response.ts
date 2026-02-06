/**
 * Session Tools Core - Response Helpers
 *
 * Helper functions for creating standardized tool responses.
 * Used by both Claude and Codex implementations.
 */

import type { ToolResult, TextContent } from './types.ts';

/**
 * Create a successful text response
 */
export function successResponse(text: string): ToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent: {},
    isError: false,
  };
}

/**
 * Create an error response
 */
export function errorResponse(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    structuredContent: {},
    isError: true,
  };
}

/**
 * Create a text content block
 */
export function textContent(text: string): TextContent {
  return { type: 'text', text };
}

/**
 * Create a multi-block response (e.g., for multiple sections)
 */
export function multiBlockResponse(texts: string[], isError?: boolean): ToolResult {
  return {
    content: texts.map(text => ({ type: 'text' as const, text })),
    structuredContent: {},
    isError,
  };
}
