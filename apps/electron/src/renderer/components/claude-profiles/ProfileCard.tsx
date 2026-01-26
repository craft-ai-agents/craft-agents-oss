/**
 * ProfileCard Component
 *
 * Displays an individual Claude profile with usage stats, badges, and actions.
 */

import * as React from 'react'
import { useState } from 'react'
import { MoreHorizontal, Trash2, Star, Check, AlertCircle } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { DropdownMenuProvider } from '@/components/ui/menu-context'
import { cn } from '@/lib/utils'
import type { ClaudeProfile } from '../../../shared/types'

interface ProfileCardProps {
  profile: ClaudeProfile
  isActive: boolean
  onSetActive: () => void
  onSetDefault: () => void
  onDelete: () => void
  onRename: (newName: string) => void
}

/** Format utilization as percentage */
function formatUtilization(value: number): string {
  return `${Math.round(value * 100)}%`
}

/** Get color class based on utilization level */
function getUtilizationColor(value: number): string {
  if (value >= 0.95) return 'text-destructive'
  if (value >= 0.75) return 'text-amber-500'
  return 'text-emerald-500'
}

/** Usage bar component */
function UsageBar({ value, label }: { value: number; label: string }) {
  const percentage = Math.min(value * 100, 100)
  const colorClass = getUtilizationColor(value)

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('font-medium', colorClass)}>{formatUtilization(value)}</span>
      </div>
      <div className="h-1.5 bg-foreground/10 rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300',
            value >= 0.95 ? 'bg-destructive' : value >= 0.75 ? 'bg-amber-500' : 'bg-emerald-500'
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}

export function ProfileCard({
  profile,
  isActive,
  onSetActive,
  onSetDefault,
  onDelete,
  onRename,
}: ProfileCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(profile.name)

  const handleRename = () => {
    if (editName.trim() && editName !== profile.name) {
      onRename(editName.trim())
    }
    setIsEditing(false)
  }

  const isLimited = profile.usage?.isSessionLimited || profile.usage?.isWeeklyLimited

  return (
    <div
      className={cn(
        'relative group rounded-lg border p-4 transition-colors',
        isActive ? 'border-accent bg-accent/5' : 'border-border hover:border-border/80'
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename()
                if (e.key === 'Escape') {
                  setEditName(profile.name)
                  setIsEditing(false)
                }
              }}
              className="w-full px-2 py-1 text-sm font-medium bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent"
              autoFocus
            />
          ) : (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="text-sm font-medium text-foreground hover:text-foreground/80 truncate block text-left"
            >
              {profile.name}
            </button>
          )}
          <p className="text-xs text-muted-foreground truncate mt-0.5">{profile.email}</p>
        </div>

        {/* Badges */}
        <div className="flex items-center gap-1.5">
          {profile.isDefault && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-600">
              <Star className="w-3 h-3 mr-0.5" />
              Default
            </span>
          )}
          {isActive && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent/10 text-accent">
              <Check className="w-3 h-3 mr-0.5" />
              Active
            </span>
          )}
          {isLimited && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-destructive/10 text-destructive">
              <AlertCircle className="w-3 h-3 mr-0.5" />
              Limited
            </span>
          )}
        </div>

        {/* Menu */}
        <div
          className={cn(
            'transition-opacity',
            menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
        >
          <DropdownMenu modal={true} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="p-1.5 rounded hover:bg-foreground/10 text-muted-foreground hover:text-foreground"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent align="end">
              <DropdownMenuProvider>
                {!isActive && (
                  <StyledDropdownMenuItem onClick={onSetActive}>
                    <Check className="w-3.5 h-3.5" />
                    <span>Set as Active</span>
                  </StyledDropdownMenuItem>
                )}
                {!profile.isDefault && (
                  <StyledDropdownMenuItem onClick={onSetDefault}>
                    <Star className="w-3.5 h-3.5" />
                    <span>Set as Default</span>
                  </StyledDropdownMenuItem>
                )}
                <StyledDropdownMenuSeparator />
                <StyledDropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Profile</span>
                </StyledDropdownMenuItem>
              </DropdownMenuProvider>
            </StyledDropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Usage Stats */}
      {profile.usage && (
        <div className="space-y-2">
          <UsageBar
            value={profile.usage.fiveHourUtilization}
            label="5-hour usage"
          />
          <UsageBar
            value={profile.usage.sevenDayUtilization}
            label="7-day usage"
          />
        </div>
      )}

      {/* No usage data */}
      {!profile.usage && (
        <div className="text-xs text-muted-foreground italic">
          Usage data not available
        </div>
      )}

      {/* Last monitored */}
      {profile.lastMonitoredAt && (
        <div className="text-[10px] text-muted-foreground mt-2">
          Updated {formatTimeAgo(profile.lastMonitoredAt)}
        </div>
      )}
    </div>
  )
}

/** Format timestamp as relative time */
function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
