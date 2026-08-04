# Security Audit Checklist for Electron Applications

This checklist covers every security-relevant configuration and pattern in an
Electron application. Use it before each release, during code reviews, and as
part of automated CI/CD pipelines.

## 1. BrowserWindow Configuration

Every `BrowserWindow` instance must enforce the three security pillars.

```typescript
// SECURE configuration - verify all windows match this pattern
const win = new BrowserWindow({
  webPreferences: {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    preload: path.join(__dirname, 'preload.js'),
    // Additional hardening:
    webviewTag: false,              // Disable <webview> unless needed
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
  },
});
```

### Checklist

- [ ] `contextIsolation` is `true` on every BrowserWindow
- [ ] `sandbox` is `true` on every BrowserWindow
- [ ] `nodeIntegration` is `false` on every BrowserWindow
- [ ] `webviewTag` is `false` unless explicitly required
- [ ] `allowRunningInsecureContent` is `false`
- [ ] `experimentalFeatures` is `false`
- [ ] No BrowserWindow uses `nodeIntegrationInWorker: true`
- [ ] No BrowserWindow uses `nodeIntegrationInSubFrames: true`

**Severity if missing: CRITICAL** - Any of these misconfigurations can lead
to remote code execution through XSS.

See [Context Isolation](./context-isolation.md) for detailed explanation of
each setting and migration guidance.

## 2. Preload Script Security

The preload script is the bridge between main and renderer. It must expose
the minimum necessary API surface.

### Checklist

- [ ] Preload never exposes raw `ipcRenderer` object
- [ ] Preload never exposes `ipcRenderer.send` / `invoke` with dynamic channels
- [ ] Every exposed function targets a specific, named IPC channel
- [ ] Event listeners return unsubscribe functions for cleanup
- [ ] No `require()` calls for Node modules that should stay in main process
- [ ] TypeScript declarations exist for the exposed API (`preload.d.ts`)
- [ ] Preload does not import `fs`, `child_process`, or `path` directly

**Severity if missing: HIGH** - Exposing raw IPC allows attackers to invoke
any main-process handler.

```typescript
// AUDIT: Verify preload follows this pattern
contextBridge.exposeInMainWorld('electronAPI', {
  // Each function maps to exactly one IPC channel
  loadData: () => ipcRenderer.invoke('load-data'),
  // Event listeners return cleanup functions
  onProgress: (cb: (pct: number) => void) => {
    const handler = (_e: IpcRendererEvent, pct: number) => cb(pct);
    ipcRenderer.on('progress', handler);
    return () => ipcRenderer.removeListener('progress', handler);
  },
});
```

## 3. IPC Argument Validation

Every IPC handler in the main process must validate its arguments. The
renderer is untrusted; treat all incoming data as potentially malicious.

### Checklist

- [ ] All `ipcMain.handle` callbacks validate argument types
- [ ] File path arguments are resolved and checked against an allowlist
- [ ] String arguments are length-limited and sanitized
- [ ] No IPC handler passes arguments directly to `child_process.exec`
- [ ] No IPC handler passes arguments directly to `shell.openExternal`
- [ ] Channel names follow a consistent naming convention
- [ ] Unused IPC channels are removed (no dead handlers)

**Severity if missing: CRITICAL** - Unvalidated IPC args are the most common
path to command injection in Electron apps.

```typescript
// main.ts - SECURE: Validate all IPC arguments
import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs/promises';

const ALLOWED_BASE_DIR = '/home/user/documents';

ipcMain.handle('read-file', async (_event, filePath: unknown) => {
  // Type validation
  if (typeof filePath !== 'string') {
    throw new Error('filePath must be a string');
  }

  // Length validation
  if (filePath.length > 500) {
    throw new Error('filePath too long');
  }

  // Path traversal prevention
  const resolved = path.resolve(ALLOWED_BASE_DIR, filePath);
  if (!resolved.startsWith(ALLOWED_BASE_DIR)) {
    throw new Error('Access denied: path outside allowed directory');
  }

  return fs.readFile(resolved, 'utf-8');
});
```

For typed IPC patterns that enforce validation at compile time, see
[Typed IPC Patterns](../ipc/typed-ipc.md).

## 4. Content Security Policy

CSP prevents unauthorized script execution and resource loading in the
renderer.

### Checklist

- [ ] CSP is set via `session.defaultSession.webRequest.onHeadersReceived`
- [ ] `script-src` does NOT include `'unsafe-eval'`
- [ ] `script-src` does NOT include `'unsafe-inline'`
- [ ] `object-src` is set to `'none'`
- [ ] `default-src` is set to `'self'`
- [ ] `connect-src` lists only required API endpoints (no wildcards)
- [ ] `base-uri` is set to `'self'`
- [ ] CSP violations are logged during development
- [ ] CSP is tested with the app's full feature set

**Severity if missing: HIGH** - Missing CSP allows injected scripts to
execute and exfiltrate data.

See [CSP and Permissions](./csp-and-permissions.md) for implementation
details and recommended directive configurations.

## 5. Navigation and External Link Handling

Renderers must not navigate to arbitrary URLs. External links must be
validated before opening in the system browser.

### Checklist

- [ ] `will-navigate` handler blocks navigation to non-app URLs
- [ ] `setWindowOpenHandler` denies new window creation by default
- [ ] `shell.openExternal` calls validate protocol (HTTPS only)
- [ ] `shell.openExternal` calls validate hostname against allowlist
- [ ] No renderer-provided URL is passed to `shell.openExternal` without validation
- [ ] `app.on('web-contents-created')` is used to set handlers on all windows

**Severity if missing: HIGH** - Allows phishing via navigation redirect and
arbitrary protocol handler exploitation.

```typescript
// AUDIT: Verify this pattern exists in main process
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:' && parsed.protocol !== 'app:') {
      event.preventDefault();
    }
  });

  contents.setWindowOpenHandler(({ url }) => {
    safeOpenExternal(url); // Validated helper function
    return { action: 'deny' };
  });
});
```

## 6. Auto-Update Security

Auto-updates are a critical attack vector. A compromised update server or
man-in-the-middle attack can push malicious code to all users.

### Checklist

- [ ] Update server uses HTTPS exclusively
- [ ] Update manifests are signed and verified
- [ ] electron-updater or equivalent validates code signatures
- [ ] Update download URLs are hardcoded (not configurable via IPC)
- [ ] Differential updates are verified against full-file checksums
- [ ] Update errors are logged but do not expose internal paths
- [ ] No fallback to HTTP if HTTPS fails

**Severity if missing: CRITICAL** - Compromised updates affect every user
simultaneously.

```typescript
// main.ts - Secure auto-update configuration
import { autoUpdater } from 'electron-updater';

autoUpdater.autoDownload = false; // Manual control over downloads
autoUpdater.allowDowngrade = false;

autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'your-org',
  repo: 'your-app',
  // For private repos:
  // token: process.env.GH_TOKEN,
});

autoUpdater.on('update-available', (info) => {
  // Notify user, let them choose to download
  mainWindow.webContents.send('update-available', {
    version: info.version,
    releaseNotes: info.releaseNotes,
  });
});

// Never expose update control to the renderer via IPC
// Updates should be triggered by main process logic only
```

## 7. Dependency Security

Third-party packages are the most common source of vulnerabilities in
Electron apps.

### Checklist

- [ ] `npm audit` runs in CI with zero high/critical findings
- [ ] Native Node modules are minimized (each is a C++ attack surface)
- [ ] Dependency versions are pinned (lockfile is committed)
- [ ] No dependencies pull from private registries without auth
- [ ] Electron version is current (within 2 major versions)
- [ ] Unused dependencies are removed
- [ ] Postinstall scripts are reviewed for new dependencies

**Severity if missing: MEDIUM to CRITICAL** - Depends on the vulnerability.

```bash
# Run in CI pipeline
npm audit --audit-level=high
# Exit code is non-zero if high/critical vulnerabilities exist
```

## 8. Build and Packaging

The packaging step must produce tamper-proof, signed artifacts.

### Checklist

- [ ] ASAR archive is enabled (bundles source into single file)
- [ ] ASAR integrity checking is enabled (electron-builder `asarIntegrity`)
- [ ] Code signing is configured for all target platforms
- [ ] macOS builds are notarized with Apple
- [ ] Windows builds use EV code signing certificate
- [ ] Source maps are NOT included in production builds
- [ ] DevTools are disabled in production builds
- [ ] Debug/development IPC channels are stripped in production

**Severity if missing: HIGH** - Unsigned apps trigger security warnings and
can be tampered with post-distribution.

See [Code Signing](../packaging/code-signing.md) and
[CI/CD Patterns](../packaging/ci-cd-patterns.md) for implementation details.

```typescript
// main.ts - Disable DevTools in production
if (app.isPackaged) {
  // Remove DevTools keyboard shortcut
  app.on('browser-window-created', (_event, win) => {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) {
        event.preventDefault();
      }
    });
  });
}
```

## CI/CD Security Scanning

### GitHub Actions Workflow

```yaml
# .github/workflows/security-scan.yml
name: Security Scan
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  security-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - name: NPM audit
        run: npm audit --audit-level=high
      - name: Electronegativity scan
        run: |
          npm install -g @nicedoc/electronegativity
          electronegativity -i ./src --severity high --output json > report.json
          ISSUES=$(jq 'length' report.json)
          [ "$ISSUES" -gt 0 ] && { jq '.' report.json; exit 1; } || true
      - name: Check insecure patterns
        run: |
          grep -r "nodeIntegration:\s*true" src/ && exit 1 || true
          grep -r "contextIsolation:\s*false" src/ && exit 1 || true
          grep -r "ipcRenderer:\s*ipcRenderer" src/ && exit 1 || true
          echo "Pattern checks passed"
```

## Common Vulnerability Patterns

| Pattern | Severity | Fix |
|---------|----------|-----|
| `nodeIntegration: true` | CRITICAL | Set to `false`, use preload |
| Raw `ipcRenderer` exposure | CRITICAL | Expose named functions only |
| Unvalidated `shell.openExternal` | HIGH | Validate protocol and host |
| Missing CSP | HIGH | Add CSP via session headers |
| `eval()` in renderer | HIGH | Remove eval, use safe alternatives |
| Unvalidated IPC file paths | CRITICAL | Resolve and check against allowlist |
| Dynamic IPC channel names | HIGH | Use static channel names only |
| Missing navigation guards | HIGH | Add `will-navigate` handler |
| Unsigned builds | MEDIUM | Enable code signing |
| `webSecurity: false` | CRITICAL | Never set to false |
| Missing permission handler | MEDIUM | Add `setPermissionRequestHandler` |

## Audit Frequency

Run automated CI checks on every pull request. Perform the full manual
checklist before each release, after Electron major upgrades, and quarterly.
After adding native dependencies, review sections 7 and 8 specifically.

## See Also

- [Context Isolation](./context-isolation.md) - Detailed explanation of the
  three security pillars and preload script patterns.
- [CSP and Permissions](./csp-and-permissions.md) - Implementation guide for
  Content Security Policy and permission handlers.
- [Code Signing](../packaging/code-signing.md) - Platform-specific code
  signing configuration for macOS, Windows, and Linux.
- [CI/CD Patterns](../packaging/ci-cd-patterns.md) - Build pipeline
  configuration including security scanning integration.
