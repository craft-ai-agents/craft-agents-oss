/**
 * SkillGallery_Markdown
 *
 * Markdown content renderer for gallery skill instructions.
 * Supports fullscreen view via DocumentFormattedMarkdownOverlay.
 * Duplicated from Info_Markdown to allow the gallery to evolve independently.
 */

import * as React from 'react'
import { useState } from 'react'
import { Maximize2 } from 'lucide-react'
import { Markdown } from '@/components/markdown'
import { DocumentFormattedMarkdownOverlay } from '@craft-agent/ui'
import { cn } from '@/lib/utils'

export interface SkillGallery_MarkdownProps {
  /** Markdown content */
  children: string
  /** Optional max height with scroll */
  maxHeight?: number
  /** Markdown rendering mode */
  mode?: 'minimal' | 'full'
  className?: string
  /** Enable fullscreen button (shows Maximize2 icon on hover) */
  fullscreen?: boolean
}

export function SkillGallery_Markdown({
  children,
  maxHeight,
  mode = 'minimal',
  className,
  fullscreen = false,
}: SkillGallery_MarkdownProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Detect if content starts with H1-H3 heading
  const startsWithHeading = children.trimStart().match(/^#{1,3}\s/)

  return (
    <>
      <div
        className={cn(
          'px-6 pb-3 text-sm',
          maxHeight && 'overflow-y-auto',
          startsWithHeading ? 'pt-0' : 'pt-1',
          fullscreen && 'relative group',
          className
        )}
        style={maxHeight ? { maxHeight } : undefined}
      >
        {/* Fullscreen button - visible on hover, positioned top-right */}
        {fullscreen && (
          <button
            onClick={() => setIsFullscreen(true)}
            className={cn(
              'absolute top-2 right-2 p-1 rounded-[6px] transition-all z-10',
              'opacity-0 group-hover:opacity-100',
              'bg-background shadow-minimal',
              'text-muted-foreground/50 hover:text-foreground',
              'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:opacity-100'
            )}
            title="View Fullscreen"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        )}

        <Markdown mode={mode}>{children}</Markdown>
      </div>

      {/* Fullscreen overlay */}
      {fullscreen && (
        <DocumentFormattedMarkdownOverlay
          content={children}
          isOpen={isFullscreen}
          onClose={() => setIsFullscreen(false)}
        />
      )}
    </>
  )
}
