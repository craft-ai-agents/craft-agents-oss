/**
 * SkillGallery_Card
 *
 * Grid card component for the skills gallery browse view.
 * Displays a skill name, source repo, install count, and install button.
 * Clicking the card navigates to the skill detail page.
 */

import * as React from 'react'
import { Download, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SkillGallery_CardProps {
  /** Skill display name */
  name: string
  /** Source repository (e.g., "vercel-labs/agent-skills") */
  source: string
  /** Number of installs */
  installs: number
  /** Whether the skill is already installed locally */
  isInstalled: boolean
  /** Whether the skill is currently being installed */
  isInstalling: boolean
  /** Click handler for the card (navigates to detail) */
  onClick: () => void
  /** Install handler (called when install button is clicked) */
  onInstall: () => void
  className?: string
}

/**
 * Format large install counts with K suffix.
 * e.g. 54214 → "54.2K", 900 → "900"
 */
function formatInstalls(n: number): string {
  if (n >= 1000) {
    const k = n / 1000
    return k >= 10 ? `${Math.round(k)}K` : `${k.toFixed(1).replace(/\.0$/, '')}K`
  }
  return n.toString()
}

export function SkillGallery_Card({
  name,
  source,
  installs,
  isInstalled,
  isInstalling,
  onClick,
  onInstall,
  className,
}: SkillGallery_CardProps) {
  return (
    <div
      className={cn(
        'flex flex-col px-3 pt-2 pb-1.5 rounded-[8px] bg-background shadow-minimal',
        'hover:shadow-minimal-hover transition-shadow cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      {/* Top: Name and source */}
      <div className="min-w-0">
        <div className="font-medium text-sm leading-tight line-clamp-2">
          {name}
        </div>
        <div className="text-xs text-foreground/50 mt-0.5 truncate">
          {source}
        </div>
      </div>

      {/* Bottom: Install count + action — pushed to bottom via mt-auto */}
      <div className="flex items-center justify-between mt-auto pt-2.5">
        <span className="text-xs text-foreground/40 tabular-nums flex items-center gap-1">
          <Download className="h-3 w-3" />
          {formatInstalls(installs)}
        </span>

        {isInstalled ? (
          <span className="flex items-center gap-1 text-xs text-foreground/30 font-medium">
            <Check className="h-3.5 w-3.5" />
            Installed
          </span>
        ) : (
          <button
            onClick={(e) => {
              // Prevent card click navigation when clicking install
              e.stopPropagation()
              onInstall()
            }}
            disabled={isInstalling}
            className="h-7 px-3 text-xs font-medium rounded-[6px] bg-foreground/[0.03] shadow-minimal hover:bg-foreground/[0.07] transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {isInstalling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Download className="h-3.5 w-3.5" />
                Install
              </>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
