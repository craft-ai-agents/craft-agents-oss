# RunnerOS Video Studio Spec

## Status

Proposed.

## Goal

Build a native RunnerOS video workspace where humans and agents can create, edit, preview, version, and export videos from the same local project file.

The result should feel like a focused, agent-operable CapCut/Canva-style video editor inside RunnerOS, but architected as a control-plane feature:

- local-first project files
- structured edit tools for agents
- artifact sidecar previews
- full Video Studio page for timeline work
- source/tool registration for rendering and validation
- traceable changes, versions, and exports

## Why This Belongs In RunnerOS

RunnerOS is becoming an operator control plane, not just chat. Video creation is exactly the kind of work where the control plane matters:

- agents can assemble footage, captions, hooks, title cards, and exports
- humans need a real visual editor for final taste decisions
- outputs should land in Canvas/artifacts
- reusable video templates should become workspace assets
- workflows can generate platform variants and render batches
- approvals can gate expensive provider calls and final publishing

The key product move is not "embed an editor." It is "make video an agent-editable artifact type."

## Non-Goals

- Do not build a full professional NLE in the first version.
- Do not require cloud upload for basic editing.
- Do not force agents to use desktop automation to click the editor.
- Do not make the artifact sidecar carry full timeline editing.
- Do not make generated video providers the core editing engine.
- Do not hide state in an opaque app database as the only source of truth.

## External Reference Takeaways

### DesignCombo React Video Editor

Use for:

- timeline UX patterns
- multi-track mental model
- drag, trim, split, reorder flows
- preview + inspector layout
- export preset UX
- React implementation reference

Do not blindly copy:

- app-specific state model
- external media integrations unless useful
- any architecture that makes agent edits hard to express as data

Why:

DesignCombo is the closest React timeline reference. RunnerOS already uses React/Electron, so this is the easiest UI reference to adapt.

### Diffusion Studio Core

Use for:

- browser-side composition engine
- WebCodecs-backed playback/render path
- interactive preview and high-quality final output split
- timeline-to-render mapping
- deterministic local rendering where possible

Do not blindly copy:

- product shell
- any assumptions that every edit lives only in engine objects

Why:

Diffusion Studio Core is closest to the engine RunnerOS wants: TypeScript, browser-native, compositing-oriented, and suitable for non-linear editor construction.

### OpenReel Video

Use for:

- feature completeness reference
- media bin + preview + timeline + inspector product shape
- local privacy expectation
- undo/redo and auto-save expectations
- WebCodecs/WebGPU direction
- captions, text, graphics, effects, LUTs, audio mixing as long-term roadmap

Do not blindly copy:

- very large application surface for MVP
- everything in the completed roadmap at once
- advanced effects before the Runner project model is solid

Why:

OpenReel is the clearest "browser CapCut" reference. It shows what users expect from a serious web editor, but RunnerOS should phase this carefully.

### OpenCut

Use for:

- Editor API concept
- plugin-first architecture
- MCP/agent-facing direction
- headless mode
- scripting tab idea
- cross-platform ambition

Do not blindly copy:

- current implementation as stable foundation
- Rust core in phase 1
- architecture still being rewritten upstream

Why:

OpenCut's best value is direction, not code reuse right now. Its planned API/headless/MCP ideas align strongly with RunnerOS agents.

## Product Shape

### Navigation

Add a top-level or workspace-level entry:

- `Video Studio`

Entry points:

- global nav item
- artifact sidecar button: `Open in Video Studio`
- command palette: `New Video Project`
- agent output action: `Open timeline`
- workflow output action: `Create video variant`

### Surfaces

#### Artifact Sidecar

The sidecar remains lightweight.

It should show:

- video thumbnail
- video player
- duration, resolution, FPS, size
- latest export status
- version list
- buttons:
  - Open in Video Studio
  - Reveal file
  - Export again
  - Duplicate as variant
  - Send to agent

It should not carry:

- full timeline
- detailed keyframe editor
- heavy media bin
- complex inspector

#### Video Studio Page

Full editing workspace:

- left: media bin
- center: preview player
- bottom: timeline
- right: inspector
- top: project/export/version bar

Required panels:

- Media
- Timeline
- Preview
- Inspector
- Captions
- Versions
- Render Queue
- Agent Changes

Optional later panels:

- Templates
- Brand Kit
- Scripting
- Plugins
- Audio
- Color
- Motion

## Core Concept

Video Studio uses one local project file as source of truth.

Humans edit through UI.

Agents edit through structured tools.

Both mutate the same project model.

The preview/render engine reads the project model.

The artifact system records outputs.

## Project File

Default extension:

- `.runner-video.json`

Optional project folder:

```text
my-video/
  video.runner-video.json
  media/
  renders/
  thumbnails/
  captions/
  receipts/
```

### Project Schema

```ts
export interface RunnerVideoProject {
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
  sourceSessionId?: string;
  canvasOutputId?: string;
  settings: VideoProjectSettings;
  media: VideoMediaAsset[];
  timeline: VideoTimeline;
  captions: VideoCaptionTrack[];
  overlays: VideoOverlay[];
  effects: VideoEffect[];
  templates: VideoTemplateBinding[];
  exports: VideoExportRecord[];
  versions: VideoProjectVersion[];
  agentEvents: VideoAgentEvent[];
}
```

```ts
export interface VideoProjectSettings {
  aspectRatio: '9:16' | '1:1' | '16:9' | '4:5' | 'custom';
  width: number;
  height: number;
  fps: number;
  durationMs?: number;
  backgroundColor?: string;
  safeArea?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}
```

```ts
export interface VideoMediaAsset {
  id: string;
  type: 'video' | 'audio' | 'image' | 'caption' | 'svg' | 'lottie' | 'html' | 'unknown';
  label: string;
  path: string;
  mimeType?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  fps?: number;
  waveformPath?: string;
  thumbnailPath?: string;
  transcriptPath?: string;
  source:
    | { kind: 'user-import' }
    | { kind: 'agent-output'; sessionId: string; outputId?: string }
    | { kind: 'generated'; provider?: string; receiptId?: string }
    | { kind: 'screen-recording' }
    | { kind: 'workflow-output'; workflowRunId: string };
}
```

```ts
export interface VideoTimeline {
  durationMs: number;
  tracks: VideoTrack[];
  markers: VideoMarker[];
  selection?: VideoSelection;
}

export interface VideoTrack {
  id: string;
  type: 'video' | 'audio' | 'image' | 'text' | 'caption' | 'effect' | 'adjustment';
  label: string;
  locked?: boolean;
  muted?: boolean;
  hidden?: boolean;
  height?: number;
  clips: VideoClip[];
}

export interface VideoClip {
  id: string;
  mediaId?: string;
  type: 'video' | 'audio' | 'image' | 'text' | 'caption' | 'shape' | 'lottie' | 'html';
  startMs: number;
  durationMs: number;
  sourceInMs?: number;
  sourceOutMs?: number;
  label?: string;
  transform?: VideoTransform;
  crop?: VideoCrop;
  opacity?: number;
  volume?: number;
  speed?: number;
  effects?: string[];
  transitionIn?: VideoTransition;
  transitionOut?: VideoTransition;
  keyframes?: VideoKeyframe[];
  text?: VideoTextPayload;
  captionCueIds?: string[];
}
```

```ts
export interface VideoTransform {
  x: number;
  y: number;
  scale: number;
  rotateDeg: number;
  anchorX?: number;
  anchorY?: number;
}

export interface VideoTextPayload {
  text: string;
  fontFamily?: string;
  fontSize: number;
  fontWeight?: number;
  color: string;
  align?: 'left' | 'center' | 'right';
  backgroundColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  stylePreset?: string;
}
```

### Event Log

Every agent edit should record a small event:

```ts
export interface VideoAgentEvent {
  id: string;
  createdAt: string;
  agentSlug: string;
  sessionId: string;
  toolName: string;
  summary: string;
  beforeVersionId?: string;
  afterVersionId?: string;
  receiptPath?: string;
}
```

This gives the UI an "Agent Changes" panel and allows undo/review.

## Agent Interaction Model

Agents do not control the UI by default.

Agents use tools that edit the project file.

The UI watches the file or receives change events and refreshes.

### Required Tools

```text
video_project_create
video_project_open
video_project_validate
video_media_import
video_media_probe
video_clip_add
video_clip_trim
video_clip_split
video_clip_move
video_clip_delete
video_track_create
video_track_update
video_caption_import
video_caption_generate
video_caption_style
video_overlay_add_text
video_overlay_add_image
video_effect_apply
video_transition_apply
video_template_apply
video_variant_create
video_preview_render
video_export
video_project_snapshot
video_project_diff
video_project_undo
```

### Tool Design Rules

- All tools take `projectPath`.
- All mutating tools return:
  - `ok`
  - `projectPath`
  - `versionId`
  - `summary`
  - `changedClipIds`
  - `warnings`
- Mutating tools write atomically.
- Mutating tools validate after write.
- Render/export tools produce receipts.
- Expensive or long-running renders must go through approval policy if configured.
- Tools never silently delete user media.

### Example Tool Call

```json
{
  "projectPath": "/workspace/videos/product-demo/video.runner-video.json",
  "trackId": "captions-main",
  "source": {
    "kind": "transcript",
    "path": "/workspace/videos/product-demo/captions/transcript.srt"
  },
  "style": {
    "preset": "tiktok-bold",
    "position": "bottom-safe"
  }
}
```

### Agent Prompt Rule

Video agents must be told:

> Treat the project file as the source of truth. Use video tools for edits. Do not use Computer Use to click the Video Studio unless the user explicitly asks for desktop UI control. Validate the project and render a preview before claiming an edit is complete.

## Built-In Agent

Add starter global agent:

- slug: `video-editor-agent`
- name: `Video Editor Agent`
- visualAgent: true
- permissionMode: ask
- thinkingLevel: high
- sources: `['video-studio']`
- skills:
  - video editing
  - captions
  - short-form creative
  - platform variants

### Agent Jobs

The agent should handle:

- assemble a rough cut
- cut dead air
- split long footage into clips
- create TikTok/Reels/Shorts variants
- add captions
- add title cards
- add lower thirds
- add b-roll placeholders
- add music bed
- generate hooks
- create thumbnail frames
- export multiple formats
- compare two cuts

### Agent Boundaries

The agent should not:

- publish to social without approval
- use paid providers without approval
- overwrite source footage
- hide failed renders
- claim visual quality without preview/render evidence

## Source / Tool Integration

Add built-in local source:

- slug: `video-studio`
- type: `local`
- format: `cli-tool`
- path: `tools/video-studio`

Commands:

```bash
node bin/video-studio.mjs doctor --json
node bin/video-studio.mjs probe <media-path> --json
node bin/video-studio.mjs validate <project-path> --json
node bin/video-studio.mjs thumbnail <project-path> --time 1000 --out thumb.png
node bin/video-studio.mjs preview <project-path> --out preview.mp4
node bin/video-studio.mjs export <project-path> --preset reels-1080p --out final.mp4
```

The source must be registered the same way as bundled local tools:

- built-in source registry
- `getSourcesBySlugs` support
- packaged Electron resources
- source doctor hook
- source test coverage
- global agent startup seeding
- visible agent hub activation if product wants it default-visible

## Rendering Strategy

### Phase 1

Use a local CLI wrapper around the chosen engine.

Recommended starting path:

- project model owned by RunnerOS
- renderer adapter translates project model to Diffusion Studio Core composition
- fallback export path may use FFmpeg or Remotion for simple operations if needed

### Why Not Only Remotion

Remotion is excellent for code-owned templated video, but Video Studio needs interactive timeline editing. Remotion can still be useful for:

- template rendering
- deterministic React scenes
- data videos
- existing Hypermotion flows

But the default Video Studio engine should optimize for editor playback and timeline manipulation.

### Why Diffusion Studio Core First

It is closer to:

- interactive browser playback
- canvas/video workloads
- WebCodecs
- timeline-based editors
- high-fidelity render mode

## UI Detail

### Video Studio Header

Controls:

- project title
- autosave status
- undo/redo
- aspect ratio selector
- export button
- render status
- open output folder

### Media Bin

Features:

- import files
- drag media to timeline
- show thumbnails
- show duration/resolution
- filter by type
- reveal original
- send selected media to agent

### Preview Player

Features:

- play/pause
- frame step
- current time
- safe area overlays
- aspect ratio frame
- selected clip handles
- basic transform handles
- preview quality selector

### Timeline

MVP features:

- multiple tracks
- drag clips
- trim clip edges
- split at playhead
- snap to playhead/clip edges
- zoom in/out
- ripple delete
- track lock/mute/hide
- time ruler
- markers

Later:

- keyframes
- nested timelines
- adjustment layers
- beat markers
- motion tracking

### Inspector

When clip selected:

- position
- scale
- rotation
- opacity
- crop
- speed
- volume
- text settings
- effect settings
- transitions

When project selected:

- aspect ratio
- resolution
- FPS
- background
- export preset

### Captions Panel

MVP:

- import SRT/VTT
- edit cue text
- shift timings
- choose style preset
- burn into export

Later:

- local transcription
- speaker labels
- karaoke word highlights
- silence detection

### Agent Changes Panel

Show:

- agent edit history
- summary of each tool edit
- before/after version
- changed clips
- render receipts
- revert button

This is critical for trust.

## Artifact Integration

Video projects and renders should create session outputs.

Output kinds:

- `video-project`
- `video-render`
- `video-thumbnail`
- `caption-file`
- `render-receipt`

Artifact sidecar behavior:

- show latest render
- show "Open in Video Studio"
- show "Ask Video Editor Agent"
- pin to Canvas when `showInCanvas`
- allow compare of exports

Canvas behavior:

- video card can play output
- video project card opens studio
- visual review can capture preview frame
- agent can reference a canvas video output by output ID

## Versioning

Every meaningful edit creates a version record.

Version policies:

- UI drag edits can batch into one version per interaction.
- Agent tool call creates one version by default.
- Render/export creates a receipt, not necessarily a project version.
- User can name a version.
- Agent can create variants.

Example:

```text
v1 imported footage
v2 agent cut dead air
v3 user adjusted title timing
v4 agent created 9:16 reels variant
v5 final export
```

## Storage

Local project files should live under the workspace by default:

```text
<workspace>/.runneros/video-projects/<project-id>/
```

But users can also import/open existing project files.

RunnerOS should store a lightweight index:

```ts
export interface VideoProjectIndexEntry {
  id: string;
  title: string;
  projectPath: string;
  workspaceId: string;
  updatedAt: string;
  thumbnailPath?: string;
  latestRenderPath?: string;
}
```

The file remains authoritative.

## Data Safety

Rules:

- never overwrite original media
- copy imported assets or store stable references with missing-file warnings
- atomic writes for project JSON
- schema migration on load
- recover from malformed project file with backup copy
- render outputs go to `renders/`
- every export writes receipt JSON

## Permissions

Editing local project JSON is allowed.

Risky actions:

- deleting imported media
- overwriting an export
- using paid AI video/audio/image providers
- uploading media
- publishing media
- running long render jobs

These should respect Runner permission mode.

## Workflow Integration

Video Studio should support workflows:

### Example: Turn Long Video Into Shorts

1. Import long video.
2. Detect scenes/silence.
3. Generate candidate clips.
4. Add captions.
5. Create 9:16 variants.
6. Render previews.
7. Ask user to approve best cuts.
8. Export finals.

### Example: Product Launch Pack

1. Import product images.
2. Generate title cards.
3. Add motion template.
4. Create 15s, 30s, and 60s variants.
5. Export TikTok/Reels/YouTube Shorts sizes.
6. Create thumbnails.

### Example: Agent Review Pass

1. Open existing project.
2. Agent audits pacing, readability, captions, safe area, and platform fit.
3. Agent proposes edits.
4. User approves apply.
5. Agent renders preview.

## Scripting Tab

Borrow from OpenCut's planned scripting direction.

Add later, not MVP.

Purpose:

- let advanced users run local scripts against the project
- let agents generate scripts for repeatable edits
- expose project API safely

Example:

```ts
for (const clip of project.timeline.tracks.flatMap((track) => track.clips)) {
  if (clip.type === 'caption') {
    clip.text!.fontSize = 64;
  }
}
```

Must be sandboxed or approval-gated.

## Plugin Model

Not MVP, but design for it.

Plugin types:

- importers
- exporters
- effects
- templates
- analyzers
- caption stylers
- render engines

Runner-specific plugin rule:

- plugins must be visible as sources/tools where agents need them
- missing required plugins fail loudly before execution

## Implementation Plan

### Phase 0: Research Spike

Goal: choose engine/UI reuse path.

Tasks:

- clone and inspect DesignCombo, Diffusion Studio Core, OpenReel, OpenCut
- verify license compatibility
- run each local demo if feasible
- identify reusable packages/components
- test basic import -> timeline -> export path
- write final engine decision note

Exit criteria:

- one selected render engine
- one selected timeline UI path
- proof of local MP4 export
- known bundle size/performance concerns

### Phase 1: Project Model + Local CLI

Goal: agent-operable project file exists before the UI is fancy.

Files likely:

```text
packages/shared/src/video/
  types.ts
  schema.ts
  storage.ts
  validation.ts
  diff.ts
  fixtures.ts

tools/video-studio/
  package.json
  bin/video-studio.mjs
  src/
```

Build:

- project schema
- parser/validator
- atomic read/write
- project create
- media probe
- project validate
- simple thumbnail
- simple export proof

Tests:

- schema validation
- migration from missing fields
- atomic save
- media import normalization
- invalid clip timing rejection

### Phase 2: Source + Agent Tools

Goal: agents can create and edit video projects.

Files likely:

```text
sources/video-studio/
  config.json
  guide.md
  permissions.json

packages/session-tools-core/src/handlers/video-*.ts
packages/session-tools-core/src/tool-defs.ts
packages/shared/src/agent-definitions/starter-templates.ts
```

Build:

- built-in `video-studio` source
- doctor hook
- video project tools
- starter Video Editor Agent
- permission rules

Tests:

- source visible via `loadAllSources`
- source resolves via `getSourcesBySlugs`
- doctor passes
- agent starter has source
- tools mutate fixture project correctly

### Phase 3: Artifact Sidecar Integration

Goal: rendered videos and video projects show up as first-class artifacts.

Build:

- output kind support
- video player card
- project card
- `Open in Video Studio`
- latest render link
- thumbnail support
- Canvas pin behavior

Tests:

- output manifest resolves video preview
- project output opens correct route
- missing render shows clean empty state

### Phase 4: Video Studio MVP UI

Goal: human can edit basic timeline.

Build:

- route/page
- project open/create
- media bin
- preview player
- timeline
- inspector basics
- save/load
- undo/redo
- export button

MVP editing:

- import
- add clip
- trim
- split
- move
- delete
- add text
- import captions
- export

Tests:

- component unit tests for timeline math
- project save/load test
- Playwright smoke:
  - create project
  - import fixture media
  - add to timeline
  - trim
  - export preview

### Phase 5: Agent Co-Editing

Goal: agent edits update the UI and are reviewable.

Build:

- file watcher or project change event
- Agent Changes panel
- project diff viewer
- apply/revert version
- "Ask Video Editor Agent" from project

Tests:

- tool edit updates open project
- diff shows changed clip
- revert restores prior version
- agent event appears in panel

### Phase 6: Advanced Editing

Add after MVP:

- keyframes
- transitions
- captions auto-generation
- templates
- audio waveform
- beat detection
- platform safe-area presets
- color/effect presets
- batch variants
- plugin system
- scripting tab

## Recommended First Build Slice

Do not start with the full editor UI.

Start here:

1. `packages/shared/src/video` schema and validation.
2. `tools/video-studio` doctor, create, validate, export placeholder.
3. `video_project_create`, `video_media_import`, `video_clip_add`, `video_export`.
4. Artifact sidecar can preview exported MP4.
5. Minimal Video Studio page opens project and shows timeline JSON visually.

This proves the RunnerOS-native loop:

```text
agent edits project -> UI sees project -> renderer exports video -> artifact sidecar previews output
```

Once that works, make the timeline beautiful.

## Acceptance Criteria

### MVP Acceptance

- User can create a Video Studio project from RunnerOS.
- User can import a local video.
- User can trim/split/move clips in the UI.
- User can add text overlay.
- User can import or create captions.
- User can export MP4.
- Exported MP4 appears in artifacts/sidecar.
- User can reopen the project after restart.
- Video Editor Agent can make at least one structured edit without UI clicking.
- Agent edit appears in the project history.
- Project validation catches broken clips or missing media.

### Agent Acceptance

- `video_project_create` creates a valid project.
- `video_media_import` probes media and stores metadata.
- `video_clip_add` adds a clip to a track.
- `video_clip_trim` changes timing without invalid duration.
- `video_caption_import` creates caption cues.
- `video_export` produces a receipt and output file.
- Every mutating tool writes a version/event.
- Failed render reports clear error and does not claim success.

### Source Acceptance

- `video-studio` appears in source list.
- `getSourcesBySlugs(workspace, ['video-studio'])` returns it.
- `source_test video-studio` runs doctor.
- packaged Electron includes `tools/video-studio`.
- Video Editor Agent declares `sources: ['video-studio']`.

## Risks

### Browser Video Performance

Risk:

- WebCodecs/WebGPU behavior differs by OS/GPU.

Mitigation:

- start with conservative preview resolution
- keep CLI export path separate
- produce clear render failure receipts

### Editor Scope Explosion

Risk:

- trying to build all CapCut features before the project model works.

Mitigation:

- ship agent-operable project model first
- add UI features in tight slices
- defer advanced effects

### Opaque Third-Party State

Risk:

- imported editor stores state in a shape agents cannot edit.

Mitigation:

- RunnerOS project schema is authoritative
- adapters translate into engine/editor state
- do not make third-party internal state the source of truth

### Render Mismatch

Risk:

- preview differs from export.

Mitigation:

- use same composition adapter where possible
- add render receipt with engine/version/settings
- add visual smoke checks for fixture projects

### Agent Overreach

Risk:

- agent silently changes too much or deletes media.

Mitigation:

- versions for every agent edit
- project diff before major changes
- approval gates for destructive operations
- immutable source media

## Open Decisions

1. Engine: Diffusion Studio Core only, or Diffusion Studio Core plus Remotion fallback?
2. Timeline UI: port DesignCombo ideas, reuse components, or build minimal in-house first?
3. Export implementation: WebCodecs-only, FFmpeg fallback, or hybrid?
4. Project storage: workspace `.runneros/video-projects` only, or user-selectable folders from day one?
5. Should Video Studio be top-level nav immediately, or appear first through artifacts/agents?
6. Should Video Editor Agent be auto-visible in the Agents hub by default?
7. Should scripting tab exist in phase 1 behind a dev flag?

## Recommended Decisions

1. Use Diffusion Studio Core as the first preferred engine.
2. Keep Remotion through Hypermotion for templated/code-owned video, not the main interactive editor.
3. Build RunnerOS project schema first.
4. Build minimal in-house timeline first if DesignCombo state model fights us.
5. Create `video-studio` as a bundled local source.
6. Make `Video Editor Agent` visible by default.
7. Keep artifact sidecar as preview/open surface, not editor.
8. Add full `Video Studio` page once project schema and CLI prove out.

## North Star

The user drops in raw footage and says:

> Make three tight TikTok cuts with captions, hook cards, and a clean outro.

RunnerOS should:

1. create a video project
2. import and analyze footage
3. propose cuts
4. apply approved edits
5. render previews
6. show them in artifacts/Canvas
7. let the user open Video Studio and tweak visually
8. export final variants
9. preserve every project, version, and receipt locally

That is the RunnerOS-native version of "built-in CapCut": not just an editor, but an agent-operable production workspace.
