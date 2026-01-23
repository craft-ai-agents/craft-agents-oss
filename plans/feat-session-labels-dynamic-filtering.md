# feat: Session Labels (MVP)

## Overview

Add a simple labeling system for chat sessions that enables users to organize and filter sessions using custom colored labels. Labels are workspace-scoped and support many-to-many relationships with sessions.

**MVP Scope:**
- Create and delete labels (name + preset color)
- Assign/unassign labels to sessions (click-to-toggle)
- Display labels as colored badges in session list
- Filter sessions by clicking labels (OR logic)

## Problem Statement

As users accumulate chat sessions, finding and organizing them becomes difficult. Users need a flexible way to categorize sessions by project, client, topic, or any custom taxonomy.

## Proposed Solution

### Data Model (Minimal)

```typescript
// packages/shared/src/labels/types.ts

interface Label {
  id: string;      // UUID
  name: string;    // 1-50 chars
  color: string;   // From preset palette
}

interface WorkspaceLabelConfig {
  version: 1;
  labels: Label[];
}

// Extend existing SessionHeader
interface SessionHeader {
  // ...existing fields
  labelIds?: string[];  // Default: []
}
```

### Storage

```
~/.vespr/workspaces/{workspaceId}/
├── labels.json              # Label definitions
└── sessions/{sessionId}/
    └── session.jsonl        # Line 1 includes labelIds
```

**labels.json format:**
```json
{
  "version": 1,
  "labels": [
    { "id": "abc123", "name": "Bug", "color": "#ef4444" },
    { "id": "def456", "name": "Feature", "color": "#22c55e" }
  ]
}
```

### Preset Color Palette

8 accessible colors (no custom hex input):

```typescript
export const LABEL_COLORS = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Pink', value: '#ec4899' },
] as const;
```

## Technical Approach

### Phase 1: Core Data Layer

#### 1.1 Types & Storage
**File:** `packages/shared/src/labels/index.ts`

```typescript
// Types
export interface Label { id: string; name: string; color: string; }
export interface WorkspaceLabelConfig { version: number; labels: Label[]; }

// Storage functions
export function getLabelsPath(workspaceRootPath: string): string;
export function loadLabels(workspaceRootPath: string): Label[];
export function saveLabels(workspaceRootPath: string, labels: Label[]): void;
export function createLabel(workspaceRootPath: string, name: string, color: string): Label;
export function deleteLabel(workspaceRootPath: string, labelId: string): void;

// Session label operations
export function setSessionLabels(workspaceRootPath: string, sessionId: string, labelIds: string[]): void;
```

#### 1.2 Extend Session Types
**File:** `packages/shared/src/sessions/types.ts` (modify)

Add `labelIds?: string[]` to `SessionHeader` and `SessionConfig`.

---

### Phase 2: IPC Layer

**File:** `apps/electron/src/main/labels-ipc.ts`

4 IPC handlers:
```typescript
'labels:list'        // () => Label[]
'labels:create'      // (name, color) => Label
'labels:delete'      // (labelId) => void (cascades removal from sessions)
'session:setLabels'  // (sessionId, labelIds) => void
```

**File:** `apps/electron/src/preload/index.ts` (modify)

Expose labels API:
```typescript
labels: {
  list: () => ipcRenderer.invoke('labels:list'),
  create: (name: string, color: string) => ipcRenderer.invoke('labels:create', name, color),
  delete: (id: string) => ipcRenderer.invoke('labels:delete', id),
},
// Add setLabels to existing session commands
```

---

### Phase 3: State Management

**File:** `apps/electron/src/renderer/atoms/labels.ts`

3 atoms only:
```typescript
// All labels in workspace
export const labelsAtom = atom<Label[]>([]);

// Active filter (label IDs to show)
export const activeLabelFilterAtom = atom<string[]>([]);

// Initialize from IPC
export const initializeLabelsAtom = atom(null, async (get, set) => {
  const labels = await window.electronAPI.labels.list();
  set(labelsAtom, labels);
});
```

Filtering logic lives in `SessionList.tsx` (not a separate derived atom):
```typescript
const filteredSessions = useMemo(() => {
  if (activeLabelFilter.length === 0) return sessions;
  return sessions.filter(s =>
    s.labelIds?.some(id => activeLabelFilter.includes(id))
  );
}, [sessions, activeLabelFilter]);
```

---

### Phase 4: UI Components

#### 4.1 LabelBadge
**File:** `apps/electron/src/renderer/components/ui/label-badge.tsx`

Simple colored chip:
```tsx
interface LabelBadgeProps {
  label: Label;
  size?: 'sm' | 'md';
  onClick?: () => void;
  onRemove?: () => void;
}

function getContrastColor(hex: string): '#000' | '#fff' {
  // Simple luminance check
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000' : '#fff';
}
```

#### 4.2 LabelPicker
**File:** `apps/electron/src/renderer/components/labels/LabelPicker.tsx`

Popover with:
- List of existing labels (checkboxes for assignment)
- "New label" input with 8 color buttons
- Delete button (trash icon) per label

Uses existing Popover + Command components.

---

### Phase 5: Integration

#### 5.1 SessionList Integration
**File:** `apps/electron/src/renderer/components/app-shell/SessionList.tsx` (modify)

- Display `LabelBadge` components after session title
- Click badge to toggle filter
- Add "Labels" option to session context menu → opens `LabelPicker`

#### 5.2 Session Context Menu
Add "Labels" menu item that opens `LabelPicker` popover for the session.

---

## File Changes Summary

### New Files (5)

| File | Purpose | Est. Lines |
|------|---------|------------|
| `packages/shared/src/labels/index.ts` | Types + storage | ~80 |
| `apps/electron/src/main/labels-ipc.ts` | IPC handlers | ~60 |
| `apps/electron/src/renderer/atoms/labels.ts` | Jotai atoms | ~40 |
| `apps/electron/src/renderer/components/ui/label-badge.tsx` | Badge component | ~40 |
| `apps/electron/src/renderer/components/labels/LabelPicker.tsx` | Picker popover | ~150 |

**Total: ~370 lines**

### Modified Files (4)

| File | Changes |
|------|---------|
| `packages/shared/src/sessions/types.ts` | Add `labelIds?: string[]` to SessionHeader |
| `apps/electron/src/main/ipc.ts` | Register labels IPC |
| `apps/electron/src/preload/index.ts` | Expose labels API |
| `apps/electron/src/renderer/components/app-shell/SessionList.tsx` | Display badges, filter logic, context menu |

---

## Acceptance Criteria

### Must Have (MVP)
- [x] Users can create labels with name and preset color
- [x] Users can delete labels (removes from all sessions)
- [x] Users can assign/unassign labels to sessions via picker
- [x] Labels display as colored badges in session list
- [x] Clicking a badge filters to show sessions with that label
- [x] Multiple label filter uses OR logic (any match)
- [x] Labels persist across app restarts
- [x] Existing sessions without labels load gracefully (empty array)

### Quality Gates
- [ ] Unit tests for storage functions
- [ ] Migration test: sessions without `labelIds` field
- [ ] Manual QA: create, assign, filter, delete flow

---

## Deferred to v2 (If Users Request)

- Label editing (rename/recolor) - delete and recreate for now
- AND/NOT filter logic
- Keyboard shortcuts
- Sorting by label
- Bulk assignment
- Label description field
- Label ordering/priority
- Command palette integration
- Custom hex colors

---

## Migration Notes

**Existing sessions:** Sessions without `labelIds` should default to `[]`.

```typescript
// In session loading
const labelIds = session.labelIds ?? [];
```

**Label deletion cascade:** When a label is deleted, iterate through sessions and remove the label ID:

```typescript
function deleteLabel(workspaceRootPath: string, labelId: string): void {
  // 1. Remove from labels.json
  const labels = loadLabels(workspaceRootPath);
  saveLabels(workspaceRootPath, labels.filter(l => l.id !== labelId));

  // 2. Remove from all sessions (iterate session headers)
  const sessions = listSessions(workspaceRootPath);
  for (const session of sessions) {
    if (session.labelIds?.includes(labelId)) {
      setSessionLabels(workspaceRootPath, session.id,
        session.labelIds.filter(id => id !== labelId)
      );
    }
  }
}
```

---

## References

### Internal
- Status system pattern: `packages/shared/src/statuses/`
- Session storage: `packages/shared/src/sessions/storage.ts`
- Session atoms: `apps/electron/src/renderer/atoms/sessions.ts`
- Session list UI: `apps/electron/src/renderer/components/app-shell/SessionList.tsx`

### External
- [shadcn/ui Badge](https://ui.shadcn.com/docs/components/badge)
- [shadcn/ui Popover](https://ui.shadcn.com/docs/components/popover)

---

*Simplified based on DHH, Kieran, and Simplicity reviews*
*Date: 2026-01-23*
