/**
 * Discord worker subprocess entry.
 *
 * Owns all discord.js state. Communicates with the main process over
 * newline-delimited JSON on stdin/stdout (see protocol.ts).
 *
 * discord.js is bundled into worker.cjs by esbuild at build time. The worker
 * runs under Node (not Bun) when packaged with Electron so discord.js' `ws`
 * and `zlib` deps resolve correctly.
 *
 * Unlike the WhatsApp/Baileys worker there is no QR / pairing flow: a Discord
 * bot authenticates with a static bot token. The only fatal setup pitfall is
 * the privileged **Message Content Intent** — if it's off, discord.js rejects
 * the login and we surface an `unavailable{disallowed_intents}` event.
 */

import { Buffer } from 'node:buffer'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  version as discordJsVersion,
  type Message,
  type Interaction,
  type SendableChannels,
  type Attachment,
} from 'discord.js'
import {
  encodeMessage,
  parseFrames,
  type WorkerCommand,
  type WorkerEvent,
  type WorkerIncomingAttachment,
} from './protocol'

/**
 * Build-time constants injected by `scripts/build-discord-worker.ts` via
 * esbuild `--define`. At dev-time (no bundle) they fall back to `dev-*`.
 */
declare const __DISCORD_WORKER_BUILD_ID__: string
declare const __DISCORD_WORKER_GIT_SHA__: string
const WORKER_BUILD_ID =
  typeof __DISCORD_WORKER_BUILD_ID__ !== 'undefined' ? __DISCORD_WORKER_BUILD_ID__ : 'dev-unbundled'
const WORKER_GIT_SHA =
  typeof __DISCORD_WORKER_GIT_SHA__ !== 'undefined' ? __DISCORD_WORKER_GIT_SHA__ : 'dev-unbundled'

/** Discord hard limits — mirrored so the worker fails fast on oversize input. */
const MAX_BUTTONS_PER_ROW = 5

// ---------------------------------------------------------------------------
// Emit / log helpers
// ---------------------------------------------------------------------------

function emit(event: WorkerEvent): void {
  process.stdout.write(encodeMessage(event))
}

function log(...args: unknown[]): void {
  // stderr is reserved for logs so the main process parser doesn't confuse them.
  process.stderr.write('[discord-worker] ' + args.map(String).join(' ') + '\n')
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

interface SessionState {
  client: Client
  shuttingDown: boolean
}

let session: SessionState | null = null

// ---------------------------------------------------------------------------
// Attachment handling
// ---------------------------------------------------------------------------

/** Map a Discord attachment content-type to the gateway attachment kind. */
function attachmentKind(att: Attachment): WorkerIncomingAttachment['type'] {
  const ct = (att.contentType ?? '').toLowerCase()
  if (ct.startsWith('image/')) return 'photo'
  if (ct.startsWith('video/')) return 'video'
  if (ct.startsWith('audio/')) {
    // Discord voice messages are audio/ogg; treat all audio uniformly.
    return 'audio'
  }
  return 'document'
}

/**
 * Download a Discord CDN attachment to a temp file and return the wire
 * descriptor. Returns null on failure so one bad download doesn't drop the
 * whole message.
 */
async function downloadAttachment(att: Attachment): Promise<WorkerIncomingAttachment | null> {
  try {
    const res = await fetch(att.url)
    if (!res.ok) {
      log(`attachment download failed: ${att.url} (${res.status})`)
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    const safeName = att.name?.replace(/[^\w.\-]/g, '_') ?? 'file'
    const localPath = join(tmpdir(), `craft-discord-${randomBytes(8).toString('hex')}-${safeName}`)
    await writeFile(localPath, buf)
    return {
      type: attachmentKind(att),
      fileName: att.name ?? undefined,
      mimeType: att.contentType ?? undefined,
      fileSize: att.size,
      localPath,
    }
  } catch (err) {
    log(`attachment error: ${errMsg(err)}`)
    return null
  }
}

// ---------------------------------------------------------------------------
// Inbound message handling
// ---------------------------------------------------------------------------

async function onMessageCreate(client: Client, message: Message): Promise<void> {
  // Ignore our own outbound messages outright — no echo loop.
  if (client.user && message.author.id === client.user.id) return

  const isDM = !message.guildId
  const mentionedBot = client.user ? message.mentions.users.has(client.user.id) : false

  let attachments: WorkerIncomingAttachment[] | undefined
  if (message.attachments.size > 0) {
    const resolved = await Promise.all(
      [...message.attachments.values()].map((att) => downloadAttachment(att)),
    )
    const ok = resolved.filter((a): a is WorkerIncomingAttachment => a !== null)
    if (ok.length > 0) attachments = ok
  }

  emit({
    type: 'incoming',
    channelId: message.channelId,
    messageId: message.id,
    senderId: message.author.id,
    senderName: message.author.displayName ?? message.author.username,
    senderIsBot: message.author.bot,
    text: message.content ?? '',
    isDM,
    mentionedBot,
    attachments,
    timestamp: message.createdTimestamp,
  })
}

async function onInteractionCreate(interaction: Interaction): Promise<void> {
  if (!interaction.isButton()) return
  // Acknowledge immediately so Discord doesn't show "This interaction failed".
  try {
    await interaction.deferUpdate()
  } catch (err) {
    log(`deferUpdate failed: ${errMsg(err)}`)
  }
  emit({
    type: 'button_press',
    channelId: interaction.channelId ?? '',
    messageId: interaction.message.id,
    senderId: interaction.user.id,
    senderName: interaction.user.displayName ?? interaction.user.username,
    buttonId: interaction.customId,
  })
}

// ---------------------------------------------------------------------------
// Outbound helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a channel id to a send-capable text channel. Throws a descriptive
 * error when the channel is missing or not text-based so the caller can
 * surface it in a `send_result`.
 */
async function fetchSendable(client: Client, channelId: string): Promise<SendableChannels> {
  const channel = await client.channels.fetch(channelId)
  if (!channel) throw new Error(`Channel ${channelId} not found`)
  if (!channel.isSendable()) {
    throw new Error(`Channel ${channelId} is not a sendable text channel`)
  }
  return channel
}

function buildButtonRows(buttons: { id: string; label: string }[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = []
  for (let i = 0; i < buttons.length; i += MAX_BUTTONS_PER_ROW) {
    const slice = buttons.slice(i, i + MAX_BUTTONS_PER_ROW)
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      slice.map((b) =>
        new ButtonBuilder()
          .setCustomId(b.id.slice(0, 100))
          .setLabel(b.label.slice(0, 80))
          .setStyle(ButtonStyle.Primary),
      ),
    )
    rows.push(row)
  }
  return rows
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async function startSession(token: string): Promise<void> {
  if (session) {
    emit({ type: 'error', message: 'Session already started' })
    return
  }
  log(`starting — build=${WORKER_BUILD_ID} sha=${WORKER_GIT_SHA} discord.js=${discordJsVersion}`)

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    // Channel + Message partials are required to receive DM events, whose
    // channel isn't cached until first interaction.
    partials: [Partials.Channel, Partials.Message],
  })

  session = { client, shuttingDown: false }

  emit({ type: 'ready', discordJsVersion, buildId: WORKER_BUILD_ID, gitSha: WORKER_GIT_SHA })

  client.once(Events.ClientReady, (c) => {
    emit({ type: 'connected', botId: c.user.id, username: c.user.username })
  })

  client.on(Events.MessageCreate, (message) => {
    void onMessageCreate(client, message).catch((err) => log(`messageCreate error: ${errMsg(err)}`))
  })

  client.on(Events.InteractionCreate, (interaction) => {
    void onInteractionCreate(interaction).catch((err) =>
      log(`interactionCreate error: ${errMsg(err)}`),
    )
  })

  client.on(Events.Error, (err) => {
    emit({ type: 'error', message: errMsg(err) })
  })

  client.on(Events.ShardDisconnect, (event) => {
    if (session?.shuttingDown) return
    emit({ type: 'disconnected', loggedOut: false, reason: `shard closed (code ${event.code})` })
  })

  try {
    await client.login(token)
  } catch (err) {
    const msg = errMsg(err)
    // discord.js throws with 'disallowed intents' when a privileged intent
    // (Message Content) is enabled in code but not toggled on in the portal.
    const lowered = msg.toLowerCase()
    if (lowered.includes('disallowed intents')) {
      emit({
        type: 'unavailable',
        reason: 'disallowed_intents',
        message:
          'Discord rejected the connection: the Message Content Intent is not enabled. ' +
          'Enable it under Bot → Privileged Gateway Intents in the Developer Portal.',
      })
    } else if (lowered.includes('token') || lowered.includes('unauthorized')) {
      emit({ type: 'unavailable', reason: 'login_failed', message: `Invalid bot token: ${msg}` })
    } else {
      emit({ type: 'unavailable', reason: 'unknown', message: msg })
    }
    session = null
    try {
      client.destroy()
    } catch {
      // ignore
    }
    process.exit(0)
  }
}

async function shutdown(): Promise<void> {
  if (session) {
    session.shuttingDown = true
    try {
      await session.client.destroy()
    } catch {
      // ignore
    }
    session = null
  }
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

async function handleCommand(cmd: WorkerCommand): Promise<void> {
  switch (cmd.type) {
    case 'start': {
      await startSession(cmd.token).catch((err) => {
        emit({ type: 'error', message: errMsg(err) })
      })
      return
    }
    case 'send_text': {
      if (!session) {
        emit({ type: 'send_result', id: cmd.id, ok: false, error: 'Not connected' })
        return
      }
      try {
        const channel = await fetchSendable(session.client, cmd.channelId)
        const sent = await channel.send({ content: cmd.text })
        emit({ type: 'send_result', id: cmd.id, ok: true, messageId: sent.id })
      } catch (err) {
        emit({ type: 'send_result', id: cmd.id, ok: false, error: errMsg(err) })
      }
      return
    }
    case 'edit_message': {
      if (!session) {
        emit({ type: 'send_result', id: cmd.id, ok: false, error: 'Not connected' })
        return
      }
      try {
        const channel = await fetchSendable(session.client, cmd.channelId)
        const msg = await channel.messages.fetch(cmd.messageId)
        const edited = await msg.edit({ content: cmd.text })
        emit({ type: 'send_result', id: cmd.id, ok: true, messageId: edited.id })
      } catch (err) {
        emit({ type: 'send_result', id: cmd.id, ok: false, error: errMsg(err) })
      }
      return
    }
    case 'send_buttons': {
      if (!session) {
        emit({ type: 'send_result', id: cmd.id, ok: false, error: 'Not connected' })
        return
      }
      try {
        const channel = await fetchSendable(session.client, cmd.channelId)
        const components = buildButtonRows(cmd.buttons)
        const sent = await channel.send({ content: cmd.text, components })
        emit({ type: 'send_result', id: cmd.id, ok: true, messageId: sent.id })
      } catch (err) {
        emit({ type: 'send_result', id: cmd.id, ok: false, error: errMsg(err) })
      }
      return
    }
    case 'send_file': {
      if (!session) {
        emit({ type: 'send_result', id: cmd.id, ok: false, error: 'Not connected' })
        return
      }
      try {
        const channel = await fetchSendable(session.client, cmd.channelId)
        const buf = Buffer.from(cmd.dataBase64, 'base64')
        const file = new AttachmentBuilder(buf, { name: cmd.filename })
        const sent = await channel.send({
          content: cmd.caption && cmd.caption.length > 0 ? cmd.caption : undefined,
          files: [file],
        })
        emit({ type: 'send_result', id: cmd.id, ok: true, messageId: sent.id })
      } catch (err) {
        emit({ type: 'send_result', id: cmd.id, ok: false, error: errMsg(err) })
      }
      return
    }
    case 'send_typing': {
      if (!session) return
      try {
        const channel = await fetchSendable(session.client, cmd.channelId)
        if ('sendTyping' in channel && typeof channel.sendTyping === 'function') {
          await channel.sendTyping()
        }
      } catch (err) {
        log(`send_typing error: ${errMsg(err)}`)
      }
      return
    }
    case 'clear_buttons': {
      if (!session) {
        emit({ type: 'send_result', id: cmd.id, ok: false, error: 'Not connected' })
        return
      }
      try {
        const channel = await fetchSendable(session.client, cmd.channelId)
        const msg = await channel.messages.fetch(cmd.messageId)
        await msg.edit({ components: [] })
        emit({ type: 'send_result', id: cmd.id, ok: true, messageId: cmd.messageId })
      } catch (err) {
        // Non-fatal — most "can't edit" cases are benign (message deleted).
        emit({ type: 'send_result', id: cmd.id, ok: false, error: errMsg(err) })
      }
      return
    }
    case 'shutdown': {
      await shutdown()
      return
    }
  }
}

// ---------------------------------------------------------------------------
// stdin reader
// ---------------------------------------------------------------------------

let stdinBuffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  stdinBuffer += chunk
  const { messages, rest } = parseFrames<WorkerCommand>(stdinBuffer)
  stdinBuffer = rest
  for (const msg of messages) {
    void handleCommand(msg)
  }
})

process.stdin.on('end', () => {
  void shutdown()
})

process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
