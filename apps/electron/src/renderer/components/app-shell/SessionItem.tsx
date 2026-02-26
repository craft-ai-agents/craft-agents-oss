import { useActionLabel } from "@/actions"
import { cn } from "@/lib/utils"
import { rendererPerf } from "@/lib/perf"
import { EntityRow } from "@/components/ui/entity-row"
import { SessionMenu } from "./SessionMenu"
import { BatchSessionMenu } from "./BatchSessionMenu"
import { SessionStatusIcon } from "./SessionStatusIcon"
import { SessionBadges } from "./SessionBadges"
import { SessionTrailing } from "./SessionTrailing"
import { getSessionTitle, highlightMatch } from "@/utils/session"
import { useSessionListContext } from "@/context/SessionListContext"
import { navigate, routes } from "@/lib/navigate"
import type { SessionMeta } from "@/atoms/sessions"

export interface SessionItemProps {
  item: SessionMeta
  index: number
  itemProps: Record<string, unknown>
  isSelected: boolean
  isFirstInGroup: boolean
  isInMultiSelect: boolean
  depth?: 0 | 1
  childCount?: number
  isParentExpanded?: boolean
  onToggleChildren?: () => void
  isFirstChild?: boolean
  isLastChild?: boolean
  onSelect: () => void
  onToggleSelect?: () => void
  onRangeSelect?: () => void
}

export function SessionItem({
  item,
  itemProps,
  isSelected,
  isFirstInGroup,
  isInMultiSelect,
  depth = 0,
  childCount = 0,
  isParentExpanded = false,
  onToggleChildren,
  isFirstChild = false,
  isLastChild = false,
  onSelect,
  onToggleSelect,
  onRangeSelect,
}: SessionItemProps) {
  const ctx = useSessionListContext()
  const { hotkey: nextHotkey } = useActionLabel('chat.nextSearchMatch')
  const { hotkey: prevHotkey } = useActionLabel('chat.prevSearchMatch')
  const title = getSessionTitle(item)
  const chatMatchCount = ctx.contentSearchResults.get(item.id)?.matchCount
  const hasMatch = chatMatchCount != null && chatMatchCount > 0

  const handleClick = (e: React.MouseEvent) => {
    ctx.onFocusZone()
    if (e.button === 2) {
      if (ctx.isMultiSelectActive && !isInMultiSelect && onToggleSelect) onToggleSelect()
      return
    }
    if ((e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (ctx.isMultiSelectActive && onToggleSelect) {
        // Multi-select active: keep existing Cmd+Click toggle behavior
        onToggleSelect()
      } else {
        // No multi-select: open session in a new panel
        navigate(routes.view.allSessions(item.id), { newPanel: true })
      }
      return
    }
    if (e.shiftKey && onRangeSelect) {
      e.preventDefault()
      onRangeSelect()
      return
    }
    rendererPerf.startSessionSwitch(item.id)
    onSelect()
  }

  const childLineClassName = isFirstChild && isLastChild
    ? "top-[3px] bottom-[3px]"
    : isFirstChild
      ? "top-[3px] bottom-0"
      : isLastChild
        ? "top-0 bottom-[3px]"
        : "top-0 bottom-0"

  return (
    <div className={cn(depth > 0 && "relative pl-5")}>
      {depth > 0 && (
        <div
          className={cn("absolute left-[22px] w-px bg-foreground/10 pointer-events-none", childLineClassName)}
          aria-hidden="true"
        />
      )}
      <EntityRow
        className={cn("session-item", depth > 0 && "child-session-item")}
        dataAttributes={{ 'data-session-id': item.id }}
        showSeparator={depth === 0 ? !isFirstInGroup : false}
        separatorClassName={depth > 0 ? "pl-[32px] pr-4" : "pl-12 pr-4"}
        isSelected={isSelected}
        isInMultiSelect={isInMultiSelect}
        onMouseDown={handleClick}
        hideMoreButton={hasMatch}
        buttonProps={{
          ...itemProps,
          onKeyDown: (e: React.KeyboardEvent) => {
            ;(itemProps as { onKeyDown: (event: React.KeyboardEvent) => void }).onKeyDown(e)
            ctx.onKeyDown(e, item)
          },
        }}
        menuContent={
          <SessionMenu
            item={item}
            sessionStatuses={ctx.sessionStatuses}
            labels={ctx.labels}
            onLabelsChange={ctx.onLabelsChange ? (ls) => ctx.onLabelsChange!(item.id, ls) : undefined}
            onRename={() => ctx.onRenameClick(item.id, title)}
            onFlag={() => ctx.onFlag?.(item.id)}
            onUnflag={() => ctx.onUnflag?.(item.id)}
            onArchive={() => ctx.onArchive?.(item.id)}
            onUnarchive={() => ctx.onUnarchive?.(item.id)}
            onMarkUnread={() => ctx.onMarkUnread(item.id)}
            onSessionStatusChange={(s) => ctx.onSessionStatusChange(item.id, s)}
            onOpenInNewWindow={() => ctx.onOpenInNewWindow(item)}
            onDelete={() => ctx.onDelete(item.id)}
          />
        }
        contextMenuContent={ctx.isMultiSelectActive && isInMultiSelect ? <BatchSessionMenu /> : undefined}
        icon={
          <div className="flex flex-col items-center gap-1">
            <SessionStatusIcon item={item} />
            {depth === 0 && childCount > 0 && (
              <span
                className="h-[18px] min-w-[18px] px-1 flex items-center justify-center rounded bg-background shadow-minimal text-[10px] text-foreground/70 font-medium tabular-nums hover:text-foreground transition-colors cursor-pointer"
                title={`${isParentExpanded ? 'Hide' : 'Show'} child sessions`}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onToggleChildren?.()
                }}
              >
                {childCount}
              </span>
            )}
          </div>
        }
        title={ctx.searchQuery ? highlightMatch(title, ctx.searchQuery) : title}
        titleClassName={item.isAsyncOperationOngoing ? "animate-shimmer-text" : undefined}
        badges={<SessionBadges item={item} />}
        trailing={
          <SessionTrailing
            item={item}
            childCount={0}
            childrenOpen={isParentExpanded}
            onToggleChildren={() => onToggleChildren?.()}
          />
        }
        overlay={hasMatch ? (
          <div className="absolute right-3 top-2 z-10">
            <span
              className={cn(
                "inline-flex items-center justify-center min-w-[24px] px-1 py-1 rounded-[6px] text-[10px] font-medium tabular-nums leading-tight whitespace-nowrap",
                isSelected
                  ? "bg-yellow-300/50 border border-yellow-500 text-yellow-900"
                  : "bg-yellow-300/10 border border-yellow-600/20 text-yellow-800"
              )}
              style={{
                boxShadow: isSelected
                  ? '0 1px 2px 0 rgba(234, 179, 8, 0.3)'
                  : '0 1px 2px 0 rgba(133, 77, 14, 0.15)',
              }}
              title={`Matches found (${nextHotkey} next, ${prevHotkey} prev)`}
            >
              {chatMatchCount}
            </span>
          </div>
        ) : null}
      />
    </div>
  )
}
