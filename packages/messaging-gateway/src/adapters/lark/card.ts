/**
 * Lark interactive card builder + error helpers.
 *
 * Lark "interactive" message type is a JSON card with a fixed schema. We use
 * schema 2.0, which supports rich elements (`div`, `action`, `markdown`, etc.).
 * Phase 2 only emits a minimal subset: a single text body element plus an
 * action row of buttons. Each button's `value` carries our correlation IDs
 * so the gateway can route the press back to the right session.
 *
 * Limits enforced here:
 *   - Up to 10 buttons per card (matching Telegram's cap)
 *   - Button labels truncated to 30 chars (Lark's display threshold)
 */

import type { InlineButton } from '../../types'

const MAX_BUTTONS = 10
const MAX_LABEL_LENGTH = 30

/**
 * Lark schema 2.0 envelope. Two shape changes vs the legacy 1.0 cards:
 *  - elements live under `body`, not at the top level (rejected with code
 *    200621 — "unknown property, property: elements").
 *  - the `tag: 'action'` wrapper around buttons is gone; buttons are direct
 *    `body.elements` children (rejected with code 200861 — "unsupported
 *    tag action; cards of schema V2 no longer support this capability").
 *  - button click payloads use `behaviors: [{ type: 'callback', value }]`
 *    instead of the bare `value` field schema 1.0 used.
 */
export interface LarkCardSchema {
  schema: '2.0'
  config: { wide_screen_mode: boolean }
  body: {
    direction?: 'vertical' | 'horizontal'
    elements: Array<
      | { tag: 'div'; text: { tag: 'plain_text'; content: string } }
      | {
          tag: 'button'
          text: { tag: 'plain_text'; content: string }
          type: 'primary' | 'default'
          behaviors: Array<{
            type: 'callback'
            value: { buttonId: string; messageId: string; data?: string }
          }>
        }
    >
  }
}

export interface BuildCardOptions {
  /** Identifier used in the button's `value.messageId` so we can correlate presses back. */
  messageId: string
}

export function buildLarkCard(
  text: string,
  buttons: InlineButton[],
  opts: BuildCardOptions,
): LarkCardSchema {
  const capped = buttons.slice(0, MAX_BUTTONS)

  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    body: {
      elements: [
        { tag: 'div', text: { tag: 'plain_text', content: text } },
        // Schema 2.0: buttons sit directly inside `body.elements` (no `action`
        // wrapper) and the click payload moves into `behaviors[].value`.
        ...capped.map((btn, idx) => ({
          tag: 'button' as const,
          text: { tag: 'plain_text' as const, content: truncateLabel(btn.label) },
          // First button is "primary" (visually emphasised) — matches Telegram's first-button-styled convention.
          type: idx === 0 ? ('primary' as const) : ('default' as const),
          behaviors: [
            {
              type: 'callback' as const,
              value: {
                buttonId: btn.id,
                messageId: opts.messageId,
                ...(btn.data !== undefined ? { data: btn.data } : {}),
              },
            },
          ],
        })),
      ],
    },
  }
}

function truncateLabel(label: string): string {
  if (label.length <= MAX_LABEL_LENGTH) return label
  return label.slice(0, MAX_LABEL_LENGTH - 1) + '…'
}

/**
 * A "remove buttons" patch — used by `clearButtons` after a press is processed.
 * Drops the `action` element, keeping the original text body.
 */
export function buildClearedCard(text: string): LarkCardSchema {
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    body: {
      elements: [{ tag: 'div', text: { tag: 'plain_text', content: text } }],
    },
  }
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/**
 * Lark returns a structured error when an `update`/`patch` call exceeds the
 * editable time window (currently 24h for bots) or when the message can't
 * otherwise be edited (deleted, type-mismatched, etc.).
 *
 * The grammY-style HttpError shape isn't applicable here; the SDK throws an
 * Error with a `code` property attached. We match on the code values rather
 * than message strings to avoid breaking on i18n changes from Lark.
 */
const LARK_EDIT_EXPIRED_CODES = new Set<number>([
  230003, // common: "message can't be edited"
  234001, // im specific: editable time exceeded
])

export function isLarkEditExpiredError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  if (typeof code === 'number' && LARK_EDIT_EXPIRED_CODES.has(code)) return true
  // Fallback: SDK sometimes wraps under `response.code`
  const respCode = (err as { response?: { code?: unknown } }).response?.code
  if (typeof respCode === 'number' && LARK_EDIT_EXPIRED_CODES.has(respCode)) return true
  return false
}

/** Cap exposed for tests + adapter-side logging when a card has too many buttons. */
export const LARK_MAX_BUTTONS = MAX_BUTTONS
export const LARK_MAX_LABEL_LENGTH = MAX_LABEL_LENGTH
