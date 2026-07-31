import React, { useMemo } from 'react'
import type { AnyMemory, MemoryEdge } from '@craft-agent/shared/memory/types'
import './MemoryGraph.css'

type MemoryNode = {
  memory: AnyMemory
  id: string
  title: string
  class: string
  confidence: number
  x: number
  y: number
}

type MemoryLink = {
  source: MemoryNode
  target: MemoryNode
  edge: MemoryEdge
}

type MemoryGraphProps = {
  memories: AnyMemory[]
  edges: MemoryEdge[]
  selectedId?: string
  onSelect?: (memory: AnyMemory) => void
}

export function MemoryGraph({ memories, edges, selectedId, onSelect }: MemoryGraphProps) {
  const nodes = useMemo(() => {
    const cx = 220
    const cy = 160
    const radius = 110
    return memories.map((m, idx) => {
      const angle = (2 * Math.PI * idx) / Math.max(memories.length, 1)
      return {
        memory: m,
        id: m.id,
        title: m.title,
        class: m.class,
        confidence: m.confidence,
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      } as MemoryNode
    })
  }, [memories])

  const links = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]))
    return edges
      .map((edge) => {
        const source = byId.get(edge.sourceMemoryId)
        const target = byId.get(edge.targetMemoryId)
        if (!source || !target || source.id === target.id) return null
        return { source, target, edge } satisfies MemoryLink
      })
      .filter((link): link is MemoryLink => link !== null)
  }, [edges, nodes])

  if (nodes.length === 0) {
    return <div className="memory-graph__empty">No memories available to graph.</div>
  }

  return (
    <svg viewBox="0 0 440 320" className="memory-graph" aria-label="Memory knowledge graph">
      <defs>
        <filter id="memory-node-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      <g>
        {links.map((link, idx) => (
          <line
            key={`edge-${idx}`}
            x1={link.source.x}
            y1={link.source.y}
            x2={link.target.x}
            y2={link.target.y}
            stroke={link.edge.type === 'supersedes' ? 'var(--color-accent)' : 'var(--color-border)'}
            strokeWidth={link.edge.type === 'same-tag' ? 1.6 : link.edge.type === 'supersedes' ? 2 : 1.2}
            strokeDasharray={link.edge.type === 'same-session' ? '4 4' : undefined}
            opacity={Math.max(0.35, Math.min(link.edge.weight, 1))}
          />
        ))}
      </g>

      <g>
        {nodes.map((node) => {
          const isActive = selectedId === node.id
          const fill = isActive ? 'var(--color-accent)' : 'var(--color-surface-muted)'
          const stroke = isActive ? 'var(--color-accent)' : 'var(--color-border)'
          return (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              style={{ cursor: 'pointer' }}
              role="button"
              tabIndex={0}
              aria-label={`${node.title}, ${node.class} memory`}
              onClick={() => onSelect?.(node.memory)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onSelect?.(node.memory)
              }}
            >
              <circle r="18" fill={fill} stroke={stroke} strokeWidth="2" />
              <text
                y="4"
                textAnchor="middle"
                fontSize="9"
                fill="var(--color-text)"
                style={{ pointerEvents: 'none' }}
              >
                {node.class.slice(0, 2).toUpperCase()}
              </text>
            </g>
          )
        })}
      </g>

      <g>
        {nodes.map((node) => (
          <text
            key={`label-${node.id}`}
            x={node.x}
            y={node.y + 34}
            textAnchor="middle"
            fontSize="11"
            fill="var(--color-text)"
            style={{ pointerEvents: 'none' }}
          >
            {node.title}
          </text>
        ))}
      </g>
    </svg>
  )
}
