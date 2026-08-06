/**
 * AllowListPreview (playground only)
 *
 * Self-contained preview of the new Telegram allow-list / access-control UI.
 * Mounts the same shared components (`AccessModeBanner`, `OwnersListEditor`,
 * `PendingSendersList`, `BindingAllowListPopover`) that Phase 3 will wire
 * into the real `MessagingSettingsPage`. Backed entirely by playground mock
 * state via `__playgroundMessaging` so designers can flip variants without
 * any backend running.
 */

import * as React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { toast } from 'sonner'
import {
  ChevronDown,
  ChevronRight,
  Hash,
  MessageSquare,
  MessagesSquare,
  MoreHorizontal,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SettingsCard, SettingsSection } from '@/components/settings'
import { MessagingPlatformIcon } from '@/components/messaging/MessagingPlatformIcon'
import {
  AccessModeBanner,
  BindingAllowListPopover,
  OwnersListEditor,
  PendingSendersList,
  type BindingAccess,
  type PendingSender,
  type PlatformAccessMode,
  type PlatformOwner,
} from '@/components/messaging/access'
import { playgroundAllowListHandle } from '../../mock-utils'

type AccessModePreset = 'open' | 'owner-only-empty' | 'owner-only-with-owner'
type PendingPreset = 'none' | 'one' | 'three'
type BindingPreset = 'inherit' | 'allow-list' | 'open'

const ROW_ICON_SIZE = 22

const CURRENT_USER_ID = '7654321' // matches PRIMARY_OWNER below

const PRIMARY_OWNER: PlatformOwner = {
  userId: '7654321',
  displayName: 'Gyula',
  username: 'gyula',
  addedAt: Date.now() - 12 * 60 * 60 * 1000,
}

const SAMPLE_PENDING: PendingSender[] = [
  {
    platform: 'telegram',
    userId: '111222333',
    displayName: 'Alex Müller',
    username: 'alex_m',
    lastAttemptAt: Date.now() - 2 * 60 * 1000,
    attemptCount: 3,
  },
  {
    platform: 'telegram',
    userId: '444555666',
    displayName: 'Sara Park',
    username: 'sarap',
    lastAttemptAt: Date.now() - 30 * 60 * 1000,
    attemptCount: 1,
  },
  {
    platform: 'telegram',
    userId: '777888999',
    displayName: 'Random Spammer',
    lastAttemptAt: Date.now() - 4 * 60 * 60 * 1000,
    attemptCount: 14,
  },
]

function buildOwners(preset: AccessModePreset): PlatformOwner[] {
  switch (preset) {
    case 'open':
    case 'owner-only-empty':
      return []
    case 'owner-only-with-owner':
      return [PRIMARY_OWNER]
  }
}

function buildPending(preset: PendingPreset): PendingSender[] {
  switch (preset) {
    case 'none':
      return []
    case 'one':
      return SAMPLE_PENDING.slice(0, 1)
    case 'three':
      return SAMPLE_PENDING
  }
}

function buildBindingAccess(preset: BindingPreset): BindingAccess {
  switch (preset) {
    case 'inherit':
      return { mode: 'inherit', allowedSenderIds: [] }
    case 'allow-list':
      return { mode: 'allow-list', allowedSenderIds: [PRIMARY_OWNER.userId] }
    case 'open':
      return { mode: 'open', allowedSenderIds: [] }
  }
}

function presetToAccessMode(preset: AccessModePreset): PlatformAccessMode {
  return preset === 'open' ? 'open' : 'owner-only'
}

export interface AllowListPreviewProps {
  accessMode: AccessModePreset
  pending: PendingPreset
  dmBindingAccess: BindingPreset
  topicBindingAccess: BindingPreset
}

export function AllowListPreview({
  accessMode,
  pending,
  dmBindingAccess,
  topicBindingAccess,
}: AllowListPreviewProps) {
  const initialOwners = React.useMemo(() => buildOwners(accessMode), [accessMode])
  const initialPending = React.useMemo(() => buildPending(pending), [pending])
  const platformAccessMode = presetToAccessMode(accessMode)

  const [owners, setOwners] = React.useState<PlatformOwner[]>(initialOwners)
  const [pendingList, setPendingList] = React.useState<PendingSender[]>(initialPending)
  const [mode, setMode] = React.useState<PlatformAccessMode>(platformAccessMode)
  const [dmAccess, setDmAccess] = React.useState<BindingAccess>(() =>
    buildBindingAccess(dmBindingAccess),
  )
  const [topicAccess, setTopicAccess] = React.useState<BindingAccess>(() =>
    buildBindingAccess(topicBindingAccess),
  )

  // Keep state in sync with variant prop changes (so users can flip presets
  // from the playground sidebar without remounting the component).
  React.useEffect(() => setOwners(initialOwners), [initialOwners])
  React.useEffect(() => setPendingList(initialPending), [initialPending])
  React.useEffect(() => setMode(platformAccessMode), [platformAccessMode])
  React.useEffect(
    () => setDmAccess(buildBindingAccess(dmBindingAccess)),
    [dmBindingAccess],
  )
  React.useEffect(
    () => setTopicAccess(buildBindingAccess(topicBindingAccess)),
    [topicBindingAccess],
  )

  // Sync mock state for any IPC consumers (Phase 3 wiring will read these).
  React.useEffect(() => {
    playgroundAllowListHandle.setOwners('telegram', owners)
  }, [owners])
  React.useEffect(() => {
    playgroundAllowListHandle.setPending('telegram', pendingList)
  }, [pendingList])
  React.useEffect(() => {
    playgroundAllowListHandle.setAccessMode('telegram', mode)
  }, [mode])

  const handleLockDown = () => {
    setMode('owner-only')
    if (owners.length === 0) {
      // Best-effort seed with the current user (the most common case).
      setOwners([PRIMARY_OWNER])
    }
    toast.success('Bot locked down to allowed users only')
  }

  const handleRemoveOwner = (userId: string) => {
    setOwners((prev) => prev.filter((o) => o.userId !== userId))
    toast.info('Removed from allowed users')
  }

  const handleAllow = (sender: PendingSender) => {
    setOwners((prev) => [
      ...prev,
      {
        userId: sender.userId,
        displayName: sender.displayName,
        username: sender.username,
        addedAt: Date.now(),
      },
    ])
    setPendingList((prev) => prev.filter((s) => s.userId !== sender.userId))
    toast.success(`Allowed ${sender.displayName || sender.username || sender.userId}`)
  }

  const handleIgnore = (sender: PendingSender) => {
    setPendingList((prev) =>
      prev.filter(
        (s) =>
          !(
            s.userId === sender.userId &&
            (s.reason ?? 'not-owner') === (sender.reason ?? 'not-owner') &&
            (s.bindingId ?? null) === (sender.bindingId ?? null)
          ),
      ),
    )
  }

  return (
    <div className="space-y-6 p-6">
      <SettingsSection title="Messaging">
        <SettingsCard>
          <BotHeader />

          {mode === 'open' && <AccessModeBanner onLockDown={handleLockDown} />}

          <CardSeparator />
          <AllowedUsersCollapsible
            owners={owners}
            mode={mode}
            currentUserId={CURRENT_USER_ID}
            onRemove={handleRemoveOwner}
          />

          {pendingList.length > 0 && (
            <>
              <CardSeparator />
              <SectionHeader
                title="Pending requests"
                subtitle={`${pendingList.length} ${pendingList.length === 1 ? 'sender was' : 'senders were'} rejected — review to allow.`}
              />
              <PendingSendersList
                pending={pendingList}
                onAllow={handleAllow}
                onIgnore={handleIgnore}
              />
            </>
          )}

          <CardSeparator />
          <BindingRow
            icon={MessageSquare}
            title="Direct message session"
            subtitle="Gyula DM — Telegram chat"
            access={dmAccess}
            workspaceOwners={owners}
            onChange={setDmAccess}
          />
          <CardSeparator />
          <SupergroupHeader />
          <BindingRow
            icon={Hash}
            indent
            title="GitHub Issue Triage (craft-agents-oss)"
            subtitle="GithubIssues · Topic #16"
            access={topicAccess}
            workspaceOwners={owners}
            onChange={setTopicAccess}
          />
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function CardSeparator() {
  return <div className="mx-4 h-px bg-border/50" />
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="px-4 pt-3 pb-1">
      <div className="text-xs font-medium uppercase tracking-wide text-foreground/50">
        {title}
      </div>
      <div className="mt-0.5 text-xs text-foreground/50">{subtitle}</div>
    </div>
  )
}

function BotHeader() {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <MessagingPlatformIcon platform="telegram" size={ROW_ICON_SIZE} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Telegram</div>
        <div className="mt-0.5 truncate text-xs text-foreground/50">
          Bot API · Valid bot: @CraftAgentsBot
        </div>
      </div>
      <button
        type="button"
        className="rounded-md p-1.5 transition-colors hover:bg-foreground/[0.05]"
        aria-label="More"
      >
        <MoreHorizontal className="h-4 w-4 text-foreground/50" />
      </button>
    </div>
  )
}

function SupergroupHeader() {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div
        className="shrink-0 flex items-center justify-center"
        style={{ width: ROW_ICON_SIZE, height: ROW_ICON_SIZE }}
      >
        <MessagesSquare className="h-4 w-4 text-foreground/50" strokeWidth={1.5} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <div className="truncate text-sm font-medium">Craft Agents</div>
          <div className="truncate text-xs text-foreground/50">(-1003783993623)</div>
        </div>
        <div className="mt-0.5 truncate text-xs text-foreground/50">1 topic bound</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AllowedUsersCollapsible — mirrors TelegramAccessSection's collapsible row
// so the playground demo and production stay visually identical.
// ---------------------------------------------------------------------------

function AllowedUsersCollapsible({
  owners,
  mode,
  currentUserId,
  onRemove,
}: {
  owners: PlatformOwner[]
  mode: PlatformAccessMode
  currentUserId: string
  onRemove: (userId: string) => void
}) {
  const [isExpanded, setIsExpanded] = React.useState(owners.length > 0)

  const subtitle =
    mode === 'open'
      ? 'Not enforced — bot is publicly accessible.'
      : owners.length === 0
        ? 'No one can use this bot yet — pair from Telegram or accept a pending request.'
        : `${owners.length} ${owners.length === 1 ? 'user' : 'users'} allowed`

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-foreground/[0.02]"
      >
        <div
          className="shrink-0 flex items-center justify-center"
          style={{ width: ROW_ICON_SIZE, height: ROW_ICON_SIZE }}
        >
          <Users className="h-4 w-4 text-foreground/50" strokeWidth={1.5} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Allowed users</div>
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
              <OwnersListEditor
                owners={owners}
                enforced={mode === 'owner-only'}
                currentUserId={currentUserId}
                onRemove={onRemove}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function BindingRow({
  icon: Icon,
  indent,
  title,
  subtitle,
  access,
  workspaceOwners,
  onChange,
}: {
  icon: typeof MessageSquare
  indent?: boolean
  title: string
  subtitle: string
  access: BindingAccess
  workspaceOwners: PlatformOwner[]
  onChange: (next: BindingAccess) => void
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div
        className="shrink-0 flex items-center justify-center"
        style={{ width: ROW_ICON_SIZE, height: ROW_ICON_SIZE }}
      >
        {indent ? null : (
          <Icon className="h-4 w-4 text-foreground/50" strokeWidth={1.5} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{title}</div>
        <div className="mt-0.5 truncate text-xs text-foreground/50">{subtitle}</div>
      </div>
      <BindingAllowListPopover
        access={access}
        workspaceOwners={workspaceOwners}
        onChange={onChange}
      />
      <Button variant="ghost" size="sm">
        Open
      </Button>
    </div>
  )
}
