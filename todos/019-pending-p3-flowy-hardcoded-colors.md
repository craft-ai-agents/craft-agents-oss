# 019 - P3: Extract Hardcoded Colors to Design Tokens

**Status:** Pending
**Priority:** P3 (Nice-to-Have)
**Type:** Code Quality
**Tags:** code-review, quality, flowy

## Problem

The DiagramRenderer contains 28+ unique hex color values hardcoded throughout the component. This makes it difficult to maintain a consistent color scheme, apply theming, or update colors globally.

## Location

- `apps/electron/src/renderer/components/diagram/DiagramRenderer.tsx` (hardcoded hex values scattered throughout)

## Current Impact

- Color scheme is tightly coupled to component implementation
- Changing colors requires multiple edits across the file
- Theming support is complicated or impossible
- Color inconsistencies may develop over time
- No centralized source of truth for diagram colors

## Suggested Solution

Extract colors to a centralized design tokens file:

1. Create `apps/electron/src/renderer/components/diagram/colors.ts`
2. Define color constants for:
   - Node types (process, decision, data, etc.)
   - Edges (default, selected, hover states)
   - Text and labels
   - Backgrounds and accents
3. Reference constants throughout DiagramRenderer
4. Consider adding theme variants if needed

Example structure:
```typescript
export const DIAGRAM_COLORS = {
  nodes: {
    process: '#3B82F6',
    decision: '#F59E0B',
    // ...
  },
  edges: {
    default: '#6B7280',
    selected: '#3B82F6',
    // ...
  },
};
```

## Acceptance Criteria

- [ ] All hardcoded colors extracted to constants
- [ ] Constants organized logically by type
- [ ] DiagramRenderer imports and uses constants
- [ ] Visual output unchanged

## Notes

Lower priority aesthetic improvement. Useful for future theming support and maintainability.

## Work Log

- 2026-01-25: Created from code review
- 2026-01-25: Verified still valid - found 61 hex color values hardcoded in DiagramRenderer.tsx. No centralized color constants or design tokens exist. Issue remains pending.
