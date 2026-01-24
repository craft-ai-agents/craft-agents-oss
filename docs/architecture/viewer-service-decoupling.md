# Session Share Decoupling Plan

**Goal:** Remove hard dependency on `https://agents.craft.do` by creating a pluggable viewer service architecture.

**Priority:** HIGH - Critical vendor lock-in risk

**Estimated Scope:** Medium (2-3 days for Phase 1, 1-2 weeks for all phases)

---

## Current State Analysis

### Coupling Points

1. **Hardcoded URL** (`packages/shared/src/branding.ts:26`):
   ```typescript
   export const VIEWER_URL = 'https://agents.craft.do';
   ```

2. **Direct fetch calls** (`apps/electron/src/main/sessions.ts:1620-1625, 1684-1689, 1729-1733`):
   ```typescript
   const { VIEWER_URL } = await import('@craft-agent/shared/branding')
   const response = await fetch(`${VIEWER_URL}/s/api`, { /* ... */ })
   ```

3. **Fixed API contract**:
   - `POST /s/api` → Upload session, returns `{ id, url }`
   - `PUT /s/api/{id}` → Update session
   - `DELETE /s/api/{id}` → Remove session

### Dependencies

- `shareToViewer()` - Lines 1599-1658
- `updateShare()` - Lines 1660-1709
- `revokeShare()` - Lines 1711-1759

---

## Decoupling Strategy

### Phase 1: Abstraction Layer (Priority: HIGH, 2-3 days)

Create a `ViewerService` interface with pluggable implementations.

#### 1.1 Define ViewerService Interface

**File:** `packages/shared/src/viewer/types.ts`

```typescript
import type { StoredSession } from '@craft-agent/core/types';

/**
 * Result of a share operation
 */
export interface ShareResult {
  success: boolean;
  id?: string;        // Unique ID for the shared session
  url?: string;       // Public URL where session can be viewed
  error?: string;
}

/**
 * Abstract viewer service for sharing sessions
 */
export interface ViewerService {
  /**
   * Share a session to the viewer
   * @returns Shareable URL and ID
   */
  share(session: StoredSession): Promise<ShareResult>;

  /**
   * Update an existing shared session
   * @param id - The shared session ID from initial share
   * @param session - Updated session data
   */
  update(id: string, session: StoredSession): Promise<ShareResult>;

  /**
   * Revoke a shared session
   * @param id - The shared session ID to revoke
   */
  revoke(id: string): Promise<ShareResult>;

  /**
   * Health check - verify viewer is accessible
   * @returns true if viewer is reachable
   */
  healthCheck(): Promise<boolean>;
}

/**
 * Viewer service configuration
 */
export interface ViewerConfig {
  type: 'craft-hosted' | 'self-hosted' | 'static-export' | 'local-viewer';

  // For craft-hosted (default)
  craftUrl?: string;  // Default: https://agents.craft.do

  // For self-hosted
  selfHostedUrl?: string;
  apiKey?: string;  // Optional API key for auth

  // For static-export
  exportPath?: string;  // Path to export HTML files
  uploadCommand?: string;  // Optional: Command to run after export (e.g., "aws s3 sync")

  // For local-viewer
  localPort?: number;  // Port for local HTTP server (default: 3456)
}
```

#### 1.2 Implement CraftHostedViewer

**File:** `packages/shared/src/viewer/craft-hosted-viewer.ts`

```typescript
import type { StoredSession } from '@craft-agent/core/types';
import type { ViewerService, ShareResult } from './types';

/**
 * Official Craft-hosted viewer service
 * Uses https://agents.craft.do by default
 */
export class CraftHostedViewer implements ViewerService {
  private baseUrl: string;

  constructor(baseUrl: string = 'https://agents.craft.do') {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  async share(session: StoredSession): Promise<ShareResult> {
    try {
      const response = await fetch(`${this.baseUrl}/s/api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session),
      });

      if (!response.ok) {
        if (response.status === 413) {
          return { success: false, error: 'Session file is too large to share' };
        }
        return { success: false, error: `Upload failed: ${response.status}` };
      }

      const data = await response.json() as { id: string; url: string };
      return { success: true, id: data.id, url: data.url };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  async update(id: string, session: StoredSession): Promise<ShareResult> {
    try {
      const response = await fetch(`${this.baseUrl}/s/api/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session),
      });

      if (!response.ok) {
        if (response.status === 413) {
          return { success: false, error: 'Session file is too large to share' };
        }
        return { success: false, error: `Update failed: ${response.status}` };
      }

      const data = await response.json() as { url: string };
      return { success: true, url: data.url };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  async revoke(id: string): Promise<ShareResult> {
    try {
      const response = await fetch(`${this.baseUrl}/s/api/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        return { success: false, error: `Revoke failed: ${response.status}` };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  }
}
```

#### 1.3 Add Configuration Support

**File:** `packages/core/src/types/workspace.ts` (add to StoredConfig)

```typescript
export interface StoredConfig {
  authType?: AuthType;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeSessionId: string | null;
  model?: string;

  // NEW: Viewer configuration
  viewer?: {
    type: 'craft-hosted' | 'self-hosted' | 'static-export' | 'local-viewer';
    craftUrl?: string;
    selfHostedUrl?: string;
    apiKey?: string;  // Stored in credentials.enc, referenced by key
    exportPath?: string;
    uploadCommand?: string;
    localPort?: number;
  };
}
```

#### 1.4 Create ViewerService Factory

**File:** `packages/shared/src/viewer/factory.ts`

```typescript
import type { ViewerService, ViewerConfig } from './types';
import { CraftHostedViewer } from './craft-hosted-viewer';
import { StaticExportViewer } from './static-export-viewer';
import { LocalViewer } from './local-viewer';

/**
 * Create viewer service based on configuration
 * Falls back to default Craft-hosted viewer if config is missing
 */
export function createViewerService(config?: ViewerConfig): ViewerService {
  if (!config || config.type === 'craft-hosted') {
    const url = config?.craftUrl || 'https://agents.craft.do';
    return new CraftHostedViewer(url);
  }

  switch (config.type) {
    case 'self-hosted':
      if (!config.selfHostedUrl) {
        throw new Error('Self-hosted viewer requires selfHostedUrl');
      }
      return new CraftHostedViewer(config.selfHostedUrl); // Same API interface

    case 'static-export':
      if (!config.exportPath) {
        throw new Error('Static export requires exportPath');
      }
      return new StaticExportViewer(config.exportPath, config.uploadCommand);

    case 'local-viewer':
      return new LocalViewer(config.localPort || 3456);

    default:
      // Fallback to default
      return new CraftHostedViewer();
  }
}
```

#### 1.5 Refactor SessionManager

**File:** `apps/electron/src/main/sessions.ts`

Replace direct fetch calls with ViewerService:

```typescript
import { createViewerService } from '@craft-agent/shared/viewer/factory';
import type { ViewerService } from '@craft-agent/shared/viewer/types';

export class SessionManager {
  // Add viewer service instance
  private viewerService: ViewerService;

  constructor(/* existing params */) {
    // ... existing initialization

    // Initialize viewer service from config
    this.viewerService = this.createViewer();
  }

  /**
   * Create viewer service based on stored config
   */
  private createViewer(): ViewerService {
    const config = loadStoredConfig(); // Load from config.json
    return createViewerService(config?.viewer);
  }

  /**
   * Reload viewer service when config changes
   */
  reloadViewerConfig(): void {
    this.viewerService = this.createViewer();
  }

  /**
   * Share session to the web viewer (REFACTORED)
   */
  async shareToViewer(sessionId: string): Promise<import('../shared/types').ShareResult> {
    const managed = this.sessions.get(sessionId);
    if (!managed) {
      return { success: false, error: 'Session not found' };
    }

    // Signal async operation start
    managed.isAsyncOperationOngoing = true;
    this.sendEvent({ type: 'async_operation', sessionId, isOngoing: true }, managed.workspace.id);

    try {
      const storedSession = loadStoredSession(managed.workspace.rootPath, sessionId);
      if (!storedSession) {
        return { success: false, error: 'Session file not found' };
      }

      // Use viewer service instead of direct fetch
      const result = await this.viewerService.share(storedSession);

      if (!result.success) {
        return result;
      }

      // Store shared info
      managed.sharedUrl = result.url!;
      managed.sharedId = result.id!;
      updateSessionMetadata(managed.workspace.rootPath, sessionId, {
        sharedUrl: result.url,
        sharedId: result.id,
      });

      sessionLog.info(`Session ${sessionId} shared at ${result.url}`);
      this.sendEvent({ type: 'session_shared', sessionId, sharedUrl: result.url! }, managed.workspace.id);
      return result;
    } catch (error) {
      sessionLog.error('Share error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    } finally {
      managed.isAsyncOperationOngoing = false;
      this.sendEvent({ type: 'async_operation', sessionId, isOngoing: false }, managed.workspace.id);
    }
  }

  /**
   * Update shared session (REFACTORED)
   */
  async updateShare(sessionId: string): Promise<import('../shared/types').ShareResult> {
    const managed = this.sessions.get(sessionId);
    if (!managed || !managed.sharedId) {
      return { success: false, error: 'Session not shared' };
    }

    managed.isAsyncOperationOngoing = true;
    this.sendEvent({ type: 'async_operation', sessionId, isOngoing: true }, managed.workspace.id);

    try {
      const storedSession = loadStoredSession(managed.workspace.rootPath, sessionId);
      if (!storedSession) {
        return { success: false, error: 'Session file not found' };
      }

      // Use viewer service
      const result = await this.viewerService.update(managed.sharedId, storedSession);

      if (result.success) {
        sessionLog.info(`Session ${sessionId} share updated`);
      }

      return result;
    } catch (error) {
      sessionLog.error('Update share error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    } finally {
      managed.isAsyncOperationOngoing = false;
      this.sendEvent({ type: 'async_operation', sessionId, isOngoing: false }, managed.workspace.id);
    }
  }

  /**
   * Revoke shared session (REFACTORED)
   */
  async revokeShare(sessionId: string): Promise<import('../shared/types').ShareResult> {
    const managed = this.sessions.get(sessionId);
    if (!managed || !managed.sharedId) {
      return { success: false, error: 'Session not shared' };
    }

    managed.isAsyncOperationOngoing = true;
    this.sendEvent({ type: 'async_operation', sessionId, isOngoing: true }, managed.workspace.id);

    try {
      // Use viewer service
      const result = await this.viewerService.revoke(managed.sharedId);

      // Clear local state regardless of result (prevent re-share attempts)
      delete managed.sharedUrl;
      delete managed.sharedId;
      updateSessionMetadata(managed.workspace.rootPath, sessionId, {
        sharedUrl: undefined,
        sharedId: undefined,
      });

      sessionLog.info(`Session ${sessionId} share revoked`);
      this.sendEvent({ type: 'session_unshared', sessionId }, managed.workspace.id);
      return result;
    } catch (error) {
      sessionLog.error('Revoke error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    } finally {
      managed.isAsyncOperationOngoing = false;
      this.sendEvent({ type: 'async_operation', sessionId, isOngoing: false }, managed.workspace.id);
    }
  }
}
```

#### 1.6 Add Settings UI

**File:** `apps/electron/src/renderer/components/settings/ViewerSettings.tsx`

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export function ViewerSettings() {
  const [viewerType, setViewerType] = useState<string>('craft-hosted');
  const [customUrl, setCustomUrl] = useState('');
  const [healthStatus, setHealthStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');

  const handleTestConnection = async () => {
    setHealthStatus('checking');
    const result = await window.api.send('viewer_health_check', {});
    setHealthStatus(result.healthy ? 'ok' : 'error');
  };

  const handleSave = async () => {
    await window.api.send('config_update', {
      viewer: {
        type: viewerType,
        craftUrl: viewerType === 'craft-hosted' ? customUrl || undefined : undefined,
        selfHostedUrl: viewerType === 'self-hosted' ? customUrl : undefined,
      },
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Session Sharing</h3>
        <p className="text-sm text-muted-foreground">
          Configure where shared sessions are hosted
        </p>
      </div>

      <RadioGroup value={viewerType} onValueChange={setViewerType}>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="craft-hosted" id="craft-hosted" />
          <Label htmlFor="craft-hosted">
            Craft Hosted (Default)
            <span className="block text-xs text-muted-foreground">
              Uses https://agents.craft.do - no setup required
            </span>
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <RadioGroupItem value="self-hosted" id="self-hosted" />
          <Label htmlFor="self-hosted">
            Self-Hosted Viewer
            <span className="block text-xs text-muted-foreground">
              Run your own viewer instance for privacy
            </span>
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <RadioGroupItem value="static-export" id="static-export" />
          <Label htmlFor="static-export">
            Static Export
            <span className="block text-xs text-muted-foreground">
              Generate HTML files for any static host
            </span>
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <RadioGroupItem value="local-viewer" id="local-viewer" />
          <Label htmlFor="local-viewer">
            Local Viewer
            <span className="block text-xs text-muted-foreground">
              Share on your local network only
            </span>
          </Label>
        </div>
      </RadioGroup>

      {(viewerType === 'craft-hosted' || viewerType === 'self-hosted') && (
        <div>
          <Label htmlFor="viewer-url">
            {viewerType === 'craft-hosted' ? 'Custom Craft URL (optional)' : 'Viewer URL'}
          </Label>
          <div className="flex gap-2 mt-2">
            <Input
              id="viewer-url"
              placeholder={
                viewerType === 'craft-hosted'
                  ? 'https://agents.craft.do'
                  : 'https://your-viewer.example.com'
              }
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
            />
            <Button onClick={handleTestConnection} variant="outline">
              {healthStatus === 'checking' ? 'Testing...' : 'Test'}
            </Button>
          </div>
          {healthStatus === 'ok' && (
            <p className="text-sm text-green-600 mt-1">✓ Connection successful</p>
          )}
          {healthStatus === 'error' && (
            <p className="text-sm text-red-600 mt-1">✗ Connection failed</p>
          )}
        </div>
      )}

      <Button onClick={handleSave}>Save Settings</Button>
    </div>
  );
}
```

---

### Phase 2: Alternative Implementations (Priority: MEDIUM, 1 week)

#### 2.1 Static Export Viewer

Generate self-contained HTML files for static hosting.

**File:** `packages/shared/src/viewer/static-export-viewer.ts`

```typescript
import type { StoredSession } from '@craft-agent/core/types';
import type { ViewerService, ShareResult } from './types';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { generateSessionHTML } from './templates/session-html';

/**
 * Static export viewer - generates HTML files
 * Can be uploaded to any static host (Netlify, S3, GitHub Pages)
 */
export class StaticExportViewer implements ViewerService {
  constructor(
    private exportPath: string,
    private uploadCommand?: string
  ) {
    // Ensure export directory exists
    if (!fs.existsSync(exportPath)) {
      fs.mkdirSync(exportPath, { recursive: true });
    }
  }

  async share(session: StoredSession): Promise<ShareResult> {
    try {
      const id = session.id;
      const filename = `${id}.html`;
      const filepath = path.join(this.exportPath, filename);

      // Generate static HTML
      const html = generateSessionHTML(session);
      fs.writeFileSync(filepath, html, 'utf-8');

      // Run upload command if configured
      let publicUrl: string;
      if (this.uploadCommand) {
        try {
          execSync(this.uploadCommand, { cwd: this.exportPath });
          publicUrl = this.constructPublicUrl(id);
        } catch (error) {
          return { success: false, error: 'Upload command failed' };
        }
      } else {
        publicUrl = `file://${filepath}`;
      }

      return { success: true, id, url: publicUrl };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Export failed',
      };
    }
  }

  async update(id: string, session: StoredSession): Promise<ShareResult> {
    // Re-export with same ID
    return this.share(session);
  }

  async revoke(id: string): Promise<ShareResult> {
    try {
      const filename = `${id}.html`;
      const filepath = path.join(this.exportPath, filename);

      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Revoke failed',
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    return fs.existsSync(this.exportPath);
  }

  private constructPublicUrl(id: string): string {
    // This should be configured per user
    // For now, return file URL
    return `file://${path.join(this.exportPath, `${id}.html`)}`;
  }
}
```

**File:** `packages/shared/src/viewer/templates/session-html.ts`

```typescript
import type { StoredSession } from '@craft-agent/core/types';

/**
 * Generate standalone HTML for a session
 */
export function generateSessionHTML(session: StoredSession): string {
  const messagesHTML = session.messages
    .map((msg) => {
      const role = msg.role === 'user' ? 'You' : 'Assistant';
      const content = Array.isArray(msg.content)
        ? msg.content.map((block) => {
            if (block.type === 'text') return block.text;
            if (block.type === 'tool_use') return `[Tool: ${block.name}]`;
            if (block.type === 'tool_result') return `[Tool Result]`;
            return '';
          }).join('\n')
        : msg.content;

      return `
        <div class="message ${msg.role}">
          <div class="role">${role}</div>
          <div class="content">${escapeHtml(content)}</div>
        </div>
      `;
    })
    .join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${session.name || 'Shared Session'} - Vespr</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
      background: #f5f5f5;
    }
    h1 {
      margin-bottom: 1rem;
      color: #111;
    }
    .metadata {
      font-size: 0.9rem;
      color: #666;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 2px solid #ddd;
    }
    .message {
      background: white;
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 1rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .message.user { border-left: 4px solid #0066cc; }
    .message.assistant { border-left: 4px solid #00cc66; }
    .role {
      font-weight: 600;
      margin-bottom: 0.5rem;
      color: #555;
    }
    .content {
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .footer {
      margin-top: 3rem;
      text-align: center;
      color: #999;
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <h1>${session.name || 'Shared Session'}</h1>
  <div class="metadata">
    <div>Created: ${new Date(session.createdAt).toLocaleString()}</div>
    <div>Messages: ${session.messages.length}</div>
  </div>
  <div class="messages">
    ${messagesHTML}
  </div>
  <div class="footer">
    Shared from <strong>Vespr</strong> - An open-source AI agent platform
  </div>
</body>
</html>
  `.trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
```

#### 2.2 Local Viewer

Run a simple HTTP server for local network sharing.

**File:** `packages/shared/src/viewer/local-viewer.ts`

```typescript
import type { StoredSession } from '@craft-agent/core/types';
import type { ViewerService, ShareResult } from './types';
import { createServer, type Server } from 'node:http';
import { generateSessionHTML } from './templates/session-html';

/**
 * Local viewer - runs HTTP server on local network
 * Sessions accessible only from same network
 */
export class LocalViewer implements ViewerService {
  private server: Server | null = null;
  private sessions = new Map<string, StoredSession>();
  private port: number;

  constructor(port: number = 3456) {
    this.port = port;
    this.startServer();
  }

  private startServer() {
    this.server = createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${this.port}`);
      const sessionId = url.pathname.replace(/^\//, '');

      if (!sessionId) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Vespr Local Viewer</h1><p>Session ID required in URL</p>');
        return;
      }

      const session = this.sessions.get(sessionId);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 - Session Not Found</h1>');
        return;
      }

      const html = generateSessionHTML(session);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });

    this.server.listen(this.port);
  }

  async share(session: StoredSession): Promise<ShareResult> {
    const id = session.id;
    this.sessions.set(id, session);

    const url = `http://localhost:${this.port}/${id}`;
    return { success: true, id, url };
  }

  async update(id: string, session: StoredSession): Promise<ShareResult> {
    this.sessions.set(id, session);
    const url = `http://localhost:${this.port}/${id}`;
    return { success: true, url };
  }

  async revoke(id: string): Promise<ShareResult> {
    this.sessions.delete(id);
    return { success: true };
  }

  async healthCheck(): Promise<boolean> {
    return this.server?.listening || false;
  }

  destroy() {
    this.server?.close();
  }
}
```

---

### Phase 3: Migration & Rollout (Priority: LOW, 2-3 days)

#### 3.1 Backward Compatibility

Existing shared sessions should continue working:

```typescript
// In sessionManager initialization
if (managed.sharedUrl && managed.sharedUrl.includes('agents.craft.do')) {
  // Existing share on craft.do - preserve it
  // No migration needed
}
```

#### 3.2 Migration Guide

**File:** `docs/migration/viewer-decoupling.md`

```markdown
# Migrating to Configurable Viewer

## For Users

### Default Behavior (No Action Required)
- Sessions continue sharing to https://agents.craft.do
- Existing shared URLs remain valid
- No configuration changes needed

### Self-Hosting Setup

1. Deploy viewer service (see `docs/self-hosting/viewer-setup.md`)
2. Open Vespr → Settings → Sharing
3. Select "Self-Hosted Viewer"
4. Enter your viewer URL
5. Click "Test Connection"
6. Save settings

### Static Export Setup

1. Choose export directory (e.g., `~/vespr-shares`)
2. Optional: Configure upload command:
   ```bash
   aws s3 sync . s3://my-bucket/shares
   ```
3. Open Settings → Sharing → "Static Export"
4. Set export path and upload command
5. Save

## For Developers

### API Changes

**Before:**
```typescript
const { VIEWER_URL } = await import('@craft-agent/shared/branding');
const response = await fetch(`${VIEWER_URL}/s/api`, { /* ... */ });
```

**After:**
```typescript
import { createViewerService } from '@craft-agent/shared/viewer/factory';

const viewer = createViewerService(config.viewer);
const result = await viewer.share(session);
```

### Custom Viewer Implementation

Implement the `ViewerService` interface:

```typescript
import type { ViewerService, ShareResult } from '@craft-agent/shared/viewer/types';

export class MyCustomViewer implements ViewerService {
  async share(session: StoredSession): Promise<ShareResult> {
    // Your implementation
  }

  async update(id: string, session: StoredSession): Promise<ShareResult> {
    // Your implementation
  }

  async revoke(id: string): Promise<ShareResult> {
    // Your implementation
  }

  async healthCheck(): Promise<boolean> {
    // Your implementation
  }
}
```
```

---

## Implementation Checklist

### Phase 1: Abstraction Layer (2-3 days)

- [ ] Create `packages/shared/src/viewer/types.ts` with interfaces
- [ ] Implement `CraftHostedViewer` class
- [ ] Add viewer config to `StoredConfig` type
- [ ] Create `ViewerService` factory
- [ ] Refactor `SessionManager` to use `ViewerService`
- [ ] Add IPC handler for health check
- [ ] Create Settings UI component
- [ ] Test with default craft.do URL
- [ ] Test with custom craft.do URL (if they have staging env)

### Phase 2: Alternative Implementations (1 week)

- [ ] Implement `StaticExportViewer` with HTML template
- [ ] Implement `LocalViewer` with HTTP server
- [ ] Add upload command support for static export
- [ ] Test static export with local file:// URLs
- [ ] Test local viewer on same network
- [ ] Document each viewer type
- [ ] Add configuration examples

### Phase 3: Migration & Polish (2-3 days)

- [ ] Write migration guide
- [ ] Add backward compatibility tests
- [ ] Update main README with viewer options
- [ ] Create self-hosting guide for viewer
- [ ] Add troubleshooting section
- [ ] Test health check on all viewer types
- [ ] Add telemetry for viewer type usage (opt-in)

---

## Testing Strategy

### Unit Tests

```typescript
describe('CraftHostedViewer', () => {
  it('should share session to craft.do', async () => {
    const viewer = new CraftHostedViewer('https://agents.craft.do');
    const result = await viewer.share(mockSession);
    expect(result.success).toBe(true);
    expect(result.url).toMatch(/^https:\/\/agents\.craft\.do/);
  });

  it('should handle 413 errors gracefully', async () => {
    // Mock large session
    const result = await viewer.share(largeSession);
    expect(result.error).toContain('too large');
  });
});

describe('StaticExportViewer', () => {
  it('should generate HTML file', async () => {
    const viewer = new StaticExportViewer('/tmp/test-export');
    const result = await viewer.share(mockSession);
    expect(fs.existsSync(`/tmp/test-export/${mockSession.id}.html`)).toBe(true);
  });
});
```

### Integration Tests

- [ ] Test viewer switching (craft → static → local → craft)
- [ ] Test config persistence across app restarts
- [ ] Test share/update/revoke with each viewer type
- [ ] Test network failure scenarios
- [ ] Test concurrent shares to different viewers

---

## Risk Mitigation

### Rollback Plan

If issues arise:

1. **Immediate:** Revert to hardcoded craft.do URL
2. **Short-term:** Add feature flag to disable custom viewers
3. **Long-term:** Fix bugs and re-enable

### Monitoring

- Track viewer type distribution
- Monitor share success/failure rates per viewer type
- Alert on craft.do health check failures
- Log viewer service errors

---

## Success Metrics

- [ ] 0% regressions in share functionality
- [ ] Settings UI allows viewer configuration
- [ ] All 4 viewer types working (craft, self-hosted, static, local)
- [ ] Documentation complete for each viewer type
- [ ] Migration path clear and tested

---

## Future Enhancements (Post-Decoupling)

### P2P Sharing
- Use WebRTC or libp2p for direct peer-to-peer sharing
- No server dependency at all
- Requires both parties online

### Viewer Analytics
- Track view counts
- See when shared
- Identify popular shares

### Access Control
- Password-protected shares
- Expiration timestamps
- Revocable tokens

### Collaboration Features
- Comments on shared sessions
- Fork/remix conversations
- Export to PDF/Markdown
