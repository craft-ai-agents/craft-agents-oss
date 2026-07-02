---
status: draft
owner: agent
last_verified: 2026-07-02
source_of_truth: false
supersedes_candidate: docs/creator-command-center/05-team-access-without-a-server-spec.md
---

# Team Mode and Shared Storage Architecture Spec

> Scope: end-to-end design for Solo mode, Team mode, shared folder storage, Git-backed storage, file migration, conflict handling, runner-machine automation, Community fan/email workflows, and the path to a future hosted multi-user system.
>
> This is the thorough replacement candidate for `05-team-access-without-a-server-spec.md`. The older doc has the right instinct, but this spec tightens the implementation contract so we do not ship a fragile "shared folder" feature that only works in demos.
>
> It also supersedes the `ArtistCommunity` data shape in `04-hq-homebase-architecture-spec.md` section 5 (the single-doc audience/broadcast arrays). The cadence/fatigue guard from that section is preserved here in 15.4 and 15.7.

---

## 0. Decision

Ship three user-facing storage modes:

1. **Solo**
   - Workspace lives on this machine.
   - Everything is local-first.
   - No team sync assumptions.

2. **Shared Folder**
   - User chooses a folder already synced by Google Drive, Dropbox, iCloud Drive, OneDrive, Syncthing, etc.
   - RunnerOS owns the workspace file format.
   - The provider only moves files between machines.
   - This is the default Team mode for normal artists/managers.

3. **Git**
   - Advanced mode.
   - Excellent for text, specs, context docs, prompts, recipes, and history.
   - Poor default for fan lists, high-churn JSON, pulse logs, sessions, and media unless Git LFS or a hybrid layout is used.

Do **not** build a provider-specific Google Drive or Dropbox API integration for V1 team storage. That creates extra auth, quota, rate-limit, and provider-specific failure modes without solving the core need. The app should let the user pick a synced folder, validate it, move/copy the workspace into it, and make the workspace format conflict-safe.

The hard architectural rule:

> **The workspace is the durable source of truth. Sync providers are dumb transport. Secrets and machine identity stay private.**

---

## 1. Product Goal

Let an artist, manager, assistant, and collaborators open the same Artist HQ hub from their own desktop apps and see the same:

- HQ brief.
- Community/fan list.
- Network contacts.
- Calendar context.
- Vault assets.
- Email draft queue.
- Worker outputs.
- Automation/pulse history.

The experience should feel like:

```text
Settings -> Team -> Turn on Team Mode
Choose: Google Drive / Dropbox / iCloud / OneDrive / Syncthing / Git
Pick a folder
RunnerOS moves the workspace safely
Pick the runner machine
Invite teammates by sharing the folder
```

It should not feel like:

```text
Set up a database
Create accounts
Configure OAuth for Drive
Learn Git
Copy random folders manually
Hope secrets do not sync
```

---

## 2. Non-Goals

V1 Team mode does **not** provide:

- Real-time Google Docs style co-editing.
- Per-user accounts.
- Role-based permissions.
- View-only collaborators.
- Cryptographic access control inside the shared folder.
- Guaranteed attribution for every edit.
- Live presence.
- Conflict-free simultaneous edits to the same entity without review.
- Hosted cloud backup owned by RunnerOS.

If the user needs those, the right product is the later **hosted team server** path.

---

## 3. Current Code Truth

Verified against the current worktree on 2026-07-02.

### Existing Workspace Shape

RunnerOS already treats a workspace as a folder on disk:

```text
<workspace-root>/
  config.json
  sources/
  sessions/
  skills/
  labels/config.json
  statuses/config.json
  activated-agents.json
  activated-workflows.json
  automations.json
  automations-history.jsonl
  automations-retry-queue.jsonl
  context/<slug>/CONTEXT.md
  outputs/<output-id>/output.json
  pulses/<pulse-id>/ticks.jsonl
  notifications.json
```

Relevant implementation references:

- Workspace creation/config: `packages/shared/src/workspaces/storage.ts`
- Workspace config type: `packages/shared/src/workspaces/types.ts`
- Context docs: `packages/shared/src/workspace-context/storage.ts`
- Context doc routing/goals: `packages/shared/src/workspace-context/types.ts`
- Automations: `packages/shared/src/automations/types.ts`
- Pulse logs: `packages/shared/src/pulses/storage.ts`
- Outputs: `packages/shared/src/outputs/storage.ts`
- Source config: `packages/shared/src/sources/storage.ts`
- Credentials: `packages/shared/src/credentials/backends/secure-storage.ts`

### Existing Secret Boundary

Secrets are already outside the workspace:

```text
~/.craft-agent/credentials.enc
```

`CONFIG_DIR` defaults to:

```text
~/.craft-agent
```

This is the right boundary. Team mode must preserve it.

### Existing Portability Helpers

There are already helpers for portable paths:

- `expandPath`
- `toPortablePath`
- `isPortablePath`
- `stripPathPrefix`

Current code converts some workspace-stored paths to portable form, including:

- `config.defaults.workingDirectory`
- local source paths
- session `workingDirectory` on persistence paths where used

Do not assume portability is complete. Team mode requires a full audit of every workspace-written path.

### Existing Community Shape

The Community page currently persists one `artist-community` context doc containing:

```ts
type ArtistCommunity = {
  version: 1
  contacts: CommunityContact[]
  emailJobs: CommunityEmailJob[]
  updatedAt: string
}
```

That is acceptable for the first single-user UI slice, but it is **not** the correct long-term shared storage shape. In Team mode, high-churn lists need one file per entity, and `artist-community` should become a generated summary/context doc for agents.

---

## 4. Architecture Principles

### 4.1 Local-First Always

Every mode starts with local files. Team mode changes where the workspace lives and how we guard writes. It does not turn the app into a cloud app.

### 4.2 Provider-Neutral Workspace Format

The workspace layout must work the same in:

- Google Drive synced folder.
- Dropbox synced folder.
- iCloud Drive.
- OneDrive.
- Syncthing.
- Git repo.
- External drive.
- Future hosted storage adapter.

No core data model should depend on Drive IDs, Dropbox IDs, or Git commits.

### 4.3 Shared Data Is Relative

Anything inside the shared workspace that points to another file must use one of these:

```ts
type SharedPathRef =
  | { kind: 'workspace'; path: string }         // relative path inside workspace
  | { kind: 'vault-object'; sha256: string }    // content-addressed object in vault
  | { kind: 'external'; refId: string }         // resolved by private per-machine override
```

Do not write raw machine paths into shared records.

Bad:

```json
{ "path": "/Users/michaelb.williams/Desktop/song.wav" }
```

Good:

```json
{ "kind": "workspace", "path": "vault/assets/3f/3f2a.../song.wav" }
```

Good escape hatch:

```json
{ "kind": "external", "refId": "press-photo-folder" }
```

with this private file:

```text
~/.craft-agent/team/<workspace-id>/path-overrides.json
```

### 4.4 Secrets Never Sync

Never put these in a shared workspace:

- OAuth refresh tokens.
- API keys.
- SMTP passwords.
- Gmail tokens.
- ESP tokens.
- `.env`
- `.env.local`
- `~/.craft-agent`
- machine-local app config.

### 4.5 One Writer for Background Work

Background automations must have exactly one runner machine in Shared Folder mode.

Manual user-triggered actions can happen from any machine. Scheduled/background work must not.

### 4.6 High-Churn Data Must Be Entity Files

Do not store large shared lists as a single JSON array in a context doc.

Bad for Team mode:

```text
context/artist-community/CONTEXT.md
  contains 2,000 contacts in one JSON block
```

Good:

```text
records/community/contacts/fan_01.json
records/community/contacts/fan_02.json
records/community/email-jobs/job_01.json
context/artist-community/CONTEXT.md    # generated summary for agents
```

This avoids constant conflicts and makes sync failures repairable.

### 4.7 Code Placement (process boundary rule)

Today the artist/community logic lives in the **renderer** (`apps/electron/src/renderer/lib/artist-community.ts` and friends), persisting via workspace-context IPC. Automations, the scheduler, and workers run in the **main process** (`packages/shared` + `apps/electron/src/main/index.ts`).

Rule: everything Team mode depends on for correctness MUST live in `packages/shared`:

- the `records/` substrate (entity read/write, revisions, tombstones, oplog, conflicts) — `packages/shared/src/records/`
- suppression checks
- community summary generation
- the runner gate and job claims
- the migration engine

The renderer becomes a caller via IPC. If suppression or summary logic stays renderer-side, the runner and background workers literally cannot enforce it. Phase 4 builds the substrate in `packages/shared/src/records/` from day one — this resolves Open Decision 4.

---

## 5. Storage Modes

### 5.1 Solo Mode

Default mode.

```ts
type WorkspaceStorageMode = 'solo'
```

Behavior:

- Workspace can live in `~/.craft-agent/workspaces/<slug>` or any chosen local folder.
- Automations run normally.
- No team config needed.
- No runner machine needed.
- File references may still be portable, but strict shared checks are not required.

Use when:

- One person.
- One machine.
- No shared fan list or team workflow needed.

### 5.2 Shared Folder Mode

Recommended team mode.

```ts
type WorkspaceStorageMode = 'shared-folder'
```

Behavior:

- Workspace root is inside a folder synced by a third-party provider.
- Provider authentication is outside RunnerOS.
- Teammates join by opening the same folder from their local sync client.
- RunnerOS writes a team config into the workspace.
- Each machine writes private identity/overrides under `~/.craft-agent/team/<workspace-id>/`.
- Only the selected runner machine executes background automations.

Provider labels:

```ts
type SharedFolderProvider =
  | 'google-drive'
  | 'dropbox'
  | 'icloud-drive'
  | 'onedrive'
  | 'syncthing'
  | 'generic-folder'
```

Important: this is a label for UX and diagnostics, not a provider API contract.

### 5.3 Git Mode

Advanced mode.

```ts
type WorkspaceStorageMode = 'git'
```

Behavior:

- Workspace is a Git repo.
- App can show Git status, branch, ahead/behind, uncommitted changes, and conflicts.
- App may help commit/pull/push later, but V1 can be manual.
- Large media requires Git LFS or a hybrid media folder.

Use when:

- Technical owner wants history.
- Text docs matter more than media.
- Team can understand commit/pull/push.

Do not make this the default artist workflow.

### 5.4 Future Hosted Team Mode

Later mode, not V1.

```ts
type WorkspaceStorageMode = 'hosted'
```

Use only when we need:

- Accounts.
- Roles.
- Live collaboration.
- Audit logs.
- Server-side scheduled workers.
- True permission boundaries.
- Multi-device sync without consumer drive clients.

---

## 6. Proposed Workspace Layout

### 6.1 Shared Workspace Root

```text
Artist HQ/
  config.json                      # authoritative workspace config (formatVersion, storage, team)

  team/
    config.json                    # generated mirror of team/storage fields; never authoritative (see 7)
    machines/
      <machine-id>.json            # heartbeats
    oplog/
      <machine-id>.jsonl           # per-machine write journal; one writer each (see 12.3)
    conflicts/
      index.json
      <conflict-id>.json
    migrations/
      <migration-id>.json          # migration receipts
    locks/
      <entity-id>.json             # soft locks (see 12.5)

  context/
    artist-profile/CONTEXT.md
    artist-network/CONTEXT.md
    artist-calendar/CONTEXT.md
    artist-community/CONTEXT.md    # generated summary (runner-owned)
    hq-state-of-play/CONTEXT.md    # generated (runner-owned)

  records/
    community/
      index.json                   # generated collection index (runner-owned, regenerable)
      contacts/
        <contact-id>.json
      segments/
        <segment-id>.json
      imports/
        <import-id>.json
      email-jobs/
        <job-id>.json
      suppression/
        <email-hash>.json
    network/
      index.json
      people/
        <person-id>.json
      interactions/
        <interaction-id>.json
    calendar/
      index.json
      events/
        <event-id>.json
    jobs/
      <job-id>.json                # background job claim/lease records (see 14.4)

  vault/
    objects/
      <sha256-prefix>/<sha256>/<filename>
    manifests/
      <asset-id>.json
    imports/
      <import-id>.json

  outputs/
    <output-id>/output.json

  sessions/                        # team-SHARED sessions only; new sessions default private (see 11.3)
    <session-id>/session.jsonl

  automations.json
  automations-history/
    <machine-id>.jsonl             # per-machine append logs, merged on read (see 11.2)
  automations-retry-queue.jsonl    # runner-owned only

  pulses/
    <pulse-id>/ticks.jsonl         # runner-owned only

  notifications/
    <machine-id>.json              # per-machine read/unread state (see 11.6)

  labels/config.json
  statuses/config.json
  permissions.json                 # team-approved rules only; session-time grants stay private (see 11.6)
  activated-agents.json
  activated-workflows.json
```

Scale note: flat entity directories are fine up to roughly 5k entities per collection. Beyond that, shard by two-character id prefix (`contacts/<id[0..2]>/<contact-id>.json`). The runner-generated `index.json` per collection keeps list views to a single read either way (see 11.2).

### 6.2 Private Per-Machine State

```text
~/.craft-agent/
  config.json
  credentials.enc

  team/
    <workspace-id>/
      machine.json
      path-overrides.json
      local-settings.json
      local-permissions.json       # session-time "always allow" grants (see 11.6)
      provider-diagnostics.json
      ignored-conflicts.json
      undo/
        <entity-id>/<revision>.json   # pre-write copies for clobber recovery (see 12.3, pruned)
      private-sessions/
        <session-id>/session.jsonl    # default home for new sessions in Team mode (see 11.3)
```

Private machine state owns:

- Machine ID.
- Human display name for this device.
- Path overrides for external refs.
- Local "I am runner" eligibility.
- Credentials.
- Provider diagnostics.
- Local cache and sync-health observations.

Private state must never be required for another teammate to open the workspace.

---

## 7. Workspace Config Extensions

Extend `WorkspaceConfig` with storage/team metadata. This is additive and backwards compatible.

```ts
interface WorkspaceConfig {
  id: string
  name: string
  slug: string
  formatVersion?: number            // absent = 1 (legacy). Bump on breaking layout changes.
  defaults?: WorkspaceDefaults
  localMcpServers?: LocalMcpConfig
  developer?: DeveloperConfig
  storage?: WorkspaceStorageConfig
  team?: WorkspaceTeamConfig
  movedTo?: string                  // tombstone left at an old location after migration (see 9.2)
  forkedFrom?: {                    // set on a disconnected copy (see 9.4)
    workspaceId: string
    teamId: string
    forkedAt: string
  }
  createdAt: number
  updatedAt: number
}

type WorkspaceStorageConfig =
  | {
      mode: 'solo'
      portabilityVersion: 1
    }
  | {
      mode: 'shared-folder'
      portabilityVersion: 1
      provider: SharedFolderProvider
      providerLabel?: string
      sharedRootId: string
      enabledAt: string
      movedFrom?: string
      vaultPolicy: 'copy-into-workspace' | 'allow-external-with-overrides'
      pathPolicy: 'relative-required'
    }
  | {
      mode: 'git'
      portabilityVersion: 1
      remoteUrl?: string
      branch?: string
      vaultPolicy: 'git-lfs' | 'external-media-folder' | 'text-only'
      pathPolicy: 'relative-required'
    }

interface WorkspaceTeamConfig {
  enabled: boolean
  teamId: string
  revision: number                  // increment on EVERY team-config change; heartbeats ack it (see 14.5)
  minAppVersion: string             // written on every format-affecting change
  runnerMachineId?: string
  runnerHandover?: {                // present only while a handover is pending (see 14.5)
    from: string
    to: string
    initiatedAt: string
  }
  automationsPolicy: 'runner-only' | 'manual-only'
  backgroundTriggersEnabled: boolean
  createdAt: string
  updatedAt: string
}
```

The `hosted` variant of `WorkspaceStorageConfig` is intentionally not defined in this union until that project starts.

### 7.1 Version Gate (exact)

- The app defines `SUPPORTED_WORKSPACE_FORMAT_VERSION`.
- `formatVersion` greater than supported → open **read-only** with an "update the app" prompt. Never write.
- `team.minAppVersion` greater than the running app version → same read-only gate.
- Workspaces without `formatVersion` are treated as version 1 and always open.

Teams guarantee app-version skew across machines. Without this gate, an older app will mangle records written by a newer one.

### 7.2 Single Source of Truth (exact)

`config.json` is authoritative. `team/config.json` is a **generated mirror**, rewritten after every team-config change, stamped `{ generatedFrom: { updatedAt } }`, kept for human inspection and disaster recovery only. Nothing reads the mirror in normal operation. On divergence, `config.json` wins and the mirror is rewritten.

---

## 8. Machine Identity

Each desktop app instance gets a stable machine ID for this workspace.

Private file:

```text
~/.craft-agent/team/<workspace-id>/machine.json
```

Shape:

```json
{
  "version": 1,
  "workspaceId": "ws_1234abcd",
  "machineId": "machine_8x7k2p",
  "displayName": "Michael's MacBook Pro",
  "createdAt": "2026-07-02T12:00:00.000Z",
  "lastOpenedAt": "2026-07-02T12:00:00.000Z"
}
```

Shared heartbeat file:

```text
team/machines/<machine-id>.json
```

Shape:

```json
{
  "version": 1,
  "machineId": "machine_8x7k2p",
  "displayName": "Michael's MacBook Pro",
  "appVersion": "0.8.13",
  "canRunAutomations": true,
  "isRunner": true,
  "observedTeamRevision": 7,
  "lastSeenAt": "2026-07-02T12:05:00.000Z",
  "lastAutomationHeartbeatAt": "2026-07-02T12:04:30.000Z"
}
```

Rules:

- Machine ID is generated locally.
- Shared heartbeat contains no secrets.
- Heartbeat is useful for "runner online/offline" UX, not security.
- A user can rename their machine.
- If a machine disappears, its heartbeat can go stale without breaking the workspace.
- A machine only ever writes its **own** heartbeat file.
- `observedTeamRevision` is the highest `team.revision` this machine has loaded. This field is what makes runner handover safe (see 14.5).

Cadence (exact — heartbeats must not become sync churn):

- Write on workspace open, then every **5 minutes** while the app is in the foreground. Never on UI interaction.
- The runner additionally updates `lastAutomationHeartbeatAt` every **60 seconds only while background work is executing**, plus once per idle scheduler pass (max every 5 minutes).
- Stale = `lastSeenAt` older than **15 minutes** (3 missed intervals).

---

## 9. Team Settings UX

### 9.1 Settings Page

Add:

```text
Settings -> Team
```

Sections:

1. Current mode
   - Solo
   - Shared Folder
   - Git

2. Team workspace
   - Folder path
   - Provider label
   - Sync health
   - Copy path
   - Reveal in Finder

3. Runner machine
   - Current runner
   - This machine status
   - Make this machine runner
   - Disable background work on this machine

4. Data safety
   - Secrets scan
   - External path scan
   - Vault policy
   - Conflict inbox

5. Advanced
   - Export local copy
   - Disconnect from team mode
   - Git status if mode is Git

### 9.2 Enable Team Mode Flow

```text
Team -> Turn on Team Mode
  1. Choose storage:
     - Shared Folder (recommended)
     - Git (advanced)

  2. If Shared Folder:
     - Choose provider label
     - Pick synced folder
     - Choose move vs copy

  3. Preflight:
     - no running sessions that would write during move
     - no background automation currently executing
     - workspace config parses
     - context docs parse
     - automations parse
     - source configs parse
     - secrets scan passes
     - path portability scan passes or gives fix choices
     - enough disk space

  4. Migration (exact procedure — survives crash, partial sync, and teammates opening early):
     a. pause automations and the scheduler on this machine
     b. create the target as a temp dir INSIDE the destination:
        <dest>/.craft-migrating-<migration-id>/
     c. write team/migrations/<migration-id>.json receipt with status "in-progress"
        into the temp dir
     d. copy all workspace files EXCEPT config.json, in deterministic order,
        rewriting portable paths during copy
     e. copy/verify vault assets per policy (sha256 verify after each copy)
     f. write the new config.json LAST, with storage/team/formatVersion fields set.
        A folder without config.json is unopenable by design — copying it last
        IS the open guard against partially-synced state.
     g. finalize the receipt to status "complete"
     h. rename the temp dir to the final folder name
        (same volume, so the rename is atomic at the filesystem level)
     i. update local ~/.craft-agent/config.json workspace rootPath
     j. write a `movedTo` tombstone into the ORIGINAL workspace's config.json so any
        stale app instance pointing at the old path shows "workspace moved", read-only
     k. re-enable automations

     Open guard (all machines, all modes):
     - refuse to open a folder named `.craft-migrating-*`
     - refuse when the migration receipt says "in-progress"
     - show "still syncing — wait" when workspace files exist but config.json is missing

     The provider WILL start uploading the temp dir mid-copy. That is fine — the guard
     makes partial state unopenable rather than pretending the provider can be paused.

     Rollback: any failure before (h) = delete the temp dir; the original is untouched.
     Steps (i) and (j) are idempotent and retryable.

  5. Runner choice:
     - make this machine runner
     - manual-only for now

  6. Done:
     - show "Share this folder with teammates"
     - show "Teammates choose Open Existing Team Workspace"
```

### 9.3 Join Existing Team Workspace Flow

```text
Workspace Picker -> Open Existing Team Workspace
  1. Pick folder
  2. Refuse if the folder name matches `.craft-migrating-*` or the migration
     receipt is "in-progress"
  3. Validate config.json exists and parses
     (workspace files present but config.json missing = "still syncing - wait")
  4. Enforce the version gate (7.1) - newer than this app = read-only + upgrade prompt
  5. Detect storage.mode
  6. Create private machine identity
  7. Create heartbeat (including observedTeamRevision)
  8. Ask whether this machine can run background work
  9. Default to not runner
  10. Open workspace
```

### 9.4 Disconnect Flow

```text
Team -> Disconnect / Make Local Copy
  1. If this machine is the current runner: write team config with runnerMachineId
     cleared and automationsPolicy 'manual-only' (best-effort - skip if unreachable),
     so teammates are not left pointing at a runner that no longer exists
  2. Choose local destination
  3. Copy workspace
  4. In the copy: mint a NEW workspace id, set forkedFrom { workspaceId, teamId,
     forkedAt }, set storage.mode = 'solo', delete team/ (keep migrations/ receipts)
  5. Register the copy as a new local workspace; private machine state starts fresh
     under the new id
  6. Credentials are untouched (they were never in the workspace)
```

Do not delete the shared folder. Disconnection only creates a local copy.

The new workspace id is not optional: private machine state is keyed by workspace id under `~/.craft-agent/team/<workspace-id>/`, and the app registry must be able to hold the shared workspace and its disconnected fork on the same machine without collision.

---

## 10. Provider Strategy

### 10.1 Shared Folder Providers

Supported as folder transports:

| Provider label | Implementation | Notes |
|---|---|---|
| Google Drive | User selects a folder under Google Drive for desktop | No Drive API required for storage V1 |
| Dropbox | User selects a Dropbox folder | Watch for conflicted copy files |
| iCloud Drive | User selects an iCloud Drive folder | Watch for delayed availability/download placeholders |
| OneDrive | User selects a OneDrive folder | Watch for Files On-Demand placeholders |
| Syncthing | User selects synced folder | Best for technical users who want no big cloud provider |
| Generic folder | User selects any folder | Useful for NAS/external drive/manual sync |

Provider detection should be best-effort only. Do not block a user because the folder path does not match a known provider pattern.

### 10.2 Git Provider

Git mode should show:

- Current branch.
- Remote.
- Dirty files.
- Ahead/behind.
- Merge conflicts.
- Last commit.
- Whether Git LFS appears configured.

Git mode should warn:

- Do not put large audio/video directly in Git.
- Pull before editing.
- Commit/push to share.
- Conflicts are explicit and need review.

### 10.3 Why Not Direct Google Drive API for Storage V1

Direct Drive API storage would require:

- Google OAuth setup.
- Drive file IDs and parent IDs.
- File upload/download state.
- Conflict handling against Drive revisions.
- Quota handling.
- Offline handling.
- A local cache anyway.
- Provider-specific code that does not help Dropbox/iCloud/OneDrive.

The synced-folder path gives us the same user value faster and with fewer moving parts.

Use Google APIs for **Calendar/Gmail/Drive file context** where the product needs Google-specific features. Do not use Google APIs as the V1 workspace storage layer.

---

## 11. Data Ownership

### 11.1 Shared Durable Data

This should sync:

- `config.json`
- `team/config.json`
- `team/machines/*.json`
- `context/**/CONTEXT.md`
- `records/**/*.json`
- `vault/objects/**`
- `vault/manifests/**/*.json`
- `outputs/**`
- `labels/config.json`
- `statuses/config.json`
- `permissions.json`
- `activated-agents.json`
- `activated-workflows.json`
- `automations.json`

### 11.2 Shared But Runner-Owned

This can sync, but only the runner writes:

- `automations-retry-queue.jsonl`
- `pulses/<pulse-id>/ticks.jsonl`
- generated `hq-state-of-play`
- generated context summaries (including the `artist-community` summary)
- `records/**/index.json` collection indexes
- background job result files

Multi-writer append logs are forbidden (4.6) — a shared JSONL that several machines append to is a guaranteed conflicted-copy generator. Anything a NON-runner machine may also legitimately write gets **per-machine files** instead:

- `automations-history/<machine-id>.jsonl` — manual runs happen on any machine, so each machine appends only its own file; the UI merges by timestamp on read.
- `notifications/<machine-id>.json` — read/unread state is per person anyway.

### 11.3 Sessions Are Private By Default

Sessions routinely contain secrets by accident — agents `cat .env`, tokens appear in terminal output, private prompts reference unreleased work. They are also the highest-churn files in a workspace (exactly what consumer sync clients handle worst). So in Team mode:

- New sessions are created under `~/.craft-agent/team/<workspace-id>/private-sessions/` — **not** in the shared folder. This is the default.
- An explicit **"Share with team"** action moves the session folder into workspace `sessions/<session-id>/` and records this machine as owner in the session header.
- Shared sessions follow single-writer rules:
  - `sessions/<session-id>/session.jsonl`
  - `sessions/<session-id>/attachments/**`
  - `sessions/<session-id>/downloads/**`
  - `sessions/<session-id>/data/**`
- The owning machine appends; other machines read.
- "Continue this session on this machine" transfers ownership explicitly — an owner field in the session header, guarded by the same revision check as entity files (12.3).
- If two machines write the same shared session, create a conflict record. Never merge JSONL silently.

This resolves Open Decision 2.

### 11.4 Private Local Data

Never sync:

- `~/.craft-agent/credentials.enc`
- OAuth tokens.
- API keys.
- local app config.
- `node_modules`
- build outputs.
- provider caches.
- `.env`
- `.env.local`
- raw OS keychain data.
- temp files.
- session-time permission grants (`local-permissions.json`, see 11.6).
- private sessions (11.3).
- the undo cache (12.3).

### 11.5 Derived Cache Data

Can be regenerated and should usually not sync:

- thumbnail caches.
- embedding caches.
- local search indexes.
- provider sync diagnostics.
- temporary export files.

If a cache is expensive and useful to sync, it needs its own explicit versioned cache contract.

### 11.6 Previously Unclassified Files

- `labels/config.json`, `statuses/config.json` — shared, low churn; last-writer-wins is acceptable.
- `activated-agents.json`, `activated-workflows.json` — shared (they define the team-level roster).
- `permissions.json` — **split**. The shared file holds only deliberate, team-approved rules edited through settings. Session-time "always allow" grants are per-machine and go to `~/.craft-agent/team/<workspace-id>/local-permissions.json`. Effective permissions = shared rules ∪ local grants. Rationale: one teammate's casual allow-all must not silently apply to everyone's agents, and grant rules often embed machine-specific paths.
- `notifications/<machine-id>.json` — per-machine (see 11.2).

---

## 12. Conflict Model

### 12.1 The Core Problem

Consumer sync tools do not provide database transactions. They copy files and sometimes create conflicted duplicates.

So Team mode must avoid "one giant file everyone edits."

### 12.2 Entity File Contract

Every high-churn entity file should include:

```ts
interface SharedEntityMeta {
  id: string
  schemaVersion: number
  createdAt: string
  createdByMachineId?: string
  updatedAt: string
  updatedByMachineId?: string
  revision: number
  deletedAt?: string
}
```

Example:

```json
{
  "id": "fan_01jz...",
  "schemaVersion": 1,
  "createdAt": "2026-07-02T12:00:00.000Z",
  "createdByMachineId": "machine_8x7k2p",
  "updatedAt": "2026-07-02T12:10:00.000Z",
  "updatedByMachineId": "machine_8x7k2p",
  "revision": 3,
  "email": "fan@example.com",
  "name": "Alex",
  "tags": ["vip", "chicago"]
}
```

### 12.3 Write Safety — Honest Model

Read-compare-write revision checks protect against races on the **same** machine and detect divergence **after** sync has delivered the other side. They cannot prevent two machines writing the same entity during sync lag — each compares against its own local copy, then the provider picks a winner (Dropbox: conflicted-copy file; Drive/OneDrive: frequently a **silent last-writer-wins**). Team mode therefore layers three mechanisms:

1. **Collision avoidance** — one file per entity (4.6). Most edits touch different entities.
2. **Same-machine safety** — revision + content-hash compare before write.
3. **Clobber detection** — a per-machine oplog, so a lost write is *found and recovered* instead of vanishing.

Write procedure (exact):

1. Load entity; keep `{ revision: r, sha256: h }` as the UI baseline.
2. On save, re-read the file. If `revision != r` or the content hash differs from `h`: do **not** write. Create a conflict record with `{ base, current, incoming }` and surface it.
3. Else write atomically: temp file in the same directory → fsync → rename over target. New content sets `revision: r+1`, `updatedAt`, `updatedByMachineId`, and `lastWriteSha256: h` (the hash of the content this write replaced — a one-step lineage pointer).
4. Append to this machine's oplog:

```text
team/oplog/<machine-id>.jsonl     # one writer per file — conflict-free by construction
```

```json
{ "seq": 412, "at": "2026-07-02T12:10:00.000Z",
  "entityPath": "records/community/contacts/fan_01jz.json",
  "revision": 4, "contentSha256": "ab3f...", "prevSha256": "91c0..." }
```

5. Save the replaced content to the local undo cache `~/.craft-agent/team/<workspace-id>/undo/<entity-id>/<revision>.json` (pruned after 30 days).

Clobber detection (runs on the runner each scheduler pass; any machine may also run it on workspace open):

```text
for each local oplog entry E within the detection window (default 7 days):
  f  = read(E.entityPath)
  fh = sha256(f)
  if f.revision == E.revision and fh == E.contentSha256        -> intact
  else walk lineage backward from f using lastWriteSha256 and
       ALL machines' oplogs (they sync too): follow prevSha256
       links until reaching E.contentSha256
    reached                                                    -> superseded normally
    gap in the chain                                           -> my write was clobbered:
        create a conflict record; recover "mine" from the undo cache
```

If the chain cannot be verified (deep concurrent history, missing oplog segments), create a conflict record anyway — a false-positive conflict costs a click; a silent lost edit costs a fan's email address.

Conflict record:

```text
team/conflicts/<conflict-id>.json
```

Shape:

```json
{
  "version": 1,
  "conflictId": "conflict_01jz...",
  "entityPath": "records/community/contacts/fan_01jz.json",
  "detectedAt": "2026-07-02T12:15:00.000Z",
  "detectedByMachineId": "machine_abcd",
  "baseRevision": 3,
  "currentRevision": 4,
  "incoming": {},
  "current": {},
  "status": "open"
}
```

### 12.4 Provider Conflict Scanner

Sync providers may create files like:

```text
fan_01jz (Michael's conflicted copy).json
fan_01jz conflicted copy.json
fan_01jz (Case Conflict).json
```

Team mode should include a scanner that:

- detects likely conflicted files.
- creates conflict records.
- hides conflicted duplicates from normal list views.
- gives a Merge / Keep Mine / Keep Theirs / Archive choice.

### 12.5 Soft Locks

Soft locks are useful for UX, not correctness.

```text
team/locks/<entity-id>.json
```

Shape:

```json
{
  "entityPath": "records/community/contacts/fan_01jz.json",
  "lockedByMachineId": "machine_8x7k2p",
  "lockedAt": "2026-07-02T12:00:00.000Z",
  "expiresAt": "2026-07-02T12:10:00.000Z"
}
```

Rules:

- Show "Michael's MacBook is editing this."
- Expire automatically.
- Never rely on lock files as the only data safety mechanism.
- Revision checks still decide whether a write is safe.

### 12.6 Deletes

Use tombstones first:

```json
{
  "id": "fan_01jz...",
  "deletedAt": "2026-07-02T12:00:00.000Z",
  "deletedByMachineId": "machine_8x7k2p"
}
```

Hard-delete later through cleanup/compaction.

Why:

- Sync delete races are common.
- A teammate offline during deletion may reintroduce old files.
- Tombstones make deletion explicit and recoverable.

Contact tombstones must scrub PII. A deleted contact record keeps ONLY:

```json
{ "id": "fan_01jz...", "schemaVersion": 1, "revision": 5,
  "deletedAt": "2026-07-02T12:00:00.000Z",
  "deletedByMachineId": "machine_8x7k2p",
  "emailHash": "9c1d..." }
```

`emailHash` is retained so suppression continuity survives deletion; every other field (email, name, location, notes, tags) is removed from the file. **"Erase contact"** (GDPR-style requests) additionally purges the entity's undo-cache copies on the erasing machine and lists the entity in a `purgeUndoFor` array on the tombstone so other machines purge their undo caches on next open. Oplog entries contain only paths and hashes — no PII lives there.

---

## 13. Vault and File Storage

### 13.1 Default Policy

In Team mode, imported files should be copied into the workspace Vault by default.

```text
vault/objects/<sha256-prefix>/<sha256>/<filename>
```

Why:

- Every teammate can open the file.
- Paths are portable.
- Hashing prevents duplicate large files.
- Agent workers can rely on assets being present.

### 13.2 External File Escape Hatch

Allow external linked files only when the user deliberately chooses:

```text
Advanced -> Link file without copying
```

Then store:

```json
{
  "kind": "external",
  "refId": "press-photo-folder",
  "label": "Michael's local press photo folder"
}
```

Each machine maps it privately:

```json
{
  "press-photo-folder": "/Users/teammate/Pictures/Press Photos"
}
```

If no override exists, show:

```text
This file is linked to another machine. Add a local path override or ask the owner to copy it into Vault.
```

### 13.3 Git Mode Vault

Git mode must force one of:

1. `text-only`
   - No media in Git.
   - Good for docs/context only.

2. `git-lfs`
   - Media stored through Git LFS.
   - Requires LFS installed and configured.

3. `external-media-folder`
   - Git stores manifests and context.
   - Shared folder stores media.

Do not silently commit large media to Git.

### 13.4 Files On-Demand

iCloud/OneDrive/Drive can keep files as cloud placeholders — and placeholders are not just zero-byte files:

- iCloud replaces the file with a **sibling** named `.<name>.icloud`; the real filename may not exist locally at all.
- OneDrive Files On-Demand keeps the name but the content is a sparse pinned placeholder.
- Drive "online only" files behave similarly through the FileProvider layer.

Hydration probe before any worker/vault use (exact):

1. If `.<name>.icloud` exists where `<name>` should be → placeholder, not hydrated.
2. `stat` the file; size 0 where the manifest says otherwise → not hydrated.
3. Open and read the first 64KB; an error or short read → not hydrated.
4. On macOS, trigger hydration by reading the file (FileProvider hydrates on read) and surface progress as "downloading from provider" instead of failing.

Never let an agent fail deep in a workflow on an unhydrated file: the readiness check runs **before** the worker starts and lists unhydrated inputs as blockers.

---

## 14. Runner Machine and Automation Policy

### 14.1 Rule

In Team mode:

> Only the runner machine executes background automations.

Background triggers include:

- `SchedulerTick`
- `PollUrl`
- `FileWatch`
- webhook receivers if bound to this workspace
- message-receive triggers
- retry queue processing
- pulse ticks

Manual user actions are allowed on any machine.

### 14.2 Runner Gate

At automation trigger entry:

```ts
function canExecuteBackgroundAutomation(workspace, machine, trigger): boolean {
  if (workspace.storage.mode === 'solo') return true
  if (!workspace.team?.enabled) return true
  if (workspace.team.automationsPolicy === 'manual-only') return false
  if (workspace.team.runnerMachineId !== machine.machineId) return false
  if (isHandoverPending(workspace.team, machine)) return false   // see 14.5
  return true
}
```

If not runner:

- do not create a session.
- do not write pulse logs.
- do not mutate queues.
- optionally write a local-only debug log.

### 14.3 Runner Health

Runner writes heartbeat:

```json
{
  "lastAutomationHeartbeatAt": "2026-07-02T12:04:30.000Z"
}
```

UI states:

- Runner online.
- Runner stale.
- Runner missing.
- This machine can become runner.

If the runner is stale (no heartbeat for 15 minutes):

- show warning.
- do not auto-elect another runner in V1.
- user can manually switch runner (the stale path of the handover protocol, 14.5).

Keep-awake: while a machine is the runner, the app requests a power assertion (Electron `powerSaveBlocker.start('prevent-app-suspension')`) and Team Settings shows a "this machine may sleep" warning on laptops. The runner is usually somebody's desktop, not a server — treat sleep as a first-class state, not an error.

### 14.4 Job Claims

For queued jobs:

```json
{
  "jobId": "job_01jz...",
  "status": "queued",
  "claimedByMachineId": "machine_8x7k2p",
  "claimExpiresAt": "2026-07-02T12:15:00.000Z"
}
```

Rules:

- Runner claims before executing.
- Claim has expiry.
- Runner refreshes heartbeat while working.
- If claim expires, runner can reclaim.
- Non-runner never claims.

Honesty note: claim files travel over sync too, so claims **reduce** duplicate execution but cannot eliminate it under sync lag. The handover gate (14.5) is the primary mechanism. Every side-effectful job (email send, ESP campaign creation, export) additionally carries an `idempotencyKey`; transport adapters check for an existing draft/campaign with that key before creating — so even a double execution cannot double-send.

### 14.5 Runner Handover Protocol (exact)

`WorkspaceTeamConfig.revision` increments on every team-config change; every machine's heartbeat reports `observedTeamRevision` (see 8). Handover from machine A to machine B:

1. User on B clicks "Make this machine runner".
2. B writes team config: `runnerMachineId = B`, `revision = r+1`, `runnerHandover = { from: A, to: B, initiatedAt }`.
3. B enters **PENDING**: it is named runner but does NOT execute background work yet.
4. B activates when ANY of:
   a. A's heartbeat shows `observedTeamRevision >= r+1` (A saw the change and stopped), or
   b. A's `lastSeenAt` is stale (>15 minutes), or
   c. the grace window expires — default **10 minutes**, chosen to exceed realistic provider sync lag.
5. A, on loading revision `r+1`: stops background execution immediately, lets in-flight claims expire, updates its heartbeat.
6. On activation, B clears `runnerHandover`.

The dual-runner window is bounded by min(sync lag, grace window), and side effects inside that window are defused by job idempotency keys (14.4). The same protocol covers replacing a dead runner — path (b) is the takeover path.

### 14.6 Missed-Tick Catch-Up

The runner sleeps, reboots, and goes on tour. Define the semantics instead of leaving them to chance:

- Each scheduled automation/pulse gets `catchUp: 'skip' | 'run-once'` (default `'skip'`).
- On runner start/wake, compute ticks missed since `lastAutomationHeartbeatAt`.
- `skip`: ignore missed ticks; the next scheduled tick runs normally.
- `run-once`: if one or more ticks were missed, run a single execution flagged `{ catchUp: true }` so the automation can distinguish backfill from a live tick.
- **Never replay every missed tick.** A laptop closed for a week must not fire seven morning briefs.

---

## 15. Community and Email Architecture

### 15.1 Community Storage

Replace single-doc array storage with entity records:

```text
records/community/
  contacts/<contact-id>.json
  segments/<segment-id>.json
  imports/<import-id>.json
  email-jobs/<job-id>.json
  suppression/<email-hash>.json
```

Then generate:

```text
context/artist-community/CONTEXT.md
```

as an agent-readable summary:

```json
{
  "version": 2,
  "summary": {
    "totalContacts": 1200,
    "segments": [
      { "id": "vip", "label": "VIP", "count": 82 },
      { "id": "chicago", "label": "Chicago", "count": 240 }
    ],
    "lastBroadcastAt": "2026-06-12T15:00:00.000Z",
    "suppressedCount": 18
  },
  "recentBroadcasts": [],
  "warnings": []
}
```

Agents need the summary by default. They should only read full contact records when executing a specific approved job.

Summary regeneration is runner-owned (11.2): a non-runner edit marks the summary stale, and it regenerates on the runner's next pass. The UI shows the staleness stamp rather than blocking.

Segment records support both static and rule-based membership (restoring the dynamic segments from the 04 spec):

```ts
interface CommunitySegmentRecord extends SharedEntityMeta {
  label: string
  kind: 'static' | 'rule'
  memberContactIds?: string[]   // kind: static
  rule?: string                 // kind: rule — e.g. "tag:vip", "city:Chicago", "joined>-30d"
}
```

Rule segments are evaluated at audience-preview time, and the evaluated member list is **frozen into the email job's audience snapshot at approval** — what was approved is exactly what sends.

### 15.2 Contact Record

```ts
interface CommunityContactRecord extends SharedEntityMeta {
  email?: string          // optional: privacy mode stores only espExternalId + emailHash
  emailHash: string       // sha256(trim(lowercase(email))) — exact-address, no plus/dot folding
  espExternalId?: string
  name?: string
  city?: string
  region?: string
  country?: string
  source: 'manual' | 'csv-import' | 'signup-form' | 'esp-sync' | 'gmail-import'
  consentStatus: 'unknown' | 'opted-in' | 'transactional-only' | 'unsubscribed' | 'bounced'
  consentEvidence?: {
    source: string
    capturedAt?: string
    ipHash?: string
    formId?: string
  }
  tags: string[]
  segments: string[]
  notes?: string
  lastContactedAt?: string
}
```

Email should be stored only if the user expects the shared team to access fan PII. Otherwise, use an ESP external ID and store only summary/segment stats — the record shape above already supports this ("privacy mode"), so shipping the toggle later is a product decision, not a schema change.

Normalization, dedup, and import consent (exact):

- `emailHash = sha256(trim(lowercase(email)))`. No plus-tag or Gmail-dot folding — exact-address suppression is the legally safer reading of an unsubscribe.
- All imports **upsert by `emailHash`**. A repeated CSV import updates existing records instead of duplicating them. Import records store `{ created, updated, skippedSuppressed }`.
- Every import carries a consent attestation:

```ts
consentAttestation: {
  assertedBy: string        // machine + display name
  assertedAt: string
  basis: 'existing-list-opt-in' | 'signup-form' | 'unknown'
}
```

- Contacts imported with `basis: 'unknown'` get `consentStatus: 'unknown'` — and unknowns are **excluded from marketing sends by default** (15.7). This closes the classic spam path: dump a CSV in, blast the list.

### 15.3 Suppression Record

```ts
interface SuppressionRecord extends SharedEntityMeta {
  emailHash: string
  reason: 'unsubscribed' | 'bounced' | 'complained' | 'manual-block'
  source: 'manual' | 'gmail' | 'esp' | 'import'
  effectiveAt: string
}
```

Hard rule:

> A suppressed contact cannot be included in a marketing send, even if an agent proposes it.

### 15.4 Email Job Record

```ts
type EmailJobStatus =
  | 'draft'
  | 'needs-provider'     // transport selected but not connected on this machine
  | 'needs-approval'
  | 'approved'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'cancelled'

interface CommunityEmailJobRecord extends SharedEntityMeta {
  title: string
  purpose: 'announcement' | 'newsletter' | 'personal-outreach' | 'transactional'
  audience: {
    segmentIds: string[]
    includedConsentStatuses: ConsentStatus[]   // default ['opted-in']
    estimatedRecipients: number
    excludedSuppressed: number
    excludedUnknownConsent: number
    frozenMemberHashes?: string[]              // snapshot at approval (rule segments, 15.1)
  }
  content: {
    subject: string
    previewText?: string
    bodyMarkdown: string
  }
  compliance: {
    requiresUnsubscribe: boolean
    physicalAddressIncluded: boolean
    senderIdentityConfirmed: boolean
    suppressionCheckedAt?: string
  }
  cadence: {                                   // fatigue guard, carried from the 04 spec
    lastBroadcastAtAtDraft?: string
    minDaysBetweenBroadcasts: number           // default 7
    fatigued: boolean                          // now - lastBroadcastAt < min at draft time
    overriddenBy?: { machineId: string; at: string }
  }
  idempotencyKey: string                       // adapters check-before-create with this (14.4)
  transport: {
    provider: 'gmail' | 'esp' | 'manual-export'
    providerAccountId?: string
    providerCampaignId?: string
  }
  approval?: {
    approvedByMachineId?: string
    approvedAt?: string
  }
  send?: {
    scheduledFor?: string
    startedAt?: string
    completedAt?: string
    sentCount?: number
    failedCount?: number
  }
}
```

Current implementation note: Phase 6 stores the cadence fields but does not enforce fatigue yet. `fatigued` remains inert until Phase 7 adds approval/send state and a real `lastBroadcastAt` source; the cadence gate belongs in approval, not draft creation.

### 15.5 Gmail Boundary

Gmail is useful for:

- Drafting individual outreach.
- Drafting small batches.
- Sending from the artist's familiar mailbox.
- Reading threads when the user approves Gmail access.
- Personal follow-ups where reply context matters.

Gmail is not the best backbone for serious fan-list marketing:

- Gmail has rolling sending limits that can change without notice.
- Google Workspace documents daily per-user limits and recipient limits.
- Gmail API has per-minute quota units and a 500-recipient-per-message API limit.
- `messages.send` and `drafts.send` are high-cost API methods.
- Bulk marketing needs unsubscribe handling, bounce handling, complaint handling, deliverability, templates, and campaign analytics.

Official references checked on 2026-07-02:

- [Gmail sending limits in Google Workspace](https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace)
- [Gmail API usage limits](https://developers.google.com/workspace/gmail/api/reference/quota)

Hard V1 constants — enforced in the Gmail adapter, not left to judgment:

```ts
const GMAIL_MAX_RECIPIENTS_PER_JOB = 100            // above this: ESP or manual export, no override
const GMAIL_MAX_MARKETING_RECIPIENTS_PER_DAY = 200  // well under Workspace 2,000 / consumer 500
const GMAIL_SEND_INTERVAL_MS = 2_000                // one message per ~2s, jittered
```

Sends are one individual message per recipient — never a BCC blast (BCC looks like spam to filters and breaks per-recipient unsubscribe). Marketing jobs over the caps do not degrade to Gmail under any setting; they require an ESP or a manual CSV export.

### 15.6 ESP Boundary

For real fan broadcasts, add an Email Service Provider adapter.

Provider-neutral interface:

```ts
interface EmailMarketingProvider {
  provider: 'mailchimp' | 'convertkit' | 'buttondown' | 'resend' | 'sendgrid' | 'custom'
  createDraftCampaign(job: CommunityEmailJobRecord): Promise<ProviderDraft>
  scheduleCampaign(providerCampaignId: string, scheduledFor: string): Promise<void>
  getCampaignStats(providerCampaignId: string): Promise<CampaignStats>
  syncSuppressions(): Promise<SuppressionRecord[]>
}
```

V1 does not need every provider. It needs the abstraction so Gmail is not abused as the bulk sender.

### 15.7 Approval Rules

No send to the fan list without ALL of:

- audience preview with final counts.
- **consent gate**: marketing purposes (`announcement`, `newsletter`) may include only `opted-in` contacts by default. `unknown` is excluded; including unknowns requires an explicit per-job override with a written justification recorded on the job. `personal-outreach` may target unknowns — it is individual mail, not bulk.
- suppression check (recorded via `suppressionCheckedAt`; a suppressed contact can NEVER be included, overrides or not).
- **cadence check**: if the list was broadcast within `minDaysBetweenBroadcasts`, the job is marked `fatigued` and approval requires an explicit override (the fatigue guard from the 04 spec). This is intentionally deferred until the email transport approval phase, where `lastBroadcastAt` is authoritative.
- compliance checklist (15.8).
- human approval.
- selected, connected transport (else status `needs-provider`).
- final subject/body preview.

For V1:

```text
Agent drafts -> user reviews -> app creates Gmail draft or ESP draft
```

Autonomous send can be a later setting, but it should remain off by default.

### 15.8 Compliance Guardrails

For commercial email in the U.S., the FTC says CAN-SPAM applies to commercial messages, not only bulk mail. The app should enforce a compliance checklist for marketing emails:

- accurate From/Reply-To identity.
- non-deceptive subject.
- ad/marketing identification where needed.
- valid physical postal address.
- opt-out/unsubscribe path.
- opt-outs honored promptly.
- suppression list respected.

Official reference checked on 2026-07-02:

- [FTC CAN-SPAM Act Compliance Guide for Business](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)

CAN-SPAM is the U.S. floor, not the ceiling — fan lists are international. GDPR (EU) and CASL (Canada) are stricter: they require consent **before** sending. The consent gate in 15.7 (marketing defaults to `opted-in` only) is what keeps the product on the safe side of all three without per-jurisdiction logic in V1, and "Erase contact" (12.6) covers GDPR erasure requests.

This spec is not legal advice. Product behavior should make the safe path the default.

---

## 16. Google Workspace Integration

Do not confuse two different Google roles:

### 16.1 Google Drive as Folder Sync

No app OAuth. User has Google Drive for desktop installed. RunnerOS just stores the workspace in a folder that Drive syncs.

Used for:

- Team workspace file sync.
- Vault files if copied into workspace.

### 16.2 Google Workspace APIs

OAuth required. Used for product features:

- Gmail draft/send/read.
- Calendar event sync.
- People/Contacts enrichment.
- Drive file picker or selected Drive file context.

These features follow `03-google-workspace-context-sync-spec.md`.

Rule:

> Storage sync should work even if the user never connects Google OAuth.

---

## 17. Path Portability Audit

Before Team mode ships, audit every file written under the workspace root for raw absolute paths.

Classes to check:

- workspace `config.json`.
- source `config.json`.
- session config/header records.
- output manifests.
- vault manifests.
- automation configs.
- calendar/network/community records.
- mission asset manifests.
- video studio project files.
- generated reports that reference local files.
- `permissions.json` rules with embedded paths (the shared half — see 11.6).

Policy:

- Inside shared workspace: use relative paths.
- Inside private machine config: absolute paths allowed.
- In generated human-readable reports: absolute paths are allowed only if marked as local and non-authoritative.

Test:

```text
Create workspace at /Users/alice/Drive/ArtistHQ
Add asset
Add local source
Add output
Move folder to /Users/bob/Drive/ArtistHQ
Open workspace
Everything that should resolve still resolves
Everything local-only shows a repair prompt
```

Reconciliation note: the 05 spec flagged `projects/config.json` (absolute `folderPath`) as the known offender. No projects registry exists in this worktree — before shipping, verify whether that feature lives in another branch; if it lands, it MUST be added to this audit and must use `SharedPathRef`.

---

## 18. Sync Health

Team Settings should show:

- last workspace write.
- last provider conflict scan.
- runner heartbeat.
- conflict count.
- files waiting for local download.
- unportable path count.
- unresolved external refs.

For Shared Folder mode, avoid fake "online" promises. The app cannot fully know provider sync state without provider APIs. It can still detect local symptoms:

- conflicted files.
- missing expected files.
- zero-byte placeholder assets.
- stale runner heartbeat.
- recent writes not visible on another machine if heartbeat exists.

### 18.1 Watcher Noise Filter

Sync delivery fires the app's own watchers (config watcher, FileWatch automations) for every teammate write — including partial writes and provider junk. All workspace watchers in Team mode must:

- debounce per path (≥2s quiet period) before reacting.
- ignore provider artifacts: `~$*`, `*.tmp`, `*.part`, `*.crdownload`, `.DS_Store`, `._*` AppleDouble files, `Icon\r`, `*.icloud` placeholders, and the conflicted-copy patterns from 12.4.
- treat JSON/JSONL parse failure as "probably a partial sync write": retry with backoff (3 attempts over ~5s) before surfacing an error.
- FileWatch automations run only on the runner (14.1) and DO fire for sync-delivered changes — that is a feature (a teammate drops a file in Vault, the runner auto-tags it) — with the debounce and ignore rules above preventing trigger storms.

---

## 19. Security Model

### 19.1 Shared Folder Trust Boundary

Anyone with access to the folder can read shared workspace data.

That includes:

- fan emails.
- contact notes.
- strategy docs.
- generated drafts.
- worker outputs.
- campaign plans.

So Shared Folder mode is for trusted teams only.

### 19.2 What Shared Folder Mode Protects

It protects:

- local credentials.
- OAuth tokens.
- API keys.
- per-machine path overrides.
- app-level config.

because those stay in `~/.craft-agent`.

### 19.3 What It Does Not Protect

It does not protect:

- fan PII from collaborators with folder access.
- notes from being copied.
- a teammate from deleting files.
- a teammate from editing records directly.
- malicious edits inside shared files.

If that is unacceptable, use hosted mode with accounts/roles/audit logs later.

### 19.4 Control Plane Gate

No-server Shared Folder mode does not require exposing the local RunnerOS control plane to the network.

Any future web UI or hosted server path remains blocked until the local control-plane security audit is resolved. Do not expose browser/network access to local agent execution without origin/host authorization and per-channel permissions.

---

## 20. Implementation Plan

### Phase 0 - Accept the Product Decision

Deliverables:

- Decide that Shared Folder is the default Team mode.
- Decide that Git is advanced.
- Decide that direct provider APIs are not V1 storage.
- Decide that Community high-churn records move out of one context doc.
- Decide Gmail is drafts/small outreach, ESP is real broadcast path.

Exit criteria:

- This spec or a revised version becomes source of truth.

### Phase 1 - Team Metadata and Settings UI

Deliverables:

- Extend `WorkspaceConfig` with `storage`, `team`, and `formatVersion` + the version gate (7.1).
- Add `team/config.json` as a generated mirror with declared precedence (7.2).
- Add `team.revision` counter.
- Add private machine identity under `~/.craft-agent/team/<workspace-id>/machine.json`.
- Add shared machine heartbeat files (with `observedTeamRevision`, cadence per 8).
- Add `Settings -> Team`.

Tests:

- Old workspaces load with no storage field.
- New solo workspace writes `storage.mode = solo`.
- Enabling team writes team config.
- Joining existing team workspace creates private machine identity.
- A workspace with `formatVersion` above supported opens read-only with an upgrade prompt.

### Phase 2 - Move to Shared Folder

Deliverables:

- Team enable wizard.
- Folder picker.
- preflight validation.
- copy/move workspace with the exact procedure from 9.2 (temp `.craft-migrating-*` dir, config.json copied last, receipt lifecycle).
- portable path rewrite.
- migration receipt.
- `movedTo` tombstone at the original location.
- open guard (refuse mid-migration folders and config-less workspace folders).
- app config rootPath update.
- rollback on failure.

Tests:

- Move workspace from local folder to temp shared folder.
- Simulate failure mid-copy and verify original remains usable.
- Opening a `.craft-migrating-*` folder or an in-progress receipt is refused.
- A stale app instance at the old path sees "workspace moved", read-only.
- Verify no `.env` or credentials are copied from outside workspace.
- Verify `config.json` loads from new location.

### Phase 3 - Portability and Vault Hardening

Deliverables:

- Full path audit.
- `SharedPathRef` helpers.
- Vault copy-by-default.
- external path override UI.
- placeholder/missing-file detection.

Tests:

- Move workspace between two fake home dirs.
- Vault asset opens from relative path.
- External linked asset shows repair prompt on second machine.
- source/local paths persist in portable form.

### Phase 4 - Conflict-Safe Records Substrate

Deliverables:

- `records/` storage helpers **in `packages/shared/src/records/`** (renderer calls via IPC — see 4.7).
- entity metadata contract.
- revision-safe atomic writes (temp + fsync + rename).
- per-machine oplog + local undo cache + clobber detection (12.3).
- tombstone deletes with PII scrub for contacts (12.6).
- conflict records.
- provider conflicted-copy scanner.
- Conflict Inbox UI.
- **fake-sync test harness**: two workspace roots plus a copier daemon that injects delay, conflicted copies, and partial writes — this is what makes the multi-machine tests below real instead of hand-waving.

Tests:

- Same machine, stale UI baseline: second write creates a conflict record instead of overwriting.
- Two harness machines edit the same contact under simulated sync lag: the clobbered write is detected after sync and produces a conflict record with "mine" recoverable from the undo cache.
- tombstone delete prevents stale resurrection.
- contact tombstone contains no PII.
- conflicted copy file creates conflict inbox item.

### Phase 5 - Community V2

Deliverables:

- migrate `artist-community` doc contacts/jobs into `records/community`.
- generate `artist-community` context summary (runner-owned).
- generate `records/community/index.json` for cheap list views.
- add import records with consent attestation + upsert-by-emailHash dedup (15.2).
- add suppression records.
- add email job records (with cadence + idempotencyKey fields).
- update Community page to read records via IPC, not the single-doc array.

Tests:

- Existing V1 `artist-community` doc migrates.
- Contact edits write one file.
- Summary doc regenerates.
- Repeated CSV import creates zero duplicate contacts.
- Suppressed contact cannot enter email job audience.
- Unknown-consent contact is excluded from a marketing job by default.

### Phase 6 - Runner Machine Gate

Deliverables:

- automation background trigger gate (including the PENDING handover check).
- runner heartbeat with `observedTeamRevision`.
- runner handover protocol (14.5).
- missed-tick catch-up policy (14.6).
- `powerSaveBlocker` while runner.
- runner stale UI.
- manual runner switch.
- job claim/lease fields + idempotency keys on side-effectful jobs.
- non-runner skip behavior.

Tests:

- In solo mode, SchedulerTick runs.
- In shared mode on non-runner, SchedulerTick does not run.
- On runner, SchedulerTick runs and writes pulse log.
- Handover under simulated sync lag (fake-sync harness): old runner stops before new runner activates, or the bounded overlap produces no duplicate side effects (idempotency-key check).
- Stale-runner takeover activates after the grace window.
- Runner wake after missed ticks: `skip` runs nothing, `run-once` runs exactly one catch-up execution.
- stale runner is surfaced.

### Phase 7 - Email Transport Layer

Deliverables:

- provider-neutral email job interface.
- Gmail draft creation (idempotency-key check-before-create).
- Gmail small-send path behind approval, enforcing the hard constants from 15.5.
- consent gate + cadence gate in the approval flow (15.7).
- manual CSV export.
- ESP adapter interface.
- compliance checklist.

Tests:

- Gmail disconnected -> job status `needs-provider`.
- Gmail connected -> draft created, not sent by default.
- suppressed contacts excluded.
- unknown-consent contacts excluded from marketing jobs without an explicit recorded override.
- fatigued-list job requires an explicit cadence override before approval.
- a job exceeding GMAIL_MAX_RECIPIENTS_PER_JOB cannot select the Gmail transport.
- executing the same approved job twice creates exactly one draft/campaign (idempotency).
- missing physical address blocks marketing send.
- approval required before queue.

### Phase 8 - Git Advanced Mode

Deliverables:

- Git detection.
- status UI.
- conflict detection.
- Git LFS/media warning.
- optional manual commit/pull/push helpers.

Tests:

- Git workspace opens.
- dirty state shown.
- merge conflict state shown.
- large asset warning appears.

---

## 21. Acceptance Criteria

Team mode is shippable when:

1. A solo user can keep working exactly as before.
2. A user can move an existing workspace into a shared folder without data loss.
3. Another machine can open the shared workspace.
4. Secrets do not appear in the shared workspace.
5. Shared file references are relative or explicitly external.
6. Vault assets copied into the workspace open on another machine.
7. Only the runner machine executes background automations.
8. Non-runner machines can still manually run workers.
9. High-churn Community records are one file per entity.
10. Contact edit conflicts create conflict records, not silent overwrites.
11. Provider conflicted-copy files surface in Conflict Inbox.
12. Gmail can create drafts, but fan-list broadcast send requires approval.
13. Suppressed/unsubscribed contacts are blocked from marketing jobs.
14. Team Settings clearly shows runner, conflicts, storage mode, and sync health.
15. Git mode is labeled advanced and warns about media.
16. A workspace written by a newer app version opens read-only with an upgrade prompt.
17. New sessions in Team mode stay out of the shared folder unless explicitly shared.
18. Marketing jobs exclude `unknown`-consent contacts unless explicitly overridden per job.
19. A cross-machine concurrent edit under sync lag is detected after sync and produces a conflict record with both sides recoverable — never a silent loss.
20. Runner handover under sync lag produces no duplicate side effects (idempotency-key test).
21. A repeated CSV import creates zero duplicate contacts.
22. Erasing a contact removes all PII from the shared folder and undo caches, keeping only the suppression hash.

---

## 22. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Shared folder conflicts corrupt data | Lost fan/contact edits | entity files, revision checks, conflict inbox |
| Multiple machines run automations | duplicate sends/runs | runner-machine gate and job claims |
| Secrets accidentally sync | account compromise | keep credentials in `~/.craft-agent`, preflight scan |
| Absolute paths break on teammate machine | broken files/sources | relative path policy, path audit, overrides |
| Gmail used as newsletter engine | deliverability/compliance/account risk | Gmail drafts/small-send only, ESP abstraction |
| Fan PII shared too broadly | privacy issue | clear shared-folder trust warning, hosted mode later |
| Provider placeholder files break workers | workflow failures | file hydration checks before run |
| Git users commit huge media | repo bloat | Git LFS/hybrid warning and guard |
| Consumer sync latency causes confusion | stale UI | sync health/staleness labels |
| Drive/OneDrive silent last-writer-wins hides lost edits | silent data loss | per-machine oplog + clobber detection + undo cache (12.3) |
| Runner split-brain during handover | duplicate automation side effects | revision-acked PENDING handover (14.5) + idempotency keys |
| App version skew across teammates | schema corruption | formatVersion + minAppVersion read-only gate (7.1) |
| Sync-delivered writes storm local watchers | trigger storms, parse errors | debounce + provider-junk ignore list + parse retry (18.1) |
| Marketing to unknown-consent imports | spam complaints, legal exposure | consent gate defaults to opted-in only + import attestation (15.7) |
| Teammate opens workspace mid-migration | corrupted first impression | `.craft-migrating-*` sentinel + config-last copy + open guard (9.2) |

---

## 23. Decisions

Resolved in this revision:

1. **First Team Settings slice: Shared Folder only.** Git ships later, read-only status first.
2. **Sessions are private by default** with explicit "Share with team" (11.3).
4. **`records/` is a generic substrate in `packages/shared/src/records/`** from day one (4.7) — network, calendar, and vault manifests need the same contract, and the main process must be able to enforce it.
5. **Vault imports copy into the workspace, mandatory, in V1.** External links ship later behind Advanced (13.2 defines the shape so nothing blocks it).
6. **Provider detection is a loose label**; hard validation applies only to the workspace format.

Still open:

3. Which ESP first once we go beyond Gmail drafts? (Buttondown/Resend have the simplest API surfaces; Mailchimp has the most recognition among non-technical managers.)
7. When to ship "privacy mode" (ESP-ids-only records). The contact record already supports it — `email` is optional (15.2) — so this is product timing, not schema work.

---

## 24. Recommended Next Build Slice

Build in this order:

1. `Settings -> Team` read-only panel that shows current mode as Solo.
2. Workspace `formatVersion` + storage/team metadata + the version gate (7.1).
3. Machine identity, heartbeat with `observedTeamRevision`, and the `team.revision` counter.
4. The `records/` substrate in `packages/shared/src/records/` — revision-safe writes, oplog, undo cache, tombstones — plus the **fake-sync test harness** (build the harness with the substrate, not after it).
5. "Move to Shared Folder" wizard with preflight, config-last copy, `.craft-migrating-*` sentinel, receipt, and `movedTo` tombstone.
6. Runner gate for `SchedulerTick` with the PENDING handover protocol.
7. Migrate Community from context-doc arrays to `records/community` (helpers in shared, renderer via IPC).
8. Gmail draft-only email jobs with idempotency keys, the consent gate, and the cadence guard.

That gives the product a real team foundation before attempting advanced ESP, Git automation, or hosted multi-user.
