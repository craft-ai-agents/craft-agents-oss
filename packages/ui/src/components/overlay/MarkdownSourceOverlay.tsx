/**
 * MarkdownSourceOverlay - Fullscreen view for viewing raw markdown source
 *
 * Renders markdown source code in a document-like format with:
 * - Syntax highlighting via Shiki
 * - Copy button for source code
 * - Monospace font for code display
 * - Scenic mode blur support via CSS class
 *
 * Uses FullscreenOverlayBase for portal, traffic lights, and ESC handling.
 */

import { useState, useCallback } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { CodeBlock } from '../markdown/CodeBlock'
import { FullscreenOverlayBase } from './FullscreenOverlayBase'

// Z-index for header buttons - matches base overlay z-index
const Z_FULLSCREEN_HEADER = 'var(--z-fullscreen, 350)'

export interface MarkdownSourceOverlayProps {
  /** The raw markdown source to display */
  source: string
  /** Whether the overlay is open */
  isOpen: boolean
  /** Called when overlay should close */
  onClose: () => void
}

export function MarkdownSourceOverlay({
  source,
  isOpen,
  onClose,
}: MarkdownSourceOverlayProps) {
  // Copy state
  const [copied, setCopied] = useState(false)

  // Copy handler
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(source)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [source])

  return (
    <FullscreenOverlayBase
      isOpen={isOpen}
      onClose={onClose}
      className="flex flex-col"
    >
      {/* Fixed header buttons */}
      <div
        className="fixed top-4 right-4 flex items-center gap-2 [-webkit-app-region:no-drag]"
        style={{ zIndex: Z_FULLSCREEN_HEADER }}
      >
        {/* Copy button */}
        <button
          onClick={handleCopy}
          className={cn(
            "p-[5px] rounded-[6px] transition-all",
            "bg-background shadow-minimal",
            copied ? "text-success" : "text-muted-foreground/50 hover:text-foreground",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
          title={copied ? "Copied!" : "Copy raw markdown source"}
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </button>

        {/* Close button */}
        <button
          onClick={onClose}
          className={cn(
            "p-1 rounded-[6px] transition-all",
            "bg-background shadow-minimal",
            "text-muted-foreground/50 hover:text-foreground",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
          title="Close (Esc)"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Main scrollable area - fullscreen-overlay-background class enables scenic mode blur via CSS */}
      <div className="flex-1 min-h-0 bg-foreground-3 overflow-y-auto fullscreen-overlay-background">
        <div className="min-h-full flex flex-col justify-center px-6 py-16">
          {/* Content card - my-auto centers vertically when content is small, flows naturally when large */}
          <div className="bg-background rounded-[16px] shadow-strong w-full max-w-[960px] h-fit mx-auto my-auto">
            {/* Header to indicate this is source view */}
            <div className="px-4 py-2 border-b border-border/30 flex items-center gap-2 bg-muted/20 rounded-t-[16px]">
              <span className="text-[13px] font-medium text-muted-foreground">Markdown Source</span>
            </div>

            {/* Content area with code block */}
            <div className="px-10 pt-8 pb-8">
              <div className="text-sm">
                <CodeBlock
                  code={source}
                  language="markdown"
                  mode="minimal"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </FullscreenOverlayBase>
  )
}
