# Team Mode Owner, Editor, and Runner Permissions Spec

Status: implemented in the Team Mode worktree as shared-folder guardrails, not cryptographic or server-backed auth.

## Goal

Keep Team Mode simple: one Owner controls the workspace and connected accounts, Editors can collaborate inside the shared workspace, and exactly one selected runner machine executes background automations.

This is not enterprise RBAC. It is the minimum permission model needed so a small creative team can safely use one shared hub.

## Product Model

### Owner

The Owner is the person who created or claimed the team workspace.

Owner can:

- change Team Mode settings
- grant or revoke collaborator access through the shared-folder provider
- choose the Automation Runner machine
- connect, rotate, or remove API keys and accounts
- approve sensitive sends or posts
- migrate storage
- disable Team Mode

Owner-only actions:

- runner assignment
- team storage changes
- secrets and connected account management
- shared-folder access management outside the app
- bulk email send approval
- destructive workspace actions

### Editor

Editors are collaborators who can work in the shared workspace.

Editor can:

- open the shared workspace
- chat with agents
- create and edit files
- create and edit records, briefs, docs, campaigns, and assets
- manually run safe local actions
- draft community/email/posting jobs for Owner approval

Editor cannot:

- change runner machine
- edit connected accounts or secrets
- change Team Mode storage/settings
- manage shared-folder access
- run background automations
- send bulk/community emails without Owner approval

### Automation Runner

Automation Runner is a machine assignment, not a person role.

The selected runner machine:

- owns background execution
- runs scheduler ticks
- handles webhook automation execution
- handles polling/file-watch/message triggers
- uses the Owner's local connected accounts and secrets
- records runner heartbeat and pulse state

Non-runner machines:

- can still open the workspace
- can still edit shared files and records according to role
- must skip background automations
- must never silently execute jobs that require connected accounts

## Why This Model

This matches the real small-team use case:

- one person usually owns the accounts and keys
- other people need to create, edit, and chat
- scheduled/integration work must happen from one trusted machine
- full roles/permissions would be slower and heavier than needed

## Data Model

Add a team membership record under shared team metadata. This drives in-app role checks and UI state. Because the metadata lives in the shared folder, it is a collaboration guardrail, not a hard security boundary against a teammate who can edit workspace files outside the app.

```json
{
  "version": 1,
  "members": [
    {
      "memberId": "member_owner",
      "displayName": "Owner",
      "role": "owner",
      "createdAt": "2026-07-02T00:00:00.000Z"
    },
    {
      "memberId": "member_editor",
      "displayName": "Editor",
      "role": "editor",
      "createdAt": "2026-07-02T00:00:00.000Z"
    }
  ]
}
```

Private machine identity should map to a member:

```json
{
  "version": 1,
  "workspaceId": "ws_123",
  "memberId": "member_owner",
  "machineId": "machine_abc",
  "displayName": "Michael's MacBook"
}
```

The existing `team.runnerMachineId` remains the runner source of truth.

Shared-folder access is the current invite/remove mechanism. If someone can open the shared folder, they can join the workspace as an Editor from the app. True app-level invites, removals, and tamper-proof membership require a future signed metadata or server-backed auth layer.

## Permission Checks

Every sensitive action should call one shared guard:

```ts
assertTeamPermission(workspaceRootPath, {
  action: 'team.runner.assign',
  machineId,
});
```

Initial actions:

- `team.settings.update`: owner
- `team.runner.assign`: owner
- `team.members.invite`: owner, reserved for future app-level invite flow
- `team.members.remove`: owner, reserved for future app-level removal flow
- `secrets.update`: owner
- `storage.migrate`: owner
- `records.write`: owner, editor
- `files.write`: owner, editor
- `agent.chat`: owner, editor
- `automation.background.run`: selected runner machine only
- `community.email.draft`: owner, editor
- `community.email.send`: owner approval plus runner machine execution

## UI

Team Settings should show:

- current user role: Owner or Editor
- current machine: Runner or Non-runner
- runner machine name and heartbeat
- Owner controls for runner assignment
- Current limitation: shared-folder provider controls invite/remove outside the app
- Editor read-only view of team settings

For Editors:

- disable restricted buttons
- show short reason text, such as `Only the Owner can change runner`
- keep creation/editing flows available

## Approval Flow

For sensitive jobs like bulk email:

1. Editor drafts the job.
2. Broadcast job status becomes `needs-owner-approval`.
3. Owner reviews and approves.
4. Runner machine executes the send.
5. Job records who drafted, approved, and executed it.

## Security Rules

- Secrets stay local to the Owner/runner machine.
- Shared folder must not contain raw tokens, OAuth refresh tokens, or credential caches.
- Editors should not receive secrets through shared records, logs, context docs, or generated summaries.
- Runner execution must fail closed if the current machine is not selected runner.
- Owner-only actions must fail closed if member identity is missing or unknown.
- Role checks are in-app enforcement only. They do not protect against direct edits to shared workspace files by someone with folder write access.

## Phase Plan

### Phase A: Permission Substrate

- Done: team members metadata.
- Done: private machine-to-member identity.
- Done: `assertTeamPermission`.
- Done: tests for owner/editor decisions.

### Phase B: Settings Enforcement

- Done: runner assignment, storage migration, Team Mode settings, workspace setting updates, and credential mutations are Owner-gated with workspace context.
- Done: Team Settings shows role and disables runner controls for Editors.
- Future: app-level invite/remove and tamper-resistant membership.

### Phase C: Editor Collaboration

- Done: Editors can write shared records and draft community jobs.
- Done: regression tests confirm Editors cannot change runner.

### Phase D: Owner Approval Jobs

- Done: Editor-created broadcast jobs default to `needs-owner-approval`.
- Remaining future send transport layer must enforce approval at execution time when real sending is added.

## Acceptance Criteria

- Done: Owner can assign runner.
- Done: Editor cannot assign runner.
- Done: Editor can create/edit normal shared records and draft community work.
- Done: non-runner machines skip background automations.
- Done: runner machine remains the only background execution path.
- Done: secrets and credential caches are kept out of the shared folder by migration guards.
- Done: Editor-created bulk/community email jobs require Owner approval status.
- Done: UI clearly shows role and runner state.
