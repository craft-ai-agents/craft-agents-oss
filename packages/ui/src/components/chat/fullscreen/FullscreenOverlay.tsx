/**
 * FullscreenOverlay - Fullscreen view for reading AI responses
 *
 * Z-Index: Uses z-fullscreen (350) from the electron app's z-index registry.
 * Falls back to 350 when CSS variable is not available.
 * See: apps/electron/src/renderer/index.css for the full z-index scale.
 */

import { useState, useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { Check, Copy, ListTodo, X } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { Markdown } from '../../markdown'
import { usePlatform } from '../../../context/PlatformContext'

// Z-index for fullscreen overlays - must be above app chrome (z-overlay: 300)
// Uses CSS variable when available, falls back to hardcoded value
const Z_FULLSCREEN = 'var(--z-fullscreen, 350)'
const Z_FULLSCREEN_HEADER = 'var(--z-fullscreen, 350)'

export interface FullscreenOverlayProps {
  /** The content to display (markdown) */
  content: string
  /** Whether the overlay is open */
  isOpen: boolean
  /** Called when overlay should close */
  onClose: () => void
  /** Variant: 'response' (default) or 'plan' (shows header) */
  variant?: 'response' | 'plan'
  /** Callback for URL clicks */
  onOpenUrl?: (url: string) => void
  /** Callback for file path clicks */
  onOpenFile?: (path: string) => void
}

export function FullscreenOverlay({
  content,
  isOpen,
  onClose,
  variant = 'response',
  onOpenUrl,
  onOpenFile,
}: FullscreenOverlayProps) {
  // Copy state
  const [copied, setCopied] = useState(false)
  const { onSetTrafficLightsVisible } = usePlatform()

  // Hide macOS traffic lights when overlay opens, restore when it closes
  useEffect(() => {
    if (!isOpen) return

    onSetTrafficLightsVisible?.(false)
    return () => onSetTrafficLightsVisible?.(true)
  }, [isOpen, onSetTrafficLightsVisible])

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Copy handler
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [content])

  if (!isOpen) return null

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 flex flex-col"
      style={{ zIndex: Z_FULLSCREEN }}
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
          title={copied ? "Copied!" : "Copy all"}
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
            {/* Plan header (variant="plan" only) */}
            {variant === 'plan' && (
              <div className="px-4 py-2 border-b border-border/30 flex items-center gap-2 bg-success/5 rounded-t-[16px]">
                <ListTodo className="w-3 h-3 text-success" />
                <span className="text-[13px] font-medium text-success">Plan</span>
              </div>
            )}

            {/* Content area */}
            <div className="px-10 pt-8 pb-8">
              <div className="text-sm">
                <Markdown
                  mode="minimal"
                  onUrlClick={onOpenUrl}
                  onFileClick={onOpenFile}
                >
                  {content}
                </Markdown>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
