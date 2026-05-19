# Context — rpi

## Glossary

### Session Files
Files produced inside a specific Claude session's output folder (`sessionFolderPath`). Loaded eagerly in one IPC call (`sessions.GET_FILES`) and returned as a full recursive `SessionFile[]` tree. Displayed in the **Files** tab of the right sidebar via `SessionFilesSection`.

### Workspace Files
Files under the active session's **CWD Root**, loaded lazily — one `readdir` per folder, fetched on expand — via the `workspace.GET_FILES(workspaceId, dirPath?, rootPath?)` IPC channel. Displayed in the **Workspace** tab of the right sidebar via `WorkspaceFilesSection`.

Distinct from Session Files: unbounded size, navigational purpose, lazy-loaded, watcher re-fetches currently-expanded folders on change.

Note: `workspace.rootPath` is an internal metadata directory (`labels/`, `sessions/`, `skills/` etc.) — not a code project. The code project lives at `workingDirectory`, which is always a separate path on disk.

### Workspace File Browser
The `WorkspaceFilesSection` panel rendered in the right sidebar's `workspace` tab. Provides a lazy-loaded, per-folder tree view rooted at the active session's **CWD Root**. Shows an empty state ("No working directory set") when no valid CWD Root exists. Shares icon/thumbnail helpers with `SessionFilesSection` but manages its own loading-state machine for per-node fetching.

### CWD Root
The effective root directory shown in the Workspace File Browser. Resolved from the focused session's `workingDirectory`: returned as-is if it is a real path (not `undefined`, `'none'`, or `'user_default'`); `undefined` otherwise. No workspace-containment check — `workingDirectory` is always outside `workspace.rootPath`.

When defined, passed as the `rootPath` argument to `workspace.GET_FILES` and `workspace.WATCH_FILES`, replacing `workspace.rootPath` as both the security boundary for `dirPath` resolution and the filesystem watch target. The "View" button in the section header opens the CWD Root in the system file manager.

### All Sessions Nav Item
The `nav:allSessions` sidebar item is a chevron-toggle expandable row. When expanded, the full **Session List** (with search header, date-grouped rows, hover menus, and multi-select) embeds inline below the row — no separate drill-down panel, no Back button. Expanded by default on first launch; state is persisted per workspace.

The embedded list is visually flush with the sidebar — no distinct container background or rounded border. A height cap bounds it so a large session list cannot push other nav items off screen.

### Sidebar Width
The left sidebar is permanently at **session-list width** (~300 px). There is no narrow icon-strip mode — nav items always show icons and labels. The navigator slot (Sources, Skills, Automations, Settings) opens additively to the right of the sidebar when a secondary nav item is selected.

### Archived View
The dedicated view for archived sessions, accessed via the top-level **Archived** sidebar item. Renders an **Archived Sessions Panel** in the navigator slot alongside the **Main Content Panel**.

Clicking a session in the panel navigates the main content panel to that session while keeping `navigator === 'archived'`. The session is shown in **read-only mode** — the chat input is hidden. The **Right Sidebar** and **Editor Panel** are never shown in the Archived View. The session-already-open-in-another-panel guard is bypassed; clicking always navigates in the current panel to preserve the archived layout.

### Skill Import Modal
A tabbed dialog opened by the `+` button in the Skills panel header (replacing the previous direct `EditPopover` call). Provides four tabs for adding workspace-tier skills without an AI conversation: **Remote** (git-aware URL/shorthand resolver), **Upload** (local zip file), **Create** (manual form), and **AI Assist** (existing EditPopover path). All paths write to `{workspace}/skills/{slug}/` (workspace tier only).

### Skill Picker
The multi-selection UI shown inside the Skill Import Modal when a resolved remote repo or uploaded zip contains more than one skill. Lists all discovered skills (any directory containing `SKILL.md`) with checkboxes. Remote repo discovery scans up to 3 directory levels deep so both `skills/<skill>/SKILL.md` and category-grouped `skills/<category>/<skill>/SKILL.md` layouts are supported; zip upload discovery remains capped at 2 levels. For multi-skill installs, shows inline install progress per skill then closes to the list; for single installs, closes and navigates to the new skill's detail page.

### Skill Slug
The directory name of a skill on disk (e.g. `code-reviewer`). For manually created skills, auto-derived from the name via kebab-case conversion and hidden from the creation form. Displayed on `SkillInfoPage` after creation. Conflict resolution (duplicate slug) prompts the user to overwrite.

### Local Skill
A skill installed into local skill storage and available for use in sessions.

Avoid: Original skill.

A Local Skill installed from the Skill Marketplace remembers its marketplace origin and version so users can manually update it. Marketplace-installed Local Skills do not auto-update.

Marketplace-installed Local Skills are implicitly pinned to their installed version until the user manually updates.

Marketplace installs use the same Local Skill slug conflict flow as Upload and Remote imports: users can overwrite or skip.

Marketplace install metadata is stored beside the installed bundle so the published `SKILL.md` content remains unchanged.

Marketplace-installed Local Skills can be edited locally; local edits keep marketplace origin metadata and mark the Local Skill as modified.

Updating a modified marketplace-installed Local Skill warns the user that local changes will be overwritten.

### Skill Marketplace
A product-provided catalog where users can publish, browse, fetch, and install shared skills into local skill storage.

Avoid: Skill Market, Skill Registry.

### Marketplace Skill
A skill listed by the Skill Marketplace that becomes usable only after being installed into local skill storage.

Avoid: Mounted skill, remote runtime skill.

Marketplace Skills have a stable Marketplace ID separate from their Skill Slug.

Marketplace Skill names can change, but marketplace slugs stay stable after publication.

Marketplace slugs are globally unique; only the owner of an existing marketplace slug can publish new versions under it.

Marketplace Skills are public to all users after publication; v1 does not support unlisted, private, or team-scoped visibility.

Marketplace Skill detail includes an in-product report action for post-publication abuse handling.

Users can publish an existing Local Skill to the Skill Marketplace or add a Marketplace Skill directly using the same creation/import paths as Local Skills. Direct Marketplace adds publish the skill only; they do not install it into Local Skills.

The Skill Marketplace does not support server-side drafts in v1; publishing creates an immutable version immediately after validation.

The Marketplace action for adding a new public skill is **Publish Skill**.

For Local Skills, **Publish Skill** appears on the Local Skill detail page and in the Local Skill row context menu.

After publishing from a Local Skill succeeds, the app stays on Local Skill detail and shows Marketplace link/status.

Publishing from a Local Skill links that Local Skill to the resulting Marketplace Skill version through marketplace metadata.

Owner-linked Local Skills show unpublished changes after local edits and can publish those edits as a new Marketplace Skill version.

Owner-linked Local Skills use “sync latest version” wording when the Marketplace has a newer version than the local copy.

Owner-linked Local Skills with unpublished changes cannot sync latest until the local changes are published or discarded.

Direct **Publish Skill** supports Create, Upload, and Remote paths; AI Assist remains a Local Skill-first path.

Local Skills created through AI Assist can be published later through the Local Skill publish flow.

Direct Marketplace **Publish Skill** starts from the Marketplace page header and empty state.

Marketplace **Publish Skill** uses a separate dialog from the Skill Import Modal, while sharing Create, Upload, and Remote internals where possible.

After direct Marketplace publish succeeds, the app navigates to the new Marketplace Skill detail page.

Each Marketplace Skill is owned by the publishing user; only the owner can update or delete it.

Publishing local edits to someone else's marketplace-installed Local Skill creates a new Marketplace Skill; owners can publish local edits as a new version of their own Marketplace Skill.

Marketplace v1 has no explicit Fork action; install, edit, and publish covers fork-like workflows.

Derived Marketplace publishes show “based on” attribution when marketplace origin metadata is available.

Marketplace v1 does not require a per-skill license field.

Marketplace Skill versions use SemVer chosen by the owner.

Published Marketplace Skill versions are immutable; owners publish a new version for any change.

Each Marketplace Skill version stores a full skill directory bundle, including `SKILL.md` and any supporting files.

Marketplace Skill versions can include optional release notes.

Marketplace bundles use zip archives.

Publishing to the Skill Marketplace requires stricter validation than Local Skill creation because Marketplace Skills are shared publicly.

Owners can unpublish Marketplace Skills from discovery, but published versions are not hard-deleted.

If a Marketplace Skill is unpublished after install, the Local Skill remains installed but no longer receives updates.

Admin-unpublished Marketplace Skills remain installed locally but are marked safety-blocked and shown with a stronger warning.

Marketplace browsing is anonymous; publishing and installing require an authenticated user.

The Skill Marketplace records which authenticated user installed which Marketplace Skill version.

Marketplace browsing supports search plus category and tag filters.

The Skill Marketplace is backed by a separate hosted service; the app is a client of that service.

Marketplace outages only affect Marketplace surfaces; Local Skills remain available.

Marketplace installs require the hosted service in v1; offline Marketplace install is not supported.

Users see one product Marketplace; development and internal builds may switch Marketplace service environments for testing.

Marketplace categories are product-defined; Marketplace tags are publisher-defined.

Marketplace Skills publish immediately after validation; abuse is handled after publication through reporting and admin unpublish.

Marketplace browse and search return metadata only; bundle content is fetched through install or download.

Marketplace Skill listings include Marketplace ID, marketplace slug, display name, description, owner identity, latest SemVer version, category, tags, timestamps, install count, icon metadata, and publication state.

Marketplace list cards show icon, name, short description, owner display name, category/tags, latest version, install count, and installed/update/safety state when relevant.

Marketplace Skill detail previews the published `SKILL.md` content before install.

Marketplace Skill detail shows version history, release notes, required sources, install/update controls, report action, and owner actions when applicable. v1 does not show the bundle file list.

Marketplace install/update states include Install, Installing, Installed, Update available, Modified locally, Unavailable, and Safety blocked.

Safety blocked prevents Marketplace install/update distribution while preserving any existing Local Skill files.

Unavailable prevents Marketplace install/update distribution while preserving any existing Local Skill files.

Marketplace v1 surfaces a skill's existing required sources but does not support skill-to-skill dependencies.

### Skills Navigation
Two flat top-level sidebar items for skill workflows, at the same level as Settings:

- **技能** — navigates to Local Skills.
- **市场** — navigates to the Skill Marketplace.

Neither item is nested under a parent group. The previous "Local Skills" sub-item and the expandable "Skills" group header are removed.

Avoid: Skills Submenu, nesting 市场 under 技能.

### Editor Panel
A resizable panel (`EditorDetailPanel`) that renders to the right of the active content panel(s), showing file contents, git diffs, and git-commit details in a tabbed interface. Tabs are opened automatically when session files change during processing.

Visibility rule: only rendered when a **session is active** (same gate as the Right Sidebar). Within that context, it shows when `isEditorPanelOpen && hasOpenTabs`. Opening a new tab auto-forces `isEditorPanelOpen = true` (overrides a manual collapse). Open state is persisted per workspace via the `editorPanelVisible` storage key.

Toggle: a `SquareCode` icon button in the TopBar, positioned to the left of the Right Sidebar toggle, conditionally shown under the same `isRightSidebarContextuallyAvailable` gate.

### Messaging Gateway
The `@craft-agent/messaging-gateway` package: the `PlatformAdapter` interface, router, renderer, and binding store. Routes inbound messages from an external messaging channel to the correct session, and renders agent output back. The three built-in adapters (Telegram, WhatsApp, Lark) have been removed; the gateway infrastructure is preserved for a future custom channel.

Avoid: messaging stack, messaging backend.

### Platform Adapter
A concrete plug-in that implements `PlatformAdapter` for a specific messaging service or protocol. Wires the service's inbound/outbound protocol to the Messaging Gateway's routing layer. `PlatformType` is a plain `string` owned by each adapter — the gateway is agnostic to which platform it is.

Avoid: messaging provider, messaging integration.

### Channel Binding
A persisted mapping between an external messaging channel (`platform` + `channelId`) and a session. Multiple bindings can exist per workspace. Controls how agent output is rendered back to the channel (`responseMode`) and who is allowed to send messages to the bound session.

Avoid: session binding, channel link.

### SSO Session
An enterprise identity session established via the OIDC login flow. Checked on every app launch before any other screen. Required to use the app; independent of Claude credential setup (which follows after). Persisted across launches until the session token is cleared (logout) or the refresh mechanism fails.

Avoid: SSO token, login session.

### Session Token (`token`)
The long-lived credential returned by `/api/mdp/auth/sso-login` and `/api/mdp/auth/refresh-token`. Sent as the `Authorization` header on all MDP API calls. Stored encrypted in the credential manager. The presence of this token determines whether the user has an SSO Session.

Avoid: access token (that's a separate field), auth token.

### Identity Token (`idToken`)
A short-lived token returned alongside the Session Token. Expires per `expiresIn` (seconds). When expired, the app silently calls `/api/mdp/auth/refresh-token` using the Session Token to obtain a new Identity Token. If refresh fails, the app shows the Login Page.

Avoid: JWT, id token.

### SSO Login Flow
The browser-based OIDC authorization code flow used to establish an SSO Session. The OIDC provider only accepts `http/https` redirect URIs, so the app routes through the shared OAuth relay instead of using the `mdp://` scheme directly as `redirect_uri`.

1. App generates a random CSRF nonce and stores it in memory.
2. App opens `MDP_AUTH_URL` in the system browser with `client_id`, `redirect_uri=MDP_RELAY_URL`, `state=<relay-envelope encoding returnTo=mdp://sso-callback and the nonce>`, `response_type=code`. `MDP_RELAY_URL` points to the deployment's own self-hosted relay instance.
3. OIDC provider redirects to `{MDP_RELAY_URL}?code=...&state=...`.
4. Relay decodes the state envelope and redirects to `mdp://sso-callback?code=...&state=<nonce>`.
5. OS routes `mdp://sso-callback` back to the Electron app.
6. Electron deep link handler validates the `state` nonce against the stored value, then exchanges the `code` via POST to `MDP_API_URL/api/mdp/auth/sso-login`.
7. Response fields: `token`, `employeeId`, `ystId`, `department`, `userName`, `expiresIn`, `accessToken`, `idToken`.

### Login Page
The screen shown when no valid SSO Session exists. Displayed as a new `sso-login` app state, inserted before `onboarding` in the state machine (`loading → sso-login → onboarding → workspace-picker → ready`). Contains a single "Login" button that starts the SSO Login Flow.

### SSO Bypass Mode
A development-only mode activated by setting `CRAFT_DISABLE_SSO=1` when running an unpackaged (non-production) build. When active, the app skips the SSO Login Flow entirely and injects a mock SSO Session with placeholder identity values, then proceeds through the normal state machine (`onboarding → workspace-picker → ready`). The flag is silently ignored in packaged production builds (`app.isPackaged === true`).

Avoid: SSO skip, auth bypass, dev mode login.

### MDP Deep Link Protocol
The custom URL scheme `mdp://` registered by the Electron app for OS-level deep linking. Replaces the former `craftagents://` scheme entirely. Used for all deep links including the SSO callback (`mdp://sso-callback`), session navigation, and actions.

Avoid: craftagents protocol, custom protocol.

### Environment Connection
A virtual LLM connection auto-synthesized at startup from environment variables. Not persisted to `config.json`; re-derived on every launch. Appears pinned at the top of Settings → AI with a read-only "Environment" badge — no Edit, Delete, or Rename actions. Always set as the default connection when present.

Required env var: `LLM_BASE_URL` (OpenAI Chat Completions–compatible endpoint). Optional: `LLM_MODEL` (default model name). Requires an active SSO Session; the **Session Token** (`sso.token`) is injected as the bare `Authorization` header on every request (no `Bearer` prefix). A `501` response from the backend signals an expired token and triggers a redirect to the Login Page.

The underlying connection is `providerType: 'pi_compat'`, `authType: 'none'`, `piAuthProvider: 'openai'`. Token injection happens via the network interceptor inside the Pi subprocess, driven by the `CRAFT_LLM_SSO_TOKEN` and `CRAFT_LLM_SSO_BASE_URL` env vars set at subprocess spawn time.

Avoid: env provider, default provider, built-in connection.

### Custom Provider Connection
A user-configured LLM connection added through Settings → AI → Add Connection. The only user-editable connection type after the removal of OAuth-based flows. Created via a single-step form: provider preset dropdown (Anthropic, OpenAI, Groq, Bedrock, etc.) + API key field + optional base URL. Backed by `providerType: 'anthropic'` or `providerType: 'pi'` depending on the selected preset.

Avoid: API key connection, manual connection.
