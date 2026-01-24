# Session Share Decoupling: Implementation Options Analysis

**Created:** 2026-01-23
**Status:** Planning / Decision Required
**Priority:** HIGH - Critical vendor lock-in risk
**Type:** Refactoring + Feature Enhancement

---

## Executive Summary

The current Chat Session Share Feature has a **hard dependency** on `https://agents.craft.do` as the viewer service. This creates vendor lock-in, single point of failure, and conflicts with Vespr's philosophy of user-owned, portable data.

Three implementation options exist with different trade-offs. This document analyzes each option against Vespr's existing architecture patterns to recommend the best path forward.

**TL;DR Recommendation:** **Option A (Full Decoupling)** aligns perfectly with Vespr's existing abstraction patterns (credentials, sources, OAuth) and provides maximum flexibility while maintaining simplicity.

---

## Problem Statement

### Current Architecture

```typescript
// packages/shared/src/branding.ts:26
export const VIEWER_URL = 'https://agents.craft.do';

// apps/electron/src/main/sessions.ts:1620-1625
const { VIEWER_URL } = await import('@craft-agent/shared/branding')
const response = await fetch(`${VIEWER_URL}/s/api`, { /* ... */ })
```

**Risk Assessment:**

| Risk | Impact | Likelihood | Severity |
|------|--------|------------|----------|
| craft.do downtime | Share operations fail completely | Medium | **HIGH** |
| API breaking changes | All share features break | Low | **CRITICAL** |
| Service shutdown | Feature permanently lost | Low | **CRITICAL** |
| Rate limiting | Intermittent failures | Medium | **MEDIUM** |
| Data privacy concerns | User sessions on third-party server | High | **HIGH** |

### Alignment with Vespr Philosophy

Vespr's core values (from CLAUDE.md and architecture exploration):

1. **User Ownership** - Data stored locally in `~/.vespr/`, encrypted, portable
2. **Privacy First** - No cloud dependency unless user chooses
3. **Offline Capable** - Works without internet connection
4. **Simplicity** - Sensible defaults, advanced features opt-in
5. **Flexibility** - Extensible without code changes (sources pattern)
6. **Portability** - Configs in JSON, paths with `~` prefix

**Current state violates:**
- ❌ User Ownership - Sessions uploaded to third-party
- ❌ Privacy First - Cloud dependency for sharing
- ❌ Offline Capable - Requires internet + craft.do availability
- ✅ Simplicity - Zero config (but inflexible)
- ❌ Flexibility - Hardcoded URL, no alternatives
- ✅ Portability - Shared URLs portable, but tied to craft.do

---

## Implementation Options

### Option A: Full Decoupling (3-Phase Approach)

**Timeline:** 2 weeks
**Complexity:** Medium
**Maintainability:** High
**User Value:** Maximum

#### Architecture

Create `ViewerService` interface with pluggable backends:

```typescript
// packages/shared/src/viewer/types.ts
interface ViewerService {
  share(session: StoredSession): Promise<ShareResult>;
  update(id: string, session: StoredSession): Promise<ShareResult>;
  revoke(id: string): Promise<ShareResult>;
  healthCheck(): Promise<boolean>;
}

// Factory pattern (mirrors sources pattern)
function createViewerService(config?: ViewerConfig): ViewerService {
  switch (config?.type) {
    case 'craft-hosted': return new CraftHostedViewer(config.craftUrl);
    case 'self-hosted': return new CraftHostedViewer(config.selfHostedUrl);
    case 'static-export': return new StaticExportViewer(config.exportPath);
    case 'local-viewer': return new LocalViewer(config.localPort);
    default: return new CraftHostedViewer(); // Default
  }
}
```

#### Configuration Schema

```json
{
  "viewer": {
    "type": "craft-hosted",
    "craftUrl": "https://agents.craft.do"
  }
}
```

**Workspace-level override** (optional):
```json
// ~/.vespr/workspaces/{id}/viewer-config.json
{
  "type": "static-export",
  "exportPath": "~/my-shared-sessions",
  "uploadCommand": "aws s3 sync . s3://my-bucket/shares"
}
```

#### Implementations

**1. CraftHostedViewer** (default, maintains backward compatibility)
- Wraps existing fetch calls
- Same API as current implementation
- Zero user config required

**2. StaticExportViewer** (offline-first)
- Generates standalone HTML files
- Upload to any static host (S3, Netlify, GitHub Pages)
- No server dependency

**3. LocalViewer** (privacy-first)
- HTTP server on `localhost:3456`
- Share on local network only
- Zero internet dependency

**4. SelfHostedViewer** (enterprise)
- Same API as craft.do, different host
- Full control over data
- Optional API key auth

#### UI/UX

Settings page with viewer configuration:

```tsx
// apps/electron/src/renderer/components/settings/ViewerSettings.tsx
<RadioGroup value={viewerType} onValueChange={setViewerType}>
  <RadioGroupItem value="craft-hosted">
    Craft Hosted (Default)
    <p>Uses agents.craft.do - no setup required</p>
  </RadioGroupItem>

  <RadioGroupItem value="static-export">
    Static Export
    <p>Generate HTML files for any static host</p>
  </RadioGroupItem>

  <RadioGroupItem value="local-viewer">
    Local Viewer
    <p>Share on your local network only</p>
  </RadioGroupItem>

  <RadioGroupItem value="self-hosted">
    Self-Hosted Viewer
    <p>Run your own viewer instance</p>
  </RadioGroupItem>
</RadioGroup>
```

**Mirrors existing pattern:** `SlackSettingsSection.tsx`, `WhatsAppSettingsSection.tsx`

#### Pros

✅ **Aligns perfectly with Vespr patterns** - Mirrors credentials, sources, OAuth abstractions
✅ **Maximum flexibility** - 4 viewer backends out of the box
✅ **User ownership** - Static export gives users full control
✅ **Offline capable** - LocalViewer + StaticExport work offline
✅ **Privacy-first** - Users choose where data goes
✅ **Extensible** - New backends don't require code changes
✅ **Backward compatible** - craft.do remains default
✅ **Future-proof** - No vendor lock-in

#### Cons

❌ **More code to maintain** - 4 implementations vs 1
❌ **Longer timeline** - 2 weeks vs 1 day
❌ **Testing complexity** - Need to test all backends
❌ **Documentation burden** - Each backend needs docs

#### Risk Mitigation

- Default to craft.do (zero config breakage)
- Phase rollout (Phase 1 = abstraction only)
- Feature flag during beta
- Comprehensive tests for each backend
- User migration guide

---

### Option B: Quick Decoupling (Config-Only)

**Timeline:** 1 day
**Complexity:** Low
**Maintainability:** Medium
**User Value:** Limited

#### Architecture

Simply make viewer URL configurable:

```typescript
// packages/core/src/types/workspace.ts
export interface StoredConfig {
  // ... existing fields
  viewerUrl?: string;  // Default: https://agents.craft.do
}

// apps/electron/src/main/sessions.ts
const config = loadStoredConfig();
const viewerUrl = config.viewerUrl || 'https://agents.craft.do';
const response = await fetch(`${viewerUrl}/s/api`, { /* ... */ });
```

#### UI/UX

Single input field in settings:

```tsx
<Input
  label="Viewer URL"
  placeholder="https://agents.craft.do"
  value={viewerUrl}
  onChange={handleViewerUrlChange}
/>
<Button onClick={testConnection}>Test Connection</Button>
```

#### Pros

✅ **Fast implementation** - 1 day vs 2 weeks
✅ **Low risk** - Minimal code changes
✅ **Simple** - One config field
✅ **Backward compatible** - Default unchanged
✅ **Enables self-hosting** - Users can point to their viewer

#### Cons

❌ **Limited flexibility** - Only supports craft.do-compatible APIs
❌ **No offline support** - Still requires internet
❌ **No privacy improvement** - Still uploads to server
❌ **No static export** - Can't generate HTML files
❌ **Doesn't match Vespr patterns** - No abstraction, just hardcoded config
❌ **Not future-proof** - Locked into REST API shape

#### Risk Assessment

- **Medium risk** - Relies on self-hosted viewers being compatible
- **Low user value** - Only helps advanced users with self-hosting
- **Tech debt** - Will need to refactor later for more flexibility

---

### Option C: Static Export Only

**Timeline:** 3-4 days
**Complexity:** Medium
**Maintainability:** Medium
**User Value:** High (privacy-focused)

#### Architecture

Implement Phase 1 (abstraction) + StaticExportViewer only:

```typescript
interface ViewerService {
  share(session): Promise<ShareResult>;
  // ... same interface
}

// Two implementations
- CraftHostedViewer (default)
- StaticExportViewer (new)

// Config
{
  "viewer": {
    "type": "craft-hosted" | "static-export",
    "exportPath": "~/vespr-shares",
    "uploadCommand": "aws s3 sync . s3://bucket"
  }
}
```

#### Static Export Implementation

```typescript
export class StaticExportViewer implements ViewerService {
  async share(session: StoredSession): Promise<ShareResult> {
    const html = generateSessionHTML(session);
    fs.writeFileSync(`${this.exportPath}/${session.id}.html`, html);

    if (this.uploadCommand) {
      execSync(this.uploadCommand, { cwd: this.exportPath });
    }

    return {
      success: true,
      id: session.id,
      url: this.constructPublicUrl(session.id)
    };
  }
}
```

#### UI/UX

```tsx
<RadioGroup value={viewerType}>
  <RadioGroupItem value="craft-hosted">
    Craft Hosted (Default)
  </RadioGroupItem>

  <RadioGroupItem value="static-export">
    Static Export
    <p>Generate HTML files - upload anywhere</p>
  </RadioGroupItem>
</RadioGroup>

{viewerType === 'static-export' && (
  <>
    <Input label="Export Path" placeholder="~/vespr-shares" />
    <Input label="Upload Command (Optional)" placeholder="aws s3 sync ..." />
  </>
)}
```

#### Pros

✅ **Eliminates server dependency** - No external service required
✅ **Maximum privacy** - Users control where files go
✅ **Offline capable** - Generate HTML without internet
✅ **Portable** - HTML files work anywhere
✅ **Matches Vespr philosophy** - User-owned data
✅ **Simpler than full decoupling** - Only 2 backends to maintain
✅ **Good abstraction** - Foundation for future backends

#### Cons

❌ **No real-time updates** - HTML is static snapshot
❌ **Manual upload** - Users configure upload command
❌ **No analytics** - Can't track views
❌ **No revocation** - Once uploaded, stays public
❌ **Still has craft.do dependency** - Default backend unchanged
❌ **Incomplete solution** - Doesn't address self-hosting or local sharing

#### Risk Assessment

- **Low risk** - Adds feature without breaking existing
- **Medium user value** - Appeals to privacy-conscious users
- **Medium completeness** - Solves privacy, not flexibility

---

## Comparison Matrix

### Technical Comparison

| Criteria | Option A (Full) | Option B (Quick) | Option C (Static) | Winner |
|----------|-----------------|------------------|-------------------|--------|
| **Implementation Time** | 2 weeks | 1 day | 3-4 days | B |
| **Code Maintainability** | High (abstracted) | Low (config only) | Medium (2 backends) | A |
| **Test Coverage Needed** | High (4 backends) | Low (URL swap) | Medium (2 backends) | B |
| **Backward Compatibility** | ✅ Perfect | ✅ Perfect | ✅ Perfect | Tie |
| **Future Extensibility** | ✅✅ Excellent | ❌ Poor | ✅ Good | A |
| **Tech Debt Created** | None | High | Low | A |

### User Value Comparison

| Criteria | Option A (Full) | Option B (Quick) | Option C (Static) | Winner |
|----------|-----------------|------------------|-------------------|--------|
| **Privacy Protection** | ✅✅ (Static+Local) | ❌ (Server only) | ✅✅ (Static) | A/C |
| **Offline Support** | ✅✅ (Static+Local) | ❌ (Internet req) | ✅ (Export) | A |
| **User Ownership** | ✅✅ (Full control) | ❌ (Server dep) | ✅ (Files) | A |
| **Simplicity** | ✅ (Defaults work) | ✅✅ (One field) | ✅ (Clear choice) | B |
| **Flexibility** | ✅✅ (4 options) | ❌ (URL only) | ✅ (2 options) | A |
| **Enterprise Readiness** | ✅✅ (Self-host) | ✅ (Self-host) | ❌ (No server) | A |

### Alignment with Vespr Philosophy

| Value | Option A (Full) | Option B (Quick) | Option C (Static) | Winner |
|-------|-----------------|------------------|-------------------|--------|
| **User Ownership** | ✅✅ Full control | ❌ Server dep | ✅✅ File-based | A/C |
| **Privacy First** | ✅✅ Local options | ❌ Cloud req | ✅✅ Local files | A/C |
| **Offline Capable** | ✅✅ Yes | ❌ No | ✅ Export offline | A |
| **Simplicity** | ✅ Defaults work | ✅✅ One config | ✅ Clear toggle | B |
| **Flexibility** | ✅✅ 4 backends | ❌ URL only | ✅ 2 backends | A |
| **Portability** | ✅✅ Configs JSON | ✅ Config JSON | ✅ Files portable | A |
| **Pattern Match** | ✅✅ Mirrors creds | ❌ Unique | ✅ Partial | A |

### Risk Assessment

| Risk Type | Option A (Full) | Option B (Quick) | Option C (Static) |
|-----------|-----------------|------------------|-------------------|
| **Implementation Risk** | Medium (more code) | Low (minimal change) | Medium (HTML gen) |
| **Maintenance Burden** | Medium (4 backends) | Low (config only) | Low (2 backends) |
| **Breaking Changes** | None (default same) | None (default same) | None (default same) |
| **User Confusion** | Low (clear UI) | Low (one field) | Low (two choices) |
| **Rollback Complexity** | Medium (feature flag) | Low (revert config) | Medium (feature flag) |

---

## Architecture Pattern Analysis

### How Vespr Currently Handles Similar Problems

#### Pattern 1: Credentials (Backend Abstraction)

**File:** `packages/shared/src/credentials/`

```typescript
interface CredentialBackend {
  name: string;
  priority: number;
  isAvailable(): Promise<boolean>;
  get/set/delete/list(): Promise<...>
}

// Multiple backends
- SecureStorageBackend (AES-256-GCM file)
- EnvironmentBackend (env vars)
```

**Lessons:**
- ✅ Interface-first design
- ✅ Multiple implementations coexist
- ✅ Priority-based resolution
- ✅ Extensible without code changes

**Option A applies this pattern ✅**
**Option B does not ❌**
**Option C partially applies ⚠️**

#### Pattern 2: Sources (Configuration-Driven)

**File:** `packages/shared/src/sources/`

```typescript
type SourceType = 'mcp' | 'api' | 'local';

// Folder-based config
sources/{slug}/
├── config.json
└── guide.md
```

**Lessons:**
- ✅ Type field determines behavior
- ✅ Folder-based configuration
- ✅ Service inference from URLs
- ✅ Workspace-scoped isolation

**Option A applies this pattern ✅**
**Option B does not ❌**
**Option C applies this pattern ✅**

#### Pattern 3: OAuth (Abstraction + Service Inference)

**File:** `packages/shared/src/auth/`

```typescript
class CraftOAuth {
  authenticate(): Promise<OAuthTokens>
  refreshAccessToken(): Promise<OAuthTokens>
}

// Service-specific implementations
- slack-oauth.ts
- google-oauth.ts
- microsoft-oauth.ts
```

**Lessons:**
- ✅ Generic OAuth flow with service-specific overrides
- ✅ URL inference (inferGoogleServiceFromUrl)
- ✅ Configuration via environment or config file
- ✅ Callback server pattern

**Option A applies this pattern ✅**
**Option B does not ❌**
**Option C does not ❌**

#### Pattern 4: Settings UI (State + IPC)

**Files:** `apps/electron/src/renderer/components/settings/`
- `SlackSettingsSection.tsx`
- `WhatsAppSettingsSection.tsx`
- `GitHubSettingsSection.tsx`

```typescript
// Pattern
- Jotai atoms for state (connection status, errors, loading)
- IPC handlers for main process calls
- Event listeners for real-time updates
- Conditional rendering based on connection state
- Connect/Disconnect buttons
- Test connection button
```

**Lessons:**
- ✅ Clear connection state display
- ✅ Test before save
- ✅ Error handling inline
- ✅ Loading states

**Option A applies this pattern ✅**
**Option B partially applies ⚠️**
**Option C applies this pattern ✅**

### Pattern Match Score

| Pattern Category | Option A | Option B | Option C |
|-----------------|----------|----------|----------|
| Backend Abstraction | ✅✅ Perfect | ❌ None | ✅ Partial |
| Config-Driven | ✅✅ Perfect | ⚠️ Minimal | ✅ Good |
| Settings UI | ✅✅ Perfect | ⚠️ Basic | ✅ Good |
| Service Inference | ✅ Possible | ❌ N/A | ❌ N/A |
| **Total Score** | **9/10** | **2/10** | **6/10** |

---

## Recommendation

### Primary Recommendation: **Option A (Full Decoupling)**

**Rationale:**

1. **Perfect Pattern Match** - Mirrors credentials, sources, and OAuth patterns exactly
2. **Maximum User Value** - Addresses privacy, flexibility, offline use
3. **Future-Proof** - Extensible architecture for new backends
4. **Aligns with Philosophy** - User ownership, privacy-first, offline-capable
5. **No Tech Debt** - Clean abstraction from day one
6. **Backward Compatible** - craft.do remains default

**Timeline:** 2 weeks
**Risk:** Low (feature flag + phased rollout)
**User Impact:** High (addresses all pain points)

### Alternative: **Option C (Static Export Only)** if time-constrained

**When to choose:**

- Need solution in < 1 week
- Privacy is primary concern (not flexibility)
- Limited engineering resources

**Pros vs Option A:**
- Faster (3-4 days vs 2 weeks)
- Still matches Vespr patterns partially
- Eliminates server dependency

**Cons vs Option A:**
- Incomplete (no self-hosting, no local viewer)
- Will need to add more backends later anyway

### NOT Recommended: **Option B (Quick Decoupling)**

**Why avoid:**

- ❌ Doesn't match any Vespr pattern
- ❌ Creates tech debt (will refactor later)
- ❌ Low user value (only helps self-hosters)
- ❌ Doesn't address privacy or offline concerns
- ❌ Not extensible (locked into REST API)

**When it might make sense:**

- Emergency fix needed TODAY
- Temporary workaround until proper solution
- Testing self-hosting viability

---

## Implementation Plan for Option A

### Phase 1: Abstraction Layer (Week 1)

**Days 1-2: Interface + CraftHostedViewer**
- [x] Create `packages/shared/src/viewer/types.ts`
- [x] Define `ViewerService` interface
- [x] Implement `CraftHostedViewer` (wrap existing fetch calls)
- [ ] Create factory function
- [x] Add config types to `StoredConfig`

**Days 3-4: Refactor SessionManager**
- [ ] Add `viewerService` property to SessionManager
- [ ] Replace fetch calls with `viewerService.share/update/revoke()`
- [ ] Add config loader
- [ ] Add IPC handler for health check

**Day 5: Testing + Settings UI Stub**
- [ ] Unit tests for CraftHostedViewer
- [ ] Integration tests for SessionManager
- [x] Create `ViewerSettings.tsx` component (UI only, no backends yet)
- [ ] Add to settings page

**Deliverable:** craft.do works via abstraction layer, settings UI shows options

### Phase 2: Alternative Implementations (Week 2)

**Days 6-7: StaticExportViewer**
- [ ] Implement HTML template generator
- [ ] Implement `StaticExportViewer` class
- [ ] Add export path + upload command to config
- [ ] Add to settings UI (functional)
- [ ] Test local file export

**Days 8-9: LocalViewer**
- [ ] Implement HTTP server
- [ ] Implement `LocalViewer` class
- [ ] Add port config to settings
- [ ] Test on local network
- [ ] Add health check

**Day 10: Self-Hosted Support + Polish**
- [ ] Test self-hosted viewer setup
- [ ] Add connection test button
- [ ] Error handling for all backends
- [ ] Documentation for each backend
- [ ] Migration guide

**Deliverable:** All 4 backends working, settings UI complete

### Testing Strategy

**Unit Tests:**
```typescript
describe('CraftHostedViewer', () => {
  it('shares session successfully', async () => { /* ... */ });
  it('handles 413 errors gracefully', async () => { /* ... */ });
  it('health check succeeds', async () => { /* ... */ });
});

describe('StaticExportViewer', () => {
  it('generates HTML file', async () => { /* ... */ });
  it('runs upload command', async () => { /* ... */ });
});

describe('LocalViewer', () => {
  it('starts HTTP server', async () => { /* ... */ });
  it('serves shared sessions', async () => { /* ... */ });
});
```

**Integration Tests:**
- [ ] Test viewer switching (craft → static → local → craft)
- [ ] Test config persistence across app restarts
- [ ] Test share/update/revoke with each backend
- [ ] Test network failure scenarios

**Manual Testing Checklist:**
- [ ] Share session with craft.do (default)
- [ ] Switch to static export, share again
- [ ] Verify HTML file generated
- [ ] Switch to local viewer, share again
- [ ] Access local URL from browser
- [ ] Test connection button for each backend
- [ ] Verify settings persist after restart

---

## Success Metrics

### Technical Metrics

- [ ] **Zero regressions** - Existing craft.do shares work identically
- [ ] **Test coverage** - 90%+ for new viewer code
- [ ] **Performance** - Share latency unchanged (<500ms)
- [ ] **Error rate** - <1% share failures (same as current)

### User Metrics

- [ ] **Configuration success rate** - 95%+ users can configure alternative backends
- [ ] **Static export adoption** - 10%+ users try static export within 1 month
- [ ] **Self-hosting adoption** - 2%+ users switch to self-hosted within 3 months
- [ ] **Support tickets** - <5 tickets related to viewer configuration

### Business Metrics

- [ ] **Risk reduction** - Eliminate single point of failure (craft.do)
- [ ] **Privacy improvement** - Users can share without third-party
- [ ] **Enterprise readiness** - Self-hosting option for compliance requirements

---

## Risks & Mitigation

### Implementation Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Breaking existing shares** | Low | Critical | Comprehensive backward compatibility tests |
| **Config migration issues** | Medium | High | Default to craft.do, graceful fallback |
| **HTML generation bugs** | Medium | Medium | Template tests, snapshot testing |
| **HTTP server port conflicts** | Low | Low | Allow custom port, auto-increment |
| **Upload command security** | Medium | High | Sanitize command, warn users, sandbox execution |

### User Experience Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Confusion about backends** | High | Medium | Clear UI descriptions, tooltips, documentation |
| **Self-hosted setup difficulty** | High | Low | Comprehensive setup guide, test connection button |
| **Static export upload failures** | Medium | Medium | Validate command, show detailed errors, retry logic |
| **Local viewer not accessible** | Low | Low | Firewall detection, clear error messages |

### Rollback Plan

**If critical issues arise:**

1. **Immediate** - Feature flag to disable alternative backends
2. **Short-term** - Revert to hardcoded craft.do (remove abstraction)
3. **Long-term** - Fix bugs, re-enable with beta flag

**Monitoring:**
- Track viewer type distribution
- Monitor share success/failure rates per backend
- Alert on craft.do health check failures
- Log viewer service errors

---

## Documentation Requirements

### User-Facing Docs

- [ ] **Settings Guide** - How to configure each viewer backend
- [ ] **Self-Hosting Guide** - Deploy your own viewer instance
- [ ] **Static Export Guide** - Configure export path and upload command
- [ ] **Local Viewer Guide** - Share on local network
- [ ] **Troubleshooting** - Common issues and solutions

### Developer Docs

- [ ] **Architecture Overview** - ViewerService pattern
- [ ] **Adding New Backends** - Implement ViewerService interface
- [ ] **Testing Guide** - How to test each backend
- [ ] **Migration Guide** - Updating from hardcoded URL

---

## Open Questions

1. **Should workspace-level viewer config override app-level?**
   - **Recommendation:** Yes, mirrors sources pattern

2. **How to handle existing sharedUrl on backend switch?**
   - **Recommendation:** Keep URL, warn if inaccessible on new backend

3. **Should static export support multiple upload destinations?**
   - **Recommendation:** Phase 2 feature, single destination for MVP

4. **Should local viewer support HTTPS?**
   - **Recommendation:** Phase 2, HTTP sufficient for local network

5. **How to handle viewer backend migrations (craft → static)?**
   - **Recommendation:** Create new share, keep old URL in metadata

---

## Appendix: Code Examples

### ViewerService Interface

```typescript
// packages/shared/src/viewer/types.ts
import type { StoredSession } from '@craft-agent/core/types';

export interface ShareResult {
  success: boolean;
  id?: string;
  url?: string;
  error?: string;
}

export interface ViewerService {
  share(session: StoredSession): Promise<ShareResult>;
  update(id: string, session: StoredSession): Promise<ShareResult>;
  revoke(id: string): Promise<ShareResult>;
  healthCheck(): Promise<boolean>;
}

export interface ViewerConfig {
  type: 'craft-hosted' | 'self-hosted' | 'static-export' | 'local-viewer';
  craftUrl?: string;
  selfHostedUrl?: string;
  apiKey?: string;
  exportPath?: string;
  uploadCommand?: string;
  localPort?: number;
}
```

### Factory Implementation

```typescript
// packages/shared/src/viewer/factory.ts
import type { ViewerService, ViewerConfig } from './types';
import { CraftHostedViewer } from './craft-hosted-viewer';
import { StaticExportViewer } from './static-export-viewer';
import { LocalViewer } from './local-viewer';

export function createViewerService(config?: ViewerConfig): ViewerService {
  if (!config || config.type === 'craft-hosted') {
    return new CraftHostedViewer(config?.craftUrl || 'https://agents.craft.do');
  }

  switch (config.type) {
    case 'self-hosted':
      if (!config.selfHostedUrl) throw new Error('Self-hosted URL required');
      return new CraftHostedViewer(config.selfHostedUrl);

    case 'static-export':
      if (!config.exportPath) throw new Error('Export path required');
      return new StaticExportViewer(config.exportPath, config.uploadCommand);

    case 'local-viewer':
      return new LocalViewer(config.localPort || 3456);

    default:
      return new CraftHostedViewer();
  }
}
```

### SessionManager Refactoring

```typescript
// apps/electron/src/main/sessions.ts
import { createViewerService } from '@craft-agent/shared/viewer/factory';
import type { ViewerService } from '@craft-agent/shared/viewer/types';

export class SessionManager {
  private viewerService: ViewerService;

  constructor(/* ... */) {
    // ...existing code...
    this.viewerService = this.createViewer();
  }

  private createViewer(): ViewerService {
    const config = loadStoredConfig();
    return createViewerService(config?.viewer);
  }

  reloadViewerConfig(): void {
    this.viewerService = this.createViewer();
  }

  async shareToViewer(sessionId: string): Promise<ShareResult> {
    const managed = this.sessions.get(sessionId);
    if (!managed) return { success: false, error: 'Session not found' };

    managed.isAsyncOperationOngoing = true;
    this.sendEvent({ type: 'async_operation', sessionId, isOngoing: true }, managed.workspace.id);

    try {
      const storedSession = loadStoredSession(managed.workspace.rootPath, sessionId);
      if (!storedSession) return { success: false, error: 'Session file not found' };

      // Use viewer service instead of direct fetch
      const result = await this.viewerService.share(storedSession);

      if (result.success) {
        managed.sharedUrl = result.url!;
        managed.sharedId = result.id!;
        updateSessionMetadata(managed.workspace.rootPath, sessionId, {
          sharedUrl: result.url,
          sharedId: result.id,
        });
        this.sendEvent({ type: 'session_shared', sessionId, sharedUrl: result.url! }, managed.workspace.id);
      }

      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    } finally {
      managed.isAsyncOperationOngoing = false;
      this.sendEvent({ type: 'async_operation', sessionId, isOngoing: false }, managed.workspace.id);
    }
  }

  // updateShare() and revokeShare() follow same pattern
}
```

---

## References

- **Architecture Analysis:** `~/Documents/compound-docs/docs/solutions/architecture-patterns/session-share-viewer-architecture-vespr-20260123.md`
- **Original Decoupling Plan:** `/Users/tinnguyen/vesper/docs/architecture/session-share-decoupling-plan.md`
- **Vespr CLAUDE.md:** `/Users/tinnguyen/vesper/CLAUDE.md`
- **Existing Patterns:**
  - Credentials: `packages/shared/src/credentials/`
  - Sources: `packages/shared/src/sources/`
  - OAuth: `packages/shared/src/auth/`
  - Settings UI: `apps/electron/src/renderer/components/settings/`

---

**Next Steps:**

1. Review this plan with team
2. Decide on Option A vs Option C vs Option B
3. If Option A: Proceed with Phase 1 implementation
4. If Option C: Focus on StaticExportViewer first
5. If Option B: Consider as temporary solution only
