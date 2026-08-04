# electron-vite: Configuration and Development Workflow

## Overview

electron-vite is a build tool that provides a unified Vite configuration for all
three Electron processes: main, preload, and renderer. It manages three independent
Vite pipelines from a single configuration file, handles environment variable
injection between processes, and coordinates the development server with Electron's
main process lifecycle.

---

## Why Vite Over Webpack for Electron

webpack-based Electron toolchains must bundle the entire dependency graph before
the dev server starts. Vite takes a fundamentally different approach:

- **Dev startup**: Serves source as native ES modules; startup time is nearly
  constant regardless of project size
- **HMR speed**: Changes propagate in milliseconds, not seconds
- **Build speed**: Rollup-based production builds with tree-shaking and code splitting
- **Plugin ecosystem**: Full Vite plugin ecosystem including `@vitejs/plugin-react`
  for Fast Refresh

---

## Installation and Scaffolding

### New Project from Template

The fastest way to start is the official template scaffolding command:

```bash
# React with TypeScript (recommended)
npm create @quick-start/electron@latest my-app -- --template react-ts

# Other available templates
npm create @quick-start/electron@latest my-app -- --template vue-ts
npm create @quick-start/electron@latest my-app -- --template svelte-ts
npm create @quick-start/electron@latest my-app -- --template vanilla-ts
```

This generates a project with TypeScript configured per process, secure defaults
(contextIsolation, sandbox), and a working electron-vite configuration.

### Adding to an Existing Project

```bash
npm install --save-dev electron-vite

# Peer dependencies for React projects
npm install --save-dev @vitejs/plugin-react
```

---

## Unified Configuration File

The `electron.vite.config.ts` file defines build configuration for all three
processes. Each top-level key (`main`, `preload`, `renderer`) is an independent
Vite configuration that can have its own plugins, aliases, and build targets.

```typescript
// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
      },
    },
  },
  renderer: {
    plugins: [react()],
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
});
```

---

## Main Process Configuration

The main process runs in Node.js and needs special handling:

- **Target**: Node.js (not browser). electron-vite sets this automatically
- **Externals**: Node.js built-ins and Electron APIs must not be bundled.
  The `externalizeDepsPlugin()` handles this by externalizing all dependencies
  listed in `package.json`
- **Native modules**: Packages using native bindings (better-sqlite3, sharp) must
  be externalized so they resolve at runtime from `node_modules`

```typescript
// Main process with selective externalization
main: {
  plugins: [
    externalizeDepsPlugin({
      // Explicitly include specific packages in the bundle
      exclude: ['lodash-es'],
    }),
  ],
  build: {
    rollupOptions: {
      input: resolve(__dirname, 'src/main/index.ts'),
      output: {
        // Use CommonJS for maximum Node.js compatibility
        format: 'cjs',
      },
    },
  },
},
```

---

## Preload Script Configuration

Preload scripts run in a restricted context with access to `contextBridge`. When
sandbox mode is enabled (recommended), preload scripts cannot use `require()` for
Node.js modules at runtime. electron-vite handles this by bundling the preload
script as a single file with all dependencies resolved at build time.

```typescript
preload: {
  plugins: [externalizeDepsPlugin()],
  build: {
    // Sandbox-compatible: bundle into a single file
    rollupOptions: {
      input: resolve(__dirname, 'src/preload/index.ts'),
      output: {
        format: 'cjs',
      },
    },
  },
},
```

The `externalizeDepsPlugin()` in the preload context externalizes only Electron
itself (since `electron` is available in the preload context), while bundling
everything else into the output file.

---

## Renderer Configuration

The renderer process is configured as a standard Vite web application. This means
full access to the Vite plugin ecosystem, including React Fast Refresh for instant
component updates without losing state.

```typescript
renderer: {
  plugins: [react()],
  root: resolve(__dirname, 'src/renderer'),
  build: {
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.html'),
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  // Custom server configuration for development
  server: {
    port: 5173,
    strictPort: true,
  },
},
```

React Fast Refresh preserves component state during edits, making UI development
significantly faster than full-page reloads. It works automatically with the
`@vitejs/plugin-react` plugin.

---

## Development Server and Hot Reloading

The `electron-vite dev` command orchestrates three coordinated build processes:

1. Builds the main process and preload scripts (watching for changes)
2. Starts the Vite dev server for the renderer process (with HMR)
3. Launches Electron, connecting the main process to the dev server

```json
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit"
  }
}
```

When files change during development:
- **Renderer changes**: Instant HMR via Vite, no restart needed
- **Preload changes**: Preload script is rebuilt and the BrowserWindow is reloaded
- **Main process changes**: Main process is rebuilt and Electron is restarted

---

## Environment Variables

electron-vite uses Vite's built-in environment variable system. Variables prefixed
with `VITE_` are exposed to the renderer process. The main and preload processes
have access to all `process.env` variables as usual.

```bash
# .env
VITE_APP_TITLE=My Electron App
VITE_API_URL=https://api.example.com

# .env.development
VITE_API_URL=http://localhost:3000

# .env.production
VITE_API_URL=https://api.example.com
```

```typescript
// In renderer code
const title = import.meta.env.VITE_APP_TITLE;
const apiUrl = import.meta.env.VITE_API_URL;

// In main process code (use process.env as normal)
const nodeEnv = process.env.NODE_ENV;
```

electron-vite also injects `ELECTRON_RENDERER_URL` into the main process during
development, which contains the dev server URL for loading into BrowserWindow.

---

## Path Aliases

Path aliases reduce the need for deeply nested relative imports. Configure them
in the electron-vite config and mirror them in `tsconfig.json` for TypeScript.

```typescript
// electron.vite.config.ts - aliases section
resolve: {
  alias: {
    '@': resolve(__dirname, 'src/renderer/src'),
    '@shared': resolve(__dirname, 'src/shared'),
    '@components': resolve(__dirname, 'src/renderer/src/components'),
    '@hooks': resolve(__dirname, 'src/renderer/src/hooks'),
  },
},
```

```jsonc
// tsconfig.web.json - matching paths for TypeScript
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/renderer/src/*"],
      "@shared/*": ["./src/shared/*"],
      "@components/*": ["./src/renderer/src/components/*"],
      "@hooks/*": ["./src/renderer/src/hooks/*"]
    }
  }
}
```

---

## Plugin Ecosystem and Production Builds

The renderer process supports all standard Vite plugins (TailwindCSS, SVG loaders,
etc.). The main and preload processes support Vite plugins targeting Node.js.

For production, electron-vite compiles all three processes into optimized bundles
in the `out/` directory with tree-shaking, code splitting, and asset optimization.

```typescript
// Production-specific renderer configuration with plugins and optimization
renderer: {
  plugins: [react()],
  build: {
    minify: 'terser',
    terserOptions: {
      compress: { drop_console: true, drop_debugger: true },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          vendor: ['zustand', 'react-router-dom'],
        },
      },
    },
    reportCompressedSize: true,
  },
},
```

```bash
# Build all three processes
electron-vite build

# Preview the production build (loads from out/ directory)
electron-vite preview
```

---

## See Also

- [Project Structure](../architecture/project-structure.md) -- Directory layout
  and how electron-vite configuration fits into the overall project organization
- [Electron Forge](./electron-forge.md) -- Packaging and distribution after
  building with electron-vite
- [Bundle Optimization](../packaging/bundle-optimization.md) -- Strategies for
  reducing production bundle size
