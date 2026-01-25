---
status: pending
priority: p3
issue_id: "006"
tags: [code-review, ux, templates, enhancement]
dependencies: []
---

# Problem Statement

**Initial Prompt Handling Could Be More Flexible**

Templates with `initialPrompt` pre-fill the input box but don't auto-send. This is intentional, but there's no way for users to choose "auto-send" behavior for templates they use frequently.

**Why This Matters:**
- Power users want one-click session creation
- Common workflows could be fully automated
- Current UX requires extra click to send initial prompt

## Findings

### Current Behavior

**Location:** Template feature design (from PR description)

> **Initial prompt behavior**: Pre-filled in input box (not auto-sent)

**Example Workflow:**
1. User selects "Code Review" template
2. Template has initial prompt: "Review the PR and create todos for findings"
3. Prompt is pre-filled in input box
4. User must click "Send" to start

**Why This Design:**
- Safer (user can review/edit prompt)
- Prevents accidental message sends
- Gives user control

### Alternative Design (Not Currently Supported)

**User Story:** As a power user, I want templates to auto-send the initial prompt so I can start a code review session with one click.

**Proposed Enhancement:**

```typescript
export interface SessionTemplate {
  // ... existing fields
  initialPrompt?: string;
  autoSendInitialPrompt?: boolean;  // ← New field
}
```

**Behavior:**
- If `autoSendInitialPrompt === true` → Send prompt immediately after session creation
- If `autoSendInitialPrompt === false` or undefined → Pre-fill only (current behavior)

### Similar Features in Other Apps

- **GitHub Issue Templates:** Can auto-populate and auto-assign
- **Email Templates:** Can auto-send or save as draft
- **Slack Workflows:** Can auto-execute or require confirmation

## Proposed Solutions

### Solution 1: Add Auto-Send Option (Enhancement)

**Add `autoSendInitialPrompt` field to templates.**

**Implementation:**

```typescript
// packages/shared/src/templates/types.ts

export interface SessionTemplate {
  id: string;
  name: string;
  description?: string;
  scope: 'workspace' | 'global';
  workspaceId?: string;

  // Session Configuration
  initialPrompt?: string;
  autoSendInitialPrompt?: boolean;  // ← New field
  skillIds?: string[];
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  model?: string;
  thinkingLevel?: number;
  workingDirectory?: string;

  // Metadata
  createdAt: string;
  updatedAt: string;
  usageCount?: number;
}
```

**UI Update:**

```typescript
// apps/electron/src/renderer/components/templates/CreateTemplateDialog.tsx

<div className="flex items-center gap-2">
  <input
    type="checkbox"
    id="auto-send-prompt"
    checked={autoSendInitialPrompt}
    onChange={e => setAutoSendInitialPrompt(e.target.checked)}
    disabled={!includeInitialPrompt}  // Only enable if initial prompt is included
    className="cursor-pointer"
  />
  <Label htmlFor="auto-send-prompt" className="cursor-pointer text-sm font-normal">
    Auto-send initial prompt (skips review step)
  </Label>
</div>
```

**Session Creation Logic:**

```typescript
// apps/electron/src/renderer/components/app-shell/SessionList.tsx

onSelectCallback: async (template, initialPrompt) => {
  const session = await window.electronAPI.createSession(workspaceId, options);

  if (template?.autoSendInitialPrompt && initialPrompt) {
    // Auto-send the prompt
    await window.electronAPI.sendMessage(session.id, initialPrompt);
    navigate({ sessionId: session.id });
  } else if (initialPrompt) {
    // Pre-fill only (current behavior)
    navigate({ sessionId: session.id, initialPrompt });
  } else {
    // No prompt
    navigate({ sessionId: session.id });
  }
}
```

**Pros:**
- Gives users choice
- Supports both workflows
- Backward compatible (undefined = pre-fill only)

**Cons:**
- More complexity
- Need to handle auto-send failures
- Could be confusing for novice users

**Effort:** Small (1-2 hours)
**Risk:** Low (enhancement, not breaking change)

### Solution 2: Keep Current Design

**Don't add auto-send, keep pre-fill only.**

**Pros:**
- Simpler
- Safer (no accidental sends)
- Less code to maintain

**Cons:**
- Power users need extra click
- Misses automation opportunity

**Effort:** None
**Risk:** None

## Recommended Action

**Solution 2 (Keep Current Design)**

The current design is safer and gives users control. Auto-send can be added later if users request it.

**Rationale:**
- This is a P3 enhancement, not a critical issue
- Current UX is good enough for v1
- Can add auto-send in follow-up PR if users want it

**If users frequently request auto-send:**
- Implement Solution 1
- Add setting to workspace/global preferences for default auto-send behavior

## Technical Details

**Affected Files (if implementing):**
- `packages/shared/src/templates/types.ts` (add field)
- `packages/shared/src/templates/storage.ts` (no changes needed, field is optional)
- `apps/electron/src/renderer/components/templates/CreateTemplateDialog.tsx` (UI checkbox)
- `apps/electron/src/renderer/components/app-shell/SessionList.tsx` (auto-send logic)

**Edge Cases to Handle:**
- What if auto-send fails? (network error, agent not ready)
- Should user see the message being sent? (probably yes, for transparency)
- Should auto-send respect permission mode? (yes, if mode is "ask", should prompt)

## Acceptance Criteria (if implementing)

- [ ] Add `autoSendInitialPrompt` field to `SessionTemplate` interface
- [ ] Add checkbox to CreateTemplateDialog (disabled if no initial prompt)
- [ ] Auto-send prompt when template has `autoSendInitialPrompt: true`
- [ ] Pre-fill prompt when `autoSendInitialPrompt: false` or undefined
- [ ] Handle auto-send failures gracefully (show error toast, fall back to pre-fill)
- [ ] Add unit test for auto-send logic
- [ ] Document behavior in template picker UI

## Work Log

### 2026-01-25
- **Identified:** Enhancement opportunity for auto-send initial prompts
- **Analysis:** Current design is intentionally safe (pre-fill only)
- **Priority:** P3 (enhancement, not critical for v1)
- **Recommendation:** Keep current design, revisit if users request feature
- **VERIFIED STILL PENDING:** Feature intentionally not implemented:
  - This is a P3 enhancement, not a bug
  - Current design pre-fills prompts without auto-sending (safe UX)
  - No `autoSendInitialPrompt` field exists in SessionTemplate type
  - Recommendation remains: Keep current design, add if users request it
  - Status: Correctly marked as pending enhancement

## Resources

- **PR:** https://github.com/AskTinNguyen/vesper/pull/2
- **Design Decision:** Initial prompt pre-fills but doesn't auto-send
- **Similar Features:** GitHub issue templates, email drafts, Slack workflows
- **Future Enhancement:** Could add in follow-up PR based on user feedback
