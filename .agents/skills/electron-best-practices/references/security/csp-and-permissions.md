# Content Security Policy and Permission Management

Content Security Policy (CSP) and permission handling form the second layer of
defense in an Electron application. While context isolation prevents direct
access to Node.js APIs, CSP prevents execution of unauthorized scripts and
limits what resources the renderer can load.

## Why CSP Matters in Electron

Traditional web apps receive CSP headers from the server. Electron apps often
load content from `file://` URLs or custom protocols, which means there are
no server headers by default. Without explicit CSP configuration, the renderer
has no restrictions on script sources, inline execution, or resource loading.

This means:
- Injected `<script>` tags will execute without restriction.
- Inline event handlers (`onclick="..."`) run freely.
- External resources can be loaded from any origin.
- `eval()` and `new Function()` are available to attackers.

## Setting CSP via Session Headers (Recommended)

The most reliable way to enforce CSP in Electron is through the session's
`webRequest` API. This intercepts all responses and injects the CSP header,
regardless of the content source:

```typescript
// main.ts - Set CSP via session headers
import { app, session } from 'electron';

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "font-src 'self' data:",
            "connect-src 'self' https://api.example.com",
            "object-src 'none'",
            "base-uri 'self'",
          ].join('; '),
        ],
      },
    });
  });
});
```

### Why Session Headers Over Meta Tags

| Approach           | Enforced On          | Can Be Bypassed By    | Covers Subframes |
|--------------------|----------------------|-----------------------|-------------------|
| Session headers    | All loaded content   | Nothing in renderer   | Yes               |
| `<meta>` tag       | Document it's in     | Dynamic DOM injection | No                |

Session headers apply universally and cannot be circumvented by renderer-side
code. Meta tags are parsed by the renderer and can be stripped or ignored
if an attacker controls DOM manipulation.

## Setting CSP via Meta Tag (Fallback)

If you cannot use session headers (rare), the meta tag approach works as a
fallback:

```html
<!-- index.html - CSP via meta tag (less preferred) -->
<!DOCTYPE html>
<html>
  <head>
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    />
    <title>My App</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="./renderer.js"></script>
  </body>
</html>
```

Note that the meta tag must appear before any `<script>` or `<link>` elements
to be effective.

## Recommended CSP Directives

### Minimal Secure CSP (Local Content Only)

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self' data:; connect-src 'self';
object-src 'none'; base-uri 'self';
```

For apps with API connections, add specific origins to `connect-src` (e.g.,
`connect-src 'self' https://api.example.com`). For remote content, add
trusted CDN origins to `script-src` and `style-src` as needed. Never use
wildcards.

### Directive Reference

| Directive     | Purpose                                  | Recommended Value      |
|---------------|------------------------------------------|------------------------|
| `default-src` | Fallback for all resource types          | `'self'`               |
| `script-src`  | JavaScript sources                       | `'self'` (never eval)  |
| `style-src`   | Stylesheet sources                       | `'self' 'unsafe-inline'` |
| `img-src`     | Image sources                            | `'self' data:`         |
| `connect-src` | XHR, fetch, WebSocket targets            | `'self'` + API URLs    |
| `object-src`  | Plugin content (Flash, Java)             | `'none'`               |
| `base-uri`    | Restricts `<base>` element               | `'self'`               |
| `frame-src`   | Iframe sources                           | `'none'` or specific   |

**Never use** `'unsafe-eval'` in `script-src`. If a framework requires it
(some template engines do), switch to a precompiled template approach.

## Permission Request Handling

Electron exposes Chromium's permission system. By default, permission requests
from renderers are granted silently. You must explicitly handle them:

```typescript
// main.ts - Permission request handler
import { session } from 'electron';

app.whenReady().then(() => {
  // Define which permissions your app actually needs
  const ALLOWED_PERMISSIONS = new Set<string>([
    'clipboard-read',
    'notifications',
  ]);

  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const url = webContents.getURL();

      // Only allow permissions from your own app
      if (!url.startsWith('file://') && !url.startsWith('app://')) {
        console.warn(`Blocked permission "${permission}" from external URL: ${url}`);
        callback(false);
        return;
      }

      if (ALLOWED_PERMISSIONS.has(permission)) {
        callback(true);
      } else {
        console.warn(`Blocked permission request: ${permission}`);
        callback(false);
      }
    }
  );
});
```

### Blocking Permissions by Default

A strict handler that denies everything except explicitly allowed permissions:

```typescript
// main.ts - Strict permission handler with logging
session.defaultSession.setPermissionRequestHandler(
  (webContents, permission, callback, details) => {
    const origin = new URL(webContents.getURL()).origin;

    // Whitelist: only these origin+permission pairs are allowed
    const PERMISSION_WHITELIST: Record<string, Set<string>> = {
      'file://': new Set(['clipboard-read', 'notifications']),
      'app://myapp': new Set(['clipboard-read', 'notifications', 'media']),
    };

    const allowed = PERMISSION_WHITELIST[origin]?.has(permission) ?? false;

    if (!allowed) {
      console.warn(
        `Permission denied: ${permission} for ${origin}`,
        details ? `(${JSON.stringify(details)})` : ''
      );
    }

    callback(allowed);
  }
);

// Also handle permission checks (synchronous queries)
session.defaultSession.setPermissionCheckHandler(
  (webContents, permission, requestingOrigin) => {
    const ALLOWED_CHECKS = new Set(['clipboard-read', 'notifications']);
    return ALLOWED_CHECKS.has(permission);
  }
);
```

## Navigation Restrictions

Prevent renderers from navigating to arbitrary URLs. This stops phishing
attacks where injected code redirects to a malicious login page:

```typescript
// main.ts - Navigation restrictions
import { app, shell } from 'electron';

app.on('web-contents-created', (_event, contents) => {
  // Block all navigation away from the app
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);

    // Allow navigation within the app only
    if (parsedUrl.protocol !== 'file:' && parsedUrl.protocol !== 'app:') {
      event.preventDefault();
      console.warn(`Blocked navigation to: ${navigationUrl}`);
    }
  });

  // Handle new window requests (target="_blank", window.open)
  contents.setWindowOpenHandler(({ url }) => {
    // Validate URL before opening in external browser
    const ALLOWED_EXTERNAL_HOSTS = new Set([
      'docs.example.com',
      'support.example.com',
      'github.com',
    ]);

    try {
      const parsedUrl = new URL(url);
      if (
        parsedUrl.protocol === 'https:' &&
        ALLOWED_EXTERNAL_HOSTS.has(parsedUrl.hostname)
      ) {
        shell.openExternal(url);
      } else {
        console.warn(`Blocked external URL: ${url}`);
      }
    } catch {
      console.warn(`Invalid URL blocked: ${url}`);
    }

    return { action: 'deny' }; // Never open a new Electron window
  });
});
```

### shell.openExternal Validation

`shell.openExternal` launches the system's default handler for a URL. Without
validation, it can be exploited to run arbitrary protocols:

```typescript
// INSECURE - Never pass unvalidated URLs
shell.openExternal(userProvidedUrl); // Could be file://, smb://, or custom://

// SECURE - Validate protocol and host
function safeOpenExternal(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;

    const ALLOWED_HOSTS = new Set(['docs.example.com', 'github.com']);
    if (!ALLOWED_HOSTS.has(parsed.hostname)) return false;

    shell.openExternal(url);
    return true;
  } catch {
    return false;
  }
}
```

## Webview Tag Restrictions

If your app uses `<webview>` tags (generally discouraged in favor of
`BrowserView` or controlled `BrowserWindow`), restrict their capabilities:

```typescript
// main.ts - Restrict webview tags
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    // Strip away preload scripts from webviews
    delete webPreferences.preload;

    // Enforce security settings
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
    webPreferences.sandbox = true;

    // Only allow loading from trusted sources
    if (!params.src.startsWith('https://trusted-embed.example.com')) {
      event.preventDefault();
      console.warn(`Blocked webview src: ${params.src}`);
    }
  });
});
```

## Automated Security Auditing with Electronegativity

Electronegativity is a static analysis tool that scans Electron apps for
security misconfigurations. It checks for insecure `BrowserWindow` options,
missing CSP headers, dangerous API usage, and more.

```bash
# Install globally
npm install -g @nicedoc/electronegativity

# Scan your project
electronegativity -i ./src -o ./security-report.json

# Scan with severity threshold (fails CI if issues found)
electronegativity -i ./src --severity high
```

### CI Integration

Run Electronegativity as part of your build pipeline to catch security
regressions before they ship. See
[Security Checklist](./security-checklist.md) for a complete CI workflow
example including the GitHub Actions configuration.

## CSP Debugging

During development, use `Content-Security-Policy-Report-Only` instead of
`Content-Security-Policy` to log violations without blocking resources.
CSP violations appear in the DevTools console as "Refused to..." messages.

## Common CSP Mistakes

1. **Using `'unsafe-eval'`** - Opens the door to `eval()` attacks. If your
   bundler output requires it, switch to a CSP-compatible build mode.
2. **Wildcard `connect-src`** - `connect-src *` allows the renderer to
   exfiltrate data to any server.
3. **Forgetting `object-src 'none'`** - Allows plugin-based attacks.
4. **Not setting CSP at all** - The most common mistake. No CSP means no
   script source restrictions.
5. **Setting CSP only in HTML** - Meta tags can be bypassed. Use session
   headers as described above.

## See Also

- [Context Isolation](./context-isolation.md) - The primary security boundary
  that CSP complements with script-source restrictions.
- [Security Checklist](./security-checklist.md) - Pre-deployment audit
  checklist including CSP verification steps.
- [Electron-Vite Configuration](../tooling/electron-vite.md) - Build tool
  configuration that affects CSP compatibility (hash-based script loading).
