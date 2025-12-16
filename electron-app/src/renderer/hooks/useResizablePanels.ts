import { useState, useCallback } from 'react'

export function useResizablePanels(key: string, defaultSizes: number[]) {
  const [layout, setLayout] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem(`panel-layout:${key}`)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length === defaultSizes.length) {
          return parsed
        }
      }
    } catch {
      // Ignore parsing errors
    }
    return defaultSizes
  })

  const onLayoutChange = useCallback((sizes: number[]) => {
    setLayout(sizes)
    try {
      localStorage.setItem(`panel-layout:${key}`, JSON.stringify(sizes))
    } catch {
      // Ignore storage errors
    }
  }, [key])

  return { layout, onLayoutChange }
}
