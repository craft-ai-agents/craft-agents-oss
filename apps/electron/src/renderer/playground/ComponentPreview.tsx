import * as React from 'react'
import { cn } from '@/lib/utils'
import type { ComponentEntry } from './registry'

type BackgroundStyle = 'default' | 'light' | 'dark' | 'checkered'

interface ComponentPreviewProps {
  component: ComponentEntry
  props: Record<string, unknown>
}

const MIN_WIDTH = 100
const MIN_HEIGHT = 100
const DEFAULT_WIDTH = 800
const DEFAULT_HEIGHT = 600

export function ComponentPreview({ component, props }: ComponentPreviewProps) {
  const [bgStyle, setBgStyle] = React.useState<BackgroundStyle>('default')
  const [size, setSize] = React.useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })
  const containerRef = React.useRef<HTMLDivElement>(null)
  const isDraggingRef = React.useRef<'right' | 'bottom' | 'corner' | null>(null)
  const startPosRef = React.useRef({ x: 0, y: 0 })
  const startSizeRef = React.useRef({ width: 0, height: 0 })

  // Merge default props, mock data, and current props
  const mergedProps = React.useMemo(() => {
    const defaults: Record<string, unknown> = {}
    for (const prop of component.props) {
      defaults[prop.name] = prop.defaultValue
    }
    const mockData = component.mockData?.() ?? {}
    return { ...defaults, ...mockData, ...props }
  }, [component, props])

  // Render with optional wrapper
  const Component = component.component
  const Wrapper = component.wrapper ?? React.Fragment

  const bgClasses: Record<BackgroundStyle, string> = {
    default: 'bg-background',
    light: 'bg-white',
    dark: 'bg-zinc-900',
    checkered: 'bg-[length:20px_20px] bg-[linear-gradient(45deg,#f0f0f0_25%,transparent_25%),linear-gradient(-45deg,#f0f0f0_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f0f0f0_75%),linear-gradient(-45deg,transparent_75%,#f0f0f0_75%)] dark:bg-[linear-gradient(45deg,#2a2a2a_25%,transparent_25%),linear-gradient(-45deg,#2a2a2a_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#2a2a2a_75%),linear-gradient(-45deg,transparent_75%,#2a2a2a_75%)]',
  }

  const handleMouseDown = React.useCallback((e: React.MouseEvent, direction: 'right' | 'bottom' | 'corner') => {
    e.preventDefault()
    isDraggingRef.current = direction
    startPosRef.current = { x: e.clientX, y: e.clientY }
    startSizeRef.current = { ...size }
  }, [size])

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return

      const deltaX = e.clientX - startPosRef.current.x
      const deltaY = e.clientY - startPosRef.current.y

      setSize(prev => {
        let newWidth = prev.width
        let newHeight = prev.height

        if (isDraggingRef.current === 'right' || isDraggingRef.current === 'corner') {
          newWidth = Math.max(MIN_WIDTH, startSizeRef.current.width + deltaX)
        }
        if (isDraggingRef.current === 'bottom' || isDraggingRef.current === 'corner') {
          newHeight = Math.max(MIN_HEIGHT, startSizeRef.current.height + deltaY)
        }

        return { width: newWidth, height: newHeight }
      })
    }

    const handleMouseUp = () => {
      isDraggingRef.current = null
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <h2 className="text-lg font-semibold text-foreground font-sans">
            {component.name}
          </h2>
          <p className="text-sm text-muted-foreground">
            {component.description}
          </p>
        </div>

        <div className="flex items-center gap-4">
          {/* Size display */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">
              {Math.round(size.width)} × {Math.round(size.height)}
            </span>
            <button
              onClick={() => setSize({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })}
              className="px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
            >
              Reset
            </button>
          </div>

          {/* Background style selector */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground mr-2">Background:</span>
            {(['default', 'light', 'dark', 'checkered'] as BackgroundStyle[]).map(style => (
              <button
                key={style}
                onClick={() => setBgStyle(style)}
                className={cn(
                  'px-2 py-1 rounded text-xs transition-colors',
                  bgStyle === style
                    ? 'bg-foreground/10 text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {style.charAt(0).toUpperCase() + style.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Preview area */}
      <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
        {/* Resizable container */}
        <div
          ref={containerRef}
          className="relative"
          style={{ width: size.width, height: size.height }}
        >
          {/* Component preview box */}
          <div
            className={cn(
              'w-full h-full rounded-lg border border-border overflow-auto',
              component.layout !== 'top' && 'flex items-center justify-center',
              bgClasses[bgStyle]
            )}
          >
            <Wrapper>
              <Component {...mergedProps} />
            </Wrapper>
          </div>

          {/* Right resize handle */}
          <div
            onMouseDown={(e) => handleMouseDown(e, 'right')}
            className="absolute top-0 -right-1 w-2 h-full cursor-ew-resize hover:bg-primary/20 active:bg-primary/30 transition-colors"
          />

          {/* Bottom resize handle */}
          <div
            onMouseDown={(e) => handleMouseDown(e, 'bottom')}
            className="absolute -bottom-1 left-0 h-2 w-full cursor-ns-resize hover:bg-primary/20 active:bg-primary/30 transition-colors"
          />

          {/* Corner resize handle */}
          <div
            onMouseDown={(e) => handleMouseDown(e, 'corner')}
            className="absolute -bottom-1 -right-1 w-3 h-3 cursor-nwse-resize hover:bg-primary/30 active:bg-primary/40 transition-colors rounded-br"
          />
        </div>
      </div>
    </div>
  )
}
