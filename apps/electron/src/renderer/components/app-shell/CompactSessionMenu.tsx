/**
 * CompactSessionMenu
 *
 * Bottom-sheet replacement for the desktop ChatPage title dropdown
 * (`SessionMenu` wrapped by `PanelHeader`'s Radix DropdownMenu) when
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
import { motion } from 'motion/react'
import {
  Archive,
  ArchiveRestore,
  AppWindow,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  Columns2,
  Copy,
  Flag,
  FlagOff,
  FolderOpen,
  Globe,
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
import { useMessagingConnect, type MessagingPlatform } from '@/components/messaging/MessagingSessionMenuItem'
import { useSessionMenuActions } from '@/hooks/useSessionMenuActions'

type View = 'root' | 'status' | 'labels' | 'share' | 'messaging'

export interface CompactSessionMenuProps {
  /** Title text shown in the trigger button + drawer header. */
  title?: string
  /** Optional badge element rendered next to the title (e.g. agent badge). */
  badge?: React.ReactNode
  /** Shimmer animation while the title is being regenerated. */
  isRegeneratingTitle?: boolean

  // Session data — same as SessionMenu
  item: SessionMeta
  sessionStatuses: SessionStatus[]
  labels?: LabelConfig[]
  hasRemoteWorkspaces?: boolean

  // Callbacks — same as SessionMenu
  onLabelsChange?: (labels: string[]) => void
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
}

export function CompactSessionMenu({
  title,
  badge,
  isRegeneratingTitle,
  item,
  sessionStatuses,
  labels = [],
  hasRemoteWorkspaces,
  onLabelsChange,
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
}: CompactSessionMenuProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [view, setView] = React.useState<View>('root')

  // Reset to root pane every time the drawer closes so the next open
  // doesn't surprise the user with a sub-pane from the previous session.
  React.useEffect(() => {
    if (!open) setView('root')
  }, [open])

  // Close+reset the drawer if the underlying session changes while it's open.
  // Otherwise action handlers retarget to the new session (e.g. user opens
  // menu for A, navigation switches to B, "Delete" deletes B).
  React.useEffect(() => {
    setOpen(false)
    setView('root')
  }, [item.id])

  const isFlagged = item.isFlagged ?? false
  const isArchived = item.isArchived ?? false
  const sharedUrl = item.sharedUrl
  const currentSessionStatus = getSessionStatus(item)
  const sessionLabels = item.labels ?? []
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
    [],
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
      <DrawerTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-md titlebar-no-drag min-w-0',
            'hover:bg-foreground/[0.03] transition-colors',
            'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'data-[state=open]:bg-foreground/[0.03]',
          )}
          aria-label={title}
        >
          <motion.div
            initial={false}
            animate={{ opacity: title ? 1 : 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-1 min-w-0"
          >
            <h1
              className={cn(
                'text-sm font-semibold truncate font-sans leading-tight',
                isRegeneratingTitle && 'animate-shimmer-text',
              )}
            >
              {title}
            </h1>
            {badge}
          </motion.div>
          <span className="shrink-0 flex items-center justify-center">
            <ChevronDown className="h-3.5 w-3.5 text-foreground/50 translate-y-[1px]" />
          </span>
        </button>
      </DrawerTrigger>

      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="!flex flex-row items-center gap-2 !text-left pr-3">
          {showBack && (
            <button
              type="button"
              onClick={() => setView('root')}
              className="-ml-1 h-8 w-8 rounded-md flex items-center justify-center hover:bg-foreground/5 active:bg-foreground/10 transition-colors text-foreground/50"
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
              labelsCount={sessionLabels.length}
              hasLabels={labels.length > 0}
              isFlagged={isFlagged}
              isArchived={isArchived}
              hasMessages={_hasMessages}
              hasUnread={_hasUnread}
              hasRemoteWorkspaces={hasRemoteWorkspaces}
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
  hasRemoteWorkspaces?: boolean
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
  hasRemoteWorkspaces,
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

      {hasRemoteWorkspaces && onSendToWorkspace && (
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
            label={state.label}
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
                <span className="text-foreground/50">{item.parentPath}</span>
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
        'flex items-center gap-3 w-full px-3 py-3 rounded-[10px] text-left transition-colors',
        'hover:bg-foreground/5 active:bg-foreground/10',
        destructive && 'text-destructive hover:bg-destructive/10 active:bg-destructive/15',
      )}
    >
      <span className="shrink-0 inline-flex items-center justify-center h-5 w-5">
        {icon}
      </span>
      <span className="flex-1 min-w-0 text-sm truncate">{label}</span>
      {trailing}
      {radioSelected && <Check className="h-4 w-4 shrink-0 text-foreground/70" />}
      {chevron && <ChevronRight className="h-4 w-4 shrink-0 text-foreground/50" />}
    </button>
  )
}

function Separator() {
  return <div className="my-1 mx-3 h-px bg-foreground/[0.06]" />
}

function CountBadge({ count }: { count: number }) {
  return (
    <span className="text-[11px] tabular-nums text-foreground/50">
      {count}
    </span>
  )
}
