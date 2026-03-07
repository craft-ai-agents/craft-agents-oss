import * as React from 'react'

export interface UseAnnotationIslandPresentationOptions {
  anchor: { x: number; y: number } | null
  sourceKey: string
  closeGraceMs?: number
}

export interface AnnotationIslandPresentationState {
  renderAnchor: { x: number; y: number } | null
  renderSourceKey: string
  isVisible: boolean
  openedAtRef: React.MutableRefObject<number>
  handleExitComplete: () => void
  resetPresentation: () => void
}

export function useAnnotationIslandPresentation({
  anchor,
  sourceKey,
  closeGraceMs = 220,
}: UseAnnotationIslandPresentationOptions): AnnotationIslandPresentationState {
  const [renderAnchor, setRenderAnchor] = React.useState<{ x: number; y: number } | null>(null)
  const [renderSourceKey, setRenderSourceKey] = React.useState('none')
  const [isVisible, setIsVisible] = React.useState(false)
  const openedAtRef = React.useRef(0)

  React.useEffect(() => {
    if (anchor) {
      openedAtRef.current = Date.now()
      setRenderAnchor(anchor)
      setRenderSourceKey(sourceKey)
      setIsVisible(true)
      return
    }

    const openedRecently = Date.now() - openedAtRef.current < closeGraceMs
    if (openedRecently && renderAnchor) {
      return
    }

    setIsVisible(false)
  }, [anchor, sourceKey, closeGraceMs, renderAnchor])

  const handleExitComplete = React.useCallback(() => {
    if (anchor) return
    setRenderAnchor(null)
    setRenderSourceKey('none')
  }, [anchor])

  const resetPresentation = React.useCallback(() => {
    setRenderAnchor(null)
    setRenderSourceKey('none')
    setIsVisible(false)
    openedAtRef.current = 0
  }, [])

  return {
    renderAnchor,
    renderSourceKey,
    isVisible,
    openedAtRef,
    handleExitComplete,
    resetPresentation,
  }
}
