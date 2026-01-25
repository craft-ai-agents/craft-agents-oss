# 017 - P3: Split Large DiagramRenderer Component

**Status:** Pending
**Priority:** P3 (Nice-to-Have)
**Type:** Code Quality
**Tags:** code-review, quality, flowy

## Problem

The `DiagramRenderer.tsx` component has grown to 1079 lines, making it difficult to maintain and test. Multiple rendering logic paths are intermingled, reducing code clarity and reusability.

## Location

- `apps/electron/src/renderer/components/diagram/DiagramRenderer.tsx` (1079 lines)

## Current Impact

- Single component handles flowchart rendering, mockup rendering, and component rendering
- Difficult to test individual rendering logic
- Hard to extend for new diagram types
- Code organization reduces maintainability

## Suggested Solution

Split DiagramRenderer into smaller, focused components:

1. **FlowchartRenderer.tsx** - Handle flowchart-specific rendering
2. **MockupRenderer.tsx** - Handle mockup/wireframe rendering
3. **ComponentRenderers/** - Separate components for different node/edge types
4. **utils/** - Shared rendering utilities and helpers

## Acceptance Criteria

- [ ] Components are extracted and organized logically
- [ ] Each component is under 400 lines
- [ ] Existing functionality remains unchanged
- [ ] All rendering output is identical to current behavior

## Notes

Lower priority as current implementation works. Should be addressed as part of larger refactoring effort.

## Work Log

- 2026-01-25: Created from code review
- 2026-01-25: Verified still valid - DiagramRenderer.tsx is 1084 lines (still > 1000). Issue remains pending for future refactoring.
