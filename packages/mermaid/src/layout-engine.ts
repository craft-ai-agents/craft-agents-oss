/**
 * Layout engine for beautiful-mermaid (ELK.js based).
 *
 * Converts MermaidGraph to ELK's JSON format, runs layout, and converts
 * the result back to PositionedGraph. This is the core layout engine used
 * by all graph-based diagram types (flowcharts, state, ER, class).
 *
 * ELK (Eclipse Layout Kernel) features:
 *   - Native orthogonal edge routing (no post-processing needed)
 *   - Proper handling of compound nodes (subgraphs)
 *   - Support for disconnected graphs
 *   - Direction overrides per subgraph
 *   - Sophisticated algorithms for complex graphs
 *
 * Uses elk.bundled.js (pure synchronous JS, no WASM/Workers).
 * Safe for Electron, Node, and browser environments.
 */

import type { ElkNode, ElkExtendedEdge, LayoutOptions } from 'elkjs'
import type {
  MermaidGraph,
  MermaidSubgraph,
  MermaidEdge,
  PositionedGraph,
  PositionedNode,
  PositionedEdge,
  PositionedGroup,
  Point,
  RenderOptions,
} from './types.ts'
import { FONT_SIZES, FONT_WEIGHTS, NODE_PADDING, ARROW_HEAD } from './styles.ts'
import { measureMultilineText } from './text-metrics.ts'
import { getElk, elkLayoutSync, type ELKType } from './elk-instance.ts'
import { clipEdgeToShape } from './shape-clipping.ts'

// ============================================================================
// Layout options
// ============================================================================

/** Default render options (layout-only) */
const DEFAULTS: Required<Pick<RenderOptions, 'font' | 'padding' | 'nodeSpacing' | 'layerSpacing'>> = {
  font: 'Inter',
  padding: 40,
  nodeSpacing: 28,
  layerSpacing: 48,
}

/** Convert Mermaid direction to ELK direction */
function directionToElk(dir: MermaidGraph['direction']): string {
  switch (dir) {
    case 'LR': return 'RIGHT'
    case 'RL': return 'LEFT'
    case 'BT': return 'UP'
    case 'TD':
    case 'TB':
    default: return 'DOWN'
  }
}

// ============================================================================
// Node sizing (same logic as Dagre adapter)
// ============================================================================

function estimateNodeSize(id: string, label: string, shape: string): { width: number; height: number } {
  const metrics = measureMultilineText(label, FONT_SIZES.nodeLabel, FONT_WEIGHTS.nodeLabel)

  let width = metrics.width + NODE_PADDING.horizontal * 2
  let height = metrics.height + NODE_PADDING.vertical * 2

  if (shape === 'diamond') {
    const side = Math.max(width, height) + NODE_PADDING.diamondExtra
    width = side
    height = side
  }

  if (shape === 'circle' || shape === 'doublecircle') {
    const diameter = Math.ceil(Math.sqrt(width * width + height * height)) + 8
    width = shape === 'doublecircle' ? diameter + 12 : diameter
    height = width
  }

  if (shape === 'hexagon') {
    width += NODE_PADDING.horizontal
  }

  if (shape === 'trapezoid' || shape === 'trapezoid-alt') {
    width += NODE_PADDING.horizontal
  }

  if (shape === 'asymmetric') {
    width += 12
  }

  if (shape === 'cylinder') {
    height += 14
  }

  if (shape === 'state-start' || shape === 'state-end') {
    width = 28
    height = 28
  }

  width = Math.max(width, 60)
  height = Math.max(height, 36)

  return { width, height }
}

// ============================================================================
// Graph conversion: MermaidGraph → ELK JSON
// ============================================================================

interface ElkGraphNode extends ElkNode {
  children?: ElkGraphNode[]
  edges?: ElkExtendedEdge[]
}

/**
 * Tracks port-to-edge mappings for hierarchical port edges.
 * Used to combine external and internal edge sections during extraction.
 */
interface HierarchicalEdgeInfo {
  originalIndex: number
  externalEdgeId: string
  internalEdgeId: string
  subgraphId: string
  direction: 'incoming' | 'outgoing'
}

/**
 * Convert a MermaidGraph to ELK's nested JSON input format.
 *
 * Uses SEPARATE hierarchy handling for proper subgraph direction override support.
 * Cross-hierarchy edges use hierarchical ports to connect external and internal sections.
 */
function mermaidToElk(
  graph: MermaidGraph,
  opts: Required<Pick<RenderOptions, 'font' | 'padding' | 'nodeSpacing' | 'layerSpacing'>>
): ElkGraphNode {
  // Collect all node IDs that belong to subgraphs
  const subgraphNodeIds = new Set<string>()
  const subgraphIds = new Set<string>()
  for (const sg of graph.subgraphs) {
    subgraphIds.add(sg.id)
    collectSubgraphNodeIds(sg, subgraphNodeIds, subgraphIds)
  }

  // Build node-to-subgraph mapping for edge distribution
  const nodeToSubgraph = buildNodeToSubgraphMap(graph.subgraphs)

  // Classify edges into three categories:
  // 1. Internal edges (both endpoints in same subgraph)
  // 2. Root-level edges (neither endpoint in a subgraph)
  // 3. Cross-hierarchy edges (endpoints in different levels)
  const edgesBySubgraph = new Map<string | null, Array<{ index: number; edge: typeof graph.edges[0] }>>()
  edgesBySubgraph.set(null, []) // Root-level edges

  // Track cross-hierarchy edges for hierarchical port creation
  const crossHierarchyEdges: Array<{
    index: number
    edge: typeof graph.edges[0]
    sourceSubgraph: string | undefined
    targetSubgraph: string | undefined
  }> = []

  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i]!
    const sourceSubgraph = nodeToSubgraph.get(edge.source)
    const targetSubgraph = nodeToSubgraph.get(edge.target)

    if (sourceSubgraph && sourceSubgraph === targetSubgraph) {
      // Internal edge: both endpoints in same subgraph
      if (!edgesBySubgraph.has(sourceSubgraph)) {
        edgesBySubgraph.set(sourceSubgraph, [])
      }
      edgesBySubgraph.get(sourceSubgraph)!.push({ index: i, edge })
    } else if (!sourceSubgraph && !targetSubgraph) {
      // Root-level edge: neither endpoint in a subgraph
      edgesBySubgraph.get(null)!.push({ index: i, edge })
    } else {
      // Cross-hierarchy edge: need hierarchical ports
      crossHierarchyEdges.push({ index: i, edge, sourceSubgraph, targetSubgraph })
    }
  }

  // Determine if we need SEPARATE hierarchy handling
  // We use SEPARATE when any subgraph has a direction override
  const hasDirectionOverride = graph.subgraphs.some(sg => sg.direction !== undefined)

  // Build the root ELK graph
  const elkGraph: ElkGraphNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': directionToElk(graph.direction),
      'elk.spacing.nodeNode': String(opts.nodeSpacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(opts.layerSpacing),
      'elk.padding': `[top=${opts.padding},left=${opts.padding},bottom=${opts.padding},right=${opts.padding}]`,
      'elk.edgeRouting': 'ORTHOGONAL',
      // Use SEPARATE when subgraphs have direction overrides (enables proper direction handling)
      // Use INCLUDE_CHILDREN otherwise (simpler cross-hierarchy edge routing)
      'elk.hierarchyHandling': hasDirectionOverride ? 'SEPARATE' : 'INCLUDE_CHILDREN',
    },
    children: [],
    edges: [],
  }

  // Track hierarchical ports per subgraph for cross-hierarchy edges
  const subgraphPorts = new Map<string, Array<{
    portId: string
    edgeIndex: number
    direction: 'incoming' | 'outgoing'
    internalNodeId: string
  }>>()

  // Process cross-hierarchy edges to create port entries
  if (hasDirectionOverride) {
    for (const { index, edge, sourceSubgraph, targetSubgraph } of crossHierarchyEdges) {
      // Handle outgoing edges from subgraph
      if (sourceSubgraph) {
        const portId = `${sourceSubgraph}_out_${index}`
        if (!subgraphPorts.has(sourceSubgraph)) {
          subgraphPorts.set(sourceSubgraph, [])
        }
        subgraphPorts.get(sourceSubgraph)!.push({
          portId,
          edgeIndex: index,
          direction: 'outgoing',
          internalNodeId: edge.source,
        })
      }

      // Handle incoming edges to subgraph
      if (targetSubgraph) {
        const portId = `${targetSubgraph}_in_${index}`
        if (!subgraphPorts.has(targetSubgraph)) {
          subgraphPorts.set(targetSubgraph, [])
        }
        subgraphPorts.get(targetSubgraph)!.push({
          portId,
          edgeIndex: index,
          direction: 'incoming',
          internalNodeId: edge.target,
        })
      }
    }
  }

  // Add top-level nodes (those not in any subgraph)
  for (const [id, node] of graph.nodes) {
    if (!subgraphNodeIds.has(id) && !subgraphIds.has(id)) {
      const size = estimateNodeSize(id, node.label, node.shape)
      elkGraph.children!.push({
        id,
        width: size.width,
        height: size.height,
        labels: [{ text: node.label }],
      })
    }
  }

  // Add subgraphs as compound nodes with children and their internal edges
  for (const sg of graph.subgraphs) {
    elkGraph.children!.push(subgraphToElk(sg, graph, opts, edgesBySubgraph, subgraphPorts))
  }

  // Add root-level edges
  for (const { index, edge } of edgesBySubgraph.get(null)!) {
    const elkEdge: ElkExtendedEdge = {
      id: `e${index}`,
      sources: [edge.source],
      targets: [edge.target],
    }
    if (edge.label) {
      const metrics = measureMultilineText(edge.label, FONT_SIZES.edgeLabel, FONT_WEIGHTS.edgeLabel)
      elkEdge.labels = [{
        text: edge.label,
        width: metrics.width + 8,
        height: metrics.height + 6,
        layoutOptions: {
          'elk.edgeLabels.inline': 'true',
          'elk.edgeLabels.placement': 'CENTER',
        },
      }]
    }
    elkGraph.edges!.push(elkEdge)
  }

  // Add cross-hierarchy edges (using ports when SEPARATE, direct when INCLUDE_CHILDREN)
  for (const { index, edge, sourceSubgraph, targetSubgraph } of crossHierarchyEdges) {
    const elkEdge: ElkExtendedEdge = {
      id: `e${index}`,
      sources: hasDirectionOverride && sourceSubgraph ? [`${sourceSubgraph}_out_${index}`] : [edge.source],
      targets: hasDirectionOverride && targetSubgraph ? [`${targetSubgraph}_in_${index}`] : [edge.target],
    }
    if (edge.label) {
      const metrics = measureMultilineText(edge.label, FONT_SIZES.edgeLabel, FONT_WEIGHTS.edgeLabel)
      elkEdge.labels = [{
        text: edge.label,
        width: metrics.width + 8,
        height: metrics.height + 6,
        layoutOptions: {
          'elk.edgeLabels.inline': 'true',
          'elk.edgeLabels.placement': 'CENTER',
        },
      }]
    }
    elkGraph.edges!.push(elkEdge)
  }

  return elkGraph
}

/**
 * Convert a MermaidSubgraph to an ELK compound node.
 * Includes internal edges (edges where both endpoints are in this subgraph)
 * so that the subgraph's direction override is respected by ELK.
 *
 * When using SEPARATE hierarchy handling (for direction override support),
 * also adds hierarchical ports for cross-hierarchy edges.
 */
function subgraphToElk(
  sg: MermaidSubgraph,
  graph: MermaidGraph,
  opts: Required<Pick<RenderOptions, 'font' | 'padding' | 'nodeSpacing' | 'layerSpacing'>>,
  edgesBySubgraph: Map<string | null, Array<{ index: number; edge: MermaidEdge }>>,
  subgraphPorts: Map<string, Array<{
    portId: string
    edgeIndex: number
    direction: 'incoming' | 'outgoing'
    internalNodeId: string
  }>>
): ElkGraphNode {
  const layoutOptions: LayoutOptions = {
    'elk.algorithm': 'layered',
    'elk.padding': '[top=44,left=16,bottom=16,right=16]', // Top = headerHeight(28) + gap(16) to match bottom padding
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.layered.spacing.nodeNodeBetweenLayers': String(opts.layerSpacing),
    'elk.spacing.nodeNode': String(opts.nodeSpacing),
  }

  // Apply direction override if specified
  if (sg.direction) {
    layoutOptions['elk.direction'] = directionToElk(sg.direction)
  }

  const elkNode: ElkGraphNode = {
    id: sg.id,
    layoutOptions,
    labels: sg.label ? [{ text: sg.label }] : undefined,
    children: [],
    edges: [],
  }

  // Add hierarchical ports for cross-hierarchy edges (when using SEPARATE)
  const ports = subgraphPorts.get(sg.id) ?? []
  if (ports.length > 0) {
    // ELK supports ports but types don't include it
    (elkNode as unknown as Record<string, unknown>).ports = ports.map(p => ({
      id: p.portId,
      // Port side is determined by ELK based on edge direction
    }))
  }

  // Add direct child nodes
  for (const nodeId of sg.nodeIds) {
    const node = graph.nodes.get(nodeId)
    if (node) {
      const size = estimateNodeSize(nodeId, node.label, node.shape)
      elkNode.children!.push({
        id: nodeId,
        width: size.width,
        height: size.height,
        labels: [{ text: node.label }],
      })
    }
  }

  // Add nested subgraphs recursively
  for (const child of sg.children) {
    elkNode.children!.push(subgraphToElk(child, graph, opts, edgesBySubgraph, subgraphPorts))
  }

  // Add internal edges (edges where both endpoints are in this subgraph)
  const internalEdges = edgesBySubgraph.get(sg.id) ?? []
  for (const { index, edge } of internalEdges) {
    const elkEdge: ElkExtendedEdge = {
      id: `e${index}`,
      sources: [edge.source],
      targets: [edge.target],
    }
    if (edge.label) {
      const metrics = measureMultilineText(edge.label, FONT_SIZES.edgeLabel, FONT_WEIGHTS.edgeLabel)
      elkEdge.labels = [{
        text: edge.label,
        width: metrics.width + 8,
        height: metrics.height + 6,
        layoutOptions: {
          'elk.edgeLabels.inline': 'true',
          'elk.edgeLabels.placement': 'CENTER',
        },
      }]
    }
    elkNode.edges!.push(elkEdge)
  }

  // Add internal edge segments for hierarchical ports (port → node or node → port)
  // These connect the boundary ports to actual internal nodes
  for (const port of ports) {
    const internalEdgeId = `e${port.edgeIndex}_internal`
    const elkEdge: ElkExtendedEdge = port.direction === 'incoming'
      ? { id: internalEdgeId, sources: [port.portId], targets: [port.internalNodeId] }
      : { id: internalEdgeId, sources: [port.internalNodeId], targets: [port.portId] }
    elkNode.edges!.push(elkEdge)
  }

  return elkNode
}

/** Recursively collect all node IDs that belong to any subgraph */
function collectSubgraphNodeIds(sg: MermaidSubgraph, nodeIds: Set<string>, subgraphIds: Set<string>): void {
  for (const id of sg.nodeIds) {
    nodeIds.add(id)
  }
  for (const child of sg.children) {
    subgraphIds.add(child.id)
    collectSubgraphNodeIds(child, nodeIds, subgraphIds)
  }
}

/**
 * Build a mapping from node ID to its containing subgraph ID.
 * For nested subgraphs, maps to the innermost containing subgraph.
 * Nodes not in any subgraph are not included in the map.
 */
function buildNodeToSubgraphMap(subgraphs: MermaidSubgraph[]): Map<string, string> {
  const map = new Map<string, string>()

  function traverse(sg: MermaidSubgraph): void {
    // Map all direct child nodes to this subgraph
    for (const nodeId of sg.nodeIds) {
      map.set(nodeId, sg.id)
    }
    // Recursively process nested subgraphs (they override parent mapping)
    for (const child of sg.children) {
      traverse(child)
    }
  }

  for (const sg of subgraphs) {
    traverse(sg)
  }

  return map
}

// ============================================================================
// Result conversion: ELK output → PositionedGraph
// ============================================================================

/**
 * Convert ELK layout result to our PositionedGraph format.
 */
/** Margin routing info for cross-hierarchy edges */
interface MarginInfo {
  leftX: number
  rightX: number
}

/** Recursively flatten all group bounding boxes (including nested children) */
function flattenGroupBounds(groups: PositionedGroup[]): Array<{ x: number; y: number; right: number; bottom: number }> {
  const bounds: Array<{ x: number; y: number; right: number; bottom: number }> = []
  for (const g of groups) {
    bounds.push({ x: g.x, y: g.y, right: g.x + g.width, bottom: g.y + g.height })
    bounds.push(...flattenGroupBounds(g.children))
  }
  return bounds
}

function elkToPositioned(
  elkResult: ElkNode,
  graph: MermaidGraph
): PositionedGraph {
  const nodes: PositionedNode[] = []
  const edges: PositionedEdge[] = []
  const groups: PositionedGroup[] = []

  // Build set of subgraph IDs for distinguishing compound nodes from leaf nodes
  const subgraphIds = new Set<string>()
  for (const sg of graph.subgraphs) {
    collectAllSubgraphIds(sg, subgraphIds)
  }

  // Extract nodes and groups recursively
  extractNodesAndGroups(elkResult, graph, subgraphIds, nodes, groups, 0, 0)

  // Compute margin positions for cross-hierarchy edge routing.
  // Margins sit outside all group bounding boxes so edges don't cross through subgraphs.
  const allBounds = flattenGroupBounds(groups)
  const margins: MarginInfo | undefined = allBounds.length > 0
    ? {
        leftX: Math.min(...allBounds.map(b => b.x)) - 20,
        rightX: Math.max(...allBounds.map(b => b.right)) + 20,
      }
    : undefined

  // Extract edges recursively from all levels (root and subgraphs)
  // Edges are distributed to subgraphs for direction override to work,
  // so we need to collect them from all children with proper offsets
  extractEdgesRecursively(elkResult, graph, edges, 0, 0, margins)

  // Apply shape-aware edge clipping for non-rectangular shapes.
  // ELK treats all nodes as rectangles, so we need to clip edge endpoints
  // to the actual shape boundaries (e.g., diamond vertices).
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  for (const edge of edges) {
    const sourceNode = nodeMap.get(edge.source)
    const targetNode = nodeMap.get(edge.target)

    if (sourceNode) {
      edge.points = clipEdgeToShape(edge.points, sourceNode, true)
    }
    if (targetNode) {
      edge.points = clipEdgeToShape(edge.points, targetNode, false)
    }
  }

  // Calculate final bounds including all edge points
  // ELK should include edges in its dimensions, but we verify and expand if needed
  let width = elkResult.width ?? 800
  let height = elkResult.height ?? 600
  const arrowMargin = ARROW_HEAD.width
  const padding = DEFAULTS.padding

  for (const edge of edges) {
    for (const p of edge.points) {
      width = Math.max(width, p.x + arrowMargin + padding)
      height = Math.max(height, p.y + arrowMargin + padding)
    }
    if (edge.labelPosition) {
      width = Math.max(width, edge.labelPosition.x + 60 + padding)
      height = Math.max(height, edge.labelPosition.y + 20 + padding)
    }
  }

  return {
    width,
    height,
    nodes,
    edges,
    groups,
  }
}

/**
 * Recursively extract positioned nodes and groups from ELK result.
 */
function extractNodesAndGroups(
  elkNode: ElkNode,
  graph: MermaidGraph,
  subgraphIds: Set<string>,
  nodes: PositionedNode[],
  groups: PositionedGroup[],
  offsetX: number,
  offsetY: number
): void {
  if (!elkNode.children) return

  for (const child of elkNode.children) {
    const x = (child.x ?? 0) + offsetX
    const y = (child.y ?? 0) + offsetY
    const width = child.width ?? 0
    const height = child.height ?? 0

    if (subgraphIds.has(child.id)) {
      // This is a subgraph/group
      const childGroups: PositionedGroup[] = []

      // Recursively process children
      extractNodesAndGroups(child, graph, subgraphIds, nodes, childGroups, x, y)

      const mermaidSg = findSubgraph(graph.subgraphs, child.id)
      groups.push({
        id: child.id,
        label: mermaidSg?.label ?? '',
        x,
        y,
        width,
        height,
        children: childGroups,
      })
    } else {
      // This is a leaf node
      const mNode = graph.nodes.get(child.id)
      if (mNode) {
        // Resolve inline styles from nodeStyles map and classDefs
        const inlineStyle = resolveNodeStyle(child.id, graph)

        nodes.push({
          id: child.id,
          label: mNode.label,
          shape: mNode.shape,
          x,
          y,
          width,
          height,
          inlineStyle,
        })
      }

      // Also check for nested children (shouldn't happen for leaf nodes, but be safe)
      if (child.children && child.children.length > 0) {
        extractNodesAndGroups(child, graph, subgraphIds, nodes, groups, x, y)
      }
    }
  }
}

/**
 * Edge segment extracted from ELK result.
 * Used to combine external and internal segments of hierarchical edges.
 */
interface EdgeSegment {
  edgeIndex: number
  isInternal: boolean  // true for port-to-node segments (e.g., "e3_internal")
  points: Point[]
  labelPosition?: Point
}

/**
 * Calculate the midpoint along a polyline path.
 * Walks the path to find the point at half the total length.
 */
function calculatePathMidpoint(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]!

  // Calculate total length
  let totalLength = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]!.x - points[i - 1]!.x
    const dy = points[i]!.y - points[i - 1]!.y
    totalLength += Math.sqrt(dx * dx + dy * dy)
  }

  // Walk to halfway point
  let remaining = totalLength / 2
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]!.x - points[i - 1]!.x
    const dy = points[i]!.y - points[i - 1]!.y
    const segLen = Math.sqrt(dx * dx + dy * dy)
    if (remaining <= segLen) {
      const t = remaining / segLen
      return {
        x: points[i - 1]!.x + t * dx,
        y: points[i - 1]!.y + t * dy,
      }
    }
    remaining -= segLen
  }

  return points[points.length - 1]!
}

/**
 * Recursively extract edges from ELK result including those inside subgraphs.
 * Edges are distributed to subgraphs for direction override to work,
 * so we need to collect them from all levels with proper coordinate offsets.
 *
 * For hierarchical edges (cross-hierarchy with ports), combines external and
 * internal segments into a single continuous edge path.
 */
function extractEdgesRecursively(
  elkNode: ElkNode,
  graph: MermaidGraph,
  edges: PositionedEdge[],
  offsetX: number,
  offsetY: number,
  margins?: MarginInfo
): void {
  // First pass: collect all edge segments
  const segments = new Map<number, { external?: EdgeSegment; incoming?: EdgeSegment; outgoing?: EdgeSegment }>()
  collectEdgeSegments(elkNode, segments, 0, 0)

  // Track margin-routed edge count for spacing offsets
  let marginEdgeIndex = 0

  // Second pass: combine segments and create positioned edges
  for (const [edgeIndex, seg] of segments) {
    const originalEdge = graph.edges[edgeIndex]
    if (!originalEdge) continue

    // Combine points from all segments in correct order:
    // - For incoming cross-hierarchy (external → subgraph): external then incoming
    // - For outgoing cross-hierarchy (subgraph → external): outgoing then external
    // - For both (subgraph A → subgraph B): outgoing → external → incoming
    const allPoints: Point[] = []

    // First: outgoing internal segment (source node → exit port)
    if (seg.outgoing && seg.outgoing.points.length > 0) {
      allPoints.push(...seg.outgoing.points)
    }

    // Second: external segment (exit port → entry port, or source → entry port, or exit port → target)
    if (seg.external && seg.external.points.length > 0) {
      if (allPoints.length > 0) {
        // Skip first point to avoid duplicate at outgoing port
        allPoints.push(...seg.external.points.slice(1))
      } else {
        allPoints.push(...seg.external.points)
      }
    }

    // Third: incoming internal segment (entry port → target node)
    if (seg.incoming && seg.incoming.points.length > 0) {
      if (allPoints.length > 0) {
        // Skip first point to avoid duplicate at incoming port
        allPoints.push(...seg.incoming.points.slice(1))
      } else {
        allPoints.push(...seg.incoming.points)
      }
    }

    // Label position: use ELK's inline label position (on-edge with collision avoidance)
    // Fall back to midpoint for hierarchical edges or when ELK position unavailable
    let labelPosition: Point | undefined
    if (originalEdge.label && allPoints.length >= 2) {
      const elkLabelPos = seg.external?.labelPosition
      labelPosition = elkLabelPos ?? calculatePathMidpoint(allPoints)
    }

    // Ensure all edge segments are orthogonal (horizontal or vertical only).
    // In SEPARATE hierarchy mode, ELK may produce diagonal segments for
    // cross-hierarchy edges where it only returns start/end points without
    // proper orthogonal bend points.
    // When margins are available, route through the diagram margins instead
    // of Z-paths through the middle (which cross through subgraphs).
    const orthogonalPoints = orthogonalizeEdgePoints(allPoints, margins, marginEdgeIndex)
    if (orthogonalPoints !== allPoints) {
      marginEdgeIndex++
    }

    // Recalculate label position for margin-routed edges
    if (originalEdge.label && orthogonalPoints !== allPoints && orthogonalPoints.length >= 2) {
      labelPosition = calculatePathMidpoint(orthogonalPoints)
    }

    edges.push({
      source: originalEdge.source,
      target: originalEdge.target,
      label: originalEdge.label,
      style: originalEdge.style,
      hasArrowStart: originalEdge.hasArrowStart,
      hasArrowEnd: originalEdge.hasArrowEnd,
      points: orthogonalPoints,
      labelPosition,
    })
  }
}

/**
 * Post-process edge points to ensure all segments are purely orthogonal.
 *
 * When ELK uses SEPARATE hierarchy handling (required for subgraph direction
 * overrides), cross-hierarchy edges may only get start/end coordinates without
 * intermediate bend points, producing diagonal lines.
 *
 * When margins are provided, routes diagonal segments through the left or right
 * margin of the diagram (outside all subgraphs). Alternates sides and adds
 * spacing offsets to prevent overlapping parallel edges.
 *
 * Without margins, falls back to Z-path through the vertical midpoint.
 *
 * Returns the original array reference (identity) if no changes were needed,
 * so callers can detect whether routing was applied.
 */
function orthogonalizeEdgePoints(
  points: Point[],
  margins?: MarginInfo,
  edgeIndex: number = 0
): Point[] {
  if (points.length < 2) return points

  // Check if any segment needs orthogonalization
  let needsWork = false
  for (let i = 1; i < points.length; i++) {
    const dx = Math.abs(points[i]!.x - points[i - 1]!.x)
    const dy = Math.abs(points[i]!.y - points[i - 1]!.y)
    if (dx > 1 && dy > 1) { needsWork = true; break }
  }
  if (!needsWork) return points

  const EDGE_SPACING = 12
  const result: Point[] = [points[0]!]

  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1]!
    const curr = points[i]!
    const dx = Math.abs(curr.x - prev.x)
    const dy = Math.abs(curr.y - prev.y)

    if (dx > 1 && dy > 1) {
      if (margins) {
        // Margin routing: exit horizontally → travel vertically along margin → enter horizontally
        // Alternate left/right margins and offset for parallel edge spacing
        const useRight = edgeIndex % 2 === 0
        const offset = Math.floor(edgeIndex / 2) * EDGE_SPACING
        const marginX = useRight
          ? margins.rightX + offset
          : margins.leftX - offset

        result.push({ x: marginX, y: prev.y })
        result.push({ x: marginX, y: curr.y })
      } else {
        // Fallback: Z-path through vertical midpoint
        const midY = (prev.y + curr.y) / 2
        result.push({ x: prev.x, y: midY })
        result.push({ x: curr.x, y: midY })
      }
    }

    result.push(curr)
  }

  return result
}

/**
 * Recursively collect edge segments from ELK result.
 */
function collectEdgeSegments(
  elkNode: ElkNode,
  segments: Map<number, { external?: EdgeSegment; incoming?: EdgeSegment; outgoing?: EdgeSegment }>,
  offsetX: number,
  offsetY: number
): void {
  if (elkNode.edges) {
    for (const elkEdge of elkNode.edges) {
      // Parse edge ID: "e{index}" or "e{index}_internal"
      const isInternal = elkEdge.id.endsWith('_internal')
      const edgeIndex = parseInt(elkEdge.id.substring(1), 10)
      if (isNaN(edgeIndex)) continue

      // Extract points
      const points: Point[] = []
      if (elkEdge.sections && elkEdge.sections.length > 0) {
        const section = elkEdge.sections[0]!
        points.push({
          x: section.startPoint.x + offsetX,
          y: section.startPoint.y + offsetY,
        })
        if (section.bendPoints) {
          for (const bp of section.bendPoints) {
            points.push({ x: bp.x + offsetX, y: bp.y + offsetY })
          }
        }
        points.push({
          x: section.endPoint.x + offsetX,
          y: section.endPoint.y + offsetY,
        })
      }

      // Extract label position
      let labelPosition: Point | undefined
      if (elkEdge.labels && elkEdge.labels.length > 0) {
        const label = elkEdge.labels[0]!
        if (label.x != null && label.y != null) {
          labelPosition = {
            x: label.x + (label.width ?? 0) / 2 + offsetX,
            y: label.y + (label.height ?? 0) / 2 + offsetY,
          }
        }
      }

      // Store segment
      if (!segments.has(edgeIndex)) {
        segments.set(edgeIndex, {})
      }
      const seg = segments.get(edgeIndex)!

      if (isInternal) {
        // Determine if this is an incoming or outgoing internal segment
        // by checking if source is a port (incoming) or target is a port (outgoing)
        const source = elkEdge.sources?.[0] ?? ''
        const target = elkEdge.targets?.[0] ?? ''
        const sourceIsPort = source.includes('_in_') || source.includes('_out_')
        const targetIsPort = target.includes('_in_') || target.includes('_out_')

        if (sourceIsPort) {
          // Port → node: incoming internal segment
          seg.incoming = { edgeIndex, isInternal, points, labelPosition }
        } else if (targetIsPort) {
          // Node → port: outgoing internal segment
          seg.outgoing = { edgeIndex, isInternal, points, labelPosition }
        }
      } else {
        seg.external = { edgeIndex, isInternal, points, labelPosition }
      }
    }
  }

  // Recurse into children with accumulated offset
  if (elkNode.children) {
    for (const child of elkNode.children) {
      collectEdgeSegments(child, segments, offsetX + (child.x ?? 0), offsetY + (child.y ?? 0))
    }
  }
}

/** Find a subgraph by ID in a nested structure */
function findSubgraph(subgraphs: MermaidSubgraph[], id: string): MermaidSubgraph | undefined {
  for (const sg of subgraphs) {
    if (sg.id === id) return sg
    const found = findSubgraph(sg.children, id)
    if (found) return found
  }
  return undefined
}

/** Recursively collect all subgraph IDs */
function collectAllSubgraphIds(sg: MermaidSubgraph, out: Set<string>): void {
  out.add(sg.id)
  for (const child of sg.children) {
    collectAllSubgraphIds(child, out)
  }
}

/**
 * Resolve inline styles for a node from classDefs and nodeStyles.
 * Class styles are applied first, then explicit style directives override.
 */
function resolveNodeStyle(
  nodeId: string,
  graph: MermaidGraph
): Record<string, string> | undefined {
  let result: Record<string, string> | undefined

  // First, apply class styles (if node has a class assignment)
  const className = graph.classAssignments.get(nodeId)
  if (className) {
    const classDef = graph.classDefs.get(className)
    if (classDef) {
      result = { ...classDef }
    }
  }

  // Then, apply explicit style directives (override class styles)
  const nodeStyle = graph.nodeStyles.get(nodeId)
  if (nodeStyle) {
    result = result ? { ...result, ...nodeStyle } : { ...nodeStyle }
  }

  return result
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Lay out a parsed MermaidGraph using ELK.js.
 * Returns a fully positioned graph ready for rendering.
 *
 * This is the main layout function for all graph-based diagrams.
 */
export async function layoutGraph(
  graph: MermaidGraph,
  options: RenderOptions = {}
): Promise<PositionedGraph> {
  const opts = { ...DEFAULTS, ...options }

  // Get or initialize ELK instance
  // Synchronous in Electron/browser (elk.bundled.js), async in Bun (Worker)
  const elkInstance = await getElk()

  // Convert to ELK format
  const elkGraph = mermaidToElk(graph, opts)

  // Run ELK layout (async)
  const result = await elkInstance.layout(elkGraph)

  // Convert back to PositionedGraph
  return elkToPositioned(result, graph)
}

/**
 * Lay out a parsed MermaidGraph synchronously.
 * Uses elkLayoutSync() to bypass ELK's setTimeout(0) wrapper.
 */
export function layoutGraphSync(
  graph: MermaidGraph,
  options: RenderOptions = {}
): PositionedGraph {
  const opts = { ...DEFAULTS, ...options }
  const elkGraph = mermaidToElk(graph, opts)
  const result = elkLayoutSync(elkGraph)
  return elkToPositioned(result, graph)
}

/**
 * Get the ELK instance for direct benchmarking.
 * Allows measuring raw ELK layout time without conversion overhead.
 */
export async function getElkInstance(): Promise<ELKType> {
  return getElk()
}

/**
 * Convert MermaidGraph to ELK format (for benchmarking conversion overhead).
 */
export function convertToElkFormat(
  graph: MermaidGraph,
  options: RenderOptions = {}
): ElkNode {
  const opts = { ...DEFAULTS, ...options }
  return mermaidToElk(graph, opts)
}
