/**
 * Starter templates for external-input triggers.
 *
 * Each template is a fully-formed AutomationsConfigMatcher object ready to be
 * appended to automations.json under its `event` key. The server-side
 * createFromTemplate handler will assign a unique ID and (for WebhookReceive)
 * de-dupe slugs.
 *
 * Templates are intentionally minimal — just enough to fire correctly and
 * showcase a useful pattern. Users tweak the prompt and config from there.
 */

import type { AppEvent } from './types'

export interface AutomationTemplate {
  /** Stable unique ID for the template (used as React key). */
  id: string
  /** Display category for grouping in the picker UI. */
  category: 'webhook' | 'file' | 'poll' | 'message'
  /** Short headline shown on the card. */
  title: string
  /** One-sentence summary shown under the title. */
  description: string
  /** Optional emoji/glyph hint shown next to the title. */
  glyph?: string
  /** Event key under which the matcher will be inserted. */
  event: AppEvent
  /** Pre-filled matcher body. The server adds an `id` automatically. */
  matcher: Record<string, unknown>
  /**
   * Optional setup hint shown after creation — e.g. "set CRAFT_WH_X in your shell"
   * or "configure your GitHub webhook to point at this URL".
   */
  setupHint?: string
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  // ----- WebhookReceive -----
  {
    id: 'wh-github-push',
    category: 'webhook',
    title: 'GitHub push event',
    description: 'Summarize commits whenever GitHub posts a push webhook.',
    glyph: '🔔',
    event: 'WebhookReceive',
    matcher: {
      name: 'GitHub push',
      slug: 'github-push',
      secretEnv: 'CRAFT_WH_GITHUB_SECRET',
      allowedMethods: ['POST'],
      actions: [
        {
          type: 'prompt',
          prompt: 'A GitHub push event arrived. Summarize the commits and flag anything risky. Payload: $CRAFT_EVENT_DATA',
        },
      ],
    },
    setupHint: 'Set CRAFT_WH_GITHUB_SECRET in your shell, then point your GitHub webhook at the URL shown on this page.',
  },
  {
    id: 'wh-stripe-events',
    category: 'webhook',
    title: 'Stripe events',
    description: 'Triage Stripe webhook events (payments, disputes, subscription changes).',
    glyph: '💳',
    event: 'WebhookReceive',
    matcher: {
      name: 'Stripe events',
      slug: 'stripe-events',
      secretEnv: 'CRAFT_WH_STRIPE_SECRET',
      allowedMethods: ['POST'],
      actions: [
        {
          type: 'prompt',
          prompt: 'Stripe webhook event received. Type: $CRAFT_HEADER_STRIPE_EVENT. Triage and summarize the impact. Full payload: $CRAFT_EVENT_DATA',
        },
      ],
    },
    setupHint: 'Set CRAFT_WH_STRIPE_SECRET to your Stripe webhook signing secret.',
  },
  {
    id: 'wh-zapier-generic',
    category: 'webhook',
    title: 'Zapier / general',
    description: 'A generic inbound endpoint for Zapier, Make, IFTTT, or any custom service.',
    glyph: '🔗',
    event: 'WebhookReceive',
    matcher: {
      name: 'Zapier inbound',
      slug: 'zapier',
      allowedMethods: ['POST', 'GET'],
      actions: [
        {
          type: 'prompt',
          prompt: 'Inbound webhook from external service. Headers: $CRAFT_HEADERS. Body: $CRAFT_BODY. Summarize and act.',
        },
      ],
    },
    setupHint: 'No HMAC required for prototyping — add secretEnv before going to production.',
  },

  // ----- FileWatch -----
  {
    id: 'fw-screenshots',
    category: 'file',
    title: 'New screenshot → describe',
    description: 'Trigger an agent every time you save a screenshot.',
    glyph: '📸',
    event: 'FileWatch',
    matcher: {
      name: 'Screenshot describer',
      watchPath: '~/Desktop',
      watchGlob: 'Screenshot*.png',
      watchChangeTypes: ['add'],
      actions: [
        {
          type: 'prompt',
          prompt: 'A new screenshot was saved at $CRAFT_PATH. Describe what it shows in 2-3 sentences.',
        },
      ],
    },
    setupHint: 'Edit watchPath if you save screenshots somewhere else.',
  },
  {
    id: 'fw-inbox-pdf',
    category: 'file',
    title: 'New PDF in Inbox → summarize',
    description: 'When a PDF lands in a folder, an agent reads and summarizes it.',
    glyph: '📥',
    event: 'FileWatch',
    matcher: {
      name: 'PDF inbox',
      watchPath: '~/Inbox',
      watchGlob: '**/*.pdf',
      watchChangeTypes: ['add'],
      actions: [
        {
          type: 'prompt',
          prompt: 'A new PDF arrived: $CRAFT_PATH. Summarize the key points and propose a next action.',
        },
      ],
    },
  },
  {
    id: 'fw-markdown-changes',
    category: 'file',
    title: 'Markdown notes changed',
    description: 'Detect edits to your notes folder and offer a quick reflection.',
    glyph: '📝',
    event: 'FileWatch',
    matcher: {
      name: 'Notes change watcher',
      watchPath: '~/Notes',
      watchGlob: '**/*.md',
      watchChangeTypes: ['change', 'add'],
      watchDebounceMs: 1500,
      actions: [
        {
          type: 'prompt',
          prompt: 'You updated $CRAFT_RELATIVE_PATH. Read the change and offer a one-sentence reflection or follow-up question.',
        },
      ],
    },
  },

  // ----- PollUrl -----
  {
    id: 'poll-status-page',
    category: 'poll',
    title: 'Service status check',
    description: 'Watch an HTTP status endpoint; alert when it goes 5xx or recovers.',
    glyph: '🚦',
    event: 'PollUrl',
    matcher: {
      name: 'Status check',
      pollUrl: 'https://api.example.com/health',
      pollIntervalSec: 60,
      pollFingerprint: 'status',
      actions: [
        {
          type: 'prompt',
          prompt: 'Endpoint $CRAFT_URL changed status: was $CRAFT_PREVIOUS_FINGERPRINT, now $CRAFT_FINGERPRINT. Investigate.',
        },
      ],
    },
    setupHint: 'Replace the example URL with your own health endpoint.',
  },
  {
    id: 'poll-rss-feed',
    category: 'poll',
    title: 'RSS / feed watch',
    description: 'Poll a feed; fire when the body changes (new items published).',
    glyph: '📰',
    event: 'PollUrl',
    matcher: {
      name: 'Feed watcher',
      pollUrl: 'https://example.com/feed.xml',
      pollIntervalSec: 600,
      pollFingerprint: 'body',
      actions: [
        {
          type: 'prompt',
          prompt: 'The feed at $CRAFT_URL just updated. New body: $CRAFT_BODY. Summarize the new items.',
        },
      ],
    },
  },
  // ----- MessageReceive -----
  {
    id: 'msg-triage',
    category: 'message',
    title: 'Inbound chat → triage',
    description: 'Every message arriving on a connected chat platform spawns a triage agent.',
    glyph: '💬',
    event: 'MessageReceive',
    matcher: {
      name: 'Chat triage',
      conditions: [
        // Only fire on un-bound channels — bound channels already route into
        // an existing session, so firing here would double-handle.
        { condition: 'state', field: 'bound', value: false },
      ],
      actions: [
        {
          type: 'prompt',
          prompt: 'New chat message from $CRAFT_SENDER_NAME on $CRAFT_PLATFORM:\n\n$CRAFT_TEXT\n\nTriage this and respond.',
        },
      ],
    },
    setupHint: 'Connect a Telegram or WhatsApp adapter in Settings → Messaging first.',
  },
  {
    id: 'msg-slash-triage',
    category: 'message',
    title: 'Slash command — /triage',
    description: 'A /triage command from any chat fires this — works alongside binding.',
    glyph: '🛎️',
    event: 'MessageReceive',
    matcher: {
      name: 'Triage command',
      matcher: '^/triage(\\s|$)',
      actions: [
        {
          type: 'prompt',
          prompt: 'A /triage command came in from $CRAFT_SENDER_NAME (chat $CRAFT_CHANNEL_ID): $CRAFT_TEXT',
        },
      ],
    },
  },
  {
    id: 'poll-etag-doc',
    category: 'poll',
    title: 'Document changed (ETag)',
    description: 'Cheap polling using ETag — only triggers when the resource truly changes.',
    glyph: '🏷️',
    event: 'PollUrl',
    matcher: {
      name: 'Doc change watcher',
      pollUrl: 'https://example.com/doc.json',
      pollIntervalSec: 300,
      pollFingerprint: 'etag',
      actions: [
        {
          type: 'prompt',
          prompt: 'Document $CRAFT_URL ETag changed (was $CRAFT_PREVIOUS_FINGERPRINT, now $CRAFT_FINGERPRINT). Re-fetch and summarize.',
        },
      ],
    },
  },
]

export const TEMPLATE_CATEGORY_LABELS: Record<AutomationTemplate['category'], string> = {
  webhook: 'Inbound Webhooks',
  file: 'File Watchers',
  poll: 'URL Polling',
  message: 'Chat Messages',
}
