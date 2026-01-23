---
status: pending
priority: p2
issue_id: "004"
tags: [code-review, performance, bundle-size]
dependencies: ["001"]
---

# Eager Import of Agentation Without Lazy Loading

## Problem Statement

The `Agentation` component is imported at the top of `App.tsx` even though it's only rendered conditionally when `agentationEnabled` is true (which defaults to `false`). This includes the entire package in the main bundle regardless of whether the user ever enables this developer feature.

**Why this matters:** Increased bundle size for all users, even though most will never use this developer-only tool.

## Findings

### Performance Agent Finding
- **File:** `apps/electron/src/renderer/App.tsx:45`

```typescript
import { Agentation } from 'agentation'  // Always included in bundle
```

- **Render location:** Line 1314
```typescript
{agentationEnabled && <Agentation />}  // Conditionally rendered
```

## Proposed Solutions

### Option 1: Use React.lazy() for Code Splitting (Recommended)
**Description:** Dynamically import the component only when needed.

```typescript
// At top of file
const Agentation = React.lazy(() =>
  import('agentation').then(m => ({ default: m.Agentation }))
)

// In render
{agentationEnabled && (
  <React.Suspense fallback={null}>
    <Agentation />
  </React.Suspense>
)}
```

**Pros:**
- Component only loaded when setting is enabled
- Reduces main bundle size
- Standard React pattern for code splitting

**Cons:**
- Small delay when first enabling the feature
- Requires Suspense boundary

**Effort:** Small
**Risk:** Low

### Option 2: Keep Eager Import
**Description:** Accept the bundle size trade-off for simplicity.

**Pros:**
- Simpler code
- No loading delay when enabling

**Cons:**
- Bundle bloat for all users
- Not following performance best practices

**Effort:** None
**Risk:** Low

## Recommended Action

_To be filled during triage_

## Technical Details

### Affected Files
- `apps/electron/src/renderer/App.tsx`

### Bundle Impact
- Unknown until `agentation` package size is measured
- Typical dev tools packages can be 50-200KB

## Acceptance Criteria

- [ ] Agentation import uses React.lazy()
- [ ] Suspense boundary added for loading state
- [ ] Feature works correctly when enabled
- [ ] Bundle size reduced for users who don't enable feature

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-23 | Created from code review | Conditional features should use code splitting |

## Resources

- React.lazy documentation: https://react.dev/reference/react/lazy
- Depends on: #001 (package must be installed first)
