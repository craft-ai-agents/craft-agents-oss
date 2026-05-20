import * as React from 'react'
import * as storage from '@/lib/local-storage'
import type { AgentDefinitionDTO } from '../../shared/types'

type AgentDisplayNameMap = Record<string, string>

const CHANGE_EVENT = 'craft:agent-display-names-changed'

function readDisplayNames(): AgentDisplayNameMap {
  return storage.get<AgentDisplayNameMap>(storage.KEYS.agentDisplayNames, {})
}

function writeDisplayNames(names: AgentDisplayNameMap) {
  storage.set(storage.KEYS.agentDisplayNames, names)
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}

export function useAgentDisplayNames() {
  const [names, setNames] = React.useState<AgentDisplayNameMap>(() => readDisplayNames())

  React.useEffect(() => {
    const refresh = () => setNames(readDisplayNames())
    window.addEventListener(CHANGE_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const getDisplayName = React.useCallback((agent: AgentDefinitionDTO) => {
    return names[agent.slug]?.trim() || agent.metadata.name
  }, [names])

  const setDisplayName = React.useCallback((agent: AgentDefinitionDTO, nextName: string) => {
    const clean = nextName.replace(/\s+/g, ' ').trim()
    const base = agent.metadata.name.trim()
    const current = readDisplayNames()
    if (!clean || clean === base) {
      delete current[agent.slug]
    } else {
      current[agent.slug] = clean
    }
    writeDisplayNames(current)
  }, [])

  return { names, getDisplayName, setDisplayName }
}
