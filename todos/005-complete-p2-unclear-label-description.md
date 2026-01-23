---
status: pending
priority: p2
issue_id: "005"
tags: [code-review, ux, documentation]
dependencies: []
---

# Unclear Label and Description for Agentation Setting

## Problem Statement

The label "Agentation" is an opaque/internal term that users won't recognize. The description doesn't explain what information is displayed or why someone would want it.

**Why this matters:** Users cannot make an informed decision about whether to enable this feature, and those searching for debugging tools may not find it.

## Findings

### UX Agent Finding
- **File:** `apps/electron/src/renderer/pages/settings/AppSettingsPage.tsx:718-723`

```typescript
<SettingsToggle
  label="Agentation"  // Unclear term
  description="Show Agentation dev panel for debugging agent interactions."  // Generic
  checked={agentationEnabled}
  onCheckedChange={handleAgentationEnabledChange}
/>
```

### Issues Identified
1. "Agentation" is jargon that doesn't communicate function
2. Description uses the same unclear term
3. No explanation of what the panel shows
4. No use cases mentioned

## Proposed Solutions

### Option 1: Rename to "Agent Debug Panel" (Recommended)
**Description:** Use a more descriptive label and expand the description.

```typescript
<SettingsToggle
  label="Agent Debug Panel"
  description="Shows real-time agent activity, tool calls, and API requests. Useful for debugging and understanding how the AI processes requests."
  checked={agentationEnabled}
  onCheckedChange={handleAgentationEnabledChange}
/>
```

**Pros:**
- Self-explanatory label
- Description explains what it shows and why to use it
- More discoverable

**Cons:**
- Longer text

**Effort:** Trivial
**Risk:** Low

### Option 2: Add "Agent Inspector" Label
**Description:** Alternative naming that emphasizes inspection capability.

```typescript
<SettingsToggle
  label="Agent Inspector"
  description="Opens a developer panel showing agent interactions, tool executions, and debugging information."
  ...
/>
```

**Pros:**
- "Inspector" is a familiar term (like browser DevTools)

**Cons:**
- May not convey all functionality

**Effort:** Trivial
**Risk:** Low

## Recommended Action

_To be filled during triage_

## Technical Details

### Affected Files
- `apps/electron/src/renderer/pages/settings/AppSettingsPage.tsx`

## Acceptance Criteria

- [ ] Label is self-explanatory without prior knowledge
- [ ] Description explains what the panel shows
- [ ] Description mentions use cases
- [ ] Optional: Help link to documentation

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-23 | Created from code review | Developer features still need clear UX |

## Resources

- Design reference: How other apps name their developer tools (Chrome DevTools, React DevTools, etc.)
