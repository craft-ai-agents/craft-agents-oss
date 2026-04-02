import * as React from 'react'
import type {
  PluginCapabilityRef,
} from '@craft-agent/shared/plugins'
import type { ActivityItem, ResponseContent } from '@craft-agent/ui'

interface PluginUiSurfaceState {
  sessionActions: PluginCapabilityRef[]
  composerActions: PluginCapabilityRef[]
  chatCardTypes: PluginCapabilityRef[]
}

export const PLUGIN_SURFACES_CHANGED_EVENT = 'craft:plugin-surfaces-changed'

let cachedSurfaceState: PluginUiSurfaceState | null = null
let pendingSurfaceState: Promise<PluginUiSurfaceState> | null = null

export function invalidatePluginSurfaceCache(options?: { notify?: boolean }): void {
  cachedSurfaceState = null
  pendingSurfaceState = null

  if (options?.notify !== false && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PLUGIN_SURFACES_CHANGED_EVENT))
  }
}

async function loadPluginUiSurfaceState(): Promise<PluginUiSurfaceState> {
  if (cachedSurfaceState) return cachedSurfaceState
  if (pendingSurfaceState) return pendingSurfaceState

  pendingSurfaceState = Promise.all([
    window.electronAPI.listPluginSessionActions(),
    window.electronAPI.listPluginComposerActions(),
    window.electronAPI.listPluginChatCardTypes(),
  ]).then(([sessionActions, composerActions, chatCardTypes]) => {
    cachedSurfaceState = { sessionActions, composerActions, chatCardTypes }
    pendingSurfaceState = null
    return cachedSurfaceState
  }).catch((error) => {
    pendingSurfaceState = null
    throw error
  })

  return pendingSurfaceState
}

function compareCapabilities(left: PluginCapabilityRef, right: PluginCapabilityRef): number {
  const leftTitle = left.title ?? left.id
  const rightTitle = right.title ?? right.id
  return leftTitle.localeCompare(rightTitle)
}

export function usePluginSessionActions(): PluginCapabilityRef[] {
  return usePluginSurfaceSlice('sessionActions')
}

export function usePluginComposerActions(): PluginCapabilityRef[] {
  return usePluginSurfaceSlice('composerActions')
}

export function usePluginChatCardTypes(): PluginCapabilityRef[] {
  return usePluginSurfaceSlice('chatCardTypes')
}

function usePluginSurfaceSlice(key: keyof PluginUiSurfaceState): PluginCapabilityRef[] {
  const [items, setItems] = React.useState<PluginCapabilityRef[]>(() => cachedSurfaceState?.[key] ?? [])

  React.useEffect(() => {
    let cancelled = false
    const load = () => {
      loadPluginUiSurfaceState()
        .then((state) => {
          if (!cancelled) {
            setItems([...(state[key] ?? [])].sort(compareCapabilities))
          }
        })
        .catch(() => {
          if (!cancelled) {
            setItems([])
          }
        })
    }

    load()

    const handleSurfacesChanged = () => {
      invalidatePluginSurfaceCache({ notify: false })
      load()
    }

    window.addEventListener(PLUGIN_SURFACES_CHANGED_EVENT, handleSurfacesChanged)

    return () => {
      cancelled = true
      window.removeEventListener(PLUGIN_SURFACES_CHANGED_EVENT, handleSurfacesChanged)
    }
  }, [key])

  return items
}

export function matchPluginChatCardsForTurn(args: {
  capabilities: PluginCapabilityRef[]
  activities: ActivityItem[]
  response?: ResponseContent
}): PluginCapabilityRef[] {
  const matches: PluginCapabilityRef[] = []

  for (const capability of args.capabilities) {
    const matcher = capability.matcher
    if (!matcher) continue

    const responseMatches = Boolean(
      args.response
        && (
          (matcher.role === 'assistant' && !args.response.isPlan)
          || (matcher.role === 'plan' && args.response.isPlan)
        ),
    )

    const activityMatches = args.activities.some((activity) => {
      if (matcher.role && matcher.role !== 'tool') return false
      if (matcher.toolName && matcher.toolName !== activity.toolName) return false
      if (matcher.toolStatus && matcher.toolStatus !== activity.status) return false
      if (typeof matcher.isError === 'boolean') {
        const isError = activity.status === 'error' || Boolean(activity.error)
        if (matcher.isError !== isError) return false
      }
      return true
    })

    if (responseMatches || activityMatches) {
      matches.push(capability)
    }
  }

  return matches.sort(compareCapabilities)
}
