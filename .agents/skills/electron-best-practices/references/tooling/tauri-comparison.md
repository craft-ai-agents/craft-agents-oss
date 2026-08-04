# Electron vs Tauri: Decision Matrix

## Overview

Tauri is the primary alternative to Electron for building cross-platform desktop
applications with web technologies. With Tauri 2.0 (released October 2024), the
framework reached a significant milestone: mobile support (iOS and Android),
a stabilized plugin system, and a refined security model. This reference provides
a detailed comparison to help teams make an informed choice between the two
frameworks.

Both frameworks allow you to build desktop applications using HTML, CSS, and
JavaScript for the UI layer. The fundamental difference is in the backend: Electron
runs a full Node.js runtime with a bundled Chromium browser, while Tauri uses Rust
for the backend and delegates rendering to the operating system's native WebView.

---

## Detailed Comparison

| Factor | Electron | Tauri |
|---|---|---|
| Bundle size | 80-150 MB | 2.5-10 MB |
| Memory (idle) | 150-300 MB | 30-40 MB |
| Startup time | 1-3 seconds | <1 second |
| Backend language | JavaScript/TypeScript | Rust |
| Rendering engine | Chromium (bundled) | System WebView |
| Rendering consistency | Identical everywhere | Varies by OS |
| Ecosystem maturity | Very mature | Rapidly growing |
| Mobile support | None | iOS/Android (Tauri 2.0) |
| Node.js modules | Full support | N/A (Rust crates) |
| Native module support | node-gyp, prebuild | Rust FFI |
| Auto-updates | electron-updater | tauri-plugin-updater |
| Security model | Process isolation | Capability-based |
| Learning curve (JS team) | Low | High (requires Rust) |
| Dev tooling | Mature, extensive | Growing |

---

## Bundle Size

Electron bundles a full Chromium browser and Node.js runtime with every application.
This creates a baseline of roughly 80 MB before any application code is added.
With dependencies and assets, production bundles typically land between 80-150 MB.

Tauri uses the operating system's built-in WebView (WebView2 on Windows, WebKit on
macOS/Linux), so it does not ship a browser engine. The Rust backend compiles to a
small native binary. Typical Tauri applications are 2.5-10 MB.

```
# Approximate bundle sizes for a simple "Hello World" app
Electron (macOS arm64):  ~85 MB
Electron (Windows x64):  ~90 MB
Electron (Linux x64):    ~95 MB

Tauri (macOS arm64):     ~3 MB
Tauri (Windows x64):     ~4 MB  (WebView2 runtime may add ~150 MB on first install)
Tauri (Linux x64):       ~5 MB
```

Note: On Windows, Tauri relies on WebView2, which is pre-installed on Windows 10
(version 1803+) and Windows 11. For older systems, the WebView2 runtime must be
installed separately, adding to the effective first-install size.

---

## Memory Usage

Electron's per-process architecture means each BrowserWindow runs its own Chromium
renderer process, each consuming 50-100 MB. A single-window application typically
uses 150-300 MB at idle.

Tauri's memory footprint is significantly smaller because it shares the OS WebView
rather than running a dedicated browser instance. A comparable single-window Tauri
application uses 30-40 MB at idle.

```
# Memory comparison for a typical single-window application
Electron:
  Main process:        ~50 MB
  Renderer process:    ~80 MB
  GPU process:         ~30 MB
  Total:              ~160 MB

Tauri:
  Rust backend:         ~8 MB
  WebView:             ~25 MB
  Total:               ~33 MB
```

For applications that open multiple windows, Electron's memory usage scales linearly
(each window adds another renderer process), while Tauri's WebView windows share
more resources with the OS.

---

## Startup Time

Electron must initialize Chromium, the Node.js runtime, and load application code
through the bundler output. Cold start times range from 1-3 seconds depending on
application complexity and system hardware.

Tauri launches its native Rust binary and initializes the OS WebView, which is
typically under 1 second. The WebView component is already loaded as part of the
operating system, reducing initialization overhead.

---

## Rendering Consistency

This is Electron's strongest advantage. Because Electron bundles Chromium, your
application renders identically on Windows, macOS, and Linux. CSS features,
JavaScript APIs, and rendering behavior are the same on every platform.

Tauri uses the system WebView, which means:
- **macOS**: WebKit (Safari engine) -- generally modern and capable
- **Windows**: WebView2 (Chromium-based Edge) -- close to Chrome behavior
- **Linux**: WebKitGTK -- can lag behind in feature support

This means you must test on all platforms and may need to avoid bleeding-edge CSS
or JavaScript features that one WebView does not support. For pixel-perfect
cross-platform UIs, this is a significant consideration.

```css
/* Example: CSS that may behave differently across WebViews */
.container {
  /* backdrop-filter has inconsistent support in WebKitGTK */
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);  /* Required for WebKit */
}
```

---

## Backend Language and Ecosystem

Electron's backend is JavaScript/TypeScript running in Node.js. This means full
access to the npm ecosystem, seamless code sharing between frontend and backend,
and a single language across the entire stack.

Tauri's backend is Rust. While powerful and performant, this requires the team to
learn and maintain Rust code. The Rust ecosystem (crates.io) is smaller than npm
but growing rapidly, especially for systems programming tasks.

```rust
// Tauri command example (Rust backend)
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|e| e.to_string())
}

// Register in main
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![read_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

```typescript
// Tauri frontend invocation (TypeScript)
import { invoke } from '@tauri-apps/api/core';

const content = await invoke<string>('read_file', { path: '/tmp/data.txt' });
```

Compare with the equivalent Electron pattern:

```typescript
// Electron main process (TypeScript/Node.js)
import { ipcMain } from 'electron';
import { readFile } from 'fs/promises';

ipcMain.handle('read-file', async (_event, path: string) => {
  return readFile(path, 'utf-8');
});
```

---

## Mobile Support

Tauri 2.0 introduced mobile support for iOS and Android, allowing a single codebase
to target desktop and mobile platforms. Mobile builds use the platform's native
WebView (WKWebView on iOS, Android WebView on Android).

Electron has no mobile support and no plans to add it. If mobile is a requirement,
Electron teams typically maintain a separate React Native or Flutter codebase, or
ship a Progressive Web App alongside the desktop application.

---

## Security Models

Electron uses process isolation: the main process (Node.js) is separated from
renderer processes (Chromium) through IPC, with preload scripts acting as a
controlled bridge via `contextBridge`.

Tauri uses a capability-based permission system. Each window or WebView is granted
specific capabilities that define what system APIs it can access. This is configured
declaratively in the Tauri configuration file.

```json
// tauri.conf.json - Capability-based permissions
{
  "app": {
    "security": {
      "capabilities": [
        {
          "identifier": "main-window",
          "windows": ["main"],
          "permissions": [
            "fs:read",
            "fs:write",
            "dialog:open",
            "dialog:save"
          ]
        }
      ]
    }
  }
}
```

---

## When to Choose Electron

**Choose Electron when:**

- **Team is JavaScript/TypeScript only.** Electron requires no additional language
  knowledge. The entire application is written in JS/TS.

- **Consistent cross-platform rendering is essential.** Applications that require
  pixel-perfect rendering across all platforms benefit from Electron's bundled
  Chromium. This is critical for design tools, rich text editors, and data
  visualization applications.

- **You need specific Node.js packages or native modules.** The npm ecosystem is
  vast. If your application depends on packages like better-sqlite3, sharp, or
  other native Node.js modules, Electron provides direct support.

- **Extending an existing Electron codebase.** Migration from Electron to Tauri
  is a significant undertaking. If the application is already working well in
  Electron, the cost of migration rarely justifies the benefits.

- **Maximum ecosystem maturity is required.** Electron has years of production
  battle-testing, extensive documentation, and established patterns for common
  desktop application needs (system tray, global shortcuts, auto-updates,
  crash reporting).

- **Complex desktop-specific features.** Electron's API surface for desktop
  integration (system tray, notifications, global shortcuts, protocol handlers,
  native menus) is comprehensive and well-documented.

---

## When to Choose Tauri

**Choose Tauri when:**

- **Bundle size is critical.** Applications distributed through bandwidth-limited
  channels or to users with slow connections benefit enormously from Tauri's
  2.5-10 MB bundles vs Electron's 80-150 MB.

- **Memory efficiency matters.** Deployment to resource-constrained environments
  (embedded systems, kiosks, older hardware) favors Tauri's smaller footprint.

- **You need mobile support from a single codebase.** Tauri 2.0's iOS and Android
  support allows shipping desktop and mobile from one project.

- **Team has Rust experience or willingness to learn.** Rust's performance and
  safety guarantees are valuable for compute-intensive backend operations.

- **Performance-critical backend operations.** File processing, data
  transformation, cryptography, and other CPU-intensive tasks run significantly
  faster in Rust than in Node.js.

- **Startup speed is important.** Applications that are launched frequently
  (utilities, quick-access tools) benefit from Tauri's sub-second startup.

---

## Migration Considerations

Migrating from Electron to Tauri is non-trivial and involves:

1. **Rewriting the backend in Rust.** All main process logic (IPC handlers, file
   system access, system integration) must be reimplemented as Tauri commands.

2. **Replacing Node.js dependencies.** npm packages used in the main process must
   be replaced with Rust crate equivalents or Tauri plugins.

3. **Adapting the frontend.** Replace `window.electronAPI` calls with Tauri's
   `invoke()` API. The frontend framework (React, Vue, etc.) can remain the same.

4. **Testing across WebViews.** CSS and JavaScript that worked identically in
   Chromium may behave differently across OS WebViews.

5. **Updating CI/CD pipelines.** Build infrastructure must support Rust compilation
   and Tauri's packaging toolchain.

A phased migration is generally not practical -- the backend rewrite requires a
full cutover. Consider running Electron and Tauri versions in parallel during
a transition period if needed.

---

## Team Skill Requirements

| Skill | Electron | Tauri |
|---|---|---|
| JavaScript/TypeScript | Required | Required (frontend) |
| Node.js | Required (backend) | Not used |
| Rust | Not needed | Required (backend) |
| HTML/CSS | Required | Required |
| Platform-specific knowledge | Minimal | Moderate (WebView differences) |

For teams already proficient in JavaScript/TypeScript with no Rust experience,
adopting Tauri adds 2-4 months of learning time before the team is productive
with the backend. Consider this ramp-up period when planning timelines.

---

## See Also

- [electron-vite Configuration](./electron-vite.md) -- Build tooling for Electron
  projects using Vite
- [Electron Forge](./electron-forge.md) -- Packaging and distribution for Electron
  applications
