/**
 * Tests for multi-line label support via <br> tags.
 *
 * Covers:
 * - Parser: normalization of <br>, <br/>, <br /> to \n
 * - Text metrics: measureMultilineText() for width/height calculation
 * - Layout: estimateNodeSize() with multi-line labels
 * - Renderer: <tspan> generation for node and edge labels
 * - Integration: full SVG output with multi-line labels
 */
import { describe, it, expect } from 'bun:test'
import './test-setup' // Enforces LAYOUT_ENGINE env var
import { parseMermaid } from '../parser.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { parseErDiagram } from '../er/parser.ts'
import { measureMultilineText, LINE_HEIGHT_RATIO, measureTextWidth } from '../text-metrics.ts'
import { renderMermaid } from '../index.ts'

// ============================================================================
// Parser: <br> tag normalization
// ============================================================================

describe('parseMermaid – <br> tag normalization', () => {
  describe('node labels', () => {
    it('normalizes <br> to newline', () => {
      const g = parseMermaid('graph TD\n  A[Line1<br>Line2]')
      expect(g.nodes.get('A')!.label).toBe('Line1\nLine2')
    })

    it('normalizes <br/> to newline', () => {
      const g = parseMermaid('graph TD\n  A[Line1<br/>Line2]')
      expect(g.nodes.get('A')!.label).toBe('Line1\nLine2')
    })

    it('normalizes <br /> (with space) to newline', () => {
      const g = parseMermaid('graph TD\n  A[Line1<br />Line2]')
      expect(g.nodes.get('A')!.label).toBe('Line1\nLine2')
    })

    it('is case-insensitive (<BR>, <Br>, <bR>)', () => {
      const g1 = parseMermaid('graph TD\n  A[Line1<BR>Line2]')
      const g2 = parseMermaid('graph TD\n  B[Line1<Br>Line2]')
      const g3 = parseMermaid('graph TD\n  C[Line1<bR/>Line2]')

      expect(g1.nodes.get('A')!.label).toBe('Line1\nLine2')
      expect(g2.nodes.get('B')!.label).toBe('Line1\nLine2')
      expect(g3.nodes.get('C')!.label).toBe('Line1\nLine2')
    })

    it('handles multiple <br> tags', () => {
      const g = parseMermaid('graph TD\n  A[One<br>Two<br/>Three<br />Four]')
      expect(g.nodes.get('A')!.label).toBe('One\nTwo\nThree\nFour')
    })

    it('handles <br> with various node shapes', () => {
      const g = parseMermaid(`graph TD
        A[Rect<br>Label]
        B(Round<br>Label)
        C{Diamond<br>Label}
        D([Stadium<br>Label])
      `)
      expect(g.nodes.get('A')!.label).toBe('Rect\nLabel')
      expect(g.nodes.get('B')!.label).toBe('Round\nLabel')
      expect(g.nodes.get('C')!.label).toBe('Diamond\nLabel')
      expect(g.nodes.get('D')!.label).toBe('Stadium\nLabel')
    })
  })

  describe('edge labels', () => {
    it('normalizes <br> in edge labels', () => {
      const g = parseMermaid('graph TD\n  A -->|First<br>Second| B')
      expect(g.edges[0]!.label).toBe('First\nSecond')
    })

    it('normalizes <br/> in edge labels', () => {
      const g = parseMermaid('graph TD\n  A -->|Line1<br/>Line2| B')
      expect(g.edges[0]!.label).toBe('Line1\nLine2')
    })
  })

  describe('subgraph labels', () => {
    it('normalizes <br> in subgraph labels (bracket syntax)', () => {
      const g = parseMermaid(`graph TD
        subgraph sg1 [Group<br>Header]
          A[Node]
        end
      `)
      expect(g.subgraphs[0]!.label).toBe('Group\nHeader')
    })

    it('normalizes <br> in subgraph labels (plain syntax)', () => {
      const g = parseMermaid(`graph TD
        subgraph Line1<br>Line2
          A[Node]
        end
      `)
      expect(g.subgraphs[0]!.label).toBe('Line1\nLine2')
    })
  })

  describe('state diagram labels', () => {
    it('normalizes <br> in state alias labels', () => {
      const g = parseMermaid(`stateDiagram-v2
        state "First<br>Second" as s1
        [*] --> s1
      `)
      expect(g.nodes.get('s1')!.label).toBe('First\nSecond')
    })

    it('normalizes <br> in state description labels', () => {
      const g = parseMermaid(`stateDiagram-v2
        s1 : First<br>Second
        [*] --> s1
      `)
      expect(g.nodes.get('s1')!.label).toBe('First\nSecond')
    })

    it('normalizes <br> in transition labels', () => {
      const g = parseMermaid(`stateDiagram-v2
        s1 --> s2 : Event<br>Action
      `)
      expect(g.edges[0]!.label).toBe('Event\nAction')
    })
  })

  describe('sequence diagram labels', () => {
    it('normalizes <br> in participant alias labels', () => {
      const lines = ['sequenceDiagram', 'participant A as First<br>Line', 'A->>A: test']
      const diagram = parseSequenceDiagram(lines)
      expect(diagram.actors[0]!.label).toBe('First\nLine')
    })

    it('normalizes <br> in message labels', () => {
      const lines = ['sequenceDiagram', 'A->>B: Hello<br>World']
      const diagram = parseSequenceDiagram(lines)
      expect(diagram.messages[0]!.label).toBe('Hello\nWorld')
    })

    it('normalizes <br> in note text', () => {
      const lines = ['sequenceDiagram', 'A->>B: Hello', 'Note over A,B: First<br>Second']
      const diagram = parseSequenceDiagram(lines)
      expect(diagram.notes[0]!.text).toBe('First\nSecond')
    })

    it('normalizes <br> in block labels', () => {
      const lines = ['sequenceDiagram', 'A->>B: Hello', 'loop Every<br>30s', 'A->>B: Ping', 'end']
      const diagram = parseSequenceDiagram(lines)
      expect(diagram.blocks[0]!.label).toBe('Every\n30s')
    })

    it('normalizes <br> in divider labels', () => {
      const lines = ['sequenceDiagram', 'A->>B: Hello', 'alt First<br>case', 'A->>B: a', 'else Second<br>case', 'A->>B: b', 'end']
      const diagram = parseSequenceDiagram(lines)
      expect(diagram.blocks[0]!.dividers[0]!.label).toBe('Second\ncase')
    })
  })

  describe('class diagram labels', () => {
    it('normalizes <br> in relationship labels', () => {
      const lines = ['classDiagram', 'A --> B : uses<br>internally']
      const diagram = parseClassDiagram(lines)
      expect(diagram.relationships[0]!.label).toBe('uses\ninternally')
    })

    it('normalizes <br> in fromCardinality labels', () => {
      const lines = ['classDiagram', 'A "one<br>to" --> B']
      const diagram = parseClassDiagram(lines)
      expect(diagram.relationships[0]!.fromCardinality).toBe('one\nto')
    })

    it('normalizes <br> in toCardinality labels', () => {
      const lines = ['classDiagram', 'A --> "many<br>items" B']
      const diagram = parseClassDiagram(lines)
      expect(diagram.relationships[0]!.toCardinality).toBe('many\nitems')
    })
  })

  describe('ER diagram labels', () => {
    it('normalizes <br> in relationship labels', () => {
      const lines = ['erDiagram', 'CUSTOMER ||--o{ ORDER : places<br>orders']
      const diagram = parseErDiagram(lines)
      expect(diagram.relationships[0]!.label).toBe('places\norders')
    })

    it('normalizes <br> in attribute comments', () => {
      const lines = ['erDiagram', 'CUSTOMER {', 'int id PK "primary<br>key"', '}']
      const diagram = parseErDiagram(lines)
      expect(diagram.entities[0]!.attributes[0]!.comment).toBe('primary\nkey')
    })
  })
})

// ============================================================================
// Text metrics: multi-line measurement
// ============================================================================

describe('measureMultilineText', () => {
  const fontSize = 13
  const fontWeight = 500

  it('returns single line metrics for text without newlines', () => {
    const metrics = measureMultilineText('Hello', fontSize, fontWeight)

    expect(metrics.lines).toEqual(['Hello'])
    expect(metrics.lineHeight).toBe(fontSize * LINE_HEIGHT_RATIO)
    expect(metrics.height).toBe(fontSize * LINE_HEIGHT_RATIO)
    expect(metrics.width).toBe(measureTextWidth('Hello', fontSize, fontWeight))
  })

  it('splits text on newlines', () => {
    const metrics = measureMultilineText('Line1\nLine2\nLine3', fontSize, fontWeight)
    expect(metrics.lines).toEqual(['Line1', 'Line2', 'Line3'])
  })

  it('calculates height based on number of lines', () => {
    const lineHeight = fontSize * LINE_HEIGHT_RATIO

    const one = measureMultilineText('One', fontSize, fontWeight)
    const two = measureMultilineText('One\nTwo', fontSize, fontWeight)
    const three = measureMultilineText('One\nTwo\nThree', fontSize, fontWeight)

    expect(one.height).toBeCloseTo(lineHeight, 1)
    expect(two.height).toBeCloseTo(lineHeight * 2, 1)
    expect(three.height).toBeCloseTo(lineHeight * 3, 1)
  })

  it('uses maximum line width for overall width', () => {
    const metrics = measureMultilineText('Short\nMuch Longer Line\nMedium', fontSize, fontWeight)

    const shortWidth = measureTextWidth('Short', fontSize, fontWeight)
    const longWidth = measureTextWidth('Much Longer Line', fontSize, fontWeight)
    const mediumWidth = measureTextWidth('Medium', fontSize, fontWeight)

    expect(metrics.width).toBe(longWidth)
    expect(metrics.width).toBeGreaterThan(shortWidth)
    expect(metrics.width).toBeGreaterThan(mediumWidth)
  })

  it('handles empty lines', () => {
    const metrics = measureMultilineText('Line1\n\nLine3', fontSize, fontWeight)
    expect(metrics.lines).toEqual(['Line1', '', 'Line3'])
    expect(metrics.height).toBeCloseTo(fontSize * LINE_HEIGHT_RATIO * 3, 1)
  })

  it('exports LINE_HEIGHT_RATIO constant', () => {
    expect(LINE_HEIGHT_RATIO).toBe(1.3)
  })
})

// ============================================================================
// Renderer: <tspan> element generation
// ============================================================================

describe('renderMermaid – multi-line labels', () => {
  it('renders single-line node label without tspan', async () => {
    const svg = await renderMermaid('graph TD\n  A[Single Line]')

    // Should have text element with direct content
    expect(svg).toContain('Single Line</text>')
    // Should NOT have tspan for single line
    expect(svg).not.toMatch(/<tspan[^>]*>Single Line<\/tspan>/)
  })

  it('renders multi-line node label with tspan elements', async () => {
    const svg = await renderMermaid('graph TD\n  A[Line1<br>Line2]')

    // Should have tspan elements
    expect(svg).toContain('<tspan')
    expect(svg).toContain('>Line1</tspan>')
    expect(svg).toContain('>Line2</tspan>')
  })

  it('renders 3-line node label with 3 tspan elements', async () => {
    const svg = await renderMermaid('graph TD\n  A[One<br>Two<br>Three]')

    // Count tspan occurrences
    const tspanMatches = svg.match(/<tspan/g)
    expect(tspanMatches).toHaveLength(3)

    expect(svg).toContain('>One</tspan>')
    expect(svg).toContain('>Two</tspan>')
    expect(svg).toContain('>Three</tspan>')
  })

  it('renders multi-line edge label with tspan elements', async () => {
    const svg = await renderMermaid('graph TD\n  A -->|First<br>Second| B')

    expect(svg).toContain('<tspan')
    expect(svg).toContain('>First</tspan>')
    expect(svg).toContain('>Second</tspan>')
  })

  it('includes x attribute on each tspan for horizontal reset', async () => {
    const svg = await renderMermaid('graph TD\n  A[Line1<br>Line2]')

    // Each tspan should have an x attribute
    const tspanRegex = /<tspan x="[^"]+"/g
    const matches = svg.match(tspanRegex)
    expect(matches).toHaveLength(2)
  })

  it('includes dy attribute on each tspan for vertical positioning', async () => {
    const svg = await renderMermaid('graph TD\n  A[Line1<br>Line2]')

    // Each tspan should have a dy attribute
    const tspanRegex = /<tspan[^>]*dy="[^"]+"/g
    const matches = svg.match(tspanRegex)
    expect(matches).toHaveLength(2)
  })

  it('escapes XML characters in multi-line labels', async () => {
    const svg = await renderMermaid('graph TD\n  A[First &<br>Second >]')

    expect(svg).toContain('&amp;')
    expect(svg).toContain('&gt;')
    expect(svg).not.toContain('First &</tspan>')
    expect(svg).not.toContain('Second ></tspan>')
  })
})

// ============================================================================
// Integration: layout sizing
// ============================================================================

describe('renderMermaid – multi-line layout sizing', () => {
  it('multi-line node is taller than single-line node', async () => {
    const singleSvg = await renderMermaid('graph TD\n  A[Single]')
    const multiSvg = await renderMermaid('graph TD\n  A[Line1<br>Line2]')

    // Extract node rect heights
    const singleHeight = extractFirstRectHeight(singleSvg)
    const multiHeight = extractFirstRectHeight(multiSvg)

    expect(multiHeight).toBeGreaterThan(singleHeight)
  })

  it('3-line node is taller than 2-line node', async () => {
    const twoLineSvg = await renderMermaid('graph TD\n  A[One<br>Two]')
    const threeLineSvg = await renderMermaid('graph TD\n  A[One<br>Two<br>Three]')

    const twoLineHeight = extractFirstRectHeight(twoLineSvg)
    const threeLineHeight = extractFirstRectHeight(threeLineSvg)

    expect(threeLineHeight).toBeGreaterThan(twoLineHeight)
  })

  it('node width matches longest line', async () => {
    // "Much Longer" is wider than "Short"
    const svg = await renderMermaid('graph TD\n  A[Short<br>Much Longer Line]')
    const width = extractFirstRectWidth(svg)

    // Compare to single-line with long text
    const longSvg = await renderMermaid('graph TD\n  A[Much Longer Line]')
    const longWidth = extractFirstRectWidth(longSvg)

    // Widths should be approximately equal (multi-line uses max line width)
    expect(Math.abs(width - longWidth)).toBeLessThan(5)
  })
})

// ============================================================================
// Integration: sequence diagram multi-line rendering
// ============================================================================

describe('renderMermaid – sequence diagram multi-line', () => {
  it('renders multi-line message labels with tspan elements', async () => {
    const svg = await renderMermaid(`sequenceDiagram
      A->>B: Hello<br>World
    `)

    expect(svg).toContain('<tspan')
    expect(svg).toContain('>Hello</tspan>')
    expect(svg).toContain('>World</tspan>')
  })

  it('renders multi-line actor labels with tspan elements', async () => {
    const svg = await renderMermaid(`sequenceDiagram
      participant A as First<br>Line
      A->>A: test
    `)

    expect(svg).toContain('<tspan')
    expect(svg).toContain('>First</tspan>')
    expect(svg).toContain('>Line</tspan>')
  })

  it('renders multi-line note text with tspan elements', async () => {
    const svg = await renderMermaid(`sequenceDiagram
      A->>B: msg
      Note over A,B: Note<br>Text
    `)

    expect(svg).toContain('<tspan')
    expect(svg).toContain('>Note</tspan>')
    expect(svg).toContain('>Text</tspan>')
  })
})

// ============================================================================
// Integration: class diagram multi-line rendering
// ============================================================================

describe('renderMermaid – class diagram multi-line', () => {
  it('renders multi-line relationship labels with tspan elements', async () => {
    const svg = await renderMermaid(`classDiagram
      A --> B : uses<br>data
    `)

    expect(svg).toContain('<tspan')
    expect(svg).toContain('>uses</tspan>')
    expect(svg).toContain('>data</tspan>')
  })

  it('renders multi-line cardinality with tspan elements', async () => {
    const svg = await renderMermaid(`classDiagram
      A "one<br>to" --> B
    `)

    expect(svg).toContain('<tspan')
    expect(svg).toContain('>one</tspan>')
    expect(svg).toContain('>to</tspan>')
  })
})

// ============================================================================
// Integration: ER diagram multi-line rendering
// ============================================================================

describe('renderMermaid – ER diagram multi-line', () => {
  it('renders multi-line relationship labels with tspan elements', async () => {
    const svg = await renderMermaid(`erDiagram
      CUSTOMER ||--o{ ORDER : places<br>orders
    `)

    expect(svg).toContain('<tspan')
    expect(svg).toContain('>places</tspan>')
    expect(svg).toContain('>orders</tspan>')
  })
})

// ============================================================================
// Edge cases
// ============================================================================

describe('renderMermaid – edge cases', () => {
  it('handles consecutive <br><br> tags (empty lines)', async () => {
    const svg = await renderMermaid('graph TD\n  A[Line1<br><br>Line3]')
    const tspanMatches = svg.match(/<tspan/g)
    expect(tspanMatches).toHaveLength(3)
  })

  it('handles very long single line with <br>', async () => {
    const longLine = 'VeryLongTextHere'
    const svg = await renderMermaid(`graph TD\n  A[${longLine}<br>Short]`)
    expect(svg).toContain(`>${longLine}</tspan>`)
    expect(svg).toContain('>Short</tspan>')
  })

  it('handles single character lines', async () => {
    const svg = await renderMermaid('graph TD\n  A[X<br>Y<br>Z]')
    expect(svg).toContain('>X</tspan>')
    expect(svg).toContain('>Y</tspan>')
    expect(svg).toContain('>Z</tspan>')
  })

  it('handles unicode with <br>', async () => {
    const svg = await renderMermaid('graph TD\n  A[日本<br>語]')
    expect(svg).toContain('>日本</tspan>')
    expect(svg).toContain('>語</tspan>')
  })

  it('handles many lines (5+)', async () => {
    const svg = await renderMermaid('graph TD\n  A[1<br>2<br>3<br>4<br>5<br>6]')
    const tspanMatches = svg.match(/<tspan/g)
    expect(tspanMatches).toHaveLength(6)
  })

  it('handles mixed single-line and multi-line nodes', async () => {
    const svg = await renderMermaid(`graph TD
      A[Single] --> B[Multi<br>Line]
      B --> C[Also Single]
    `)
    expect(svg).toContain('>Single</text>')
    expect(svg).toContain('>Multi</tspan>')
    expect(svg).toContain('>Also Single</text>')
  })
})

// ============================================================================
// Subgraph multi-line
// ============================================================================

describe('renderMermaid – subgraph multi-line', () => {
  it('renders multi-line group headers with tspan', async () => {
    const svg = await renderMermaid(`graph TD
      subgraph sg [Group<br>Header]
        A[Node]
      end
    `)
    expect(svg).toContain('>Group</tspan>')
    expect(svg).toContain('>Header</tspan>')
  })
})

// ============================================================================
// All flowchart shapes with multi-line
// ============================================================================

describe('renderMermaid – all flowchart shapes with multi-line', () => {
  const shapes: [string, string][] = [
    ['rectangle', 'A[Line1<br>Line2]'],
    ['rounded', 'A(Line1<br>Line2)'],
    ['diamond', 'A{Line1<br>Line2}'],
    ['stadium', 'A([Line1<br>Line2])'],
    ['circle', 'A((Line1<br>Line2))'],
    ['subroutine', 'A[[Line1<br>Line2]]'],
    ['double-circle', 'A(((Line1<br>Line2)))'],
    ['hexagon', 'A{{Line1<br>Line2}}'],
    ['cylinder', 'A[(Line1<br>Line2)]'],
    ['flag', 'A>Line1<br>Line2]'],
    ['trapezoid', 'A[/Line1<br>Line2\\]'],
    ['inv-trapezoid', 'A[\\Line1<br>Line2/]'],
  ]

  shapes.forEach(([name, syntax]) => {
    it(`renders multi-line in ${name} shape`, async () => {
      const svg = await renderMermaid(`graph TD\n  ${syntax}`)
      expect(svg).toContain('<tspan')
      expect(svg).toContain('>Line1</tspan>')
      expect(svg).toContain('>Line2</tspan>')
    })
  })
})

// ============================================================================
// Helper functions
// ============================================================================

function extractFirstRectHeight(svg: string): number {
  const match = svg.match(/<rect[^>]*height="(\d+(?:\.\d+)?)"/)
  return match ? parseFloat(match[1]!) : 0
}

function extractFirstRectWidth(svg: string): number {
  const match = svg.match(/<rect[^>]*width="(\d+(?:\.\d+)?)"/)
  return match ? parseFloat(match[1]!) : 0
}
