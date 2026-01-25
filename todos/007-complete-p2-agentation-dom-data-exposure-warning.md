---
status: complete
priority: p2
issue_id: AGEMENT-007
tags: [code-review, security, user-education, agentation]
dependencies: []
blockedBy: []
blocks: []
created: 2026-01-23
updated: 2026-01-23
---

# Agentation: Add DOM Data Exposure Warning in Settings UI

## Problem Statement

Users enabling the Agentation debug panel are not informed that the panel can see all visible DOM content, including conversation text, file paths, and error messages. While this is appropriate for a debug tool in development, users should be explicitly warned before enabling it. The current description is generic and doesn't adequately communicate the data visibility scope.

**Why it matters:**
- **Privacy:** Users should know what data the debug panel can access
- **Trust:** Transparency about third-party tool capabilities builds confidence
- **GDPR/Privacy:** Users should have informed consent
- **Development hygiene:** Developers should know not to use with sensitive data
- **Risk awareness:** Makes clear this is a developer tool, not for production use

## Findings

**Location:** `apps/electron/src/renderer/pages/settings/AppSettingsPage.tsx` (lines 720-730)

**Current Implementation:**
```tsx
<SettingsToggle
  label="Agent Debug Panel"
  description="Shows real-time agent activity, tool calls, and API requests. Useful for debugging and understanding how the AI processes requests."
  checked={agentationEnabled}
  onCheckedChange={handleAgentationEnabledChange}
/>
```

**Issue:** Description doesn't mention:
- ❌ Can see all visible conversation text
- ❌ Can see file paths and content references
- ❌ Can see error messages and debugging info
- ❌ Can see API request/response data
- ❌ Is a developer tool, not for production

**Comparison with Notifications:**
```tsx
<SettingsToggle
  label="Desktop Notifications"
  description="Get notifications when tasks complete."
  // Focused on what user experiences
/>
```

**Note:** Agentation debug panel has broader data visibility than notifications, so warning level should be higher.

## Proposed Solutions

### Solution A: Enhanced Description + Tooltip (RECOMMENDED)
**Effort:** Small | **Risk:** Very Low | **Complexity:** Low

Improve description to clearly communicate data visibility:

```tsx
<div className="space-y-3">
  <SettingsToggle
    label="Agent Debug Panel"
    description={
      <>
        <p className="text-sm text-muted-foreground">
          Shows real-time agent activity, including tool calls, API requests, and DOM analysis. This panel can see all visible conversation content, file references, and error messages.
        </p>
        <p className="text-xs text-amber-600 dark:text-amber-500 mt-2 font-medium">
          ⚠️ Developer tool only. Do not enable with sensitive conversations or production data.
        </p>
      </>
    }
    checked={agentationEnabled}
    onCheckedChange={handleAgentationEnabledChange}
  />
</div>
```

**Pros:**
- Clear, explicit warning
- Explains what panel can see
- Matches security review findings
- No extra components needed

**Cons:**
- Longer description (but justified)
- Warning might deter legitimate use

### Solution B: Description + Dialog Confirmation
**Effort:** Medium | **Risk:** Low | **Complexity:** Medium

Add warning dialog when enabling:

```tsx
const [showWarning, setShowWarning] = useState(false)

const handleAgentationEnabledChange = useCallback(async (enabled: boolean) => {
  if (enabled && !agentationEnabled) {
    // First time enabling - show warning
    setShowWarning(true)
    return
  }

  // Disabling or already acknowledged
  setAgentationEnabled(enabled)
  try {
    await window.electronAPI?.setAgentationEnabled(enabled)
  } catch (error) {
    console.error('Failed to save Agentation setting:', error)
    setAgentationEnabled(!enabled)
  }
}, [agentationEnabled])

// In JSX:
<AlertDialog open={showWarning} onOpenChange={setShowWarning}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Enable Debug Panel?</AlertDialogTitle>
      <AlertDialogDescription>
        The Agent Debug Panel can see all visible conversation content, including messages, file paths, and API responses. Only enable this for development purposes.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={() => {
        setShowWarning(false)
        setAgentationEnabled(true)
        window.electronAPI?.setAgentationEnabled(true)
      }}>
        Enable Debug Panel
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

**Pros:**
- Very explicit warning
- Requires conscious confirmation
- Users can't enable accidentally
- Captures informed consent

**Cons:**
- Extra dialog interaction
- More code to maintain
- Might be annoying on toggle

### Solution C: Inline Warning Badge
**Effort:** Small | **Risk:** Very Low | **Complexity:** Low

Add warning badge next to toggle:

```tsx
<div className="flex items-center gap-2">
  <SettingsToggle
    label="Agent Debug Panel"
    description="Shows real-time agent activity, tool calls, and API requests."
    checked={agentationEnabled}
    onCheckedChange={handleAgentationEnabledChange}
  />
  <Badge variant="destructive" className="ml-2">
    Dev Only
  </Badge>
</div>
```

**Pros:**
- Lightweight warning
- Visually prominent
- No extra dialogs

**Cons:**
- Doesn't explain scope clearly
- Badge alone insufficient for informed consent

## Recommended Action

**IMPLEMENT: Solution A (Enhanced Description + Warning)**

The enhanced description is clear, explicit, and doesn't require extra interaction. Users see exactly what they're enabling. The warning text matches security review findings about DOM visibility.

## Technical Details

**Affected Files:**
- `apps/electron/src/renderer/pages/settings/AppSettingsPage.tsx` (lines 720-730)

**Components to update:**
- `SettingsToggle` description prop (lines 727)

**No API changes required.**

**No new dependencies required.**

## Acceptance Criteria

- [ ] Description updated to mention visible data access scope
- [ ] Warning added about developer-only use
- [ ] Text mentions: conversation content, file paths, API data
- [ ] Visual treatment (amber/warning color) applied
- [ ] Manual test: Open settings → read description → clear what panel can access
- [ ] Manual test: Settings display properly on light and dark theme
- [ ] TypeScript compiles without errors

## Work Log

- **2026-01-23 10:15** - Issue identified during security review
- **2026-01-23 10:22** - Solutions analyzed
- **Pending** - Implementation

## Related Issues

- Related: AGEMENT-003 (license verification - legal review)
- Related: Security review findings about data visibility

## Resources

- Settings page patterns: See other SettingsToggle examples in AppSettingsPage.tsx
- Warning colors: Tailwind `amber-600`, `destructive` variant
- Dark mode: Both light and dark colors specified

## Security Rationale

From security review:
> "Agentation can see all visible DOM content (chat messages, file paths, errors). This is appropriate for a debug panel but users should be aware."

The warning makes explicit what the security team identified: the component has broad visibility into user content.

## User Impact

**Before:**
- User enables debug panel without understanding scope
- User shares screenshot with sensitive data visible to panel
- User doesn't realize panel has access

**After:**
- User sees clear warning about data visibility
- User makes informed decision
- Reduces privacy surprises

## Testing Checklist

- [ ] Verify description text renders correctly
- [ ] Verify warning color visible on both light/dark themes
- [ ] Test that toggle still works normally
- [ ] Verify text wraps properly on narrow screens
- [ ] Check that description doesn't overflow settings card
- [ ] Ensure accessibility: screen reader reads warning
- [ ] Mobile testing: warning visible and readable on small screens
