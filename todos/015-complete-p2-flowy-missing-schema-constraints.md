---
status: complete
priority: p2
issue_id: "015"
tags: [code-review, security, flowy]
dependencies: []
---

# Problem Statement

**Missing Size Constraints in Flowy Zod Schema Allows DoS Attacks**

The Flowy Zod schema in `packages/shared/src/flowy/schema.ts` lacks any constraints on diagram size, string lengths, or nesting depth. This allows attackers to craft malicious payloads that could cause memory exhaustion, processing delays, or DoS conditions through extremely large or deeply nested diagrams.

**Why This Matters:**
- Attackers can craft payloads with millions of nodes to exhaust memory
- Unbounded string lengths (node labels, descriptions) can cause memory issues
- Deeply nested structures could cause stack overflow during processing
- Lack of constraints violates security best practices for user-submitted data
- Could be exploited via WhatsApp integration or other external inputs

## Findings

**Location:** `packages/shared/src/flowy/schema.ts`

Current schema likely has definitions similar to:
```typescript
export const FlowyNodeSchema = z.object({
  id: z.string(),
  label: z.string(),            // No max length!
  description: z.string(),      // No max length!
  // ... other fields without constraints
});

export const FlowyDiagramSchema = z.object({
  nodes: z.array(FlowyNodeSchema),  // No max array size!
  edges: z.array(FlowyEdgeSchema),  // No max array size!
  // ... potentially nested structures without depth limit
});
```

**Attack Scenarios:**

1. **Memory Exhaustion via Node Count:**
   ```
   {
     nodes: [/* array of 10 million items */],
     edges: []
   }
   ```
   Result: Server crashes trying to process/store diagram

2. **String Length Attack:**
   ```
   {
     nodes: [{
       id: "1",
       label: "x".repeat(10_000_000),  // 10MB string
     }]
   }
   ```
   Result: Memory exhaustion from single field

3. **Nesting Depth Attack (if applicable):**
   ```
   {
     nodes: [{
       metadata: {
         nested: {
           deeply: {
             // ... 1000 levels deep
           }
         }
       }
     }]
   }
   ```
   Result: Stack overflow during serialization/parsing

**Impact on Systems:**
- IPC handler processes untrusted data: `apps/electron/src/main/flowy-ipc.ts`
- Could be triggered via external sources (WhatsApp, APIs)
- Affects session storage: `packages/shared/src/sessions/`
- Could block main process if sync operations are used

## Proposed Solutions

### Solution 1: Add Reasonable Size Constraints (Recommended)

**Pros:**
- Simple, effective protection
- Doesn't impact legitimate use cases
- Based on empirical diagram size limits
- Easy to maintain and explain

**Cons:**
- Requires determining "reasonable" limits

**Implementation:**
```typescript
// Maximum limits for Flowy diagrams
const FLOWY_CONSTRAINTS = {
  MAX_NODES: 100,           // Practical UI limit
  MAX_EDGES: 150,           // Typically < nodes
  MAX_NODE_LABEL_LENGTH: 500,
  MAX_NODE_DESCRIPTION_LENGTH: 2000,
  MAX_EDGE_LABEL_LENGTH: 200,
  MAX_NESTING_DEPTH: 5,     // If applicable
};

export const FlowyNodeSchema = z.object({
  id: z.string().max(100),
  label: z.string()
    .min(1)
    .max(FLOWY_CONSTRAINTS.MAX_NODE_LABEL_LENGTH),
  description: z.string()
    .max(FLOWY_CONSTRAINTS.MAX_NODE_DESCRIPTION_LENGTH)
    .optional(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  // ... other fields with appropriate constraints
});

export const FlowyEdgeSchema = z.object({
  id: z.string().max(100),
  source: z.string().max(100),
  target: z.string().max(100),
  label: z.string()
    .max(FLOWY_CONSTRAINTS.MAX_EDGE_LABEL_LENGTH)
    .optional(),
});

export const FlowyDiagramSchema = z.object({
  id: z.string().max(100),
  nodes: z.array(FlowyNodeSchema)
    .max(FLOWY_CONSTRAINTS.MAX_NODES)
    .min(1),
  edges: z.array(FlowyEdgeSchema)
    .max(FLOWY_CONSTRAINTS.MAX_EDGES),
  metadata: z.record(z.unknown()).optional(),
});
```

**Effort:** Small (1-2 hours)
**Risk:** Low (constraints are reasonable for UI-based editing)

### Solution 2: Runtime Size Validation

**Pros:**
- Can provide helpful error messages
- Can reject early before full parsing

**Cons:**
- Less elegant than schema constraints
- Duplicates Zod functionality

**Implementation:**
```typescript
export function validateFlowyDiagramSize(data: unknown): void {
  if (typeof data !== 'object' || !data) {
    throw new Error('Invalid diagram data');
  }

  const diagram = data as Record<string, unknown>;
  const nodes = diagram.nodes as unknown[];
  const edges = diagram.edges as unknown[];

  if (!Array.isArray(nodes)) {
    throw new Error('nodes must be an array');
  }
  if (!Array.isArray(edges)) {
    throw new Error('edges must be an array');
  }

  if (nodes.length > FLOWY_CONSTRAINTS.MAX_NODES) {
    throw new Error(
      `Diagram exceeds maximum of ${FLOWY_CONSTRAINTS.MAX_NODES} nodes (got ${nodes.length})`
    );
  }

  if (edges.length > FLOWY_CONSTRAINTS.MAX_EDGES) {
    throw new Error(
      `Diagram exceeds maximum of ${FLOWY_CONSTRAINTS.MAX_EDGES} edges (got ${edges.length})`
    );
  }

  // Validate individual field sizes...
}
```

**Effort:** Small (1 hour)
**Risk:** Low

## Recommended Action

**Implement Solution 1 (Add Zod Schema Constraints)**

Update `packages/shared/src/flowy/schema.ts` to include size limits:
- Maximum 100 nodes per diagram (practical UI limit)
- Maximum 150 edges per diagram
- Node labels: 500 characters
- Node descriptions: 2000 characters
- Edge labels: 200 characters

These limits support complex enterprise diagrams while preventing DoS attacks.

## Technical Details

**Affected Files:**
- `packages/shared/src/flowy/schema.ts` (primary)
- `apps/electron/src/main/flowy-ipc.ts` (uses schema for validation)
- `apps/electron/src/renderer/atoms/flowy.ts` (stores diagrams in state)

**Database/Schema Changes:** None (schema constraints are client/server-side)

**Dependencies:** None (using existing Zod)

## Acceptance Criteria

- [ ] FlowyNodeSchema includes max length constraints on strings
- [ ] FlowyDiagramSchema includes max array size constraints
- [ ] All string fields have reasonable max lengths (100-2000 chars)
- [ ] Attempting to create diagram with 101+ nodes is rejected
- [ ] Error messages are clear and user-friendly
- [ ] Legitimate diagrams (under 100 nodes) still work
- [ ] Add unit tests for constraint validation
- [ ] Document constraints in schema comments

## Work Log

### 2026-01-25
- **Discovered:** Missing schema constraints in flowy:edit handler during code review
- **Analysis:** Identified DoS vulnerability via unbounded diagram size
- **Risk Assessment:** P2 (Important) - Affects system stability
- **Recommendation:** Add Zod schema constraints
- **Verified:** Fix committed - FLOWY_CONSTRAINTS defined with MAX_NODES: 100, MAX_EDGES: 150, MAX_NODE_LABEL_LENGTH: 500, MAX_NODE_DESCRIPTION_LENGTH: 2000, MAX_EDGE_LABEL_LENGTH: 200 applied to Zod schemas in packages/shared/src/flowy/schema.ts

## Resources

- **File:** `packages/shared/src/flowy/schema.ts`
- **Zod Docs:** https://zod.dev/#strings (max, min constraints)
- **OWASP:** Input Validation best practices
- **Similar:** Template schema constraints in `packages/shared/src/templates/`
