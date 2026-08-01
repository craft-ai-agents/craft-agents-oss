import React, { useEffect, useRef } from 'react'
import type { WorkspaceGraph } from '@archstudio/shared/knowledge'
import './KnowledgeGraphViewer.css'

interface KnowledgeGraphViewerProps {
  graph: WorkspaceGraph
  selectedNodeId: number | null
  highlightedNodeIds?: number[]
  onSelectNode: (id: number) => void
}

export function KnowledgeGraphViewer({
  graph,
  selectedNodeId,
  highlightedNodeIds = [],
  onSelectNode,
}: KnowledgeGraphViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!containerRef.current || !graph.nodes.length) return

    // Dynamic import of 3d-force-graph from CDN
    // For Phase 1, we'll render a simple canvas-based graph
    // Full 3d-force-graph integration comes in Phase 2

    const canvas = document.createElement('canvas')
    canvas.width = containerRef.current.clientWidth
    canvas.height = containerRef.current.clientHeight
    containerRef.current.appendChild(canvas)

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      canvas.remove()
      return
    }

    let frameId: number | null = null
    let disposed = false

    // Simple 2D graph visualization for Phase 1
    // This is a placeholder; Phase 2 will integrate 3d-force-graph from CDN

    const nodeRadius = 8
    const positions: Map<number, { x: number; y: number }> = new Map()

    // Random layout (better layouts can be added in Phase 2)
    graph.nodes.forEach((node) => {
      positions.set(node.id, {
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
      })
    })

    // Render loop
    const render = () => {
      if (disposed) return

      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Draw edges
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
      ctx.lineWidth = 1
      graph.edges.forEach((edge) => {
        const from = positions.get(edge.source)
        const to = positions.get(edge.target)
        if (from && to) {
          ctx.beginPath()
          ctx.moveTo(from.x, from.y)
          ctx.lineTo(to.x, to.y)
          ctx.stroke()
        }
      })

      // Draw nodes
      graph.nodes.forEach((node) => {
        const pos = positions.get(node.id)
        if (!pos) return

        const isSelected = node.id === selectedNodeId
        const isHighlighted = highlightedNodeIds.includes(node.id)
        const color = getNodeColor(node.type, isSelected, isHighlighted)
        const radius = nodeRadius + (isSelected ? 4 : isHighlighted ? 3 : 0)

        // Glow effect for highlighted nodes
        if (isHighlighted) {
          ctx.fillStyle = 'rgba(0, 255, 0, 0.2)'
          ctx.beginPath()
          ctx.arc(pos.x, pos.y, radius + 8, 0, Math.PI * 2)
          ctx.fill()
        }

        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2)
        ctx.fill()

        // Label
        ctx.fillStyle = isSelected || isHighlighted ? '#00ff00' : '#ffffff'
        ctx.font = '12px monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(node.label.slice(0, 8), pos.x, pos.y + radius + 16)
      })

      frameId = requestAnimationFrame(render)
    }

    render()

    // Click handler
    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      graph.nodes.forEach((node) => {
        const pos = positions.get(node.id)
        if (!pos) return
        const dist = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2)
        if (dist < nodeRadius + 10) {
          onSelectNode(node.id)
        }
      })
    }

    canvas.addEventListener('click', handleClick)

    return () => {
      disposed = true
      if (frameId !== null) cancelAnimationFrame(frameId)
      canvas.removeEventListener('click', handleClick)
      if (containerRef.current?.contains(canvas)) {
        containerRef.current.removeChild(canvas)
      }
    }
  }, [graph, selectedNodeId, highlightedNodeIds, onSelectNode])

  return <div ref={containerRef} className="knowledge-graph-viewer" />
}

function getNodeColor(type: string, isSelected: boolean, isHighlighted: boolean): string {
  if (isSelected) return '#00ff00' // Lime
  if (isHighlighted) return '#00ff00' // Bright green for highlighted
  switch (type) {
    case 'session':
      return '#00ccff' // Cyan
    case 'source':
      return '#aa00ff' // Purple
    case 'note':
      return '#ffff00' // Yellow
    default:
      return '#ffffff' // White
  }
}
