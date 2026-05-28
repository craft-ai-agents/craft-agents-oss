# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

## Improvements

- **Workspace files honor session folders** — The Workspace sidebar tab now opens at the focused session's working directory when it is inside the workspace, while falling back to the workspace root for sessions without a valid working directory. (Issue #17)

## Bug Fixes

- **Branch sessions navigate in place** — Branching from a message now opens the child session in the current content area instead of creating a side-by-side panel. (RPI-170)

## Breaking Changes
