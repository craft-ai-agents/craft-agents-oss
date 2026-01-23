---
status: pending
priority: p3
issue_id: "006"
tags: [code-review, security, validation]
dependencies: []
---

# Missing Input Validation on IPC Handler

## Problem Statement

The IPC handler for `setAgentationEnabled` doesn't validate that the `enabled` parameter is actually a boolean at runtime. TypeScript types are erased at runtime.

**Why this matters:** A malformed IPC call could pass non-boolean values. While impact is low for this feature, it's a good practice to validate.

## Findings

### Security Agent Finding
- **File:** `apps/electron/src/main/ipc.ts:1832-1834`

```typescript
ipcMain.handle(IPC_CHANNELS.AGENTATION_SET_ENABLED, async (_event, enabled: boolean) => {
  const { setAgentationEnabled } = await import('@craft-agent/shared/config/storage')
  setAgentationEnabled(enabled)  // No runtime validation
})
```

### Risk Assessment
- **Impact:** Low - JavaScript truthy/falsy evaluation handles most cases
- **Exploit scenario:** A string like `"false"` would be truthy and enable the feature
- **Actual risk:** Very low - only affects a debug panel, and attacker would need renderer access

## Proposed Solutions

### Option 1: Add Boolean Validation (Recommended)
**Description:** Add explicit type check before processing.

```typescript
ipcMain.handle(IPC_CHANNELS.AGENTATION_SET_ENABLED, async (_event, enabled: boolean) => {
  if (typeof enabled !== 'boolean') return
  const { setAgentationEnabled } = await import('@craft-agent/shared/config/storage')
  setAgentationEnabled(enabled)
})
```

**Pros:**
- Follows defense-in-depth principle
- Consistent with security best practices

**Cons:**
- Minimal real benefit for this feature

**Effort:** Trivial
**Risk:** Low

### Option 2: Accept the Risk
**Description:** Keep current implementation since risk is negligible.

**Pros:**
- Less code
- TypeScript provides compile-time safety

**Cons:**
- Inconsistent with security best practices

**Effort:** None
**Risk:** Low

## Recommended Action

_To be filled during triage_

## Technical Details

### Affected Files
- `apps/electron/src/main/ipc.ts`

## Acceptance Criteria

- [ ] IPC handler validates `enabled` is boolean
- [ ] Invalid values are rejected silently or logged

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-23 | Created from code review | Runtime validation complements TypeScript |

## Resources

- Electron IPC security: https://www.electronjs.org/docs/tutorial/security
