# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

- **ComfyUI-powered Media Lab** — connects Image and Video creation to the local ComfyUI service, can start the existing D-drive installation from the header, discovers API-format workflows including installed Agnes nodes, exposes safe typed parameters, supports submission, polling, and cancellation, and isolates app-submitted creations in `D:\Comfyui\output\ARCHstudio` for a dedicated Library without changing saved workflows or direct ComfyUI output behavior.

- **Save to Memory from Activity cards** — each activity card in the Activities panel now has a "Memory" button that opens a review dialog pre-filled with a session summary (task, outcome, message count, duration). Users can edit the title and content, choose the memory class (episodic, semantic, procedural, or profile), and save to the persistent memory store. Duplicate detection warns when a similar memory already exists.

- **Activity card actions** — every Activity session can now be saved as a portable export, handed off as context to a new or existing agent chat, shared through an installed app (with clipboard fallback), or deleted using the existing confirmation flow.

- **Connected chat workspace** — the Code, Canvas, Preview, and Tasks tabs now open real session-aware surfaces: inspect workspace files, collect editable artifacts, render selected outputs, and monitor background jobs without leaving the active chat.

## Improvements

- **Sessions workflow workspace** — the Sessions tab now opens directly on its own Kanban board, keeps Board/List switching isolated from the chat workspace, and adds a denser signal-ledger list with clearer activity, unread, approval, preview, grouping, search, and selection states.

- **Animated ARCHstudio sidebar branding** — replaces the static app tile beside the sidebar control with the animated ARCHstudio symbol and wordmark for a clearer, more consistent identity.

- **Relevant memory recall in live chats** — ordinary user turns now retrieve a bounded set of relevant long-term memories using session, project, and workspace visibility rules, while excluding secret or superseded records. ARCHstudio also follows a conservative capture policy: explicit “remember this” requests may be saved directly, while inferred durable facts require confirmation and credentials are never stored.

- **Chat jump-to-latest control** — chats continue following streamed messages while you are near the bottom, preserve your reading position when you scroll upward, and show a floating control to return to the newest message and resume auto-follow.

- **Restored visual regression runner** — adds the missing Playwright dependency, Chromium setup and test scripts, stable visual baselines, and Playwright-only test discovery so browser specs no longer collide with Bun unit tests.

## Bug Fixes

- **Functional Settings surface** — removes disabled placeholder controls for unsupported models, pets, tools, integrations, privacy, and experimental options so every visible Settings control now performs a real persisted action.

- **Focused shell window alignment** — removes the obsolete hidden-TopBar inset that left a wide empty band beneath the Windows frame, and uses the active workspace name instead of duplicating ARCHstudio branding in the native caption.

- **Described dialogs and drawers** — command palettes, rename and project dialogs, fullscreen previews, and compact selectors now expose clear purpose text to screen readers without repeated missing-description warnings.

- **Accessible rail controls** — Prompt Studio’s project-context actions and the Command workspace file tree now use valid sibling controls instead of nested buttons, improving keyboard, focus, and screen-reader behavior.

- **Reliable file-tree depth limits** — reducing the Command workspace file-tree depth now immediately collapses and re-gates deeper directories, even when a queued drill expansion finishes during the same UI update.

- **Installed Memory database support** — packages the native SQLite runtime required by the Memory repository in desktop installers, restoring Memory loading along with vault sync, graph, relationships, and related-search features.

- **Reliable renderer console logging** — explicitly enables electron-log's renderer console spy and removes the duplicate WindowManager forwarding path, preserving renderer diagnostics without writing each console event twice.

## Breaking Changes
