/**
 * IPC protocol between the main process (DiscordAdapter) and the discord
 * worker subprocess.
 *
 * Transport: newline-delimited JSON (NDJSON) over the worker's stdin/stdout.
 * - Main → Worker: one WorkerCommand per line (stdin).
 * - Worker → Main: one WorkerEvent per line (stdout).
 * - Worker stderr is reserved for free-form logs (not parsed).
 *
 * The protocol is intentionally small — the worker owns all discord.js state;
 * the main process only drives lifecycle and relays incoming/outgoing
 * messages and button interactions.
 */

// ---------------------------------------------------------------------------
// Buttons (shared wire shape)
// ---------------------------------------------------------------------------

export interface WorkerButton {
  /** Stable id echoed back on click via `button_press.buttonId`. Max 100 chars. */
  id: string
  /** Visible label on the Discord button. */
  label: string
  /** Optional opaque payload the main process wants echoed back. */
  data?: string
}

// ---------------------------------------------------------------------------
// Commands (main → worker)
// ---------------------------------------------------------------------------

export type WorkerCommand =
  | StartCommand
  | SendTextCommand
  | EditMessageCommand
  | SendButtonsCommand
  | SendFileCommand
  | SendTypingCommand
  | ClearButtonsCommand
  | ShutdownCommand

export interface StartCommand {
  type: 'start'
  /** Discord bot token from the Developer Portal. */
  token: string
}

export interface SendTextCommand {
  id: string
  type: 'send_text'
  channelId: string
  text: string
}

export interface EditMessageCommand {
  id: string
  type: 'edit_message'
  channelId: string
  messageId: string
  text: string
}

export interface SendButtonsCommand {
  id: string
  type: 'send_buttons'
  channelId: string
  text: string
  buttons: WorkerButton[]
}

export interface SendFileCommand {
  id: string
  type: 'send_file'
  channelId: string
  /** Base64-encoded file bytes. */
  dataBase64: string
  filename: string
  caption?: string
}

export interface SendTypingCommand {
  type: 'send_typing'
  channelId: string
}

export interface ClearButtonsCommand {
  id: string
  type: 'clear_buttons'
  channelId: string
  messageId: string
}

export interface ShutdownCommand {
  type: 'shutdown'
}

// ---------------------------------------------------------------------------
// Events (worker → main)
// ---------------------------------------------------------------------------

export type WorkerEvent =
  | ReadyEvent
  | ConnectedEvent
  | DisconnectedEvent
  | IncomingEvent
  | ButtonPressEvent
  | SendResultEvent
  | ErrorEvent
  | UnavailableEvent

export interface ReadyEvent {
  type: 'ready'
  /** discord.js version reported by the worker, informational. */
  discordJsVersion?: string
  /** ISO timestamp the worker bundle was produced. Informational. */
  buildId?: string
  /** Short git SHA (or `unknown`/`dev-unbundled`) the bundle was built from. */
  gitSha?: string
}

export interface ConnectedEvent {
  type: 'connected'
  /** Bot application/user id. */
  botId: string
  /** Bot username (without discriminator on the new username system). */
  username: string
}

export interface DisconnectedEvent {
  type: 'disconnected'
  /** `true` when the session is lost permanently (invalid token / logged out). */
  loggedOut: boolean
  reason?: string
}

/**
 * Media attachment carried over the wire. The worker downloads the bytes from
 * the Discord CDN, writes them to a temp file, and reports the absolute path.
 * The adapter on the main side translates this into a gateway
 * `IncomingAttachment`.
 */
export interface WorkerIncomingAttachment {
  type: 'photo' | 'document' | 'voice' | 'video' | 'audio'
  fileName?: string
  mimeType?: string
  fileSize?: number
  /** Absolute path of the temp file the worker wrote the media to. */
  localPath: string
}

export interface IncomingEvent {
  type: 'incoming'
  channelId: string
  messageId: string
  senderId: string
  senderName?: string
  /** `true` when the author is a bot (main side silent-drops bot traffic). */
  senderIsBot: boolean
  text: string
  /** `true` when the message arrived in a DM channel. */
  isDM: boolean
  /** `true` when the bot user was @mentioned in the message. */
  mentionedBot: boolean
  attachments?: WorkerIncomingAttachment[]
  timestamp: number
}

export interface ButtonPressEvent {
  type: 'button_press'
  channelId: string
  messageId: string
  senderId: string
  senderName?: string
  /** The `WorkerButton.id` of the clicked button (Discord customId). */
  buttonId: string
  data?: string
}

export interface SendResultEvent {
  type: 'send_result'
  /** Correlates with the originating command `id`. */
  id: string
  ok: boolean
  messageId?: string
  error?: string
}

export interface ErrorEvent {
  type: 'error'
  /** Non-fatal — the worker is still running. */
  message: string
}

export interface UnavailableEvent {
  type: 'unavailable'
  /**
   * Fatal error — the worker can't proceed.
   *
   * - `login_failed`       — invalid token / login rejected
   * - `disallowed_intents` — the Message Content (privileged) intent is off
   * - `unknown`            — check `message`
   */
  reason: 'login_failed' | 'disallowed_intents' | 'unknown'
  message: string
}

// ---------------------------------------------------------------------------
// NDJSON helpers
// ---------------------------------------------------------------------------

export function encodeMessage(msg: WorkerCommand | WorkerEvent): string {
  return JSON.stringify(msg) + '\n'
}

/**
 * Parse a newline-delimited JSON stream incrementally. Returns parsed
 * messages and the residual unparsed tail for the next chunk.
 */
export function parseFrames<T>(buffer: string): { messages: T[]; rest: string } {
  const messages: T[] = []
  let rest = buffer
  while (true) {
    const nl = rest.indexOf('\n')
    if (nl === -1) break
    const line = rest.slice(0, nl).trim()
    rest = rest.slice(nl + 1)
    if (!line) continue
    try {
      messages.push(JSON.parse(line) as T)
    } catch {
      // Skip malformed lines — worker stderr leakage is already filtered,
      // but be defensive so a single bad line doesn't kill the stream.
    }
  }
  return { messages, rest }
}
