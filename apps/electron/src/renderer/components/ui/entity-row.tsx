/**
 * EntityRow — Reusable visual skeleton for list items.
 *
 * Extracted from SessionItem/SourceItem/SkillItem which all share the same layout:
 * - Absolutely-positioned icon on the left
 * - Title + badge/subtitle row
 * - Optional trailing content (timestamp, count)
 * - Hover-visible MoreHorizontal dropdown + context menu
 * - Selection/multi-select styling
 * - Optional separator above
 * - Optional children below the button (e.g. expanded child list)
 * - Optional overlay (e.g. match count badge)
 *
 * Domain-specific logic (what icon, what badges, what menu items) is injected via slots.
 */

import * as React from 'react'
import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
} from '@/components/ui/styled-dropdown'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
} from '@/components/ui/styled-context-menu'
import { DropdownMenuProvider, ContextMenuProvider } from '@/components/ui/menu-context'
import {
  LONG_PRESS_MS,
  MOVE_TOLERANCE_PX,
  shouldFireLongPress,
} from '@/components/ui/long-press-state'
import { cn } from '@/lib/utils'

/** Window the long-press / right-click handler keeps `suppressNextActivation`
 *  asserted for after the drawer opens. Activation events (`onMouseDown` /
 *  `onClick`) within this window are dropped so the row doesn't get selected
 *  underneath the drawer when the user releases the press. A normal tap is
 *  <300ms, so the window doesn't eat real taps. */
const SUPPRESS_ACTIVATION_MS = 300

export interface EntityRowProps {
  /** Left icon area — rendered in-flow as a flex child before the content column.
   *  Consumers can pass multiple icons (e.g. via a fragment) for a horizontal icon group. */
  icon?: React.ReactNode
  /** Title content (ReactNode for search highlighting support) */
  title: React.ReactNode
  /** Additional className on the title wrapper (e.g. shimmer animation) */
  titleClassName?: string
  /** Content rendered inline after the title (e.g. timestamp). On hover, swapped with the more button.
   *  When set, the title row becomes single-line (truncated) and the absolute more button is hidden. */
  titleTrailing?: React.ReactNode
  /** Content rendered inline immediately after the title, on the same row.
   *  Lives between the title and the trailing slot. Use for tiny, high-priority
   *  inline chips (e.g. platform bindings) that should read as part of the title
   *  area, not as badges below. `shrink-0` so long titles truncate first. */
  titleSuffix?: React.ReactNode
  /** Optional subtitle line beneath the title */
  subtitle?: React.ReactNode
  /** Badge/subtitle row beneath the title */
  badges?: React.ReactNode
  /** Right-aligned content in the badge row (timestamp, child toggle) */
  trailing?: React.ReactNode
  /** Content rendered below the main button (e.g. expanded child list) */
  children?: React.ReactNode
  /** Absolutely-positioned overlay (e.g. match count badge) */
  overlay?: React.ReactNode

  // --- Interaction ---
  /** Selection state */
  isSelected?: boolean
  /** Multi-select highlight (left accent bar + tinted bg) */
  isInMultiSelect?: boolean
  /** Click handler — use onMouseDown for modifier key detection (Session), or onClick for simple cases */
  onMouseDown?: (e: React.MouseEvent) => void
  /** Simple click handler (used when modifier key detection isn't needed) */
  onClick?: () => void
  /** Show separator above this row */
  showSeparator?: boolean

  // --- Menu ---
  /** Menu content — rendered in BOTH dropdown and context menu via providers.
   *  Should be a component that uses useMenuComponents() for its items. */
  menuContent?: React.ReactNode
  /** Context menu content when different from dropdown (e.g. batch menu in multi-select) */
  contextMenuContent?: React.ReactNode
  /** Whether to hide the more button (e.g. when overlay is showing) */
  hideMoreButton?: boolean
  /** Whether to render the menu surface in compact (drawer) mode. Pass-through
   *  from the consumer so EntityRow stays generic and usable from playground /
   *  non-AppShell surfaces. Only meaningful in combination with `compactMenu`. */
  isCompactMode?: boolean
  /** Render-prop for the compact (drawer) menu surface. EntityRow owns the
   *  open state (driven by both the `…` button and long-press / right-click)
   *  and hands it to the consumer so a single drawer instance is controlled
   *  by both triggers. When omitted OR `isCompactMode` is false: the
   *  existing dropdown/context-menu behaviour kicks in. */
  compactMenu?: (props: {
    open: boolean
    onOpenChange: (open: boolean) => void
  }) => React.ReactNode

  // --- Passthrough ---
  /** Additional props spread onto the <button> (aria attrs, keyboard handlers, tabIndex, ref) */
  buttonProps?: Record<string, unknown>
  /** Data attributes on the outer wrapper div */
  dataAttributes?: Record<string, string | undefined>
  /** Outer wrapper className */
  className?: string
  /** Separator padding class (default: 'pl-12 pr-4') */
  separatorClassName?: string
}

export function EntityRow({
  icon,
  title,
  titleClassName,
  titleTrailing,
  titleSuffix,
  subtitle,
  badges,
  trailing,
  children,
  overlay,
  isSelected = false,
  isInMultiSelect = false,
  onMouseDown,
  onClick,
  showSeparator = false,
  menuContent,
  contextMenuContent,
  hideMoreButton = false,
  isCompactMode = false,
  compactMenu,
  buttonProps,
  dataAttributes,
  className,
  separatorClassName = 'pl-12 pr-4',
}: EntityRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [compactMenuOpen, setCompactMenuOpen] = useState(false)

  // Compact branch only kicks in when both the flag and the render-prop are
  // provided. Desktop callsites that don't pass `compactMenu` keep the
  // existing Radix dropdown/context-menu behaviour.
  const useCompactMenu = isCompactMode && !!compactMenu

  // Long-press + suppression state. Refs (not React state) because the
  // pointer event handlers run outside React's commit cycle — updating state
  // would re-render the row on every move, which we explicitly don't want.
  const pointerDownRef = React.useRef<{
    x: number
    y: number
    timer: number
  } | null>(null)
  const suppressNextActivationRef = React.useRef(false)

  const cancelLongPress = React.useCallback(() => {
    if (pointerDownRef.current) {
      window.clearTimeout(pointerDownRef.current.timer)
      pointerDownRef.current = null
    }
  }, [])

  // Cleanup pending long-press timer on unmount — otherwise a row that
  // unmounts mid-press would fire its callback after the React tree is gone.
  React.useEffect(() => {
    return () => {
      if (pointerDownRef.current) {
        window.clearTimeout(pointerDownRef.current.timer)
        pointerDownRef.current = null
      }
    }
  }, [])

  const armSuppression = React.useCallback(() => {
    suppressNextActivationRef.current = true
    window.setTimeout(() => {
      suppressNextActivationRef.current = false
    }, SUPPRESS_ACTIVATION_MS)
  }, [])

  const openCompactMenuFromGesture = React.useCallback(() => {
    setCompactMenuOpen(true)
    armSuppression()
  }, [armSuppression])

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      // Mouse uses the native context menu path (onContextMenu). Touch / pen
      // are the only inputs that need the long-press fallback.
      if (e.pointerType === 'mouse') return
      const start = { x: e.clientX, y: e.clientY }
      const timer = window.setTimeout(() => {
        openCompactMenuFromGesture()
        pointerDownRef.current = null
      }, LONG_PRESS_MS)
      pointerDownRef.current = { ...start, timer }
    },
    [openCompactMenuFromGesture],
  )

  const onPointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      const state = pointerDownRef.current
      if (!state) return
      const decision = shouldFireLongPress(
        { x: state.x, y: state.y },
        { x: e.clientX, y: e.clientY },
        0, // elapsedMs is irrelevant for the move-cancellation path
        LONG_PRESS_MS,
        MOVE_TOLERANCE_PX,
      )
      if (decision.cancel) cancelLongPress()
    },
    [cancelLongPress],
  )

  const onContextMenuCompact = React.useCallback(
    (e: React.MouseEvent) => {
      // Desktop right-click in compact mode: open the drawer instead of
      // falling through to the native context menu (no Radix ContextMenu is
      // rendered in the compact branch).
      e.preventDefault()
      openCompactMenuFromGesture()
    },
    [openCompactMenuFromGesture],
  )

  // Wrap consumer handlers so a long-press / right-click that just opened
  // the drawer doesn't also trigger row selection on pointer release.
  const wrappedOnMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      if (suppressNextActivationRef.current) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      onMouseDown?.(e)
    },
    [onMouseDown],
  )

  const wrappedOnClick = React.useCallback(() => {
    if (suppressNextActivationRef.current) return
    onClick?.()
  }, [onClick])

  // In compact mode we don't render Radix ContextMenu, so don't expose the
  // override either — the batch menu / right-click is handled by the drawer.
  // In desktop mode the existing fallback applies.
  const resolvedContextMenu = useCompactMenu
    ? null
    : contextMenuContent ?? menuContent

  // Build the inner content (shared between with-context-menu and without)
  const innerContent = (
    <div className="relative group select-none pl-2 mr-2">
      {/* Selection indicator bar */}
      {(isSelected || isInMultiSelect) && (
        <div className="absolute left-0 inset-y-0 w-[2px] bg-accent" />
      )}

      {/* Main content button */}
      <button
        {...(buttonProps as React.ButtonHTMLAttributes<HTMLButtonElement>)}
        className={cn(
          "entity-row-btn flex w-full items-start gap-2 pl-2 pr-4 py-3 text-left text-sm outline-none rounded-[8px]",
          "transition-[background-color] duration-75",
          (isSelected || isInMultiSelect)
            ? "bg-foreground/3"
            : "hover:bg-foreground/2",
          (buttonProps as Record<string, unknown>)?.className as string | undefined,
        )}
        onMouseDown={wrappedOnMouseDown}
        onClick={!onMouseDown ? wrappedOnClick : undefined}
        onPointerDown={useCompactMenu ? onPointerDown : undefined}
        onPointerMove={useCompactMenu ? onPointerMove : undefined}
        onPointerUp={useCompactMenu ? cancelLongPress : undefined}
        onPointerCancel={useCompactMenu ? cancelLongPress : undefined}
        onPointerLeave={useCompactMenu ? cancelLongPress : undefined}
        onContextMenu={useCompactMenu ? onContextMenuCompact : undefined}
      >
        {/* Content column */}
        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          {/* Title */}
          {titleTrailing ? (
            <div className="flex items-center gap-[10px] w-full min-w-0">
              {icon && (
                <div className="shrink-0 flex items-center gap-[10px] [&>*]:w-3 [&>*]:h-3">
                  {icon}
                </div>
              )}
              <div className={cn("font-sans truncate min-w-0", titleClassName)}>
                {title}
              </div>
              {titleSuffix && <div className="shrink-0 flex items-center">{titleSuffix}</div>}
              <div className="shrink-0 ml-auto relative -mr-1">
                <span className={cn(
                  menuOpen || contextMenuOpen || compactMenuOpen
                    ? "invisible"
                    : useCompactMenu ? undefined : "group-hover:invisible",
                )}>
                  {titleTrailing}
                </span>
                {(menuContent || useCompactMenu) && !hideMoreButton && (
                  <div
                    data-touch-reveal="true"
                    className={cn(
                      "absolute inset-0 flex items-center justify-end overflow-visible",
                      menuOpen || contextMenuOpen || compactMenuOpen
                        ? "opacity-100"
                        : useCompactMenu
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100",
                    )}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {useCompactMenu ? (
                      <button
                        type="button"
                        onClick={() => setCompactMenuOpen(true)}
                        className="p-1 rounded-[6px] hover:bg-foreground/10 data-[state=open]:bg-foreground/10 cursor-pointer"
                        aria-haspopup="dialog"
                        aria-expanded={compactMenuOpen}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5 text-foreground/40" />
                      </button>
                    ) : (
                      <DropdownMenu modal={true} open={menuOpen} onOpenChange={setMenuOpen}>
                        <DropdownMenuTrigger asChild>
                          <div className="p-1 rounded-[6px] hover:bg-foreground/10 data-[state=open]:bg-foreground/10 cursor-pointer">
                            <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                        </DropdownMenuTrigger>
                        <StyledDropdownMenuContent align="end">
                          <DropdownMenuProvider>
                            {menuContent}
                          </DropdownMenuProvider>
                        </StyledDropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-[10px] w-full pr-6 min-w-0">
              {icon && (
                <div className="shrink-0 flex items-center gap-[10px] [&>*]:w-3 [&>*]:h-3">
                  {icon}
                </div>
              )}
              <div className={cn("font-medium font-sans line-clamp-2 min-w-0 -mb-[2px]", titleClassName)}>
                {title}
              </div>
              {titleSuffix && <div className="shrink-0 self-center flex items-center">{titleSuffix}</div>}
            </div>
          )}

          {/* Subtitle line */}
          {subtitle && (
            <div className="flex items-start gap-[10px] w-full text-[12px] text-foreground/55 min-w-0 -mt-1">
              {icon && (
                <div className="shrink-0 flex items-center gap-[10px] [&>*]:w-3 [&>*]:h-3 invisible" aria-hidden="true">
                  {icon}
                </div>
              )}
              <div className="min-w-0 flex-1 line-clamp-2 leading-[1.35]">
                {subtitle}
              </div>
            </div>
          )}

          {/* Badges / metadata row */}
          {(badges || trailing) && (
            <div className="flex items-center gap-[10px] text-xs text-foreground/70 w-full -mb-[2px] min-w-0">
              {/* Invisible spacer matching icon container width */}
              {icon && (
                <div className="shrink-0 flex items-center gap-[10px] [&>*]:w-3 [&>*]:h-3 invisible" aria-hidden="true">
                  {icon}
                </div>
              )}
              {badges && (
                <div
                  className="flex-1 flex items-center gap-1 min-w-0 overflow-x-auto scrollbar-hide"
                  style={{
                    maskImage: 'linear-gradient(to right, black calc(100% - 16px), transparent 100%)',
                    WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 16px), transparent 100%)',
                  }}
                >
                  {badges}
                </div>
              )}
              {trailing && (
                <div className="shrink-0 flex items-center gap-1 ml-auto">
                  {trailing}
                </div>
              )}
            </div>
          )}
        </div>
      </button>

      {/* Children rendered below the button */}
      {children}

      {/* Overlay (e.g. match count badge) */}
      {overlay}

      {/* More menu button — visible on hover or when menu is open (skipped when titleTrailing handles it inline) */}
      {(menuContent || useCompactMenu) && !hideMoreButton && !titleTrailing && (
        <div
          data-touch-reveal="true"
          className={cn(
            "absolute right-2 top-2 transition-opacity z-10",
            menuOpen || contextMenuOpen || compactMenuOpen
              ? "opacity-100"
              : useCompactMenu
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100",
          )}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center rounded-[8px] overflow-hidden border border-transparent hover:border-border/50">
            {useCompactMenu ? (
              <button
                type="button"
                onClick={() => setCompactMenuOpen(true)}
                className="p-1.5 hover:bg-foreground/10 data-[state=open]:bg-foreground/10 cursor-pointer"
                aria-haspopup="dialog"
                aria-expanded={compactMenuOpen}
              >
                <MoreHorizontal className="h-4 w-4 text-foreground/40" />
              </button>
            ) : (
              <DropdownMenu modal={true} open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <div className="p-1.5 hover:bg-foreground/10 data-[state=open]:bg-foreground/10 cursor-pointer">
                    <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                  </div>
                </DropdownMenuTrigger>
                <StyledDropdownMenuContent align="end">
                  <DropdownMenuProvider>
                    {menuContent}
                  </DropdownMenuProvider>
                </StyledDropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      )}

      {/* Compact drawer mount — the render-prop is rendered here as a
       *  sibling of the row so the drawer's portal can mount above the
       *  current panel without being clipped by the row's overflow. */}
      {useCompactMenu && compactMenu?.({
        open: compactMenuOpen,
        onOpenChange: setCompactMenuOpen,
      })}
    </div>
  )

  return (
    <div
      className={className}
      data-selected={isSelected || undefined}
      {...dataAttributes}
    >
      {/* Separator */}
      {showSeparator && (
        <div className={separatorClassName}>
          <Separator />
        </div>
      )}

      {/* Wrap with ContextMenu if menu content is provided */}
      {resolvedContextMenu ? (
        <ContextMenu modal={true} onOpenChange={setContextMenuOpen}>
          <ContextMenuTrigger asChild>
            {innerContent}
          </ContextMenuTrigger>
          <StyledContextMenuContent>
            <ContextMenuProvider>
              {resolvedContextMenu}
            </ContextMenuProvider>
          </StyledContextMenuContent>
        </ContextMenu>
      ) : (
        innerContent
      )}
    </div>
  )
}
