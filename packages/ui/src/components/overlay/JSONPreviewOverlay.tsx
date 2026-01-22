/**
 * JSONPreviewOverlay - Interactive JSON tree viewer overlay
 *
 * Uses @uiw/react-json-view for expand/collapse tree navigation.
 * Wraps PreviewOverlay for consistent presentation with other overlays.
 */

import * as React from 'react'
import { useMemo } from 'react'
import JsonView from '@uiw/react-json-view'
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

  // Cast data to object for JsonView (it's already validated JSON from extractOverlayData)
  const jsonData = data as object

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
            value={jsonData}
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
