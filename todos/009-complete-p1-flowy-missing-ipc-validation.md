---
status: complete
priority: p1
issue_id: "009"
tags: [code-review, security, flowy]
dependencies: []
---

# Problem Statement

The FLOWY_EMBED_UPDATE IPC handler accepts FlowyDocument objects from the renderer without validation before persisting them to disk. This creates a security vulnerability where a malicious or compromised renderer process could inject invalid or malformed diagram data into sessions, potentially corrupting session state or executing unintended behavior.

## Findings

**Location:** `apps/electron/src/main/ipc.ts:2637-2748`

The handler receives `FlowyDocument` from the renderer and directly persists it:
```typescript
ipcMain.on("FLOWY_EMBED_UPDATE", async (event, { sessionId, flowyDoc }) => {
  // No validation of flowyDoc structure, content, or integrity
  await sessionManager.updateFlowyEmbed(sessionId, flowyDoc);
});
```

**Risks:**
- Invalid schema can be injected without type checking at runtime
- Malformed diagram data corrupts session history
- No bounds on document size or complexity
- Security boundary between renderer and main process is bypassed

## Proposed Solutions

### Option 1: Add FlowyDocument Validator
- Pros:
  - Catches invalid data before persistence
  - Provides clear error messages to renderer
  - Minimal performance overhead
- Cons:
  - Requires maintaining schema definition
- Effort: Small
- Risk: Low

Implement `validateFlowyDocument()` function that checks:
- Document structure against FlowyDocument type
- Required fields (id, type, nodes, edges)
- Node/edge integrity
- Size limits (1MB max document)

### Option 2: Use Zod/Runtime Schema Validation
- Pros:
  - Type-safe validation with zero-runtime overhead for TypeScript
  - Automatic error messages
  - Reusable across other IPC handlers
- Cons:
  - Adds dependency
  - Slightly more setup
- Effort: Medium
- Risk: Low

Create Zod schema that mirrors FlowyDocument type and validate all incoming data.

## Acceptance Criteria

- [ ] FlowyDocument validation function created with schema checks
- [ ] FLOWY_EMBED_UPDATE handler calls validation before persistence
- [ ] Invalid documents return error event to renderer
- [ ] All node/edge references are verified for integrity
- [ ] Document size limit (1MB) is enforced
- [ ] Test cases cover malformed, oversized, and valid documents
- [ ] Validation errors are logged with context for debugging

## Work Log

- 2026-01-25: Created from code review
- 2026-01-25: Verified fix committed - comprehensive validation added including workspace authorization (lines 2639-2654), size limits (lines 2678-2687), and Zod schema validation (lines 2689-2702) in apps/electron/src/main/ipc.ts

## Resources

- Branch: feat/inline-flowy-diagrams
- Related: FLOWY_EMBED_CREATE handler should also validate
