# Bundle Size Optimization and Performance

## Overview

An unoptimized Electron app easily ships at 120-150 MB or more. With careful
attention to bundling, tree shaking, asset optimization, and native module
handling, you can reduce this to 45-60 MB. This matters for download times,
disk usage, and differential update size.

---

## Size Budget

| Component | Unoptimized | Target | Notes |
|-----------|------------|--------|-------|
| Electron binary | ~70 MB | ~70 MB | Fixed cost, cannot reduce |
| App code (main) | 5-15 MB | 1-3 MB | Tree shaking, minification |
| App code (renderer) | 10-30 MB | 3-8 MB | Code splitting, lazy loading |
| Node modules | 30-50 MB | 5-15 MB | Prune devDeps, externalize natives |
| Assets | 10-30 MB | 5-10 MB | Compress images, subset fonts |

---

## Build Configuration with electron-vite

```typescript
// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['better-sqlite3', 'sharp'], // Native modules
      },
      minify: 'terser',
      terserOptions: {
        compress: { drop_console: true, drop_debugger: true, passes: 2 },
      },
      sourcemap: false,
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      minify: 'terser',
      sourcemap: false,
      rollupOptions: {
        output: { inlineDynamicImports: true }, // Single file, no splitting
      },
    },
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
            ui: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu'],
          },
        },
      },
      sourcemap: false,
      minify: 'terser',
      chunkSizeWarningLimit: 500,
    },
  },
});
```

### Source Map Strategy

Use `'source-map'` in development, `false` or `'hidden'` in production. If you use
Sentry or Bugsnag, upload maps during build then delete them from the bundle:

```bash
npx sentry-cli sourcemaps upload --release=$VERSION ./out/renderer
rm -rf ./out/renderer/**/*.map
```

---

## Tree Shaking

```typescript
// BAD - Imports entire library
import _ from 'lodash';

// GOOD - Named import from subpath
import groupBy from 'lodash/groupBy';

// BEST - ES module version for full tree shaking
import { groupBy } from 'lodash-es';
```

Mark packages as side-effect-free in `package.json`:

```json
{ "sideEffects": ["*.css", "*.scss", "./src/renderer/global-setup.ts"] }
```

---

## Lazy Loading

### Route-Based Code Splitting

```tsx
import { lazy, Suspense } from 'react';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Settings = lazy(() => import('./pages/Settings'));
const Analytics = lazy(() => import('./pages/Analytics'));

function App() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/analytics" element={<Analytics />} />
      </Routes>
    </Suspense>
  );
}
```

### Dynamic Import in Main Process

```typescript
export async function runHeavyAnalysis(data: Buffer): Promise<Result> {
  const sharp = await import('sharp'); // 25+ MB, load only when needed
  return sharp.default(data).resize(800, 600).toBuffer();
}
```

---

## Bundle Analysis

```typescript
// electron.vite.config.ts - Add visualizer in analyze mode
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  renderer: {
    plugins: [
      react(),
      process.env.ANALYZE && visualizer({
        filename: './bundle-report.html',
        open: true,
        gzipSize: true,
        template: 'treemap',
      }),
    ].filter(Boolean),
  },
});
```

```bash
ANALYZE=true npx electron-vite build
```

### Size Monitoring in CI

```bash
#!/bin/bash
MAX_SIZE_MB=60
npx electron-vite build
SIZE=$(du -sm out/ | cut -f1)
echo "Bundle size: ${SIZE}MB (limit: ${MAX_SIZE_MB}MB)"
[ "$SIZE" -gt "$MAX_SIZE_MB" ] && echo "ERROR: Bundle exceeds limit!" && exit 1
```

---

## ASAR Archives

ASAR packs app files into a single archive, improving Windows load time and hiding
source from casual inspection.

```javascript
// forge.config.js
module.exports = {
  packagerConfig: {
    asar: {
      unpack: '*.{node,dll,dylib,so}',
      unpackDir: '{node_modules/sharp,node_modules/better-sqlite3}',
    },
  },
};
```

Unpack native `.node` addons, files accessed via `fs` with absolute paths, large
binaries that benefit from memory mapping, and executables spawned with `child_process`.

```javascript
function getUnpackedPath(relativePath: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', relativePath);
  }
  return path.join(__dirname, relativePath);
}
```

---

## Native Module Handling

Rebuild native modules against Electron's Node.js headers:

```bash
npx @electron/rebuild
```

Keep native modules external to the bundler:

```typescript
// electron.vite.config.ts
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['better-sqlite3', 'sharp', 'keytar', 'node-pty'],
      },
    },
  },
});
```

---

## Asset Optimization

```bash
# Compress PNGs and convert to WebP
npx sharp-cli --input "assets/**/*.png" --output "assets-opt/" --format webp

# Subset fonts to Latin characters only (often 60-70% smaller)
npx glyphhanger --whitelist="US_ASCII" --subset="fonts/Inter.woff2"

# Generate platform-specific icons
npx electron-icon-builder --input=icon-source.png --output=./build
```

---

## Excluding devDependencies

```json
{
  "dependencies": {
    "electron-updater": "^6.0.0",
    "better-sqlite3": "^11.0.0"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-vite": "^2.0.0",
    "typescript": "^5.0.0",
    "vitest": "^2.0.0"
  }
}
```

Only `dependencies` are included in the packaged app. Verify with:

```bash
npx electron-forge package
ls -la out/your-app-*/resources/app/node_modules/
```

---

## See Also

- [electron-vite](../tooling/electron-vite.md) - Build tool configuration details
- [CI/CD Patterns](./ci-cd-patterns.md) - Running bundle size checks in CI
- [Electron Forge](../tooling/electron-forge.md) - ASAR and packaging configuration
