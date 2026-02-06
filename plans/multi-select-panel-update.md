# Plan: Update Multi-Select Panel actions

## Goals
- Replace Delete with **Archive** (neutral styling).
- Replace fixed status buttons with **Change Status** dropdown and **Set Labels** dropdown.
- Reuse existing status/labels menu logic from `SessionMenu`.
- Style all buttons as **bg-background shadow-minimal**.
- Implement label toggling for multi-select: **add if missing / remove if all selected already have it**.

## Steps
1. **Create shared menu renderers**
   - Extract reusable helpers from `SessionMenu` for:
     - Status submenu list (uses `todoStates`, `getStateIcon`, `getStateColor`).
     - Label submenu list (`LabelMenuItems` with toggles).
   - Place in a small shared helper (e.g., `components/app-shell/SessionMenuParts.tsx`) or export needed pieces from `SessionMenu`.

2. **Wire dropdowns into `MultiSelectPanel`**
   - Use `DropdownMenu` + `DropdownMenuProvider` + extracted helpers.
   - Add **Change Status** and **Set Labels** buttons that trigger dropdowns.
   - Apply `bg-background shadow-minimal` to each button and keep sizes consistent.

3. **Implement batch actions**
   - Add `onArchive` handler in `MainContentPanel` to archive all selected sessions.
   - Add `onSetStatus` handler to set a selected status for all sessions.
   - Add `onToggleLabel` handler:
     - Compute label presence across selected sessions.
     - If **all** selected have the label → remove it from all.
     - Otherwise add it to all (preserving other labels).

4. **Polish copy and hints**
   - Ensure subtext uses `text-foreground/50` (per UI guidelines).
   - Replace raw shortcut text with `Kbd` / `KbdGroup`.

## Files to update
- `apps/electron/src/renderer/components/app-shell/MultiSelectPanel.tsx`
- `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx`
- (New or refactor) `apps/electron/src/renderer/components/app-shell/SessionMenuParts.tsx` or exported helpers in `SessionMenu.tsx`

## Notes
- Archive should be **neutral** (not destructive).
- Label toggling is **all-or-nothing** across selected sessions.
