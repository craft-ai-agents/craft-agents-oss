import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyDirBeforeWrite: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/index.html'),
        playground: resolve(__dirname, 'src/renderer/playground.html'),
        preview: resolve(__dirname, 'src/renderer/preview.html'),
        'diff-preview': resolve(__dirname, 'src/renderer/diff-preview.html'),
        'code-preview': resolve(__dirname, 'src/renderer/code-preview.html'),
        'terminal-preview': resolve(__dirname, 'src/renderer/terminal-preview.html'),
        'multi-file-diff': resolve(__dirname, 'src/renderer/multi-file-diff.html'),
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
      '@config': resolve(__dirname, '../../packages/shared/src/config')
    },
    dedupe: ['react', 'react-dom']
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'jotai']
  },
  server: {
    port: 5173,
    open: false
  }
})
