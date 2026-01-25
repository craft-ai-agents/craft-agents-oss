/**
 * DiagramRenderer - SVG renderer for Flowy documents
 *
 * Renders flowcharts (nodes + edges) and mockups (screens + components)
 * as SVG with proper styling, zoom/pan support, and responsive sizing.
 */

import * as React from 'react'
import { useMemo, useCallback } from 'react'
import type {
  FlowyDocument,
  FlowyFlowchart,
  FlowyMockup,
  FlowyNode,
  FlowyEdge,
  MockupScreen,
  MockupComponent,
  NodeStyle,
  EdgeStyle,
} from '@vesper/shared/flowy'
import { cn } from '@/lib/utils'

export interface DiagramRendererProps {
  document: FlowyDocument
  className?: string
  /** Optional zoom level (default: 1) */
  zoom?: number
  /** Optional pan offset */
  pan?: { x: number; y: number }
  /** Whether to show a background grid */
  showGrid?: boolean
}

/**
 * Device dimensions for mockup frames
 */
const DEVICE_DIMENSIONS = {
  iphone: { width: 393, height: 852, cornerRadius: 47, statusBarHeight: 47 },
  ipad: { width: 820, height: 1180, cornerRadius: 18, statusBarHeight: 24 },
} as const

/**
 * Default styles for nodes
 */
const DEFAULT_NODE_STYLE: NodeStyle = {
  fill: '#f8fafc',
  stroke: '#cbd5e1',
  strokeWidth: 1.5,
  cornerRadius: 8,
}

/**
 * Default styles for edges
 */
const DEFAULT_EDGE_STYLE: EdgeStyle = {
  stroke: '#94a3b8',
  strokeWidth: 1.5,
  markerEnd: 'arrow',
}

function DiagramRendererComponent({
  document,
  className,
  zoom = 1,
  pan = { x: 0, y: 0 },
  showGrid = true,
}: DiagramRendererProps) {
  // Calculate viewBox based on content bounds
  const viewBox = useMemo(() => {
    if (document.type === 'flowchart') {
      return calculateFlowchartViewBox(document.content as FlowyFlowchart)
    } else {
      return calculateMockupViewBox(document.content as FlowyMockup)
    }
  }, [document])

  // Apply viewport settings from document if available
  const effectiveZoom = document.viewport?.zoom ?? zoom
  const effectivePan = document.viewport?.pan ?? pan

  return (
    <div className={cn('w-full h-full overflow-hidden', className)}>
      <svg
        width="100%"
        height="100%"
        viewBox={`${viewBox.x - effectivePan.x} ${viewBox.y - effectivePan.y} ${viewBox.width / effectiveZoom} ${viewBox.height / effectiveZoom}`}
        preserveAspectRatio="xMidYMid meet"
        className="select-none"
      >
        <defs>
          {/* Arrow marker for edges */}
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
          </marker>
          <marker
            id="circle-marker"
            viewBox="0 0 10 10"
            refX="5"
            refY="5"
            markerWidth="5"
            markerHeight="5"
          >
            <circle cx="5" cy="5" r="4" fill="#94a3b8" />
          </marker>
          <marker
            id="diamond-marker"
            viewBox="0 0 10 10"
            refX="5"
            refY="5"
            markerWidth="6"
            markerHeight="6"
          >
            <path d="M 5 0 L 10 5 L 5 10 L 0 5 z" fill="#94a3b8" />
          </marker>
          {/* Drop shadow filter */}
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.1" />
          </filter>
        </defs>

        {/* Background grid */}
        {showGrid && (
          <defs>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path
                d="M 20 0 L 0 0 0 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.5"
                className="text-foreground/5"
              />
            </pattern>
          </defs>
        )}
        {showGrid && (
          <rect
            x={viewBox.x - 1000}
            y={viewBox.y - 1000}
            width={viewBox.width + 2000}
            height={viewBox.height + 2000}
            fill="url(#grid)"
          />
        )}

        {/* Render content based on document type */}
        {document.type === 'flowchart' ? (
          <FlowchartRenderer content={document.content as FlowyFlowchart} />
        ) : (
          <MockupRenderer content={document.content as FlowyMockup} />
        )}
      </svg>
    </div>
  )
}

/**
 * DiagramRenderer - Memoized export for performance
 */
export const DiagramRenderer = React.memo(DiagramRendererComponent)

/**
 * Calculate viewBox for flowchart content
 */
function calculateFlowchartViewBox(content: FlowyFlowchart): { x: number; y: number; width: number; height: number } {
  if (content.nodes.length === 0) {
    return { x: 0, y: 0, width: 800, height: 600 }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const node of content.nodes) {
    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + node.size.width)
    maxY = Math.max(maxY, node.position.y + node.size.height)
  }

  const padding = 80
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  }
}

/**
 * Calculate viewBox for mockup content
 */
function calculateMockupViewBox(content: FlowyMockup): { x: number; y: number; width: number; height: number } {
  if (content.screens.length === 0) {
    return { x: 0, y: 0, width: 800, height: 600 }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const screen of content.screens) {
    const dims = DEVICE_DIMENSIONS[screen.device]
    minX = Math.min(minX, screen.position.x)
    minY = Math.min(minY, screen.position.y)
    maxX = Math.max(maxX, screen.position.x + dims.width)
    maxY = Math.max(maxY, screen.position.y + dims.height)
  }

  const padding = 80
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  }
}

/**
 * Flowchart renderer - renders nodes and edges
 */
const FlowchartRenderer = React.memo(function FlowchartRenderer({ content }: { content: FlowyFlowchart }) {
  return (
    <g>
      {/* Render edges first (below nodes) */}
      {content.edges.map((edge) => (
        <EdgeRenderer
          key={edge.id}
          edge={edge}
          nodes={content.nodes}
        />
      ))}
      {/* Render nodes */}
      {content.nodes.map((node) => (
        <NodeRenderer key={node.id} node={node} />
      ))}
    </g>
  )
})

/**
 * Node renderer - renders individual flowchart nodes
 */
const NodeRenderer = React.memo(function NodeRenderer({ node }: { node: FlowyNode }) {
  const style = { ...DEFAULT_NODE_STYLE, ...node.style }
  const { x, y } = node.position
  const { width, height } = node.size

  // Center position for text
  const centerX = x + width / 2
  const centerY = y + height / 2

  return (
    <g filter={style.shadow ? 'url(#shadow)' : undefined}>
      {/* Node shape */}
      {node.type === 'rect' && (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={style.cornerRadius}
          ry={style.cornerRadius}
          fill={style.fill}
          stroke={style.stroke}
          strokeWidth={style.strokeWidth}
          opacity={style.opacity}
        />
      )}
      {node.type === 'circle' && (
        <ellipse
          cx={centerX}
          cy={centerY}
          rx={width / 2}
          ry={height / 2}
          fill={style.fill}
          stroke={style.stroke}
          strokeWidth={style.strokeWidth}
          opacity={style.opacity}
        />
      )}
      {node.type === 'diamond' && (
        <polygon
          points={`${centerX},${y} ${x + width},${centerY} ${centerX},${y + height} ${x},${centerY}`}
          fill={style.fill}
          stroke={style.stroke}
          strokeWidth={style.strokeWidth}
          opacity={style.opacity}
        />
      )}

      {/* Node label */}
      <text
        x={centerX}
        y={centerY}
        textAnchor="middle"
        dominantBaseline="central"
        fill={style.font?.color ?? '#374151'}
        fontSize={style.font?.size ?? 13}
        fontWeight={style.font?.weight ?? 'normal'}
        fontFamily={style.font?.family ?? 'system-ui, -apple-system, sans-serif'}
        className="pointer-events-none"
      >
        {node.label}
      </text>
    </g>
  )
})

/**
 * Edge renderer - renders connections between nodes
 */
const EdgeRenderer = React.memo(function EdgeRenderer({ edge, nodes }: { edge: FlowyEdge; nodes: FlowyNode[] }) {
  const fromNode = nodes.find((n) => n.id === edge.from)
  const toNode = nodes.find((n) => n.id === edge.to)

  if (!fromNode || !toNode) return null

  const style = { ...DEFAULT_EDGE_STYLE, ...edge.style }

  // Calculate connection points (center-to-center with intersection at boundaries)
  const { startPoint, endPoint } = calculateEdgePoints(fromNode, toNode)

  // Build path
  let path: string
  if (edge.type === 'orthogonal') {
    // Orthogonal routing (right angles)
    const midX = (startPoint.x + endPoint.x) / 2
    path = `M ${startPoint.x} ${startPoint.y} H ${midX} V ${endPoint.y} H ${endPoint.x}`
  } else if (edge.type === 'curved' && edge.controlPoints?.length) {
    // Bezier curve with control points
    const cp = edge.controlPoints
    if (cp.length >= 2) {
      path = `M ${startPoint.x} ${startPoint.y} C ${cp[0].x} ${cp[0].y}, ${cp[1].x} ${cp[1].y}, ${endPoint.x} ${endPoint.y}`
    } else {
      path = `M ${startPoint.x} ${startPoint.y} Q ${cp[0].x} ${cp[0].y}, ${endPoint.x} ${endPoint.y}`
    }
  } else {
    // Straight line (default)
    path = `M ${startPoint.x} ${startPoint.y} L ${endPoint.x} ${endPoint.y}`
  }

  // Marker references
  const markerStart = style.markerStart && style.markerStart !== 'none'
    ? `url(#${style.markerStart === 'arrow' ? 'arrow' : style.markerStart === 'circle' ? 'circle-marker' : 'diamond-marker'})`
    : undefined
  const markerEnd = style.markerEnd && style.markerEnd !== 'none'
    ? `url(#${style.markerEnd === 'arrow' ? 'arrow' : style.markerEnd === 'circle' ? 'circle-marker' : 'diamond-marker'})`
    : undefined

  // Calculate label position (midpoint of the edge)
  const labelX = (startPoint.x + endPoint.x) / 2
  const labelY = (startPoint.y + endPoint.y) / 2 - 8

  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={style.stroke}
        strokeWidth={style.strokeWidth}
        strokeDasharray={edge.type === 'dashed' ? '6,4' : style.strokeDasharray}
        opacity={style.opacity}
        markerStart={markerStart}
        markerEnd={markerEnd}
      />
      {edge.label && (
        <text
          x={labelX}
          y={labelY}
          textAnchor="middle"
          fill="#64748b"
          fontSize={11}
          fontFamily="system-ui, -apple-system, sans-serif"
          className="pointer-events-none"
        >
          <tspan
            style={{
              background: 'white',
              padding: '2px 4px',
            }}
          >
            {edge.label}
          </tspan>
        </text>
      )}
    </g>
  )
})

/**
 * Calculate edge start/end points based on node boundaries
 */
function calculateEdgePoints(from: FlowyNode, to: FlowyNode) {
  const fromCenter = {
    x: from.position.x + from.size.width / 2,
    y: from.position.y + from.size.height / 2,
  }
  const toCenter = {
    x: to.position.x + to.size.width / 2,
    y: to.position.y + to.size.height / 2,
  }

  // Calculate intersection with node boundaries
  const startPoint = getNodeBoundaryPoint(from, fromCenter, toCenter)
  const endPoint = getNodeBoundaryPoint(to, toCenter, fromCenter)

  return { startPoint, endPoint }
}

/**
 * Get the point where a line from inside a node intersects its boundary
 */
function getNodeBoundaryPoint(
  node: FlowyNode,
  inside: { x: number; y: number },
  outside: { x: number; y: number }
) {
  const { x, y } = node.position
  const { width, height } = node.size

  if (node.type === 'circle') {
    // Ellipse intersection
    const rx = width / 2
    const ry = height / 2
    const dx = outside.x - inside.x
    const dy = outside.y - inside.y
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len === 0) return inside

    // Approximate intersection with ellipse
    const angle = Math.atan2(dy, dx)
    return {
      x: inside.x + rx * Math.cos(angle),
      y: inside.y + ry * Math.sin(angle),
    }
  }

  if (node.type === 'diamond') {
    // Diamond (rhombus) intersection - simplified to 4 edge midpoints
    const dx = outside.x - inside.x
    const dy = outside.y - inside.y
    const angle = Math.atan2(dy, dx)

    // Use dominant axis for intersection point
    if (Math.abs(dx) > Math.abs(dy)) {
      return {
        x: inside.x + (width / 2) * Math.sign(dx),
        y: inside.y,
      }
    } else {
      return {
        x: inside.x,
        y: inside.y + (height / 2) * Math.sign(dy),
      }
    }
  }

  // Rectangle intersection
  const dx = outside.x - inside.x
  const dy = outside.y - inside.y

  // Check which edge the line intersects
  const halfW = width / 2
  const halfH = height / 2

  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    return inside
  }

  // Calculate intersection with each edge
  const tRight = dx > 0 ? halfW / dx : Infinity
  const tLeft = dx < 0 ? -halfW / dx : Infinity
  const tBottom = dy > 0 ? halfH / dy : Infinity
  const tTop = dy < 0 ? -halfH / dy : Infinity

  const t = Math.min(tRight, tLeft, tBottom, tTop)

  return {
    x: inside.x + dx * t,
    y: inside.y + dy * t,
  }
}

/**
 * Mockup renderer - renders screens and their components
 */
const MockupRenderer = React.memo(function MockupRenderer({ content }: { content: FlowyMockup }) {
  return (
    <g>
      {/* Render connections first (below screens) */}
      {content.connections.map((conn) => (
        <MockupConnectionRenderer
          key={conn.id}
          connection={conn}
          screens={content.screens}
        />
      ))}
      {/* Render screens */}
      {content.screens.map((screen) => (
        <ScreenRenderer key={screen.id} screen={screen} />
      ))}
    </g>
  )
})

/**
 * Screen renderer - renders a device frame with components
 */
const ScreenRenderer = React.memo(function ScreenRenderer({ screen }: { screen: MockupScreen }) {
  const dims = DEVICE_DIMENSIONS[screen.device]
  const { x, y } = screen.position

  return (
    <g>
      {/* Device frame with shadow */}
      <rect
        x={x}
        y={y}
        width={dims.width}
        height={dims.height}
        rx={dims.cornerRadius}
        ry={dims.cornerRadius}
        fill={screen.backgroundColor ?? '#ffffff'}
        stroke="#e2e8f0"
        strokeWidth={2}
        filter="url(#shadow)"
      />

      {/* Status bar area */}
      <rect
        x={x}
        y={y}
        width={dims.width}
        height={dims.statusBarHeight}
        rx={dims.cornerRadius}
        ry={dims.cornerRadius}
        fill={screen.statusBarStyle === 'dark' ? '#1f2937' : '#f8fafc'}
      />
      <rect
        x={x}
        y={y + dims.statusBarHeight - dims.cornerRadius}
        width={dims.width}
        height={dims.cornerRadius}
        fill={screen.statusBarStyle === 'dark' ? '#1f2937' : '#f8fafc'}
      />

      {/* Screen title */}
      <text
        x={x + dims.width / 2}
        y={y - 16}
        textAnchor="middle"
        fill="#374151"
        fontSize={14}
        fontWeight="500"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {screen.title}
      </text>

      {/* Clip content to device bounds */}
      <clipPath id={`clip-${screen.id}`}>
        <rect
          x={x}
          y={y + dims.statusBarHeight}
          width={dims.width}
          height={dims.height - dims.statusBarHeight}
          rx={dims.cornerRadius / 2}
        />
      </clipPath>

      {/* Render components */}
      <g clipPath={`url(#clip-${screen.id})`}>
        {screen.components.map((component) => (
          <ComponentRenderer
            key={component.id}
            component={component}
            screenX={x}
            screenY={y}
          />
        ))}
      </g>
    </g>
  )
})

/**
 * Component renderer - renders individual UI components
 */
const ComponentRenderer = React.memo(function ComponentRenderer({
  component,
  screenX,
  screenY,
}: {
  component: MockupComponent
  screenX: number
  screenY: number
}) {
  const x = screenX + component.position.x
  const y = screenY + component.position.y
  const { width, height } = component.size
  const props = component.props

  switch (props.type) {
    case 'button':
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            rx={8}
            fill={props.variant === 'primary' ? '#3b82f6' : props.variant === 'destructive' ? '#ef4444' : '#f1f5f9'}
            stroke={props.variant === 'ghost' ? '#e2e8f0' : 'none'}
            opacity={props.disabled ? 0.5 : 1}
          />
          <text
            x={x + width / 2}
            y={y + height / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill={props.variant === 'primary' || props.variant === 'destructive' ? '#ffffff' : '#374151'}
            fontSize={14}
            fontWeight="500"
          >
            {props.label}
          </text>
        </g>
      )

    case 'text':
      return (
        <text
          x={x + (props.align === 'center' ? width / 2 : props.align === 'right' ? width : 0)}
          y={y + height / 2}
          textAnchor={props.align === 'center' ? 'middle' : props.align === 'right' ? 'end' : 'start'}
          dominantBaseline="central"
          fill={props.color ?? '#111827'}
          fontSize={props.variant === 'title' ? 28 : props.variant === 'headline' ? 20 : props.variant === 'caption' ? 12 : 14}
          fontWeight={props.variant === 'title' || props.variant === 'headline' ? '600' : '400'}
        >
          {props.content}
        </text>
      )

    case 'card':
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            rx={12}
            fill={props.variant === 'highlighted' ? '#eff6ff' : props.variant === 'error' ? '#fef2f2' : props.variant === 'success' ? '#f0fdf4' : '#ffffff'}
            stroke="#e2e8f0"
            strokeWidth={1}
          />
          {props.title && (
            <text
              x={x + 16}
              y={y + 24}
              fill="#111827"
              fontSize={16}
              fontWeight="600"
            >
              {props.title}
            </text>
          )}
          {props.subtitle && (
            <text
              x={x + 16}
              y={y + 44}
              fill="#6b7280"
              fontSize={13}
            >
              {props.subtitle}
            </text>
          )}
          {props.content && (
            <text
              x={x + 16}
              y={y + 68}
              fill="#374151"
              fontSize={14}
            >
              {props.content}
            </text>
          )}
        </g>
      )

    case 'navbar':
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            fill="#f8fafc"
          />
          <line
            x1={x}
            y1={y + height}
            x2={x + width}
            y2={y + height}
            stroke="#e2e8f0"
            strokeWidth={1}
          />
          {props.showBack && (
            <text
              x={x + 16}
              y={y + height / 2}
              dominantBaseline="central"
              fill="#3b82f6"
              fontSize={16}
            >
              ←
            </text>
          )}
          <text
            x={x + width / 2}
            y={y + height / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#111827"
            fontSize={17}
            fontWeight="600"
          >
            {props.title}
          </text>
        </g>
      )

    case 'textfield':
      return (
        <g>
          {props.label && (
            <text
              x={x}
              y={y - 6}
              fill="#374151"
              fontSize={13}
              fontWeight="500"
            >
              {props.label}
            </text>
          )}
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            rx={8}
            fill="#ffffff"
            stroke={props.variant === 'error' ? '#ef4444' : props.variant === 'success' ? '#22c55e' : '#d1d5db'}
            strokeWidth={1.5}
          />
          <text
            x={x + 12}
            y={y + height / 2}
            dominantBaseline="central"
            fill={props.value ? '#111827' : '#9ca3af'}
            fontSize={14}
          >
            {props.value || props.placeholder || ''}
          </text>
        </g>
      )

    case 'divider':
      return (
        <line
          x1={x + (props.variant === 'inset' ? 16 : 0)}
          y1={y}
          x2={x + width - (props.variant === 'inset' ? 16 : 0)}
          y2={y}
          stroke="#e5e7eb"
          strokeWidth={1}
        />
      )

    case 'badge':
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            rx={height / 2}
            fill={
              props.variant === 'success' ? '#dcfce7' :
              props.variant === 'warning' ? '#fef3c7' :
              props.variant === 'error' ? '#fee2e2' :
              props.variant === 'info' ? '#dbeafe' :
              '#f1f5f9'
            }
          />
          <text
            x={x + width / 2}
            y={y + height / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill={
              props.variant === 'success' ? '#166534' :
              props.variant === 'warning' ? '#92400e' :
              props.variant === 'error' ? '#991b1b' :
              props.variant === 'info' ? '#1e40af' :
              '#475569'
            }
            fontSize={11}
            fontWeight="500"
          >
            {props.label}
          </text>
        </g>
      )

    case 'toggle':
      const isOn = props.checked ?? false
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={51}
            height={31}
            rx={15.5}
            fill={isOn ? '#22c55e' : '#e5e7eb'}
          />
          <circle
            cx={x + (isOn ? 35 : 16)}
            cy={y + 15.5}
            r={13.5}
            fill="#ffffff"
            filter="url(#shadow)"
          />
          {props.label && (
            <text
              x={x + 60}
              y={y + 15.5}
              dominantBaseline="central"
              fill="#374151"
              fontSize={14}
            >
              {props.label}
            </text>
          )}
        </g>
      )

    case 'progress':
      const value = props.value ?? 0
      const max = props.max ?? 100
      const percent = Math.min(Math.max(value / max, 0), 1)

      if (props.variant === 'circle') {
        const radius = Math.min(width, height) / 2 - 4
        const circumference = 2 * Math.PI * radius
        const offset = circumference * (1 - percent)
        return (
          <g>
            <circle
              cx={x + width / 2}
              cy={y + height / 2}
              r={radius}
              fill="none"
              stroke="#e5e7eb"
              strokeWidth={4}
            />
            <circle
              cx={x + width / 2}
              cy={y + height / 2}
              r={radius}
              fill="none"
              stroke="#3b82f6"
              strokeWidth={4}
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform={`rotate(-90 ${x + width / 2} ${y + height / 2})`}
            />
            {props.showLabel && (
              <text
                x={x + width / 2}
                y={y + height / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#111827"
                fontSize={14}
                fontWeight="500"
              >
                {Math.round(percent * 100)}%
              </text>
            )}
          </g>
        )
      }

      // Bar progress
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            rx={height / 2}
            fill="#e5e7eb"
          />
          <rect
            x={x}
            y={y}
            width={width * percent}
            height={height}
            rx={height / 2}
            fill="#3b82f6"
          />
          {props.showLabel && (
            <text
              x={x + width + 8}
              y={y + height / 2}
              dominantBaseline="central"
              fill="#374151"
              fontSize={12}
            >
              {Math.round(percent * 100)}%
            </text>
          )}
        </g>
      )

    case 'image':
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            rx={props.placeholder === 'avatar' ? width / 2 : 8}
            fill="#f1f5f9"
            stroke="#e2e8f0"
            strokeWidth={1}
          />
          {/* Placeholder icon */}
          <text
            x={x + width / 2}
            y={y + height / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#94a3b8"
            fontSize={Math.min(width, height) / 3}
          >
            🖼
          </text>
        </g>
      )

    case 'list':
      const itemHeight = 56
      return (
        <g>
          {props.items.slice(0, Math.floor(height / itemHeight)).map((item, i) => (
            <g key={item.id}>
              <rect
                x={x + (props.variant === 'inset' ? 16 : 0)}
                y={y + i * itemHeight}
                width={width - (props.variant === 'inset' ? 32 : 0)}
                height={itemHeight}
                fill={item.selected ? '#eff6ff' : 'transparent'}
              />
              <text
                x={x + (props.variant === 'inset' ? 32 : 16)}
                y={y + i * itemHeight + 20}
                fill="#111827"
                fontSize={15}
              >
                {item.title}
              </text>
              {item.subtitle && (
                <text
                  x={x + (props.variant === 'inset' ? 32 : 16)}
                  y={y + i * itemHeight + 38}
                  fill="#6b7280"
                  fontSize={13}
                >
                  {item.subtitle}
                </text>
              )}
              {i < props.items.length - 1 && (
                <line
                  x1={x + (props.variant === 'inset' ? 32 : 16)}
                  y1={y + (i + 1) * itemHeight}
                  x2={x + width - 16}
                  y2={y + (i + 1) * itemHeight}
                  stroke="#e5e7eb"
                  strokeWidth={1}
                />
              )}
            </g>
          ))}
        </g>
      )

    default:
      // Fallback: render placeholder box
      return (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill="#f8fafc"
          stroke="#e2e8f0"
          strokeWidth={1}
          strokeDasharray="4,2"
        />
      )
  }
})

/**
 * Mockup connection renderer - renders connections between screens
 */
const MockupConnectionRenderer = React.memo(function MockupConnectionRenderer({
  connection,
  screens,
}: {
  connection: import('@vesper/shared/flowy').MockupConnection
  screens: MockupScreen[]
}) {
  const fromScreen = screens.find((s) => s.id === connection.from.screenId)
  const toScreen = screens.find((s) => s.id === connection.to.screenId)

  if (!fromScreen || !toScreen) return null

  const fromDims = DEVICE_DIMENSIONS[fromScreen.device]
  const toDims = DEVICE_DIMENSIONS[toScreen.device]

  // Calculate connection points (right side of from screen to left side of to screen)
  const startX = fromScreen.position.x + fromDims.width
  const startY = fromScreen.position.y + fromDims.height / 2
  const endX = toScreen.position.x
  const endY = toScreen.position.y + toDims.height / 2

  const midX = (startX + endX) / 2

  return (
    <g>
      <path
        d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
        fill="none"
        stroke="#94a3b8"
        strokeWidth={1.5}
        strokeDasharray={connection.type === 'dashed' ? '6,4' : undefined}
        markerEnd="url(#arrow)"
      />
      {connection.label && (
        <text
          x={midX}
          y={(startY + endY) / 2 - 8}
          textAnchor="middle"
          fill="#64748b"
          fontSize={11}
        >
          {connection.label}
        </text>
      )}
    </g>
  )
})
