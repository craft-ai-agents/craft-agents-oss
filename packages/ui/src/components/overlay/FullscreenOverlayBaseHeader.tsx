/**
 * FullscreenOverlayBaseHeader - Header component for fullscreen overlays
 *
 * Builds a badge row from structured props (typeBadge, filePath, title, subtitle).
 * The file path badge has a dual-trigger menu:
 * - Left-click → Radix DropdownMenu with "Open" / "Reveal in Finder"
 * - Right-click → Radix ContextMenu with the same items
 *
 * Both menus share one internal items array, just wrapped differently.
 * onOpenFileExternal and onRevealInFinder come from PlatformContext — no per-overlay callbacks.
 */

import { useState, useCallback, type ReactNode } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { Check, Copy, ExternalLink, FolderOpen, type LucideIcon } from 'lucide-react'
import { PreviewHeader, PreviewHeaderBadge, type PreviewBadgeVariant } from '../ui/PreviewHeader'
import { usePlatform } from '../../context/PlatformContext'
import { cn } from '../../lib/utils'

/** Structured type badge — tool/format indicator (e.g. "Read", "Image", "Bash") */
export interface OverlayTypeBadge {
  icon: LucideIcon
  label: string
  variant?: PreviewBadgeVariant
}

export interface FullscreenOverlayBaseHeaderProps {
  /** Close handler — shows X button in header */
  onClose: () => void
  /** Type badge — tool/format indicator */
  typeBadge?: OverlayTypeBadge
  /** File path — shows dual-trigger menu badge with "Open" + "Reveal in Finder" */
  filePath?: string
  /** Title — displayed as a badge. Fallback when no file path. */
  title?: string
  /** Click handler for the title badge */
  onTitleClick?: () => void
  /** Subtitle — extra info badge (e.g. "Lines 1-50 of 200") */
  subtitle?: string
  /** Right-side actions (e.g. diff controls) */
  headerActions?: ReactNode
  /** When provided, renders a built-in copy button (matching close button style) */
  copyContent?: string
}

/**
 * Truncates a file path to show just the filename for display in the badge.
 * Full path is available via tooltip.
 */
function displayPath(filePath: string): string {
  const parts = filePath.split('/')
  const name = parts.pop() || filePath
  // Show parent dir + filename if available (e.g. "src/App.tsx")
  if (parts.length > 0) {
    const parent = parts.pop()
    return `${parent}/${name}`
  }
  return name
}

// ============================================================================
// Shared menu item styling — used by both DropdownMenu and ContextMenu
// ============================================================================

/** Common styles for menu content containers */
const menuContentClasses = cn(
  'z-[400] min-w-[160px] overflow-hidden rounded-lg p-1',
  'bg-background shadow-lg border border-foreground/5',
  'animate-in fade-in-0 zoom-in-95'
)

/** Common styles for menu items */
const menuItemClasses = cn(
  'flex items-center gap-2 px-3 py-1.5 text-[13px] font-sans rounded-md cursor-pointer outline-none',
  'text-foreground/80 hover:bg-foreground/5 focus:bg-foreground/5',
  'transition-colors'
)

// ============================================================================
// FilePathBadge — badge with dual-trigger menu (dropdown + context menu)
// ============================================================================

interface FilePathBadgeProps {
  filePath: string
}

/**
 * FilePathBadge - Badge that opens a menu on both left-click and right-click.
 *
 * Implementation: Wraps a Radix DropdownMenu (left-click trigger) inside a
 * Radix ContextMenu (right-click trigger). Both render the same menu items.
 * Uses onOpenFileExternal (not onOpenFile) from PlatformContext — when already
 * viewing a file in an overlay, "Open" should launch the system editor directly,
 * not re-trigger the in-app preview interceptor.
 */
function FilePathBadge({ filePath }: FilePathBadgeProps) {
  const { onOpenFileExternal, onRevealInFinder } = usePlatform()

  const handleOpen = useCallback(() => {
    onOpenFileExternal?.(filePath)
  }, [onOpenFileExternal, filePath])

  const handleReveal = useCallback(() => {
    onRevealInFinder?.(filePath)
  }, [onRevealInFinder, filePath])

  // Shared menu items — same content rendered by both dropdown and context menu
  const hasMenuItems = !!onOpenFileExternal || !!onRevealInFinder

  // Menu items rendered inside both DropdownMenu.Content and ContextMenu.Content
  const dropdownItems = (
    <>
      {onOpenFileExternal && (
        <DropdownMenu.Item className={menuItemClasses} onSelect={handleOpen}>
          <ExternalLink className="w-3.5 h-3.5 shrink-0" />
          Open
        </DropdownMenu.Item>
      )}
      {onRevealInFinder && (
        <DropdownMenu.Item className={menuItemClasses} onSelect={handleReveal}>
          <FolderOpen className="w-3.5 h-3.5 shrink-0" />
          Reveal in Finder
        </DropdownMenu.Item>
      )}
    </>
  )

  const contextItems = (
    <>
      {onOpenFileExternal && (
        <ContextMenu.Item className={menuItemClasses} onSelect={handleOpen}>
          <ExternalLink className="w-3.5 h-3.5 shrink-0" />
          Open
        </ContextMenu.Item>
      )}
      {onRevealInFinder && (
        <ContextMenu.Item className={menuItemClasses} onSelect={handleReveal}>
          <FolderOpen className="w-3.5 h-3.5 shrink-0" />
          Reveal in Finder
        </ContextMenu.Item>
      )}
    </>
  )

  const display = displayPath(filePath)

  // If no menu items available (e.g. web viewer), just show a static badge
  if (!hasMenuItems) {
    return <PreviewHeaderBadge label={display} title={filePath} shrinkable />
  }

  // Wrap: ContextMenu (right-click) wraps DropdownMenu (left-click) wraps the badge
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            {/* Badge that responds to left-click (dropdown) and right-click (context menu) */}
            <button
              className={cn(
                'flex items-center gap-1.5 h-[26px] px-2.5 rounded-[6px]',
                'font-sans text-[13px] font-medium text-foreground/70',
                'bg-background shadow-minimal',
                'min-w-0 cursor-pointer group'
              )}
              title={filePath}
            >
              <span className="truncate group-hover:underline">{display}</span>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className={menuContentClasses} sideOffset={6} align="center">
              {dropdownItems}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContentClasses}>
          {contextItems}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

// ============================================================================
// FullscreenOverlayBaseHeader
// ============================================================================

export function FullscreenOverlayBaseHeader({
  onClose,
  typeBadge,
  filePath,
  title,
  onTitleClick,
  subtitle,
  headerActions,
  copyContent,
}: FullscreenOverlayBaseHeaderProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    if (!copyContent) return
    try {
      await navigator.clipboard.writeText(copyContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [copyContent])

  // Built-in copy button + any custom header actions, rendered in PreviewHeader's right actions area
  const rightActions = (
    <>
      {copyContent != null && (
        <button
          onClick={handleCopy}
          className={cn(
            'p-1.5 rounded-[6px] bg-background shadow-minimal cursor-pointer',
            'opacity-70 hover:opacity-100 transition-opacity',
            'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring'
          )}
          title={copied ? 'Copied!' : 'Copy all'}
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </button>
      )}
      {headerActions}
    </>
  )

  return (
    <PreviewHeader onClose={onClose} height={48} rightActions={rightActions}>
      {typeBadge && (
        <PreviewHeaderBadge
          icon={typeBadge.icon}
          label={typeBadge.label}
          variant={typeBadge.variant}
        />
      )}
      {filePath ? (
        <FilePathBadge filePath={filePath} />
      ) : title ? (
        <PreviewHeaderBadge label={title} onClick={onTitleClick} shrinkable />
      ) : null}
      {subtitle && <PreviewHeaderBadge label={subtitle} />}
    </PreviewHeader>
  )
}
