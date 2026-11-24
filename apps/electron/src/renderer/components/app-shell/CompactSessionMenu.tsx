/**
 * CompactSessionMenu
 *
 * Bottom-sheet replacement for the desktop `SessionMenu` dropdowns (the chat
 * header's ⋯ and the session row's ⋯) when
 * `AppShellContext.isCompactMode === true`. Mirrors the same actions but
 * routes Status / Labels / Share / Connect Messaging submenus through
 * an internal view stack instead of nested Radix popovers — Radix submenus
 * get clipped by the panel container query on narrow viewports, and the
 * Status submenu in particular falls off the right edge.
 *
 * Pattern matches the other compact pickers (`CompactSessionListFilter`,
 * `CompactWorkspaceSwitcher`, `CompactPermissionModeSelector`) and also
 * follows the iOS-style drill-in behaviour established by `MobileAppMenu`.
 *
 * Side-effect handlers (share / refresh title / copy path / share submenu /
 * label toggle with optimistic state) come from `useSessionMenuActions`,
 * shared with the desktop `SessionMenu` so a new session action only has to
 * be wired through one place.
 *
 * Leaf actions close the drawer on tap. Label toggles do NOT close the
 * drawer so the user can apply multiple labels in one pass — same UX as
 * the desktop submenu.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  AppWindow,
  Check,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  Columns2,
  Copy,
  Flag,
  FlagOff,
  FolderOpen,
  Globe,
  Info,
  Link2Off,
  MailOpen,
  MessageSquare,
  Pencil,
  RefreshCw,
  Send,
  Tag,
  Trash2,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { LabelIcon } from '@/components/ui/label-icon'
import {
  createLabelMenuItems,
  type LabelMenuItem,
} from '@/components/ui/label-menu-utils'
import type { LabelConfig } from '@craft-agent/shared/labels'
import {
  getStateColor,
  getStateIcon,
  getStatusIconStyle,
  type SessionStatus,
  type SessionStatusId,
} from '@/config/session-status-config'
import type { SessionMeta } from '@/atoms/sessions'
import { getSessionStatus, hasUnreadMeta, hasMessagesMeta } from '@/utils/session'
import { getFileManagerName } from '@/lib/platform'
import { statusDisplayLabel } from '@/components/ui/session-status-menu'
import { useMessagingConnect, type MessagingPlatform } from '@/components/messaging/MessagingSessionMenuItem'
import { useSessionMenuActions } from '@/hooks/useSessionMenuActions'

type View = 'root' | 'status' | 'labels' | 'share' | 'messaging'

export interface CompactSessionMenuProps {
  /** Title shown in the drawer header's root pane. */
  title?: string

  // Session data — same as SessionMenu
  item: SessionMeta
  sessionStatuses: SessionStatus[]
  labels?: LabelConfig[]
  hasTransferTargets?: boolean

  // Callbacks — same as SessionMenu
  onLabelsChange?: (labels: string[]) => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onRename: () => void
  onFlag: () => void
  onUnflag: () => void
  onArchive: () => void
  onUnarchive: () => void
  onMarkUnread: () => void
  onSessionStatusChange: (state: SessionStatusId) => void
  onOpenInNewWindow: () => void
  onSendToWorkspace?: () => void
  onDelete: () => void
  /** Adds a "Session info" row (the chat header moves its Info button in here on phones). */
  onShowInfo?: () => void

  // ---------------------------------------------------------------------------
  // Controlled-component shim — used by SessionItem and the chat header so a
  // single drawer instance can be driven from several triggers (`…` button,
  // long-press, the header's status glyph). When `open` is omitted the
  // component owns its own state. Matches the Radix Dialog convention.
  // ---------------------------------------------------------------------------
  /** Controlled open state. When omitted, the component owns its own state. */
  open?: boolean
  /** Notifies the consumer when the controlled open state should change. */
  onOpenChange?: (open: boolean) => void
  /** Pane each opening starts on (the chat header's status glyph opens straight onto Status). */
  initialView?: 'root' | 'status'
  /** Where focus goes when the drawer closes; without a trigger Radix has nothing to return it to. */
  onCloseAutoFocus?: (event: Event) => void
  /** Trigger node, wrapped in the drawer trigger. Omit or pass `null` when the
   *  consumer opens the drawer itself through `open`. */
  trigger?: React.ReactNode | null
}

export function CompactSessionMenu({
  title,
  item,
  sessionStatuses,
  labels = [],
  hasTransferTargets,
  onLabelsChange,
  onMoveUp,
  onMoveDown,
  onRename,
  onFlag,
  onUnflag,
  onArchive,
  onUnarchive,
  onMarkUnread,
  onSessionStatusChange,
  onOpenInNewWindow,
  onSendToWorkspace,
  onDelete,
  onShowInfo,
  open: controlledOpen,
  onOpenChange,
  initialView = 'root',
  onCloseAutoFocus,
  trigger,
}: CompactSessionMenuProps) {
  const { t } = useTranslation()
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange],
  )
  const [view, setView] = React.useState<View>(initialView)

  // Every opening starts on `initialView`, so the next open never shows a sub-pane left over from
  // the last one. Set before paint (no flash of the old pane), and on open rather than on close so
  // the closing drawer keeps its pane while it animates out.
  React.useLayoutEffect(() => {
    if (open) setView(initialView)
  }, [open, initialView])

  // Close+reset the drawer if the underlying session changes while it's open.
  // Otherwise action handlers retarget to the new session (e.g. user opens
  // menu for A, navigation switches to B, "Delete" deletes B).
  React.useEffect(() => {
    setOpen(false)
    setView('root')
  }, [item.id, setOpen])

  const isFlagged = item.isFlagged ?? false
  const isArchived = item.isArchived ?? false
  const sharedUrl = item.sharedUrl
  const currentSessionStatus = getSessionStatus(item)
  const _hasMessages = hasMessagesMeta(item)
  const _hasUnread = hasUnreadMeta(item)

  const actions = useSessionMenuActions({ item, onLabelsChange })

  const flatLabelItems = React.useMemo(
    (): LabelMenuItem[] => createLabelMenuItems(labels),
    [labels],
  )

  // Wrap a callback so it also closes the drawer. Async callbacks fire
  // their work in the background — the drawer doesn't need to stay open
  // for the request to complete.
  const closeAfter = React.useCallback(
    <T extends (...args: never[]) => void | Promise<void>>(fn?: T) => {
      if (!fn) return undefined
      return ((...args: Parameters<T>) => {
        void fn(...args)
        setOpen(false)
      }) as T
    },
    [setOpen],
  )

  const connectMessaging = useMessagingConnect({ sessionId: item.id })
  const handleConnectMessaging = (platform: MessagingPlatform) => {
    setOpen(false)
    void connectMessaging(platform)
  }

  // ---------------------------------------------------------------------------
  // Drawer header — shared between root + sub-panes. Sub-panes show a back
  // chevron; the root pane shows the session title.
  // ---------------------------------------------------------------------------
  const headerTitle = (() => {
    switch (view) {
      case 'status':    return t('sessionMenu.status')
      case 'labels':    return t('sessionMenu.labels')
      case 'share':     return t('sessionMenu.shared')
      case 'messaging': return t('sessionMenu.connectMessaging')
      default:          return title ?? ''
    }
  })()

  const showBack = view !== 'root'

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      {trigger != null && <DrawerTrigger asChild>{trigger}</DrawerTrigger>}

      <DrawerContent onCloseAutoFocus={onCloseAutoFocus}>
        <DrawerHeader className="!flex flex-row items-center gap-2 pr-3">
          {showBack && (
            <button
              type="button"
              onClick={() => setView('root')}
              className="-ml-2.5 size-9 rounded-md inline-grid place-items-center text-secondary hover:bg-fill-hover active:bg-fill-pressed"
              aria-label={t('common.back')}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <DrawerTitle className="flex-1 min-w-0 truncate">{headerTitle}</DrawerTitle>
        </DrawerHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-6">
          {view === 'root' && (
            <RootPane
              sharedUrl={sharedUrl}
              sessionStatuses={sessionStatuses}
              currentSessionStatus={currentSessionStatus}
              labelsCount={actions.appliedLabelIds.size}
              hasLabels={labels.length > 0}
              isFlagged={isFlagged}
              isArchived={isArchived}
              hasMessages={_hasMessages}
              hasUnread={_hasUnread}
              hasTransferTargets={hasTransferTargets}
              onShowInfo={closeAfter(onShowInfo)}
              onShare={closeAfter(actions.share)}
              onOpenShareSub={() => setView('share')}
              onSendToWorkspace={closeAfter(onSendToWorkspace)}
              onOpenMessagingSub={() => setView('messaging')}
              onOpenStatusSub={() => setView('status')}
              onOpenLabelsSub={() => setView('labels')}
              onFlag={closeAfter(onFlag)}
              onUnflag={closeAfter(onUnflag)}
              onArchive={closeAfter(onArchive)}
              onUnarchive={closeAfter(onUnarchive)}
              onMarkUnread={closeAfter(onMarkUnread)}
              onMoveUp={onMoveUp ? closeAfter(onMoveUp) : undefined}
              onMoveDown={onMoveDown ? closeAfter(onMoveDown) : undefined}
              onRename={closeAfter(onRename)}
              onRefreshTitle={closeAfter(actions.refreshTitle)}
              onOpenInNewPanel={closeAfter(actions.openInNewPanel)}
              onOpenInNewWindow={closeAfter(onOpenInNewWindow)}
              onShowInFinder={closeAfter(actions.showInFinder)}
              onCopyPath={closeAfter(actions.copyPath)}
              onDelete={closeAfter(onDelete)}
            />
          )}

          {view === 'status' && (
            <StatusPane
              sessionStatuses={sessionStatuses}
              activeStateId={currentSessionStatus}
              onSelect={(id) => {
                onSessionStatusChange(id)
                setOpen(false)
              }}
            />
          )}

          {view === 'labels' && (
            <LabelsPane
              items={flatLabelItems}
              appliedLabelIds={actions.appliedLabelIds}
              onToggle={actions.toggleLabel}
            />
          )}

          {view === 'share' && sharedUrl && (
            <SharePane
              onOpenInBrowser={closeAfter(actions.openSharedInBrowser)!}
              onCopyLink={closeAfter(actions.copySharedLink)!}
              onUpdateShare={closeAfter(actions.updateShare)!}
              onRevokeShare={closeAfter(actions.revokeShare)!}
            />
          )}

          {view === 'messaging' && (
            <MessagingPane onConnect={handleConnectMessaging} />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

// ---------------------------------------------------------------------------
// Panes
// ---------------------------------------------------------------------------

interface RootPaneProps {
  sharedUrl?: string
  sessionStatuses: SessionStatus[]
  currentSessionStatus: SessionStatusId
  labelsCount: number
  hasLabels: boolean
  isFlagged: boolean
  isArchived: boolean
  hasMessages: boolean
  hasUnread: boolean
  hasTransferTargets?: boolean
  onShowInfo?: () => void
  onShare?: () => void
  onOpenShareSub: () => void
  onSendToWorkspace?: () => void
  onOpenMessagingSub: () => void
  onOpenStatusSub: () => void
  onOpenLabelsSub: () => void
  onFlag?: () => void
  onUnflag?: () => void
  onArchive?: () => void
  onUnarchive?: () => void
  onMarkUnread?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onRename?: () => void
  onRefreshTitle?: () => void
  onOpenInNewPanel?: () => void
  onOpenInNewWindow?: () => void
  onShowInFinder?: () => void
  onCopyPath?: () => void
  onDelete?: () => void
}

function RootPane({
  sharedUrl,
  sessionStatuses,
  currentSessionStatus,
  labelsCount,
  hasLabels,
  isFlagged,
  isArchived,
  hasMessages,
  hasUnread,
  hasTransferTargets,
  onShowInfo,
  onShare,
  onOpenShareSub,
  onSendToWorkspace,
  onOpenMessagingSub,
  onOpenStatusSub,
  onOpenLabelsSub,
  onFlag,
  onUnflag,
  onArchive,
  onUnarchive,
  onMarkUnread,
  onMoveUp,
  onMoveDown,
  onRename,
  onRefreshTitle,
  onOpenInNewPanel,
  onOpenInNewWindow,
  onShowInFinder,
  onCopyPath,
  onDelete,
}: RootPaneProps) {
  const { t } = useTranslation()

  const statusIconNode = (() => {
    const icon = getStateIcon(currentSessionStatus, sessionStatuses)
    return React.isValidElement(icon)
      ? React.cloneElement(icon as React.ReactElement<{ bare?: boolean }>, { bare: true })
      : icon
  })()
  const statusColor = getStateColor(currentSessionStatus, sessionStatuses) ?? undefined

  return (
    <div className="flex flex-col">
      <Row icon={<Info className="h-4 w-4" />} label={t('chat.sessionInfo')} onTap={onShowInfo} />

      {/* Share / Shared */}
      {!sharedUrl ? (
        <Row icon={<CloudUpload className="h-4 w-4" />} label={t('sessionMenu.share')} onTap={onShare} />
      ) : (
        <Row
          icon={<CloudUpload className="h-4 w-4" />}
          label={t('sessionMenu.shared')}
          chevron
          onTap={onOpenShareSub}
        />
      )}

      {hasTransferTargets && onSendToWorkspace && (
        <Row icon={<Send className="h-4 w-4" />} label={t('sessionMenu.sendToWorkspace')} onTap={onSendToWorkspace} />
      )}

      <Row
        icon={<MessageSquare className="h-4 w-4" />}
        label={t('sessionMenu.connectMessaging')}
        chevron
        onTap={onOpenMessagingSub}
      />

      <Separator />

      <Row
        icon={<span style={statusColor ? { color: statusColor } : undefined}>{statusIconNode}</span>}
        label={t('sessionMenu.status')}
        chevron
        onTap={onOpenStatusSub}
      />

      {hasLabels && (
        <Row
          icon={<Tag className="h-4 w-4" />}
          label={t('sessionMenu.labels')}
          trailing={labelsCount > 0 ? <CountBadge count={labelsCount} /> : undefined}
          chevron
          onTap={onOpenLabelsSub}
        />
      )}

      {!isFlagged ? (
        <Row icon={<Flag className="h-4 w-4 text-info" />} label={t('sessionMenu.flag')} onTap={onFlag} />
      ) : (
        <Row icon={<FlagOff className="h-4 w-4" />} label={t('sessionMenu.unflag')} onTap={onUnflag} />
      )}

      {!isArchived ? (
        <Row icon={<Archive className="h-4 w-4" />} label={t('sessionMenu.archive')} onTap={onArchive} />
      ) : (
        <Row icon={<ArchiveRestore className="h-4 w-4" />} label={t('sessionMenu.unarchive')} onTap={onUnarchive} />
      )}

      {!hasUnread && hasMessages && (
        <Row icon={<MailOpen className="h-4 w-4" />} label={t('sessionMenu.markAsUnread')} onTap={onMarkUnread} />
      )}

      <Separator />

      {onMoveUp && <Row icon={<ArrowUp className="size-4" />} label={t('sessionMenu.moveUp')} onTap={onMoveUp} />}
      {onMoveDown && <Row icon={<ArrowDown className="size-4" />} label={t('sessionMenu.moveDown')} onTap={onMoveDown} />}
      <Row icon={<Pencil className="h-4 w-4" />} label={t('common.rename')} onTap={onRename} />
      <Row icon={<RefreshCw className="h-4 w-4" />} label={t('sessionMenu.regenerateTitle')} onTap={onRefreshTitle} />

      <Separator />

      <Row icon={<Columns2 className="h-4 w-4" />} label={t('sessionMenu.openInNewPanel')} onTap={onOpenInNewPanel} />
      {onOpenInNewWindow && (
        <Row icon={<AppWindow className="h-4 w-4" />} label={t('sessionMenu.openInNewWindow')} onTap={onOpenInNewWindow} />
      )}
      <Row
        icon={<FolderOpen className="h-4 w-4" />}
        label={t('sessionMenu.showInFileManager', { fileManager: getFileManagerName() })}
        onTap={onShowInFinder}
      />
      <Row icon={<Copy className="h-4 w-4" />} label={t('sessionMenu.copyPath')} onTap={onCopyPath} />

      <Separator />

      <Row
        icon={<Trash2 className="h-4 w-4" />}
        label={t('common.delete')}
        destructive
        onTap={onDelete}
      />
    </div>
  )
}

function StatusPane({
  sessionStatuses,
  activeStateId,
  onSelect,
}: {
  sessionStatuses: SessionStatus[]
  activeStateId?: SessionStatusId | null
  onSelect: (id: SessionStatusId) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col">
      {sessionStatuses.map((state) => {
        const bareStateIcon = React.isValidElement(state.icon)
          ? React.cloneElement(state.icon as React.ReactElement<{ bare?: boolean }>, { bare: true })
          : state.icon
        return (
          <Row
            key={state.id}
            icon={<span style={getStatusIconStyle(state)}>{bareStateIcon}</span>}
            label={statusDisplayLabel(state, t)}
            radioSelected={activeStateId === state.id}
            onTap={() => onSelect(state.id)}
          />
        )
      })}
    </div>
  )
}

function LabelsPane({
  items,
  appliedLabelIds,
  onToggle,
}: {
  items: LabelMenuItem[]
  appliedLabelIds: Set<string>
  onToggle: (id: string) => void
}) {
  // The Labels row in RootPane is gated on `hasLabels`, so this pane is only
  // ever entered when items.length > 0 — no empty-state branch needed.
  return (
    <div className="flex flex-col">
      {items.map((item) => {
        const isApplied = appliedLabelIds.has(item.id)
        return (
          <Row
            key={item.id}
            icon={<LabelIcon label={item.config} size="lg" />}
            label={item.parentPath ? (
              <>
                <span className="text-tertiary">{item.parentPath}</span>
                {item.label}
              </>
            ) : item.label}
            radioSelected={isApplied}
            onTap={() => onToggle(item.id)}
          />
        )
      })}
    </div>
  )
}

function SharePane({
  onOpenInBrowser,
  onCopyLink,
  onUpdateShare,
  onRevokeShare,
}: {
  onOpenInBrowser: () => void
  onCopyLink: () => void
  onUpdateShare: () => void
  onRevokeShare: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col">
      <Row icon={<Globe className="h-4 w-4" />} label={t('sessionMenu.openInBrowser')} onTap={onOpenInBrowser} />
      <Row icon={<Copy className="h-4 w-4" />} label={t('sessionMenu.copyLink')} onTap={onCopyLink} />
      <Row icon={<RefreshCw className="h-4 w-4" />} label={t('sessionMenu.updateShare')} onTap={onUpdateShare} />
      <Separator />
      <Row icon={<Link2Off className="h-4 w-4" />} label={t('sessionMenu.stopSharing')} destructive onTap={onRevokeShare} />
    </div>
  )
}

function MessagingPane({ onConnect }: { onConnect: (platform: MessagingPlatform) => void }) {
  return (
    <div className="flex flex-col">
      <Row icon={<MessageSquare className="h-4 w-4" />} label="Telegram" onTap={() => onConnect('telegram')} />
      <Row icon={<MessageSquare className="h-4 w-4" />} label="WhatsApp" onTap={() => onConnect('whatsapp')} />
      <Row icon={<MessageSquare className="h-4 w-4" />} label="Lark / Feishu" onTap={() => onConnect('lark')} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

interface RowProps {
  icon: React.ReactNode
  label: React.ReactNode
  trailing?: React.ReactNode
  chevron?: boolean
  radioSelected?: boolean
  destructive?: boolean
  onTap?: () => void
}

function Row({
  icon,
  label,
  trailing,
  chevron,
  radioSelected,
  destructive,
  onTap,
}: RowProps) {
  if (!onTap) return null
  return (
    <button
      type="button"
      onClick={onTap}
      className={cn(
        'flex items-center gap-3 w-full min-h-row-touch px-2 rounded-md text-left -outline-offset-2',
        destructive
          ? 'text-destructive hover:bg-destructive-tint active:bg-destructive-tint'
          : 'hover:bg-fill-hover active:bg-fill-pressed',
      )}
    >
      <span className="shrink-0 inline-flex items-center justify-center h-5 w-5">
        {icon}
      </span>
      <span className="flex-1 min-w-0 text-copy truncate">{label}</span>
      {trailing}
      {radioSelected && <Check className="size-4 shrink-0 text-accent" />}
      {chevron && <ChevronRight className="size-4 shrink-0 text-tertiary" />}
    </button>
  )
}

function Separator() {
  return <div className="my-1 mx-2 h-px bg-separator" />
}

function CountBadge({ count }: { count: number }) {
  return (
    <span className="text-label-sm tabular-nums text-tertiary">
      {count}
    </span>
  )
}
