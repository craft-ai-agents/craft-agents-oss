/**
 * Workspace Durable Object
 *
 * One instance per workspace, keyed by workspace slug via idFromName().
 * Uses SQLite storage (built into Durable Objects) for all workspace data.
 * Uses WebSocket Hibernation API for cost-effective persistent connections.
 *
 * Responsibilities:
 * - Store all workspace data (sessions, sources, statuses, labels, skills, plans)
 * - Handle WebSocket messages for real-time mutations
 * - Broadcast changes to all other connected clients
 * - Serve REST GET endpoints for bulk loading
 */

import { DurableObject } from 'cloudflare:workers';
import { getSandbox, parseSSEStream } from '@cloudflare/sandbox';
import type { Env, Project, GitHubCredential, SandboxSession, SandboxStatus } from '../types.ts';
import type { WSClientMessage, WSServerMessage, WSRemoteChangeEvent } from '@craft-agent/core/types/cloud';
import { encryptCredential, decryptCredential, deriveKeyFromApiKey } from '../utils/encryption.ts';

export class WorkspaceDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.initializeSchema();
  }

  private initializeSchema() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        header TEXT NOT NULL,
        messages TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sources (
        slug TEXT PRIMARY KEY,
        config TEXT NOT NULL,
        guide TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS statuses (
        id TEXT PRIMARY KEY DEFAULT 'config',
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS labels (
        id TEXT PRIMARY KEY DEFAULT 'config',
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS skills (
        slug TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS plans (
        session_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        content TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, file_name)
      );

      CREATE TABLE IF NOT EXISTS projects (
        repo_key TEXT PRIMARY KEY,
        repo_url TEXT NOT NULL,
        default_branch TEXT NOT NULL DEFAULT 'main',
        added_at INTEGER NOT NULL,
        github_credential TEXT
      );

      CREATE TABLE IF NOT EXISTS sandbox_sessions (
        session_id TEXT PRIMARY KEY,
        repo_key TEXT NOT NULL,
        sandbox_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'provisioning',
        created_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
  }

  // ============================================================
  // HTTP Fetch Handler (WebSocket upgrade + REST endpoints)
  // ============================================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      // Check if this is a sandbox WebSocket connection
      const sandboxWsMatch = url.pathname.match(/^\/sandbox\/ws\/([^/]+)$/);
      if (sandboxWsMatch) {
        // Get workspace metadata for encryption key derivation
        const workspaceSlug = request.headers.get('X-Workspace-Slug') || '';
        const apiKey = request.headers.get('X-Api-Key') || '';
        return this.handleSandboxWebSocket(sandboxWsMatch[1], workspaceSlug, apiKey);
      }

      // Regular workspace WebSocket (for real-time sync)
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    // REST GET endpoints for bulk loading
    if (request.method === 'GET') {
      return await this.handleRestGet(url.pathname);
    }

    // REST POST endpoints for project/sandbox operations
    if (request.method === 'POST') {
      return this.handleRestPost(url.pathname, request);
    }

    // REST DELETE endpoints
    if (request.method === 'DELETE') {
      return this.handleRestDelete(url.pathname);
    }

    return new Response('Not Found', { status: 404 });
  }

  private async handleRestGet(pathname: string): Promise<Response> {
    // GET /sessions — list all session headers
    if (pathname === '/sessions' || pathname === '/sessions/') {
      const rows = this.sql.exec('SELECT header FROM sessions ORDER BY updated_at DESC').toArray();
      return Response.json(rows.map(r => JSON.parse(r.header as string)));
    }

    // GET /sessions/:id — load full session (header + messages)
    const sessionMatch = pathname.match(/^\/sessions\/([^/]+)$/);
    if (sessionMatch) {
      const row = this.sql.exec('SELECT header, messages FROM sessions WHERE id = ?', sessionMatch[1]).toArray()[0];
      if (!row) return new Response('Not Found', { status: 404 });
      return Response.json({
        ...JSON.parse(row.header as string),
        messages: JSON.parse((row.messages as string) ?? '[]'),
      });
    }

    // GET /sources — list all sources
    if (pathname === '/sources' || pathname === '/sources/') {
      const rows = this.sql.exec('SELECT config FROM sources ORDER BY updated_at DESC').toArray();
      return Response.json(rows.map(r => JSON.parse(r.config as string)));
    }

    // GET /sources/:slug — load single source with guide
    const sourceMatch = pathname.match(/^\/sources\/([^/]+)$/);
    if (sourceMatch) {
      const row = this.sql.exec('SELECT config, guide FROM sources WHERE slug = ?', sourceMatch[1]).toArray()[0];
      if (!row) return new Response('Not Found', { status: 404 });
      return Response.json({
        config: JSON.parse(row.config as string),
        guide: row.guide ? JSON.parse(row.guide as string) : null,
      });
    }

    // GET /statuses
    if (pathname === '/statuses' || pathname === '/statuses/') {
      const row = this.sql.exec("SELECT data FROM statuses WHERE id = 'config'").toArray()[0];
      return Response.json(row ? JSON.parse(row.data as string) : { version: 1, statuses: [], defaultStatusId: 'todo' });
    }

    // GET /labels
    if (pathname === '/labels' || pathname === '/labels/') {
      const row = this.sql.exec("SELECT data FROM labels WHERE id = 'config'").toArray()[0];
      return Response.json(row ? JSON.parse(row.data as string) : { version: 1, labels: [] });
    }

    // GET /skills
    if (pathname === '/skills' || pathname === '/skills/') {
      const rows = this.sql.exec('SELECT slug, content, metadata FROM skills ORDER BY updated_at DESC').toArray();
      return Response.json(rows.map(r => ({
        slug: r.slug,
        content: r.content,
        metadata: r.metadata ? JSON.parse(r.metadata as string) : null,
      })));
    }

    // GET /sessions/:id/plans — list plans for a session
    const plansMatch = pathname.match(/^\/sessions\/([^/]+)\/plans$/);
    if (plansMatch) {
      const rows = this.sql.exec(
        'SELECT file_name, updated_at FROM plans WHERE session_id = ? ORDER BY updated_at DESC',
        plansMatch[1]
      ).toArray();
      return Response.json(rows.map(r => ({
        name: r.file_name,
        modifiedAt: r.updated_at,
      })));
    }

    // GET /sessions/:id/plans/:fileName — load a specific plan
    const planMatch = pathname.match(/^\/sessions\/([^/]+)\/plans\/([^/]+)$/);
    if (planMatch) {
      const row = this.sql.exec(
        'SELECT content FROM plans WHERE session_id = ? AND file_name = ?',
        planMatch[1], planMatch[2]
      ).toArray()[0];
      if (!row) return new Response('Not Found', { status: 404 });
      return new Response(row.content as string, { headers: { 'Content-Type': 'text/markdown' } });
    }

    // GET /projects — list all projects
    if (pathname === '/projects' || pathname === '/projects/') {
      const rows = this.sql.exec('SELECT repo_key, repo_url, default_branch, added_at, github_credential FROM projects ORDER BY added_at DESC').toArray();
      const projects = rows.map(r => ({
        repoKey: r.repo_key,
        repoUrl: r.repo_url,
        defaultBranch: r.default_branch,
        addedAt: r.added_at,
        // Only return whether auth exists, not the credential itself
        hasGitHubAuth: !!r.github_credential,
      }));
      return Response.json(projects);
    }

    // GET /projects/:repoKey — get single project (repoKey is owner/repo, URL-encoded)
    const projectMatch = pathname.match(/^\/projects\/(.+)$/);
    if (projectMatch) {
      const repoKey = decodeURIComponent(projectMatch[1]);
      const row = this.sql.exec(
        'SELECT repo_key, repo_url, default_branch, added_at, github_credential FROM projects WHERE repo_key = ?',
        repoKey
      ).toArray()[0];
      if (!row) return new Response('Not Found', { status: 404 });

      // Decrypt and return GitHub credential info (but not the token)
      let githubInfo = null;
      if (row.github_credential) {
        try {
          const decrypted = await decryptCredential(row.github_credential as string, this.env.ENCRYPTION_KEY);
          const cred = JSON.parse(decrypted);
          githubInfo = {
            username: cred.username,
            userId: cred.userId,
            scope: cred.scope,
            authenticatedAt: cred.authenticatedAt,
          };
        } catch {
          // Decryption failed, credential is invalid
        }
      }

      return Response.json({
        repoKey: row.repo_key,
        repoUrl: row.repo_url,
        defaultBranch: row.default_branch,
        addedAt: row.added_at,
        github: githubInfo,
      });
    }

    // GET /sandbox/sessions — list all sandbox sessions
    if (pathname === '/sandbox/sessions' || pathname === '/sandbox/sessions/') {
      const rows = this.sql.exec(
        'SELECT session_id, repo_key, sandbox_id, branch, status, created_at, last_activity_at, expires_at FROM sandbox_sessions ORDER BY created_at DESC'
      ).toArray();
      return Response.json(rows.map(r => ({
        sessionId: r.session_id,
        repoKey: r.repo_key,
        sandboxId: r.sandbox_id,
        branch: r.branch,
        status: r.status,
        createdAt: r.created_at,
        lastActivityAt: r.last_activity_at,
        expiresAt: r.expires_at,
      })));
    }

    // GET /sandbox/sessions/:sessionId — get single sandbox session
    const sandboxMatch = pathname.match(/^\/sandbox\/sessions\/([^/]+)$/);
    if (sandboxMatch) {
      const row = this.sql.exec(
        'SELECT session_id, repo_key, sandbox_id, branch, status, created_at, last_activity_at, expires_at FROM sandbox_sessions WHERE session_id = ?',
        sandboxMatch[1]
      ).toArray()[0];
      if (!row) return new Response('Not Found', { status: 404 });
      return Response.json({
        sessionId: row.session_id,
        repoKey: row.repo_key,
        sandboxId: row.sandbox_id,
        branch: row.branch,
        status: row.status,
        createdAt: row.created_at,
        lastActivityAt: row.last_activity_at,
        expiresAt: row.expires_at,
      });
    }

    return new Response('Not Found', { status: 404 });
  }

  // ============================================================
  // REST POST Handler (Projects & Sandbox)
  // ============================================================

  private async handleRestPost(pathname: string, request: Request): Promise<Response> {
    // POST /projects/check-auth — check if repo has valid credentials
    if (pathname === '/projects/check-auth') {
      const { repoKey, repoUrl } = await request.json<{ repoKey: string; repoUrl: string }>();
      const result = await this.checkProjectAuth(repoKey, repoUrl);
      return Response.json(result);
    }

    // POST /projects/:repoKey/credential — store GitHub credential (called from OAuth callback)
    const credMatch = pathname.match(/^\/projects\/(.+)\/credential$/);
    if (credMatch) {
      const repoKey = decodeURIComponent(credMatch[1]);
      const credential = await request.json<GitHubCredential>();
      await this.storeGitHubCredential(repoKey, credential);
      return Response.json({ success: true });
    }

    // POST /sandbox/create — create a new sandbox session
    if (pathname === '/sandbox/create') {
      const { repoKey, branch, workerOrigin } = await request.json<{ repoKey: string; branch: string; workerOrigin: string }>();
      const result = await this.createSandboxSession(repoKey, branch, workerOrigin);
      return Response.json(result);
    }

    // POST /sandbox/sessions/:sessionId/heartbeat — update activity timestamp
    const heartbeatMatch = pathname.match(/^\/sandbox\/sessions\/([^/]+)\/heartbeat$/);
    if (heartbeatMatch) {
      await this.sandboxHeartbeat(heartbeatMatch[1]);
      return Response.json({ success: true });
    }

    // ============================================================
    // Deep Link Action Routes (REST parity for craftagents:// actions)
    // ============================================================

    // POST /actions/new-chat — create a new session
    if (pathname === '/actions/new-chat') {
      const body = await request.json<{ name?: string; input?: string; send?: boolean }>().catch(() => ({} as { name?: string; input?: string; send?: boolean }));
      const now = Date.now();
      const id = crypto.randomUUID();
      const header: Record<string, unknown> = {
        id,
        createdAt: now,
        lastUsedAt: now,
        messageCount: 0,
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
      };
      if (body.name) header.name = body.name;
      if (body.input) header.preview = body.input;

      this.sql.exec(
        'INSERT INTO sessions (id, header, messages, updated_at) VALUES (?, ?, ?, ?)',
        id, JSON.stringify(header), '[]', now,
      );

      this.broadcastToAll({ entity: 'session', action: 'created', data: header });
      return Response.json(header, { status: 201 });
    }

    // POST /actions/flag-session — flag a session
    if (pathname === '/actions/flag-session') {
      const { sessionId } = await request.json<{ sessionId: string }>();
      if (!sessionId) return Response.json({ error: 'Missing sessionId' }, { status: 400 });

      const existing = this.sql.exec('SELECT header FROM sessions WHERE id = ?', sessionId).toArray()[0];
      if (!existing) return Response.json({ error: 'Session not found' }, { status: 404 });

      const header = { ...JSON.parse(existing.header as string), isFlagged: true };
      this.sql.exec('UPDATE sessions SET header = ?, updated_at = ? WHERE id = ?', JSON.stringify(header), Date.now(), sessionId);

      this.broadcastToAll({ entity: 'session', action: 'updated', data: header });
      return Response.json(header);
    }

    // POST /actions/unflag-session — unflag a session
    if (pathname === '/actions/unflag-session') {
      const { sessionId } = await request.json<{ sessionId: string }>();
      if (!sessionId) return Response.json({ error: 'Missing sessionId' }, { status: 400 });

      const existing = this.sql.exec('SELECT header FROM sessions WHERE id = ?', sessionId).toArray()[0];
      if (!existing) return Response.json({ error: 'Session not found' }, { status: 404 });

      const header = { ...JSON.parse(existing.header as string), isFlagged: false };
      this.sql.exec('UPDATE sessions SET header = ?, updated_at = ? WHERE id = ?', JSON.stringify(header), Date.now(), sessionId);

      this.broadcastToAll({ entity: 'session', action: 'updated', data: header });
      return Response.json(header);
    }

    // POST /actions/rename-session — rename a session
    if (pathname === '/actions/rename-session') {
      const { sessionId, name } = await request.json<{ sessionId: string; name: string }>();
      if (!sessionId || !name) return Response.json({ error: 'Missing sessionId or name' }, { status: 400 });

      const existing = this.sql.exec('SELECT header FROM sessions WHERE id = ?', sessionId).toArray()[0];
      if (!existing) return Response.json({ error: 'Session not found' }, { status: 404 });

      const header = { ...JSON.parse(existing.header as string), name };
      this.sql.exec('UPDATE sessions SET header = ?, updated_at = ? WHERE id = ?', JSON.stringify(header), Date.now(), sessionId);

      this.broadcastToAll({ entity: 'session', action: 'updated', data: header });
      return Response.json(header);
    }

    // POST /actions/delete-session — delete a session
    if (pathname === '/actions/delete-session') {
      const { sessionId } = await request.json<{ sessionId: string }>();
      if (!sessionId) return Response.json({ error: 'Missing sessionId' }, { status: 400 });

      this.sql.exec('DELETE FROM sessions WHERE id = ?', sessionId);
      this.sql.exec('DELETE FROM plans WHERE session_id = ?', sessionId);

      this.broadcastToAll({ entity: 'session', action: 'deleted', data: { id: sessionId, sessionId } });
      return Response.json({ success: true });
    }

    return new Response('Not Found', { status: 404 });
  }

  // ============================================================
  // REST DELETE Handler
  // ============================================================

  private async handleRestDelete(pathname: string): Promise<Response> {
    // DELETE /projects/:repoKey/credential — revoke GitHub credential
    const credMatch = pathname.match(/^\/projects\/(.+)\/credential$/);
    if (credMatch) {
      const repoKey = decodeURIComponent(credMatch[1]);
      await this.revokeGitHubCredential(repoKey);
      return Response.json({ success: true });
    }

    // DELETE /sandbox/sessions/:sessionId — terminate a sandbox session
    const sandboxMatch = pathname.match(/^\/sandbox\/sessions\/([^/]+)$/);
    if (sandboxMatch) {
      await this.terminateSandboxSession(sandboxMatch[1]);
      return Response.json({ success: true });
    }

    return new Response('Not Found', { status: 404 });
  }

  // ============================================================
  // Project & Credential Management
  // ============================================================

  private async checkProjectAuth(repoKey: string, repoUrl: string): Promise<{ ready: boolean; needsAuth?: boolean; authUrl?: string }> {
    // Check if project exists
    let row = this.sql.exec(
      'SELECT github_credential FROM projects WHERE repo_key = ?',
      repoKey
    ).toArray()[0];

    // If project doesn't exist, create it
    if (!row) {
      this.sql.exec(
        'INSERT INTO projects (repo_key, repo_url, default_branch, added_at) VALUES (?, ?, ?, ?)',
        repoKey,
        repoUrl,
        'main',
        Date.now()
      );
      row = { github_credential: null };
    }

    // Check if we have a valid credential
    if (row.github_credential) {
      try {
        const decrypted = await decryptCredential(row.github_credential as string, this.env.ENCRYPTION_KEY);
        const cred = JSON.parse(decrypted);
        // Check if token is expired (if expiresAt is set)
        if (!cred.expiresAt || cred.expiresAt > Date.now()) {
          return { ready: true };
        }
      } catch {
        // Decryption failed, credential is invalid
      }
    }

    // Need auth - return auth URL
    // Note: workspaceSlug will be added by the main worker route
    return {
      ready: false,
      needsAuth: true,
    };
  }

  async storeGitHubCredential(repoKey: string, credential: GitHubCredential): Promise<void> {
    // Encrypt the credential before storing
    const encrypted = await encryptCredential(JSON.stringify(credential), this.env.ENCRYPTION_KEY);

    // Ensure project exists
    const existing = this.sql.exec('SELECT 1 FROM projects WHERE repo_key = ?', repoKey).toArray()[0];
    if (existing) {
      this.sql.exec(
        'UPDATE projects SET github_credential = ? WHERE repo_key = ?',
        encrypted,
        repoKey
      );
    } else {
      this.sql.exec(
        'INSERT INTO projects (repo_key, repo_url, default_branch, added_at, github_credential) VALUES (?, ?, ?, ?, ?)',
        repoKey,
        `https://github.com/${repoKey}.git`,
        'main',
        Date.now(),
        encrypted
      );
    }
  }

  async revokeGitHubCredential(repoKey: string): Promise<void> {
    this.sql.exec(
      'UPDATE projects SET github_credential = NULL WHERE repo_key = ?',
      repoKey
    );
  }

  async getDecryptedCredential(repoKey: string): Promise<GitHubCredential | null> {
    const row = this.sql.exec(
      'SELECT github_credential FROM projects WHERE repo_key = ?',
      repoKey
    ).toArray()[0];

    if (!row?.github_credential) return null;

    try {
      const decrypted = await decryptCredential(row.github_credential as string, this.env.ENCRYPTION_KEY);
      return JSON.parse(decrypted);
    } catch {
      return null;
    }
  }

  // ============================================================
  // Sandbox Session Management
  // ============================================================

  private async createSandboxSession(repoKey: string, branch: string, workerOrigin: string): Promise<{ sessionId: string; sandboxId: string; wsUrl: string } | { error: string }> {
    // Check if we have credentials for this repo
    const credential = await this.getDecryptedCredential(repoKey);
    if (!credential) {
      return { error: 'No GitHub credentials for this repo' };
    }

    const sessionId = crypto.randomUUID();
    const sandboxId = sessionId.slice(0, 8);
    const now = Date.now();
    const expiresAt = now + 30 * 60 * 1000; // 30 min idle timeout

    // Insert session as 'provisioning' first
    // Note: Anthropic API key is NOT stored - each WebSocket message must include its own key
    this.sql.exec(
      `INSERT INTO sandbox_sessions (session_id, repo_key, sandbox_id, branch, status, created_at, last_activity_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      sessionId,
      repoKey,
      sandboxId,
      branch,
      'provisioning' as SandboxStatus,
      now,
      now,
      expiresAt
    );

    try {
      // Get sandbox instance from the Sandbox Durable Object
      const sandbox = getSandbox(this.env.Sandbox, sandboxId);

      // Update status to 'cloning'
      this.sql.exec(
        "UPDATE sandbox_sessions SET status = 'cloning' WHERE session_id = ?",
        sessionId
      );

      // Clone the repo using the GitHub token for authentication
      // Use HTTPS URL with embedded token for private repos
      // Use absolute path /workspace to avoid nesting issues
      const repoUrlWithAuth = `https://${credential.accessToken}@github.com/${repoKey}.git`;
      await sandbox.gitCheckout(repoUrlWithAuth, { targetDir: '/workspace' });

      // Checkout the specified branch if not main
      if (branch && branch !== 'main' && branch !== 'master') {
        await sandbox.exec(`cd /workspace && git checkout ${branch}`);
      }

      // Update status to 'ready'
      this.sql.exec(
        "UPDATE sandbox_sessions SET status = 'ready' WHERE session_id = ?",
        sessionId
      );

      // Set alarm for idle cleanup
      await this.ctx.storage.setAlarm(now + 60_000);

      return {
        sessionId,
        sandboxId,
        wsUrl: `wss://${workerOrigin.replace('https://', '')}/workspace/SLUG/sandbox/ws/${sessionId}`,
      };
    } catch (err) {
      // Update status to indicate failure
      this.sql.exec(
        "UPDATE sandbox_sessions SET status = 'expired' WHERE session_id = ?",
        sessionId
      );
      const errorMessage = err instanceof Error ? err.message : 'Unknown error spawning sandbox';
      return { error: errorMessage };
    }
  }

  private async sandboxHeartbeat(sessionId: string): Promise<void> {
    const now = Date.now();
    const expiresAt = now + 30 * 60 * 1000;

    this.sql.exec(
      'UPDATE sandbox_sessions SET last_activity_at = ?, expires_at = ?, status = ? WHERE session_id = ?',
      now,
      expiresAt,
      'ready' as SandboxStatus,
      sessionId
    );
  }

  private async terminateSandboxSession(sessionId: string): Promise<void> {
    // Get the sandbox info first
    const row = this.sql.exec(
      'SELECT sandbox_id FROM sandbox_sessions WHERE session_id = ?',
      sessionId
    ).toArray()[0];

    if (row?.sandbox_id) {
      try {
        // Get the sandbox instance and destroy it
        const sandbox = getSandbox(this.env.Sandbox, row.sandbox_id as string);
        await sandbox.destroy();
      } catch {
        // Sandbox may already be destroyed or not exist
      }
    }

    this.sql.exec('DELETE FROM sandbox_sessions WHERE session_id = ?', sessionId);
  }

  // ============================================================
  // Sandbox WebSocket Handler
  // ============================================================

  private handleSandboxWebSocket(sessionId: string, workspaceSlug: string, apiKey: string): Response {
    // Look up the sandbox session
    const row = this.sql.exec(
      "SELECT sandbox_id, status FROM sandbox_sessions WHERE session_id = ?",
      sessionId
    ).toArray()[0];

    if (!row) {
      return new Response('Sandbox session not found', { status: 404 });
    }

    if (row.status === 'expired') {
      return new Response('Sandbox session has expired', { status: 410 });
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();

    // Accept the server-side WebSocket with custom tags for identification
    // Include workspaceSlug and apiKey for encryption key derivation
    this.ctx.acceptWebSocket(pair[1], [
      'sandbox',
      sessionId,
      row.sandbox_id as string,
      workspaceSlug,
      apiKey,
    ]);

    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /**
   * Handle incoming WebSocket messages for sandbox sessions.
   * Executes Claude Code commands and returns results.
   * Each message must include the user's anthropicApiKey (encrypted) for billing isolation.
   * The key should be encrypted with deriveKeyFromApiKey(workspaceApiKey, workspaceSlug).
   */
  private async handleSandboxMessage(
    ws: WebSocket,
    sandboxId: string,
    sessionId: string,
    workspaceSlug: string,
    workspaceApiKey: string,
    message: string
  ): Promise<void> {
    console.log(`[SANDBOX-MSG] ====== handleSandboxMessage start ======`);
    console.log(`[SANDBOX-MSG] sandboxId=${sandboxId}, sessionId=${sessionId}, workspaceSlug=${workspaceSlug}`);
    console.log(`[SANDBOX-MSG] workspaceApiKey present: ${workspaceApiKey ? 'YES' : 'NO'}`);

    try {
      const data = JSON.parse(message) as {
        type: string;
        task?: string;
        prompt?: string;
        anthropicApiKey?: string; // Encrypted with derived key
        tokenType?: 'api_key' | 'oauth'; // Determines which env var to use
      };

      console.log(`[SANDBOX-MSG] Message type: ${data.type}`);
      console.log(`[SANDBOX-MSG] Has anthropicApiKey: ${data.anthropicApiKey ? 'YES' : 'NO'}`);
      console.log(`[SANDBOX-MSG] Token type: ${data.tokenType || 'not specified'}`);
      if (data.anthropicApiKey) {
        console.log(`[SANDBOX-MSG] anthropicApiKey preview: ${data.anthropicApiKey.substring(0, 20)}...`);
      }

      // Update activity timestamp
      await this.sandboxHeartbeat(sessionId);
      console.log(`[SANDBOX-MSG] Heartbeat updated`);

      if (data.type === 'execute' && (data.task || data.prompt)) {
        const task = data.task || data.prompt || '';
        const context = (data as { context?: string }).context || '';
        const encryptedKey = data.anthropicApiKey;

        if (!encryptedKey) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'anthropicApiKey is required for execute requests',
          }));
          return;
        }

        // Decrypt the Anthropic API key
        // Key derivation: PBKDF2(workspaceApiKey, salt="craft-agent-sandbox:{workspaceSlug}")
        let anthropicApiKey: string;
        try {
          const derivedKey = await deriveKeyFromApiKey(workspaceApiKey, workspaceSlug);
          anthropicApiKey = await decryptCredential(encryptedKey, derivedKey);
        } catch (decryptError) {
          // If decryption fails, check if it's already plaintext (for backwards compat)
          if (encryptedKey.startsWith('sk-')) {
            anthropicApiKey = encryptedKey;
          } else {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Failed to decrypt anthropicApiKey. Ensure it is encrypted with the correct key.',
            }));
            return;
          }
        }

        // Get the sandbox instance
        const sandbox = getSandbox(this.env.Sandbox, sandboxId);

        // Set the appropriate env var based on token type
        // OAuth tokens use CLAUDE_CODE_OAUTH_TOKEN, API keys use ANTHROPIC_API_KEY
        const tokenType = (data as { tokenType?: string }).tokenType;
        const envVars: Record<string, string> = {};
        if (tokenType === 'oauth') {
          console.log(`[SANDBOX] Setting CLAUDE_CODE_OAUTH_TOKEN for OAuth token`);
          envVars.CLAUDE_CODE_OAUTH_TOKEN = anthropicApiKey;
        } else {
          console.log(`[SANDBOX] Setting ANTHROPIC_API_KEY for API key`);
          envVars.ANTHROPIC_API_KEY = anthropicApiKey;
        }
        await sandbox.setEnvVars(envVars);

        // Execute Claude Code with streaming output
        // The prompt includes context (conversation history) if provided
        const systemPrompt =
          'You are working in a sandboxed environment. The repository has been cloned to /workspace. ' +
          'Apply changes as needed but DO NOT commit them - the changes will be synced back to the user.';

        const fullPrompt = context ? `${context}\nHuman: ${task}` : task;
        const escapedPrompt = fullPrompt.replace(/"/g, '\\"').replace(/\n/g, '\\n');
        // Repo is cloned to /workspace via gitCheckout
        // --verbose is required when using --output-format stream-json with -p
        const cmd = `cd /workspace && claude --append-system-prompt "${systemPrompt}" -p "${escapedPrompt}" --output-format stream-json --verbose --permission-mode acceptEdits`;

        console.log(`[SANDBOX] Starting streaming execution: ${cmd.substring(0, 100)}...`);

        try {
          // Use streaming execution to send events in real-time
          console.log(`[SANDBOX] Calling execStream...`);
          const stream = await sandbox.execStream(cmd, {
            timeout: 300000, // 5 minute timeout
          });
          console.log(`[SANDBOX] Got stream, starting to parse SSE events...`);

          let eventCount = 0;
          // Parse SSE stream and forward events to WebSocket
          for await (const event of parseSSEStream(stream)) {
            eventCount++;
            console.log(`[SANDBOX] SSE event #${eventCount}: type=${event.type}, data length=${event.data?.length || 0}`);

            switch (event.type) {
              case 'stdout':
                // Each line from stdout is a JSON event from Claude Code
                // Split by newlines and send each as a stream message
                const lines = (event.data || '').split('\n').filter((line: string) => line.trim());
                console.log(`[SANDBOX] stdout: ${lines.length} lines`);
                for (const line of lines) {
                  // Log full content for result/error events to see errors
                  if (line.includes('"result"') || line.includes('"error"') || line.includes('is_error')) {
                    console.log(`[SANDBOX] FULL RESULT/ERROR LINE: ${line}`);
                  } else {
                    console.log(`[SANDBOX] Sending stream line: ${line.substring(0, 100)}...`);
                  }
                  ws.send(JSON.stringify({
                    type: 'stream',
                    data: line,
                  }));
                }
                break;

              case 'stderr':
                // Log stderr but don't fail - it may be warnings
                console.log(`[SANDBOX] stderr: ${event.data}`);
                break;

              case 'complete':
                console.log(`[SANDBOX] Execution complete, exit code: ${event.exitCode}`);
                ws.send(JSON.stringify({
                  type: 'complete',
                  exitCode: event.exitCode,
                }));
                break;

              case 'error':
                console.error(`[SANDBOX] Execution error: ${event.error}`);
                ws.send(JSON.stringify({
                  type: 'error',
                  message: event.error || 'Execution failed',
                }));
                break;

              default:
                console.log(`[SANDBOX] Unknown event type: ${event.type}, data: ${JSON.stringify(event).substring(0, 200)}`);
            }
          }
          console.log(`[SANDBOX] Stream finished, total events: ${eventCount}`);
        } catch (execError) {
          console.error(`[SANDBOX] execStream error:`, execError);
          ws.send(JSON.stringify({
            type: 'error',
            message: execError instanceof Error ? execError.message : 'Execution failed',
          }));
        }
      } else if (data.type === 'tool') {
        // Tool-level execution - routes individual tool calls to sandbox
        console.log(`[SANDBOX-MSG] Processing tool request...`);
        const toolData = data as {
          type: 'tool';
          id: string;
          name: string;
          input: Record<string, unknown>;
          anthropicApiKey: string;
        };

        console.log(`[SANDBOX-MSG] Tool: id=${toolData.id}, name=${toolData.name}`);
        console.log(`[SANDBOX-MSG] Tool input: ${JSON.stringify(toolData.input).substring(0, 200)}`);

        if (!toolData.id || !toolData.name || !toolData.input) {
          console.log(`[SANDBOX-MSG] ERROR: Missing tool fields`);
          ws.send(JSON.stringify({
            type: 'error',
            id: toolData.id,
            error: 'Tool request requires id, name, and input',
          }));
          return;
        }

        // Get the sandbox instance
        console.log(`[SANDBOX-MSG] Getting sandbox instance: ${sandboxId}`);
        const sandbox = getSandbox(this.env.Sandbox, sandboxId);

        try {
          console.log(`[SANDBOX-MSG] Executing tool ${toolData.name}...`);
          const result = await this.executeTool(sandbox, toolData.name, toolData.input);
          console.log(`[SANDBOX-MSG] Tool result: success=${result.success}`);
          ws.send(JSON.stringify({
            type: 'tool_result',
            id: toolData.id,
            ...result,
          }));
        } catch (toolErr) {
          console.log(`[SANDBOX-MSG] Tool error: ${toolErr instanceof Error ? toolErr.message : 'Unknown'}`);
          ws.send(JSON.stringify({
            type: 'tool_result',
            id: toolData.id,
            success: false,
            error: toolErr instanceof Error ? toolErr.message : 'Tool execution failed',
          }));
        }
      } else if (data.type === 'heartbeat') {
        ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
      } else if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      } else {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Unknown message type. Expected: execute, tool, ping, heartbeat',
        }));
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.log(`[SANDBOX-MSG] ====== ERROR in handleSandboxMessage: ${errorMessage} ======`);
      console.log(`[SANDBOX-MSG] Error stack: ${err instanceof Error ? err.stack : 'N/A'}`);
      ws.send(JSON.stringify({
        type: 'error',
        message: errorMessage,
      }));
    }
  }

  /**
   * Execute a single tool in the sandbox environment.
   * Supports: Bash, Read, Write, Edit, Glob, Grep
   */
  private async executeTool(
    sandbox: Sandbox,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<{ success: boolean; output?: string; error?: string; exitCode?: number }> {
    // All file operations are relative to /workspace (where repo is cloned)
    const workdir = '/workspace';

    switch (toolName) {
      case 'Bash': {
        const command = input.command as string;
        const timeout = (input.timeout as number) || 120000;
        const result = await sandbox.exec(`cd ${workdir} && ${command}`, {
          timeout: Math.min(timeout, 600000), // Max 10 minutes
        });
        return {
          success: result.success,
          output: result.success ? result.stdout : result.stderr,
          exitCode: result.exitCode,
        };
      }

      case 'Read': {
        const filePath = input.file_path as string;
        const offset = input.offset as number | undefined;
        const limit = input.limit as number | undefined;

        // Resolve path relative to workspace
        const fullPath = filePath.startsWith('/') ? filePath : `${workdir}/${filePath}`;

        // Use cat with optional head/tail for offset/limit
        let cmd = `cat -n "${fullPath}"`;
        if (offset !== undefined && limit !== undefined) {
          cmd = `cat -n "${fullPath}" | tail -n +${offset + 1} | head -n ${limit}`;
        } else if (offset !== undefined) {
          cmd = `cat -n "${fullPath}" | tail -n +${offset + 1}`;
        } else if (limit !== undefined) {
          cmd = `cat -n "${fullPath}" | head -n ${limit}`;
        }

        const result = await sandbox.exec(cmd);
        return {
          success: result.success,
          output: result.success ? result.stdout : result.stderr,
        };
      }

      case 'Write': {
        const filePath = input.file_path as string;
        const content = input.content as string;

        const fullPath = filePath.startsWith('/') ? filePath : `${workdir}/${filePath}`;

        // Write content using heredoc
        const escapedContent = content.replace(/'/g, "'\\''");
        const result = await sandbox.exec(`cat > "${fullPath}" << 'SANDBOX_EOF'\n${content}\nSANDBOX_EOF`);
        return {
          success: result.success,
          output: result.success ? `File written: ${fullPath}` : result.stderr,
        };
      }

      case 'Edit': {
        const filePath = input.file_path as string;
        const oldString = input.old_string as string;
        const newString = input.new_string as string;
        const replaceAll = input.replace_all as boolean | undefined;

        const fullPath = filePath.startsWith('/') ? filePath : `${workdir}/${filePath}`;

        // Read the file
        const readResult = await sandbox.exec(`cat "${fullPath}"`);
        if (!readResult.success) {
          return { success: false, error: `Failed to read file: ${readResult.stderr}` };
        }

        let content = readResult.stdout;

        // Check if old_string exists
        if (!content.includes(oldString)) {
          return { success: false, error: `old_string not found in file` };
        }

        // Perform replacement
        if (replaceAll) {
          content = content.split(oldString).join(newString);
        } else {
          content = content.replace(oldString, newString);
        }

        // Write back
        const writeResult = await sandbox.exec(`cat > "${fullPath}" << 'SANDBOX_EOF'\n${content}\nSANDBOX_EOF`);
        return {
          success: writeResult.success,
          output: writeResult.success ? `File edited: ${fullPath}` : writeResult.stderr,
        };
      }

      case 'Glob': {
        const pattern = input.pattern as string;
        const path = (input.path as string) || workdir;

        const fullPath = path.startsWith('/') ? path : `${workdir}/${path}`;
        const result = await sandbox.exec(`find "${fullPath}" -name "${pattern}" -type f 2>/dev/null | sort`);
        return {
          success: result.success,
          output: result.success ? result.stdout : result.stderr,
        };
      }

      case 'Grep': {
        const pattern = input.pattern as string;
        const path = (input.path as string) || workdir;
        const outputMode = (input.output_mode as string) || 'files_with_matches';

        const fullPath = path.startsWith('/') ? path : `${workdir}/${path}`;

        let flags = '-r';
        if (outputMode === 'files_with_matches') flags += ' -l';
        if (input['-i']) flags += ' -i';
        if (input['-n'] !== false && outputMode === 'content') flags += ' -n';

        const result = await sandbox.exec(`grep ${flags} "${pattern}" "${fullPath}" 2>/dev/null || true`);
        return {
          success: true, // grep returns 1 when no matches, but that's not an error
          output: result.stdout,
        };
      }

      default:
        return {
          success: false,
          error: `Unsupported tool: ${toolName}. Supported: Bash, Read, Write, Edit, Glob, Grep`,
        };
    }
  }

  // ============================================================
  // Alarm Handler (Idle Session Cleanup)
  // ============================================================

  async alarm(): Promise<void> {
    const now = Date.now();

    // Find and terminate expired sessions
    const expired = this.sql.exec(
      "SELECT session_id, sandbox_id FROM sandbox_sessions WHERE expires_at < ? AND status != 'expired'",
      now
    ).toArray();

    for (const row of expired) {
      // Actually terminate the sandbox
      if (row.sandbox_id) {
        try {
          const sandbox = getSandbox(this.env.Sandbox, row.sandbox_id as string);
          await sandbox.destroy();
        } catch {
          // Sandbox may already be destroyed
        }
      }
      this.sql.exec(
        "UPDATE sandbox_sessions SET status = 'expired' WHERE session_id = ?",
        row.session_id
      );
    }

    // Clean up sessions that have been expired for more than 5 minutes
    this.sql.exec(
      "DELETE FROM sandbox_sessions WHERE status = 'expired' AND expires_at < ?",
      now - 5 * 60 * 1000
    );

    // Reschedule alarm if there are still active sessions
    const activeSessions = this.sql.exec(
      "SELECT COUNT(*) as count FROM sandbox_sessions WHERE status NOT IN ('expired')"
    ).toArray()[0];

    if ((activeSessions?.count as number) > 0) {
      await this.ctx.storage.setAlarm(now + 60_000);
    }
  }

  // ============================================================
  // WebSocket Hibernation API Handlers
  // ============================================================

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;

    // Check if this is a sandbox WebSocket connection
    const tags = this.ctx.getTags(ws);
    console.log(`[WS] webSocketMessage received, tags: ${JSON.stringify(tags)}`);
    if (tags.length >= 5 && tags[0] === 'sandbox') {
      const sessionId = tags[1];
      const sandboxId = tags[2];
      const workspaceSlug = tags[3];
      const apiKey = tags[4];
      console.log(`[WS] Sandbox message for session=${sessionId}, sandbox=${sandboxId}, workspace=${workspaceSlug}`);
      console.log(`[WS] Message preview: ${message.substring(0, 200)}...`);
      await this.handleSandboxMessage(ws, sandboxId, sessionId, workspaceSlug, apiKey, message);
      return;
    }

    // Regular workspace sync WebSocket message
    let msg: WSClientMessage;
    try {
      msg = JSON.parse(message);
    } catch {
      ws.send(JSON.stringify({ type: 'response', requestId: 'unknown', error: 'Invalid JSON' }));
      return;
    }

    try {
      const result = await this.handleMessage(msg);
      const response: WSServerMessage = { type: 'response', requestId: msg.requestId, data: result };
      ws.send(JSON.stringify(response));

      // Broadcast to all OTHER connected clients (pass result so computed fields like timestamps are included)
      const changeEvent = this.toChangeEvent(msg, result);
      if (changeEvent) {
        this.broadcast(ws, { type: 'broadcast', event: changeEvent });
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      ws.send(JSON.stringify({ type: 'response', requestId: msg.requestId, error: errorMessage }));
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    // WebSocket closed — hibernation API handles cleanup automatically
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    ws.close(1011, 'WebSocket error');
  }

  // ============================================================
  // Message Handling (CRUD operations)
  // ============================================================

  private async handleMessage(msg: WSClientMessage): Promise<unknown> {
    switch (msg.type) {
      // --- Sessions ---
      case 'session:create': {
        const now = Date.now();
        const header = { ...msg.data, createdAt: now, lastUsedAt: now };
        this.sql.exec(
          'INSERT INTO sessions (id, header, messages, updated_at) VALUES (?, ?, ?, ?)',
          (header as Record<string, unknown>).id as string,
          JSON.stringify(header),
          '[]',
          now,
        );
        return header;
      }

      case 'session:save': {
        this.sql.exec(
          'INSERT OR REPLACE INTO sessions (id, header, messages, updated_at) VALUES (?, ?, ?, ?)',
          msg.data.id,
          JSON.stringify(msg.data.header),
          JSON.stringify(msg.data.messages),
          Date.now(),
        );
        return { success: true };
      }

      case 'session:delete': {
        this.sql.exec('DELETE FROM sessions WHERE id = ?', msg.data.sessionId);
        this.sql.exec('DELETE FROM plans WHERE session_id = ?', msg.data.sessionId);
        return { success: true };
      }

      case 'session:updateMeta': {
        const existing = this.sql.exec(
          'SELECT header FROM sessions WHERE id = ?',
          msg.data.sessionId,
        ).toArray()[0];
        if (!existing) throw new Error(`Session not found: ${msg.data.sessionId}`);
        const header = { ...JSON.parse(existing.header as string), ...msg.data.updates };
        this.sql.exec(
          'UPDATE sessions SET header = ?, updated_at = ? WHERE id = ?',
          JSON.stringify(header),
          Date.now(),
          msg.data.sessionId,
        );
        return header;
      }

      case 'session:updateSdkId': {
        const existing = this.sql.exec(
          'SELECT header FROM sessions WHERE id = ?',
          msg.data.sessionId,
        ).toArray()[0];
        if (!existing) throw new Error(`Session not found: ${msg.data.sessionId}`);
        const header = { ...JSON.parse(existing.header as string), sdkSessionId: msg.data.sdkSessionId };
        this.sql.exec(
          'UPDATE sessions SET header = ?, updated_at = ? WHERE id = ?',
          JSON.stringify(header),
          Date.now(),
          msg.data.sessionId,
        );
        return { success: true };
      }

      case 'session:clearMessages': {
        this.sql.exec(
          'UPDATE sessions SET messages = ?, updated_at = ? WHERE id = ?',
          '[]',
          Date.now(),
          msg.data.sessionId,
        );
        return { success: true };
      }

      // --- Sources ---
      case 'source:create': {
        const config = msg.data as Record<string, unknown>;
        this.sql.exec(
          'INSERT INTO sources (slug, config, updated_at) VALUES (?, ?, ?)',
          config.slug as string,
          JSON.stringify(config),
          Date.now(),
        );
        return config;
      }

      case 'source:saveConfig': {
        const config = msg.data as Record<string, unknown>;
        this.sql.exec(
          'INSERT OR REPLACE INTO sources (slug, config, guide, updated_at) VALUES (?, ?, (SELECT guide FROM sources WHERE slug = ?), ?)',
          config.slug as string,
          JSON.stringify(config),
          config.slug as string,
          Date.now(),
        );
        return { success: true };
      }

      case 'source:delete': {
        this.sql.exec('DELETE FROM sources WHERE slug = ?', msg.data.sourceSlug);
        return { success: true };
      }

      case 'source:saveGuide': {
        this.sql.exec(
          'UPDATE sources SET guide = ?, updated_at = ? WHERE slug = ?',
          JSON.stringify(msg.data.guide),
          Date.now(),
          msg.data.sourceSlug,
        );
        return { success: true };
      }

      // --- Statuses ---
      case 'statuses:save': {
        this.sql.exec(
          "INSERT OR REPLACE INTO statuses (id, data) VALUES ('config', ?)",
          JSON.stringify(msg.data),
        );
        return { success: true };
      }

      // --- Labels ---
      case 'labels:save': {
        this.sql.exec(
          "INSERT OR REPLACE INTO labels (id, data) VALUES ('config', ?)",
          JSON.stringify(msg.data),
        );
        return { success: true };
      }

      // --- Skills ---
      case 'skill:save': {
        this.sql.exec(
          'INSERT OR REPLACE INTO skills (slug, content, metadata, updated_at) VALUES (?, ?, ?, ?)',
          msg.data.slug,
          msg.data.content,
          JSON.stringify(msg.data.metadata),
          Date.now(),
        );
        return { success: true };
      }

      case 'skill:delete': {
        this.sql.exec('DELETE FROM skills WHERE slug = ?', msg.data.slug);
        return { success: true };
      }

      // --- Plans ---
      case 'plan:save': {
        this.sql.exec(
          'INSERT OR REPLACE INTO plans (session_id, file_name, content, updated_at) VALUES (?, ?, ?, ?)',
          msg.data.sessionId,
          msg.data.fileName,
          msg.data.content,
          Date.now(),
        );
        return { success: true };
      }

      case 'plan:delete': {
        this.sql.exec(
          'DELETE FROM plans WHERE session_id = ? AND file_name = ?',
          msg.data.sessionId,
          msg.data.fileName,
        );
        return { success: true };
      }

      default:
        throw new Error(`Unknown message type: ${(msg as { type: string }).type}`);
    }
  }

  // ============================================================
  // Broadcast & Change Events
  // ============================================================

  private broadcast(sender: WebSocket, message: WSServerMessage): void {
    const payload = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      // Skip the sender and any sandbox WebSockets
      if (ws === sender) continue;
      const tags = this.ctx.getTags(ws);
      if (tags.length > 0 && tags[0] === 'sandbox') continue;

      try {
        ws.send(payload);
      } catch {
        // Client disconnected — hibernation API will clean up
      }
    }
  }

  /** Broadcast a change event to ALL connected WebSocket clients (for REST-originated changes) */
  private broadcastToAll(event: WSRemoteChangeEvent): void {
    const payload = JSON.stringify({ type: 'broadcast', event } satisfies WSServerMessage);
    for (const ws of this.ctx.getWebSockets()) {
      const tags = this.ctx.getTags(ws);
      if (tags.length > 0 && tags[0] === 'sandbox') continue;
      try {
        ws.send(payload);
      } catch {
        // Client disconnected — hibernation API will clean up
      }
    }
  }

  private toChangeEvent(msg: WSClientMessage, result: unknown): WSRemoteChangeEvent | null {
    switch (msg.type) {
      case 'session:create':
        // Use result (which has computed timestamps) instead of msg.data
        return { entity: 'session', action: 'created', data: result as Record<string, unknown> };
      case 'session:save':
        // Broadcast header (flat session metadata), not the full { id, header, messages } payload
        return { entity: 'session', action: 'updated', data: msg.data.header };
      case 'session:updateMeta':
        // Use result (merged header) so remote clients get the FULL session metadata
        return { entity: 'session', action: 'updated', data: result as Record<string, unknown> };
      case 'session:updateSdkId':
      case 'session:clearMessages':
        return { entity: 'session', action: 'updated', data: msg.data };
      case 'session:delete':
        return { entity: 'session', action: 'deleted', data: msg.data };

      case 'source:create':
        return { entity: 'source', action: 'created', data: msg.data };
      case 'source:saveConfig':
      case 'source:saveGuide':
        return { entity: 'source', action: 'updated', data: msg.data };
      case 'source:delete':
        return { entity: 'source', action: 'deleted', data: msg.data };

      case 'statuses:save':
        return { entity: 'statuses', action: 'updated', data: msg.data };

      case 'labels:save':
        return { entity: 'labels', action: 'updated', data: msg.data };

      case 'skill:save':
        return { entity: 'skill', action: 'updated', data: msg.data };
      case 'skill:delete':
        return { entity: 'skill', action: 'deleted', data: msg.data };

      case 'plan:save':
        return { entity: 'plan', action: 'updated', data: msg.data };
      case 'plan:delete':
        return { entity: 'plan', action: 'deleted', data: msg.data };

      default:
        return null;
    }
  }
}
