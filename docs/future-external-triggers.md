# Future External Triggers

A backlog of ideas for new automation event types — things that could fire a Craft automation from *outside* the app. Use this as both a roadmap and a brainstorm pool.

## Already shipped

- `WebhookReceive` — external HTTP request
- `FileWatch` — file added / changed / removed
- `PollUrl` — polled HTTP endpoint's response changes
- `MessageReceive` — inbound chat message (Telegram, WhatsApp)

## How to read this list

Each candidate has:

- **What** — one sentence describing the trigger
- **Why** — what it unlocks for users
- **Sketch** — high-level implementation note so a future contributor can act cold
- **Complexity** — S (≤1 day), M (~few days), L (~1-2 weeks), XL (multi-week)
- **Reuses** — which existing infrastructure it can lean on

Triggers are organized by category, not priority. Pick by user value × effort.

---

## Inbound push (something hits Craft)

### Email (IMAP / unique address)
- **What:** Fires when a new email arrives in a watched mailbox or at a unique `inbox+slug@yourdomain` address.
- **Why:** Automatic email triage, "forward email to agent" workflows, customer support inbox automation. Replaces the need for half of "if-this-then-that" services.
- **Sketch:** Use `imapflow` for IMAP IDLE (real-time push); fall back to polling for servers without IDLE. Per-matcher `imapHost`/`imapUser`/`imapFolder`/`imapPasswordEnv`. Payload exposes `from`, `to`, `subject`, `bodyText`, `bodyHtml`, `attachmentCount`, `messageId`, `headers`. Strong overlap with the existing `MessageReceive` shape — could share a `MessageHandler` interface eventually. Optional: also accept inbound SMTP via a tiny in-process SMTP listener for paranoid users who don't want to give Craft IMAP creds.
- **Complexity:** M (IMAP) → L (with SMTP and HTML parsing)
- **Reuses:** Per-matcher service pattern from `PollService`; payload-based env-var explosion already done.

### Slash-command / app-mention via Slack/Discord/Teams
- **What:** Fires when a user types `/craft <slug> ...` in a Slack channel (or @-mentions a Craft bot in Discord/Teams).
- **Why:** Make Craft accessible from existing chat tools without leaving them. "Run my agent on the link I just pasted in #design."
- **Sketch:** Two paths: (a) treat Slack/Discord as additional `messaging-gateway` adapters (alongside Telegram/WhatsApp) — `MessageReceive` already covers it; (b) lean into platform-native slash-commands by exposing Craft as a Slack App with an OAuth handshake. Path (a) gives parity quickly; path (b) gives the polished "/craft" UX. Most teams want (b).
- **Complexity:** M (adapter approach) → L (full Slack/Discord OAuth app)
- **Reuses:** `messaging-gateway` (extend with new adapters) → `MessageReceive`.

### MCP inbound — Craft as a Model Context Protocol server
- **What:** Other agents (Claude Code, Cursor, Cline, etc.) call Craft via MCP to fire an automation.
- **Why:** Lets Craft be a tool in someone else's agent toolbox. Powerful "agent calls agent" composition.
- **Sketch:** Add an `MCPInbound` event type. Stand up an MCP server (stdio + HTTP-streaming transports) that exposes one tool per matching automation: `craft.fire.<slug>`. The matcher's `slug` becomes the MCP tool name; the matcher's `mcpInputSchema` (JSON Schema) defines the tool's input. The MCP tool call payload becomes `$CRAFT_INPUT`. Reuse the existing trigger HTTP server — MCP-streaming-HTTP can mount on `/mcp/v1/*`.
- **Complexity:** L
- **Reuses:** Trigger HTTP server (just a different route), automation matcher pattern.

### iOS/macOS Shortcuts
- **What:** A "Craft" Shortcuts action that fires an automation. Works from share-sheet, "Hey Siri", widgets, automation triggers (location, time, NFC tag).
- **Why:** Killer mobile/desktop UX. "Tap NFC sticker on desk → log a thought to Craft" or "Share article from Safari → triage."
- **Sketch:** macOS: bundle a Shortcuts action via Apple's `.appex` extension that POSTs to the local trigger server (loopback-only fine since the action runs on the same machine). iOS: same pattern but the URL needs to be `https://` or use the `craft-agent://` URL scheme (need to register one). Could also be a thin desktop URL handler: `craft-agent://trigger/<slug>?body=...` → posts to the trigger server.
- **Complexity:** M (URL scheme + Shortcuts action) → L (full Apple integration with iCloud sync).
- **Reuses:** `WebhookReceive` (Shortcuts action just fires a webhook).

### Browser extension / bookmarklet
- **What:** Right-click → "Send to Craft" from any page. Triggers an automation with the URL, page selection, page title.
- **Why:** Brain-to-Craft pipeline for research, reading, design references.
- **Sketch:** Single-file Chrome/Firefox extension that POSTs to the local trigger server. Same payload shape as WebhookReceive. Easier MVP: a bookmarklet that does the POST without the install. Hardest part is detecting the trigger server's port (use a discovery endpoint at `http://127.0.0.1:9101/v1/health` and try a small port range as fallback).
- **Complexity:** S (bookmarklet) → M (proper extension with options page).
- **Reuses:** `WebhookReceive`.

### Global hotkey / menubar quick-trigger
- **What:** ⌥⌘C (configurable) opens a menubar quick-input box; Enter fires an automation.
- **Why:** "Inbox zero" interface. Ten keystrokes to capture-and-route a thought.
- **Sketch:** Electron has `globalShortcut` API. Show a small command-palette window listing available WebhookReceive automations (pulled from `automations.json`). On submit, fire the automation directly via the in-process automation-system (no HTTP roundtrip).
- **Complexity:** S
- **Reuses:** `WebhookReceive` matcher discovery; AutomationSystem.fireWebhookReceive.

### CLI fire
- **What:** `craft-agent automation trigger fire <slug> --body '{...}'` from any terminal.
- **Why:** Cron jobs, shell scripts, tmux hotkeys.
- **Sketch:** Add a CLI command that POSTs to the trigger server. Two-line implementation. Bonus: a `--from-stdin` flag.
- **Complexity:** S
- **Reuses:** `WebhookReceive`.

### Voice trigger
- **What:** "Hey Craft, triage my inbox" via macOS speech recognition or Whisper.
- **Why:** Hands-free agent invocation; cross-room workflows.
- **Sketch:** Always-on local Whisper instance, wake-word detection, confidence threshold, then POST to trigger server. Big battery / privacy tradeoffs.
- **Complexity:** XL
- **Reuses:** `WebhookReceive`.

---

## Pull (Craft watches something)

### Calendar (CalDAV / Google / iCloud)
- **What:** Fires X minutes before a calendar event matching a pattern.
- **Why:** "5 minutes before any 1:1, prepare a brief from our recent shared notes." "10 min before next deep-work block, kill distracting tabs."
- **Sketch:** Per-matcher `calendarUrl` (CalDAV) or `calendarOAuthRef` (Google). Poll every 1-5 minutes; on each tick, scan upcoming events; emit `CalendarEvent` events with lead-time matchers (`leadTimeMin: 5`). Payload exposes `eventTitle`, `attendees`, `location`, `eventNotes`, `startsIn`.
- **Complexity:** M (CalDAV) → L (with Google OAuth + recurring-event handling).
- **Reuses:** Scheduler infrastructure from `SchedulerTick`.

### Git (commits, branches, PRs in a local repo)
- **What:** Fires when a watched Git repo has new commits / a new branch / a PR opened.
- **Why:** Self-PR-summary, auto-changelog, branch-name-driven workflows.
- **Sketch:** For pure-local repos: `FileWatch` on `.git/refs/heads` already detects new commits — `GitWatch` could be a thin specialization that runs `git log` to get commit details. For remote repos: poll `git ls-remote` or use the GitHub/GitLab API. Payload includes commit hashes, authors, messages, changed files.
- **Complexity:** S (local FileWatch wrapper) → M (remote polling).
- **Reuses:** `FileWatch` (local) or `PollUrl` (remote).

### Database change (Postgres LISTEN/NOTIFY, Mongo change streams, MySQL binlog)
- **What:** Fires when a row is inserted/updated/deleted matching a query.
- **Why:** Production-grade automation hooks: "any new high-value lead in Salesforce DB triggers an outreach session."
- **Sketch:** Postgres is easiest — use `pg` driver's `LISTEN/NOTIFY`; per-matcher `pgConnectionEnv`, `pgChannel`. Mongo: change streams require replica sets but are first-class. MySQL: binlog parsing is heavy; skip unless requested.
- **Complexity:** M (Postgres) → L (multi-DB).
- **Reuses:** Per-matcher service pattern from `PollService`.

### Cloud storage (Drive / Dropbox / OneDrive folder)
- **What:** Fires when a file appears in / changes in a watched cloud folder.
- **Why:** "Drop receipt PDF in Drive folder → fire scanner." Generalizes the existing `FileWatch` pattern to cloud storage.
- **Sketch:** Two approaches: (a) sync to local via official client, then `FileWatch` already covers it (no new code); (b) use Drive/Dropbox push notifications APIs for true real-time. Path (a) is free; path (b) requires OAuth flow.
- **Complexity:** Free (with sync client) → L (native push integration).
- **Reuses:** `FileWatch` for path (a).

### RSS / Atom feed
- **What:** Fires when a feed publishes a new entry matching a filter.
- **Why:** News watch, vulnerability disclosures, podcast-published, blog-published.
- **Sketch:** `PollUrl` with `pollFingerprint: 'body'` already partially covers it, but a dedicated `RssWatch` event with per-entry firing (one event per new item, not per feed change) would be more useful. Per-matcher `feedUrl`, `feedFilter` (regex on title/content). Diff against last-seen GUID set persisted to `~/.craft-agent/workspaces/<id>/rss-state.json`.
- **Complexity:** S
- **Reuses:** `PollService` (extend), per-matcher state persistence pattern.

### Cron-style "scheduled API call + diff"
- **What:** Run a JS expression on a polled API response and fire when the *result* of that expression changes (not the whole body).
- **Why:** "Fire when GitHub stars > 1000," "fire when crypto price drops 5%," etc.
- **Sketch:** Extend `PollUrl` with optional `pollExtract: string` (jq path) and optional `pollChangePredicate: string` (JS expression evaluated against current vs. previous extracted value). For safety, the expression runs in a `vm` sandbox.
- **Complexity:** M (expression sandboxing is the tricky part).
- **Reuses:** `PollService`.

### Stock / crypto price alerts
- **What:** Fires when a market price crosses a threshold.
- **Why:** Trading-adjacent workflows; portfolio rebalancing prompts.
- **Sketch:** Specialization of "API + diff" — preset providers (CoinGecko, Yahoo Finance) with built-in API knowledge so users just specify symbol + threshold.
- **Complexity:** S (single provider) → M (multi-provider).
- **Reuses:** `PollUrl` (with extraction).

### MQTT / IoT
- **What:** Subscribe to MQTT topics; fire on incoming messages.
- **Why:** Home automation integration, sensor-driven workflows ("when CO2 > 1000 ppm, suggest a break").
- **Sketch:** Use `mqtt` client. Per-matcher `mqttBroker`, `mqttTopic`, `mqttUsernameEnv`. Payload exposes topic, message body, QoS.
- **Complexity:** M
- **Reuses:** Per-matcher service pattern from `PollService`.

### App Store / Play Store reviews
- **What:** Fires when a new review is posted for a tracked app.
- **Why:** Indie devs want immediate visibility; auto-draft response prompts.
- **Sketch:** Specialization of `PollUrl` with App Store Connect / Play Console APIs preconfigured.
- **Complexity:** M
- **Reuses:** `PollUrl`.

---

## OS / device

### macOS clipboard change
- **What:** Fires when the clipboard changes to text matching a regex.
- **Why:** "Copied a URL? Auto-summarize it." "Copied an email address? Lookup CRM."
- **Sketch:** Poll `electron.clipboard` every ~500ms (or use a native module for change-notifications). Filter by content type + regex. **Privacy-sensitive** — must be opt-in per-workspace and ideally with explicit per-pattern consent.
- **Complexity:** S (polling) → M (native change detection).
- **Reuses:** AutomationSystem.

### macOS focus mode / Do Not Disturb change
- **What:** Fires when system focus mode changes.
- **Why:** "When focus mode = Deep Work, kill social-media tabs and queue agent backlog work."
- **Sketch:** macOS exposes focus state via `nstatus` notifications. Native module wrapper required.
- **Complexity:** M
- **Reuses:** AutomationSystem.

### Bluetooth device near / far
- **What:** Fires when a paired device (AirPods, fitness tracker, phone) connects/disconnects.
- **Why:** Presence-based automation. "When phone leaves desk, lock active session."
- **Sketch:** macOS CoreBluetooth via native module. Significant complexity for cross-platform.
- **Complexity:** L
- **Reuses:** AutomationSystem.

### Wifi network change
- **What:** Fires when the connected SSID changes.
- **Why:** Location-aware workflows ("at home", "at office", "on the road").
- **Sketch:** Cross-platform via `node-wifi` or `airport`/`netsh` shell-out. Poll every few seconds.
- **Complexity:** S
- **Reuses:** AutomationSystem.

### Battery / power source change
- **What:** Fires on AC plug/unplug, low-battery, "good time for heavy work" detection.
- **Why:** Power-aware scheduling; pause expensive long-running automations on battery.
- **Sketch:** Electron's `powerMonitor` API exposes everything we need.
- **Complexity:** S
- **Reuses:** AutomationSystem.

### Phone call ended (via Continuity)
- **What:** Fires after a phone call ends.
- **Why:** "Just got off a call → draft follow-up email and create todo from the gist."
- **Sketch:** No public macOS API. Workaround: parse Phone app notifications via `osascript` (fragile).
- **Complexity:** L (and brittle).

---

## Productivity / SaaS integrations

These are mostly variations of `WebhookReceive` (push) or `PollUrl` (pull) but worth calling out as named integrations because the per-service knowledge (event names, payload shapes) is high-value pre-baked context.

### Notion / Airtable / Google Sheets row added
- **What:** Specialization of `PollUrl` with each service's API quirks pre-handled.
- **Why:** Bridges "I keep my data in this spreadsheet" with "I want an agent to act on each row."
- **Complexity:** M each.
- **Reuses:** `PollUrl`.

### Linear / Jira / GitHub issue events
- **What:** Webhook-driven; basically a `WebhookReceive` with the matcher's `slug` and payload schema pre-filled per provider.
- **Why:** Reduces "now I have to figure out the GitHub webhook payload shape" boilerplate.
- **Complexity:** S each (pre-baked templates per provider).
- **Reuses:** `WebhookReceive` + the templates module.

### Stripe events
- Same as above. (Already a starter template.)

---

## Cross-agent / AI ecosystem

### A2A (Agent-to-Agent) inbound
- **What:** Implement Google's emerging Agent2Agent (A2A) protocol so other agents can discover Craft automations and call them.
- **Why:** Future-proofs for the upcoming "everyone agents talks to everyone agents" world.
- **Sketch:** Wrapper around `MCPInbound` that exposes A2A's well-known endpoints (`/.well-known/agent.json`, etc.). Each WebhookReceive automation becomes an "A2A skill" the agent advertises.
- **Complexity:** M (once MCPInbound exists).
- **Reuses:** Trigger HTTP server, `MCPInbound`.

### Claude Code session events forwarded
- **What:** When a Claude Code session emits a hook event (`PostToolUse`, etc.), forward it to a Craft automation in another workspace.
- **Why:** "When my coding session uses bash, log it to my journal workspace's audit trail."
- **Sketch:** Add a Claude Code hook script that POSTs to the local Craft trigger server with the hook event as payload. Pure user-config — no new code in Craft itself, but worth a documented recipe + starter template.
- **Complexity:** S (just a recipe in docs).
- **Reuses:** `WebhookReceive`.

### Webhook → automation → Craft skill chain
- **What:** Not a new event type; a documented pattern of chaining external triggers to existing skills.
- **Why:** Showcases the full power of the system.
- **Sketch:** Recipe doc only.
- **Complexity:** None (documentation).

---

## Aggregators / multi-source

### Inbox-zero scanner
- **What:** A *meta-trigger* that aggregates email + Slack + Telegram + GitHub notifications into one normalized "inbox" stream and fires per item.
- **Why:** "I have 13 inboxes; I want one agent to handle them."
- **Sketch:** Composes existing triggers with shared normalization (sender, subject/title, body, threadId). Could literally be a special automation that listens to multiple events and re-emits a synthetic `InboxItem` event.
- **Complexity:** M (composition) → L (normalization + dedup).
- **Reuses:** All inbound triggers.

### Multi-platform aggregator
- **What:** One trigger spans Slack + Discord + Telegram simultaneously with a shared regex.
- **Why:** Same "@-me" handling regardless of platform.
- **Sketch:** Falls out naturally if `MessageReceive` is allowed to match across all configured adapters (which it already does — a matcher without a platform condition fires for every adapter).
- **Complexity:** Already done — needs documentation.

---

## Public exposure (enabling all of the above)

The trigger server is loopback-only by default. For external services to actually reach it, users need either:

### Cloudflare Tunnel integration
- **What:** Built-in `cloudflared` lifecycle management — when enabled, Craft spawns the tunnel binary and surfaces a stable `https://....trycloudflare.com` URL per workspace.
- **Why:** Removes the "now configure ngrok" friction. GitHub webhooks just work.
- **Sketch:** Bundle `cloudflared`; one toggle in Settings → "Expose publicly via Cloudflare." Use the tunnel URL when displaying trigger URLs in the UI.
- **Complexity:** M
- **Reuses:** Trigger HTTP server.

### Craft-hosted relay
- **What:** Every workspace gets a stable `https://triggers.craft.do/<workspaceToken>/<slug>` URL that forwards to the local app.
- **Why:** Best UX (no extra binary), but requires Craft to operate hosted infrastructure.
- **Sketch:** WebSocket persistent connection from the desktop app to a relay service; HTTPS POSTs hit the relay, which forwards over the WebSocket to the local trigger server.
- **Complexity:** XL (operations cost included).
- **Reuses:** Trigger HTTP server.

### ngrok integration
- **What:** Same as Cloudflare Tunnel, with ngrok.
- **Complexity:** S (just a thin wrapper).
- **Reuses:** Trigger HTTP server.

---

## Admin / scoping ideas worth considering when adding any of the above

- **Per-trigger budget:** "this trigger fires at most N times per hour."
- **Quiet hours:** Suppress triggers during configured do-not-disturb windows.
- **Approval gates:** Some triggers should require user confirmation before firing the action (e.g. "Stripe charge > $1000 → ask first").
- **Trigger groups:** Multiple matchers under a shared parent so users can disable a whole bucket at once.
- **Dry-run mode:** Fire the automation pipeline but skip side-effects, log "would have done X."
- **Replay store:** Persist last 100 fires per trigger with full payload, so users can re-fire test cases.

---

## How to score / pick what's next

When choosing the next trigger to build, ask:

1. **Distinct user value, not "we could."** What real workflow does this unlock that the existing four don't?
2. **Can it reuse a service?** `PollService` and `messaging-gateway` are both extensible; new triggers that piggyback on them ship 5x faster.
3. **Is the auth story clean?** Triggers that need OAuth bring a lot of UI baggage. Defer them unless the user demand is loud.
4. **Does it widen the trigger HTTP server's exposure?** If yes, plan for the public-exposure work simultaneously.

Top picks (subjective) for next round:
1. **Email (IMAP)** — the single most-requested integration in any automation tool, ever.
2. **Cloudflare Tunnel integration** — unblocks production use of `WebhookReceive` for everyone.
3. **macOS Shortcuts action** — converts iPhone/iPad/Watch into Craft remote controls with one shipped binary.
4. **MCP inbound** — keeps Craft in the agent-ecosystem conversation.
