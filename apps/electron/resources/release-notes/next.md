# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

## Improvements

- **Native iOS workspace redesign** — Refined server onboarding, added searchable and filterable session rows, introduced document-style assistant responses and richer tool activity cards, surfaced model and permission controls in the composer, improved approval safety, and made the iPad session sidebar visible by default.

## Bug Fixes

- **Reliable iOS session loading** — Long conversations now load without hitting Foundation's 1 MB WebSocket limit, session requests wait for active reconnects, transient failures retry automatically, and manual reconnects replace stale session clients without losing unsent drafts.

## Breaking Changes
