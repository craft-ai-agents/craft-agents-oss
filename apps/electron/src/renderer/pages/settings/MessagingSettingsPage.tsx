/**
 * MessagingSettingsPage
 *
 * Configure messaging platform connections (Telegram, WhatsApp, Lark) and
 * view active session bindings.
 *
 * Layout:
 *  - One SettingsCard per platform
 *  - Each card renders a PlatformRow: [brand logo] [name] [API · status]
 *    with a Connect button (disconnected) or three-dot menu (connected)
 *  - Telegram-specific: direct (DM) bindings render directly under the bot
 *    row, then a separator, then a collapsible Supergroup section that
 *    expands to show topic-bound bindings. Mirrors the chevron pattern
 *    used by AiSettingsPage's `WorkspaceOverrideCard`.
 *  - WhatsApp / Lark: bindings render as a flat list under their bot row.
 */

import * as React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Hash,
  MessageSquare,
  MoreHorizontal,
  Plus,
  PowerOff,
  RefreshCcw,
  Settings2,
  Trash2,
  Users,
} from 'lucide-react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { SettingsSection, SettingsCard } from '@/components/settings'
import { MessagingPlatformIcon } from '@/components/messaging/MessagingPlatformIcon'
import { TelegramConnectDialog } from '@/components/messaging/TelegramConnectDialog'
import { LarkConnectDialog } from '@/components/messaging/LarkConnectDialog'
import { TelegramSupergroupPairingDialog } from '@/components/messaging/TelegramSupergroupPairingDialog'
import { WhatsAppConnectDialog } from '@/components/messaging/WhatsAppConnectDialog'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import {
  messagingBindingsAtom,
  setMessagingBindingsAtom,
  type MessagingBinding,
} from '@/atoms/messaging'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { getSessionTitle } from '@/utils/session'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { MessagingPlatformRuntimeInfo } from '../../../shared/types'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'messaging',
}

export default function MessagingSettingsPage() {
  const { t } = useTranslation()
  const activeWorkspace = useActiveWorkspace()
  const setBindings = useSetAtom(setMessagingBindingsAtom)
  const workspaceId = activeWorkspace?.id

  // Single fetch + subscription at the page level so both PlatformRows read
  // from the already-populated atom instead of subscribing twice.
  React.useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    const load = async () => {
      try {
        const rows = await window.electronAPI.getMessagingBindings()
        if (!cancelled) setBindings(rows as MessagingBinding[])
      } catch {
        // Silent — a toast here would be noisy on first load.
      }
    }
    load()
    const off = window.electronAPI.onMessagingBindingChanged((wsId) => {
      if (wsId === workspaceId) load()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [workspaceId, setBindings])

  if (!activeWorkspace) return null

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t('settings.messaging.title')} />
      <ScrollArea className="flex-1">
        <div className="space-y-6 p-6">
          <SettingsSection title={t('settings.messaging.title')}>
            <SettingsCard>
              <PlatformRow platform="telegram" workspaceId={activeWorkspace.id} />
            </SettingsCard>
            <SettingsCard>
              <PlatformRow platform="whatsapp" workspaceId={activeWorkspace.id} />
            </SettingsCard>
            <SettingsCard>
              <PlatformRow platform="lark" workspaceId={activeWorkspace.id} />
            </SettingsCard>
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Platform row
// ---------------------------------------------------------------------------

type Platform = 'telegram' | 'whatsapp' | 'lark'

const PLATFORM_LABEL_KEYS: Record<Platform, string> = {
  telegram: 'settings.messaging.telegram.title',
  whatsapp: 'settings.messaging.whatsapp.title',
  lark: 'settings.messaging.lark.title',
}

const PLATFORM_API_DESCRIPTION: Record<Platform, string> = {
  telegram: 'Bot API',
  whatsapp: 'Unofficial Web API',
  lark: 'Open Platform API',
}

// Row column geometry shared across the bot header and all child rows.
// 16px outer padding (`px-4`) + 22px icon slot + 12px gap (`gap-3`).
// Secondary icons render at 16px inside the same 22px slot for a clean
// visual hierarchy without the column edge shifting.
const ROW_ICON_SIZE = 22
const SUB_ROW_ICON_SIZE = 16
const SUB_ROW_ICON_STROKE = 1.5

/** 22px-wide invisible spacer that lets a row inherit the icon column's
 *  geometry without rendering an icon (used for topic rows that align to
 *  the supergroup name above). */
function IconSpacer() {
  return <div className="shrink-0" style={{ width: ROW_ICON_SIZE, height: ROW_ICON_SIZE }} />
}

/** Wraps a Lucide icon at `SUB_ROW_ICON_SIZE` inside the row's 22px slot
 *  so it stays centred in the same column as the bot logo above. */
function SubRowIcon({
  icon: Icon,
  size = SUB_ROW_ICON_SIZE,
  strokeWidth = SUB_ROW_ICON_STROKE,
}: {
  icon: typeof MessageSquare
  size?: number
  strokeWidth?: number
}) {
  return (
    <div
      className="shrink-0 flex items-center justify-center"
      style={{ width: ROW_ICON_SIZE, height: ROW_ICON_SIZE }}
    >
      <Icon
        className="text-foreground/50"
        strokeWidth={strokeWidth}
        style={{ width: size, height: size }}
      />
    </div>
  )
}

function CardSeparator() {
  return <div className="mx-4 h-px bg-border/50" />
}

function PlatformRow({ platform, workspaceId }: { platform: Platform; workspaceId: string }) {
  const { t } = useTranslation()
  const allBindings = useAtomValue(messagingBindingsAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const { navigateToSession } = useNavigation()
  const [runtime, setRuntime] = React.useState<MessagingPlatformRuntimeInfo>(() =>
    defaultRuntime(platform),
  )
  const [connectOpen, setConnectOpen] = React.useState(false)
  const [reconfigure, setReconfigure] = React.useState(false)
  const [menuOpen, setMenuOpen] = React.useState(false)
  // Telegram supergroup state — only relevant when platform === 'telegram'.
  // Lifted into PlatformRow so the supergroup sub-row sits inside the same
  // SettingsCard as the bot connection.
  const [supergroup, setSupergroup] = React.useState<{ chatId: string; title: string } | null>(null)
  const [supergroupDialogOpen, setSupergroupDialogOpen] = React.useState(false)

  const refreshSupergroup = React.useCallback(async () => {
    if (platform !== 'telegram') return
    try {
      const sg = await window.electronAPI.getMessagingSupergroup()
      setSupergroup(sg ? { chatId: sg.chatId, title: sg.title } : null)
    } catch {
      // silent — empty state means "not configured"
    }
  }, [platform])

  React.useEffect(() => {
    refreshSupergroup()
  }, [refreshSupergroup, workspaceId])

  const platformBindings = React.useMemo(
    () =>
      allBindings
        .filter((b) => b.platform === platform)
        .sort((a, b) => b.createdAt - a.createdAt),
    [allBindings, platform],
  )

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI.getMessagingConfig().then((cfg) => {
      if (cancelled) return
      const next = cfg?.runtime?.[platform]
      setRuntime((next ?? defaultRuntime(platform)) as MessagingPlatformRuntimeInfo)
    })
    const off = window.electronAPI.onMessagingPlatformStatus((wsId, p, status) => {
      if (wsId !== workspaceId || p !== platform) return
      setRuntime(status)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [platform, workspaceId])

  // Mirror AI Settings pattern: close menu first, then fire the action on the
  // next frame — avoids a known menu/dialog teardown race.
  const runAfterMenuClose = React.useCallback((action: () => void) => {
    setMenuOpen(false)
    requestAnimationFrame(action)
  }, [])

  const handleConnect = () => {
    setReconfigure(false)
    setConnectOpen(true)
  }

  const handleReconfigure = () => {
    setReconfigure(true)
    setConnectOpen(true)
  }

  const handleDisconnect = async () => {
    try {
      await window.electronAPI.disconnectMessagingPlatform(platform)
      toast.success(
        t(`settings.messaging.${platform}.disconnected`, {
          defaultValue: 'Disconnected',
        }),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }

  const handleForget = async () => {
    try {
      await window.electronAPI.forgetMessagingPlatform(platform)
      toast.success(
        t(`settings.messaging.${platform}.disconnected`, {
          defaultValue: 'Disconnected',
        }),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }

  const handleUnbind = async (binding: MessagingBinding) => {
    try {
      await window.electronAPI.unbindMessagingBinding(binding.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }

  const description = buildDescription(platform, runtime, t)
  const label = t(PLATFORM_LABEL_KEYS[platform])

  return (
    <>
      <div>
        <div className="flex items-center gap-3 px-4 py-3.5">
          <MessagingPlatformIcon platform={platform} size={22} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{label}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {PLATFORM_API_DESCRIPTION[platform]} · {description}
            </div>
          </div>

          {runtime.connected ? (
            <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  className="rounded-md p-1.5 transition-colors hover:bg-foreground/[0.05] data-[state=open]:bg-foreground/[0.05]"
                  data-state={menuOpen ? 'open' : 'closed'}
                  aria-label={t('common.more', { defaultValue: 'More' })}
                >
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <StyledDropdownMenuContent align="end">
                {platform === 'telegram' ? (
                  <>
                    <StyledDropdownMenuItem onClick={() => runAfterMenuClose(handleReconfigure)}>
                      <Settings2 className="h-3.5 w-3.5" />
                      <span>
                        {t('settings.messaging.telegram.reconfigure', {
                          defaultValue: 'Reconfigure',
                        })}
                      </span>
                    </StyledDropdownMenuItem>
                    <StyledDropdownMenuSeparator />
                    <StyledDropdownMenuItem onClick={handleDisconnect} variant="destructive">
                      <PowerOff className="h-3.5 w-3.5" />
                      <span>{t('settings.messaging.telegram.disconnect')}</span>
                    </StyledDropdownMenuItem>
                  </>
                ) : (
                  <>
                    <StyledDropdownMenuItem onClick={() => runAfterMenuClose(handleConnect)}>
                      <RefreshCcw className="h-3.5 w-3.5" />
                      <span>{t('settings.messaging.whatsapp.reconnect')}</span>
                    </StyledDropdownMenuItem>
                    <StyledDropdownMenuItem onClick={handleDisconnect}>
                      <PowerOff className="h-3.5 w-3.5" />
                      <span>{t('settings.messaging.whatsapp.disable')}</span>
                    </StyledDropdownMenuItem>
                    <StyledDropdownMenuSeparator />
                    <StyledDropdownMenuItem onClick={handleForget} variant="destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>{t('settings.messaging.whatsapp.forget')}</span>
                    </StyledDropdownMenuItem>
                  </>
                )}
              </StyledDropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button variant="outline" size="sm" onClick={handleConnect}>
              <Plus className="h-3.5 w-3.5" />
              {t('common.connect', { defaultValue: 'Connect' })}
            </Button>
          )}
        </div>

        {platform === 'telegram' && runtime.connected ? (
          <TelegramBindingsBody
            bindings={platformBindings}
            sessionMetaMap={sessionMetaMap}
            supergroup={supergroup}
            onPairSupergroup={() => setSupergroupDialogOpen(true)}
            onUnpairSupergroup={async () => {
              try {
                await window.electronAPI.unbindMessagingSupergroup()
                toast.success(
                  t('settings.messaging.telegram.supergroup.disconnected', {
                    defaultValue: 'Supergroup disconnected',
                  }),
                )
                refreshSupergroup()
              } catch (err) {
                toast.error(err instanceof Error ? err.message : t('common.error'))
              }
            }}
            onOpenSession={(b) => navigateToSession(b.sessionId)}
            onUnbind={handleUnbind}
          />
        ) : platformBindings.length > 0 ? (
          <>
            <CardSeparator />
            <div className="divide-y divide-border/50">
              {platformBindings.map((binding) => (
                <FlatBindingRow
                  key={binding.id}
                  binding={binding}
                  sessionMetaMap={sessionMetaMap}
                  onOpen={() => navigateToSession(binding.sessionId)}
                  onUnbind={() => handleUnbind(binding)}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>

      {platform === 'telegram' && (
        <>
          <TelegramConnectDialog
            open={connectOpen}
            onOpenChange={setConnectOpen}
            reconfigure={reconfigure}
          />
          <TelegramSupergroupPairingDialog
            open={supergroupDialogOpen}
            onOpenChange={setSupergroupDialogOpen}
            botUsername={runtime.identity}
            onPaired={refreshSupergroup}
          />
        </>
      )}
      {platform === 'whatsapp' && (
        <WhatsAppConnectDialog open={connectOpen} onOpenChange={setConnectOpen} />
      )}
      {platform === 'lark' && (
        <LarkConnectDialog open={connectOpen} onOpenChange={setConnectOpen} reconfigure={reconfigure} />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Telegram bindings body — direct sessions + collapsible supergroup
// ---------------------------------------------------------------------------

interface TelegramBindingsBodyProps {
  bindings: MessagingBinding[]
  sessionMetaMap: Map<string, SessionMeta>
  supergroup: { chatId: string; title: string } | null
  onPairSupergroup: () => void
  onUnpairSupergroup: () => void
  onOpenSession: (binding: MessagingBinding) => void
  onUnbind: (binding: MessagingBinding) => void
}

function TelegramBindingsBody({
  bindings,
  sessionMetaMap,
  supergroup,
  onPairSupergroup,
  onUnpairSupergroup,
  onOpenSession,
  onUnbind,
}: TelegramBindingsBodyProps) {
  // Telegram bindings split cleanly on `threadId`:
  //   - undefined: DM ("direct session") — at most one per workspace
  //   - number:    topic in the paired supergroup
  const directBindings = React.useMemo(() => bindings.filter((b) => b.threadId === undefined), [bindings])
  const topicBindings = React.useMemo(() => bindings.filter((b) => b.threadId !== undefined), [bindings])

  return (
    <>
      {directBindings.length > 0 && (
        <>
          <CardSeparator />
          <div className="divide-y divide-border/50">
            {directBindings.map((binding) => (
              <DirectSessionRow
                key={binding.id}
                binding={binding}
                sessionMetaMap={sessionMetaMap}
                onOpen={() => onOpenSession(binding)}
                onUnbind={() => onUnbind(binding)}
              />
            ))}
          </div>
        </>
      )}

      <CardSeparator />
      {supergroup ? (
        <PairedSupergroupSection
          supergroup={supergroup}
          topicBindings={topicBindings}
          sessionMetaMap={sessionMetaMap}
          onUnpair={onUnpairSupergroup}
          onOpenSession={onOpenSession}
          onUnbindTopic={onUnbind}
        />
      ) : (
        <UnpairedSupergroupRow onPair={onPairSupergroup} />
      )}
    </>
  )
}

function DirectSessionRow({
  binding,
  sessionMetaMap,
  onOpen,
  onUnbind,
}: {
  binding: MessagingBinding
  sessionMetaMap: TelegramBindingsBodyProps['sessionMetaMap']
  onOpen: () => void
  onUnbind: () => void
}) {
  const { t } = useTranslation()
  const meta = sessionMetaMap.get(binding.sessionId)
  const sessionLabel = meta ? getSessionTitle(meta) : binding.channelName || binding.channelId
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <SubRowIcon icon={MessageSquare} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{sessionLabel}</div>
        <div className="mt-0.5 truncate text-xs text-foreground/50">
          {t('settings.messaging.telegram.directSessionSubtitle', {
            defaultValue: 'Direct message session',
          })}
        </div>
      </div>
      <RowActions onOpen={onOpen} onUnbind={onUnbind} />
    </div>
  )
}

function UnpairedSupergroupRow({ onPair }: { onPair: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <SubRowIcon icon={Users} />
      <div className="min-w-0 flex-1">
        <div className="text-sm">
          {t('settings.messaging.telegram.supergroup.label', { defaultValue: 'Supergroup' })}
        </div>
        <div className="mt-0.5 truncate text-xs text-foreground/50">
          {t('settings.messaging.telegram.supergroup.notConfigured', {
            defaultValue: 'Not configured',
          })}
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onPair}>
        <Plus className="h-3.5 w-3.5" />
        {t('settings.messaging.telegram.supergroup.pair', { defaultValue: 'Pair Supergroup' })}
      </Button>
    </div>
  )
}

function PairedSupergroupSection({
  supergroup,
  topicBindings,
  sessionMetaMap,
  onUnpair,
  onOpenSession,
  onUnbindTopic,
}: {
  supergroup: { chatId: string; title: string }
  topicBindings: MessagingBinding[]
  sessionMetaMap: TelegramBindingsBodyProps['sessionMetaMap']
  onUnpair: () => void
  onOpenSession: (binding: MessagingBinding) => void
  onUnbindTopic: (binding: MessagingBinding) => void
}) {
  const { t } = useTranslation()
  // Default open when there are topics — gives users immediate visibility
  // into where automations are routing. Empty paired supergroups stay
  // collapsed since there's nothing interesting to show yet.
  const [isExpanded, setIsExpanded] = React.useState(topicBindings.length > 0)

  const subtitle =
    topicBindings.length === 0
      ? t('settings.messaging.telegram.supergroup.autoTopicNote')
      : t('settings.messaging.telegram.supergroup.topicsBound', {
          count: topicBindings.length,
          defaultValue: '{{count}} topics bound',
        })

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-foreground/[0.02]"
      >
        <SubRowIcon icon={Users} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <div className="truncate text-sm font-medium">{supergroup.title}</div>
            <div className="truncate text-xs text-foreground/50">({supergroup.chatId})</div>
          </div>
          <div className="mt-0.5 truncate text-xs text-foreground/50">{subtitle}</div>
        </div>
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-foreground/50" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-foreground/50" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/50">
              {topicBindings.length === 0 ? (
                <div className="flex items-start gap-3 px-4 py-3 text-xs text-foreground/50">
                  <IconSpacer />
                  <span>
                    {t('settings.messaging.telegram.supergroup.noTopicsHint', {
                      defaultValue:
                        'No topics bound yet — automations with `telegramTopic` will create them.',
                    })}
                  </span>
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {topicBindings.map((binding) => (
                    <TopicBindingRow
                      key={binding.id}
                      binding={binding}
                      sessionMetaMap={sessionMetaMap}
                      onOpen={() => onOpenSession(binding)}
                      onUnbind={() => onUnbindTopic(binding)}
                    />
                  ))}
                </div>
              )}
              <div className="flex items-center gap-3 px-4 py-2">
                <IconSpacer />
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={onUnpair}
                >
                  {t('settings.messaging.telegram.supergroup.disconnect', {
                    defaultValue: 'Disconnect',
                  })}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function TopicBindingRow({
  binding,
  sessionMetaMap,
  onOpen,
  onUnbind,
}: {
  binding: MessagingBinding
  sessionMetaMap: TelegramBindingsBodyProps['sessionMetaMap']
  onOpen: () => void
  onUnbind: () => void
}) {
  const meta = sessionMetaMap.get(binding.sessionId)
  const sessionLabel = meta ? getSessionTitle(meta) : binding.channelName || binding.channelId
  const topicName = binding.channelName || binding.channelId
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <IconSpacer />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{sessionLabel}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-foreground/50">
          <Hash className="h-3 w-3" />
          <span className="truncate">
            {topicName} <span className="text-foreground/30">·</span> Topic #{binding.threadId}
          </span>
        </div>
      </div>
      <RowActions onOpen={onOpen} onUnbind={onUnbind} />
    </div>
  )
}

function FlatBindingRow({
  binding,
  sessionMetaMap,
  onOpen,
  onUnbind,
}: {
  binding: MessagingBinding
  sessionMetaMap: TelegramBindingsBodyProps['sessionMetaMap']
  onOpen: () => void
  onUnbind: () => void
}) {
  // Used by WhatsApp + Lark (no supergroup/topic concept) — same compact
  // row the page used to render for every platform before the Telegram split.
  const meta = sessionMetaMap.get(binding.sessionId)
  const sessionLabel = meta ? getSessionTitle(meta) : binding.channelName || binding.channelId
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5 pl-[52px]">
      <div className="min-w-0 truncate text-sm">{sessionLabel}</div>
      <RowActions onOpen={onOpen} onUnbind={onUnbind} />
    </div>
  )
}

function RowActions({ onOpen, onUnbind }: { onOpen: () => void; onUnbind: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" onClick={onOpen}>
        <ArrowUpRight className="h-3.5 w-3.5" />
        {t('settings.messaging.bindings.openSession')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={onUnbind}
      >
        {t('settings.messaging.bindings.unbind')}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDescription(
  platform: Platform,
  runtime: MessagingPlatformRuntimeInfo,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (runtime.connected) {
    if (platform === 'whatsapp' && runtime.identity) {
      return t('dialog.whatsapp.connectedAs', { name: runtime.identity })
    }
    if (platform === 'telegram' && runtime.identity) {
      return t('settings.messaging.telegram.validBot', { username: runtime.identity })
    }
    return t(`settings.messaging.${platform}.connected`, { defaultValue: 'Connected' })
  }
  if (runtime.state === 'connecting') {
    return t('dialog.whatsapp.starting', { defaultValue: 'Connecting…' })
  }
  if (runtime.state === 'error' && runtime.lastError) {
    return runtime.lastError
  }
  return t(`settings.messaging.${platform}.notConnected`, { defaultValue: 'Not connected' })
}

function defaultRuntime(platform: Platform): MessagingPlatformRuntimeInfo {
  return {
    platform,
    configured: false,
    connected: false,
    state: 'disconnected',
    updatedAt: Date.now(),
  }
}
