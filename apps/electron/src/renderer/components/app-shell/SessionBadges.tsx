import { useMemo } from "react"
import { Flag, CloudUpload } from "lucide-react"
import { cn } from "@/lib/utils"
import { parseLabelEntry } from "@craft-agent/shared/labels"
import { Spinner } from "@craft-agent/ui"
import { EntityListBadge } from "@/components/ui/entity-list-badge"
import { EntityListLabelBadge } from "@/components/ui/entity-list-label-badge"
import { ShareMenuItems } from "./SessionMenuParts"
import { DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent, StyledDropdownMenuItem, StyledDropdownMenuSeparator } from "@/components/ui/styled-dropdown"
import { ConnectionIcon } from "@/components/icons/ConnectionIcon"
import { useOptionalAppShellContext } from "@/context/AppShellContext"
import * as storage from "@/lib/local-storage"
import { useSessionListContext } from "@/context/SessionListContext"
import type { SessionMeta } from "@/atoms/sessions"
import { PERMISSION_MODE_CONFIG } from "@craft-agent/shared/agent/modes"
import { hasUnreadMeta } from "@/utils/session"
import type { LabelConfig } from "@craft-agent/shared/labels"

interface SessionBadgesProps {
  item: SessionMeta
}

export function SessionBadges({ item }: SessionBadgesProps) {
  const ctx = useSessionListContext()
  const permissionMode = ctx.sessionOptions?.get(item.id)?.permissionMode

  const resolvedLabels = useMemo(() => {
    if (!item.labels || item.labels.length === 0 || ctx.flatLabels.length === 0) return []
    return item.labels
      .map(entry => {
        const parsed = parseLabelEntry(entry)
        const config = ctx.flatLabels.find(l => l.id === parsed.id)
        if (!config) return null
        return { config, rawValue: parsed.rawValue }
      })
      .filter((l): l is { config: LabelConfig; rawValue: string | undefined } => l != null)
  }, [item.labels, ctx.flatLabels])

  const appShellContext = useOptionalAppShellContext()
  const showConnectionIcons = storage.get(storage.KEYS.showConnectionIcons, true)
  const connectionDetails = useMemo(() => {
    if (!showConnectionIcons) return null
    const llmConnection = item.llmConnection
    if (!llmConnection || !appShellContext?.llmConnections) return null
    if (appShellContext.llmConnections.length <= 1) return null
    return appShellContext.llmConnections.find(c => c.slug === llmConnection) ?? null
  }, [showConnectionIcons, item.llmConnection, appShellContext?.llmConnections])

  return (
    <>
      {item.isProcessing && (
        <Spinner className="text-[8px] text-foreground shrink-0" />
      )}
      {!item.isProcessing && hasUnreadMeta(item) && (
        <EntityListBadge colorClass="bg-accent text-white">New</EntityListBadge>
      )}
      {item.isFlagged && (
        <EntityListBadge variant="icon" colorClass="bg-foreground/5">
          <Flag className="h-[10px] w-[10px] text-info fill-info" />
        </EntityListBadge>
      )}
      {item.lastMessageRole === 'plan' && (
        <EntityListBadge colorClass="bg-success/10 text-success">Plan</EntityListBadge>
      )}
      {connectionDetails && (
        <EntityListBadge variant="icon">
          <ConnectionIcon connection={connectionDetails} size={14} showTooltip />
        </EntityListBadge>
      )}
      {permissionMode && (
        <EntityListBadge colorClass={cn(
          permissionMode === 'safe' && "bg-foreground/5 text-foreground/60",
          permissionMode === 'ask' && "bg-info/10 text-info",
          permissionMode === 'allow-all' && "bg-accent/10 text-accent"
        )}>
          {PERMISSION_MODE_CONFIG[permissionMode].shortName}
        </EntityListBadge>
      )}
      {resolvedLabels.map(({ config, rawValue }, idx) => (
        <EntityListLabelBadge
          key={`${config.id}-${idx}`}
          label={config}
          rawValue={rawValue}
          sessionLabels={item.labels || []}
          onLabelsChange={(updated) => ctx.onLabelsChange?.(item.id, updated)}
        />
      ))}
      {item.sharedUrl && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}>
              <EntityListBadge variant="icon" colorClass="bg-foreground/5 text-foreground/70" className="cursor-pointer">
                <CloudUpload className="h-[10px] w-[10px]" />
              </EntityListBadge>
            </div>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="start" side="bottom" sideOffset={4}>
            <ShareMenuItems sessionId={item.id} sharedUrl={item.sharedUrl} menu={{ MenuItem: StyledDropdownMenuItem, Separator: StyledDropdownMenuSeparator }} />
          </StyledDropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  )
}
