/**
 * SourcesListPanel
 *
 * Panel component for displaying workspace sources in the 2nd sidebar.
 * Styled to match SessionList with avatar, title, and subtitle layout.
 */

import * as React from 'react'
import { useState } from 'react'
import { MoreHorizontal, DatabaseZap } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { deriveConnectionStatus } from '@/components/ui/source-status-indicator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from '@/components/ui/empty'
import { getDocUrl } from '@craft-agent/shared/docs/doc-links'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
} from '@/components/ui/styled-dropdown'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
} from '@/components/ui/styled-context-menu'
import { DropdownMenuProvider, ContextMenuProvider } from '@/components/ui/menu-context'
import { SourceMenu } from './SourceMenu'
import { EditPopover, getEditConfig, type EditContextKey } from '@/components/ui/EditPopover'
import { cn } from '@/lib/utils'
import type { LoadedSource, SourceConnectionStatus, SourceFilter } from '../../../shared/types'

export interface SourcesListPanelProps {
  sources: LoadedSource[]
  /** Filter to show only sources of a specific type (api, mcp, local) */
  sourceFilter?: SourceFilter | null
  /** Workspace root path for EditPopover context */
  workspaceRootPath?: string
  onDeleteSource: (sourceSlug: string) => void
  onSourceClick: (source: LoadedSource) => void
  selectedSourceSlug?: string | null
  /** Whether local MCP servers are enabled (affects stdio source status) */
  localMcpEnabled?: boolean
  className?: string
}

/**
 * Get user-friendly label for source type filter (for empty state messages)
 */
function getSourceTypeFilterLabel(sourceType: 'api' | 'mcp' | 'local'): string {
  switch (sourceType) {
    case 'api':
      return 'API'
    case 'mcp':
      return 'MCP'
    case 'local':
      return 'local folder'
    default:
      return sourceType
  }
}

export function SourcesListPanel({
  sources,
  sourceFilter,
  workspaceRootPath,
  onDeleteSource,
  onSourceClick,
  selectedSourceSlug,
  localMcpEnabled = true,
  className,
}: SourcesListPanelProps) {
  // Filter sources based on type filter if active
  const filteredSources = React.useMemo(() => {
    if (!sourceFilter) {
      return sources
    }
    // Filter by source type
    return sources.filter(s => s.config.type === sourceFilter.sourceType)
  }, [sources, sourceFilter])

  // Build empty state message based on filter
  const emptyMessage = React.useMemo(() => {
    if (sourceFilter?.kind === 'type') {
      return `No ${getSourceTypeFilterLabel(sourceFilter.sourceType)} sources configured.`
    }
    return 'No sources configured.'
  }, [sourceFilter])

  // Empty state - rendered outside ScrollArea for proper vertical centering
  if (filteredSources.length === 0) {
    return (
      <Empty className={cn('flex-1', className)}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <DatabaseZap />
          </EmptyMedia>
          <EmptyTitle>{emptyMessage}</EmptyTitle>
          <EmptyDescription>
            Sources connect your agent to external data — MCP servers, REST APIs, and local folders.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <button
            onClick={() => window.electronAPI.openUrl(getDocUrl('sources'))}
            className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-foreground/[0.02] shadow-minimal hover:bg-foreground/[0.05] transition-colors"
          >
            Learn more
          </button>
          {workspaceRootPath && (
            <EditPopover
              align="center"
              trigger={
                <button className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors">
                  Add Source
                </button>
              }
              {...getEditConfig(
                sourceFilter?.kind === 'type' ? `add-source-${sourceFilter.sourceType}` as EditContextKey : 'add-source',
                workspaceRootPath
              )}
            />
          )}
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <ScrollArea className={cn('flex-1', className)}>
      <div className="pb-2">
        <div className="pt-2">
          {filteredSources.map((source, index) => (
            <SourceItem
              key={`${source.config.slug}-${source.config.connectionStatus}-${source.config.isAuthenticated}-${localMcpEnabled}`}
              source={source}
              isSelected={selectedSourceSlug === source.config.slug}
              isFirst={index === 0}
              localMcpEnabled={localMcpEnabled}
              onClick={() => onSourceClick(source)}
              onDelete={() => onDeleteSource(source.config.slug)}
            />
          ))}
        </div>
      </div>
    </ScrollArea>
  )
}

interface SourceItemProps {
  source: LoadedSource
  isSelected: boolean
  isFirst: boolean
  localMcpEnabled: boolean
  onClick: () => void
  onDelete: () => void
}

/**
 * Get display label for source type
 */
function getSourceTypeLabel(type: string): string {
  switch (type) {
    case 'mcp':
      return 'MCP'
    case 'api':
      return 'API'
    case 'local':
      return 'Local'
    default:
      return type
  }
}

/**
 * Get color classes for source type badge
 */
function getSourceTypeBadgeClasses(type: string): string {
  switch (type) {
    case 'mcp':
      return 'bg-accent/10 text-accent'
    case 'api':
      return 'bg-success/10 text-success'
    case 'local':
      return 'bg-info/10 text-info'
    default:
      return 'bg-foreground/10 text-foreground/70'
  }
}

/**
 * Get status badge info for non-connected sources
 * Returns null if source is connected (no badge needed)
 */
function getStatusBadge(status: SourceConnectionStatus): { label: string; classes: string } | null {
  switch (status) {
    case 'connected':
      return null // No badge for connected sources
    case 'needs_auth':
      return { label: 'Auth Required', classes: 'bg-warning/10 text-warning' }
    case 'failed':
      return { label: 'Disconnected', classes: 'bg-destructive/10 text-destructive' }
    case 'untested':
      return { label: 'Not Tested', classes: 'bg-foreground/10 text-foreground/50' }
    case 'local_disabled':
      return { label: 'Disabled', classes: 'bg-foreground/10 text-foreground/50' }
    default:
      return null
  }
}

function SourceItem({ source, isSelected, isFirst, localMcpEnabled, onClick, onDelete }: SourceItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const { config } = source

  // Build subtitle text: provider or tagline
  const subtitle = config.tagline || config.provider || ''

  // Get connection status and badge info (pass localMcpEnabled for stdio sources)
  const connectionStatus = deriveConnectionStatus(source, localMcpEnabled)
  const statusBadge = getStatusBadge(connectionStatus)

  return (
    <div className="source-item" data-selected={isSelected || undefined} data-tutorial={isFirst ? "source-item-first" : undefined}>
      {/* Separator - only show if not first */}
      {!isFirst && (
        <div className="source-separator pl-12 pr-4">
          <Separator />
        </div>
      )}
      {/* Wrapper for button + dropdown + context menu, group for hover state */}
      <ContextMenu modal={true} onOpenChange={setContextMenuOpen}>
        <ContextMenuTrigger asChild>
          <div className="source-content relative group select-none pl-2 mr-2">
        {/* Source Avatar - positioned absolutely, like todo icon */}
        <div className="absolute left-[18px] top-3.5 z-10 flex items-center justify-center">
          <SourceAvatar source={source} size="sm" />
        </div>
        {/* Main content button */}
        <button
          className={cn(
            "flex w-full items-start gap-2 pl-2 pr-4 py-3 text-left text-sm transition-all outline-none rounded-[8px]",
            isSelected
              ? "bg-foreground/5 hover:bg-foreground/7"
              : "hover:bg-foreground/2"
          )}
          onClick={onClick}
        >
          {/* Spacer for avatar */}
          <div className="w-5 h-5 shrink-0" />
          {/* Content column */}
          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
            {/* Title - source name */}
            <div className="flex items-start gap-2 w-full pr-6 min-w-0">
              <div className="font-medium font-sans line-clamp-2 min-w-0 -mb-[2px]">
                {config.name}
              </div>
            </div>
            {/* Subtitle - type badge + status badge + tagline/description */}
            <div className="flex items-center gap-1.5 text-xs text-foreground/70 w-full -mb-[2px] pr-6 min-w-0">
              {/* Type badge */}
              <span className={cn(
                "shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded",
                getSourceTypeBadgeClasses(config.type)
              )}>
                {getSourceTypeLabel(config.type)}
              </span>
              {/* Status badge with tooltip showing connection error details on hover */}
              {statusBadge && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className={cn(
                      "shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded cursor-default",
                      statusBadge.classes
                    )}>
                      {statusBadge.label}
                    </span>
                  </TooltipTrigger>
                  {config.connectionError && (
                    <TooltipContent side="top" className="max-w-xs">
                      <span className="text-xs">{config.connectionError}</span>
                    </TooltipContent>
                  )}
                </Tooltip>
              )}
              {/* Tagline/description */}
              {subtitle && (
                <span className="truncate">
                  {subtitle}
                </span>
              )}
            </div>
          </div>
        </button>
        {/* Action buttons - visible on hover or when menu is open */}
        <div
          className={cn(
            "absolute right-2 top-2 transition-opacity z-10",
            menuOpen || contextMenuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
        >
          {/* More menu */}
          <div className="flex items-center rounded-[8px] overflow-hidden border border-transparent hover:border-border/50">
            <DropdownMenu modal={true} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <div className="p-1.5 hover:bg-foreground/10 data-[state=open]:bg-foreground/10 cursor-pointer">
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                </div>
              </DropdownMenuTrigger>
              <StyledDropdownMenuContent align="end">
                <DropdownMenuProvider>
                  <SourceMenu
                    sourceSlug={config.slug}
                    sourceName={config.name}
                    onOpenInNewWindow={() => {
                      window.electronAPI.openUrl(`bunnyagents://sources/source/${config.slug}?window=focused`)
                    }}
                    onShowInFinder={() => {
                      window.electronAPI.showInFolder(source.folderPath)
                    }}
                    onDelete={onDelete}
                  />
                </DropdownMenuProvider>
              </StyledDropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
          </div>
        </ContextMenuTrigger>
        {/* Context menu - same content as dropdown */}
        <StyledContextMenuContent>
          <ContextMenuProvider>
            <SourceMenu
              sourceSlug={config.slug}
              sourceName={config.name}
              onOpenInNewWindow={() => {
                window.electronAPI.openUrl(`bunnyagents://sources/source/${config.slug}?window=focused`)
              }}
              onShowInFinder={() => {
                window.electronAPI.showInFolder(source.folderPath)
              }}
              onDelete={onDelete}
            />
          </ContextMenuProvider>
        </StyledContextMenuContent>
      </ContextMenu>
    </div>
  )
}
