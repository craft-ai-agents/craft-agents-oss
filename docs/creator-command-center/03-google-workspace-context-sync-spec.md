---
status: draft
owner: agent
last_verified: 2026-06-30
source_of_truth: false
---

# Google Workspace Context Sync Spec

## Decision

Artist HQ owns the creator's global people and calendar context. Campaign workspaces link to those global records instead of copying them.

Google Workspace is an external sync and action layer:

- Calendar sync mirrors global Artist HQ events to Google Calendar.
- Gmail powers approved outreach, thread lookup, and drafting.
- Drive powers selected file/folder context.
- People/Contacts can enrich Artist Network records.
- Google MCP can be offered to agents after direct API sync is stable.

## Object Model

Global records live in Artist HQ workspace context:

```text
artist-calendar
artist-network
artist-profile
artist-spotify-snapshot
```

Campaign workspaces should reference global IDs:

```json
{
  "globalPersonId": "person_123",
  "workspaceId": "campaign_midnight_sun",
  "role": "PR contact",
  "notes": "Pitch acoustic story first"
}
```

```json
{
  "globalEventId": "event_456",
  "workspaceId": "campaign_midnight_sun",
  "relatedPersonIds": ["person_123"],
  "google": {
    "calendarId": "primary",
    "eventId": "google_event_id",
    "syncStatus": "synced"
  }
}
```

## Credential Storage

Use existing RunnerOS encrypted credential storage:

```text
~/.craft-agent/credentials.enc
```

Settings should expose normal-user fields under `Settings > Secrets > Workspace > Google Workspace`:

```text
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_WORKSPACE_PRIMARY_CALENDAR_ID
```

OAuth tokens must be stored as source/workspace credentials, not plain env secrets:

```text
source_oauth::{workspaceId}::{sourceId}
workspace_oauth::{workspaceId}
```

Stored token payload must include refresh data needed by Google:

```json
{
  "value": "access_token",
  "refreshToken": "refresh_token",
  "expiresAt": 1780000000000,
  "clientId": "google client id",
  "clientSecret": "google client secret",
  "email": "artist@gmail.com",
  "scopes": ["..."]
}
```

## OAuth Shape

Use Google Desktop OAuth with loopback redirect:

```text
http://localhost:<local-port>/callback
```

Request `access_type=offline` so sync jobs can refresh access without a fresh browser sign-in.

Official docs:

- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/identity/protocols/oauth2

## Scopes

Start narrow and add scopes only when the user activates a feature.

Calendar V1:

```text
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/userinfo.email
```

Gmail V1:

```text
https://www.googleapis.com/auth/gmail.compose
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/userinfo.email
```

Drive V1:

```text
https://www.googleapis.com/auth/drive.file
https://www.googleapis.com/auth/drive.metadata.readonly
https://www.googleapis.com/auth/userinfo.email
```

People V1:

```text
https://www.googleapis.com/auth/contacts.readonly
https://www.googleapis.com/auth/userinfo.email
```

Notes:

- Gmail scopes are high-friction and may be restricted. Avoid `gmail.modify` until there is a real user-facing need.
- Drive should default to `drive.file`, not full Drive.
- Calendar full access is unnecessary for V1 event sync.

Official scope docs:

- https://developers.google.com/workspace/calendar/api/auth
- https://developers.google.com/workspace/gmail/api/auth/scopes
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/people/api/rest/v1/people/get

## Sync Rules

Calendar:

```text
App event created -> mark local-change
User enables Google sync -> create/update Google event
Google event id saved -> mark synced
Google changes detected -> mark remote-change
Both sides changed -> mark conflict, require user review
```

People:

```text
Artist Network person created -> not-synced
User links Google contact -> save People resourceName
Google contact changes -> enrich, never overwrite notes blindly
Campaign notes stay local
```

Agents:

- Agents receive linked people/events as context.
- Agents do not get raw Gmail/Drive dumps by default.
- Gmail send/calendar write actions require approval.
- Google MCP is agent tooling, not the product sync source of truth.

Official Google MCP docs:

- https://docs.cloud.google.com/mcp/supported-products
- https://docs.cloud.google.com/mcp/manage-mcp-servers

## First Implementation Slices

1. Add global record fields for workspace links and Google sync IDs.
2. Add Settings > Workspace > Google Workspace credential fields.
3. Add tests proving old context parses and new link/sync fields round-trip.
4. Add UI affordances for linking people/events to a campaign workspace.
5. Add Calendar direct API sync.
6. Add Gmail draft/send with approval.
7. Add Drive folder/file picker.
8. Add Google MCP source/tooling for agents.
