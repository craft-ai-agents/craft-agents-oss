---
status: draft
owner: agent
last_verified: 2026-06-28
source_of_truth: false
---

# Mission Assets Spec

## Decision

Mission assets should be local-first files, organized inside the workspace mission folder, with a lightweight manifest saved as workspace context.

Do not put audio, video, images, or large text blobs directly into agent prompt context. Agents should receive a clean manifest with paths and metadata, then use tools to inspect specific files only when needed.

```text
Mission brief = what this mission is
Mission assets = the files this mission runs on
Asset manifest = the bridge agents can read
```

## Product Principle

Artists should not think in folder architecture.

They should think:

```text
Add Master
Add Lyrics
Add Cover Art
Drop Anything
Open Assets Folder
```

Runner should handle the folder structure behind the scenes.

## User Experience

### After Mission Brief Save

After `Accept Brief`, home should show a compact mission setup strip:

```text
Mission Assets

[Add Master] [Add Lyrics] [Add Cover Art] [Drop Anything]
                                      [Open Assets Folder]
```

If the mission has no assets, this strip appears near the hero. Once assets exist, it collapses into a small `Assets` widget with counts and key missing items.

### Primary Actions

#### Add Master

Opens file picker filtered to audio:

- `.wav`
- `.aiff`
- `.flac`
- `.mp3`
- `.m4a`

Default destination:

```text
assets/audio/masters/
```

#### Add Lyrics

Opens file picker for text/doc formats:

- `.txt`
- `.md`
- `.docx`
- `.pdf`

Default destination:

```text
assets/docs/lyrics/
```

#### Add Cover Art

Opens file picker for image formats:

- `.png`
- `.jpg`
- `.jpeg`
- `.webp`
- `.psd`
- `.ai`

Default destination:

```text
assets/images/cover-art/
```

#### Drop Anything

User can drag files into the command center. Runner classifies files, shows the proposed placement, and asks for confirmation.

```text
Add these to Mission Assets?

final-master.wav        Audio / Masters
cover-v4.png            Images / Cover Art
lyrics-final.txt        Docs / Lyrics
studio-bts.mov          Video / Raw

[Save to Mission Assets] [Change] [Cancel]
```

The key is confirmation. Never silently move/copy a creator's files.

### Secondary Actions

#### Open Assets Folder

Opens the mission assets folder in Finder.

This is important because artists already know how to work with files. Runner should not trap them in app UI.

#### Use Existing Folder

Advanced path. Lets a user link an existing asset folder without copying files.

This should be visually secondary because linked files can break if moved.

```text
Use Existing Folder
Files stay where they are. Runner will index them by path.
```

## Default Folder Structure

Runner creates this under the workspace root on first asset action:

```text
assets/
  audio/
    masters/
    demos/
    stems/
    references/

  video/
    raw/
    edits/
    finals/

  images/
    cover-art/
    press-photos/
    moodboard/

  docs/
    lyrics/
    press/
    notes/

  exports/
    social/
    epk/
```

Rules:

- Create folders lazily, not during mission brief save.
- Keep folder names stable and lowercase kebab-case.
- Prefer copying files into this structure for V1.
- Preserve original filenames unless there is a collision.
- On collision, append `-2`, `-3`, etc.

## Copy vs Link

### Default: Copy Into Mission Assets

Best default for reliability.

Pros:

- agents get stable paths
- files survive if the source desktop/downloads folder changes
- easier backup/export
- easier future sync

Cons:

- duplicates large media files

### Advanced: Link Existing Folder

Best for power users with large media libraries.

Pros:

- no duplication
- works with existing artist folder systems

Cons:

- paths can break
- permissions can change
- harder to package/export

V1 should implement copy first. Link can come after manifest/read-path safety is solid.

## Classification

Classification should be deterministic first, AI later.

### File Type Routing

```text
audio/wav, audio/aiff, audio/flac
  -> audio/masters unless filename suggests demo/stem/reference

audio/mp3, audio/m4a
  -> audio/masters or audio/references based on filename

video/*
  -> video/raw unless filename contains final/export/render

image/*
  -> images/cover-art if square-ish or filename contains cover/artwork
  -> images/press-photos if filename contains press/photo/headshot
  -> images/moodboard if filename contains mood/ref/reference

.txt/.md/.docx/.pdf
  -> docs/lyrics if filename contains lyric
  -> docs/press if filename contains press/bio/epk
  -> docs/notes otherwise
```

### Filename Hints

```text
master, final, mix, bounce -> audio/masters
demo, idea, rough          -> audio/demos
stem, vocal, instrumental  -> audio/stems
ref, reference             -> audio/references or images/moodboard
cover, artwork             -> images/cover-art
press, bio, epk            -> docs/press
lyrics                     -> docs/lyrics
```

When confidence is low, show `Unsorted` in the confirmation modal and let the user choose.

Do not create an `unsorted/` folder in V1 unless we add an explicit review queue. Unsorted files tend to become a junk drawer.

## Manifest

Save one manifest as a workspace context doc:

```text
context/mission-assets/CONTEXT.md
```

Metadata:

```yaml
name: Mission Assets
description: Local files attached to this creative mission.
agents: all
status: active
priority: normal
```

Body:

````md
This context lists local files attached to the current mission. Do not assume every file has been analyzed. Use tools to inspect files when needed.

```json
{
  "version": 1,
  "workspaceId": "workspace-id",
  "assetsRoot": "assets",
  "storageMode": "copied",
  "updatedAt": "2026-06-28T00:00:00.000Z",
  "files": [
    {
      "id": "asset_...",
      "kind": "master",
      "label": "Final Master",
      "relativePath": "assets/audio/masters/final-master.wav",
      "mimeType": "audio/wav",
      "sizeBytes": 48299122,
      "sha256": "...",
      "source": "copy",
      "status": "available",
      "usableByAgents": true,
      "createdAt": "2026-06-28T00:00:00.000Z",
      "updatedAt": "2026-06-28T00:00:00.000Z"
    }
  ]
}
```

## Key Assets

- Master: assets/audio/masters/final-master.wav
- Cover art: missing
- Lyrics: assets/docs/lyrics/lyrics-final.txt
````

Why context doc:

- existing agents already receive enabled broadcast context docs
- no new database subsystem for V1
- users can inspect/edit the manifest locally
- keeps agent prompts compact

## Data Shape

```ts
type MissionAssetKind =
  | 'master'
  | 'demo'
  | 'stem'
  | 'audio-reference'
  | 'raw-video'
  | 'edited-video'
  | 'final-video'
  | 'cover-art'
  | 'press-photo'
  | 'moodboard-image'
  | 'lyrics'
  | 'press-doc'
  | 'note'
  | 'export'
  | 'other'

type MissionAssetStatus =
  | 'available'
  | 'missing'
  | 'moved'
  | 'needs-review'

interface MissionAssetRecord {
  id: string
  kind: MissionAssetKind
  label: string
  relativePath?: string
  absolutePath?: string
  mimeType?: string
  sizeBytes?: number
  sha256?: string
  source: 'copy' | 'linked-folder' | 'agent-output' | 'manual'
  status: MissionAssetStatus
  usableByAgents: boolean
  notes?: string
  createdAt: string
  updatedAt: string
}

interface MissionAssetManifest {
  version: 1
  workspaceId: string
  assetsRoot: string
  storageMode: 'copied' | 'linked' | 'mixed'
  files: MissionAssetRecord[]
  updatedAt: string
}
```

## Agent Access

Agents should receive the manifest through workspace context.

They should not receive file bytes in prompt context.

Good agent behavior:

```text
I see a final master at assets/audio/masters/final-master.wav.
I can inspect loudness/waveform if you want a mastering review.
```

Bad agent behavior:

```text
I listened to the master and it sounds ready.
```

Unless an audio tool actually inspected it, the agent must not claim it analyzed the file.

## Integration With Existing Runner Primitives

Use existing workspace context routing:

- mission asset manifest is `enabled: true`
- routing is broadcast
- all agents receive it through `listWorkspaceContextDocsForAgent`

Use existing file/open-dialog capabilities:

- choose file
- choose folder
- open path
- show in folder

Reuse output asset conventions where practical:

- relative paths when inside workspace
- MIME type
- size
- hash
- role/kind
- safe path validation

Do not reuse generated Output bundles as mission source asset storage. Outputs are agent-generated deliverables; mission assets are user-provided or mission-owned source material.

## UI Placement

### Home

Add an `Assets` card/strip after mission brief exists.

Empty:

```text
Mission Assets
Add the files agents should know exist.

[Add Master] [Add Lyrics] [Add Cover Art] [Drop Anything]
```

With assets:

```text
Mission Assets
Master: final-master.wav
Lyrics: lyrics-final.txt
Cover Art: missing

[Add] [Open Folder]
```

### Drawer

Do not add full asset upload to the mission brief drawer. The drawer is for mission context. Asset collection is the next step after saving or a separate card on home.

### Drag Drop

The entire command center surface can accept dropped files once a mission exists.

If no mission exists, dropping files should show:

```text
Create a mission first?
Files need a mission so agents know what they belong to.

[Create Mission] [Cancel]
```

## Safety Rules

1. Never delete original user files.
2. Default to copy, not move.
3. Never silently copy huge folders.
4. Show file count and total size before importing many files.
5. Warn before copying more than 2GB.
6. Store relative paths for files inside workspace.
7. Only store absolute paths for explicitly linked external folders.
8. Validate paths before tools open/read them.
9. Keep prompt context to manifest only.
10. Track missing/moved files without crashing the mission page.

## Implementation Plan

### Phase 1: Manifest And Folder Skeleton

Add shared mission-assets module:

```text
packages/shared/src/mission-assets/
  types.ts
  storage.ts
  classify.ts
  manifest-context.ts
```

Responsibilities:

- create assets folder skeleton lazily
- classify file destination
- copy files into workspace assets
- compute basic metadata
- write/read manifest
- serialize manifest as workspace context doc

### Phase 2: Main Process IPC

Add Electron handlers:

```ts
chooseMissionAssetFiles(workspaceId, kindHint?)
importMissionAssets(workspaceId, filePaths, options)
openMissionAssetsFolder(workspaceId)
getMissionAssetManifest(workspaceId)
```

Keep file copying and hashing in main/shared, not renderer.

### Phase 3: Home Assets Strip

Add an `Assets` strip/card to command center:

- empty state CTAs
- key asset status
- open folder
- add file actions
- import confirmation modal

Wire existing `Drop Files` button to asset import, not a dead button.

### Phase 4: Agent Context

On every manifest update:

- upsert `context/mission-assets/CONTEXT.md`
- broadcast to all agents
- keep body compact
- include key assets and JSON manifest

Verify by launching an agent and checking composed prompt includes `Mission Assets`.

### Phase 5: Analysis Receipts

Add optional derived artifacts:

```text
context/audio-analysis/CONTEXT.md
context/lyrics-analysis/CONTEXT.md
```

Only create these after a tool actually analyzes the files.

Examples:

- loudness / LUFS
- duration
- BPM/key if reliable
- lyrics extracted
- visual dimensions
- video duration

Keep raw assets separate from analysis receipts.

## Open Questions

1. Should `Add Master` accept only one current master, or allow multiple versions?
   - Recommendation: allow many, mark one as `primary`.
2. Should copied assets be renamed automatically?
   - Recommendation: preserve names, collision suffix only.
3. Should the manifest be a context doc only or also a separate JSON file?
   - Recommendation: both eventually. V1 can use context doc only; V2 can add `assets/manifest.json` as the file-system source of truth and mirror it into context.
4. Should agents be allowed to write into `assets/`?
   - Recommendation: no for V1. Agent outputs go to Outputs. User can promote an output into mission assets later.
5. Should linked folders be supported in V1?
   - Recommendation: no. Copy-first is simpler and more reliable.

## Acceptance Criteria

- User can create a mission and then add a master without thinking about folders.
- Runner creates stable local asset folders automatically.
- Imported files appear in the right folder.
- Manifest context is created or updated.
- New agent sessions receive the manifest in workspace context.
- No large file bytes are injected into prompts.
- User can open the assets folder in Finder.
- Existing files are copied, never moved or deleted.
- Missing files are handled gracefully.
