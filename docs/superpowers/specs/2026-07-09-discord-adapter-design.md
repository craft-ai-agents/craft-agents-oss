# Discord Bot Messaging Channel — Design

**Date:** 2026-07-09
**Status:** Approved (design)
**Related issues:** #584 (Messaging Platform Expansion — Discord listed high-priority)

## Summary

Add Discord as a first-class messaging channel alongside Telegram, WhatsApp, and
Lark. A user connects a Discord **bot token**; sessions can then be bound to
Discord **DMs** and **server (guild) text channels**. The adapter supports the
full `PlatformAdapter` capability set: text, message editing, inline buttons
(Discord message components), file uploads, and typing indicators — matching the
Telegram-tier experience (in-chat approvals via buttons).

## Decisions (confirmed with user)

1. **Surfaces:** DM + guild text channels (threads deferred to a later phase).
2. **Capabilities:** Full — message editing, inline buttons, file uploads, typing.
3. **Runtime:** Subprocess worker (isolated like WhatsApp), NOT in-process.
4. **Auth:** Bot Token (Developer Portal), stored in the `messaging_bearer`
   credential row (`name = 'discord'`). No OAuth, no public webhook.
5. **Guild trigger:** Configurable per binding — `'mention'` (require @bot) or
   `'all'` (respond to every message in the bound channel). DMs always route.

## Architecture

Mirrors the WhatsApp isolation model (Baileys → subprocess). Two units:

### New package: `@craft-agent/messaging-discord-worker`

- `src/protocol.ts` — NDJSON stdio protocol (`WorkerCommand` / `WorkerEvent`),
  reusing the same `encodeMessage` / `parseFrames` design as the WhatsApp worker.
- `src/worker.ts` — worker entry. Owns a `discord.js` `Client`, logs in with the
  bot token, listens for messages/interactions, and performs sends.
- Dependency: `discord.js`. Bundled to `dist/worker.cjs` via the same esbuild
  flow used for the WhatsApp worker.

### Gateway adapter: `packages/messaging-gateway/src/adapters/discord/`

- `index.ts` — `DiscordAdapter implements PlatformAdapter`. Spawns the worker,
  translates events, manages lifecycle. Reuses the `WhatsAppAdapter` skeleton
  (pending map, per-send timeout, `drainPending` on crash/destroy) but also
  implements `editMessage`, `sendButtons`, `clearButtons`.
- `format.ts` — Markdown → Discord formatting (Discord uses near-standard
  Markdown; light transformation).

### Data flow

```
Discord Gateway WS  <->  worker.ts (discord.js Client)
        |  (NDJSON over stdin/stdout)
DiscordAdapter (main process)  --implements-->  PlatformAdapter
        |
Gateway -> Router -> SessionManager
```

Router, `Commands` (`/new`, `/bind`, `/pair`), access-control, pending-senders,
and renderer chunking are all platform-agnostic and reused unchanged.

## Worker Protocol (NDJSON)

### Commands (main → worker)

| type            | fields                                          | notes |
|-----------------|-------------------------------------------------|-------|
| `start`         | `token`                                         | login |
| `send_text`     | `id, channelId, text`                           | -> send_result |
| `edit_message`  | `id, channelId, messageId, text`                | Discord supports edits |
| `send_buttons`  | `id, channelId, text, buttons[]`                | ActionRow + Button |
| `send_file`     | `id, channelId, dataBase64, filename, caption?` | AttachmentBuilder |
| `send_typing`   | `channelId`                                     | channel.sendTyping() |
| `clear_buttons` | `id, channelId, messageId`                      | edit to empty components |
| `shutdown`      | —                                               | graceful exit |

### Events (worker → main)

| type           | fields |
|----------------|--------|
| `ready`        | `discordJsVersion?, buildId?, gitSha?` |
| `connected`    | `botId, username` |
| `disconnected` | `loggedOut, reason?` |
| `incoming`     | `channelId, messageId, senderId, senderName, senderIsBot, text, isDM, mentionedBot, attachments[], timestamp` |
| `button_press` | `channelId, messageId, senderId, senderName, buttonId, data?` |
| `send_result`  | `id, ok, messageId?, error?` |
| `error`        | `message` (non-fatal) |
| `unavailable`  | `reason: 'login_failed' | 'disallowed_intents' | 'unknown', message` |

### discord.js Client config

- Intents: `Guilds`, `GuildMessages`, `MessageContent` (privileged),
  `DirectMessages`.
- Partials: `Channel`, `Message` (required to receive DMs).
- Events: `ClientReady`, `MessageCreate`, `InteractionCreate` (buttons).

### Mapping details

- `incoming.mentionedBot` + `isDM` let the main-side filter decide routing per
  the binding's `discordGuildTrigger`.
- Attachments: worker downloads the Discord CDN bytes → temp file → reports
  `localPath` (identical to WhatsApp; Router wraps via `readFileAttachment`).
- Buttons: `customId` carries `buttonId` (<=100 chars). On click the worker
  calls `interaction.deferUpdate()` to avoid Discord's "interaction failed".
- Bot-authored messages (`senderIsBot`) are dropped before routing.

## Type-system & Registry Wiring

### `messaging-gateway/src/types.ts`

- `PlatformType` += `'discord'`.
- `AdapterCapabilities.markdown` union += `'discord'`.
- `MessagingConfig.platforms` += `discord?: { enabled: boolean }`.
- `BindingConfig` += `discordGuildTrigger?: 'mention' | 'all'` (default
  `'mention'`); handled in `normalizeBindingConfig` with migration default.
- `getDefaultBindingConfig`: Discord supports buttons → `approvalChannel`
  default `'chat'` (like Telegram, unlike WhatsApp's `'app'`).

### `registry.ts` (mirrors the WhatsApp subprocess path)

- `WorkspaceState` += `discord: DiscordAdapter | null` + `discordOffEvent?`.
- `MessagingGatewayRegistryOptions` += `discord?: { workerEntry, nodeBin? }`.
- New: `testDiscordCredentials` (validate token via `GET /users/@me`),
  `saveDiscordCredentials`, `connectDiscord`/`tryConnectDiscord`,
  `parseDiscordCredentials` (`{ token }` JSON in `messaging_bearer` name=`discord`).
- Add `'discord'` to every platform-iteration site: `initializeWorkspace`,
  `disconnectPlatform`, `forget`, runtime clone, and the
  `['telegram','whatsapp','lark']` arrays.

### `index.ts` / `package.json`

- Export `DiscordAdapter` + types.
- `discord.js` dependency lives in the worker package; gateway depends on the
  worker package (`workspace:*`) for the protocol only.

### Electron `main/index.ts` + `electron-builder.yml`

- Provide `discord.workerEntry` (dev: `packages/messaging-discord-worker/dist/worker.cjs`;
  packaged: `resourcesPath/messaging-discord-worker/worker.cjs`).
- Add the worker to `extraResources`.

### Trigger filter

DiscordAdapter's `onMessage` handling of a worker `incoming`:
- DM → forward.
- Guild → look up the channel's binding `discordGuildTrigger`:
  `'mention'` forwards only when `mentionedBot === true`; `'all'` forwards
  everything. Pre-bind command messages require @mention.

## Shared protocol + server-core + UI

### `shared/src/protocol/channels.ts`

- `RPC_CHANNELS.messaging` += `TEST_DISCORD: 'messaging:testDiscord'`,
  `SAVE_DISCORD: 'messaging:saveDiscord'`.
- Classify both new channels in `routing.ts` (exhaustive routing test).

### `server-core`

- `messaging-registry-interface.ts`: add `testDiscordCredentials(creds:{token})`
  and `saveDiscordCredentials(workspaceId, creds:{token})`.
- `handlers/rpc/messaging.ts`: register `TEST_DISCORD` / `SAVE_DISCORD` handlers
  (mirrors the two Lark handlers).

### Electron renderer

- `transport/channel-map.ts`: add `testDiscordCredentials` / `saveDiscordCredentials`.
- New `components/messaging/DiscordConnectDialog.tsx` (mirrors `LarkConnectDialog`:
  one Bot Token field + "how to get it / enable Message Content Intent" help +
  Test/Save).
- New `assets/messaging-icons/discord.svg`; register in `MessagingPlatformIcon.tsx`
  (bg `#5865F2`, initial `D`).
- Update the 6 hardcoded `'telegram' | 'whatsapp' | 'lark'` unions:
  `MessagingSettingsPage.tsx`, `MessagingPlatformIcon.tsx`,
  `MessagingSessionMenuItem.tsx`, `PairingCodeDialog.tsx`, `atoms/messaging.ts`,
  `playground/mock-utils.ts`.
- `MessagingSettingsPage.tsx`: add a Discord platform card.

### i18n

- Add ~8-10 Discord keys to `en.json` and every other locale file (parity
  enforced). Keep "Discord" in English.

### Docs

- `doc-links.ts` + `word-lists.ts`: add Discord doc link + session word-list
  entry (following the Lark precedent).

## Error handling

- Invalid token → `unavailable{login_failed}` → runtime `error` + dialog message.
- Missing Message Content Intent → discord.js "disallowed intents" →
  `unavailable{disallowed_intents}` → dialog prompts the Developer Portal toggle.
- Worker crash/exit → `drainPending` + runtime `error` (reused skeleton).
- Send timeout 30s → `send_result{ok:false}` (reused).

## Testing

- worker: `protocol.test.ts` (encode/decode round-trip).
- adapter: `lifecycle.test.ts` (spawn mock + event translation, like WhatsApp) +
  trigger-filter unit tests (mention / all / DM).
- format: `format.test.ts` (Markdown → Discord).
- No network, no real token.

## Verification

- Per package: `bun run tsc --noEmit` / `typecheck`.
- Root: `bun run validate:ci` (includes i18n parity / sorted / coverage).

## Out of scope (v1)

- Threads / forum channels (Telegram-topic analogue).
- Slash-command registration (uses @mention + text commands instead).
- Reactions, voice, ephemeral replies.
