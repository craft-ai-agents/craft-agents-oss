import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { useAppShellContext, useSession } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { SessionFilesSection } from '../right-sidebar/SessionFilesSection'
import type { SessionLaunchReceipt } from '@craft-agent/shared/sessions'

interface SessionInfoPopoverProps {
  sessionId: string
  sessionFolderPath?: string
  trigger: React.ReactElement
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  contentClassName?: string
  presentation?: 'popover' | 'drawer'
}

const DEFAULT_POPOVER_CONTENT_CLASS = 'w-[360px] h-[460px] min-w-[200px] max-w-[420px] overflow-hidden rounded-[8px] bg-background text-foreground shadow-modal-small p-0'
const DEFAULT_DRAWER_CONTENT_CLASS = [
  'data-[vaul-drawer-direction=bottom]:inset-x-2',
  'data-[vaul-drawer-direction=bottom]:bottom-2',
  'data-[vaul-drawer-direction=bottom]:mt-0',
  'data-[vaul-drawer-direction=bottom]:max-h-[min(82vh,42rem)]',
  'overflow-hidden rounded-[14px] border border-border/60 bg-background shadow-modal-small',
].join(' ')

export function SessionInfoPopover({
  sessionId,
  sessionFolderPath,
  trigger,
  side = 'top',
  align = 'end',
  sideOffset = 6,
  contentClassName,
  presentation = 'popover',
}: SessionInfoPopoverProps) {
  const [open, setOpen] = React.useState(false)

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)

    if (!nextOpen) {
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('craft:focus-input', {
          detail: { sessionId },
        }))
      })
    }
  }, [sessionId])

  if (presentation === 'drawer') {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange} direction="bottom">
        <DrawerTrigger asChild>
          {trigger}
        </DrawerTrigger>
        <DrawerContent
          className={cn(DEFAULT_DRAWER_CONTENT_CLASS, contentClassName)}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
          }}
        >
          <DrawerHeader className="border-b border-border/50 px-4 py-3 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
            <DrawerTitle className="text-sm font-medium">Session info</DrawerTitle>
          </DrawerHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            <SessionInfoPopoverContent sessionId={sessionId} sessionFolderPath={sessionFolderPath} />
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        className={contentClassName ?? DEFAULT_POPOVER_CONTENT_CLASS}
        side={side}
        align={align}
        sideOffset={sideOffset}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
        }}
      >
        <SessionInfoPopoverContent sessionId={sessionId} sessionFolderPath={sessionFolderPath} />
      </PopoverContent>
    </Popover>
  )
}

function SessionInfoPopoverContent({ sessionId, sessionFolderPath }: { sessionId: string; sessionFolderPath?: string }) {
  const { t } = useTranslation()
  const session = useSession(sessionId)
  const { onRenameSession } = useAppShellContext()
  const [name, setName] = React.useState('')
  const renameTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    setName(session?.name || '')
  }, [session?.name])

  React.useEffect(() => {
    return () => {
      if (renameTimeoutRef.current) {
        clearTimeout(renameTimeoutRef.current)
      }
    }
  }, [])

  const handleNameChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setName(newName)

    if (renameTimeoutRef.current) {
      clearTimeout(renameTimeoutRef.current)
    }

    renameTimeoutRef.current = setTimeout(() => {
      const trimmed = newName.trim()
      if (trimmed) {
        onRenameSession(sessionId, trimmed)
      }
    }, 500)
  }, [onRenameSession, sessionId])

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="shrink-0 p-3 border-b border-border/50">
        <label className="text-xs font-medium text-muted-foreground block mb-1.5 select-none">
          {t("chat.title")}
        </label>
        <div className="rounded-lg bg-foreground-2 has-[:focus]:bg-background shadow-minimal transition-colors">
          <Input
            value={name}
            onChange={handleNameChange}
            placeholder={t("chat.titlePlaceholder")}
            className="h-9 py-2 text-sm border-0 shadow-none bg-transparent focus-visible:ring-0"
          />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full min-h-0 flex flex-col">
          {session?.launchReceipt && (
            <LaunchReceiptSection receipt={session.launchReceipt} />
          )}
          <div className="flex-1 min-h-0">
            <SessionFilesSection
              sessionId={sessionId}
              sessionFolderPath={sessionFolderPath}
              hideHeader={false}
              className="h-full min-h-0"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function LaunchReceiptSection({ receipt }: { receipt: SessionLaunchReceipt }) {
  const injected = receipt.injected
  const contextDocs = injected.contextDocs ?? []
  const skills = injected.skills ?? []
  const sources = injected.sources ?? []
  const agentCatalog = injected.agentCatalog ?? []
  const configItems = [
    ['Model', receipt.config.model],
    ['Connection', receipt.config.llmConnection],
    ['Mode', receipt.config.permissionMode],
    ['Thinking', receipt.config.thinkingLevel],
    ['Working dir', receipt.config.workingDirectory],
    ['Prompt chars', injected.systemPromptChars !== undefined ? injected.systemPromptChars.toLocaleString() : undefined],
  ] satisfies Array<[string, string | undefined]>

  return (
    <div className="shrink-0 max-h-[230px] overflow-y-auto border-b border-border/50 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground select-none">Launch receipt</div>
        <div className="shrink-0 text-[10px] leading-4 text-muted-foreground/70">
          {formatReceiptTime(receipt.createdAt)}
        </div>
      </div>
      <div className="space-y-1.5 text-[11px] leading-4 text-muted-foreground">
        {receipt.summary && <div className="rounded-md bg-foreground-2 px-2 py-1 text-foreground/80">{receipt.summary}</div>}

        <ReceiptGroup title="Origin" summary={formatOrigin(receipt)} defaultOpen>
          <ReceiptRow label="Type" value={receipt.origin} />
          {receipt.agent && (
            <>
              <ReceiptRow label="Agent" value={receipt.agent.name} />
              <ReceiptRow label="Agent slug" value={`@${receipt.agent.slug}`} mono />
              {receipt.agent.description && <ReceiptRow label="Description" value={receipt.agent.description} />}
              {receipt.agent.inputs && <ReceiptRow label="Inputs" value={receipt.agent.inputs} />}
              {receipt.agent.outputs && <ReceiptRow label="Outputs" value={receipt.agent.outputs} />}
              {receipt.agent.tags?.length ? <ReceiptRow label="Tags" value={receipt.agent.tags.join(', ')} /> : null}
            </>
          )}
          {receipt.workflow && (
            <>
              <ReceiptRow label="Workflow" value={receipt.workflow.slug} mono />
              {receipt.workflow.stepId && <ReceiptRow label="Step" value={receipt.workflow.stepId} mono />}
            </>
          )}
          {receipt.automation && (
            <>
              {receipt.automation.name && <ReceiptRow label="Automation" value={receipt.automation.name} />}
              {receipt.automation.event && <ReceiptRow label="Event" value={receipt.automation.event} mono />}
            </>
          )}
        </ReceiptGroup>

        <ReceiptGroup title="Config" summary={formatCount(configItems.filter(([, value]) => Boolean(value)).length, 'item')}>
          {configItems.map(([label, value]) => (
            value ? <ReceiptRow key={label} label={label} value={value} mono={label !== 'Mode' && label !== 'Thinking'} /> : null
          ))}
        </ReceiptGroup>

        <ReceiptGroup title="Context docs" summary={formatCount(contextDocs.length, 'doc')}>
          <ReceiptEntityList
            items={contextDocs.map((doc) => ({
              key: doc.slug,
              name: doc.name,
              slug: doc.slug,
            }))}
            emptyLabel="No context docs"
          />
        </ReceiptGroup>

        <ReceiptGroup title="Skills" summary={formatCount(skills.length, 'skill')}>
          <ReceiptSlugList values={skills} emptyLabel="No skills" />
        </ReceiptGroup>

        <ReceiptGroup title="Tools / sources" summary={formatCount(sources.length, 'source')}>
          <ReceiptSlugList values={sources} emptyLabel="No tools or sources" />
        </ReceiptGroup>

        {(receipt.routing || agentCatalog.length > 0) && (
          <ReceiptGroup
            title="Concierge routing"
            summary={receipt.routing ? `${receipt.routing.activeAgentCount} active agents` : formatCount(agentCatalog.length, 'agent')}
          >
            {receipt.routing && (
              <>
                <ReceiptRow label="Mode" value={receipt.routing.mode} mono />
                <ReceiptRow label="Instruction" value={receipt.routing.instruction} />
              </>
            )}
            <ReceiptEntityList
              items={agentCatalog.map((agent) => ({
                key: agent.slug,
                name: agent.name,
                slug: `@${agent.slug}`,
                details: [
                  agent.description,
                  agent.inputs ? `Inputs: ${agent.inputs}` : undefined,
                  agent.outputs ? `Outputs: ${agent.outputs}` : undefined,
                  agent.tags?.length ? `Tags: ${agent.tags.join(', ')}` : undefined,
                ].filter((value): value is string => Boolean(value)),
              }))}
              emptyLabel="No routing catalog"
            />
          </ReceiptGroup>
        )}
      </div>
    </div>
  )
}

function ReceiptGroup({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string
  summary: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <details className="rounded-md bg-foreground-2 px-2 py-1" open={defaultOpen}>
      <summary className="flex cursor-default list-none items-center justify-between gap-2 select-none [&::-webkit-details-marker]:hidden">
        <span className="font-medium text-foreground/80">{title}</span>
        <span className="min-w-0 truncate text-[10px] text-muted-foreground/80">{summary}</span>
      </summary>
      <div className="mt-1 space-y-1 border-t border-border/40 pt-1">
        {children}
      </div>
    </details>
  )
}

function ReceiptRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-foreground/70">{label}</span>
      <span className={cn('min-w-0 break-words text-foreground/80', mono && 'font-mono text-[10px]')}>{value}</span>
    </div>
  )
}

function ReceiptSlugList({ values, emptyLabel }: { values: string[]; emptyLabel: string }) {
  if (values.length === 0) {
    return <div className="text-muted-foreground/70">{emptyLabel}</div>
  }

  return (
    <div className="flex flex-wrap gap-1">
      {values.map((value) => (
        <span key={value} className="max-w-full rounded border border-border/50 bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground/80 break-all">
          {value}
        </span>
      ))}
    </div>
  )
}

function ReceiptEntityList({
  items,
  emptyLabel,
}: {
  items: Array<{ key: string; name: string; slug: string; details?: string[] }>
  emptyLabel: string
}) {
  if (items.length === 0) {
    return <div className="text-muted-foreground/70">{emptyLabel}</div>
  }

  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div key={item.key} className="min-w-0 rounded border border-border/50 bg-background px-1.5 py-1">
          <div className="min-w-0 text-foreground/85 break-words">{item.name}</div>
          <div className="font-mono text-[10px] text-muted-foreground break-all">{item.slug}</div>
          {item.details?.map((detail) => (
            <div key={detail} className="mt-0.5 text-[10px] leading-3 text-muted-foreground/80 break-words">{detail}</div>
          ))}
        </div>
      ))}
    </div>
  )
}

function formatCount(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

function formatOrigin(receipt: SessionLaunchReceipt): string {
  if (receipt.origin === 'workflow' && receipt.workflow) {
    return `Workflow ${receipt.workflow.slug}${receipt.workflow.stepId ? ` · ${receipt.workflow.stepId}` : ''}`
  }
  if (receipt.origin === 'automation') return `Automation${receipt.automation?.name ? ` · ${receipt.automation.name}` : ''}`
  if (receipt.agent) return `${receipt.origin} · @${receipt.agent.slug}`
  return receipt.origin
}

function formatReceiptTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return ''
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
