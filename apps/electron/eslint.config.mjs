/**
 * ESLint Configuration for Electron App
 *
 * Uses flat config format (ESLint 9+).
 * Includes custom navigation rule to enforce navigate() usage.
 */

import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import noDirectNavigationState from './eslint-rules/no-direct-navigation-state.cjs'
import noLocalStorage from './eslint-rules/no-localstorage.cjs'
import noDirectPlatformCheck from './eslint-rules/no-direct-platform-check.cjs'
import noHardcodedPathSeparator from './eslint-rules/no-hardcoded-path-separator.cjs'
import noDirectFileOpen from './eslint-rules/no-direct-file-open.cjs'
import noInlineSourceAuthCheck from './eslint-rules/no-inline-source-auth-check.cjs'

export default [
  // Ignore patterns
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'release/**',
      '*.cjs',
      'eslint-rules/**',
    ],
  },

  // TypeScript/React files
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      // Custom plugin for Craft Agent rules
      'craft-agent': {
        rules: {
          'no-direct-navigation-state': noDirectNavigationState,
          'no-localstorage': noLocalStorage,
        },
      },
      // Custom plugin for platform detection rules
      'craft-platform': {
        rules: {
          'no-direct-platform-check': noDirectPlatformCheck,
        },
      },
      // Custom plugin for cross-platform path rules
      'craft-paths': {
        rules: {
          'no-hardcoded-path-separator': noHardcodedPathSeparator,
        },
      },
      // Custom plugin for link interceptor enforcement
      'craft-links': {
        rules: {
          'no-direct-file-open': noDirectFileOpen,
        },
      },
      // Custom plugin for source auth checks (shared with packages/shared)
      'craft-sources': {
        rules: {
          'no-inline-source-auth-check': noInlineSourceAuthCheck,
        },
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      // React Hooks rules
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Custom Craft Agent rules
      'craft-agent/no-direct-navigation-state': 'error',
      'craft-agent/no-localstorage': 'warn',

      // Custom platform detection rule
      'craft-platform/no-direct-platform-check': 'error',

      // Custom cross-platform path rule
      'craft-paths/no-hardcoded-path-separator': 'warn',

      // Custom link interceptor rule — prevents bypassing in-app file preview
      'craft-links/no-direct-file-open': 'error',

      // Custom source auth check rule — use isSourceUsable() instead of inline checks
      'craft-sources/no-inline-source-auth-check': 'error',

      // Enforce centralized action registry for keyboard shortcuts
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: 'react-hotkeys-hook',
            message: 'Use useAction from @/actions instead. See actions/index.ts'
          }
        ],
      }],
    },
  },

  // Enforce backend abstraction boundary in Electron main process.
  {
    files: ['src/main/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: '@craft-agent/shared/codex',
            message: 'Use provider-agnostic APIs from @craft-agent/shared/agent/backend instead.',
          },
          {
            name: '@craft-agent/shared/agent/claude-agent',
            message: 'Provider backends must stay behind @craft-agent/shared/agent/backend.',
          },
          {
            name: '@craft-agent/shared/agent/codex-agent',
            message: 'Provider backends must stay behind @craft-agent/shared/agent/backend.',
          },
          {
            name: '@craft-agent/shared/agent/copilot-agent',
            message: 'Provider backends must stay behind @craft-agent/shared/agent/backend.',
          },
          {
            name: '@craft-agent/shared/agent/pi-agent',
            message: 'Provider backends must stay behind @craft-agent/shared/agent/backend.',
          },
          {
            name: '@github/copilot-sdk',
            message: 'Use provider-agnostic model discovery/validation APIs from @craft-agent/shared/agent/backend.',
          },
        ],
      }],
    },
  },

  // Keep main model fetchers provider-agnostic (delegate to shared backend APIs only).
  {
    files: ['src/main/model-fetchers/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message: 'Do not call provider APIs directly in Electron model fetchers. Delegate to fetchBackendModels() from @craft-agent/shared/agent/backend.',
        },
        {
          selector: "ImportDeclaration[source.value='@anthropic-ai/claude-agent-sdk']",
          message: 'Provider SDK usage must stay in backend drivers under packages/shared/src/agent/backend/internal/drivers.',
        },
        {
          selector: "ImportDeclaration[source.value='@github/copilot-sdk']",
          message: 'Provider SDK usage must stay in backend drivers under packages/shared/src/agent/backend/internal/drivers.',
        },
        {
          selector: "ImportDeclaration[source.value='@mariozechner/pi-ai']",
          message: 'Provider SDK usage must stay in backend drivers under packages/shared/src/agent/backend/internal/drivers.',
        },
        {
          selector: "ImportDeclaration[source.value='@mariozechner/pi-coding-agent']",
          message: 'Provider SDK usage must stay in backend drivers under packages/shared/src/agent/backend/internal/drivers.',
        },
      ],
    },
  },
]
