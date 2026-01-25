---
status: complete
priority: p2
issue_id: "014"
tags: [code-review, performance, flowy]
dependencies: []
---

# Problem Statement

**Unnecessary Callback Recreation Causes Performance Degradation in Flowy Edits**

The `handleFlowyEdit` callback is created inline during component rendering in `ChatDisplay.tsx`, causing it to be recreated on every render. This is a common React anti-pattern that can cause unnecessary re-renders of memoized child components and degraded performance when there are many Flowy diagram embeds.

**Why This Matters:**
- Callback identity changes on every render, breaking memoization
- Child components using the callback as a dependency will re-render unnecessarily
- Performance scales poorly with number of embeds (O(n) re-renders per parent render)
- Violates React best practices for callback optimization

## Findings

**Location:** `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx:1247,1293-1302`

```typescript
{/* Lines 1247: Callback created inline */}
<FlowyEmbed
  id={embed.id}
  data={embed.data}
  onEdit={(newData) => {  // Recreated on every render!
    // ...
  }}
  onDelete={() => {       // Recreated on every render!
    // ...
  }}
/>

{/* Elsewhere in render: */}
// Lines 1293-1302
const handleFlowyEdit = (embedId: string, newData: FlowyData) => {
  // This function is defined in render body, recreated every render
  ipcInvoke('flowy:edit', sessionId, embedId, newData)
    .catch(error => {
      console.error('Failed to update flowy:', error);
    });
};
```

**Performance Issue:**
1. Parent `ChatDisplay` component renders
2. `handleFlowyEdit` is created as new function object
3. `FlowyEmbed` receives new function reference (even though logic is identical)
4. `FlowyEmbed` is a memoized component, but the `onEdit` prop changed
5. React detects prop change and re-renders `FlowyEmbed` anyway
6. With 10 embeds, this causes 10 unnecessary child re-renders per parent render

**Memory Leak Risk:**
If the callback is used as a dependency in child component effects, stale closures could accumulate.

## Proposed Solutions

### Solution 1: Extract with useCallback (Recommended)

**Pros:**
- Simple, idiomatic React pattern
- Maintains correct closure over `sessionId`
- Zero performance overhead
- Familiar to React developers

**Cons:**
- Requires understanding dependency array

**Implementation:**
```typescript
const handleFlowyEdit = useCallback(
  (embedId: string, newData: FlowyData) => {
    ipcInvoke('flowy:edit', sessionId, embedId, newData)
      .catch(error => {
        console.error('Failed to update flowy:', error);
      });
  },
  [sessionId] // Re-create only when sessionId changes
);

const handleFlowyDelete = useCallback(
  (embedId: string) => {
    ipcInvoke('flowy:delete', sessionId, embedId)
      .catch(error => {
        console.error('Failed to delete flowy:', error);
      });
  },
  [sessionId]
);

// Then use in FlowyEmbed
<FlowyEmbed
  id={embed.id}
  data={embed.data}
  onEdit={handleFlowyEdit}
  onDelete={handleFlowyDelete}
/>
```

**Effort:** Small (30 minutes)
**Risk:** Low (standard React pattern)

### Solution 2: Extract to Custom Hook

**Pros:**
- Encapsulates related logic
- Reusable across components
- Cleaner component code

**Cons:**
- Slight additional indirection

**Implementation:**
```typescript
// hooks/useFlowyActions.ts
export function useFlowyActions(sessionId: string) {
  const handleEdit = useCallback(
    (embedId: string, newData: FlowyData) => {
      return ipcInvoke('flowy:edit', sessionId, embedId, newData);
    },
    [sessionId]
  );

  const handleDelete = useCallback(
    (embedId: string) => {
      return ipcInvoke('flowy:delete', sessionId, embedId);
    },
    [sessionId]
  );

  return { handleEdit, handleDelete };
}

// In ChatDisplay.tsx
const { handleEdit, handleDelete } = useFlowyActions(sessionId);
```

**Effort:** Small (1 hour)
**Risk:** Low

## Recommended Action

**Implement Solution 1 (useCallback) as Quick Fix**

Add `useCallback` hooks to wrap `handleFlowyEdit` and `handleFlowyDelete` callbacks. This is the minimal change with maximum benefit.

**Effort:** 30 minutes
**Quick Win:** Yes - significant performance improvement for chats with multiple embeds

## Technical Details

**Affected Files:**
- `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx:1247,1293-1302`

**Related Files:**
- `apps/electron/src/renderer/components/flowy/FlowyEmbed.tsx` (consumer of callbacks)
- `apps/electron/src/main/flowy-ipc.ts` (IPC handler)

**Database/Schema Changes:** None

**Dependencies:** None (useCallback is built-in React hook)

## Acceptance Criteria

- [ ] `handleFlowyEdit` wrapped with useCallback
- [ ] `handleFlowyDelete` wrapped with useCallback
- [ ] Dependency arrays correctly include sessionId
- [ ] No stale closures over old sessionIds
- [ ] FlowyEmbed re-renders only when data actually changes
- [ ] Performance test shows reduced re-renders with multiple embeds

## Work Log

### 2026-01-25
- **Discovered:** Callback recreation pattern during code review
- **Analysis:** Identified performance impact with multiple embeds
- **Risk Assessment:** P2 (Important) - Affects UX with heavy diagram usage
- **Recommendation:** Use useCallback pattern
- **Verified:** Fix committed - handleFlowyEdit wrapped with useCallback with correct dependencies [sessionId, message.id] in both user and assistant message components (lines 1097-1099, 1250-1252) in apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx

## Resources

- **File:** `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx`
- **React Docs:** https://react.dev/reference/react/useCallback
- **Pattern:** Similar optimization in `apps/electron/src/renderer/components/scheduler/`
