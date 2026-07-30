/**
 * ESLint Configuration for session-tools-core
 *
 * Enforces the "no React, no DOM" contract — this is a pure backend
 * tools package that must never pull in renderer dependencies.
 *
 * Uses flat config format (ESLint 9+).
 */

import tsParser from '@typescript-eslint/parser'

export default [
  // Ignore patterns
  {
    ignores: [
      'dist/**',
      'node_modules/**',
    ],
  },

  // TypeScript files
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      // Prevent React/DOM imports — this package runs in Node/Bun
      // contexts only and must never depend on renderer code.
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: '@craft-agent/core',
            message:
              'session-tools-core is a pure backend package — ' +
              '@craft-agent/core has Node host assumptions that may not ' +
              'match the session-tools runtime.',
          },
          {
            name: '@craft-agent/ui',
            message:
              'session-tools-core is a pure backend package — ' +
              '@craft-agent/ui is a renderer dependency.',
          },
        ],
        patterns: [
          {
            group: ['react', 'react-dom', 'react-dom/*'],
            message:
              'session-tools-core is a pure backend package — ' +
              'no React or DOM dependencies allowed.',
          },
        ],
      }],
    },
  },
]
