import { useTranslation } from "react-i18next"
import { AlertCircle, ChevronRight, CodeXml, Flag, Hand } from "lucide-react"
import { useActionLabel } from "@/actions"
import { cn } from "@/lib/utils"
import { rendererPerf } from "@/lib/perf"
import { Spinner } from "@craft-agent/ui"
import { EntityRow, type TreeGuide } from "@/components/ui/entity-row"
import { EntityListBadge } from "@/components/ui/entity-list-badge"
import { SessionMenu } from "./SessionMenu"
import { BatchSessionMenu } from "./BatchSessionMenu"
import { CompactSessionMenu } from "./CompactSessionMenu"
import { SessionStatusIcon } from "./SessionStatusIcon"
import { SessionBadges, chipButtonProps } from "./SessionBadges"
import { SessionProjectColorWrapper } from "./SessionProjectColorWrapper"
import { hasTransferTargets } from "./transfer-targets"
import { useProjectColorTreatment } from "@/hooks/useProjectColorTreatment"
import { getSessionTitle, getSessionPreviewText, highlightMatch, hasUnreadMeta, formatShortAge } from "@/utils/session"
import { useSessionListContext } from "@/context/SessionListContext"
import { useAppShellContext } from "@/context/AppShellContext"
import { navigate, routes } from "@/lib/navigate"
import type { SessionMeta } from "@/atoms/sessions"
import { messagingBindingsBySessionAtom } from "@/atoms/messaging"
import { useAtomValue } from "jotai"
import { extractLabelId } from "@craft-agent/shared/labels"

/** Messaging bindings are labelled by platform name; the chip itself is neutral (labels are taxonomy, not status). */
const PLATFORM_LABEL: Record<'telegram' | 'whatsapp', string> = {
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
}

/** Plan-ready mark (paper plane) — same glyph the row used before, now on the subtitle line. */
function PlanReadyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 25 24" fill="currentColor" aria-hidden="true">
      <path fillRule="nonzero" d="M13.7207031,22.6523438 C13.264974,22.6523438 12.9361979,22.4895833 12.734375,22.1640625 C12.5325521,21.8385417 12.360026,21.4316406 12.2167969,20.9433594 L10.6640625,15.7871094 C10.5729167,15.4615885 10.5403646,15.1995443 10.5664062,15.0009766 C10.5924479,14.8024089 10.6998698,14.6022135 10.8886719,14.4003906 L20.859375,3.6484375 C20.9179688,3.58984375 20.9472656,3.52473958 20.9472656,3.453125 C20.9472656,3.38151042 20.921224,3.32291667 20.8691406,3.27734375 C20.8170573,3.23177083 20.7568359,3.20735677 20.6884766,3.20410156 C20.6201172,3.20084635 20.5566406,3.22851562 20.4980469,3.28710938 L9.78515625,13.296875 C9.5703125,13.4921875 9.36197917,13.601237 9.16015625,13.6240234 C8.95833333,13.6468099 8.70117188,13.609375 8.38867188,13.5117188 L3.11523438,11.9101562 C2.64648438,11.7669271 2.25911458,11.5960286 1.953125,11.3974609 C1.64713542,11.1988932 1.49414062,10.875 1.49414062,10.4257812 C1.49414062,10.0742188 1.63411458,9.77148438 1.9140625,9.51757812 C2.19401042,9.26367188 2.5390625,9.05859375 2.94921875,8.90234375 L19.7460938,2.46679688 C19.9739583,2.38216146 20.1871745,2.31542969 20.3857422,2.26660156 C20.5843099,2.21777344 20.764974,2.19335938 20.9277344,2.19335938 C21.2467448,2.19335938 21.4973958,2.28450521 21.6796875,2.46679688 C21.8619792,2.64908854 21.953125,2.89973958 21.953125,3.21875 C21.953125,3.38802083 21.9287109,3.5703125 21.8798828,3.765625 C21.8310547,3.9609375 21.7643229,4.17252604 21.6796875,4.40039062 L15.2832031,21.109375 C15.1009115,21.578125 14.8828125,21.952474 14.6289062,22.2324219 C14.375,22.5123698 14.0722656,22.6523438 13.7207031,22.6523438 Z" />
    </svg>
  )
}

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
  /** Nesting level under the session's list parent (0 = top level) */
  depth?: number
  /** Tree lines of the levels above the row (see `EntityRow`) */
  guides?: readonly TreeGuide[]
  /** Label entries the row's parent shows too (a task's family shares its label), left out here */
  inheritedLabels?: readonly string[]
  /** The sessions nested under this row, when it has any */
  subSessions?: { count: number; collapsed: boolean; onToggle: () => void }
}

/**
 * One session row (design spec §2.4 "one slot, one meaning", §7.2):
 * - leading glyph = the user's workflow status (click to change it)
 * - title (600 when unread) · age (unread: led by an 8px accent dot, age in accent)
 * - subtitle = run state with its own shape and color (needs you · working · failed · plan ready),
 *   else the labels (chips tinted with each label's color), else the session preview (top level only)
 * - sub-sessions: a parent's subtitle line leads with their toggle, under the glyph, where the tree line to
 *   its nested rows starts; a nested row leaves out the labels its parent shows
 */
export function SessionItem({
  item,
  itemProps,
  isSelected,
  isFirstInGroup: _isFirstInGroup,
  isInMultiSelect,
  onSelect,
  onToggleSelect,
  onRangeSelect,
  depth = 0,
  guides,
  inheritedLabels,
  subSessions,
}: SessionItemProps) {
  const { t } = useTranslation()
  const ctx = useSessionListContext()
  const { workspaces, isCompactMode } = useAppShellContext()
  const canSendToWorkspace = hasTransferTargets(workspaces)
  const { hotkey: nextHotkey } = useActionLabel('chat.nextSearchMatch')
  const { hotkey: prevHotkey } = useActionLabel('chat.prevSearchMatch')
  const title = getSessionTitle(item)
  // For the active session, prefer logical match count over ripgrep count
  const activeMatch = ctx.activeChatMatchInfo
  const isActiveSession = isSelected && activeMatch?.sessionId === item.id
  const ripgrepMatchCount = ctx.contentSearchResults.get(item.id)?.matchCount
  const chatMatchCount = isActiveSession ? activeMatch!.count : ripgrepMatchCount
  const hasMatch = chatMatchCount != null && chatMatchCount > 0
  const hasLabels = !!(item.labels && item.labels.length > 0 && ctx.flatLabels.length > 0 && item.labels.some(entry => {
    if (inheritedLabels?.includes(entry)) return false
    const labelId = extractLabelId(entry)
    return ctx.flatLabels.some(l => l.id === labelId)
  }))
  const hasPendingPrompt = ctx.hasPendingPrompt?.(item.id) ?? false
  const isUnread = hasUnreadMeta(item)
  const messagingBindingsBySession = useAtomValue(messagingBindingsBySessionAtom)
  const sessionBindings = messagingBindingsBySession.get(item.id) ?? []
  const hasMessagingBinding = sessionBindings.length > 0

  // Run state owns the subtitle line; attention states win (spec §2.4).
  const runState: 'needs-you' | 'working' | 'failed' | 'plan' | null = hasPendingPrompt
    ? 'needs-you'
    : item.isProcessing
      ? 'working'
      : item.lastMessageRole === 'error'
        ? 'failed'
        : item.lastMessageRole === 'plan'
          ? 'plan'
          : null
  const needsAttention = runState === 'needs-you' || runState === 'failed'
  // One line, one subject: run state, else labels (full width), else the preview. Squeezing the preview
  // and the chips into one line truncated both into fragments ("Run `gh issu…" · "Schedul…"). A nested
  // row skips the preview (its prompt, which its parent wrote), so a family stays compact.
  const previewText = runState || hasLabels || depth > 0 ? null : getSessionPreviewText(item)

  // Resolve the bound project so the row can show a project-themed stripe /
  // tint and reveal the project name on hover. Treatment is a user preference
  // under Appearance.
  const projectColorTreatment = useProjectColorTreatment()
  const boundProject = item.projectId
    ? ctx.projects?.find(p => p.id === item.projectId)
    : undefined
  const projectColor = boundProject?.color
  const projectName = boundProject?.name

  const handleClick = (e: React.MouseEvent) => {
    ctx.onFocusZone()
    if (e.button === 2) {
      if (ctx.isMultiSelectActive && !isInMultiSelect && onToggleSelect) onToggleSelect()
      return
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
      // Cmd+Shift+Click: open session in a new panel
      e.preventDefault()
      navigate(routes.view.allSessions(item.id), { newPanel: true })
      return
    }
    if ((e.metaKey || e.ctrlKey) && onToggleSelect) {
      // Cmd+Click: always toggle multi-select (standard OS behavior)
      e.preventDefault()
      onToggleSelect()
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

  const subtitle = runState === 'needs-you' ? (
    <span className="flex items-center gap-1.5 min-w-0 text-info">
      <Hand className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{t("session.runState.needsYou")}</span>
    </span>
  ) : runState === 'working' ? (
    <span className="flex items-center gap-1.5 min-w-0">
      <Spinner className="text-label text-accent shrink-0" />
      <span className="truncate">{t("session.runState.working")}</span>
    </span>
  ) : runState === 'failed' ? (
    <span className="flex items-center gap-1.5 min-w-0 text-destructive">
      <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{t("session.runState.failed")}</span>
    </span>
  ) : runState === 'plan' ? (
    <span className="flex items-center gap-1.5 min-w-0">
      <PlanReadyIcon className="size-3.5 shrink-0 text-success" />
      <span className="truncate">{t("session.runState.planReady")}</span>
    </span>
  ) : previewText

  // Sub-session toggle, under the status glyph: the chevron turns like a group header's, and the rows
  // appear at once. The count is in its name and tooltip.
  const subSessionToggleLabel = subSessions && (subSessions.collapsed
    ? t("session.showSubSessions", { count: subSessions.count })
    : t("session.hideSubSessions", { count: subSessions.count }))
  const subSessionToggle = subSessions ? (
    <div
      {...chipButtonProps(subSessions.onToggle)}
      data-slot="sub-session-toggle"
      aria-expanded={!subSessions.collapsed}
      aria-label={subSessionToggleLabel}
      title={subSessionToggleLabel}
      className={cn(
        // A 20px circle like the status glyph's hover above it, laid out at the glyph's 16px
        "relative grid size-5 -m-0.5 shrink-0 place-items-center rounded-full text-tertiary cursor-pointer -outline-offset-2",
        "transition-[background-color,color] duration-micro ease-out-subtle hover:bg-fill-pressed hover:text-foreground hover:duration-instant",
        // Touch: a 36px-wide hit area down to the row's edge, clear of the status glyph above
        "@max-mobile/shell:before:absolute @max-mobile/shell:before:-inset-x-2 @max-mobile/shell:before:top-0 @max-mobile/shell:before:-bottom-3",
      )}
    >
      <ChevronRight
        aria-hidden
        className={cn(
          "size-3.5 transition-transform duration-(--spring-snap-dur) ease-(--spring-snap)",
          !subSessions.collapsed && "rotate-90",
        )}
      />
    </div>
  ) : undefined
  // A parent with nothing else on its subtitle line names its sub-sessions there, beside the toggle. The
  // text toggles too (a mouse convenience: the chevron is the control assistive tech gets).
  const subSessionCount = subSessions && !subtitle && !hasLabels ? (
    <span
      aria-hidden="true"
      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
      onClick={(e) => { e.stopPropagation(); subSessions.onToggle() }}
      className="cursor-pointer text-tertiary transition-colors duration-micro ease-out-subtle hover:text-foreground hover:duration-instant"
    >
      {t("session.subSessionCount", { count: subSessions.count })}
    </span>
  ) : null

  return (
    <SessionProjectColorWrapper color={projectColor} treatment={projectColorTreatment}>
    <EntityRow
      className="session-item"
      dataAttributes={{ 'data-session-id': item.id }}
      depth={depth}
      guides={guides}
      guideBelow={!!subSessions && !subSessions.collapsed}
      isSelected={isSelected}
      isInMultiSelect={isInMultiSelect}
      // When a project stripe is drawn at the leading edge, suppress EntityRow's
      // own multi-select bar so they don't stack. The row's background tint
      // continues to convey "selected".
      suppressSelectionBar={!!projectColor}
      onMouseDown={handleClick}
      buttonProps={{
        ...itemProps,
        onKeyDown: (e: React.KeyboardEvent) => {
          ;(itemProps as { onKeyDown: (event: React.KeyboardEvent) => void }).onKeyDown(e)
          ctx.onKeyDown(e, item)
        },
      }}
      moreButtonLabel={t("session.actionsFor", { title })}
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
          onSendToWorkspace={ctx.onSendToWorkspace ? () => ctx.onSendToWorkspace!([item.id]) : undefined}
          hasTransferTargets={canSendToWorkspace}
          onDelete={() => ctx.onDelete(item.id)}
          projects={ctx.projects}
          onSetProjectId={ctx.onSetProjectId ? (pid) => ctx.onSetProjectId!(item.id, pid) : undefined}
        />
      }
      contextMenuContent={ctx.isMultiSelectActive && isInMultiSelect ? <BatchSessionMenu /> : undefined}
      isCompactMode={isCompactMode}
      compactMenu={({ open, onOpenChange }) => (
        <CompactSessionMenu
          open={open}
          onOpenChange={onOpenChange}
          trigger={null}
          title={title}
          item={item}
          sessionStatuses={ctx.sessionStatuses}
          labels={ctx.labels}
          hasTransferTargets={canSendToWorkspace}
          onLabelsChange={ctx.onLabelsChange ? (ls) => ctx.onLabelsChange!(item.id, ls) : undefined}
          onRename={() => ctx.onRenameClick(item.id, title)}
          onFlag={() => ctx.onFlag?.(item.id)}
          onUnflag={() => ctx.onUnflag?.(item.id)}
          onArchive={() => ctx.onArchive?.(item.id)}
          onUnarchive={() => ctx.onUnarchive?.(item.id)}
          onMarkUnread={() => ctx.onMarkUnread(item.id)}
          onSessionStatusChange={(s) => ctx.onSessionStatusChange(item.id, s)}
          onOpenInNewWindow={() => ctx.onOpenInNewWindow(item)}
          onSendToWorkspace={ctx.onSendToWorkspace ? () => ctx.onSendToWorkspace!([item.id]) : undefined}
          onDelete={() => ctx.onDelete(item.id)}
        />
      )}
      icon={<SessionStatusIcon item={item} />}
      title={ctx.searchQuery ? highlightMatch(title, ctx.searchQuery) : title}
      titleClassName={cn(isUnread && "font-semibold", item.isAsyncOperationOngoing && "animate-shimmer-text")}
      subtitle={subtitle ?? subSessionCount}
      subtitleLeading={subSessionToggle}
      subtitleTrailing={hasLabels && !needsAttention ? <SessionBadges item={item} hiddenLabels={inheritedLabels} /> : undefined}
      titleSuffix={
        (projectName || hasMessagingBinding || item.codingMode) ? (
          <div className="flex items-center gap-1">
            {item.codingMode && (
              <CodeXml className="size-3.5 shrink-0 text-tertiary" aria-label={t("chat.codingMode.label")} />
            )}
            {projectName && (
              // Revealed on hover/focus only, and out of the layout otherwise: an invisible (opacity-0)
              // name still reserved its width and cut the title short for nothing. Solved tertiary
              // text, not the raw project color (purple text failed AA); the stripe carries the color.
              <span
                className="hidden group-hover:inline group-focus-within:inline text-label-sm text-tertiary whitespace-nowrap truncate max-w-[120px]"
                title={projectName}
              >
                {projectName}
              </span>
            )}
            {hasMessagingBinding && sessionBindings.map((binding) => {
              const label = PLATFORM_LABEL[binding.platform as 'telegram' | 'whatsapp']
              if (!label) return null
              return (
                <EntityListBadge
                  key={binding.id}
                  variant="text"
                  colorClass="bg-fill-hover text-secondary"
                  tooltip={`Connected to ${label}`}
                >
                  {label}
                </EntityListBadge>
              )
            })}
          </div>
        ) : undefined
      }
      titleTrailing={isUnread && !hasMatch ? (
        // Unread: an accent dot leads the meta and the age turns accent, so the signal sits on the
        // row's own grid (the trailing slot) instead of floating in the bleed past the gutter.
        <span className="inline-flex items-center gap-1.5 text-accent">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent-solid" />
          <span className="sr-only">{t("session.unreadIndicator")}</span>
          {item.isFlagged ? (
            <Flag className="size-3.5 text-info" aria-label={t("sidebar.flagged")} />
          ) : item.lastMessageAt ? (
            formatShortAge(item.lastMessageAt)
          ) : null}
        </span>
      ) : hasMatch ? (
        <span
          className="inline-flex h-[18px] min-w-6 items-center justify-center rounded-xs px-1 text-caption tabular-nums bg-info-tint text-info"
          title={`Matches found (${nextHotkey} next, ${prevHotkey} prev)`}
        >
          {chatMatchCount}
        </span>
      ) : item.isFlagged ? (
        <Flag className="size-3.5 text-info" aria-label={t("sidebar.flagged")} />
      ) : item.lastMessageAt ? (
        <span>
          {formatShortAge(item.lastMessageAt)}
        </span>
      ) : undefined}
    />
    </SessionProjectColorWrapper>
  )
}
