/**
 * Cloudflare Worker - OAuth callback relay
 *
 * Handles OAuth callbacks and redirects to localhost.
 * Deploy to: agents.craft.do/auth/*
 */

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Only handle /auth/slack/callback
    if (url.pathname === '/auth/slack/callback') {
      // Get port from query params (default to 6477)
      const port = url.searchParams.get('port') || '6477';

      // Validate port is numeric and in valid range
      const portNum = parseInt(port, 10);
      if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
        return new Response('Invalid port', { status: 400 });
      }

      // Build localhost redirect URL, preserving all OAuth params except port
      const params = new URLSearchParams(url.search);
      params.delete('port');

      const localUrl = `http://localhost:${portNum}/callback?${params.toString()}`;

      return Response.redirect(localUrl, 302);
    }

    // For other paths, return 404
    return new Response('Not found', { status: 404 });
  },
};
