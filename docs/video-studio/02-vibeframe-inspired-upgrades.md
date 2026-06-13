# Video Studio: Agentic Editing Upgrade Spec

## Goal

Make RunnerOS Video Studio feel like a native editor humans can use, while also giving agents deterministic commands they can safely run without desktop clicking.

## What To Borrow From VibeFrame

- CLI-first, machine-readable operations.
- Dry-run before expensive or destructive work.
- Inspect reports after edits/renders.
- Storyboard/design docs later, as optional planning assets beside the project file.
- Clear lanes:
  - Build: brief/storyboard/design to full video.
  - Edit: existing media and timeline edits.
  - Asset: generate one clip/image/audio item.

## RunnerOS Shape

RunnerOS should not become a separate terminal-only video product. The right form is:

- native Video Studio page for visual editing
- bundled `video-studio` source for agents
- `.runner-video.json` as the edit source of truth
- receipts/reports saved as output assets

## Phase 1: Timeline Edit Commands

Add deterministic commands that both UI and agents can reason about:

- pack timeline: magnet clips end-to-start per track
- split selected clip at playhead
- duplicate clip
- delete clip
- inspect project: gaps, overlaps, missing media, unsupported render media
- dry-run export: validate renderability without writing MP4

Acceptance:

- commands update project JSON atomically
- invalid edits fail loudly
- command output supports `--json`
- UI exposes the core human actions
- tests cover pack/split/delete/inspect behavior

## Phase 2: Agent-Safe Reports

Add saved report assets:

- `reports/video-inspect.json`
- `reports/video-dry-run.json`
- render receipt already exists

Acceptance:

- agents can inspect before claiming done
- export errors are visible in a report, not only a toast

## Phase 3: Storyboard/Design Assets

Add optional project docs:

- `STORYBOARD.md`
- `DESIGN.md`

These should help agents plan scenes, not replace the timeline JSON.

Acceptance:

- new project can include blank docs
- agent instructions say timeline JSON remains source of truth
- docs are opened from Video Studio as side assets

## Phase 4: Smarter Editing

Later additions:

- silence detect
- scene detect
- captions
- smart reframe
- fade in/out
- highlights/auto-shorts

Do this only after Phase 1 is stable.
