// @ts-expect-error — dagre types are declared for the package root, not the dist path;
// importing the pre-built browser bundle avoids Bun.build hanging on 30+ CJS file resolution
import dagre from '@dagrejs/dagre/dist/dagre.js'
import type { ClassDiagram, ClassNode, ClassMember, PositionedClassDiagram, PositionedClassNode, PositionedClassRelationship } from './types.ts'
import type { RenderOptions } from '../types.ts'
import { estimateTextWidth, estimateMonoTextWidth, FONT_SIZES, FONT_WEIGHTS } from '../styles.ts'
import { centerToTopLeft, snapToOrthogonal, clipEndpointsToNodes } from '../dagre-adapter.ts'

// ============================================================================
// Class diagram layout engine
//
// Uses dagre for positioning class boxes, then sizes each box based on
// the number of attributes and methods it contains.
//
// Each class box has 3 compartments:
//   1. Header (class name + optional annotation)
//   2. Attributes section
//   3. Methods section
// ============================================================================

/** Layout constants for class diagrams */
export const CLS = {
  /** Padding around the diagram */
  padding: 40,
  /** Horizontal padding inside class boxes — used by both layout and renderer */
  boxPadX: 8,
  /** Header height (class name + annotation) */
  headerBaseHeight: 32,
  /** Extra height when annotation is present */
  annotationHeight: 16,
  /** Height per member row (attribute or method) */
  memberRowHeight: 20,
  /** Vertical padding around member sections (4px top + 4px bottom) */
  sectionPadY: 8,
  /** Minimum empty section height (when no attrs or no methods) */
  emptySectionHeight: 8,
  /** Minimum box width */
  minWidth: 120,
  /** Font size for member text */
  memberFontSize: 11,
  /** Font weight for member text */
  memberFontWeight: 400,
  /** Spacing between class nodes */
  nodeSpacing: 40,
  /** Spacing between layers */
  layerSpacing: 60,
} as const

/**
 * Lay out a parsed class diagram using dagre.
 * Returns positioned class nodes and relationship paths.
 *
 * Kept async for API compatibility — dagre itself is synchronous.
 */
export async function layoutClassDiagram(
  diagram: ClassDiagram,
  _options: RenderOptions = {}
): Promise<PositionedClassDiagram> {
  if (diagram.classes.length === 0) {
    return { width: 0, height: 0, classes: [], relationships: [] }
  }

  // 1. Calculate box dimensions for each class
  const classSizes = new Map<string, { width: number; height: number; headerHeight: number; attrHeight: number; methodHeight: number }>()

  for (const cls of diagram.classes) {
    const headerHeight = cls.annotation
      ? CLS.headerBaseHeight + CLS.annotationHeight
      : CLS.headerBaseHeight

    const attrHeight = cls.attributes.length > 0
      ? cls.attributes.length * CLS.memberRowHeight + CLS.sectionPadY
      : CLS.emptySectionHeight

    const methodHeight = cls.methods.length > 0
      ? cls.methods.length * CLS.memberRowHeight + CLS.sectionPadY
      : CLS.emptySectionHeight

    // Width: max of header text, widest attribute, widest method
    const headerTextW = estimateTextWidth(cls.label, FONT_SIZES.nodeLabel, FONT_WEIGHTS.nodeLabel)
    const maxAttrW = maxMemberWidth(cls.attributes)
    const maxMethodW = maxMemberWidth(cls.methods)
    const width = Math.max(CLS.minWidth, headerTextW + CLS.boxPadX * 2, maxAttrW + CLS.boxPadX * 2, maxMethodW + CLS.boxPadX * 2)

    const height = headerHeight + attrHeight + methodHeight

    classSizes.set(cls.id, { width, height, headerHeight, attrHeight, methodHeight })
  }

  // 2. Build dagre graph
  const g = new dagre.graphlib.Graph({ directed: true })
  g.setGraph({
    rankdir: 'TB',
    acyclicer: 'greedy', // break cycles before ranking to prevent infinite loop on bidirectional edges
    nodesep: CLS.nodeSpacing,
    ranksep: CLS.layerSpacing,
    marginx: CLS.padding,
    marginy: CLS.padding,
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const cls of diagram.classes) {
    const size = classSizes.get(cls.id)!
    g.setNode(cls.id, { width: size.width, height: size.height })
  }

  // Add edges with label dimensions for collision-free label placement
  for (let i = 0; i < diagram.relationships.length; i++) {
    const rel = diagram.relationships[i]!
    const edgeLabel: Record<string, unknown> = { _index: i }
    if (rel.label) {
      edgeLabel.label = rel.label
      edgeLabel.width = estimateTextWidth(rel.label, FONT_SIZES.edgeLabel, FONT_WEIGHTS.edgeLabel) + 8
      edgeLabel.height = FONT_SIZES.edgeLabel + 6
      edgeLabel.labelpos = 'c'
    }
    g.setEdge(rel.from, rel.to, edgeLabel)
  }

  // 3. Run dagre layout (synchronous).
  // Wrapped in try-catch to surface clear errors on malformed class diagrams.
  try {
    dagre.layout(g)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Dagre layout failed (class diagram): ${message}`)
  }

  // 4. Extract positioned classes
  const classLookup = new Map<string, ClassNode>()
  for (const cls of diagram.classes) classLookup.set(cls.id, cls)

  const positionedClasses: PositionedClassNode[] = diagram.classes.map(cls => {
    const dagreNode = g.node(cls.id)
    const size = classSizes.get(cls.id)!
    const topLeft = centerToTopLeft(dagreNode.x, dagreNode.y, dagreNode.width, dagreNode.height)
    return {
      id: cls.id,
      label: cls.label,
      annotation: cls.annotation,
      attributes: cls.attributes,
      methods: cls.methods,
      x: topLeft.x,
      y: topLeft.y,
      width: dagreNode.width ?? size.width,
      height: dagreNode.height ?? size.height,
      headerHeight: size.headerHeight,
      attrHeight: size.attrHeight,
      methodHeight: size.methodHeight,
    }
  })

  // 5. Extract relationship paths and label positions
  const relationships: PositionedClassRelationship[] = g.edges().map((edgeObj: { v: string; w: string }) => {
    const dagreEdge = g.edge(edgeObj)
    const rel = diagram.relationships[dagreEdge._index as number]!
    const rawPoints = dagreEdge.points ?? []
    // TB layout → vertical-first bends
    const orthoPoints = snapToOrthogonal(rawPoints, true)

    // Clip endpoints to the correct side of source/target class boxes.
    // After orthogonalization the approach direction may differ from dagre's
    // original boundary intersection — e.g. a horizontal last segment should
    // connect to the side of the target at its vertical center, not the top.
    const srcNode = g.node(edgeObj.v)
    const tgtNode = g.node(edgeObj.w)
    const points = clipEndpointsToNodes(
      orthoPoints,
      srcNode ? { cx: srcNode.x, cy: srcNode.y, hw: srcNode.width / 2, hh: srcNode.height / 2 } : null,
      tgtNode ? { cx: tgtNode.x, cy: tgtNode.y, hw: tgtNode.width / 2, hh: tgtNode.height / 2 } : null,
    )

    // Dagre returns edge label center position directly as edge.x, edge.y
    let labelPosition: { x: number; y: number } | undefined
    if (rel.label && dagreEdge.x != null && dagreEdge.y != null) {
      labelPosition = { x: dagreEdge.x, y: dagreEdge.y }
    }

    return {
      from: rel.from,
      to: rel.to,
      type: rel.type,
      markerAt: rel.markerAt,
      label: rel.label,
      fromCardinality: rel.fromCardinality,
      toCardinality: rel.toCardinality,
      points,
      labelPosition,
    }
  })

  return {
    width: g.graph().width ?? 600,
    height: g.graph().height ?? 400,
    classes: positionedClasses,
    relationships,
  }
}

/** Calculate the max width of a list of class members (uses mono metrics) */
function maxMemberWidth(members: ClassMember[]): number {
  if (members.length === 0) return 0
  let maxW = 0
  for (const m of members) {
    const text = memberToString(m)
    // Members render in monospace — use mono width estimation for accurate box sizing
    const w = estimateMonoTextWidth(text, CLS.memberFontSize)
    if (w > maxW) maxW = w
  }
  return maxW
}

/** Convert a class member to its display string */
export function memberToString(m: ClassMember): string {
  const vis = m.visibility ? `${m.visibility} ` : ''
  const type = m.type ? `: ${m.type}` : ''
  return `${vis}${m.name}${type}`
}
