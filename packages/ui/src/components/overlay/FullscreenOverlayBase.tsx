/**
 * FullscreenOverlayBase - Base component for all fullscreen overlays
 *
 * Uses Radix Dialog primitives for proper:
 * - Focus management (blur on open, restore on close)
 * - ESC key handling
 * - Coordination with other Radix components (popovers, dropdowns)
 * - Accessibility (role="dialog", aria-modal)
 *
 * Additionally handles:
 * - macOS traffic light hiding (via PlatformContext)
 * - Default scenic background (bg-foreground-3 + fullscreen-overlay-background blur)
 *   Callers can override via className (twMerge resolves conflicts)
 * - Optional structured header with badges (typeBadge, filePath, title, subtitle)
 * - Optional built-in copy button (copyContent prop)
 *
 * When structured header props are provided, renders FullscreenOverlayBaseHeader
 * above children. Otherwise renders children only (backwards compatible).
 *
 * Used by: PreviewOverlay, DocumentFormattedMarkdownOverlay, WorkspaceCreationScreen
 */

import { useEffect, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { usePlatform } from '../../context/PlatformContext'
import { cn } from '../../lib/utils'
import { FullscreenOverlayBaseHeader, type OverlayTypeBadge } from './FullscreenOverlayBaseHeader'
import { OverlayErrorBanner, type OverlayErrorBannerProps } from './OverlayErrorBanner'

// Z-index for fullscreen overlays - must be above app chrome (z-overlay: 300)
// Uses CSS variable when available, falls back to hardcoded value
const Z_FULLSCREEN = 'var(--z-fullscreen, 350)'

export interface FullscreenOverlayBaseProps {
  /** Whether the overlay is visible */
  isOpen: boolean
  /** Callback when the overlay should close (ESC key triggers this) */
  onClose: () => void
  /** Content to render inside the overlay */
  children: ReactNode
  /** Additional CSS classes for the container */
  className?: string
  /** Accessible title for the overlay (visually hidden) */
  accessibleTitle?: string

  // --- Structured header props (optional) ---
  // When any of these are provided, a FullscreenOverlayBaseHeader is rendered above children.

  /** Type badge — tool/format indicator (e.g. "Read", "Image", "Bash") */
  typeBadge?: OverlayTypeBadge
  /** File path — shows dual-trigger menu badge with "Open" + "Reveal in Finder" */
  filePath?: string
  /** Title — displayed as a badge when no filePath */
  title?: string
  /** Click handler for the title badge */
  onTitleClick?: () => void
  /** Subtitle — extra info badge (e.g. "Lines 1-50 of 200") */
  subtitle?: string
  /** Right-side header actions (e.g. diff controls) */
  headerActions?: ReactNode
  /** When provided, renders a built-in copy button in the header right actions area */
  copyContent?: string

  /** Optional error banner — rendered between header and children */
  error?: OverlayErrorBannerProps
}

export function FullscreenOverlayBase({
  isOpen,
  onClose,
  children,
  className,
  accessibleTitle = 'Overlay',
  typeBadge,
  filePath,
  title,
  onTitleClick,
  subtitle,
  headerActions,
  copyContent,
  error,
}: FullscreenOverlayBaseProps) {
  const { onSetTrafficLightsVisible } = usePlatform()

  // Determine if we should render the structured header.
  // Any header-related prop triggers header rendering.
  const hasHeader = !!(typeBadge || filePath || title || subtitle || headerActions || copyContent)

  // Hide macOS traffic lights when overlay opens, restore when it closes
  // This prevents accidental clicks on window controls behind the fullscreen overlay
  // Note: Radix Dialog handles focus/ESC/portal, but traffic lights are macOS-specific
  useEffect(() => {
    if (!isOpen) return

    onSetTrafficLightsVisible?.(false)
    return () => onSetTrafficLightsVisible?.(true)
  }, [isOpen, onSetTrafficLightsVisible])

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Content
          className={cn(
            'fixed inset-0 overflow-hidden outline-none',
            // Default scenic background — callers can override via className (twMerge resolves conflicts)
            'bg-foreground-3 fullscreen-overlay-background',
            className
          )}
          style={{ zIndex: Z_FULLSCREEN }}
          // Prevent Radix from auto-focusing the first focusable element
          // Our fullscreen overlays are more like views than traditional dialogs
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Visually hidden title for accessibility - required by Radix Dialog */}
          <Dialog.Title className="sr-only">{accessibleTitle}</Dialog.Title>
          {hasHeader && (
            <FullscreenOverlayBaseHeader
              onClose={onClose}
              typeBadge={typeBadge}
              filePath={filePath}
              title={title}
              onTitleClick={onTitleClick}
              subtitle={subtitle}
              headerActions={headerActions}
              copyContent={copyContent}
            />
          )}
          {/* Error banner — rendered between header and content, centered at content max-width */}
          {error && (
            <div className="px-6 pt-4">
              <OverlayErrorBanner label={error.label} message={error.message} />
            </div>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
