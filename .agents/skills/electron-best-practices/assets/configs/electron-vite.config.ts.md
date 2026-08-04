# electron-vite Configuration

electron-vite provides a unified build configuration for all three Electron processes (main, preload, and renderer) using Vite under the hood. This eliminates the need for separate webpack or rollup configs and provides fast HMR during development. The configuration below demonstrates a production-ready setup with React in the renderer, proper path aliasing across processes, and environment-aware optimizations.

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
      // Production optimizations
      minify: process.env.NODE_ENV === 'production' ? 'terser' : false,
      sourcemap: process.env.NODE_ENV !== 'production',
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
      sourcemap: process.env.NODE_ENV !== 'production',
    },
  },
  renderer: {
    plugins: [react()],
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
          },
        },
      },
      minify: process.env.NODE_ENV === 'production' ? 'terser' : false,
      sourcemap: process.env.NODE_ENV !== 'production',
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

## Customization Notes

### externalizeDepsPlugin

The `externalizeDepsPlugin()` is critical for the main and preload processes. It externalizes all Node.js dependencies so they are not bundled into the output -- they remain as `require()` calls resolved at runtime from `node_modules`. This avoids issues with native modules and keeps the bundle size small. Do **not** apply this plugin to the renderer process, which runs in a browser-like context and needs its dependencies bundled.

### Path Aliases

The `@shared` alias is available in both the main process and the renderer, enabling shared type definitions, constants, and utility functions. The renderer additionally has `@` pointing to its own source root for cleaner imports. When adding aliases, ensure matching entries exist in the corresponding `tsconfig.json` paths to keep TypeScript and the bundler in sync.

### Manual Chunks

The `manualChunks` configuration in the renderer output splits large vendor libraries (React, React DOM) into a separate chunk. This improves caching behavior -- your application code can change without invalidating the vendor bundle. Add additional entries for other large dependencies like state management libraries or UI component frameworks.

### Environment-Aware Builds

Sourcemaps are enabled in development for debugging and disabled in production to reduce bundle size and avoid exposing source code. Minification via `terser` is only applied for production builds. If you prefer `esbuild` for faster minification at the cost of slightly larger output, replace `'terser'` with `'esbuild'`.

### Multiple Preload Scripts

If your application uses multiple `BrowserWindow` instances each with a different preload script, expand the preload input to an object:

```typescript
preload: {
  plugins: [externalizeDepsPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/preload/main.ts'),
        settings: resolve(__dirname, 'src/preload/settings.ts'),
      },
    },
  },
},
```

### Development Server Configuration

electron-vite starts a Vite dev server for the renderer automatically. To customize the port or proxy API requests during development, add a `server` block inside the `renderer` config:

```typescript
renderer: {
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  // ...rest of renderer config
},
```
