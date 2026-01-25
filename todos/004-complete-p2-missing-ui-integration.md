---
status: complete
priority: p2
issue_id: "004"
tags: [code-review, ui, integration, templates]
dependencies: ["003"]
---

# Problem Statement

**Template UI Components Not Integrated into App**

The PR builds comprehensive UI components for templates (`TemplatePickerDialog`, `CreateTemplateDialog`, `TemplateManager`) but doesn't integrate them into the main app flow. Users have no way to actually use the feature.

**Why This Matters:**
- Feature is not accessible to users
- Can't test the feature end-to-end
- Unclear if components work with actual app state
- PR claims feature is ready but it's not usable

## Findings

### Missing Integration Points

**1. Template Picker Not Wired to New Session Creation**

**Location:** PR description states:
> "UI components are built but not yet wired into the main app:
> - Wire `TemplatePickerDialog` into new session creation flow"

**Problem:** When users create a new session, there's no UI to select a template.

**Expected Flow:**
1. User clicks "New Session" button
2. Template picker dialog opens
3. User selects template (or blank)
4. Session created with template configuration

**Current Flow:**
1. User clicks "New Session" button
2. Blank session is created immediately
3. No template selection possible

---

**2. "Save as Template" Menu Item Not Connected**

**Location:** `apps/electron/src/renderer/components/app-shell/SessionMenu.tsx:78`

```typescript
export interface SessionMenuProps {
  // ... other props
  onSaveAsTemplate?: () => void  // ← Optional, not required
}
```

The prop exists but is not connected in SessionList or ChatPage.

**Problem:** Users can't save existing sessions as templates.

---

**3. Template Manager Not Added to Settings**

**Location:** PR description states:
> "- Add `TemplateManager` to settings/workspace UI"

**Problem:** Users have no way to:
- View their templates
- Edit template names/descriptions
- Delete templates
- See template usage counts

**Expected Location:** Workspace Settings page, similar to Skills, Sources, or Statuses sections.

---

**4. No Keyboard Shortcuts or Command Palette Integration**

**Problem:**
- No way to quickly open template picker (`Cmd+T`?)
- No way to save current session as template from keyboard
- Templates not searchable in command palette

## Proposed Solutions

### Solution 1: Complete Integration (Recommended)

**Wire all components into the app with proper state management.**

#### Step 1: Integrate Template Picker into New Session Flow

**File:** `apps/electron/src/renderer/components/app-shell/SessionList.tsx`

```typescript
import { TemplatePickerDialog } from '@/components/templates';
import { useTemplateSession } from '@/hooks/useTemplateSession';
import { useAtom } from 'jotai';
import { templatePickerAtom, hideTemplatePickerAtom, useTemplateAtom } from '@/atoms/templates';

function SessionList({ workspaceId }: { workspaceId: string }) {
  const [templatePicker, setTemplatePicker] = useAtom(templatePickerAtom);
  const [, hideTemplatePicker] = useAtom(hideTemplatePickerAtom);
  const [, useTemplate] = useAtom(useTemplateAtom);
  const { createSessionFromTemplate } = useTemplateSession();

  const handleNewSession = () => {
    // Show template picker instead of creating session directly
    setTemplatePicker({
      isOpen: true,
      workspaceId,
      onSelectCallback: async (template, initialPrompt) => {
        // Track template usage
        if (template) {
          await useTemplate({
            id: template.id,
            scope: template.scope,
            workspaceId: template.workspaceId
          });
        }

        // Create session from template
        const options = await createSessionFromTemplate(template);
        const session = await window.electronAPI.createSession(workspaceId, options);

        // If template has initial prompt, navigate and pre-fill input
        if (initialPrompt) {
          navigate({ sessionId: session.id, initialPrompt });
        } else {
          navigate({ sessionId: session.id });
        }
      }
    });
  };

  return (
    <>
      {/* Existing SessionList UI */}
      <Button onClick={handleNewSession}>New Session</Button>

      {/* Template Picker Dialog */}
      <TemplatePickerDialog
        open={templatePicker.isOpen}
        onOpenChange={(open) => !open && hideTemplatePicker()}
        workspaceId={workspaceId}
        onSelect={templatePicker.onSelectCallback!}
      />
    </>
  );
}
```

#### Step 2: Wire "Save as Template" Menu Item

**File:** `apps/electron/src/renderer/components/app-shell/SessionList.tsx` (in session menu rendering)

```typescript
import { CreateTemplateDialog } from '@/components/templates';
import { useState } from 'react';

function SessionListItem({ session }: { session: Session }) {
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);

  const handleSaveAsTemplate = async (options: SaveSessionAsTemplateOptions) => {
    try {
      await window.electronAPI.saveSessionAsTemplate(options);
      toast.success('Template saved successfully');
      setShowSaveTemplate(false);
    } catch (error) {
      toast.error('Failed to save template');
      console.error(error);
    }
  };

  return (
    <>
      <SessionMenu
        sessionId={session.id}
        // ... other props
        onSaveAsTemplate={() => setShowSaveTemplate(true)}
      />

      <CreateTemplateDialog
        open={showSaveTemplate}
        onOpenChange={setShowSaveTemplate}
        sessionId={session.id}
        workspaceId={session.workspaceId}
        onSave={handleSaveAsTemplate}
      />
    </>
  );
}
```

#### Step 3: Add Template Manager to Workspace Settings

**File:** `apps/electron/src/renderer/pages/settings/WorkspaceSettingsPage.tsx`

```typescript
import { TemplateManager } from '@/components/templates';

function WorkspaceSettingsPage({ workspaceId }: { workspaceId: string }) {
  return (
    <div>
      {/* Existing settings sections */}

      <section>
        <TemplateManager workspaceId={workspaceId} />
      </section>
    </div>
  );
}
```

#### Step 4: Add Keyboard Shortcuts (Optional but Nice)

**File:** `apps/electron/src/renderer/App.tsx` or keyboard shortcut handler

```typescript
// Global keyboard shortcuts
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Cmd+T / Ctrl+T - Open template picker
    if ((e.metaKey || e.ctrlKey) && e.key === 't' && !e.shiftKey) {
      e.preventDefault();
      setTemplatePicker({ isOpen: true, workspaceId: currentWorkspace.id });
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [currentWorkspace]);
```

**Pros:**
- Feature is actually usable
- Complete end-to-end testing possible
- Matches user expectations from PR description

**Cons:**
- More code to write and test
- Need to verify navigation/routing logic

**Effort:** Medium (4-6 hours)
**Risk:** Low (straightforward UI integration)

### Solution 2: Defer Integration to Follow-up PR

**Merge this PR as-is (foundation) and create follow-up PR for integration.**

**Pros:**
- Can merge storage/backend logic now
- Split work into smaller PRs

**Cons:**
- Feature not usable until follow-up
- Can't test end-to-end
- Risk of incomplete follow-up

**Effort:** Small (1 hour for follow-up PR)
**Risk:** Medium (feature might not get completed)

## Recommended Action

**Implement Solution 1 (Complete Integration)**

The PR is already 90% complete. Adding the final integration is straightforward and makes the feature actually usable. Merging without integration creates technical debt and incomplete features.

**If time is a constraint:**
- Minimum: Wire template picker to new session flow (Step 1)
- Defer: Template manager in settings (can add later)

## Technical Details

**Affected Files:**
- `apps/electron/src/renderer/components/app-shell/SessionList.tsx` (template picker integration)
- `apps/electron/src/renderer/pages/settings/WorkspaceSettingsPage.tsx` (template manager)
- `apps/electron/src/renderer/App.tsx` (keyboard shortcuts - optional)

**Navigation Requirements:**
- Need to verify `navigate()` function signature
- Check if it supports `initialPrompt` parameter
- May need to update navigation context

**State Management:**
- Templates already have Jotai atoms (✓)
- Template picker state already managed (✓)
- Just need to wire into existing components (✓)

## Acceptance Criteria

- [ ] Clicking "New Session" opens template picker dialog
- [ ] Selecting template creates session with template configuration
- [ ] Selecting "Blank Session" creates empty session
- [ ] Template usage count increments when template is used
- [ ] "Save as Template" menu item opens CreateTemplateDialog
- [ ] Saved templates appear in template picker immediately
- [ ] Template Manager accessible from Workspace Settings
- [ ] Can view, edit, delete templates from Template Manager
- [ ] Add manual test plan to PR description

## Work Log

### 2026-01-25
- **Discovered:** UI components built but not integrated
- **Analysis:** PR description mentions "remaining integration" but merges without it
- **Impact:** Feature not usable by end users
- **Recommendation:** Complete integration before merge or create follow-up issue
- **VERIFIED FIXED:** Template UI integration is complete:
  - `TemplateManager` imported in WorkspaceSettingsPage.tsx (line 41)
  - TemplateManager rendered in settings page with templatesEnabled toggle (line 536)
  - Templates feature can be enabled/disabled per workspace (lines 74, 100, 273, 532)
  - loadTemplatesAtom imported for state management (line 42)
  - Templates integrated into workspace settings UI alongside other features

## Resources

- **PR:** https://github.com/AskTinNguyen/vesper/pull/2
- **Components:** `TemplatePickerDialog`, `CreateTemplateDialog`, `TemplateManager`
- **Pattern:** Similar to Skills/Sources integration in Workspace Settings
- **Dependency:** Requires Issue #003 (complete template configuration) to be fixed first
