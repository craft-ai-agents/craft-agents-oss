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
  logoUrlCache,
  clearIconCaches,
  loadSourceIcon,
  getSourceIconSync,
  EMOJI_ICON_PREFIX,
} from '@/lib/icon-cache'
import { Mail, Plug, Globe, HardDrive } from 'lucide-react'
import { McpIcon } from '@/components/icons/McpIcon'
import { deriveServiceUrl } from '@craft-agent/shared/utils/service-url'
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
 * Hook to load source icon using centralized cache.
 * Uses loadSourceIcon which handles all icon resolution:
 * emoji → local path → auto-discovery → favicon fallback
 *
 * Returns { iconUrl, emojiIcon } where one will be set based on icon type.
 */
function useSourceIcon(source: LoadedSource | undefined): {
  iconUrl: string | null
  emojiIcon: string | null
} {
  const [iconUrl, setIconUrl] = React.useState<string | null>(() => {
    // Check cache on initial render
    if (source) {
      const cached = getSourceIconSync(source.workspaceId, source.config.slug)
      if (cached && !cached.startsWith(EMOJI_ICON_PREFIX)) {
        return cached
      }
    }
    return null
  })

  const [emojiIcon, setEmojiIcon] = React.useState<string | null>(() => {
    // Check cache for emoji on initial render
    if (source) {
      const cached = getSourceIconSync(source.workspaceId, source.config.slug)
      if (cached?.startsWith(EMOJI_ICON_PREFIX)) {
        return cached.slice(EMOJI_ICON_PREFIX.length)
      }
    }
    return null
  })

  React.useEffect(() => {
    if (!source) {
      setIconUrl(null)
      setEmojiIcon(null)
      return
    }

    // Check cache first (sync)
    const cached = getSourceIconSync(source.workspaceId, source.config.slug)
    if (cached) {
      if (cached.startsWith(EMOJI_ICON_PREFIX)) {
        setEmojiIcon(cached.slice(EMOJI_ICON_PREFIX.length))
        setIconUrl(null)
      } else {
        setIconUrl(cached)
        setEmojiIcon(null)
      }
      return
    }

    // Load via centralized function (async)
    let cancelled = false
    loadSourceIcon({ config: source.config, workspaceId: source.workspaceId })
      .then((result) => {
        if (cancelled) return
        if (result?.startsWith(EMOJI_ICON_PREFIX)) {
          setEmojiIcon(result.slice(EMOJI_ICON_PREFIX.length))
          setIconUrl(null)
        } else {
          setIconUrl(result)
          setEmojiIcon(null)
        }
      })
      .catch(() => {
        if (cancelled) return
        setIconUrl(null)
        setEmojiIcon(null)
      })

    return () => {
      cancelled = true
    }
  }, [source])

  return { iconUrl, emojiIcon }
}

/**
 * Hook to resolve logo URL via IPC (for direct props mode only)
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

  // Extract type, name, status based on props variant
  let type: SourceType
  let name: string
  let connectionStatus: SourceConnectionStatus | undefined
  let connectionError: string | undefined

  // For direct props mode (no source object)
  let serviceUrl: string | null = null
  let provider: string | undefined
  let explicitLogoUrl: string | null | undefined

  // Source object for LoadedSource mode
  let source: LoadedSource | undefined

  if ('source' in props && props.source) {
    // LoadedSource mode - use centralized icon cache
    source = props.source
    type = source.config.type as SourceType
    name = source.config.name

    // Derive status from source
    connectionStatus = deriveConnectionStatus(source)
    connectionError = source.config.connectionError
  } else {
    // Direct props mode - use legacy favicon resolution
    const directProps = props as DirectSourceAvatarProps
    type = directProps.type
    name = directProps.name
    explicitLogoUrl = directProps.logoUrl
    serviceUrl = directProps.serviceUrl ?? null
    provider = directProps.provider
    connectionStatus = directProps.status
    connectionError = directProps.statusError
  }

  // LoadedSource mode: Use centralized cache (handles emoji, local files, favicon)
  const { iconUrl: sourceIconUrl, emojiIcon: sourceEmojiIcon } = useSourceIcon(source)

  // Direct props mode: Resolve logo URL via IPC (only if no source object)
  const resolvedLogoUrl = useLogoUrl(
    !source && !explicitLogoUrl ? serviceUrl : null,
    provider
  )

  // Determine final icon URL and emoji
  // LoadedSource mode uses centralized cache, direct props mode uses explicit/resolved URL
  const finalLogoUrl = source ? sourceIconUrl : (explicitLogoUrl ?? resolvedLogoUrl)
  const emojiIcon = source ? sourceEmojiIcon : null

  const FallbackIcon = FALLBACK_ICONS[type] ?? Plug
  const statusSize = STATUS_SIZE_CONFIG[size]

  // Only apply size classes if className doesn't contain custom size classes
  const hasCustomSize = className?.match(/\b(h-|w-|size-)/)
  const containerSize = hasCustomSize ? undefined : SIZE_CONFIG[size]
  const defaultClasses = hasCustomSize ? undefined : 'rounded-[4px] ring-1 ring-border/30 shrink-0'

  // If we have an emoji icon, render as text
  if (emojiIcon) {
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
