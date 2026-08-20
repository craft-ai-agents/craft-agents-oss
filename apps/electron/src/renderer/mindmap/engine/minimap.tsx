/**
 * Bottom-right overview of laid-out mind-map nodes + viewport rect.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { MindMapLayout, MindMapNodeId } from '@craft-agent/core/mindmap'
import {
  MIND_MAP_MINIMAP_THRESHOLD,
  MIND_MAP_NODE_HEIGHT,
  MIND_MAP_NODE_WIDTH,
} from './types'

export type MinimapBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

export interface MindMapMinimapProps {
  layout: MindMapLayout
  bounds: MinimapBounds
  /** screen = world * zoom + pan */
  pan: { x: number; y: number }
  zoom: number
  viewportSize: { width: number; height: number }
  nodeCount: number
  selectedId?: MindMapNodeId | null
  className?: string
  onNavigateTo?: (world: { x: number; y: number }) => void
}

const MM_W = 148
const MM_H = 96
const MM_PAD = 8

export function MindMapMinimap({
  layout,
  bounds,
  pan,
  zoom,
  viewportSize,
  nodeCount,
  selectedId = null,
  className,
  onNavigateTo,
}: MindMapMinimapProps) {
  const { t } = useTranslation()

  if (nodeCount < MIND_MAP_MINIMAP_THRESHOLD || bounds.width <= 0 || bounds.height <= 0) {
    return null
  }

  const contentW = Math.max(1, bounds.width)
  const contentH = Math.max(1, bounds.height)
  const scale = Math.min((MM_W - MM_PAD * 2) / contentW, (MM_H - MM_PAD * 2) / contentH)
  const ox = (MM_W - contentW * scale) / 2
  const oy = (MM_H - contentH * scale) / 2

  const toMini = (wx: number, wy: number) => ({
    x: ox + (wx - bounds.minX) * scale,
    y: oy + (wy - bounds.minY) * scale,
  })

  let viewRect: { x: number; y: number; w: number; h: number } | null = null
  if (zoom > 0 && viewportSize.width > 0 && viewportSize.height > 0) {
    const worldX = -pan.x / zoom
    const worldY = -pan.y / zoom
    const worldW = viewportSize.width / zoom
    const worldH = viewportSize.height / zoom
    const a = toMini(worldX, worldY)
    const b = toMini(worldX + worldW, worldY + worldH)
    viewRect = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y),
    }
  }

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onNavigateTo) return
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const wx = bounds.minX + (mx - ox) / scale
    const wy = bounds.minY + (my - oy) / scale
    onNavigateTo({ x: wx, y: wy })
  }

  const handleKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    if (!onNavigateTo) return
    e.preventDefault()
    onNavigateTo({
      x: bounds.minX + bounds.width / 2,
      y: bounds.minY + bounds.height / 2,
    })
  }

  const chipW = Math.max(2, MIND_MAP_NODE_WIDTH * scale * 0.4)
  const chipH = Math.max(2, MIND_MAP_NODE_HEIGHT * scale * 0.45)

  return (
    <div
      className={cn(
        'pointer-events-auto absolute bottom-3 right-3 z-10 overflow-hidden rounded-md border border-border/50 bg-background/85 shadow-sm backdrop-blur-sm',
        className,
      )}
    >
      <svg
        width={MM_W}
        height={MM_H}
        viewBox={`0 0 ${MM_W} ${MM_H}`}
        className="block cursor-pointer"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-label={t('mindmap.overview')}
>
        <rect width={MM_W} height={MM_H} className="fill-background/40" />
        {Object.entries(layout.positions).map(([id, pos]) => {
          if (!pos) return null
          const p = toMini(pos.x, pos.y)
          const selected = selectedId === id
          return (
            <rect
              key={id}
              x={p.x - chipW / 2}
              y={p.y - chipH / 2}
              width={chipW}
              height={chipH}
              rx={1}
              className={selected ? 'fill-foreground/70' : 'fill-foreground/30'}
            />
          )
        })}
        {viewRect ? (
          <rect
            x={viewRect.x}
            y={viewRect.y}
            width={Math.max(4, viewRect.w)}
            height={Math.max(4, viewRect.h)}
            rx={1}
            className="fill-foreground/5 stroke-foreground/40"
            strokeWidth={1}
          />
        ) : null}
      </svg>
    </div>
  )
}

export default MindMapMinimap
