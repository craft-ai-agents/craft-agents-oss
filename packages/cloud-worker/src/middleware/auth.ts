/**
 * API Key Authentication Middleware
 *
 * Validates requests against a single global API_KEY secret env var.
 * Supports both:
 * - Authorization: Bearer <key> (for REST and general requests)
 * - ?apiKey=<key> query parameter (for WebSocket upgrade, since WS can't set headers)
 * - Signed URLs with ?sig=xxx&exp=xxx for file access (validated in route handler)
 */

import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types.ts';

export const authMiddleware: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const url = new URL(c.req.url);

  // Allow signed URL file access to pass through - validation happens in route handler
  const isFileGet = c.req.method === 'GET' && url.pathname.startsWith('/files/');
  const hasSignedParams = url.searchParams.has('sig') && url.searchParams.has('exp');
  if (isFileGet && hasSignedParams) {
    // Mark as signed URL request for route handler to validate
    c.set('isSignedUrlRequest', true);
    await next();
    return;
  }

  const authHeader = c.req.header('Authorization');
  const apiKey = authHeader?.replace('Bearer ', '')
    ?? url.searchParams.get('apiKey');

  if (!apiKey || apiKey !== c.env.API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await next();
};
