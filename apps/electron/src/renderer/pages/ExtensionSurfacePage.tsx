/**
 * ExtensionSurfacePage
 *
 * Host surface for a sandboxed extension UI panel (S-05). Mirrors
 * KnowledgeSurfacePage: the main process composites a native BrowserView on top
 * of this surface via `extensionSurface.createEmbedded` with partition
 * `persist:ext-${ws||'default'}-${extensionId}`; this component reports DOM rect
 * + focus so main can position or hide the view.
 *
 * Instance identity: durableKey `ext:${ws||'_default'}:${extensionId}:${viewId}`.
 * Each effect run owns one create/destroy pair; URL changes release before recreating.
 */

import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { focusedPanelIdAtom } from '@/atoms/panel-stack'
import { useAppShellContext } from '@/context/AppShellContext'

export interface ExtensionSurfacePageProps {
  extensionId: string
  viewId: string
  /** Owning panel id in the panel stack (used to hide when unfocused) */
  panelId?: string
  /** Extension UI URL; defaults to about:blank (shows load hint) */
  url?: string
}

export default function ExtensionSurfacePage({
  extensionId,
  viewId,
  panelId,
  url,
}: ExtensionSurfacePageProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef(0)
  const releaseRef = useRef<Promise<void>>(Promise.resolve())
  const [instanceId, setInstanceId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removed, setRemoved] = useState(false)
  const focusedPanelId = useAtomValue(focusedPanelIdAtom)
  const { activeWorkspaceId } = useAppShellContext()
  const isFocused = panelId === undefined || focusedPanelId === panelId

  const durableKey = useMemo(() => {
    const ws =
      typeof activeWorkspaceId === 'string' && activeWorkspaceId.trim()
        ? activeWorkspaceId.trim()
        : '_default'
    return `ext:${ws}:${extensionId}:${viewId}`
  }, [activeWorkspaceId, extensionId, viewId])
  const surfaceUrl = (url?.trim() || 'about:blank')
  const isBlank = surfaceUrl === 'about:blank'

  useEffect(() => {
    let cancelled = false
    let createdId: string | null = null
    const previousRelease = releaseRef.current
    setInstanceId(null)
    setError(null)
    setRemoved(false)
    const acquire = (async () => {
      await previousRelease
      if (cancelled) return
      try {
        createdId = await window.electronAPI.extensionSurface.createEmbedded({
          durableKey,
          url: surfaceUrl,
          extensionId,
          viewId,
          workspaceId: activeWorkspaceId,
        })
        if (!cancelled) setInstanceId(createdId)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      releaseRef.current = acquire.then(async () => {
        if (createdId === null) return
        try {
          await window.electronAPI.extensionSurface.syncBounds({ instanceId: createdId, rect: null })
        } catch {
          // Best-effort hide
        }
        try {
          await window.electronAPI.extensionSurface.destroy({ instanceId: createdId })
        } catch {
          // Instance may already be gone
        }
      })
    }
  }, [durableKey, surfaceUrl, extensionId, viewId, activeWorkspaceId])

  const syncBounds = useCallback(() => {
    if (!instanceId) return
    const el = containerRef.current
    if (!el || !isFocused || removed) {
      window.electronAPI.extensionSurface.syncBounds({ instanceId, rect: null })
      return
    }
    const rect = el.getBoundingClientRect()
    window.electronAPI.extensionSurface.syncBounds({
      instanceId,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    })
  }, [instanceId, isFocused, removed])

  const scheduleSync = useCallback(() => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      syncBounds()
    })
  }, [syncBounds])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(scheduleSync)
    observer.observe(el)
    window.addEventListener('resize', scheduleSync)
    scheduleSync()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', scheduleSync)
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    }
  }, [scheduleSync])

  useEffect(() => {
    scheduleSync()
  }, [isFocused, removed, scheduleSync])

  useEffect(() => {
    if (!instanceId) return
    const offRemoved = window.electronAPI.extensionSurface.onRemoved((removedId) => {
      if (removedId === instanceId) setRemoved(true)
    })
    const offStateChanged = window.electronAPI.extensionSurface.onStateChanged((state) => {
      if (state.instanceId === instanceId) setRemoved(false)
    })
    return () => {
      offRemoved()
      offStateChanged()
    }
  }, [instanceId])

  const fullSurface = <div ref={containerRef} className="h-full w-full bg-background" />

  if (error) {
    return (
      <div className="flex items-center justify-center h-full w-full bg-background text-muted-foreground">
        <p className="text-sm">
          {t('extensions.surface.error', { defaultValue: 'Failed to open extension surface' })}
        </p>
      </div>
    )
  }

  if (removed) {
    return (
      <div className="flex items-center justify-center h-full w-full bg-background text-muted-foreground">
        <p className="text-sm">
          {t('extensions.surface.removed', { defaultValue: 'Extension surface closed' })}
        </p>
      </div>
    )
  }

  if (!instanceId) {
    return (
      <div className="flex items-center justify-center h-full w-full bg-background text-muted-foreground">
        <p className="text-sm">
          {t('extensions.surface.loading', { defaultValue: 'Loading extension surface…' })}
        </p>
      </div>
    )
  }

  if (isBlank) {
    return (
      <div className="flex h-full w-full flex-col bg-background">
        <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
          {t('extensions.surface.loadUrlHint', {
            defaultValue: 'No URL configured for this extension view. Pass a URL to load sandboxed UI.',
          })}
        </div>
        <div className="relative min-h-0 flex-1">{fullSurface}</div>
      </div>
    )
  }

  return fullSurface
}
