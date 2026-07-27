import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { Archive, ArchiveRestore, Check } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@/components/ui/command'
import {
  useAction,
  useActionRegistry,
  actionsByCategory,
  type ActionId,
} from '@/actions'
import { useStatuses } from '@/hooks/useStatuses'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { ANTHROPIC_MODELS, getModelDisplayName } from '@config/models'
import {
  resolveEffectiveConnectionSlug,
  type LlmConnectionWithStatus,
} from '@config/llm-connections'
import { THINKING_LEVELS, type ThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'
import { cn } from '@/lib/utils'

// Default statuses ship translations under status.<id>; custom ones use their label.
const DEFAULT_STATUS_IDS = new Set(['backlog', 'todo', 'needs-review', 'done', 'cancelled'])

export interface CommandPaletteHostProps {
  /** The session the user is currently viewing (status/archive commands target it). */
  activeSessionId?: string | null
  /** Workspace whose statuses populate the session commands. */
  workspaceId?: string | null
  /** Change the active session's status (status id string). */
  onSetStatus?: (sessionId: string, statusId: string) => void
  /** Archive the active session. */
  onArchive?: (sessionId: string) => void
  /** Unarchive the active session. */
  onUnarchive?: (sessionId: string) => void
  /** Current session reasoning depth (for the checkmark). */
  currentThinkingLevel?: ThinkingLevel
  /** Change the active session's reasoning depth. */
  onThinkingLevelChange?: (level: ThinkingLevel) => void
  /** Change the active session's model. */
  onModelChange?: (model: string, connection?: string) => void
  /** LLM connections (their live model lists drive the Model group). */
  llmConnections?: LlmConnectionWithStatus[]
  /** Workspace default connection slug (for resolving the effective connection). */
  workspaceDefaultConnectionSlug?: string | null
}

/**
 * Global command palette (⌘K / Ctrl+K).
 *
 * Self-contained: owns its open state, registers the `app.commandPalette`
 * action (fired by the registry's global keydown dispatcher on mod+k), and
 * runs actions through the registry. When a session is active it also exposes
 * status + archive commands for that session.
 *
 * Mount once, as a descendant of <ActionRegistryProvider>.
 */
export function CommandPaletteHost({
  activeSessionId,
  workspaceId,
  onSetStatus,
  onArchive,
  onUnarchive,
  currentThinkingLevel,
  onThinkingLevelChange,
  onModelChange,
  llmConnections = [],
  workspaceDefaultConnectionSlug,
}: CommandPaletteHostProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { execute, getHotkeyDisplay } = useActionRegistry()
  const { statuses } = useStatuses(workspaceId ?? null)
  const metaMap = useAtomValue(sessionMetaMapAtom)

  // mod+k toggles the palette (handler invoked by the global hotkey dispatcher)
  useAction('app.commandPalette', () => setOpen((v) => !v))

  const activeMeta = activeSessionId ? metaMap.get(activeSessionId) : undefined
  const currentStatusId = activeMeta?.sessionStatus || 'todo'
  const isArchived = Boolean(activeMeta?.isArchived)
  const currentModel = activeMeta?.model
  const currentConnection = activeMeta?.llmConnection

  // Mirror CompactModelSelector: use the active connection's live model list
  // (this is where newer models like Opus 5 appear), falling back to the
  // static Anthropic registry when a connection exposes no list.
  const effectiveConnectionSlug = resolveEffectiveConnectionSlug(
    currentConnection,
    workspaceDefaultConnectionSlug ?? undefined,
    llmConnections,
  )
  const effectiveConnection = effectiveConnectionSlug
    ? llmConnections.find((c) => c.slug === effectiveConnectionSlug) ?? null
    : null
  const availableModels = effectiveConnection?.models ?? ANTHROPIC_MODELS
  // Entries may be full ModelDefinition objects or bare id strings.
  const modelIdOf = (m: (typeof availableModels)[number]) =>
    typeof m === 'string' ? m : m.id

  const runAction = (id: ActionId) => {
    setOpen(false)
    execute(id)
  }

  const runSetStatus = (statusId: string) => {
    setOpen(false)
    if (activeSessionId && statusId !== currentStatusId) {
      onSetStatus?.(activeSessionId, statusId)
    }
  }

  const runArchiveToggle = () => {
    setOpen(false)
    if (!activeSessionId) return
    if (isArchived) onUnarchive?.(activeSessionId)
    else onArchive?.(activeSessionId)
  }

  const runSetThinkingLevel = (level: ThinkingLevel) => {
    setOpen(false)
    if (activeSessionId && level !== currentThinkingLevel) onThinkingLevelChange?.(level)
  }

  const runSetModel = (modelId: string) => {
    setOpen(false)
    if (activeSessionId && modelId !== currentModel) onModelChange?.(modelId, currentConnection)
  }

  const statusLabel = (id: string, label: string) =>
    DEFAULT_STATUS_IDS.has(id) ? t(`status.${id}`, label) : label

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          'overflow-hidden p-0 border-border/50',
          // glassy: translucent surface + blur so the app shows through
          'bg-background/70 backdrop-blur-2xl shadow-2xl',
          'supports-[backdrop-filter]:bg-background/60',
        )}
      >
        <DialogTitle className="sr-only">
          {t('commandPalette.title', 'Command palette')}
        </DialogTitle>
        <Command
          className={cn(
            'bg-transparent',
            '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground',
            '[&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2',
            '[&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5',
            '[&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3',
            '[&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5',
            // glassy hover/selection on items
            '[&_[cmdk-item][data-selected=true]]:bg-foreground/10 [&_[cmdk-item][data-selected=true]]:backdrop-blur-sm',
          )}
        >
          <CommandInput
            placeholder={t('commandPalette.placeholder', 'Type a command or search...')}
          />
          <CommandList>
            <CommandEmpty>{t('commandPalette.empty', 'No results found.')}</CommandEmpty>

            {activeSessionId && (
              <CommandGroup heading={t('commandPalette.sessionGroup', 'Session')}>
                {statuses.map((s) => {
                  const isCurrent = s.id === currentStatusId
                  return (
                    <CommandItem
                      key={`status-${s.id}`}
                      value={`set status ${s.label} ${s.id}`}
                      onSelect={() => runSetStatus(s.id)}
                    >
                      <span>
                        {t('commandPalette.setStatus', 'Set status:')}{' '}
                        {statusLabel(s.id, s.label)}
                      </span>
                      {isCurrent && <Check className="ml-auto opacity-60" />}
                    </CommandItem>
                  )
                })}
                <CommandItem
                  key="archive-toggle"
                  value={isArchived ? 'unarchive session restore' : 'archive session'}
                  onSelect={runArchiveToggle}
                >
                  {isArchived ? <ArchiveRestore /> : <Archive />}
                  <span>
                    {isArchived
                      ? t('commandPalette.unarchive', 'Unarchive session')
                      : t('commandPalette.archive', 'Archive session')}
                  </span>
                </CommandItem>
              </CommandGroup>
            )}

            {activeSessionId && onModelChange && (
              <CommandGroup heading={t('commandPalette.modelGroup', 'Model')}>
                {availableModels.map((m) => {
                  const modelId = modelIdOf(m)
                  const isCurrent = modelId === currentModel
                  return (
                    <CommandItem
                      key={`model-${modelId}`}
                      value={`model ${getModelDisplayName(modelId)} ${modelId}`}
                      onSelect={() => runSetModel(modelId)}
                    >
                      <span>{getModelDisplayName(modelId)}</span>
                      {isCurrent && <Check className="ml-auto opacity-60" />}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}

            {activeSessionId && onThinkingLevelChange && (
              <CommandGroup heading={t('commandPalette.reasoningGroup', 'Reasoning depth')}>
                {THINKING_LEVELS.map((level) => {
                  const isCurrent = level.id === currentThinkingLevel
                  return (
                    <CommandItem
                      key={`thinking-${level.id}`}
                      value={`reasoning thinking ${level.id} ${t(level.nameKey, level.id)}`}
                      onSelect={() => runSetThinkingLevel(level.id)}
                    >
                      <span>{t(level.nameKey, level.id)}</span>
                      {isCurrent && <Check className="ml-auto opacity-60" />}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}

            {Object.entries(actionsByCategory).map(([category, list]) => (
              <CommandGroup key={category} heading={category}>
                {list
                  .filter((a) => a.id !== 'app.commandPalette')
                  .map((a) => {
                    const shortcut = getHotkeyDisplay(a.id as ActionId)
                    return (
                      <CommandItem
                        key={a.id}
                        value={`${a.label} ${a.description ?? ''}`}
                        onSelect={() => runAction(a.id as ActionId)}
                      >
                        <span>{a.label}</span>
                        {shortcut && <CommandShortcut>{shortcut}</CommandShortcut>}
                      </CommandItem>
                    )
                  })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
