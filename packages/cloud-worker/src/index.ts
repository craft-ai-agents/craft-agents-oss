/**
 * Craft Agent Cloud Worker
 *
 * Entry point for the Cloudflare Worker. Routes all requests through
 * API key auth, then forwards to the appropriate Durable Object by
 * workspace slug.
 *
 * URL pattern: /workspace/:slug/* → WorkspaceDO(idFromName(slug))
 *
 * The slug IS the Durable Object identity. New slugs auto-create.
 * Auth is a single global API_KEY secret env var.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware } from './middleware/auth.ts';
import { validateSignedUrl, generateSignedUrl } from './middleware/signed-url.ts';
import type { Env, FileMetadata, OAuthState } from './types.ts';
import { isValidFileType } from './types.ts';
import { encodeOAuthState, decodeOAuthState } from './utils/oauth-state.ts';

const app = new Hono<{ Bindings: Env }>();

// CORS for cross-origin requests from Electron app
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
}));

// ============================================================
// OAuth Routes (public - no auth required)
// ============================================================

// Initiate GitHub OAuth flow
app.get('/oauth/github', async (c) => {
  const workspaceSlug = c.req.query('workspaceSlug');
  const repoKey = c.req.query('repoKey');
  const redirectUri = c.req.query('redirectUri');

  if (!workspaceSlug || !repoKey || !redirectUri) {
    return c.json({ error: 'Missing required parameters: workspaceSlug, repoKey, redirectUri' }, 400);
  }

  // Create state for CSRF protection
  const state: OAuthState = {
    workspaceSlug,
    repoKey,
    redirectUri,
    nonce: crypto.randomUUID(),
  };

  const encodedState = encodeOAuthState(state);

  const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
  githubAuthUrl.searchParams.set('client_id', c.env.GITHUB_CLIENT_ID);
  // Use request origin so OAuth works regardless of which URL is used to access the worker
  const workerOrigin = new URL(c.req.url).origin;
  githubAuthUrl.searchParams.set('redirect_uri', `${workerOrigin}/oauth/github/callback`);
  githubAuthUrl.searchParams.set('scope', 'repo');
  githubAuthUrl.searchParams.set('state', encodedState);

  return c.redirect(githubAuthUrl.toString());
});

// Handle GitHub OAuth callback
app.get('/oauth/github/callback', async (c) => {
  const code = c.req.query('code');
  const stateParam = c.req.query('state');
  const error = c.req.query('error');

  if (error) {
    const state = stateParam ? decodeOAuthState(stateParam) : null;
    const redirectUri = state?.redirectUri || 'craft-agent://oauth/callback';
    return c.redirect(`${redirectUri}?error=${error}`);
  }

  if (!code || !stateParam) {
    return c.json({ error: 'Missing code or state parameter' }, 400);
  }

  const state = decodeOAuthState(stateParam);
  if (!state) {
    return c.json({ error: 'Invalid state parameter' }, 400);
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: c.env.GITHUB_CLIENT_ID,
        client_secret: c.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = await tokenResponse.json<{
      access_token?: string;
      scope?: string;
      token_type?: string;
      error?: string;
      error_description?: string;
    }>();

    if (tokenData.error || !tokenData.access_token) {
      return c.redirect(`${state.redirectUri}?error=${tokenData.error || 'token_exchange_failed'}&repo=${state.repoKey}`);
    }

    // Get user info
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'User-Agent': 'Craft-Agent-Cloud',
      },
    });

    if (!userResponse.ok) {
      return c.redirect(`${state.redirectUri}?error=user_fetch_failed&repo=${state.repoKey}`);
    }

    const user = await userResponse.json<{ login: string; id: number }>();

    // Verify access to the repo
    const repoResponse = await fetch(`https://api.github.com/repos/${state.repoKey}`, {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'User-Agent': 'Craft-Agent-Cloud',
      },
    });

    if (!repoResponse.ok) {
      return c.redirect(`${state.redirectUri}?error=no_repo_access&repo=${state.repoKey}`);
    }

    // Store credential in Workspace DO
    const workspaceDO = c.env.WORKSPACE.get(
      c.env.WORKSPACE.idFromName(state.workspaceSlug)
    );

    // Call the DO to store the credential
    const storeResponse = await workspaceDO.fetch(
      new Request(`https://do/projects/${encodeURIComponent(state.repoKey)}/credential`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: tokenData.access_token,
          username: user.login,
          userId: user.id,
          scope: tokenData.scope || 'repo',
          authenticatedAt: Date.now(),
        }),
      })
    );

    if (!storeResponse.ok) {
      return c.redirect(`${state.redirectUri}?error=store_failed&repo=${state.repoKey}`);
    }

    // Redirect back to app with success
    return c.redirect(`${state.redirectUri}?success=true&repo=${state.repoKey}&username=${user.login}`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    return c.redirect(`${state.redirectUri}?error=internal_error&repo=${state.repoKey}`);
  }
});

// All other routes require API key authentication
app.use('*', authMiddleware);

// Health check
app.get('/', (c) => c.json({ status: 'ok', service: 'craft-agent-cloud' }));

// ============================================================
// File Storage Routes (R2)
// ============================================================

// Helper to build R2 key: {workspace}/{session}/{type}/{filename}
function buildR2Key(workspace: string, session: string, type: string, filename: string): string {
  return `${workspace}/${session}/${type}/${filename}`;
}

// Upload file
app.put('/files/:workspace/:session/:type/:filename', async (c) => {
  const { workspace, session, type, filename } = c.req.param();

  if (!isValidFileType(type)) {
    return c.json({ error: `Invalid file type: ${type}. Must be one of: attachments, downloads, long_responses` }, 400);
  }

  const key = buildR2Key(workspace, session, type, filename);
  const contentType = c.req.header('Content-Type') || 'application/octet-stream';
  const body = await c.req.arrayBuffer();

  await c.env.FILES.put(key, body, {
    httpMetadata: { contentType },
    customMetadata: { uploadedAt: Date.now().toString() },
  });

  const metadata: FileMetadata = {
    name: filename,
    size: body.byteLength,
    mimeType: contentType,
    uploadedAt: Date.now(),
  };

  return c.json(metadata, 201);
});

// Download file (supports both auth header and signed URLs)
app.get('/files/:workspace/:session/:type/:filename', async (c) => {
  const { workspace, session, type, filename } = c.req.param();
  const sig = c.req.query('sig');
  const exp = c.req.query('exp');

  // If this is a signed URL request (no auth header), validate the signature
  if (sig && exp) {
    // Path must match what was used for signing (includes files/ prefix)
    const path = `files/${workspace}/${session}/${type}/${filename}`;
    const isValid = await validateSignedUrl(path, sig, exp, c.env.API_KEY);
    if (!isValid) {
      return c.json({ error: 'Invalid or expired signature' }, 403);
    }
  }
  // Otherwise, auth middleware already validated the API key

  if (!isValidFileType(type)) {
    return c.json({ error: `Invalid file type: ${type}` }, 400);
  }

  const key = buildR2Key(workspace, session, type, filename);
  const object = await c.env.FILES.get(key);

  if (!object) {
    return c.json({ error: 'File not found' }, 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Content-Length', object.size.toString());
  // Allow caching for signed URLs (they're time-limited anyway)
  headers.set('Cache-Control', 'private, max-age=3600');

  return new Response(object.body, { headers });
});

// Generate a signed URL for a file
app.post('/files/:workspace/:session/:type/:filename/sign', async (c) => {
  const { workspace, session, type, filename } = c.req.param();

  if (!isValidFileType(type)) {
    return c.json({ error: `Invalid file type: ${type}` }, 400);
  }

  const body = await c.req.json<{ expiresIn?: number }>().catch(() => ({}));
  const expiresIn = body.expiresIn || 900; // Default 15 minutes

  // Verify the file exists before generating a signed URL
  const key = buildR2Key(workspace, session, type, filename);
  const object = await c.env.FILES.head(key);
  if (!object) {
    return c.json({ error: 'File not found' }, 404);
  }

  const path = `files/${workspace}/${session}/${type}/${filename}`;
  const baseUrl = new URL(c.req.url).origin;

  const signedUrl = await generateSignedUrl(baseUrl, path, c.env.API_KEY, expiresIn);
  const expiresAt = Date.now() + expiresIn * 1000;

  return c.json({ url: signedUrl, expiresAt });
});

// Delete file
app.delete('/files/:workspace/:session/:type/:filename', async (c) => {
  const { workspace, session, type, filename } = c.req.param();

  if (!isValidFileType(type)) {
    return c.json({ error: `Invalid file type: ${type}` }, 400);
  }

  const key = buildR2Key(workspace, session, type, filename);
  await c.env.FILES.delete(key);

  return c.json({ success: true });
});

// List files in a type folder
app.get('/files/:workspace/:session/:type', async (c) => {
  const { workspace, session, type } = c.req.param();

  if (!isValidFileType(type)) {
    return c.json({ error: `Invalid file type: ${type}` }, 400);
  }

  const prefix = `${workspace}/${session}/${type}/`;
  const listed = await c.env.FILES.list({ prefix });

  const files: FileMetadata[] = listed.objects.map((obj) => ({
    name: obj.key.slice(prefix.length), // Remove prefix to get filename
    size: obj.size,
    mimeType: obj.httpMetadata?.contentType || 'application/octet-stream',
    uploadedAt: parseInt(obj.customMetadata?.uploadedAt || '0', 10) || obj.uploaded.getTime(),
  }));

  return c.json(files);
});

// Delete all files for a session (used when deleting a session)
app.delete('/files/:workspace/:session', async (c) => {
  const { workspace, session } = c.req.param();
  const prefix = `${workspace}/${session}/`;

  // List all objects with this prefix
  const listed = await c.env.FILES.list({ prefix });

  // Delete them all (R2 doesn't have bulk delete, so we do it one by one)
  await Promise.all(listed.objects.map((obj) => c.env.FILES.delete(obj.key)));

  return c.json({ success: true, deleted: listed.objects.length });
});

// ============================================================
// Sandbox API Routes (convenience wrappers for DO operations)
// ============================================================

// Check if a repo has valid GitHub credentials
app.post('/api/sandbox/check', async (c) => {
  const { workspaceSlug, repoKey, repoUrl } = await c.req.json<{
    workspaceSlug: string;
    repoKey: string;
    repoUrl: string;
  }>();

  if (!workspaceSlug || !repoKey || !repoUrl) {
    return c.json({ error: 'Missing required parameters' }, 400);
  }

  const workspaceDO = c.env.WORKSPACE.get(
    c.env.WORKSPACE.idFromName(workspaceSlug)
  );

  const response = await workspaceDO.fetch(
    new Request('https://do/projects/check-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoKey, repoUrl }),
    })
  );

  const result = await response.json<{ ready: boolean; needsAuth?: boolean }>();

  // If auth is needed, add the auth URL using request origin
  if (result.needsAuth) {
    const workerOrigin = new URL(c.req.url).origin;
    const authUrl = `${workerOrigin}/oauth/github?workspaceSlug=${encodeURIComponent(workspaceSlug)}&repoKey=${encodeURIComponent(repoKey)}&redirectUri=${encodeURIComponent('craft-agent://oauth/callback')}`;
    return c.json({ ...result, authUrl });
  }

  return c.json(result);
});

// Create a new sandbox session
// Note: Anthropic API key is sent per-WebSocket-message, not at session creation
app.post('/api/sandbox/create', async (c) => {
  const { workspaceSlug, repoKey, branch } = await c.req.json<{
    workspaceSlug: string;
    repoKey: string;
    branch: string;
  }>();

  if (!workspaceSlug || !repoKey || !branch) {
    return c.json({ error: 'Missing required parameters' }, 400);
  }

  const workspaceDO = c.env.WORKSPACE.get(
    c.env.WORKSPACE.idFromName(workspaceSlug)
  );

  // Pass the worker origin so the DO can construct WebSocket URLs
  const workerOrigin = new URL(c.req.url).origin;

  const response = await workspaceDO.fetch(
    new Request('https://do/sandbox/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoKey, branch, workerOrigin }),
    })
  );

  const result = await response.json() as Record<string, unknown>;

  // Fix up the WebSocket URL with the actual workspace slug
  if ('wsUrl' in result && typeof result.wsUrl === 'string') {
    (result as { wsUrl: string }).wsUrl = result.wsUrl.replace('SLUG', workspaceSlug);
  }

  return c.json(result);
});

// Get sandbox session status
app.get('/api/sandbox/:workspaceSlug/:sessionId/status', async (c) => {
  const { workspaceSlug, sessionId } = c.req.param();

  const workspaceDO = c.env.WORKSPACE.get(
    c.env.WORKSPACE.idFromName(workspaceSlug)
  );

  return workspaceDO.fetch(
    new Request(`https://do/sandbox/sessions/${sessionId}`, {
      method: 'GET',
    })
  );
});

// Terminate a sandbox session
app.delete('/api/sandbox/:workspaceSlug/:sessionId', async (c) => {
  const { workspaceSlug, sessionId } = c.req.param();

  const workspaceDO = c.env.WORKSPACE.get(
    c.env.WORKSPACE.idFromName(workspaceSlug)
  );

  return workspaceDO.fetch(
    new Request(`https://do/sandbox/sessions/${sessionId}`, {
      method: 'DELETE',
    })
  );
});

// Sandbox heartbeat
app.post('/api/sandbox/:workspaceSlug/:sessionId/heartbeat', async (c) => {
  const { workspaceSlug, sessionId } = c.req.param();

  const workspaceDO = c.env.WORKSPACE.get(
    c.env.WORKSPACE.idFromName(workspaceSlug)
  );

  return workspaceDO.fetch(
    new Request(`https://do/sandbox/sessions/${sessionId}/heartbeat`, {
      method: 'POST',
    })
  );
});

// ============================================================
// Workspace Asset Routes (R2) — workspace-scoped, not session-scoped
// ============================================================

// Helper to build R2 key for workspace assets: {workspace}/_assets/{path}
function buildAssetR2Key(workspace: string, path: string): string {
  return `${workspace}/_assets/${path}`;
}

// Upload asset
app.put('/assets/:workspace/*', async (c) => {
  const workspace = c.req.param('workspace');
  const path = c.req.param('*');
  if (!path) return c.json({ error: 'Missing asset path' }, 400);

  const key = buildAssetR2Key(workspace, path);
  const contentType = c.req.header('Content-Type') || 'application/octet-stream';
  const body = await c.req.arrayBuffer();

  await c.env.FILES.put(key, body, {
    httpMetadata: { contentType },
    customMetadata: { uploadedAt: Date.now().toString() },
  });

  return c.json({ name: path, size: body.byteLength, mimeType: contentType }, 201);
});

// Download asset (supports both auth header and signed URLs)
app.get('/assets/:workspace/*', async (c) => {
  const workspace = c.req.param('workspace');
  const path = c.req.param('*');
  if (!path) return c.json({ error: 'Missing asset path' }, 400);

  // Check for signed URL params
  const sig = c.req.query('sig');
  const exp = c.req.query('exp');
  if (sig && exp) {
    const signPath = `assets/${workspace}/${path}`;
    const isValid = await validateSignedUrl(signPath, sig, exp, c.env.API_KEY);
    if (!isValid) {
      return c.json({ error: 'Invalid or expired signature' }, 403);
    }
  }

  const key = buildAssetR2Key(workspace, path);
  const object = await c.env.FILES.get(key);

  if (!object) {
    return c.json({ error: 'Asset not found' }, 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Content-Length', object.size.toString());
  headers.set('Cache-Control', 'private, max-age=3600');

  return new Response(object.body, { headers });
});

// Delete asset
app.delete('/assets/:workspace/*', async (c) => {
  const workspace = c.req.param('workspace');
  const path = c.req.param('*');
  if (!path) return c.json({ error: 'Missing asset path' }, 400);

  const key = buildAssetR2Key(workspace, path);
  await c.env.FILES.delete(key);

  return c.json({ success: true });
});

// Generate signed URL for an asset
app.post('/assets/:workspace/sign/*', async (c) => {
  const workspace = c.req.param('workspace');
  const path = c.req.param('*');
  if (!path) return c.json({ error: 'Missing asset path' }, 400);

  const body = await c.req.json<{ expiresIn?: number }>().catch(() => ({} as { expiresIn?: number }));
  const expiresIn = body.expiresIn || 900;

  const key = buildAssetR2Key(workspace, path);
  const object = await c.env.FILES.head(key);
  if (!object) {
    return c.json({ error: 'Asset not found' }, 404);
  }

  const signPath = `assets/${workspace}/${path}`;
  const baseUrl = new URL(c.req.url).origin;
  const signedUrl = await generateSignedUrl(baseUrl, signPath, c.env.API_KEY, expiresIn);
  const expiresAt = Date.now() + expiresIn * 1000;

  return c.json({ url: signedUrl, expiresAt });
});

// ============================================================
// Workspace Routes (Durable Object)
// ============================================================

// Route everything under /workspace/:slug/* to the Durable Object
app.all('/workspace/:slug/*', async (c) => {
  const slug = c.req.param('slug');
  const id = c.env.WORKSPACE.idFromName(slug);
  const stub = c.env.WORKSPACE.get(id);

  // Strip /workspace/:slug prefix so the DO sees clean paths
  const url = new URL(c.req.url);
  const prefix = `/workspace/${slug}`;
  url.pathname = url.pathname.slice(prefix.length) || '/';

  // Clone request and add workspace metadata headers (for encryption key derivation)
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-Workspace-Slug', slug);
  headers.set('X-Api-Key', c.env.API_KEY);

  return stub.fetch(new Request(url.toString(), {
    method: c.req.method,
    headers,
    body: c.req.raw.body,
  }));
});

// Also support /workspace/:slug (without trailing path) for WebSocket upgrade
app.all('/workspace/:slug', async (c) => {
  const slug = c.req.param('slug');
  const id = c.env.WORKSPACE.idFromName(slug);
  const stub = c.env.WORKSPACE.get(id);

  const url = new URL(c.req.url);
  url.pathname = '/';

  return stub.fetch(new Request(url.toString(), c.req.raw));
});

export default app;
export { WorkspaceDO } from './durable-objects/workspace.ts';
// Re-export Sandbox from the SDK for the container Durable Object binding
export { Sandbox } from '@cloudflare/sandbox';
