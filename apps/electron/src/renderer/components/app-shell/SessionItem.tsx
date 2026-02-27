import { formatDistanceToNowStrict } from "date-fns"
import type { Locale } from "date-fns"
import { Flag } from "lucide-react"
import { useActionLabel } from "@/actions"
import { cn } from "@/lib/utils"
import { rendererPerf } from "@/lib/perf"
import { Spinner } from "@craft-agent/ui"
import { EntityRow } from "@/components/ui/entity-row"
import { SessionMenu } from "./SessionMenu"
import { BatchSessionMenu } from "./BatchSessionMenu"
import { SessionStatusIcon } from "./SessionStatusIcon"
import { SessionBadges } from "./SessionBadges"
import { getSessionTitle, highlightMatch, hasUnreadMeta, shortTimeLocale } from "@/utils/session"
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
  const hasLabels = item.labels && item.labels.length > 0 && ctx.flatLabels.length > 0

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

  return (
    <EntityRow
      className="session-item"
      dataAttributes={{ 'data-session-id': item.id }}
      showSeparator={!isFirstInGroup}
      separatorClassName="pl-4 pr-4"
      isSelected={isSelected}
      isInMultiSelect={isInMultiSelect}
      onMouseDown={handleClick}
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
        <>
          <SessionStatusIcon item={item} />
          <div className={cn(
            "flex items-center justify-center overflow-hidden [&>svg]:w-full [&>svg]:h-full",
            "transition-all duration-200 ease-out",
            (item.isProcessing || hasUnreadMeta(item) || item.lastMessageRole === 'plan')
              ? "opacity-100 ml-0"
              : "!w-0 opacity-0 -ml-[10px]"
          )}>
            {item.isProcessing ? (
              <Spinner className="text-[10px]" />
            ) : hasUnreadMeta(item) ? (
              <svg className="text-accent" viewBox="0 0 21 20" fill="currentColor">
                <path fillRule="nonzero" d="M10.709,19.92 C9.335,19.92 8.046,19.661 6.842,19.144 C5.637,18.626 4.579,17.91 3.668,16.995 C2.757,16.08 2.042,15.022 1.524,13.821 C1.007,12.62 0.748,11.333 0.748,9.959 C0.748,8.585 1.007,7.296 1.524,6.092 C2.042,4.887 2.757,3.829 3.668,2.918 C4.579,2.007 5.637,1.292 6.842,0.774 C8.046,0.257 9.335,-0.002 10.709,-0.002 C12.083,-0.002 13.372,0.257 14.576,0.774 C15.781,1.292 16.839,2.007 17.75,2.918 C18.661,3.829 19.376,4.887 19.894,6.092 C20.411,7.296 20.67,8.585 20.67,9.959 C20.67,11.333 20.411,12.62 19.894,13.821 C19.376,15.022 18.661,16.08 17.75,16.995 C16.839,17.91 15.781,18.626 14.576,19.144 C13.372,19.661 12.083,19.92 10.709,19.92Z M10.699,14.588 C11.773,14.588 12.729,14.388 13.565,13.987 C14.402,13.587 15.06,13.038 15.538,12.342 C16.017,11.645 16.256,10.851 16.256,9.959 C16.256,9.061 16.017,8.265 15.538,7.571 C15.06,6.878 14.402,6.333 13.565,5.936 C12.729,5.538 11.773,5.34 10.699,5.34 C9.625,5.34 8.67,5.538 7.833,5.936 C6.996,6.333 6.339,6.878 5.86,7.571 C5.382,8.265 5.143,9.061 5.143,9.959 C5.143,10.441 5.196,10.846 5.304,11.175 C5.411,11.504 5.535,11.785 5.675,12.02 C5.815,12.254 5.937,12.467 6.041,12.659 C6.145,12.851 6.197,13.055 6.197,13.27 C6.197,13.452 6.166,13.613 6.104,13.753 C6.043,13.893 5.937,14.028 5.787,14.158 C5.683,14.262 5.654,14.36 5.699,14.451 C5.745,14.542 5.846,14.588 6.002,14.588 C6.334,14.588 6.661,14.536 6.983,14.432 C7.306,14.327 7.59,14.184 7.838,14.002 C8.255,14.197 8.704,14.344 9.186,14.441 C9.667,14.539 10.172,14.588 10.699,14.588Z" />
              </svg>
            ) : item.lastMessageRole === 'plan' ? (
              <svg className="text-success" viewBox="0 0 24 24" fill="currentColor">
                <path fillRule="nonzero" d="M11.748,21.988 C10.369,21.988 9.075,21.729 7.866,21.209 C6.657,20.69 5.595,19.97 4.68,19.052 C3.765,18.134 3.048,17.072 2.528,15.866 C2.008,14.66 1.748,13.367 1.748,11.988 C1.748,10.609 2.008,9.315 2.528,8.106 C3.048,6.897 3.765,5.835 4.68,4.92 C5.595,4.005 6.657,3.287 7.866,2.768 C9.075,2.248 10.369,1.988 11.748,1.988 C13.127,1.988 14.421,2.248 15.63,2.768 C16.84,3.287 17.902,4.005 18.817,4.92 C19.732,5.835 20.449,6.897 20.969,8.106 C21.488,9.315 21.748,10.609 21.748,11.988 C21.748,13.367 21.488,14.66 20.969,15.866 C20.449,17.072 19.732,18.134 18.817,19.052 C17.902,19.97 16.84,20.69 15.63,21.209 C14.421,21.729 13.127,21.988 11.748,21.988Z M11.974,18.363 C12.176,18.363 12.353,18.284 12.503,18.127 C12.654,17.97 12.778,17.758 12.876,17.49 L16.581,7.813 C16.679,7.545 16.729,7.323 16.729,7.147 C16.729,6.964 16.676,6.82 16.572,6.715 C16.467,6.611 16.327,6.559 16.15,6.559 C15.967,6.559 15.742,6.611 15.474,6.715 L5.748,10.441 C5.52,10.526 5.325,10.64 5.165,10.784 C5.005,10.928 4.925,11.104 4.925,11.314 C4.925,11.568 5.011,11.753 5.184,11.868 C5.358,11.982 5.578,12.081 5.846,12.166 L8.915,13.088 C9.098,13.14 9.247,13.161 9.361,13.152 C9.475,13.142 9.595,13.085 9.719,12.98 L15.895,7.186 C15.967,7.127 16.039,7.124 16.111,7.176 C16.183,7.235 16.183,7.307 16.111,7.392 L10.346,13.608 C10.242,13.719 10.18,13.831 10.16,13.946 C10.14,14.06 10.157,14.215 10.209,14.411 L11.111,17.382 C11.203,17.67 11.304,17.905 11.415,18.088 C11.526,18.271 11.712,18.363 11.974,18.363Z" />
              </svg>
            ) : null}
          </div>
        </>
      }
      title={ctx.searchQuery ? highlightMatch(title, ctx.searchQuery) : title}
      titleClassName={cn("text-[13px]", item.isAsyncOperationOngoing && "animate-shimmer-text")}
      titleTrailing={hasMatch ? (
        <span
          className={cn(
            "inline-flex items-center justify-center min-w-[24px] px-1 py-0.5 rounded-[6px] text-[10px] font-medium tabular-nums leading-tight whitespace-nowrap",
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
      ) : item.isFlagged ? (
        <div className="p-1 flex items-center justify-center">
          <Flag className="h-3.5 w-3.5 text-info" />
        </div>
      ) : item.lastMessageAt ? (
        <span className="text-[11px] text-foreground/40 whitespace-nowrap">
          {formatDistanceToNowStrict(new Date(item.lastMessageAt), { locale: shortTimeLocale as Locale, roundingMethod: 'floor' })}
        </span>
      ) : undefined}
      badges={hasLabels ? <SessionBadges item={item} /> : undefined}
    />
  )
}
