import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import type { AnyMemory, MemoryEdge } from '@archstudio/shared/memory/types'
import './MemoryGraph.css'

// ── Types ────────────────────────────────────────────────────────────

type SimNode = {
  memory: AnyMemory
  id: string
  title: string
  class: AnyMemory['class']
  confidence: number
  x: number
  y: number
  vx: number
  vy: number
  fx?: number  // fixed position (while dragging)
  fy?: number
  degree: number  // edge count for sizing
}

type SimLink = {
  source: SimNode
  target: SimNode
  edge: MemoryEdge
}

type MemoryGraphProps = {
  memories: AnyMemory[]
  edges: MemoryEdge[]
  selectedId?: string
  onSelect?: (memory: AnyMemory) => void
  /** Phase 6: callback to create a manual edge between two memories */
  onCreateEdge?: (sourceId: string, targetId: string) => void
  /** Phase 6: callback to delete an edge */
  onDeleteEdge?: (edgeId: string) => void
}

// ── Class colors ────────────────────────────────────────────────────

const CLASS_COLORS: Record<string, string> = {
  profile: '#5b8def',
  semantic: '#3ecf8e',
  episodic: '#f5a623',
  procedural: '#a855f7',
}

const EDGE_COLORS: Record<string, string> = {
  'supersedes': '#ef4444',
  'same-session': '#6366f1',
  'same-tag': '#10b981',
  'depends-on': '#f59e0b',
  'related-to': '#8b5cf6',
}

// ── Force-directed simulation ────────────────────────────────────────

const WIDTH = 600
const HEIGHT = 400
const REPULSION = 1200       // Coulomb's law constant
const SPRING_LENGTH = 80     // rest length of edge springs
const SPRING_STRENGTH = 0.08 // Hooke's law constant
const CENTERING = 0.02       // gravity toward center
const DAMPING = 0.85         // velocity damping per tick
const MAX_VELOCITY = 30      // cap to prevent explosions
const TICKS = 300            // total simulation ticks
const TICK_MS = 16           // ~60fps

function runSimulation(nodes: SimNode[], links: SimLink[], ticks: number): void {
  const cx = WIDTH / 2
  const cy = HEIGHT / 2

  for (let tick = 0; tick < ticks; tick++) {
    // Repulsive forces (all pairs)
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j]
        const dx = a.x - b.x
        const dy = a.y - b.y
        let dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 1) dist = 1 // avoid division by zero
        const force = REPULSION / (dist * dist)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        if (a.fx === undefined) { a.vx += fx; a.vy += fy }
        if (b.fx === undefined) { b.vx -= fx; b.vy -= fy }
      }
    }

    // Attractive forces (springs along edges)
    for (const link of links) {
      const { source, target } = link
      const dx = target.x - source.x
      const dy = target.y - source.y
      let dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 1) dist = 1
      const displacement = dist - SPRING_LENGTH
      const force = SPRING_STRENGTH * displacement
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      if (source.fx === undefined) { source.vx += fx; source.vy += fy }
      if (target.fx === undefined) { target.vx -= fx; target.vy -= fy }
    }

    // Centering force + integration
    for (const node of nodes) {
      if (node.fx !== undefined) {
        node.x = node.fx
        node.y = node.fy!
        continue
      }
      // Centering
      node.vx += (cx - node.x) * CENTERING
      node.vy += (cy - node.y) * CENTERING
      // Damping
      node.vx *= DAMPING
      node.vy *= DAMPING
      // Cap velocity
      const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy)
      if (speed > MAX_VELOCITY) {
        node.vx = (node.vx / speed) * MAX_VELOCITY
        node.vy = (node.vy / speed) * MAX_VELOCITY
      }
      // Integrate
      node.x += node.vx
      node.y += node.vy
      // Bounds
      node.x = Math.max(30, Math.min(WIDTH - 30, node.x))
      node.y = Math.max(30, Math.min(HEIGHT - 30, node.y))
    }
  }
}

// ── Component ────────────────────────────────────────────────────────

export function MemoryGraph({ memories, edges, selectedId, onSelect, onCreateEdge, onDeleteEdge }: MemoryGraphProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [linkMode, setLinkMode] = useState<string | null>(null) // source node ID when in "link to" mode
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; edgeId: string } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })

  // Build simulation nodes + links
  const { simNodes, simLinks } = useMemo(() => {
    // Compute degree (edge count) per node
    const degreeMap = new Map<string, number>()
    for (const edge of edges) {
      degreeMap.set(edge.sourceMemoryId, (degreeMap.get(edge.sourceMemoryId) ?? 0) + 1)
      degreeMap.set(edge.targetMemoryId, (degreeMap.get(edge.targetMemoryId) ?? 0) + 1)
    }

    // Initialize nodes in a loose circle (starting positions for sim)
    const nodes: SimNode[] = memories.map((m, idx) => {
      const angle = (2 * Math.PI * idx) / Math.max(memories.length, 1)
      const r = 100
      return {
        memory: m,
        id: m.id,
        title: m.title,
        class: m.class,
        confidence: m.confidence,
        x: WIDTH / 2 + r * Math.cos(angle),
        y: HEIGHT / 2 + r * Math.sin(angle),
        vx: 0,
        vy: 0,
        degree: degreeMap.get(m.id) ?? 0,
      }
    })

    const byId = new Map(nodes.map((n) => [n.id, n]))
    const links: SimLink[] = edges
      .map((edge) => {
        const source = byId.get(edge.sourceMemoryId)
        const target = byId.get(edge.targetMemoryId)
        if (!source || !target || source.id === target.id) return null
        return { source, target, edge } as SimLink
      })
      .filter((l): l is SimLink => l !== null)

    // Run the physics simulation
    runSimulation(nodes, links, TICKS)

    return { simNodes: nodes, simLinks: links }
  }, [memories, edges])

  // ── Interaction handlers ──────────────────────────────────────────

  const handleNodeMouseDown = useCallback((e: React.MouseEvent, node: SimNode) => {
    e.stopPropagation()
    if (linkMode && linkMode !== node.id) {
      // Create edge from linkMode source to this node
      onCreateEdge?.(linkMode, node.id)
      setLinkMode(null)
      return
    }
    // Start dragging
    node.fx = node.x
    node.fy = node.y
    setHoveredId(node.id)
  }, [linkMode, onCreateEdge])

  const handleNodeMouseMove = useCallback((e: React.MouseEvent, node: SimNode) => {
    if (node.fx === undefined) return
    // Convert screen coords to SVG coords
    const svg = svgRef.current
    if (!svg) return
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return
    const local = pt.matrixTransform(ctm.inverse())
    node.fx = local.x
    node.fy = local.y
    // Position is applied directly in the next paint via the transform.
    // No need to re-run simulation during drag — the fixed position
    // overrides the physics for this node.
  }, [])

  const handleNodeMouseUp = useCallback((node: SimNode) => {
    node.fx = undefined
    node.fy = undefined
  }, [])

  const handleNodeClick = useCallback((node: SimNode) => {
    if (linkMode) return // handled by mousedown
    onSelect?.(node.memory)
  }, [linkMode, onSelect])

  // Pan / zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom(z => Math.max(0.3, Math.min(3, z * delta)))
  }, [])

  const handleSvgMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget || (e.target as Element).tagName === 'svg') {
      isPanning.current = true
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
      if (linkMode) setLinkMode(null)
      if (contextMenu) setContextMenu(null)
    }
  }, [pan, linkMode, contextMenu])

  const handleSvgMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return
    const dx = e.clientX - panStart.current.x
    const dy = e.clientY - panStart.current.y
    setPan({ x: panStart.current.panX + dx, y: panStart.current.panY + dy })
  }, [])

  const handleSvgMouseUp = useCallback(() => {
    isPanning.current = false
  }, [])

  // Close context menu on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLinkMode(null)
        setContextMenu(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ── Render ─────────────────────────────────────────────────────────

  if (simNodes.length === 0) {
    return <div className="memory-graph__empty">No memories available to graph.</div>
  }

  const selectedNode = simNodes.find(n => n.id === selectedId)
  const hoveredNode = hoveredId ? simNodes.find(n => n.id === hoveredId) : null

  // Determine which nodes/edges to highlight
  const highlightNodeIds = new Set<string>()
  if (selectedNode) {
    highlightNodeIds.add(selectedNode.id)
    for (const link of simLinks) {
      if (link.source.id === selectedNode.id) highlightNodeIds.add(link.target.id)
      if (link.target.id === selectedNode.id) highlightNodeIds.add(link.source.id)
    }
  }
  if (hoveredNode) {
    highlightNodeIds.add(hoveredNode.id)
    for (const link of simLinks) {
      if (link.source.id === hoveredNode.id) highlightNodeIds.add(link.target.id)
      if (link.target.id === hoveredNode.id) highlightNodeIds.add(link.source.id)
    }
  }

  return (
    <div className="memory-graph__container">
      {/* Zoom controls */}
      <div className="memory-graph__controls">
        <button className="memory-graph__zoom-btn" onClick={() => setZoom(z => Math.min(3, z * 1.2))} title="Zoom in">+</button>
        <button className="memory-graph__zoom-btn" onClick={() => setZoom(z => Math.max(0.3, z * 0.8))} title="Zoom out">−</button>
        <button className="memory-graph__zoom-btn" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} title="Reset view">⟲</button>
      </div>

      {/* Legend */}
      <div className="memory-graph__legend">
        <div className="memory-graph__legend-section">
          <span className="memory-graph__legend-title">Classes</span>
          {Object.entries(CLASS_COLORS).map(([cls, color]) => (
            <div key={cls} className="memory-graph__legend-item">
              <span className="memory-graph__legend-dot" style={{ background: color }} />
              <span>{cls}</span>
            </div>
          ))}
        </div>
        {simLinks.length > 0 && (
          <div className="memory-graph__legend-section">
            <span className="memory-graph__legend-title">Edges</span>
            {Object.entries(EDGE_COLORS).filter(([type]) => simLinks.some(l => l.edge.type === type)).map(([type, color]) => (
              <div key={type} className="memory-graph__legend-item">
                <span className="memory-graph__legend-line" style={{ background: color }} />
                <span>{type}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Link mode indicator */}
      {linkMode && (
        <div className="memory-graph__link-mode">
          Linking from "{simNodes.find(n => n.id === linkMode)?.title}" — click a target node
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="memory-graph"
        aria-label="Memory knowledge graph"
        onWheel={handleWheel}
        onMouseDown={handleSvgMouseDown}
        onMouseMove={handleSvgMouseMove}
        onMouseUp={handleSvgMouseUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <filter id="memory-node-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Edges */}
          <g>
            {simLinks.map((link, idx) => {
              const isHighlighted = highlightNodeIds.has(link.source.id) && highlightNodeIds.has(link.target.id)
              const isDimmed = (selectedNode || hoveredNode) && !isHighlighted
              const isManual = link.edge.provenance === 'manual'
              const color = EDGE_COLORS[link.edge.type] ?? 'var(--color-border)'
              return (
                <line
                  key={`edge-${idx}`}
                  x1={link.source.x}
                  y1={link.source.y}
                  x2={link.target.x}
                  y2={link.target.y}
                  stroke={color}
                  strokeWidth={Math.max(1, link.edge.weight * 1.5)}
                  strokeDasharray={isManual ? '5 3' : link.edge.type === 'same-session' ? '4 4' : undefined}
                  opacity={isDimmed ? 0.1 : Math.max(0.3, Math.min(link.edge.weight, 0.9))}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setContextMenu({ x: e.clientX, y: e.clientY, edgeId: link.edge.id })
                  }}
                />
              )
            })}
          </g>

          {/* Nodes */}
          <g>
            {simNodes.map((node) => {
              const isSelected = selectedId === node.id
              const isHovered = hoveredId === node.id
              const isLinkSource = linkMode === node.id
              const isDimmed = (selectedNode || hoveredNode) && !highlightNodeIds.has(node.id)
              const color = CLASS_COLORS[node.class] ?? '#999'
              const radius = 12 + Math.min(node.degree * 2, 10) // size by degree

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  style={{ cursor: linkMode && linkMode !== node.id ? 'crosshair' : 'grab' }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.title}, ${node.class} memory`}
                  onMouseDown={(e) => handleNodeMouseDown(e, node)}
                  onMouseMove={(e) => handleNodeMouseMove(e, node)}
                  onMouseUp={() => handleNodeMouseUp(node)}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => { setHoveredId(null); handleNodeMouseUp(node) }}
                  onClick={() => handleNodeClick(node)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onSelect?.(node.memory)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (onCreateEdge) {
                      setLinkMode(node.id)
                    }
                  }}
                  opacity={isDimmed ? 0.3 : 1}
                >
                  {(isSelected || isHovered || isLinkSource) && (
                    <circle r={radius + 4} fill="none" stroke={isLinkSource ? '#8b5cf6' : color} strokeWidth="2" opacity="0.5" />
                  )}
                  <circle
                    r={radius}
                    fill={isSelected ? color : `${color}40`}
                    stroke={color}
                    strokeWidth={isSelected ? 3 : 2}
                    filter={isSelected || isHovered ? 'url(#memory-node-glow)' : undefined}
                  />
                  <text
                    y="3"
                    textAnchor="middle"
                    fontSize="8"
                    fontWeight="bold"
                    fill={isSelected ? '#fff' : color}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {node.class.slice(0, 3).toUpperCase()}
                  </text>
                  {/* Title label below node */}
                  <text
                    y={radius + 12}
                    textAnchor="middle"
                    fontSize="9"
                    fill="var(--color-text)"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {node.title.length > 18 ? `${node.title.slice(0, 18)}…` : node.title}
                  </text>
                </g>
              )
            })}
          </g>
        </g>
      </svg>

      {/* Context menu for edge deletion */}
      {contextMenu && onDeleteEdge && (
        <>
          <div className="memory-graph__context-menu-backdrop" onClick={() => setContextMenu(null)} />
          <div
            className="memory-graph__context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="memory-graph__context-menu-item memory-graph__context-menu-item--danger"
              onClick={() => {
                onDeleteEdge(contextMenu.edgeId)
                setContextMenu(null)
              }}
            >
              Delete relationship
            </button>
          </div>
        </>
      )}
    </div>
  )
}