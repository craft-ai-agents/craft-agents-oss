# Project Spaces Spec

## Goal

Make the existing Sessions area organize work by project inside a workspace.

User-facing model:

```text
Workspace -> Project -> Session -> Outputs
```

Example:

```text
Marketing
  Sessions
    General
      Quick idea
      Random chat
    LTR OS
      Launch email
      Landing page copy
    RunnerOS Launch
      Demo script
```

The user should not need to understand labels. Projects feel like folders in the Sessions list, but they are backed by existing session labels.

## Core Decisions

- Do not add a new top-level sidebar section.
- Enhance the existing Sessions list into a collapsible project/session view.
- Use `General`, not `Inbox`, for sessions with no project.
- Use the existing label system as the first storage layer.
- A project can optionally link to a real local folder.
- Project labels organize work. Project folders give agents a filesystem place to work.
- Outputs stay in RunnerOS output storage for now, but inherit project association through the session.

## Existing Architecture To Reuse

RunnerOS already has:

- workspace-scoped labels at `labels/config.json`
- hierarchical labels
- typed labels, including default `project` with `valueType: "string"`
- session labels on metadata
- label filtering/search
- `#label` autocomplete in chat input
- `set_session_labels` agent tool
- label settings UI
- collapsible session groups

This feature should compose with that rather than inventing a separate folder database.

## Data Model

### Session Project

Phase 1 uses the existing typed label:

```text
project::<project-slug>
```

Examples:

```text
project::ltr-os
project::runneros-launch
project::client-a
```

`General` is not stored as a label. It is the absence of a `project::...` label.

### Project Registry

Phase 1 can derive project names from labels and session usage, but we should add a small workspace project registry before folder linking:

```json
{
  "version": 1,
  "projects": [
    {
      "id": "ltr-os",
      "name": "LTR OS",
      "label": "project::ltr-os",
      "folderPath": "/Users/michaelb.williams/CAS4/LTR OS",
      "createdAt": 1779750000000,
      "updatedAt": 1779750000000
    }
  ]
}
```

Recommended path:

```text
<workspace-root>/projects/config.json
```

Why not only labels:

- labels do not currently carry project folder metadata
- project order, archive state, and default folder need a home
- future project overview pages need a stable project id

Labels remain the session membership mechanism.

### Working Folder

A project may have an optional `folderPath`.

When a project has a folder:

- new sessions created while that project is active default to that folder
- spawned agents inherit it unless the user explicitly overrides the folder
- the chat folder icon shows the project folder as the default

When a project has no folder:

- sessions still group under the project
- agents use the workspace default or current session working folder
- outputs remain only in RunnerOS output storage

## UX

### Left Sidebar

Keep top-level nav clean:

```text
Sessions
  General
  LTR OS
  RunnerOS Launch
Agents
Workflows
Automations
```

Inside `Sessions`, render projects as collapsible groups.

Each group header:

- project name
- session count
- collapse chevron
- context menu

Context menu:

- New session in project
- Rename project
- Link/change folder
- Move project order
- Archive project
- Delete project label/mapping only if no sessions use it, or offer "move sessions to General"

### Active Project

Clicking a project group makes it the active project for new sessions.

Active project should be visible in:

- Sessions group header
- chat header or compact session metadata row
- composer badge near the folder/label controls

Keep it one-click simple:

- clicking a project filters/focuses that group
- `+` in the Sessions header creates a session under the active project
- `+ Project` lives in the Sessions header menu, not as a separate nav item

### General

`General` is always present.

Rules:

- sessions without `project::...` appear in `General`
- new sessions created with no active project go to `General`
- `General` cannot be renamed or deleted
- `General` can be collapsed

### Moving Sessions

Session context menu gets:

- Move to Project
- Remove from Project

Behavior:

- moving replaces the current `project::...` label
- other labels stay untouched
- removing project label moves the session to `General`

### Chat Folder Icon Relationship

The folder icon is filesystem context, not organization by itself.

User-facing rule:

```text
Project = where this work belongs.
Folder = files the agent can use.
```

If the active project has a linked folder:

- folder icon defaults to that path
- changing the folder for the session should offer:
  - "Use only for this session"
  - "Update project folder"

If a user opens a folder while in `General`, offer:

- "Use for this session"
- "Create project from folder"

## Outputs And Artifacts

Phase 1:

- outputs continue living in existing RunnerOS output storage
- output manifests already know origin session
- project association is derived from the session's project label
- project view can filter outputs by sessions in that project

Phase 2:

- project overview page shows outputs/artifacts for that project
- optional "Show in project folder" action exports/copies selected artifacts

Phase 3:

- optional project setting:

```text
Save project artifacts into linked folder
```

Do not force this early. Some projects are conceptual and should not need a filesystem folder.

## Agent Awareness

Agents should receive a compact project context at session start:

```text
Active project: LTR OS
Project id: ltr-os
Project folder: /Users/.../LTR OS
Session project label: project::ltr-os
```

Rules:

- spawned agents inherit the session project label
- spawned agents inherit project folder unless explicitly overridden
- agents may use `set_session_labels` to move or set project, but should not spam labels
- if an agent creates a new session/task under the current project, pass the project label into the child session

## Search And Filters

Existing label search should keep working.

Add project-specific affordances:

- sidebar project group filters sessions
- global search result rows show project badge
- search inside active project defaults to active project scope, with "search all sessions" escape

## Migration

No migration required.

Existing sessions:

- if they already have `project::...`, show under that project
- otherwise show under `General`

Existing labels:

- keep the default `project` typed label
- if workspaces lack the `project` label, add it non-destructively

## Implementation Plan

### Phase 1 - Project Grouping In Sessions

Goal: make Sessions list feel project-organized without touching agents or outputs.

Build:

- helper to parse `project::...` from session labels
- group `SessionList` by project when in normal Sessions view
- always include `General`
- collapse state per project group
- show project badge on rows
- preserve date/status grouping for search or filtered views, unless product says otherwise

Acceptance:

- sessions without project labels appear in `General`
- sessions with `project::ltr-os` appear under `LTR OS`
- groups collapse independently
- existing search/filter behavior does not regress

### Phase 2 - Project CRUD And Move Session

Goal: user can create projects and move sessions without editing labels manually.

Build:

- `projects/config.json` shared storage
- create/rename/archive project RPC
- `+ Project` from Sessions header menu
- session context menu "Move to Project"
- replacing project labels while preserving other labels

Acceptance:

- creating a project creates registry entry and usable project label
- moving a session changes its project group immediately
- deleting/archive behavior does not orphan sessions silently

### Phase 3 - Active Project And New Session Inheritance

Goal: creating work inside a project keeps that project context.

Build:

- active project state per workspace
- new session inherits `project::...`
- chat header/composer shows active project
- `General` session creation clears project label
- spawned agent sessions inherit parent project label

Acceptance:

- user clicks `LTR OS`, starts a chat, and the chat lands under `LTR OS`
- spawned agent session from that chat also lands under `LTR OS`
- switching active project changes future sessions, not old sessions

### Phase 4 - Linked Project Folder

Goal: connect project organization to the folder agents work in.

Build:

- project `folderPath` field
- link/change folder from project menu
- new session working directory defaults to project folder
- folder icon offer: session-only vs update project folder
- agent prompt/session options include project folder context

Acceptance:

- project with folder starts sessions in that folder
- user can override per session without changing project
- user can update project folder from session folder picker

### Phase 5 - Project Outputs

Goal: outputs/artifacts become easy to find by project.

Build:

- derive output project from origin session
- project view or filtered output list
- optional export/show-in-project-folder action

Acceptance:

- output created in `LTR OS` session appears in `LTR OS` project output list
- output storage remains compatible with current manifests

## Risks

- Labels become too exposed if UI leaks `project::slug`.
  - Mitigation: call them Projects in UI; hide raw label entry.

- Project registry and labels can drift.
  - Mitigation: derive missing project labels from registry and show repair state.

- Session list gets too busy.
  - Mitigation: collapsible groups, counts only, no heavy cards.

- Folder linking confuses users.
  - Mitigation: always phrase as "project folder" and keep session override explicit.

## Open Questions

- Should projects support multiple folders later?
- Should a session ever belong to multiple projects, or exactly one project plus other normal labels?
- Should project order be manual drag order or recent-activity order?
- Should archived projects hide by default but keep sessions searchable?

## Recommended Defaults

- exactly one project per session
- `General` for no project
- manual project order
- archived projects hidden by default
- project folder optional
- outputs stored in RunnerOS first, export/mirror later

