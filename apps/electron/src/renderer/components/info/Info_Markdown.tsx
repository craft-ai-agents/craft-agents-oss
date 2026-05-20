/**
 * Info_Markdown
 *
 * Markdown content with consistent styling and heading detection.
 * Auto-adjusts top padding based on whether content starts with a heading.
 * Supports optional fullscreen view using the shared DocumentFormattedMarkdownOverlay component.
 */

import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Maximize2 } from 'lucide-react'
import { Markdown } from '@/components/markdown'
import { DocumentFormattedMarkdownOverlay } from '@craft-agent/ui'
import { cn } from '@/lib/utils'

export interface Info_MarkdownProps {
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

export function Info_Markdown({
  children,
  maxHeight,
  mode = 'minimal',
  className,
  fullscreen = false,
}: Info_MarkdownProps) {
  const { t } = useTranslation()
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Detect if content starts with H1-H3 heading
  const startsWithHeading = children.trimStart().match(/^#{1,3}\s/)

  return (
    <>
      <div
        className={cn(
          'px-5 pb-4 text-[13px] leading-6 text-white/68',
          '[&_a]:text-[#9d94ff] [&_a]:underline-offset-4',
          '[&_blockquote]:border-l-[#8d7cff] [&_blockquote]:bg-white/[0.035] [&_blockquote]:text-white/62',
          '[&_code]:rounded-[4px] [&_code]:bg-white/[0.07] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-white/76',
          '[&_h1]:text-white/90 [&_h2]:text-white/86 [&_h3]:text-white/82 [&_strong]:text-white/86',
          '[&_li::marker]:text-white/34 [&_p]:text-white/68',
          maxHeight && 'overflow-y-auto',
          startsWithHeading ? 'pt-0' : 'pt-1',
          // Add relative + group for fullscreen button positioning
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
              'border border-white/[0.08] bg-[#111114] shadow-[0_8px_24px_rgba(0,0,0,0.28)]',
              'text-white/42 hover:text-white/76',
              'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:opacity-100'
            )}
            title={t("table.viewFullscreen")}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        )}

        <Markdown mode={mode}>{children}</Markdown>
      </div>

      {/* Fullscreen overlay - reuses shared component from packages/ui */}
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
