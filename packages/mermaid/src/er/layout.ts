// @ts-expect-error — dagre types are declared for the package root, not the dist path;
// importing the pre-built browser bundle avoids Bun.build hanging on 30+ CJS file resolution
import dagre from '@dagrejs/dagre/dist/dagre.js'
import type { ErDiagram, ErEntity, PositionedErDiagram, PositionedErEntity, PositionedErRelationship } from './types.ts'
import type { RenderOptions } from '../types.ts'
import { estimateTextWidth, estimateMonoTextWidth, FONT_SIZES, FONT_WEIGHTS } from '../styles.ts'
import { centerToTopLeft, snapToOrthogonal, clipEndpointsToNodes } from '../dagre-adapter.ts'

// ============================================================================
// ER diagram layout engine
//
// Uses dagre for positioning entity boxes, then sizes each box based on
// the entity name and number of attributes.
//
// Each entity box has:
//   1. Header (entity name)
//   2. Attribute rows (type, name, keys)
// ============================================================================

/** Layout constants for ER diagrams */
const ER = {
  padding: 40,
  boxPadX: 12,
  headerHeight: 32,
  rowHeight: 22,
  minWidth: 140,
  attrFontSize: 11,
  attrFontWeight: 400,
  nodeSpacing: 50,
  layerSpacing: 70,
} as const

/**
 * Lay out a parsed ER diagram using dagre.
 * Returns positioned entity boxes and relationship paths.
 *
 * Kept async for API compatibility — dagre itself is synchronous.
 */
export async function layoutErDiagram(
  diagram: ErDiagram,
  _options: RenderOptions = {}
): Promise<PositionedErDiagram> {
  if (diagram.entities.length === 0) {
    return { width: 0, height: 0, entities: [], relationships: [] }
  }

  // 1. Calculate box dimensions for each entity
  const entitySizes = new Map<string, { width: number; height: number }>()

  for (const entity of diagram.entities) {
    // Header width from entity label
    const headerTextW = estimateTextWidth(entity.label, FONT_SIZES.nodeLabel, FONT_WEIGHTS.nodeLabel)

    // Max attribute row width: "type  name  PK FK"
    // Attribute text renders in monospace — use mono width estimation for accurate box sizing
    let maxAttrW = 0
    for (const attr of entity.attributes) {
      const attrText = `${attr.type}  ${attr.name}${attr.keys.length > 0 ? '  ' + attr.keys.join(',') : ''}`
      const w = estimateMonoTextWidth(attrText, ER.attrFontSize)
      if (w > maxAttrW) maxAttrW = w
    }

    const width = Math.max(ER.minWidth, headerTextW + ER.boxPadX * 2, maxAttrW + ER.boxPadX * 2)
    const height = ER.headerHeight + Math.max(entity.attributes.length, 1) * ER.rowHeight

    entitySizes.set(entity.id, { width, height })
  }

  // 2. Build dagre graph
  const g = new dagre.graphlib.Graph({ directed: true })
  g.setGraph({
    rankdir: 'LR',
    acyclicer: 'greedy', // break cycles before ranking to prevent infinite loop on bidirectional edges
    nodesep: ER.nodeSpacing,
    ranksep: ER.layerSpacing,
    marginx: ER.padding,
    marginy: ER.padding,
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const entity of diagram.entities) {
    const size = entitySizes.get(entity.id)!
    g.setNode(entity.id, { width: size.width, height: size.height })
  }

  for (let i = 0; i < diagram.relationships.length; i++) {
    const rel = diagram.relationships[i]!
    g.setEdge(rel.entity1, rel.entity2, {
      _index: i,
      label: rel.label,
      width: estimateTextWidth(rel.label, FONT_SIZES.edgeLabel, FONT_WEIGHTS.edgeLabel) + 8,
      height: FONT_SIZES.edgeLabel + 6,
      labelpos: 'c',
    })
  }

  // 3. Run dagre layout (synchronous).
  // Wrapped in try-catch to surface clear errors on malformed ER diagrams.
  try {
    dagre.layout(g)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Dagre layout failed (ER diagram): ${message}`)
  }

  // 4. Extract positioned entities
  const entityLookup = new Map<string, ErEntity>()
  for (const entity of diagram.entities) entityLookup.set(entity.id, entity)

  const positionedEntities: PositionedErEntity[] = diagram.entities.map(entity => {
    const dagreNode = g.node(entity.id)
    const topLeft = centerToTopLeft(dagreNode.x, dagreNode.y, dagreNode.width, dagreNode.height)
    return {
      id: entity.id,
      label: entity.label,
      attributes: entity.attributes,
      x: topLeft.x,
      y: topLeft.y,
      width: dagreNode.width ?? entitySizes.get(entity.id)!.width,
      height: dagreNode.height ?? entitySizes.get(entity.id)!.height,
      headerHeight: ER.headerHeight,
      rowHeight: ER.rowHeight,
    }
  })

  // 5. Extract relationship paths
  const relationships: PositionedErRelationship[] = g.edges().map((edgeObj: { v: string; w: string }) => {
    const dagreEdge = g.edge(edgeObj)
    const rel = diagram.relationships[dagreEdge._index as number]!
    const rawPoints = dagreEdge.points ?? []
    // LR layout → horizontal-first bends
    const orthoPoints = snapToOrthogonal(rawPoints, false)

    // Clip endpoints to the correct side of source/target entity boxes.
    // After orthogonalization the approach direction may differ from dagre's
    // original boundary intersection — e.g. a vertical last segment should
    // connect to the top/bottom of the target at its horizontal center.
    const srcNode = g.node(edgeObj.v)
    const tgtNode = g.node(edgeObj.w)
    const points = clipEndpointsToNodes(
      orthoPoints,
      srcNode ? { cx: srcNode.x, cy: srcNode.y, hw: srcNode.width / 2, hh: srcNode.height / 2 } : null,
      tgtNode ? { cx: tgtNode.x, cy: tgtNode.y, hw: tgtNode.width / 2, hh: tgtNode.height / 2 } : null,
    )

    return {
      entity1: rel.entity1,
      entity2: rel.entity2,
      cardinality1: rel.cardinality1,
      cardinality2: rel.cardinality2,
      label: rel.label,
      identifying: rel.identifying,
      points,
    }
  })

  return {
    width: g.graph().width ?? 600,
    height: g.graph().height ?? 400,
    entities: positionedEntities,
    relationships,
  }
}
