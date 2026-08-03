# Owner Agent — Design System Specification v0

## Scope

This document defines the first redesign contract for implementation in the existing Electron component playground. It extends Craft's semantic theme machinery before any full-page replacement.

## Existing seams retained

- theme schema and CSS generation: `packages/shared/src/config/theme.ts`
- renderer token mapping: `apps/electron/src/renderer/index.css`
- runtime theme selection: `apps/electron/src/renderer/context/ThemeContext.tsx`
- isolated previews: `apps/electron/src/renderer/playground/`
- shared chat presentation: `packages/ui/src/components/chat/`

## Token layers

### 1. Primitive palette

Primitive values are implementation details. Components must not reference them directly.

- graphite 0–1000
- cyan 0–1000
- amber 0–1000
- green 0–1000
- red 0–1000

### 2. Semantic colour

- `--oa-canvas`
- `--oa-surface-navigation`
- `--oa-surface-panel`
- `--oa-surface-card`
- `--oa-surface-input`
- `--oa-surface-hover`
- `--oa-text-primary`
- `--oa-text-secondary`
- `--oa-text-muted`
- `--oa-border-subtle`
- `--oa-border-strong`
- `--oa-owner`
- `--oa-owner-soft`
- `--oa-attention`
- `--oa-verified`
- `--oa-failed`

Existing compatibility variables (`--background`, `--foreground`, `--accent`, `--info`, `--success`, `--destructive`, surface variables) map onto the new semantic layer during migration.

### 3. Execution state

- `--oa-state-queued`
- `--oa-state-running`
- `--oa-state-waiting`
- `--oa-state-verifying`
- `--oa-state-completed`
- `--oa-state-warning`
- `--oa-state-failed`
- `--oa-state-cancelled`

Execution state must never rely on colour alone. Pair it with icon, label and—while active—motion.

### 4. Typography

- display: 24/30, 650
- page title: 18/24, 650
- section title: 14/20, 650
- body: 14/22, 400
- body strong: 14/22, 600
- compact UI: 12/16, 500
- metadata: 11/16, 500
- code/output: 12/18, 400 monospace

Use the system stack for UI until font licensing/packaging is decided. Paths, commands, model IDs, durations and tool output use monospace selectively.

### 5. Spacing

Base unit: 4px.

- 1: 4
- 2: 8
- 3: 12
- 4: 16
- 5: 20
- 6: 24
- 8: 32
- 10: 40
- 12: 48

Dense operational lists use 8–12px vertical padding. Generated prose uses larger rhythm and must not inherit compact metadata spacing.

### 6. Radius

- control: 8px
- card: 10px
- panel: 12px
- capsule: 999px

Avoid excessive nested rounded rectangles. Adjacent panel boundaries should generally remain square.

### 7. Elevation

- base: no shadow
- raised control: subtle one-pixel ring plus short ambient shadow
- floating panel: stronger ring plus 16–32px ambient shadow
- modal: backdrop plus floating elevation
- active drag: existing drag elevation semantics retained

## Core component contracts

### Runtime capsule

Displays one primary backend/model and health:

- provider/runtime icon;
- model name;
- local/cloud marker;
- health dot plus text for accessibility;
- opens model/connection switcher.

### Scope capsule

Displays:

- working directory short path;
- owner policy mode;
- active capability count;
- obvious warning when scope is broad.

### Run card

Collapsed state:

- action/tool name;
- state;
- duration;
- one-line result;
- artifact/change count.

Expanded state:

- sanitized input;
- timestamped progress events;
- output/log tail;
- changed files/artifacts;
- verification evidence;
- retry/cancel/reveal controls where supported.

### Command composer

- expands from one to at most eight text lines before scrolling;
- attachments appear as removable chips/previews;
- runtime, scope and capability controls remain available but quiet;
- submit transforms into stop during active generation;
- queued follow-up/steer behavior is visible;
- keyboard shortcut is displayed in metadata, not placeholder text.

### Activity rail

Order:

1. Command
2. Runs
3. Projects
4. Memory
5. Media Lab
6. Integrations
7. Settings anchored at bottom

Each destination has icon, accessible label, active indicator and optional status badge. No workspace/team switcher occupies prime navigation in the single-owner build.

## Motion

Durations:

- instant feedback: 80–120ms
- control transition: 140–180ms
- panel transition: 180–240ms
- route transition: max 280ms

Rules:

- use opacity/transform where possible;
- respect reduced motion;
- pulse only genuinely live activity;
- never animate completed static content continuously;
- preserve scroll position during streaming and panel changes.

## Accessibility baseline

- WCAG AA text contrast;
- visible keyboard focus on every control;
- minimum 32px pointer target for dense desktop controls, 44px in compact/touch mode;
- status conveyed by text/icon in addition to colour;
- semantic buttons/labels before custom ARIA;
- screen-reader announcements for run state changes and permission requests;
- reduced-motion support.

## Initial playground states

The first implementation must include deterministic previews for:

1. Command — empty/new session
2. Command — streaming response with one active run card
3. Command — completed response with verified file changes
4. Runs — parent task with two delegated children
5. Memory — durable fact cards with provenance
6. Integrations — Codex, Ollama Local, Ollama Cloud, Hermes and ComfyUI health
7. Media Lab — queued image and running video
8. compact Command layout
9. offline provider state
10. failed tool with actionable retry

No state is accepted solely from a visual screenshot: each preview must expose stable labels/test IDs so rendering tests can assert structure and state.
