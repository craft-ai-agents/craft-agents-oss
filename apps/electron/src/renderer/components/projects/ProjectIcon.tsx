/**
 * ProjectIcon — loads project.config.icon from workspace assets via IPC.
 */

import * as React from 'react'
import { FolderKanban } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ProjectIconProps {
  workspaceId?: string | null
  /** Project slug (folder name under projects/) */
  projectSlug?: string
  /** Filename inside projects/{slug}/assets/ */
  iconFilename?: string | null
  /** Accent fallback tint */
  color?: string | null
  className?: string
  /** Icon size classes for fallback lucide icon */
  iconClassName?: string
}

const cache = new Map<string, string | null>()

function cacheKey(workspaceId: string, projectSlug: string, filename: string): string {
  return `${workspaceId}:${projectSlug}:${filename}`
}

export function ProjectIcon({
  workspaceId,
  projectSlug,
  iconFilename,
  color,
  className,
  iconClassName = 'h-3.5 w-3.5 text-foreground/60',
}: ProjectIconProps) {
  const [src, setSrc] = React.useState<string | null>(() => {
    if (!workspaceId || !projectSlug || !iconFilename) return null
    return cache.get(cacheKey(workspaceId, projectSlug, iconFilename)) ?? null
  })

  React.useEffect(() => {
    if (!workspaceId || !projectSlug || !iconFilename) {
      setSrc(null)
      return
    }

    const key = cacheKey(workspaceId, projectSlug, iconFilename)
    const cached = cache.get(key)
    if (cached !== undefined) {
      setSrc(cached)
      return
    }

    let cancelled = false
    const relativePath = `projects/${projectSlug}/assets/${iconFilename}`

    window.electronAPI
      .readWorkspaceImage(workspaceId, relativePath)
      .then((result) => {
        if (cancelled) return
        if (!result) {
          cache.set(key, null)
          setSrc(null)
          return
        }
        let dataUrl = result
        if (iconFilename.toLowerCase().endsWith('.svg') && !result.startsWith('data:')) {
          dataUrl = `data:image/svg+xml;base64,${btoa(result)}`
        }
        cache.set(key, dataUrl)
        setSrc(dataUrl)
      })
      .catch(() => {
        if (cancelled) return
        cache.set(key, null)
        setSrc(null)
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId, projectSlug, iconFilename])

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={cn('h-3.5 w-3.5 rounded object-cover shrink-0', className)}
        aria-hidden
      />
    )
  }

  return (
    <FolderKanban
      className={cn(iconClassName, className)}
      style={color ? { color } : undefined}
      aria-hidden
    />
  )
}

/** Bust cache after icon upload/replace. */
export function invalidateProjectIconCache(
  workspaceId: string,
  projectSlug: string,
  iconFilename?: string | null,
): void {
  if (iconFilename) {
    cache.delete(cacheKey(workspaceId, projectSlug, iconFilename))
    return
  }
  const prefix = `${workspaceId}:${projectSlug}:`
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}
