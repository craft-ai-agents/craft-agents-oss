import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

// NOTE: Source map upload to Sentry is intentionally disabled.
// To re-enable, uncomment the sentryVitePlugin below and add SENTRY_AUTH_TOKEN,
// SENTRY_ORG, SENTRY_PROJECT to CI secrets. See CLAUDE.md "Sentry Error Tracking" section.
// import { sentryVitePlugin } from '@sentry/vite-plugin'

/**
 * Shared modules still expose some server-only imports to the renderer bundle.
 * Vite needs concrete named exports to build those modules; runtime renderer
 * work remains behind the preload API and must not use these stand-ins.
 */
function nodeBuiltinStubPlugin() {
  const stub = resolve(__dirname, 'src/renderer/shims/node-stub.ts')
  const names: Record<string, true> = {
    'fs': true, 'fs/promises': true, 'path': true, 'os': true, 'crypto': true,
    'child_process': true, 'url': true, 'util': true, 'stream': true, 'events': true,
    'module': true, 'assert': true, 'worker_threads': true, 'http': true, 'https': true,
    'net': true, 'tls': true, 'dns': true, 'zlib': true, 'querystring': true,
    'string_decoder': true, 'readline': true, 'tty': true, 'constants': true,
    'vm': true, 'perf_hooks': true, 'async_hooks': true, 'timers': true,
    'node:fs': true, 'node:fs/promises': true, 'node:path': true, 'node:os': true,
    'node:crypto': true, 'node:child_process': true, 'node:url': true, 'node:util': true,
    'node:stream': true, 'node:events': true, 'node:buffer': true, 'node:module': true,
    'node:assert': true, 'node:process': true, 'node:worker_threads': true,
    'node:http': true, 'node:https': true, 'node:net': true, 'node:tls': true,
    'node:dns': true, 'node:zlib': true,
  }

  return {
    name: 'node-builtin-stub',
    enforce: 'pre' as const,
    resolveId(id: string) {
      const clean = id.split('?')[0] || id
      if (Object.hasOwn(names, clean) || Object.hasOwn(names, id)) return stub
      if (clean.startsWith('node:')) return stub

      const base = clean.replace(/^\0/, '').replace(/^.*node_modules\//, '')
      return Object.hasOwn(names, base) ? stub : null
    },
  }
}

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          // Jotai HMR support: caches atom instances in globalThis.jotaiAtomCache
          // so that HMR module re-execution returns stable atom references
          // instead of creating new (empty) atoms that orphan existing data.
          'jotai/babel/plugin-debug-label',
          ['jotai/babel/plugin-react-refresh', { customAtomNames: ['atomFamily'] }],
        ],
      },
    }),
    tailwindcss(),
    nodeBuiltinStubPlugin(),
    // Sentry source map upload — intentionally disabled. See CLAUDE.md for re-enabling instructions.
    // sentryVitePlugin({
    //   org: process.env.SENTRY_ORG,
    //   project: process.env.SENTRY_PROJECT,
    //   authToken: process.env.SENTRY_AUTH_TOKEN,
    //   disable: !process.env.SENTRY_AUTH_TOKEN,
    //   sourcemaps: {
    //     filesToDeleteAfterUpload: ['**/*.map'],
    //   },
    // }),
  ],
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyDirBeforeWrite: true,
    sourcemap: true,  // Source maps generated for debugging. Not uploaded to Sentry (see CLAUDE.md).
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/index.html'),
        playground: resolve(__dirname, 'src/renderer/playground.html'),
        'browser-toolbar': resolve(__dirname, 'src/renderer/browser-toolbar.html'),
        'browser-empty-state': resolve(__dirname, 'src/renderer/browser-empty-state.html'),
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
      '@config': resolve(__dirname, '../../packages/shared/src/config'),
      // Force all React imports to use the root node_modules React
      // Bun hoists deps to root. This prevents "multiple React copies" error from @craft-agent/ui
      'react': resolve(__dirname, '../../node_modules/react'),
      'react-dom': resolve(__dirname, '../../node_modules/react-dom'),
      // The real SDK has a Node shebang and belongs exclusively to main/server.
      '@anthropic-ai/claude-agent-sdk': resolve(__dirname, 'src/renderer/shims/claude-agent-sdk-stub.ts'),
    },
    dedupe: ['react', 'react-dom']
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'jotai', 'pdfjs-dist'],
    exclude: ['@craft-agent/ui', '@anthropic-ai/claude-agent-sdk'],
    esbuildOptions: {
      supported: { 'top-level-await': true },
      target: 'esnext'
    }
  },
  server: {
    port: 5173,
    open: false
  }
})
