# refactor: Remove Flowy Sidebar, Keep Core for Inline Embedding

> Simplify Flowy by removing standalone sidebar navigation while preserving the type system and renderer for future inline chat embedding.

## Overview

Flowy currently exists as a **standalone feature** with its own sidebar nav item, list panel, and detail panel. This adds cognitive load without supporting Vesper's core orchestration loop.

**Decision:** Remove the sidebar implementation, keep the foundation for the planned inline embedding feature (`feat-inline-flowy-diagrams.md`).

```
BEFORE                              AFTER
┌──────────┐                       ┌──────────┐
│ Sidebar  │ ← Flowy nav item      │ Sidebar  │ ← No Flowy nav
├──────────┤                       ├──────────┤
│ FlowyList│ ← List panel          │ (other)  │
├──────────┤                       ├──────────┤
│ FlowyDtl │ ← Detail panel        │ (other)  │
└──────────┘                       └──────────┘

But KEEP: types.ts, schema.ts, templates.ts, FlowyRenderer.tsx
         (for future inline embedding in chat messages)
```

## Problem Statement

1. **Feature Sprawl**: Flowy adds a top-level nav item that doesn't support the orchestration loop
2. **Disconnected UX**: Diagrams live in a silo, not connected to conversations
3. **Premature**: The standalone editor was built before the inline embedding vision was defined
4. **Maintenance Burden**: 4 main-process files + 4 renderer components + navigation wiring for unused feature

## Proposed Solution

### Delete (Sidebar Infrastructure)

| File | Reason |
|------|--------|
| `apps/electron/src/renderer/components/flowy/FlowyListPanel.tsx` | Standalone list panel |
| `apps/electron/src/renderer/components/flowy/FlowyDetailPanel.tsx` | Standalone detail panel |
| `apps/electron/src/renderer/components/flowy/index.ts` | Barrel export for deleted components |
| `apps/electron/src/renderer/atoms/flowy.ts` | State for deleted UI |
| `apps/electron/src/main/flowy-service.ts` | File-based storage service |
| `apps/electron/src/main/flowy-ipc.ts` | IPC handlers for file ops |

### Keep (Core Foundation)

| File | Purpose |
|------|---------|
| `packages/shared/src/flowy/types.ts` | FlowyDocument, FlowyNode, FlowyEdge, MockupComponent |
| `packages/shared/src/flowy/schema.ts` | Zod validation for document structure |
| `packages/shared/src/flowy/templates.ts` | createFromTemplate() for skill output |
| `packages/shared/src/flowy/index.ts` | Package exports |
| `apps/electron/src/renderer/components/flowy/FlowyRenderer.tsx` | SVG renderer (rename to `/components/diagram/`) |

### Modify (Remove References)

| File | Changes |
|------|---------|
| `apps/electron/src/shared/routes.ts` | Remove `flowy` route builder |
| `apps/electron/src/shared/types.ts` | Remove `FlowyNavigationState`, Flowy IPC channels |
| `apps/electron/src/shared/route-parser.ts` | Remove Flowy route parsing |
| `apps/electron/src/renderer/contexts/NavigationContext.tsx` | Remove `isFlowyNavigation` import/export |
| `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx` | Remove Flowy navigator case |
| `apps/electron/src/renderer/components/app-shell/AppShell.tsx` | Remove Flowy sidebar item, remove `flowyFilesAtom` |
| `apps/electron/src/main/ipc.ts` | Remove `registerFlowyHandlers()` call |
| `apps/electron/src/preload/index.ts` | Remove Flowy API methods |
| `packages/shared/package.json` | Keep flowy exports (still needed for types) |

## Technical Approach

### Phase 1: Remove UI Layer

```bash
# Delete component files
rm -rf apps/electron/src/renderer/components/flowy/FlowyListPanel.tsx
rm -rf apps/electron/src/renderer/components/flowy/FlowyDetailPanel.tsx
rm -rf apps/electron/src/renderer/components/flowy/index.ts
rm -rf apps/electron/src/renderer/atoms/flowy.ts

# Keep but rename
mv apps/electron/src/renderer/components/flowy/FlowyRenderer.tsx \
   apps/electron/src/renderer/components/diagram/DiagramRenderer.tsx
```

### Phase 2: Remove IPC Layer

```bash
# Delete main process files
rm apps/electron/src/main/flowy-service.ts
rm apps/electron/src/main/flowy-ipc.ts
```

### Phase 3: Clean Navigation

**routes.ts** - Remove:
```typescript
// DELETE these lines
flowy: (filename?: string) => filename ? `flowy/file/${filename}` : 'flowy',
```

**types.ts** - Remove:
```typescript
// DELETE FlowyNavigationState interface
// DELETE isFlowyNavigation type guard
// DELETE FLOWY_* IPC channels
```

**MainContentPanel.tsx** - Remove:
```typescript
// DELETE Flowy navigator case
if (isFlowyNavigation(navState)) { ... }
```

**AppShell.tsx** - Remove:
```typescript
// DELETE Flowy sidebar item
// DELETE flowyFilesAtom import and usage
```

### Phase 4: Verify Package Exports

**packages/shared/package.json** - Keep:
```json
"./flowy": "./src/flowy/index.ts",
"./flowy/types": "./src/flowy/types.ts",
"./flowy/schema": "./src/flowy/schema.ts",
"./flowy/templates": "./src/flowy/templates.ts"
```

These exports are needed for the inline embedding feature plan.

## Acceptance Criteria

### Removal Verification

- [ ] No "Flowy" item in sidebar navigation
- [ ] No `flowy` routes in route parser
- [ ] No Flowy IPC handlers registered
- [ ] No Flowy atoms in renderer
- [ ] `bun run typecheck` passes
- [ ] `bun run build` succeeds

### Preserved Functionality

- [ ] `@vesper/shared/flowy` package exports work
- [ ] `FlowyDocument` type is importable
- [ ] `validateFlowyDocument()` works
- [ ] `createFromTemplate()` works
- [ ] `DiagramRenderer` component renders SVG

### No Regressions

- [ ] Other navigation items work (Sources, Skills, Schedules)
- [ ] No TypeScript errors in navigator or routes
- [ ] No runtime errors on app startup

## Success Metrics

| Metric | Target |
|--------|--------|
| Files deleted | 6 |
| Files modified | 9 |
| Lines removed | ~800 |
| Bundle size reduction | ~10KB |
| Build time unchanged | ±5% |

## Dependencies & Prerequisites

### Required Before Starting

- [ ] Confirm `feat-inline-flowy-diagrams.md` plan is still desired (inline approach)
- [ ] No users have created .flowy files (or accept they become orphaned)

### Blocks

None - this is isolated cleanup.

## Risk Analysis

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Users have .flowy files | Low | Low | Files remain on disk, just inaccessible |
| Inline plan depends on deleted code | Low | Medium | Carefully review what inline plan needs |
| Type errors cascade | Medium | Low | Run typecheck after each phase |

## Implementation Phases

### Phase 1: UI Removal (~30 min)
- [ ] Delete FlowyListPanel.tsx
- [ ] Delete FlowyDetailPanel.tsx
- [ ] Delete flowy/index.ts
- [ ] Delete flowy.ts atom
- [ ] Rename FlowyRenderer → DiagramRenderer

### Phase 2: IPC Removal (~15 min)
- [ ] Delete flowy-service.ts
- [ ] Delete flowy-ipc.ts
- [ ] Remove registerFlowyHandlers from ipc.ts
- [ ] Remove flowy methods from preload/index.ts

### Phase 3: Navigation Cleanup (~30 min)
- [ ] Remove flowy route from routes.ts
- [ ] Remove Flowy parsing from route-parser.ts
- [ ] Remove FlowyNavigationState from types.ts
- [ ] Remove Flowy IPC channels from types.ts
- [ ] Remove isFlowyNavigation from NavigationContext.tsx
- [ ] Remove Flowy case from MainContentPanel.tsx
- [ ] Remove Flowy sidebar item from AppShell.tsx

### Phase 4: Verification (~15 min)
- [ ] Run `bun run typecheck`
- [ ] Run `bun run build`
- [ ] Manual test: verify sidebar, navigation, other features work
- [ ] Verify `@vesper/shared/flowy` exports still work

## Future Considerations

After this cleanup, the **inline Flowy embedding** feature can be built:
- Add `flowyEmbeds` to StoredMessage
- Create `/flowy-flowchart` skill
- Build FlowyInlineEmbed component
- Render in chat messages

See `feat-inline-flowy-diagrams.md` for the complete inline implementation plan.

## References

### Internal
- Inline plan: `docs/plans/feat-inline-flowy-diagrams.md`
- Flowy types: `packages/shared/src/flowy/types.ts`
- Navigation patterns: `apps/electron/src/shared/routes.ts`

### Files to Delete
```
apps/electron/src/renderer/components/flowy/FlowyListPanel.tsx
apps/electron/src/renderer/components/flowy/FlowyDetailPanel.tsx
apps/electron/src/renderer/components/flowy/index.ts
apps/electron/src/renderer/atoms/flowy.ts
apps/electron/src/main/flowy-service.ts
apps/electron/src/main/flowy-ipc.ts
```

### Files to Modify
```
apps/electron/src/shared/routes.ts
apps/electron/src/shared/types.ts
apps/electron/src/shared/route-parser.ts
apps/electron/src/renderer/contexts/NavigationContext.tsx
apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx
apps/electron/src/renderer/components/app-shell/AppShell.tsx
apps/electron/src/main/ipc.ts
apps/electron/src/preload/index.ts
```

---

*Generated with Claude Code - 2026-01-25*
