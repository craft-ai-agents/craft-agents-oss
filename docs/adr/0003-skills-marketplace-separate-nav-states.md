# ADR 0003 — Separate Navigation States for Local Skills and Marketplace

**Date:** 2026-05-13  
**Status:** Accepted

## Context

The sidebar previously grouped Local Skills and Marketplace under a single `SkillsNavigation` state with a `destination` discriminator (`'local' | 'marketplace'`). Both sub-items were children of a parent "技能" group.

The navigation design was changed to make "技能" (Local Skills) and "市场" (Marketplace) flat top-level sidebar items at the same level as Settings — no shared parent group.

## Decision

Local Skills and Marketplace become two fully separate navigation states, replacing the single `SkillsNavigation` type. Each has its own type guard (`isLocalSkillsNavigation`, `isMarketplaceNavigation`), its own route, and its own rendering branch in `MainContentPanel`.

The `SkillDestination` type, `isSkillsNavigation` guard, and last-destination memory (`getLastSkillDestination` / `setLastSkillDestination`) are removed.

## Rationale

With the two items at the same visual level as Settings — not sharing a parent — there is no longer a meaningful "skills section" concept to unify them. A shared type with a `destination` discriminator would be a leaky abstraction: the only reason it existed was the parent group.

Two separate states also simplify every callsite: no need to check `destination` after the type guard.

## Alternatives Considered

**Keep one state with `destination` discriminator** — fewer file changes, but preserves a concept (unified skills navigation) that no longer matches the UI. Future contributors would need context to understand why two top-level items share a navigation type.

## Consequences

- `isSkillsNavigation`, `SkillsNavigation`, `SkillDestination`, and `skill-navigation.ts` are removed.
- `MainContentPanel`, `AppShell`, and any other callsites that branch on `destination` are updated to use the two new type guards.
- The Marketplace middle panel empty state is removed as part of this change — Marketplace navigation renders directly into the full-width content panel.
