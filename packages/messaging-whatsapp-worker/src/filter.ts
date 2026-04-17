/**
 * Pure filter helpers used by the WA worker's `messages.upsert` handler.
 *
 * Extracted from `worker.ts` so the classification logic can be unit
 * tested without importing the worker entry (which installs stdin and
 * signal handlers on module load).
 */

/**
 * Normalize a Baileys JID so `sock.user.id` (which may carry a device
 * suffix like `num:10@s.whatsapp.net`) compares equal to the plain
 * `num@s.whatsapp.net` form used in `key.remoteJid` for the self-chat.
 */
export function bareJid(jid: string | undefined | null): string | null {
  if (!jid) return null
  const at = jid.indexOf('@')
  if (at === -1) return jid
  const localPart = jid.slice(0, at)
  const colon = localPart.indexOf(':')
  if (colon === -1) return jid
  return localPart.slice(0, colon) + jid.slice(at)
}

/**
 * Extract the visible text from a Baileys message. Covers the subset of
 * content types we care about: plain conversation, extended text,
 * captions on image/doc/video.
 */
export function extractText(msg: Record<string, unknown>): string {
  const m = msg.message as Record<string, unknown> | undefined
  if (!m) return ''
  const conv = m.conversation as string | undefined
  if (conv) return conv
  const ext = m.extendedTextMessage as Record<string, unknown> | undefined
  if (typeof ext?.text === 'string') return ext.text as string
  const img = m.imageMessage as Record<string, unknown> | undefined
  if (typeof img?.caption === 'string') return img.caption as string
  const doc = m.documentMessage as Record<string, unknown> | undefined
  if (typeof doc?.caption === 'string') return doc.caption as string
  const vid = m.videoMessage as Record<string, unknown> | undefined
  if (typeof vid?.caption === 'string') return vid.caption as string
  return ''
}

export interface ClassifyContext {
  selfChatMode: boolean
  responsePrefix: string
  /** Bare phone-number JID of the account (no device suffix), e.g. `num@s.whatsapp.net`. */
  selfJid: string | null
  /**
   * Bare LID form of the account (no device suffix), e.g. `lid@lid`.
   * WhatsApp's newer clients may deliver the self-chat `key.remoteJid`
   * in LID form even when `sock.user.id` is still the phone-number JID,
   * so the self-chat check must accept either.
   */
  selfLid: string | null
  sentIds: Set<string>
}

export type InboundDecision =
  | { action: 'emit'; text: string }
  | {
      action: 'skip'
      reason: 'malformed' | 'own_echo_id' | 'own_echo_prefix' | 'own_outbound' | 'empty'
    }

/**
 * Decide what to do with a single upsert message.
 *
 * Precedence for `fromMe=true`:
 *   1. id in sentIds         → skip (our own echo, primary defence)
 *   2. not self-chat          → skip (user's outbound in normal chats)
 *   3. prefix match           → skip (echo backup defence)
 *   4. empty                  → skip
 *   5. otherwise              → emit (phone/desktop typing in self-chat)
 *
 * For `fromMe=false`: empty → skip, otherwise emit.
 */
export function classifyInbound(
  msg: Record<string, unknown>,
  ctx: ClassifyContext,
): InboundDecision {
  const key = msg.key as { remoteJid?: string; fromMe?: boolean; id?: string } | undefined
  if (!key || !key.remoteJid || !key.id) return { action: 'skip', reason: 'malformed' }

  const text = extractText(msg)

  if (key.fromMe) {
    if (ctx.sentIds.has(key.id)) return { action: 'skip', reason: 'own_echo_id' }

    const bareRemote = bareJid(key.remoteJid)
    const isSelfChat =
      ctx.selfChatMode &&
      bareRemote !== null &&
      ((ctx.selfJid !== null && bareRemote === ctx.selfJid) ||
        (ctx.selfLid !== null && bareRemote === ctx.selfLid))
    if (!isSelfChat) return { action: 'skip', reason: 'own_outbound' }

    if (ctx.responsePrefix && text.startsWith(ctx.responsePrefix)) {
      return { action: 'skip', reason: 'own_echo_prefix' }
    }

    if (!text) return { action: 'skip', reason: 'empty' }
    return { action: 'emit', text }
  }

  if (!text) return { action: 'skip', reason: 'empty' }
  return { action: 'emit', text }
}

/** Cap the sent-ID set so long-running sessions don't leak memory. */
export const MAX_SENT_IDS = 500

/**
 * Insert `id` into the bounded sent-ID set. `Set` preserves insertion order
 * so the oldest entry is `values().next().value` — evict it when we
 * overflow.
 */
export function rememberSentId(sentIds: Set<string>, id: string): void {
  sentIds.add(id)
  if (sentIds.size > MAX_SENT_IDS) {
    const oldest = sentIds.values().next().value
    if (oldest !== undefined) sentIds.delete(oldest)
  }
}
