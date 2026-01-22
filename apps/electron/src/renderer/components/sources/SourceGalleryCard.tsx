/**
 * SourceGalleryCard - Modern app store style card for source gallery.
 *
 * Features:
 * - Large icon with brand color tinting
 * - Hover animations with scale and shadow
 * - Install button revealed on hover
 * - New/Featured badges
 * - Type badge (MCP/API/Local)
 */

import { useState } from 'react'
import { Download, Sparkles, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GallerySource } from './gallery-data'

interface SourceGalleryCardProps {
  source: GallerySource
  isInstalled?: boolean
  onClick?: () => void
  onInstall?: () => void
}

/**
 * Convert hex color to RGB values.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null
}

/**
 * Get type badge styling based on source type.
 */
function getTypeBadgeStyle(type: GallerySource['type']) {
  switch (type) {
    case 'mcp':
      return 'bg-accent/15 text-accent'
    case 'api':
      return 'bg-success/15 text-success'
    case 'local':
      return 'bg-info/15 text-info-text'
    default:
      return 'bg-foreground/10 text-foreground/70'
  }
}

export function SourceGalleryCard({
  source,
  isInstalled = false,
  onClick,
  onInstall,
}: SourceGalleryCardProps) {
  const [imageError, setImageError] = useState(false)
  const rgb = hexToRgb(source.brandColor)

  // Determine if icon is emoji (single character or emoji)
  const isEmoji = source.icon.length <= 4 && !source.icon.startsWith('http')

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-2xl p-5 cursor-pointer',
        'transition-all duration-200 ease-out',
        'border border-border/50',
        'hover:scale-[1.02] hover:shadow-lg hover:border-accent/30',
        'bg-gradient-to-br from-background to-foreground/[0.02]'
      )}
      style={
        rgb
          ? {
              // Subtle brand color tint in the background gradient
              background: `linear-gradient(135deg,
                rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.03) 0%,
                var(--background) 50%,
                rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.02) 100%)`,
            }
          : undefined
      }
      onClick={onClick}
    >
      {/* Badges - New / Featured */}
      {(source.isNew || source.isFeatured) && (
        <div className="absolute top-3 right-3 flex gap-1.5">
          {source.isFeatured && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-accent/15 text-accent">
              <Sparkles className="w-3 h-3" />
              Featured
            </span>
          )}
          {source.isNew && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-success/15 text-success">
              <Zap className="w-3 h-3" />
              New
            </span>
          )}
        </div>
      )}

      {/* Icon */}
      <div
        className={cn(
          'w-16 h-16 rounded-xl flex items-center justify-center mb-4',
          'shadow-md transition-shadow duration-200',
          'group-hover:shadow-lg'
        )}
        style={
          rgb
            ? {
                background: `linear-gradient(135deg,
                  rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15) 0%,
                  rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08) 100%)`,
              }
            : { background: 'var(--foreground-5)' }
        }
      >
        {isEmoji ? (
          <span className="text-3xl">{source.icon}</span>
        ) : imageError ? (
          <span className="text-2xl font-bold text-foreground/40">
            {source.name.charAt(0)}
          </span>
        ) : (
          <img
            src={source.icon}
            alt={source.name}
            className="w-10 h-10 object-contain"
            onError={() => setImageError(true)}
          />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Name + Type */}
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-semibold text-foreground truncate">{source.name}</h3>
          <span
            className={cn(
              'px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide',
              getTypeBadgeStyle(source.type)
            )}
          >
            {source.type}
          </span>
        </div>

        {/* Provider */}
        <p className="text-xs text-foreground/50 mb-2">{source.provider}</p>

        {/* Tagline */}
        <p className="text-sm text-foreground/70 line-clamp-2">{source.tagline}</p>
      </div>

      {/* Install Button - appears on hover */}
      <div
        className={cn(
          'absolute bottom-4 right-4',
          'opacity-0 translate-y-1',
          'group-hover:opacity-100 group-hover:translate-y-0',
          'transition-all duration-200'
        )}
      >
        {isInstalled ? (
          <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-foreground/10 text-foreground/60">
            Installed
          </span>
        ) : (
          <button
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg',
              'text-xs font-medium',
              'bg-accent text-white',
              'hover:bg-accent/90 active:scale-95',
              'transition-all duration-150'
            )}
            onClick={(e) => {
              e.stopPropagation()
              onInstall?.()
            }}
          >
            <Download className="w-3.5 h-3.5" />
            Install
          </button>
        )}
      </div>
    </div>
  )
}
