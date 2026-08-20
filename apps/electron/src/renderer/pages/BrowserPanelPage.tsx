/**
 * BrowserPanelPage
 *
 * Host surface for an embedded browser instance panel. The main process
 * composites native WebContentsViews (toolbar + page) on top of this surface;
 * this component only reports its DOM rect and focus state so main can
 * position or hide those views.
 */

import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { focusedPanelIdAtom } from '@/atoms/panel-stack'

export interface BrowserPanelPageProps {
  /** Embedded browser instance id (from browserPane.createEmbedded) */
  instanceId: string
  /** Owning panel id in the panel stack (used to hide when unfocused) */
  panelId?: string
}

export default function BrowserPanelPage({ instanceId, panelId }: BrowserPanelPageProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef(0)
  const [removed, setRemoved] = useState(false)
  const focusedPanelId = useAtomValue(focusedPanelIdAtom)
  // Without a panelId (rendered outside the panel stack) assume focused.
  const isFocused = panelId === undefined || focusedPanelId === panelId

  // Push current bounds (or null when hidden) to the main process
  const syncBounds = useCallback(() => {
    const el = containerRef.current
    if (!el || !isFocused || removed) {
      window.electronAPI.browserPane.syncBounds(instanceId, null)
      return
    }
    const rect = el.getBoundingClientRect()
    window.electronAPI.browserPane.syncBounds(instanceId, {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    })
  }, [instanceId, isFocused, removed])

  // rAF-throttled bounds sync
  const scheduleSync = useCallback(() => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      syncBounds()
    })
  }, [syncBounds])

  // Observe geometry changes: element resize, window resize
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

  // Re-sync when focus or removal state flips (hide when unfocused, restore when focused)
  useEffect(() => {
    scheduleSync()
  }, [isFocused, removed, scheduleSync])

  // Track instance lifecycle: show placeholder if main reports this id removed
  useEffect(() => {
    const offRemoved = window.electronAPI.browserPane.onRemoved((id) => {
      if (id === instanceId) setRemoved(true)
    })
    const offStateChanged = window.electronAPI.browserPane.onStateChanged((info) => {
      if (info.id === instanceId) setRemoved(false)
    })
    return () => {
      offRemoved()
      offStateChanged()
    }
  }, [instanceId])

  // Unmount: hide the composited views, then destroy the embedded instance
  useEffect(() => {
    return () => {
      void (async () => {
        try {
          await window.electronAPI.browserPane.syncBounds(instanceId, null)
        } catch {
          // Best-effort hide; instance cleanup continues regardless
        }
        try {
          await window.electronAPI.browserPane.destroy(instanceId)
        } catch {
          // Instance may already be gone (window teardown)
        }
      })()
    }
  }, [instanceId])

  if (removed) {
    return (
      <div className="flex items-center justify-center h-full w-full bg-background text-muted-foreground">
        <p className="text-sm">{t('browser.closed', { defaultValue: 'Browser closed' })}</p>
      </div>
    )
  }

  // Full-size surface for the native views to cover
  return <div ref={containerRef} className="h-full w-full bg-background" />
}
