# Discord Messaging Channel — Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add Discord as a messaging channel (DM + guild text channels) via an isolated `discord.js` subprocess worker, exposing the full `PlatformAdapter` capability set.

**Architecture:** New `@craft-agent/messaging-discord-worker` package runs `discord.js` in a Node subprocess, speaking NDJSON over stdio to a new `DiscordAdapter` in `messaging-gateway`. All routing/binding/access/commands are reused unchanged. Mirrors the WhatsApp/Baileys isolation model.

**Tech Stack:** TypeScript, `discord.js` v14, Bun test, esbuild bundling, Electron.

## Global Constraints

- `PlatformType` literal union is duplicated in 7 files — update every one.
- New RPC channels must be classified in `shared/src/protocol/routing.ts`.
- i18n keys must exist in ALL locale files (`en, de, es, ja, pl, hu, zh-Hans` + any others), alphabetically sorted. Keep "Discord" in English.
- Credentials only via `CredentialManager` (`messaging_bearer`, name=`discord`).
- Worker must stay Node-compatible (CJS, platform=node) — Bun cannot run it.
- discord.js requires the privileged **Message Content Intent**.

---

### Task 1: Worker package skeleton + NDJSON protocol

**Files:**
- Create: `packages/messaging-discord-worker/package.json`
- Create: `packages/messaging-discord-worker/tsconfig.json`
- Create: `packages/messaging-discord-worker/src/protocol.ts`
- Test: `packages/messaging-discord-worker/src/__tests__/protocol.test.ts`

**Produces:** `WorkerCommand`, `WorkerEvent`, `encodeMessage`, `parseFrames<T>`, plus attachment/button wire types.

- [ ] package.json: name `@craft-agent/messaging-discord-worker`, `main: src/worker.ts`, exports `.`→`./src/protocol.ts`, `./worker`→`./src/worker.ts`, dep `discord.js@^14`.
- [ ] tsconfig.json: copy whatsapp-worker's verbatim.
- [ ] protocol.ts: define command/event unions per spec; copy `encodeMessage`/`parseFrames` from whatsapp worker.
- [ ] protocol.test.ts: round-trip encode→parse for each command + event; partial-frame buffering.
- [ ] Run `cd packages/messaging-discord-worker && bun test` → PASS.
- [ ] Commit.

### Task 2: Worker runtime (discord.js Client)

**Files:**
- Create: `packages/messaging-discord-worker/src/worker.ts`

**Consumes:** Task 1 protocol.
**Produces:** runnable worker entry reading commands on stdin, emitting events on stdout.

- [ ] Client with intents `Guilds, GuildMessages, MessageContent, DirectMessages`, partials `Channel, Message`.
- [ ] `start`: login(token); on `ClientReady` emit `connected{botId,username}`; on login error emit `unavailable{login_failed|disallowed_intents}`.
- [ ] `MessageCreate`: skip own bot; compute `isDM`, `mentionedBot`; download attachments to temp files → `localPath`; emit `incoming`.
- [ ] `InteractionCreate` (isButton): `deferUpdate()`, emit `button_press{buttonId=customId}`.
- [ ] `send_text/edit_message/send_buttons/send_file/send_typing/clear_buttons`: perform via channel fetch; emit `send_result`.
- [ ] `shutdown`: destroy client, exit 0.
- [ ] Manual typecheck `bun run tsc --noEmit` → PASS. Commit.

### Task 3: esbuild bundling + root script

**Files:**
- Create: `scripts/build-discord-worker.ts`
- Modify: root `package.json` scripts (+`build:discord-worker`)

- [ ] Copy `build-wa-worker.ts`, retarget paths to discord worker, externalize only `electron`, define `__DISCORD_WORKER_BUILD_ID__`/`__DISCORD_WORKER_GIT_SHA__`.
- [ ] Add script `"build:discord-worker": "bun run scripts/build-discord-worker.ts"`.
- [ ] Run it → `dist/worker.cjs` builds and `node --check` passes. Commit.

### Task 4: Gateway types

**Files:**
- Modify: `packages/messaging-gateway/src/types.ts`
- Test: `packages/messaging-gateway/src/__tests__/discord-config.test.ts`

- [ ] `PlatformType` += `'discord'`; `markdown` union += `'discord'`.
- [ ] `MessagingConfig.platforms` += `discord?: { enabled: boolean }`.
- [ ] `BindingConfig` += `discordGuildTrigger?: 'mention' | 'all'`; default `'mention'` in `DEFAULT_BINDING_CONFIG` + `normalizeBindingConfig`.
- [ ] `getDefaultBindingConfig`: discord → `approvalChannel: 'chat'`.
- [ ] Test normalize defaults + migration. `bun test` → PASS. Commit.

### Task 5: DiscordAdapter

**Files:**
- Create: `packages/messaging-gateway/src/adapters/discord/index.ts`
- Create: `packages/messaging-gateway/src/adapters/discord/format.ts`
- Test: `packages/messaging-gateway/src/adapters/discord/__tests__/format.test.ts`
- Test: `packages/messaging-gateway/src/adapters/discord/lifecycle.test.ts`

**Consumes:** Task 1 protocol (`@craft-agent/messaging-discord-worker`), Task 4 types.
**Produces:** `DiscordAdapter`, `parseDiscordCredentials`, `DiscordCredentials`, `DiscordEvent`.

- [ ] `format.ts`: Markdown→Discord (near-passthrough; strip unsupported), `formatForDiscord(text): string`.
- [ ] `index.ts`: copy WhatsAppAdapter skeleton (spawn, pending/timeout, drainPending). capabilities: `messageEditing:true, inlineButtons:true, maxButtons:5, maxMessageLength:2000, markdown:'discord', webhookSupport:false`.
- [ ] Implement `editMessage`, `sendButtons` (real), `clearButtons`, `sendTyping`, `sendFile`.
- [ ] Trigger filter in `onMessage`: DM→forward; guild→forward if `mentionedBot` (binding trigger applied by router via config; adapter forwards mention flag through `IncomingMessage.raw`+ handles pre-bind).
- [ ] `onEvent` for connected/unavailable/error (UI surfacing).
- [ ] Tests: format round-trips; lifecycle spawn-mock event translation + button_press. `bun test` → PASS. Commit.

### Task 6: Registry wiring

**Files:**
- Modify: `packages/messaging-gateway/src/registry.ts`
- Modify: `packages/messaging-gateway/src/index.ts`
- Modify: `packages/messaging-gateway/package.json` (+`@craft-agent/messaging-discord-worker` workspace dep)

- [ ] Options += `discord?: { workerEntry, nodeBin? }`; `WorkspaceState` += `discord`/`discordOffEvent`.
- [ ] `testDiscordCredentials` (GET `https://discord.com/api/v10/users/@me` with `Bot <token>`), `saveDiscordCredentials`, `tryConnectDiscord`, `parseDiscordCredentials`.
- [ ] Add `'discord'` to every platform-iteration site + runtime clone + disconnect/forget.
- [ ] Export `DiscordAdapter` from index.ts.
- [ ] `cd packages/messaging-gateway && bun run typecheck` → PASS. Commit.

### Task 7: Shared protocol + server-core

**Files:**
- Modify: `packages/shared/src/protocol/channels.ts`
- Modify: `packages/shared/src/protocol/routing.ts`
- Modify: `packages/server-core/src/handlers/messaging-registry-interface.ts`
- Modify: `packages/server-core/src/handlers/rpc/messaging.ts`

- [ ] channels: `TEST_DISCORD`, `SAVE_DISCORD`.
- [ ] routing: classify both.
- [ ] interface: `testDiscordCredentials`/`saveDiscordCredentials` signatures.
- [ ] handlers: register both (mirror Lark).
- [ ] `cd packages/shared && bun run tsc --noEmit` + server-core typecheck → PASS. Commit.

### Task 8: Electron transport + main wiring

**Files:**
- Modify: `apps/electron/src/transport/channel-map.ts`
- Modify: `apps/electron/src/main/index.ts`
- Modify: `apps/electron/electron-builder.yml`

- [ ] channel-map: `testDiscordCredentials`/`saveDiscordCredentials` invokes.
- [ ] main: provide `discord.workerEntry` (dev/packaged paths).
- [ ] electron-builder: add worker to extraResources.
- [ ] `bun run typecheck:electron` → PASS. Commit.

### Task 9: Electron UI

**Files:**
- Create: `apps/electron/src/renderer/components/messaging/DiscordConnectDialog.tsx`
- Create: `apps/electron/src/renderer/assets/messaging-icons/discord.svg`
- Modify: `MessagingPlatformIcon.tsx`, `MessagingSettingsPage.tsx`, `MessagingSessionMenuItem.tsx`, `PairingCodeDialog.tsx`, `atoms/messaging.ts`, `playground/mock-utils.ts`

- [ ] Add `'discord'` to the 6 unions.
- [ ] Icon registration (`#5865F2`, `D`).
- [ ] DiscordConnectDialog (Bot Token field, intent help, Test/Save) mirroring LarkConnectDialog.
- [ ] Discord platform card in settings.
- [ ] `bun run typecheck:electron` → PASS. Commit.

### Task 10: i18n + docs + final validation

**Files:**
- Modify: all `packages/shared/src/i18n/locales/*.json`
- Modify: `packages/shared/src/docs/doc-links.ts`, `packages/shared/src/sessions/word-lists.ts`

- [ ] Add Discord keys to `en.json` (sorted) + every locale.
- [ ] doc-links + word-lists entries.
- [ ] `bun run lint:i18n:parity && lint:i18n:sorted && lint:i18n:coverage` → PASS.
- [ ] `bun run typecheck:all` → PASS. Commit.

## Self-Review

Spec coverage: all sections mapped to Tasks 1-10. No placeholders. Type names consistent (`DiscordAdapter`, `parseDiscordCredentials`, `discordGuildTrigger`, `formatForDiscord`, worker `WorkerCommand`/`WorkerEvent`).
