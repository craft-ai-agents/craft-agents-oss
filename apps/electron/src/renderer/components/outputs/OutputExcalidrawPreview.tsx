import * as React from 'react'
import { exportToSvg } from '@excalidraw/excalidraw'
import type { OutputPreviewSettledHandler } from './OutputInlinePreview'

interface OutputExcalidrawPreviewProps {
  content: string
  label: string
  className?: string
  onPreviewSettled?: OutputPreviewSettledHandler
}

type ExcalidrawScene = {
  elements?: unknown[]
  appState?: Record<string, unknown> | null
  files?: Record<string, unknown> | null
}

export function OutputExcalidrawPreview({
  content,
  label,
  className,
  onPreviewSettled,
}: OutputExcalidrawPreviewProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    const container = containerRef.current
    if (!container) return
    container.replaceChildren()
    setError(null)

    async function render() {
      try {
        const target = containerRef.current
        if (!target) return
        const scene = JSON.parse(content) as ExcalidrawScene
        const elements = Array.isArray(scene.elements) ? scene.elements : []
        if (elements.length === 0) throw new Error('No Excalidraw elements found.')

        const svg = await exportToSvg({
          elements: elements as never,
          appState: {
            exportBackground: true,
            viewBackgroundColor: '#ffffff',
            ...(scene.appState ?? {}),
          } as never,
          files: (scene.files ?? {}) as never,
          exportPadding: 32,
          skipInliningFonts: true,
        })
        if (cancelled) return
        svg.setAttribute('role', 'img')
        svg.setAttribute('aria-label', label)
        svg.style.maxWidth = '100%'
        svg.style.maxHeight = '100%'
        svg.style.width = '100%'
        svg.style.height = '100%'
        svg.style.objectFit = 'contain'
        target.replaceChildren(svg)
        onPreviewSettled?.('ready')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        onPreviewSettled?.('error')
      }
    }

    void render()
    return () => { cancelled = true }
  }, [content, label, onPreviewSettled])

  if (error) {
    return (
      <div className={className ?? 'flex h-full w-full items-center justify-center p-4 text-sm text-white/55'}>
        Excalidraw preview unavailable: {error}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={className ?? 'flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-white p-3'}
    />
  )
}
