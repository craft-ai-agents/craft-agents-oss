# TypeScript Configuration for Electron

Electron applications span three distinct execution environments -- the main process (Node.js), the preload script (Node.js with restricted context), and the renderer process (browser). Each environment has different available APIs and module systems. Using separate TypeScript configurations ensures that type checking is accurate for each process: the main process gets Node.js types without DOM, the renderer gets DOM types with JSX support, and shared code is available to both through project references.

## Base Configuration

The root `tsconfig.json` defines shared compiler options and wires together the sub-projects via references. It does not compile anything directly.

```json
{
  "compilerOptions": {
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

## Node Configuration (Main + Preload)

The `tsconfig.node.json` covers the main process, preload scripts, and shared utilities. It targets the Node.js runtime and includes only Node.js type definitions.

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ESNext",
    "lib": ["ESNext"],
    "outDir": "./out",
    "types": ["node"],
    "paths": {
      "@shared/*": ["./src/shared/*"]
    }
  },
  "include": [
    "src/main/**/*",
    "src/preload/**/*",
    "src/shared/**/*",
    "electron.vite.config.ts"
  ]
}
```

## Web Configuration (Renderer)

The `tsconfig.web.json` covers the renderer process. It includes DOM type definitions and JSX support for React components, while still having access to shared types.

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ESNext",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "outDir": "./out",
    "types": ["node"],
    "paths": {
      "@/*": ["./src/renderer/src/*"],
      "@shared/*": ["./src/shared/*"]
    }
  },
  "include": [
    "src/renderer/**/*",
    "src/shared/**/*",
    "src/preload/index.d.ts"
  ]
}
```

## Notes

### Why Separate Configurations Matter

Without separate configs, you encounter two categories of problems:

1. **False positives in the main process.** If DOM types are globally available, code in the main process can accidentally reference `window`, `document`, or `HTMLElement` without any compiler error. These references will crash at runtime because the main process has no DOM.

2. **Missing types in the renderer.** If you only include Node.js types, the renderer process cannot use DOM APIs like `querySelector` or `addEventListener`. You end up either adding `@ts-ignore` comments everywhere or pulling in all types globally, which brings back problem number one.

Separate configs ensure each process only sees the types it can actually use at runtime.

### Project References and Composite

The `composite: true` flag enables TypeScript project references, which allow incremental builds across sub-projects. When you run `tsc --build`, TypeScript only recompiles projects whose source files have changed. This significantly speeds up type checking in larger Electron applications.

The root `tsconfig.json` uses the `references` array to declare the dependency graph. Tools like electron-vite understand this structure automatically.

### Module Resolution Strategy

The `"moduleResolution": "bundler"` setting tells TypeScript to resolve modules the way modern bundlers (Vite, webpack, esbuild) do. This supports features like package.json `exports` fields and path aliases without requiring additional configuration. It is the recommended setting for any project using a bundler.

### Path Aliases

Both configs define `@shared/*` pointing to `src/shared/*`, ensuring that shared types, constants, and utilities can be imported consistently across processes. The renderer config adds `@/*` for its own source tree. These aliases must match the corresponding entries in `electron.vite.config.ts` for the bundler to resolve them at build time.

### Preload Type Declarations

The web config includes `src/preload/index.d.ts` in its `include` array. This file should declare the types for the APIs exposed via `contextBridge.exposeInMainWorld()` in the preload script. This allows the renderer to have full type safety when calling IPC methods through the bridge:

```typescript
// src/preload/index.d.ts
export interface ElectronAPI {
  sendMessage: (channel: string, data: unknown) => void;
  onMessage: (channel: string, callback: (data: unknown) => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
```

### Adding New Processes or Windows

If your application has multiple renderer windows with different capabilities (e.g., a main editor window and a settings window), you can create additional tsconfig files that extend the base and include only the relevant source directories. Register each as a new reference in the root config.
