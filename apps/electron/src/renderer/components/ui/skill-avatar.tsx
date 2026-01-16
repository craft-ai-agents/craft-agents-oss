/**
 * SkillAvatar - Avatar component for skills
 *
 * Displays skill icons with fallback support.
 * Uses CrossfadeAvatar internally for smooth image loading.
 *
 * Supports three icon types:
 * - File-based icons (icon.svg, icon.png) - loaded via IPC
 * - Emoji icons (from metadata.icon) - rendered as text
 * - Default fallback (Zap icon)
 *
 * Size variants:
 * - xs: 14x14 (compact)
 * - sm: 16x16 (sidebar)
 * - md: 20x20 (default)
 * - lg: fills container (info panels)
 */

import * as React from 'react'
import { CrossfadeAvatar } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { skillIconCache, clearSkillIconCaches, svgToThemedDataUrl } from '@/lib/icon-cache'
import { Zap } from 'lucide-react'
import { isEmoji } from '@craft-agent/shared/utils/icon-constants'
import type { LoadedSkill } from '../../../shared/types'

export type SkillAvatarSize = 'xs' | 'sm' | 'md' | 'lg'

interface SkillAvatarProps {
  /** LoadedSkill object */
  skill: LoadedSkill
  /** Size variant */
  size?: SkillAvatarSize
  /** Additional className overrides */
  className?: string
  /** Workspace ID for loading local icons */
  workspaceId?: string
}

// Size configurations
// lg uses h-full w-full to fill parent container (e.g., Info_Page.Hero)
const SIZE_CONFIG: Record<SkillAvatarSize, string> = {
  xs: 'h-3.5 w-3.5',
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-full w-full',
}

/**
 * Clear the skill icon cache
 */
export function clearSkillIconCache(): void {
  clearSkillIconCaches()
}

/**
 * Hook to load a skill icon via IPC
 */
function useSkillIcon(
  workspaceId: string | undefined,
  iconPath: string | undefined
): string | null {
  const [imageUrl, setImageUrl] = React.useState<string | null>(() => {
    if (workspaceId && iconPath) {
      const cacheKey = `${workspaceId}:${iconPath}`
      return skillIconCache.get(cacheKey) ?? null
    }
    return null
  })

  React.useEffect(() => {
    if (!workspaceId || !iconPath) {
      setImageUrl(null)
      return
    }

    const cacheKey = `${workspaceId}:${iconPath}`

    // Check cache first
    const cached = skillIconCache.get(cacheKey)
    if (cached) {
      setImageUrl(cached)
      return
    }

    // Extract relative path from absolute icon path
    // iconPath is absolute, we need to get the skills/slug/icon.ext part
    const skillsMatch = iconPath.match(/skills\/([^/]+)\/(.+)$/)
    if (!skillsMatch) {
      setImageUrl(null)
      return
    }

    const relativePath = `skills/${skillsMatch[1]}/${skillsMatch[2]}`

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

        skillIconCache.set(cacheKey, url)
        setImageUrl(url)
      })
      .catch((error) => {
        if (cancelled) return
        console.error(`[SkillAvatar] Failed to load icon ${relativePath}:`, error)
        setImageUrl(null)
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId, iconPath])

  return imageUrl
}

// Font size mapping for emoji rendering at different avatar sizes
const EMOJI_SIZE_CONFIG: Record<SkillAvatarSize, string> = {
  xs: 'text-[10px]',
  sm: 'text-[11px]',
  md: 'text-[13px]',
  lg: 'text-[24px]',
}

export function SkillAvatar({ skill, size = 'md', className, workspaceId }: SkillAvatarProps) {
  // Load custom icon file if available (icon.svg, icon.png, etc.)
  const loadedIcon = useSkillIcon(workspaceId, skill.iconPath)

  // Check if skill has an emoji icon in metadata
  const emojiIcon = isEmoji(skill.metadata.icon) ? skill.metadata.icon : null

  // Only apply size classes if className doesn't contain custom size classes
  const hasCustomSize = className?.match(/\b(h-|w-|size-)/)
  const containerSize = hasCustomSize ? undefined : SIZE_CONFIG[size]
  const defaultClasses = hasCustomSize ? undefined : 'rounded-[4px] ring-1 ring-border/30 shrink-0'

  // Priority: file icon > emoji icon > default fallback
  // If we have a loaded file icon, use CrossfadeAvatar
  if (loadedIcon) {
    return (
      <CrossfadeAvatar
        src={loadedIcon}
        alt={skill.metadata.name}
        className={cn(
          containerSize,
          defaultClasses,
          className
        )}
        fallbackClassName="bg-muted rounded-[4px]"
        fallback={<Zap className="w-full h-full text-muted-foreground p-0.5" />}
      />
    )
  }

  // If we have an emoji icon, render it as text
  if (emojiIcon) {
    return (
      <div
        className={cn(
          containerSize,
          defaultClasses,
          'flex items-center justify-center bg-muted',
          EMOJI_SIZE_CONFIG[size],
          'leading-none',
          className
        )}
        title={skill.metadata.name}
      >
        {emojiIcon}
      </div>
    )
  }

  // Default fallback - use CrossfadeAvatar with null src to show fallback
  return (
    <CrossfadeAvatar
      src={null}
      alt={skill.metadata.name}
      className={cn(
        containerSize,
        defaultClasses,
        className
      )}
      fallbackClassName="bg-muted rounded-[4px]"
      fallback={<Zap className="w-full h-full text-muted-foreground p-0.5" />}
    />
  )
}
