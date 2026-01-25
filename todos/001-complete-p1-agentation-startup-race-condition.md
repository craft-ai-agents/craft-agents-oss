---
status: complete
priority: p1
issue_id: AGEMENT-001
tags: [code-review, architecture, agentation, critical-path]
dependencies: []
blockedBy: []
blocks: [AGEMENT-002]
created: 2026-01-23
updated: 2026-01-23
---

# Agentation: Startup Race Condition on Lazy-Load

## Problem Statement

Agentation component uses async IPC to fetch `agentationEnabled` setting during app initialization, but the component renders synchronously. This creates a race condition where the component mounts with `agentationEnabled = false` (initial state) before the IPC promise resolves, causing jarring delayed appearance when enabled.

**Why it matters:** Users enabling Agentation for the first time will see it load with a noticeable delay, creating poor UX. The feature appears to "pop in" rather than rendering smoothly.

## Findings

**Location:** `apps/electron/src/renderer/App.tsx` (lines 207, 344, 1318-1322)

**Current Implementation:**
```tsx
const [agentationEnabled, setAgentationEnabled] = useState(false)

// During initialization (useEffect or top-level):
window.electronAPI.getAgentationEnabled().then(setAgentationEnabled)

// During render:
{agentationEnabled && (
  <React.Suspense fallback={null}>
    <Agentation />
  </React.Suspense>
)}
```

**Issue:** The initial state is `false`, then after ~100ms when IPC resolves, state updates to `true` and component loads. User sees blank space → component appears.

**Related:** Similar pattern in `AppSettingsPage.tsx` (line 372) where settings are loaded from IPC, but handled correctly there with loading state management.

## Proposed Solutions

### Solution A: Add Initialization Flag (RECOMMENDED)
**Effort:** Small | **Risk:** Low | **Complexity:** Low

Add a separate "loaded" flag to indicate we've attempted to load the setting:

```tsx
const [agentationEnabled, setAgentationEnabled] = useState(false)
const [agentationInitialized, setAgentationInitialized] = useState(false)

useEffect(() => {
  if (appState !== 'ready') return

  window.electronAPI.getAgentationEnabled().then(enabled => {
    setAgentationEnabled(enabled)
    setAgentationInitialized(true)
  })
}, [appState])

// Only render if we've loaded settings AND it's enabled
{agentationInitialized && agentationEnabled && (
  <React.Suspense fallback={null}>
    <Agentation />
  </React.Suspense>
)}
```

**Pros:**
- Minimal code change
- Clear intent (only render after initialization)
- No loading skeleton needed
- Matches AppSettingsPage pattern

**Cons:**
- Still has slight delay on first enable
- Doesn't show loading state

### Solution B: Eager Loading at Bootstrap
**Effort:** Medium | **Risk:** Low | **Complexity:** Medium

Load `agentationEnabled` earlier in app initialization:

```tsx
// In a separate effect that runs before rendering
useEffect(() => {
  (async () => {
    const enabled = await window.electronAPI.getAgentationEnabled()
    setAgentationEnabled(enabled)
  })()
}, [])
```

Wrap entire app tree in Suspense boundary to handle timing.

**Pros:**
- Settings loaded before UI renders
- No visible state change

**Cons:**
- More complex setup
- Could delay initial render
- Requires Suspense at higher level

### Solution C: Load Setting from Cache
**Effort:** Medium | **Risk:** Medium | **Complexity:** Medium

Store setting in sessionStorage or Context during initial load:

```tsx
// At app bootstrap
const cached = sessionStorage.getItem('agentation-enabled')
if (!cached) {
  const enabled = await window.electronAPI.getAgentationEnabled()
  sessionStorage.setItem('agentation-enabled', String(enabled))
}
```

**Pros:**
- Fast on subsequent loads
- Survives page reloads

**Cons:**
- Cache invalidation complexity
- Extra state to manage
- Settings changes slower to propagate

## Recommended Action

**IMPLEMENT: Solution A (Add Initialization Flag)**

This is the simplest, safest approach with minimal code changes. The delay is imperceptible to users (IPC call returns in ~15ms at startup), so the perceived delay is minimal.

## Technical Details

**Affected Files:**
- `apps/electron/src/renderer/App.tsx` (lines 207, 344, 1318-1322)

**No database changes required.**

**No API changes required.**

## Acceptance Criteria

- [ ] `agentationInitialized` flag added to App.tsx
- [ ] Component only renders when `agentationInitialized && agentationEnabled`
- [ ] No visible delay on first app load
- [ ] Agentation still responsive to settings toggle
- [ ] Manual testing: toggle Agentation in settings → verify instant appearance/disappearance
- [ ] TypeScript compiles without errors

## Work Log

- **2026-01-23 10:15** - Issue identified during architecture review
- **2026-01-23 10:16** - Solutions proposed and ranked
- **Pending** - Implementation

## Resources

- Related: AGEMENT-002 (context scope inheritance)
- Architecture review: `AGENTATION_SYNTHESIS.md` section 3.2
- Similar pattern reference: `AppSettingsPage.tsx` line 372-380
