/**
 * PreviewOverlay - Base component for all preview overlays
 *
 * Provides unified presentation logic for modal/fullscreen overlays:
 * - Portal rendering to document.body (via FullscreenOverlayBase for fullscreen mode)
 * - Responsive modal (>=1200px) vs fullscreen (<1200px) modes
 * - Escape key to close
 * - Backdrop click to close (modal mode)
 * - Consistent header layout with badge, title, close button
 * - Optional error banner
 *
 * Used by: CodePreviewOverlay, DiffPreviewOverlay, TerminalPreviewOverlay, GenericOverlay
 */

import { useEffect, type ReactNode } from 'react'
import * as ReactDOM from 'react-dom'
import { X, type LucideIcon } from 'lucide-react'
import { useOverlayMode, OVERLAY_LAYOUT } from '../../lib/layout'
import { PreviewHeader, PreviewHeaderBadge, type PreviewBadgeVariant } from '../ui/PreviewHeader'
import { FullscreenOverlayBase } from './FullscreenOverlayBase'

/** Badge color variants - re-export for backwards compatibility */
export type BadgeVariant = PreviewBadgeVariant

export interface PreviewOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean
  /** Callback when the overlay should close */
  onClose: () => void
  /** Theme mode */
  theme?: 'light' | 'dark'

  /** Header badge configuration */
  badge: {
    icon: LucideIcon
    label: string
    variant: BadgeVariant
  }

  /** Main title (e.g., file path) */
  title: string
  /** Callback when title is clicked (e.g., to open file) */
  onTitleClick?: () => void
  /** Optional subtitle (e.g., line range info) */
  subtitle?: ReactNode

  /** Optional error state */
  error?: {
    label: string
    message: string
  }

  /** Actions to show in header (rendered after badges) */
  headerActions?: ReactNode

  /** Main content */
  children: ReactNode

  /** Background color override (default: theme-based) */
  backgroundColor?: string
  /** Text color override (default: theme-based) */
  textColor?: string
}

export function PreviewOverlay({
  isOpen,
  onClose,
  theme = 'light',
  badge,
  title,
  onTitleClick,
  subtitle,
  error,
  headerActions,
  children,
  backgroundColor,
  textColor,
}: PreviewOverlayProps) {
  const responsiveMode = useOverlayMode()
  const isModal = responsiveMode === 'modal'

  // Handle Escape key for modal mode only (fullscreen mode uses FullscreenOverlayBase which handles ESC)
  useEffect(() => {
    if (!isOpen || !isModal) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isModal, onClose])

  if (!isOpen) return null

  const defaultBg = theme === 'dark' ? '#1e1e1e' : '#ffffff'
  const defaultText = theme === 'dark' ? '#e4e4e4' : '#1a1a1a'
  const bgColor = backgroundColor ?? defaultBg
  const txtColor = textColor ?? defaultText

  const header = (
    <PreviewHeader onClose={onClose} height={isModal ? 48 : 54}>
      <PreviewHeaderBadge
        icon={badge.icon}
        label={badge.label}
        variant={badge.variant}
      />
      <PreviewHeaderBadge label={title} onClick={onTitleClick} shrinkable />
      {subtitle && <PreviewHeaderBadge label={String(subtitle)} />}
      {headerActions}
    </PreviewHeader>
  )

  const errorBanner = error && (
    <div className="px-4 py-3 bg-destructive/10 border-b border-destructive/20 flex items-start gap-3">
      <X className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-destructive/70 mb-0.5">{error.label}</div>
        <p className="text-sm text-destructive whitespace-pre-wrap break-words">{error.message}</p>
      </div>
    </div>
  )

  const contentArea = <div className="flex-1 min-h-0 relative">{children}</div>

  // Fullscreen mode - uses FullscreenOverlayBase for portal, traffic lights, and ESC handling
  if (!isModal) {
    return (
      <FullscreenOverlayBase
        isOpen={isOpen}
        onClose={onClose}
        className="flex flex-col bg-background"
      >
        <div
          className="flex flex-col flex-1 min-h-0"
          style={{ backgroundColor: bgColor, color: txtColor }}
        >
          {header}
          {errorBanner}
          {contentArea}
        </div>
      </FullscreenOverlayBase>
    )
  }

  // Modal mode - uses its own portal with backdrop click to close
  return ReactDOM.createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${OVERLAY_LAYOUT.modalBackdropClass}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="flex flex-col bg-background shadow-3xl overflow-hidden smooth-corners"
        style={{
          backgroundColor: bgColor,
          color: txtColor,
          width: '90vw',
          maxWidth: OVERLAY_LAYOUT.modalMaxWidth,
          height: `${OVERLAY_LAYOUT.modalMaxHeightPercent}vh`,
          borderRadius: 16,
        }}
      >
        {header}
        {errorBanner}
        {contentArea}
      </div>
    </div>,
    document.body
  )
}
