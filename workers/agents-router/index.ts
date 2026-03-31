/**
 * Router for agents.craft.do
 *
 * Routes:
 * - /electron/* → R2 bucket (installers, manifests)
 * - /cli/* → R2 bucket (CLI binaries, install script)
 * - /codex-beta/* → R2 bucket (Codex beta builds)
 * - /install-app.sh → R2 bucket (macOS/Linux install script)
 * - /install-app.ps1 → R2 bucket (Windows install script)
 * - /auth/callback → Generic OAuth callback relay (redirects via return_to or relay state)
 * - /auth/slack/callback → Legacy Slack OAuth callback relay (redirects to localhost)
 * - /docs/* → Mintlify documentation site
 * - /s/* → Session viewer Pages site
 * - /mermaid/* → Mermaid visual test suite Pages site
 * - /* → Proxy to Pages marketing site
 */

import { decodeOAuthRelayState, isOAuthRelayState } from '../../packages/shared/src/auth/oauth-relay.ts';

interface Env {
  DOWNLOADS: R2Bucket;
}

function isAllowedReturnToTarget(parsed: URL): boolean {
  return parsed.hostname === 'localhost' || parsed.protocol === 'https:';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // R2 paths: serve from bucket
    if (path.startsWith('/electron/') || path.startsWith('/cli/') || path.startsWith('/codex-beta/') || path === '/install-app.sh' || path === '/install-app.ps1') {
      const key = decodeURIComponent(path.slice(1));
      const object = await env.DOWNLOADS.get(key);

      if (!object) {
        return new Response('Not Found', { status: 404 });
      }

      const headers = new Headers();
      headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
      headers.set('Cache-Control', object.httpMetadata?.cacheControl || 'no-cache');
      if (object.httpMetadata?.contentDisposition) {
        headers.set('Content-Disposition', object.httpMetadata.contentDisposition);
      }

      return new Response(object.body, { headers });
    }

    // Mintlify docs: /docs/* routes
    // Proxies to Mintlify-hosted documentation with required headers for custom domain support
    if (path.startsWith('/docs')) {
      const MINTLIFY_HOST = 'craft-82d4d72a.mintlify.dev';
      const docsUrl = new URL(request.url);
      docsUrl.hostname = MINTLIFY_HOST;

      const proxyRequest = new Request(docsUrl, request);
      proxyRequest.headers.set('Host', MINTLIFY_HOST);
      proxyRequest.headers.set('X-Forwarded-Host', 'agents.craft.do');
      proxyRequest.headers.set('X-Forwarded-Proto', 'https');

      return fetch(proxyRequest);
    }

    // Session viewer: /s/* routes
    if (path.startsWith('/s/')) {
      return fetch(`https://craft-agents-session-viewer.pages.dev${path}${url.search}`, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
    }

    // Mermaid site: /mermaid routes
    if (path === '/mermaid' || path.startsWith('/mermaid/')) {
      const mermaidPath = path === '/mermaid' ? '/' : path.slice('/mermaid'.length);
      return fetch(`https://craft-agents-mermaid.pages.dev${mermaidPath}${url.search}`);
    }

    // Generic OAuth callback relay: /auth/callback
    // Supports both:
    // - legacy query routing via return_to=...
    // - stable redirect_uri routing where the real callback target is encoded in state
    if (path === '/auth/callback') {
      const rawState = url.searchParams.get('state');
      let relayState: ReturnType<typeof decodeOAuthRelayState> | null = null;

      if (rawState && isOAuthRelayState(rawState)) {
        try {
          relayState = decodeOAuthRelayState(rawState);
        } catch {
          return new Response('Invalid relay state', { status: 400 });
        }
      }

      const returnTo = relayState?.returnTo || url.searchParams.get('return_to');
      if (!returnTo) {
        return new Response('Missing return_to parameter', { status: 400 });
      }

      let parsed: URL;
      try {
        parsed = new URL(returnTo);
      } catch {
        return new Response('Invalid return_to URL', { status: 400 });
      }

      if (!isAllowedReturnToTarget(parsed)) {
        return new Response('Invalid return_to URL: must be localhost or HTTPS', { status: 400 });
      }

      const params = new URLSearchParams(url.search);
      params.delete('return_to');
      if (relayState) {
        params.set('state', relayState.innerState);
      }

      const separator = returnTo.includes('?') ? '&' : '?';
      return Response.redirect(`${returnTo}${separator}${params.toString()}`, 302);
    }

    // Legacy Slack OAuth callback relay: /auth/slack/callback
    // Kept for backward compatibility — new flows use /auth/callback.
    if (path === '/auth/slack/callback') {
      const port = url.searchParams.get('port') || '6477';
      const portNum = parseInt(port, 10);
      if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
        return new Response('Invalid port', { status: 400 });
      }
      const params = new URLSearchParams(url.search);
      params.delete('port');
      return Response.redirect(`http://localhost:${portNum}/callback?${params.toString()}`, 302);
    }

    // Everything else → Pages marketing site
    return fetch(`https://craft-agents-marketing-e8k.pages.dev${path}${url.search}`);
  },
};
