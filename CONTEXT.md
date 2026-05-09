# Context — rpi

## Glossary

### Session Files
Files produced inside a specific Claude session's output folder (`sessionFolderPath`). Loaded eagerly in one IPC call (`sessions.GET_FILES`) and returned as a full recursive `SessionFile[]` tree. Displayed in the **Files** tab of the right sidebar via `SessionFilesSection`.

### Workspace Files
Files under the active session's **CWD Root**, loaded lazily — one `readdir` per folder, fetched on expand — via the `workspace.GET_FILES(workspaceId, dirPath?, rootPath?)` IPC channel. Displayed in the **Workspace** tab of the right sidebar via `WorkspaceFilesSection`.

Distinct from Session Files: unbounded size, navigational purpose, lazy-loaded, watcher re-fetches currently-expanded folders on change.

Note: `workspace.rootPath` is an internal metadata directory (`labels/`, `sessions/`, `skills/` etc.) — not a code project. The code project lives at `workingDirectory`, which is always a separate path on disk.

### Workspace File Browser
The `WorkspaceFilesSection` panel rendered in the right sidebar's `workspace` tab. Provides a lazy-loaded, per-folder tree view rooted at the active session's **CWD Root**. Shows an empty state ("No working directory set") when no valid CWD Root exists. Shares icon/thumbnail helpers with `SessionFilesSection` but manages its own loading-state machine for per-node fetching.

### CWD Root
The effective root directory shown in the Workspace File Browser. Resolved from the focused session's `workingDirectory`: returned as-is if it is a real path (not `undefined`, `'none'`, or `'user_default'`); `undefined` otherwise. No workspace-containment check — `workingDirectory` is always outside `workspace.rootPath`.

When defined, passed as the `rootPath` argument to `workspace.GET_FILES` and `workspace.WATCH_FILES`, replacing `workspace.rootPath` as both the security boundary for `dirPath` resolution and the filesystem watch target. The "View" button in the section header opens the CWD Root in the system file manager.

### Sidebar Drill-Down Mode
The state in which the left sidebar expands to session list width (~300 px) and renders the **Session List** inline (with a Back button at the top), replacing the icon strip. Active when `NavigationState.navigator === 'sessions'`. The navigator slot is hidden (width 0) and the **Right Sidebar** is only rendered in this mode. Pressing Back collapses the sidebar back to the icon strip.

### Icon Strip Mode
The collapsed state of the left sidebar (~40 px) showing only navigation icons for Sources, Skills, Automations, and Settings. Active when the sidebar is NOT in Sidebar Drill-Down Mode. The navigator slot opens to the right when a secondary navigation item is selected.
