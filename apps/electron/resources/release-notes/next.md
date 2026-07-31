# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

- **Activity card actions** — every Activity session can now be saved as a portable export, handed off as context to a new or existing agent chat, shared through an installed app (with clipboard fallback), or deleted using the existing confirmation flow.

- **Connected chat workspace** — the Code, Canvas, Preview, and Tasks tabs now open real session-aware surfaces: inspect workspace files, collect editable artifacts, render selected outputs, and monitor background jobs without leaving the active chat.

## Improvements

- **Animated ARCHstudio sidebar branding** — replaces the static app tile beside the sidebar control with the animated ARCHstudio symbol and wordmark for a clearer, more consistent identity.

- **Relevant memory recall in live chats** — ordinary user turns now retrieve a bounded set of relevant long-term memories using session, project, and workspace visibility rules, while excluding secret or superseded records. ARCHstudio also follows a conservative capture policy: explicit “remember this” requests may be saved directly, while inferred durable facts require confirmation and credentials are never stored.

- **Chat jump-to-latest control** — chats continue following streamed messages while you are near the bottom, preserve your reading position when you scroll upward, and show a floating control to return to the newest message and resume auto-follow.

- **Restored visual regression runner** — adds the missing Playwright dependency, Chromium setup and test scripts, stable visual baselines, and Playwright-only test discovery so browser specs no longer collide with Bun unit tests.

## Bug Fixes

- **Reliable renderer console logging** — explicitly enables electron-log's renderer console spy and removes the duplicate WindowManager forwarding path, preserving renderer diagnostics without writing each console event twice.

## Breaking Changes
