/**
 * SourceAvatar - Unified avatar component for sources
 *
 * Provides consistent styling for all source icons.
 * Uses CrossfadeAvatar internally for smooth image loading with fallback support.
 *
 * Supports three icon types:
 * - File-based icons (icon.svg, icon.png) - loaded via IPC
 * - Emoji icons (from config.icon) - rendered as text
 * - URL icons - resolved via favicon service or downloaded
 * - Default fallback (type-specific icon)
 *
 * Two usage patterns:
 * 1. Direct props: <SourceAvatar type="mcp" name="Linear" logoUrl="..." />
 * 2. Source object: <SourceAvatar source={loadedSource} />
 *
 * Size variants:
 * - xs: 14x14 (compact)
 * - sm: 16x16 (dropdowns, inline, sidebar)
 * - md: 20x20 (auth steps)
 * - lg: 24x24 (info panels)
 *
 * Status indicator:
 * - Set showStatus={true} to show a colored dot indicating connection status
 * - Green: Connected, Yellow: Needs auth, Red: Failed, Gray: Untested
 */

import * as React from 'react'
import { CrossfadeAvatar } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import {
  sourceIconCache,
  logoUrlCache,
  clearIconCaches,
  svgToThemedDataUrl,
} from '@/lib/icon-cache'
import { Mail, Plug, Globe, HardDrive } from 'lucide-react'
import { McpIcon } from '@/components/icons/McpIcon'
import { deriveServiceUrl } from '@craft-agent/shared/utils/service-url'
import { isEmoji } from '@craft-agent/shared/utils/icon-constants'
import type { LoadedSource } from '@craft-agent/shared/sources/types'
import type { SourceConnectionStatus } from '../../../shared/types'
import { SourceStatusIndicator, deriveConnectionStatus } from './source-status-indicator'

export type SourceType = 'mcp' | 'api' | 'gmail' | 'local'
export type SourceAvatarSize = 'xs' | 'sm' | 'md' | 'lg'

/** Props for direct usage with explicit type/name/logo */
interface DirectSourceAvatarProps {
  /** Source type for automatic fallback icon */
  type: SourceType
  /** Service name for alt text */
  name: string
  /** Logo URL (Google Favicon URL) - if not provided, derives from serviceUrl */
  logoUrl?: string | null
  /** Service URL to derive logo from (used if logoUrl not provided) */
  serviceUrl?: string
  /** Provider name for canonical domain mapping */
  provider?: string
  /** Size variant */
  size?: SourceAvatarSize
  /** Show connection status indicator */
  showStatus?: boolean
  /** Connection status (for direct props mode) */
  status?: SourceConnectionStatus
  /** Error message for failed status */
  statusError?: string
  /** Additional className overrides */
  className?: string
  /** Not used in direct mode */
  source?: never
}

/** Props for usage with LoadedSource object */
interface LoadedSourceAvatarProps {
  /** LoadedSource object to extract type/name/logo from */
  source: LoadedSource
  /** Size variant */
  size?: SourceAvatarSize
  /** Show connection status indicator (auto-derived from source) */
  showStatus?: boolean
  /** Additional className overrides */
  className?: string
  /** Not used in source mode */
  type?: never
  name?: never
  logoUrl?: never
  serviceUrl?: never
  provider?: never
  status?: never
  statusError?: never
}

type SourceAvatarProps = DirectSourceAvatarProps | LoadedSourceAvatarProps

// Size configurations (container only - icons fill parent with padding)
const SIZE_CONFIG: Record<SourceAvatarSize, string> = {
  xs: 'h-3.5 w-3.5',
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
}

// Font size mapping for emoji rendering at different avatar sizes
const EMOJI_SIZE_CONFIG: Record<SourceAvatarSize, string> = {
  xs: 'text-[10px]',
  sm: 'text-[11px]',
  md: 'text-[13px]',
  lg: 'text-[16px]',
}

// Fallback icons by source type
const FALLBACK_ICONS: Record<SourceType, React.ComponentType<{ className?: string }>> = {
  mcp: McpIcon,
  api: Globe,
  gmail: Mail,
  local: HardDrive,
}

/**
 * Get the fallback icon for a source type
 */
export function getSourceFallbackIcon(type: SourceType): React.ComponentType<{ className?: string }> {
  return FALLBACK_ICONS[type] ?? Plug
}

// Status indicator size based on avatar size
const STATUS_SIZE_CONFIG: Record<SourceAvatarSize, 'xs' | 'sm' | 'md'> = {
  xs: 'xs',
  sm: 'xs',
  md: 'sm',
  lg: 'sm',
}

/**
 * Clear the source icon cache (useful when sources are updated)
 */
export function clearSourceIconCache(): void {
  clearIconCaches()
}

/**
 * Hook to load a workspace image via IPC
 * Returns the loaded image URL (data URL for binary, raw content for SVG)
 * Uses shared sourceIconCache from lib/icon-cache
 */
function useWorkspaceImage(
  workspaceId: string | undefined,
  relativePath: string | undefined
): string | null {
  const [imageUrl, setImageUrl] = React.useState<string | null>(() => {
    // Check cache on initial render
    if (workspaceId && relativePath) {
      const cacheKey = `${workspaceId}:${relativePath}`
      return sourceIconCache.get(cacheKey) ?? null
    }
    return null
  })

  React.useEffect(() => {
    if (!workspaceId || !relativePath) {
      setImageUrl(null)
      return
    }

    const cacheKey = `${workspaceId}:${relativePath}`

    // Check cache first
    const cached = sourceIconCache.get(cacheKey)
    if (cached) {
      setImageUrl(cached)
      return
    }

    // Load via IPC
    let cancelled = false
    window.electronAPI.readWorkspaceImage(workspaceId, relativePath)
      .then((result) => {
        if (cancelled) return

        // For SVG, theme and convert to data URL
        // This injects foreground color since currentColor doesn't work in background-image
        let url = result
        if (relativePath.endsWith('.svg')) {
          url = svgToThemedDataUrl(result)
        }

        sourceIconCache.set(cacheKey, url)
        setImageUrl(url)
      })
      .catch((error) => {
        if (cancelled) return
        console.error(`[SourceAvatar] Failed to load image ${relativePath}:`, error)
        setImageUrl(null)
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId, relativePath])

  return imageUrl
}

/**
 * Hook to resolve logo URL via IPC (uses Node.js filesystem cache)
 * Returns the resolved logo URL or null
 */
function useLogoUrl(
  serviceUrl: string | undefined | null,
  provider: string | undefined
): string | null {
  const [logoUrl, setLogoUrl] = React.useState<string | null>(() => {
    // Check cache on initial render
    if (serviceUrl) {
      const cacheKey = `${serviceUrl}:${provider ?? ''}`
      const cached = logoUrlCache.get(cacheKey)
      if (cached !== undefined) {
        return cached
      }
    }
    return null
  })

  React.useEffect(() => {
    if (!serviceUrl) {
      setLogoUrl(null)
      return
    }

    const cacheKey = `${serviceUrl}:${provider ?? ''}`

    // Check cache first
    const cached = logoUrlCache.get(cacheKey)
    if (cached !== undefined) {
      setLogoUrl(cached)
      return
    }

    // Resolve via IPC (uses Node.js filesystem cache for provider domains)
    let cancelled = false
    window.electronAPI.getLogoUrl(serviceUrl, provider)
      .then((result) => {
        if (cancelled) return
        logoUrlCache.set(cacheKey, result)
        setLogoUrl(result)
      })
      .catch((error) => {
        if (cancelled) return
        console.error(`[SourceAvatar] Failed to resolve logo URL:`, error)
        logoUrlCache.set(cacheKey, null)
        setLogoUrl(null)
      })

    return () => {
      cancelled = true
    }
  }, [serviceUrl, provider])

  return logoUrl
}

export function SourceAvatar(props: SourceAvatarProps) {
  const { size = 'md', className, showStatus } = props

  // Extract type, name, logo URL, and status based on props variant
  let type: SourceType
  let name: string
  let connectionStatus: SourceConnectionStatus | undefined
  let connectionError: string | undefined

  // For local icons, we need workspaceId and relative path
  let workspaceId: string | undefined
  let localIconPath: string | undefined

  // For emoji icons from config.icon
  let emojiIcon: string | undefined

  // For remote icons, we need serviceUrl and provider
  let serviceUrl: string | null = null
  let provider: string | undefined
  let explicitLogoUrl: string | null | undefined

  if ('source' in props && props.source) {
    // LoadedSource mode
    const source = props.source
    type = source.config.type as SourceType
    name = source.config.name
    workspaceId = source.workspaceId
    // Use slug for favicon resolution - it's more specific than generic provider names
    // e.g., "gmail" slug maps to mail.google.com, while "google" provider has no mapping
    provider = source.config.slug ?? source.config.provider

    // Check icon field for emoji or URL
    const icon = source.config.icon
    if (icon && isEmoji(icon)) {
      // Emoji icon - render as text
      emojiIcon = icon
    } else {
      // Try to find local icon file (icon.svg, icon.png, etc.)
      // The watcher downloads URL icons to local files automatically
      // We check for common extensions - the actual file is found via IPC
      localIconPath = `sources/${source.config.slug}/icon`
    }

    // If no icon field set, derive service URL for favicon resolution
    if (!icon && !emojiIcon) {
      serviceUrl = deriveServiceUrl(source.config)
    }

    // Derive status from source
    connectionStatus = deriveConnectionStatus(source)
    connectionError = source.config.connectionError
  } else {
    // Direct props mode
    const directProps = props as DirectSourceAvatarProps
    type = directProps.type
    name = directProps.name
    explicitLogoUrl = directProps.logoUrl
    serviceUrl = directProps.serviceUrl ?? null
    provider = directProps.provider
    connectionStatus = directProps.status
    connectionError = directProps.statusError
  }

  // Load local icon via IPC if needed (tries icon.svg, icon.png, etc.)
  const loadedLocalIcon = useWorkspaceImage(workspaceId, localIconPath ? localIconPath + '.svg' : undefined)
  const loadedLocalIconPng = useWorkspaceImage(workspaceId, localIconPath && !loadedLocalIcon ? localIconPath + '.png' : undefined)
  const finalLocalIcon = loadedLocalIcon ?? loadedLocalIconPng

  // Resolve logo URL via IPC (only if no local icon, no emoji, and no explicit URL)
  const resolvedLogoUrl = useLogoUrl(
    !finalLocalIcon && !emojiIcon && !explicitLogoUrl ? serviceUrl : null,
    provider
  )

  // Final resolved URL: local icon > explicit URL > resolved URL > null
  const finalLogoUrl = finalLocalIcon ?? explicitLogoUrl ?? resolvedLogoUrl

  const FallbackIcon = FALLBACK_ICONS[type] ?? Plug
  const statusSize = STATUS_SIZE_CONFIG[size]

  // Only apply size classes if className doesn't contain custom size classes
  const hasCustomSize = className?.match(/\b(h-|w-|size-)/)
  const containerSize = hasCustomSize ? undefined : SIZE_CONFIG[size]
  const defaultClasses = hasCustomSize ? undefined : 'rounded-[4px] ring-1 ring-border/30 shrink-0'

  // Priority: local file > emoji > URL > fallback
  // If we have an emoji icon and no local file, render emoji
  if (emojiIcon && !finalLocalIcon) {
    return (
      <span className="relative inline-flex shrink-0">
        <div
          className={cn(
            containerSize,
            defaultClasses,
            'flex items-center justify-center bg-muted',
            EMOJI_SIZE_CONFIG[size],
            'leading-none',
            className
          )}
          title={name}
        >
          {emojiIcon}
        </div>
        {showStatus && connectionStatus && (
          <span className="absolute -bottom-0.5 -right-0.5">
            <SourceStatusIndicator
              status={connectionStatus}
              errorMessage={connectionError}
              size={statusSize}
            />
          </span>
        )}
      </span>
    )
  }

  return (
    <span className="relative inline-flex shrink-0">
      <CrossfadeAvatar
        src={finalLogoUrl}
        alt={name}
        className={cn(
          containerSize,
          defaultClasses,
          className
        )}
        fallbackClassName="bg-muted rounded-[4px]"
        fallback={<FallbackIcon className="w-full h-full text-muted-foreground" />}
      />
      {showStatus && connectionStatus && (
        <span className="absolute -bottom-0.5 -right-0.5">
          <SourceStatusIndicator
            status={connectionStatus}
            errorMessage={connectionError}
            size={statusSize}
          />
        </span>
      )}
    </span>
  )
}
