import * as React from 'react'

export interface UseAnnotationIslandEventsOptions {
  enabled: boolean
  openedAtRef: React.MutableRefObject<number>
  isCompactView: boolean
  isTargetInsideAnnotationIsland: (target: Node | null) => boolean
  onClose: () => void
  scrollGraceMs?: number
}

export function useAnnotationIslandEvents({
  enabled,
  openedAtRef,
  isCompactView,
  isTargetInsideAnnotationIsland,
  onClose,
  scrollGraceMs = 180,
}: UseAnnotationIslandEventsOptions): void {
  React.useEffect(() => {
    if (!enabled) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (isTargetInsideAnnotationIsland(target)) return
      onClose()
    }

    const handleScroll = (event: Event) => {
      if (Date.now() - openedAtRef.current < scrollGraceMs) {
        return
      }

      if (!isCompactView) {
        return
      }

      const target = event.target as Node | null
      if (target && isTargetInsideAnnotationIsland(target)) {
        return
      }

      onClose()
    }

    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [enabled, openedAtRef, isCompactView, isTargetInsideAnnotationIsland, onClose, scrollGraceMs])
}
