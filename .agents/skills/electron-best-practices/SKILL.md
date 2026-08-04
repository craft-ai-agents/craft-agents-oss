---
name: electron-best-practices
description: "Guide AI agents through Electron app development with React including security patterns, type-safe IPC, React integration, packaging with code signing, and testing. Keywords: electron, electron-vite, electron-forge, contextBridge, IPC, security, react, packaging, code signing, notarization, playwright, desktop app."
license: MIT
compatibility: Requires Deno for analysis scripts. Applicable to any Electron project using TypeScript and React.
metadata:
  author: agent-skills
  version: "1.0"
  domain: development
  type: utility
  mode: assistive
---

# Electron + React Best Practices

Guide AI agents in building secure, production-ready Electron applications with React. This skill provides security patterns, type-safe IPC communication, project setup guidance, packaging and code signing workflows, and tools for analysis, scaffolding, and type generation.

## When to Use This Skill

Use this skill when:
- Generating Electron main, preload, or renderer process code
- Configuring electron-vite or Electron Forge
- Setting up IPC communication between processes
- Implementing security patterns (contextBridge, sandbox, CSP)
- Packaging, signing, and notarizing desktop applications
- Testing Electron apps with Playwright
- Designing multi-window architectures

Do NOT use this skill when:
- Building Tauri apps (different paradigm, use Tauri-specific guidance)
- Building pure web apps with no desktop requirements
- Targeting Electron versions below 20 (security defaults differ)
- Using non-React renderer frameworks (use framework-specific skills)

## Core Principles

### 1. Security First Architecture

Modern Electron security relies on three defaults that became standard in Electron 20+: context isolation, sandbox mode, and nodeIntegration disabled. Disabling any of them allows XSS attacks to escalate to full remote code execution. All main-renderer communication must flow through contextBridge:

```typescript
// preload.ts - SECURE pattern
contextBridge.exposeInMainWorld('electronAPI', {
  loadPreferences: () => ipcRenderer.invoke('load-prefs'),
  saveFile: (content: string) => ipcRenderer.invoke('save-file', content),
  onUpdateCounter: (callback: (value: number) => void) => {
    const handler = (_event: IpcRendererEvent, value: number) => callback(value);
    ipcRenderer.on('update-counter', handler);
    return () => ipcRenderer.removeListener('update-counter', handler);
  }
});
```

Set Content Security Policy via HTTP headers for apps loading local files, restricting script sources to `'self'`.

### 2. Type-Safe IPC Communication

The invoke/handle pattern is preferred over send/on for request-response communication, providing proper async/await semantics and error propagation. For typed channels, use a mapped type pattern:

```typescript
type IpcChannelMap = {
  'load-prefs': { args: []; return: UserPreferences };
  'save-file': { args: [content: string]; return: { success: boolean } };
};
```

For complex applications, electron-trpc provides full type safety using tRPC's router pattern with Zod validation:

```typescript
export const appRouter = t.router({
  greeting: t.procedure
    .input(z.object({ name: z.string() }))
    .query(({ input }) => `Hello, ${input.name}!`),
});
```

Error handling across the IPC boundary requires attention because Electron only serializes the `message` property of Error objects. Wrap responses in a `{ success, data, error }` result type to preserve full error context.

### 3. Modern Project Setup

The recommended stack uses electron-vite for development and Electron Forge for packaging. electron-vite provides a unified configuration managing main, preload, and renderer processes with sub-second dev server startup and instant HMR. Electron Forge uses first-party Electron packages for signing and notarization.

```
src/
├── main/           # Main process (Node.js environment)
│   ├── index.ts
│   └── ipc/        # IPC handlers
├── preload/        # Secure bridge via contextBridge
│   ├── index.ts
│   └── index.d.ts  # TypeScript declarations for exposed APIs
└── renderer/       # React application (pure web, no Node access)
    ├── src/
    └── index.html
```

### 4. React Integration Patterns

React 18's concurrent features work normally in Electron's Chromium-based renderer. Strict Mode's double-invocation of effects catches IPC listener leaks that would otherwise cause memory issues. Always return cleanup functions from effects that register IPC listeners:

```typescript
useEffect(() => {
  const cleanup = window.electronAPI.onUpdateCounter((value) => {
    setCount(value);
  });
  return cleanup;
}, []);
```

For multi-window applications, the main process should serve as the single source of truth for shared state. Use electron-store for persistence combined with IPC broadcasting so any window's mutation updates all others.

## Quick Reference

| Category | Prefer | Avoid |
|----------|--------|-------|
| Security | `contextBridge.exposeInMainWorld()` | `nodeIntegration: true` |
| IPC | `invoke/handle` pattern | `send/on` for request-response |
| Preload | Typed function wrappers | Exposing raw `ipcRenderer` |
| Build tool | electron-vite | webpack-based toolchains |
| Packaging | Electron Forge | Manual packaging |
| State | Zustand + electron-store | Redux for simple apps |
| Testing | Playwright E2E | Spectron (deprecated) |
| Updates | electron-updater | Manual update checks |
| Signing | CI-integrated code signing | Unsigned releases |
| CSP | HTTP headers, `'self'` only | No CSP |
| Error handling | Result type `{success, data, error}` | Raw Error across IPC |
| Multi-window | Main process as state hub | Direct window-to-window |

## Code Generation Guidelines

When generating Electron code, follow these patterns:

### BrowserWindow Creation

```typescript
const win = new BrowserWindow({
  webPreferences: {
    preload: path.join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  },
});
```

Always enable contextIsolation and sandbox. Never enable nodeIntegration. The preload path must resolve to the built output location.

### IPC Handler Module

```typescript
export function registerFileHandlers(): void {
  ipcMain.handle('save-file', async (_event, content: string) => {
    try {
      await fs.writeFile(filePath, content);
      return { success: true, data: filePath };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
```

Group related handlers into modules. Use the result type pattern for all return values. Validate all arguments received from the renderer process.

## Common Anti-Patterns

Avoid these patterns when generating Electron code:

| Anti-Pattern | Problem | Solution |
|--------------|---------|----------|
| `nodeIntegration: true` | XSS escalates to full RCE | Keep disabled (default) |
| Exposing `ipcRenderer` directly | Full IPC access from renderer | Wrap in contextBridge functions |
| Missing `contextIsolation` | Renderer accesses preload scope | Keep enabled (default since Electron 12) |
| No code signing | OS security warnings, Gatekeeper blocks | Sign and notarize for all platforms |
| `BrowserWindow` without sandbox | Preload has full Node.js access | Enable sandbox (default since Electron 20) |
| Unvalidated IPC arguments | Injection attacks from renderer | Validate with Zod or manual checks |
| `0.0.0.0` server binding | Network-exposed local server | Always bind to `127.0.0.1` |
| Missing CSP headers | Script injection vectors | Set strict CSP via HTTP headers |
| No IPC error serialization | Lost error context across boundary | Use Result type pattern |
| Spectron for testing | Deprecated, Electron 13 max | Use Playwright |

See `references/security/security-checklist.md` for the full security audit checklist.

## Scripts Reference

### analyze-security.ts

Analyze Electron projects for security misconfigurations:

```bash
deno run --allow-read scripts/analyze-security.ts <path> [options]

Options:
  --strict    Enable all checks
  --json      Output JSON for CI
  -h, --help  Show help

Examples:
  # Analyze a project
  deno run --allow-read scripts/analyze-security.ts ./src

  # Strict mode for CI pipeline
  deno run --allow-read scripts/analyze-security.ts ./src --strict --json
```

### scaffold-electron-app.ts

Scaffold a new Electron + React project with secure defaults:

```bash
deno run --allow-read --allow-write scripts/scaffold-electron-app.ts [options]

Options:
  --name <name>     App name (required)
  --path <path>     Target directory (default: ./)
  --with-react      Include React setup
  --with-trpc       Include electron-trpc
  --with-tests      Include Playwright tests

Examples:
  # Basic app with React
  deno run --allow-read --allow-write scripts/scaffold-electron-app.ts \
    --name "my-app" --with-react

  # Full setup with trpc and tests
  deno run --allow-read --allow-write scripts/scaffold-electron-app.ts \
    --name "my-app" --with-react --with-trpc --with-tests
```

### generate-ipc-types.ts

Generate TypeScript type definitions from IPC handler files:

```bash
deno run --allow-read --allow-write scripts/generate-ipc-types.ts [options]

Options:
  --handlers <path>  Path to IPC handler files
  --output <path>    Output path for type definitions
  --validate         Validate existing types match handlers

Examples:
  # Generate types from handlers
  deno run --allow-read --allow-write scripts/generate-ipc-types.ts \
    --handlers ./src/main/ipc --output ./src/preload/ipc-types.d.ts

  # Validate types in CI
  deno run --allow-read scripts/generate-ipc-types.ts \
    --handlers ./src/main/ipc --validate
```

## Additional Resources

### Security
- `references/security/context-isolation.md` - contextBridge and isolation patterns
- `references/security/csp-and-permissions.md` - Content Security Policy configuration
- `references/security/security-checklist.md` - Full security audit checklist

### IPC Communication
- `references/ipc/typed-ipc.md` - Typed channel map patterns
- `references/ipc/electron-trpc.md` - tRPC integration for full type safety
- `references/ipc/error-serialization.md` - Result types across IPC boundary

### Architecture
- `references/architecture/project-structure.md` - Directory organization
- `references/architecture/process-separation.md` - Main, preload, and renderer roles
- `references/architecture/multi-window-state.md` - Shared state across windows

### React Integration
- `references/integration/react-patterns.md` - useEffect cleanup, Strict Mode
- `references/integration/state-management.md` - Zustand and electron-store patterns

### Packaging & Distribution
- `references/packaging/code-signing.md` - Platform-specific signing workflows
- `references/packaging/auto-updates.md` - electron-updater configuration
- `references/packaging/bundle-optimization.md` - Size reduction techniques
- `references/packaging/ci-cd-patterns.md` - GitHub Actions matrix builds

### Testing
- `references/testing/playwright-e2e.md` - Playwright Electron support
- `references/testing/unit-testing.md` - Jest/Vitest multi-project configuration
- `references/testing/test-structure.md` - Test organization patterns

### Tooling
- `references/tooling/electron-vite.md` - Build tool configuration
- `references/tooling/electron-forge.md` - Packaging and distribution
- `references/tooling/tauri-comparison.md` - When to choose Tauri instead

### Templates
- `assets/templates/main-process.ts.md` - Main process starter template
- `assets/templates/preload-script.ts.md` - Preload script with contextBridge
- `assets/templates/ipc-handler.ts.md` - IPC handler module template
- `assets/templates/react-root.tsx.md` - React root component template

### Configuration Examples
- `assets/configs/electron-vite.config.ts.md` - electron-vite configuration
- `assets/configs/forge.config.js.md` - Electron Forge configuration
- `assets/configs/tsconfig.json.md` - TypeScript configuration presets
- `assets/configs/playwright.config.ts.md` - Playwright Electron test config

### Complete Examples
- `assets/examples/typed-ipc-example.md` - End-to-end typed IPC walkthrough
- `assets/examples/multi-window-example.md` - Multi-window state management
