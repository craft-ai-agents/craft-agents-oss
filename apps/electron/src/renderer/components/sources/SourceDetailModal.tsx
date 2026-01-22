/**
 * SourceDetailModal - Full detail view for a gallery source.
 *
 * Features:
 * - Large icon with brand color header
 * - Full description
 * - Feature checklist
 * - Auth requirements
 * - Install button with states
 */

import { useState } from 'react'
import { Check, Download, ExternalLink, Key, Loader2, Shield, Sparkles, Zap } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { GallerySource } from './gallery-data'

interface SourceDetailModalProps {
  source: GallerySource | null
  isOpen: boolean
  onClose: () => void
  isInstalled?: boolean
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
 * Get human-readable auth type label.
 */
function getAuthLabel(authType: GallerySource['authType']) {
  switch (authType) {
    case 'oauth':
      return 'OAuth sign-in'
    case 'bearer':
      return 'API token'
    case 'api_key':
      return 'API key'
    case 'none':
      return 'No authentication'
    default:
      return 'Authentication required'
  }
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

export function SourceDetailModal({
  source,
  isOpen,
  onClose,
  isInstalled = false,
  onInstall,
}: SourceDetailModalProps) {
  const [isInstalling, setIsInstalling] = useState(false)
  const [imageError, setImageError] = useState(false)

  if (!source) return null

  const rgb = hexToRgb(source.brandColor)
  const isEmoji = source.icon.length <= 4 && !source.icon.startsWith('http')

  const handleInstall = async () => {
    setIsInstalling(true)
    // Simulate install delay for demo
    await new Promise((resolve) => setTimeout(resolve, 1000))
    onInstall?.()
    setIsInstalling(false)
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl p-0 overflow-hidden">
        {/* Header with brand color gradient */}
        <div
          className="relative px-6 pt-8 pb-6"
          style={
            rgb
              ? {
                  background: `linear-gradient(180deg,
                    rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12) 0%,
                    transparent 100%)`,
                }
              : undefined
          }
        >
          {/* Badges */}
          {(source.isNew || source.isFeatured) && (
            <div className="absolute top-4 left-6 flex gap-2">
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

          <div className="flex items-start gap-5">
            {/* Large Icon */}
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center shadow-lg flex-shrink-0"
              style={
                rgb
                  ? {
                      background: `linear-gradient(135deg,
                        rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.2) 0%,
                        rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.1) 100%)`,
                    }
                  : { background: 'var(--foreground-10)' }
              }
            >
              {isEmoji ? (
                <span className="text-4xl">{source.icon}</span>
              ) : imageError ? (
                <span className="text-3xl font-bold text-foreground/40">
                  {source.name.charAt(0)}
                </span>
              ) : (
                <img
                  src={source.icon}
                  alt={source.name}
                  className="w-12 h-12 object-contain"
                  onError={() => setImageError(true)}
                />
              )}
            </div>

            {/* Title Info */}
            <div className="flex-1 min-w-0 pt-1">
              <DialogHeader className="text-left gap-1">
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-xl">{source.name}</DialogTitle>
                  <span
                    className={cn(
                      'px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide',
                      getTypeBadgeStyle(source.type)
                    )}
                  >
                    {source.type}
                  </span>
                </div>
                <DialogDescription className="text-foreground/60">
                  {source.provider}
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm text-foreground/80 mt-2">{source.tagline}</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 pb-6 space-y-5">
          {/* Description */}
          <div>
            <p className="text-sm text-foreground/70 leading-relaxed">{source.description}</p>
          </div>

          {/* Features */}
          {source.features.length > 0 && (
            <div className="bg-foreground/[0.03] rounded-xl p-4 space-y-2.5">
              <h3 className="text-xs font-semibold text-foreground/50 uppercase tracking-wide mb-3">
                Features
              </h3>
              <ul className="space-y-2">
                {source.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <Check className="w-4 h-4 text-success flex-shrink-0 mt-0.5" />
                    <span className="text-foreground/80">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Auth Requirements */}
          <div className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-2 text-foreground/60">
              {source.authType === 'none' ? (
                <Shield className="w-4 h-4" />
              ) : (
                <Key className="w-4 h-4" />
              )}
              <span>Requires: {getAuthLabel(source.authType)}</span>
            </div>
          </div>

          {/* Install Button */}
          <div className="pt-2">
            {isInstalled ? (
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-success">
                  <Check className="w-4 h-4" />
                  Already installed
                </span>
                <button
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
                    'bg-foreground/[0.06] text-foreground/70',
                    'hover:bg-foreground/10 transition-colors'
                  )}
                  onClick={onClose}
                >
                  Configure
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                className={cn(
                  'w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl',
                  'text-sm font-semibold',
                  'bg-accent text-white',
                  'hover:bg-accent/90 active:scale-[0.98]',
                  'transition-all duration-150',
                  'disabled:opacity-60 disabled:cursor-not-allowed'
                )}
                onClick={handleInstall}
                disabled={isInstalling}
              >
                {isInstalling ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Installing...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Install Source
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
