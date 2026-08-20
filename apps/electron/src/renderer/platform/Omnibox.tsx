/**
 * Omnibox — unified ⌘K palette (S-04 / W3).
 *
 * Two engines under one UI:
 *  - ResourceProviderRegistry → Navigation section
 *  - CommandRegistry → Actions section
 * Context section is minimal ("Open" / "Go to") for v1.
 *
 * Prefix grammar: none | > | @ | / | ! | ? | #  (parsePrefix).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  CommandContribution,
  ResourceItem,
  ResourceProviderRegistry,
  CommandRegistry,
  ContextKeyService,
} from '@craft-agent/core/platform'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { navigate, type Route } from '@/lib/navigate'
import { parsePrefix, scoreMatch, type OmniboxPrefix } from './omnibox-helpers'
import type { ActionId } from '@/actions/definitions'
import { useRegisterModal } from '@/context/ModalContext'
import { snapshotKeybindingContext } from '@/actions/keybinding-context'


const DEBOUNCE_MS = 120
const ACTIONS_LIMIT = 40
const RESOURCES_LIMIT = 30

export interface OmniboxProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  commands: CommandRegistry
  resources: ResourceProviderRegistry
  contextKeys: ContextKeyService
  /** Resolve hotkey display for a craft action id (optional). */
  getHotkeyDisplay?: (actionId: ActionId) => string | null
}

type ContextEntry = {
  item: ResourceItem
  value: string
}

export function Omnibox({
  open,
  onOpenChange,
  commands,
  resources,
  contextKeys,
  getHotkeyDisplay,
}: OmniboxProps) {
  // Cmd+W / X closes palette before other window handlers
  useRegisterModal(open, () => onOpenChange(false))

  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [resourcesList, setResourcesList] = useState<ResourceItem[]>([])
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const parsed = useMemo(() => parsePrefix(input), [input])
  // Palette lists commands for the *underlying* surface, not the palette input.
  // Force inputFocus/menuOpen false so when:!inputFocus surface actions still show.
  const keys = useMemo(() => {
    const kb = snapshotKeybindingContext()
    return {
      ...contextKeys.snapshot(),
      inputFocus: false,
      hasSelection: kb.hasSelection,
      chatFocus: kb.chatFocus,
      navigatorFocus: kb.navigatorFocus,
      sidebarFocus: kb.sidebarFocus,
      menuOpen: false,
      omniboxOpen: open,
    }
  }, [contextKeys, open, input])


  // Reset input when closed
  useEffect(() => {
    if (open) return
    setInput('')
    setResourcesList([])
    setLoading(false)
    abortRef.current?.abort()
    abortRef.current = null
    clearTimeout(debounceRef.current ?? undefined)
    debounceRef.current = null
  }, [open])

  // Federated resource search (debounced)
  useEffect(() => {
    if (!open) return
    // Commands-only prefix: skip resource providers
    if (parsed.prefix === '>') {
      setResourcesList([])
      setLoading(false)
      return
    }

    clearTimeout(debounceRef.current ?? undefined)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)

    debounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          const items = await resources.search({
            query: parsed.query,
            prefix: parsed.prefix as OmniboxPrefix,
            keys,
            signal: controller.signal,
            limit: RESOURCES_LIMIT,
          })
          if (!controller.signal.aborted) {
            setResourcesList(items)
            setLoading(false)
          }
        } catch {
          if (!controller.signal.aborted) {
            setResourcesList([])
            setLoading(false)
          }
        }
      })()
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(debounceRef.current ?? undefined)
      controller.abort()
    }
  }, [open, parsed.prefix, parsed.query, resources, keys])

  // Command query — skip when prefix is resource-only (@ / ! ? #)
  const showActions = parsed.prefix === '' || parsed.prefix === '>'
  const commandHits = useMemo(() => {
    if (!open || !showActions) return [] as CommandContribution[]
    const text = parsed.query
    const list = commands.query({ text: text.trim() || undefined }, keys)
    if (!text.trim()) return list.slice(0, ACTIONS_LIMIT)
    return list
      .map((c) => ({
        c,
        s: Math.max(
          scoreMatch(c.title, text),
          scoreMatch(c.category, text),
          ...(c.keywords ?? []).map((k) => scoreMatch(k, text)),
        ),
      }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, ACTIONS_LIMIT)
      .map((x) => x.c)
  }, [open, showActions, parsed.query, commands, keys])

  const close = useCallback(() => onOpenChange(false), [onOpenChange])

  const runResource = useCallback(
    (item: ResourceItem) => {
      if (item.route) {
        navigate(item.route as Route)
      }
      close()
    },
    [close],
  )

  const runCommand = useCallback(
    async (cmd: CommandContribution) => {
      close()
      try {
        await cmd.execute({ keys: contextKeys.snapshot() })
      } catch (err) {
        console.error('[omnibox] command failed', cmd.id, err)
      }
    },
    [close, contextKeys],
  )

  const placeholder = useMemo(() => {
    switch (parsed.prefix) {
      case '>':
        return t('omnibox.prefix.commands', { defaultValue: 'Search commands…' })
      case '@':
        return t('omnibox.prefix.mentions', {
          defaultValue: 'Search sessions, sources, knowledge…',
        })
      case '/':
        return t('omnibox.prefix.skills', { defaultValue: 'Search skills…' })
      case '!':
        return t('omnibox.prefix.automations', {
          defaultValue: 'Search automations…',
        })
      case '?':
        return t('omnibox.prefix.search', { defaultValue: 'Full-text search…' })
      case '#':
        return t('omnibox.prefix.labels', { defaultValue: 'Search labels…' })
      default:
        return t('omnibox.placeholder', { defaultValue: 'Search or jump to…' })
    }
  }, [parsed.prefix, t])

  // Primary context action for the top resource
  const contextItems: ContextEntry[] = useMemo(() => {
    const top = resourcesList[0]
    if (!top || parsed.prefix === '>') return []
    return [{ item: top, value: `ctx-open:${top.id}` }]
  }, [resourcesList, parsed.prefix])

  const showNavigation = parsed.prefix !== '>'
  const emptyHint =
    !loading && resourcesList.length === 0 && commandHits.length === 0
      ? t('omnibox.empty', { defaultValue: 'No results' })
      : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden p-0 sm:max-w-xl top-[20%] translate-y-0"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">
          {t('omnibox.placeholder', { defaultValue: 'Command Palette' })}
        </DialogTitle>
        <Command
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5"
        >
          <CommandInput
            value={input}
            onValueChange={setInput}
            placeholder={placeholder}
            autoFocus
          />
          <CommandList className="max-h-[min(420px,60vh)]">
            {emptyHint && <CommandEmpty>{emptyHint}</CommandEmpty>}

            {showNavigation && resourcesList.length > 0 && (
              <CommandGroup
                heading={t('omnibox.section.navigation', {
                  defaultValue: 'Navigation',
                })}
              >
                {resourcesList.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`nav:${item.id}`}
                    onSelect={() => runResource(item)}
                  >
                    <span className="truncate flex-1">{item.title}</span>
                    {item.subtitle && (
                      <span className="ml-2 truncate text-xs text-muted-foreground">
                        {item.subtitle}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {contextItems.length > 0 && (
              <CommandGroup
                heading={t('omnibox.section.context', { defaultValue: 'Context' })}
              >
                {contextItems.map((entry) => (
                  <CommandItem
                    key={entry.value}
                    value={entry.value}
                    onSelect={() => runResource(entry.item)}
                  >
                    <span className="truncate flex-1">
                      {t('omnibox.context.open', {
                        defaultValue: 'Open “{{title}}”',
                        title: entry.item.title,
                      })}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {showActions && commandHits.length > 0 && (
              <CommandGroup
                heading={t('omnibox.section.actions', { defaultValue: 'Actions' })}
              >
                {commandHits.map((cmd) => {
                  const hotkey =
                    cmd.defaultHotkey && getHotkeyDisplay
                      ? getHotkeyDisplay(cmd.id as ActionId)
                      : null
                  return (
                    <CommandItem
                      key={cmd.id}
                      value={`cmd:${cmd.id}`}
                      onSelect={() => {
                        void runCommand(cmd)
                      }}
                    >
                      <span className="truncate flex-1">{cmd.title}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {cmd.category}
                      </span>
                      {hotkey && <CommandShortcut>{hotkey}</CommandShortcut>}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
