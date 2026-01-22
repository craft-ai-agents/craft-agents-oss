/**
 * JSONPreviewOverlay - Interactive JSON tree viewer overlay
 *
 * Uses @uiw/react-json-view for expand/collapse tree navigation.
 * Wraps PreviewOverlay for consistent presentation with other overlays.
 */

import * as React from 'react'
import { useMemo } from 'react'
import JsonView from '@uiw/react-json-view'

/**
 * Recursively parse stringified JSON within JSON values.
 * Handles nested patterns like {"result": "{\"nested\": \"value\"}"}
 * so they display as expandable tree nodes instead of plain strings.
 */
function deepParseJson(value: unknown): unknown {
  // Handle null/undefined
  if (value === null || value === undefined) return value

  // If it's a string, try to parse it as JSON
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        // Recursively parse the result in case of multiple nesting levels
        return deepParseJson(JSON.parse(trimmed))
      } catch {
        // Not valid JSON, return original string
        return value
      }
    }
    return value
  }

  // If it's an array, recursively process each element
  if (Array.isArray(value)) {
    return value.map(deepParseJson)
  }

  // If it's an object, recursively process each property
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      result[key] = deepParseJson(val)
    }
    return result
  }

  // Primitives (number, boolean) - return as-is
  return value
}
import { vscodeTheme } from '@uiw/react-json-view/vscode'
import { githubLightTheme } from '@uiw/react-json-view/githubLight'
import { Braces, Copy, Check } from 'lucide-react'
import { PreviewOverlay } from './PreviewOverlay'

export interface JSONPreviewOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean
  /** Callback when the overlay should close */
  onClose: () => void
  /** Parsed JSON data to display */
  data: unknown
  /** Title to display in header */
  title?: string
  /** Theme mode */
  theme?: 'light' | 'dark'
  /** Optional error message */
  error?: string
}

/**
 * Custom theme that adapts to our app's CSS variables.
 * Falls back to VS Code dark theme colors for JSON-specific styling.
 */
const craftAgentDarkTheme = {
  ...vscodeTheme,
  '--w-rjv-font-family': 'var(--font-mono, ui-monospace, monospace)',
  '--w-rjv-background-color': 'transparent',
}

const craftAgentLightTheme = {
  ...githubLightTheme,
  '--w-rjv-font-family': 'var(--font-mono, ui-monospace, monospace)',
  '--w-rjv-background-color': 'transparent',
}

export function JSONPreviewOverlay({
  isOpen,
  onClose,
  data,
  title = 'JSON',
  theme = 'dark',
  error,
}: JSONPreviewOverlayProps) {
  // Select theme based on mode
  const jsonTheme = useMemo(() => {
    return theme === 'dark' ? craftAgentDarkTheme : craftAgentLightTheme
  }, [theme])

  // Recursively parse any stringified JSON within the data for better display
  const processedData = useMemo(() => {
    return deepParseJson(data) as object
  }, [data])

  return (
    <PreviewOverlay
      isOpen={isOpen}
      onClose={onClose}
      badge={{
        icon: Braces,
        label: 'JSON',
        variant: 'blue',
      }}
      title={title}
      theme={theme}
      error={error ? { label: 'Parse Error', message: error } : undefined}
      backgroundColor="var(--foreground-2)"
    >
      <div className="h-full overflow-auto p-4">
        <div className="rounded-lg bg-background shadow-minimal p-4">
          <JsonView
            value={processedData}
            style={jsonTheme}
            collapsed={false}
            enableClipboard={true}
            displayDataTypes={false}
            shortenTextAfterLength={100}
          >
            {/* Custom copy icon using lucide-react */}
            <JsonView.Copied
              render={(props) => {
                // Type assertion needed - @uiw/react-json-view types don't include data-copied
                const isCopied = (props as Record<string, unknown>)['data-copied']
                return isCopied ? (
                  <Check
                    className="ml-1.5 inline-flex cursor-pointer text-green-500"
                    size={10}
                    onClick={props.onClick}
                  />
                ) : (
                  <Copy
                    className="ml-1.5 inline-flex cursor-pointer text-muted-foreground hover:text-foreground"
                    size={10}
                    onClick={props.onClick}
                  />
                )
              }}
            />
          </JsonView>
        </div>
      </div>
    </PreviewOverlay>
  )
}
