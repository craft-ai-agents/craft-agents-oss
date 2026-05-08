/**
 * Per-message upsert pipeline used by the WA worker's `messages.upsert`
 * listener.
 *
 * Extracted into its own module so unit tests can drive it without
 * importing `worker.ts` (whose top level installs stdin / signal handlers).
 */

import { bareJid, classifyInbound } from './filter'
import { extractAttachments } from './media'
import type { BaileysModule } from './worker'
import type { IncomingEvent } from './protocol'

export interface UpsertSession {
  selfChatMode: boolean
  responsePrefix: string
  sentIds: Set<string>
  baileys: BaileysModule
}

export interface UpsertContext {
  cutoff: number
  selfJid: string | null
  selfLid: string | null
}

export type EmitFn = (event: IncomingEvent) => void
export type LogFn = (...args: unknown[]) => void

/**
 * Process a single upsert message: history filter → classify → media extract → emit.
 *
 * Decision precedence:
 * - history (timestamp older than `cutoff`) → skip silently
 * - classifyInbound → handles malformed / own_echo_id / own_outbound /
 *   non_self_chat_inbound / own_echo_prefix and returns either `emit { text }`
 *   or `skip { reason }`. Any non-`empty` skip is honoured here too — we do
 *   NOT route own outbound just because it carries media.
 * - the only override is `skip { reason: 'empty' }`: a voice note has no
 *   caption, so empty text + media must still emit.
 */
export async function processUpsertMessage(
  msg: Record<string, unknown>,
  upsertCtx: UpsertContext,
  session: UpsertSession,
  emit: EmitFn,
  log: LogFn,
): Promise<void> {
  const ts = Number((msg as { messageTimestamp?: unknown }).messageTimestamp)
  if (Number.isFinite(ts) && ts > 0 && ts < upsertCtx.cutoff) {
    log(`upsert skip: history (ts=${ts} cutoff=${upsertCtx.cutoff})`)
    return
  }

  // Debug context: surface the exact signals classifyInbound uses so
  // silent-skip cases ('own_outbound', 'empty') are visible.
  const dbgKey = (msg.key ?? {}) as {
    remoteJid?: string
    fromMe?: boolean
    id?: string
  }
  const msgKeys = msg.message
    ? Object.keys(msg.message as Record<string, unknown>).join(',')
    : '<no message>'
  log(
    `upsert msg fromMe=${!!dbgKey.fromMe} remoteJid=${dbgKey.remoteJid ?? '?'} ` +
      `selfJid=${upsertCtx.selfJid ?? '?'} selfLid=${upsertCtx.selfLid ?? '?'} ` +
      `bareRemote=${bareJid(dbgKey.remoteJid) ?? '?'} msgKeys=${msgKeys}`,
  )

  const decision = classifyInbound(msg, {
    selfChatMode: session.selfChatMode,
    responsePrefix: session.responsePrefix,
    selfJid: upsertCtx.selfJid,
    selfLid: upsertCtx.selfLid,
    sentIds: session.sentIds,
  })

  if (decision.action === 'skip' && decision.reason !== 'empty') {
    log(`upsert skip: ${decision.reason}`)
    return
  }

  const attachments = await extractAttachments(session.baileys, msg, log)
  const text = decision.action === 'emit' ? decision.text : ''

  if (decision.action === 'skip' && attachments.length === 0) {
    log('upsert skip: empty')
    return
  }

  const key = msg.key as { remoteJid?: string; id?: string }
  log(
    `upsert emit: channelId=${key.remoteJid} textLen=${text.length} attachments=${attachments.length}`,
  )
  emit({
    type: 'incoming',
    channelId: key.remoteJid!,
    messageId: key.id!,
    senderId: key.remoteJid!,
    senderName: (msg.pushName as string | undefined) ?? undefined,
    text,
    attachments: attachments.length > 0 ? attachments : undefined,
    timestamp: Number(msg.messageTimestamp) * 1000 || Date.now(),
  })
}
