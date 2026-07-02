# Team Mode Core Readiness

Status: core Team Mode foundation implemented; email transport and Git advanced mode are out of scope for this checkpoint.

## Supported Now

- Solo workspaces continue to work without team metadata.
- Shared-folder workspaces can store portable team metadata in `config.json` plus the `team/config.json` mirror.
- Each joined machine has a private identity under the local config directory and a shared heartbeat under `team/machines/`.
- Team Settings shows storage mode, runner state, owner/editor role, join state, sync health, conflict count, and machine heartbeat count.
- Existing workspaces can be moved into a shared folder with preflight checks, migration receipt, config-last copy, and moved-path tombstone.
- Team Mode refuses unsafe open states: in-progress migration folders, config-less workspace folders, active migration receipts, and moved tombstones.
- Shared records use one JSON file per entity with stale-baseline conflicts, clobber detection, tombstone deletes, automatic provider conflicted-copy scanning in Sync Health, and Conflict Inbox.
- Background automations are gated so only the active runner executes scheduler, file-watch, poll, webhook, and message triggers.
- Runner handoff has a pending state and activates after old-runner acknowledgement, stale old-runner heartbeat, or grace-window expiry.
- Missed scheduler ticks support `skip` and `run-once`; `run-once` emits a single catch-up tick after subscribers are attached.
- Non-runner webhook delivery returns/logs a skipped result instead of pretending the event ran.
- Owner/Editor permissions are enforced for runner assignment, team settings, storage migration, and credential mutations when workspace context is available.
- Editor-created community broadcast jobs default to `needs-owner-approval`.

## Not Supported Yet

- Hosted accounts, roles, permissions, or live collaborative editing.
- Provider API storage through Google Drive, Dropbox, iCloud, or OneDrive APIs.
- Git-backed Team Mode. Git remains the planned advanced mode.
- Real batch email sending. Gmail/ESP transports start in the later email phase.
- Real approval execution for batch email sending. Draft jobs can require Owner approval now; actual send transport starts in the later email phase.
- Automatic conflict resolution. Conflicts are surfaced and preserved for manual handling.

## Required Smoke Before Product Rollout

1. Create or move a workspace into a real shared folder.
2. Open the same workspace from a second machine/profile.
3. Confirm Team Settings on machine B shows `needs join`, then join.
4. Confirm machine A remains runner and machine B is a non-runner.
5. Fire a scheduler tick on both machines: A runs, B skips.
6. Switch runner to B and confirm Team Settings shows pending handoff until A observes the revision or the grace path is met.
7. Simulate stale A heartbeat and confirm B can take over.
8. Create a provider conflicted-copy file and confirm Sync Health surfaces it without pressing Scan files.
9. Move workspace old path should show moved tombstone behavior, not allow stale writes.
10. Confirm no `.env`, credential cache, or private session folders were copied into the shared workspace.
11. Confirm Editor role cannot assign runner or save connected-account secrets.

## Current Verification

- Fake-sync second-machine join preserves the existing runner and leaves B as non-runner.
- Sync Health surfaces open record conflicts and provider conflicted-copy files.
- Team migration tests cover preflight, rollback, in-progress open guard, and moved tombstones.
- Automation tests cover solo runner behavior, non-runner skips, runner pulse state, pending catch-up, skipped webhooks, and startup runner-active state.
