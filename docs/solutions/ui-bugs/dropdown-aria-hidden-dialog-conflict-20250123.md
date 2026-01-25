---
module: Vesper
date: 2025-01-23
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Dropdown buttons in Schedule modal don't respond to clicks"
  - "Console error: Blocked aria-hidden on an element because its descendant retained focus"
  - "Time selection dropdowns (hour, minute, AM/PM) fail to open"
root_cause: scope_issue
resolution_type: code_fix
severity: high
tags: [radix-ui, dialog, select, portal, aria-hidden, focus-management]
---

# Troubleshooting: Radix Select/Popover/DropdownMenu Not Working Inside Dialog

## Problem
Select, Popover, and DropdownMenu components fail to open or respond to clicks when nested inside a Radix Dialog. The browser blocks the interaction due to aria-hidden focus conflicts.

## Environment
- Module: Vesper Electron App
- Stack: React + Radix UI (shadcn/ui)
- Affected Components: Select, Popover, DropdownMenu inside Dialog
- Date: 2025-01-23

## Symptoms
- Clicking dropdown trigger buttons does nothing
- Console warning: `Blocked aria-hidden on an element because its descendant retained focus`
- Error mentions: `Element with focus: <button...>` and `Ancestor with aria-hidden: <div.popover-styled...>`
- All similar dropdowns (Select, Popover, DropdownMenu) exhibit the same behavior inside modals

## What Didn't Work

**Attempted Solution 1:** Adding `onPointerDownOutside` handler to Dialog
- **Why it failed:** This only prevented the dialog from closing when clicking portaled content, but didn't fix the aria-hidden focus conflict

**Attempted Solution 2:** Adding `onOpenAutoFocus` handler with `e.preventDefault()`
- **Why it failed:** This allowed Select to manage focus but didn't address the fundamental portal location issue

## Solution

Create a context-based portal container system that portals dropdown content INTO the Dialog instead of to `document.body`.

**Code changes:**

```tsx
// dialog.tsx - Add context to provide portal container

// 1. Create context at top of file
const DialogPortalContainerContext = React.createContext<HTMLElement | null>(null)

export function useDialogPortalContainer() {
  return React.useContext(DialogPortalContainerContext)
}

// 2. In DialogContent, capture ref and provide via context
function DialogContent({ children, ...props }) {
  const [portalContainer, setPortalContainer] = React.useState<HTMLElement | null>(null)

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={setPortalContainer}  // Capture the dialog content element
        {...props}
      >
        <DialogPortalContainerContext.Provider value={portalContainer}>
          {children}
        </DialogPortalContainerContext.Provider>
        {/* close button */}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}
```

```tsx
// select.tsx - Use dialog container for portal

import { useDialogPortalContainer } from "./dialog"

function SelectContent({ children, ...props }) {
  // Use dialog's portal container when inside a dialog
  const dialogContainer = useDialogPortalContainer()

  return (
    <SelectPrimitive.Portal container={dialogContainer}>
      <SelectPrimitive.Content {...props}>
        {children}
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}
```

Apply the same pattern to `popover.tsx` and `dropdown-menu.tsx`.

## Why This Works

**Root Cause:** When Radix Dialog opens, it applies `aria-hidden="true"` to all content outside the dialog to hide it from screen readers. When a Select opens inside the dialog, its content gets portaled to `document.body` (outside the dialog). Focus moves to this portaled content. Now there's a conflict: the browser tries to apply aria-hidden to content outside the dialog, but you're actively focused on that content. The browser blocks this and the interaction fails.

**Why the fix works:**
1. By providing the dialog content element as a portal container via React context
2. Child components (Select, Popover, DropdownMenu) detect they're inside a dialog
3. They portal their content INTO the dialog instead of to `document.body`
4. Focus stays inside the dialog's "visible" area
5. No aria-hidden conflict occurs

**Key insight:** When `useDialogPortalContainer()` returns `null` (outside a dialog), components portal to body as usual. When it returns the dialog element, they portal there instead.

## Prevention

1. **Always use this pattern** when building UI component libraries with nested portals
2. **Test dropdowns inside modals** as part of component QA
3. **Watch for aria-hidden warnings** in console - they indicate portal/focus conflicts
4. **Consider adding this pattern to shadcn/ui** if using that library

## Diagnostic Prompt for Future Bugs

When encountering similar issues, provide Claude with:

```
I have a bug where [specific interaction] doesn't work.

**Error from DevTools:**
[paste exact console error]

**Component structure:**
- Parent: [Dialog/Modal/Sheet]
- Child that fails: [Select/Popover/Dropdown]
- UI Library: [Radix/shadcn/etc.]

**What happens:**
- Expected: [dropdown opens]
- Actual: [nothing happens / closes immediately]
```

Key phrases that help identify this class of bug:
- "aria-hidden conflict"
- "portal inside modal"
- "focus trapped"
- "dropdown closes immediately in dialog"
- "Radix portal container"

## Related Issues

No related issues documented yet.

## Files Modified

- `apps/electron/src/renderer/components/ui/dialog.tsx` - Added context provider
- `apps/electron/src/renderer/components/ui/select.tsx` - Use dialog container
- `apps/electron/src/renderer/components/ui/popover.tsx` - Use dialog container
- `apps/electron/src/renderer/components/ui/dropdown-menu.tsx` - Use dialog container
