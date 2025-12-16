import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface NavigationContextType {
  selectedAgentId: string | null
  setSelectedAgentId: (id: string | null) => void
  clearAgentFilter: () => void
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined)

interface NavigationProviderProps {
  children: ReactNode
}

export function NavigationProvider({ children }: NavigationProviderProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)

  const clearAgentFilter = useCallback(() => {
    setSelectedAgentId(null)
  }, [])

  return (
    <NavigationContext.Provider
      value={{
        selectedAgentId,
        setSelectedAgentId,
        clearAgentFilter
      }}
    >
      {children}
    </NavigationContext.Provider>
  )
}

export function useNavigation() {
  const context = useContext(NavigationContext)
  if (context === undefined) {
    throw new Error('useNavigation must be used within a NavigationProvider')
  }
  return context
}
