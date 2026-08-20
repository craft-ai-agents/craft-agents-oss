import type { ComponentEntry } from './types'
import { AllowListPreview } from '../demos/messaging/AllowListPreview'
import { MessagingSettingsPagePreview } from '../demos/messaging/MessagingSettingsPagePreview'
import { MessagingTelegramReworkedPreview } from '../demos/messaging/MessagingTelegramReworkedPreview'
import { PairingCodeDialogPreview } from '../demos/messaging/PairingCodeDialogPreview'
import { WhatsAppConnectDialogPreview } from '../demos/messaging/WhatsAppConnectDialogPreview'
import { MessagingSubmenuPreview } from '../demos/messaging/MessagingSubmenuPreview'

export const messagingComponents: ComponentEntry[] = [
  {
    id: 'messaging-allow-list',
    name: 'Telegram Allow-list (access control)',
    category: 'Messaging',
    description:
      'Workspace owners list, pending requests, per-binding allow-list. Drives the Phase 1 design for restricting bot access.',
    component: AllowListPreview,
    layout: 'full',
    props: [
      {
        name: 'accessMode',
        description:
          'Workspace-level access policy. Public inbox shows the non-executing banner; owner-control enforces the allow-list.',
        control: {
          type: 'select',
          options: [
            { label: 'Public inbox', value: 'public-inbox' },
            { label: 'Owner control · empty list', value: 'owner-control-empty' },
            { label: 'Owner control · with owner', value: 'owner-control-with-owner' },
          ],
        },
        defaultValue: 'owner-control-with-owner',
      },
      {
        name: 'pending',
        description: 'How many recently rejected senders to show.',
        control: {
          type: 'select',
          options: [
            { label: 'None', value: 'none' },
            { label: 'One', value: 'one' },
            { label: 'Three', value: 'three' },
          ],
        },
        defaultValue: 'one',
      },
      {
        name: 'dmBindingAccess',
        description: 'Per-binding access mode for the sample DM binding.',
        control: {
          type: 'select',
          options: [
            { label: 'Public inbox', value: 'public-inbox' },
            { label: 'Owner control', value: 'owner-control' },
            { label: 'Disabled', value: 'disabled' },
          ],
        },
        defaultValue: 'public-inbox',
      },
      {
        name: 'topicBindingAccess',
        description: 'Per-binding access mode for the sample supergroup topic.',
        control: {
          type: 'select',
          options: [
            { label: 'Public inbox', value: 'public-inbox' },
            { label: 'Owner control', value: 'owner-control' },
            { label: 'Disabled', value: 'disabled' },
          ],
        },
        defaultValue: 'public-inbox',
      },
    ],
    variants: [
      {
        name: 'Public inbox + pending requests',
        description:
          'Workspace in public inbox. Banner states messages do not start an agent session; pending list grows as senders try the bot.',
        props: {
          accessMode: 'public-inbox',
          pending: 'three',
          dmBindingAccess: 'public-inbox',
          topicBindingAccess: 'public-inbox',
        },
      },
      {
        name: 'Owner control · with owner · 1 pending',
        description:
          'Default state for a freshly-paired bot: one owner, one pending request to consider.',
        props: {
          accessMode: 'owner-control-with-owner',
          pending: 'one',
          dmBindingAccess: 'owner-control',
          topicBindingAccess: 'owner-control',
        },
      },
      {
        name: 'Owner control · empty list',
        description:
          'Bot is in owner control but no owners are recorded yet (rare — typically right after a manual switch with empty seed).',
        props: {
          accessMode: 'owner-control-empty',
          pending: 'none',
          dmBindingAccess: 'owner-control',
          topicBindingAccess: 'owner-control',
        },
      },
      {
        name: 'Per-binding: owner control + disabled topic',
        description:
          'Owner narrowed the DM binding to owner control, while the supergroup topic is disabled.',
        props: {
          accessMode: 'owner-control-with-owner',
          pending: 'none',
          dmBindingAccess: 'owner-control',
          topicBindingAccess: 'disabled',
        },
      },
    ],
  },
  {
    id: 'messaging-telegram-reworked',
    name: 'Telegram Settings (rework draft)',
    category: 'Messaging',
    description:
      'Prototype: bot header → direct sessions → separator → collapsible supergroup with topics',
    component: MessagingTelegramReworkedPreview,
    layout: 'full',
    props: [
      {
        name: 'telegramConnected',
        description: 'Whether the Telegram bot is connected',
        control: { type: 'boolean' },
        defaultValue: true,
      },
      {
        name: 'supergroupPaired',
        description: 'Whether a supergroup is paired (controls chevron section vs Pair CTA)',
        control: { type: 'boolean' },
        defaultValue: true,
      },
      {
        name: 'directSessions',
        description: 'Direct (DM) session present? — only one direct session can be paired per bot.',
        control: { type: 'number', min: 0, max: 1, step: 1 },
        defaultValue: 1,
      },
      {
        name: 'supergroupTopics',
        description: 'Number of topic-bound bindings under the supergroup (0–3)',
        control: { type: 'number', min: 0, max: 3, step: 1 },
        defaultValue: 2,
      },
    ],
    variants: [
      {
        name: 'Connected · DM + supergroup with topics',
        props: { telegramConnected: true, supergroupPaired: true, directSessions: 1, supergroupTopics: 2 },
      },
      {
        name: 'Connected · DM only (no supergroup)',
        props: { telegramConnected: true, supergroupPaired: false, directSessions: 1, supergroupTopics: 0 },
      },
      {
        name: 'Connected · Supergroup with no topics yet',
        props: { telegramConnected: true, supergroupPaired: true, directSessions: 0, supergroupTopics: 0 },
      },
      {
        name: 'Connected · No bindings, no supergroup',
        props: { telegramConnected: true, supergroupPaired: false, directSessions: 0, supergroupTopics: 0 },
      },
      {
        name: 'Disconnected',
        props: { telegramConnected: false, supergroupPaired: false, directSessions: 0, supergroupTopics: 0 },
      },
    ],
  },
  {
    id: 'messaging-settings-page',
    name: 'Messaging Settings Page',
    category: 'Messaging',
    description: 'Telegram + WhatsApp settings page with inline bindings',
    component: MessagingSettingsPagePreview,
    layout: 'full',
    props: [
      {
        name: 'telegramConnected',
        description: 'Whether the Telegram bot is connected',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'whatsappConnected',
        description: 'Whether the WhatsApp adapter is connected',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'bindings',
        description: 'Bindings preset to show in the table',
        control: {
          type: 'select',
          options: [
            { label: 'None', value: 'none' },
            { label: 'One binding', value: 'one' },
            { label: 'Many bindings', value: 'many' },
          ],
        },
        defaultValue: 'none',
      },
    ],
    variants: [
      {
        name: 'Both disconnected',
        props: { telegramConnected: false, whatsappConnected: false, bindings: 'none' },
      },
      {
        name: 'Telegram only',
        props: { telegramConnected: true, whatsappConnected: false, bindings: 'none' },
      },
      {
        name: 'Both connected, no bindings',
        props: { telegramConnected: true, whatsappConnected: true, bindings: 'none' },
      },
      {
        name: 'Both connected, 3 bindings',
        props: { telegramConnected: true, whatsappConnected: true, bindings: 'many' },
      },
    ],
  },
  {
    id: 'messaging-pairing-code-dialog',
    name: 'Pairing Code Dialog',
    category: 'Messaging',
    description: '6-digit pairing code modal (Telegram + WhatsApp)',
    component: PairingCodeDialogPreview,
    layout: 'centered',
    props: [
      {
        name: 'platform',
        description: 'Messaging platform',
        control: {
          type: 'select',
          options: [
            { label: 'Telegram', value: 'telegram' },
            { label: 'WhatsApp', value: 'whatsapp' },
          ],
        },
        defaultValue: 'telegram',
      },
      {
        name: 'code',
        description: '6-digit pairing code (empty → "generating" state)',
        control: { type: 'string', placeholder: '482193' },
        defaultValue: '482193',
      },
      {
        name: 'expiresInSeconds',
        description: 'Seconds remaining until the code expires (-1 to hide the timer)',
        control: { type: 'number', min: -1, max: 600, step: 1 },
        defaultValue: 300,
      },
      {
        name: 'botUsername',
        description: 'Telegram bot username (enables the "Open bot" link)',
        control: { type: 'string', placeholder: 'my_bot' },
        defaultValue: 'playground_bot',
      },
      {
        name: 'error',
        description: 'Error text to show in place of the code',
        control: { type: 'string', placeholder: '' },
        defaultValue: '',
      },
    ],
    variants: [
      {
        name: 'Telegram with bot link',
        props: {
          platform: 'telegram',
          code: '482193',
          expiresInSeconds: 300,
          botUsername: 'playground_bot',
          error: '',
        },
      },
      {
        name: 'WhatsApp',
        props: {
          platform: 'whatsapp',
          code: '482193',
          expiresInSeconds: 300,
          botUsername: '',
          error: '',
        },
      },
      {
        name: 'Loading (no code)',
        props: {
          platform: 'telegram',
          code: '',
          expiresInSeconds: -1,
          botUsername: '',
          error: '',
        },
      },
      {
        name: 'Error: rate limited',
        props: {
          platform: 'telegram',
          code: '',
          expiresInSeconds: -1,
          botUsername: '',
          error: 'Too many pairing code requests. Please wait a moment and try again.',
        },
      },
      {
        name: 'Expired',
        props: {
          platform: 'telegram',
          code: '482193',
          expiresInSeconds: 0,
          botUsername: 'playground_bot',
          error: '',
        },
      },
    ],
  },
  {
    id: 'messaging-whatsapp-connect-dialog',
    name: 'WhatsApp Connect Dialog',
    category: 'Messaging',
    description: 'Baileys QR pairing modal with phase state machine',
    component: WhatsAppConnectDialogPreview,
    layout: 'centered',
    props: [
      {
        name: 'phase',
        description: 'Internal phase of the connect dialog',
        control: {
          type: 'select',
          options: [
            { label: 'Idle', value: 'idle' },
            { label: 'Starting', value: 'starting' },
            { label: 'Show QR', value: 'show_qr' },
            { label: 'Connected', value: 'connected' },
            { label: 'Error', value: 'error' },
          ],
        },
        defaultValue: 'show_qr',
      },
      {
        name: 'errorMessage',
        description: 'Error text (only used when phase = "error")',
        control: { type: 'string', placeholder: 'Pairing failed: ...' },
        defaultValue: 'Pairing failed: connection timed out',
      },
    ],
    variants: [
      { name: 'Idle', props: { phase: 'idle', errorMessage: '' } },
      { name: 'Starting', props: { phase: 'starting', errorMessage: '' } },
      { name: 'Show QR', props: { phase: 'show_qr', errorMessage: '' } },
      { name: 'Connected', props: { phase: 'connected', errorMessage: '' } },
      {
        name: 'Error',
        props: { phase: 'error', errorMessage: 'Pairing failed: connection timed out' },
      },
    ],
  },
  {
    id: 'messaging-submenu',
    name: 'Messaging Submenu',
    category: 'Messaging',
    description: 'Session menu → Connect Messaging submenu (Telegram / WhatsApp)',
    component: MessagingSubmenuPreview,
    layout: 'top',
    previewOverflow: 'visible',
    props: [
      {
        name: 'telegramConnected',
        description: 'Whether the Telegram bot is connected (changes flow)',
        control: { type: 'boolean' },
        defaultValue: true,
      },
      {
        name: 'whatsappConnected',
        description: 'Whether the WhatsApp adapter is connected (changes flow)',
        control: { type: 'boolean' },
        defaultValue: true,
      },
    ],
    variants: [
      {
        name: 'Both connected',
        props: { telegramConnected: true, whatsappConnected: true },
      },
      {
        name: 'Nothing connected',
        props: { telegramConnected: false, whatsappConnected: false },
      },
      {
        name: 'WhatsApp only',
        props: { telegramConnected: false, whatsappConnected: true },
      },
    ],
  },
]
