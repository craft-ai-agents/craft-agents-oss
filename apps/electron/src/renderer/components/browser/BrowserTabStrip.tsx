/**
 * BrowserTabStrip
 *
 * Rendered in the TopBar, shows compact badges for all active browser instances.
 * Clicking a badge focuses its dedicated browser window.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import * as Icons from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import {
  browserInstancesAtom,
  setBrowserInstancesAtom,
  updateBrowserInstanceAtom,
  removeBrowserInstanceAtom,
} from '@/atoms/browser-pane'
import { BrowserTabBadge } from './BrowserTabBadge'
import type { BrowserInstanceInfo } from '../../../shared/types'
import { getHostname } from './utils'

const MAX_VISIBLE_BADGES = 3

export function BrowserTabStrip() {
  const instances = useAtomValue(browserInstancesAtom)
  const setInstances = useSetAtom(setBrowserInstancesAtom)
  const updateInstance = useSetAtom(updateBrowserInstanceAtom)
  const removeInstance = useSetAtom(removeBrowserInstanceAtom)
  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null)
  const instancesRef = useRef(instances)

  useEffect(() => {
    instancesRef.current = instances
  }, [instances])

  useEffect(() => {
    window.electronAPI.browserPane.list().then((items) => {
      setInstances(items)
      if (items.length > 0) setActiveInstanceId((prev) => prev ?? items[0].id)
    })
  }, [setInstances])

  useEffect(() => {
    const cleanupState = window.electronAPI.browserPane.onStateChanged((info: BrowserInstanceInfo) => {
      updateInstance(info)
    })

    const cleanupRemoved = window.electronAPI.browserPane.onRemoved((id: string) => {
      removeInstance(id)
      setActiveInstanceId((prev) => {
        if (prev !== id) return prev
        const remaining = instancesRef.current.filter((item) => item.id !== id)
        return remaining[0]?.id ?? null
      })
    })

    const cleanupInteracted = window.electronAPI.browserPane.onInteracted((id: string) => {
      setActiveInstanceId(id)
    })

    return () => {
      cleanupState()
      cleanupRemoved()
      cleanupInteracted()
    }
  }, [updateInstance, removeInstance])

  useEffect(() => {
    if (instances.length === 0) {
      setActiveInstanceId(null)
      return
    }
    if (!activeInstanceId || !instances.some((item) => item.id === activeInstanceId)) {
      setActiveInstanceId(instances[0].id)
    }
  }, [instances, activeInstanceId])

  const handleBadgeClick = useCallback((instanceId: string) => {
    setActiveInstanceId(instanceId)
    void window.electronAPI.browserPane.focus(instanceId)
  }, [])

  const handleBadgeClose = useCallback((instanceId: string) => {
    void window.electronAPI.browserPane.destroy(instanceId)
    removeInstance(instanceId)
    setActiveInstanceId((prev) => {
      if (prev !== instanceId) return prev
      const remaining = instances.filter((item) => item.id !== instanceId)
      return remaining[0]?.id ?? null
    })
  }, [removeInstance, instances])

  if (instances.length === 0) return null

  const visible = instances.slice(0, MAX_VISIBLE_BADGES)
  const overflow = instances.slice(MAX_VISIBLE_BADGES)

  return (
    <div className="flex items-center gap-1">
      {visible.map((instance) => (
        <BrowserTabBadge
          key={instance.id}
          instance={instance}
          isActive={instance.id === activeInstanceId}
          onClick={() => handleBadgeClick(instance.id)}
          onClose={() => handleBadgeClose(instance.id)}
        />
      ))}

      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="h-[26px] px-1.5 rounded-md text-[11px] text-foreground/50 bg-foreground/[0.04] border border-foreground/[0.06] hover:bg-foreground/[0.08] transition-colors cursor-pointer"
            >
              +{overflow.length}
            </button>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end" minWidth="min-w-48">
            {overflow.map((instance) => {
              const hostname = getHostname(instance.url)
              return (
                <StyledDropdownMenuItem
                  key={instance.id}
                  onClick={() => handleBadgeClick(instance.id)}
                >
                  {instance.isLoading ? (
                    <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Icons.Globe className="h-3.5 w-3.5" />
                  )}
                  <span className="truncate">{instance.title || hostname}</span>
                </StyledDropdownMenuItem>
              )
            })}
          </StyledDropdownMenuContent>
        </DropdownMenu>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <div className="h-[26px] px-1.5 rounded-md border border-foreground/[0.08] bg-foreground/[0.03] text-foreground/45 flex items-center">
            <Icons.ExternalLink className="h-3 w-3" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">Each browser tab opens in a dedicated window</TooltipContent>
      </Tooltip>
    </div>
  )
}
