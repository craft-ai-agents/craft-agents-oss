---
status: complete
priority: p1
issue_id: "011"
tags: [code-review, performance, flowy]
dependencies: []
---

# Problem Statement

The DiagramRenderer component (1079 lines) lacks React.memo and memoization for sub-components, causing unnecessary re-renders on every parent update. During streaming responses with diagram updates, this creates severe performance degradation (~150ms per render for large diagrams), making the UI unresponsive and creating a poor streaming experience where Claude's responses appear to hang.

## Findings

**Location:** `apps/electron/src/renderer/components/diagram/DiagramRenderer.tsx`

**Performance Impact:**
- DiagramRenderer re-renders on any parent state change, even unrelated updates
- 1079 lines of component logic executes on every render
- Sub-components (nodes, edges, handlers) all re-render simultaneously
- During streaming: ~150ms render time × 5-10 updates/second = cumulative 750ms-1.5s lag
- Effect: User perceives Claude responses as frozen during diagram streaming

**Current Issues:**
```typescript
export default function DiagramRenderer(props: DiagramRendererProps) {
  // No React.memo wrapping
  // No memoization of event handlers
  // All child components re-render on parent updates
}
```

## Proposed Solutions

### Option 1: Strategic React.memo with Selective Prop Changes
- Pros:
  - Targeted performance fix
  - Preserves existing API
  - Minimal refactoring required
- Cons:
  - Requires careful prop dependency analysis
- Effort: Medium
- Risk: Low

Implement:
- Wrap DiagramRenderer in `React.memo()`
- Memoize expensive calculations (node positions, edge paths)
- Use `useMemo` for derived data
- Memoize event handlers with `useCallback`

### Option 2: Full Component Restructuring with Atomic Updates
- Pros:
  - Best performance possible
  - Future-proof architecture
  - Enables virtualization for large diagrams
- Cons:
  - Significant refactoring (2-3 days)
  - Higher risk of regressions
- Effort: Large
- Risk: Medium

Break DiagramRenderer into:
- DiagramCanvas (memoized)
- NodeRenderer (memoized, receives node-specific props only)
- EdgeRenderer (memoized, receives edge-specific props only)
- Use Zustand or Jotai atoms for local diagram state

## Acceptance Criteria

- [ ] DiagramRenderer wrapped in React.memo()
- [ ] Event handlers memoized with useCallback
- [ ] Expensive calculations memoized with useMemo
- [ ] All sub-components (nodes, edges) use React.memo
- [ ] Prop drilling minimized
- [ ] Performance test: streaming diagram updates <50ms render time
- [ ] Memory profiler shows no memory leaks during streaming
- [ ] Regression testing: all diagram interactions work correctly

## Work Log

- 2026-01-25: Created from code review
- 2026-01-25: Verified fix committed - DiagramRenderer wrapped in React.memo (line 167) and handleFlowyEdit callbacks memoized with useCallback in apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx (lines 1097-1099, 1250-1252)

## Resources

- Branch: feat/inline-flowy-diagrams
- Tools: React DevTools Profiler, Chrome DevTools Performance tab
- Reference: React.memo documentation, useCallback/useMemo patterns
