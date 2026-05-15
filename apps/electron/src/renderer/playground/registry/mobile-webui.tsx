import type { ComponentEntry } from './types'
import { AppMenuMobilePreview } from '../demos/mobile-webui/AppMenuMobilePreview'
import { SessionListMobilePreview } from '../demos/mobile-webui/SessionListMobilePreview'
import { ChatDisplayMobilePreview } from '../demos/mobile-webui/ChatDisplayMobilePreview'

const DEVICE_OPTIONS = [
  { label: 'iPhone 15 (390×844)', value: 'iphone-15' },
  { label: 'iPhone SE (375×667)', value: 'iphone-se' },
  { label: 'Pixel 8 (412×915)', value: 'pixel-8' },
]

export const mobileWebUIComponents: ComponentEntry[] = [
  {
    id: 'mobile-webui-app-menu',
    name: 'AppMenu (Mobile)',
    category: 'Mobile WebUI',
    description: 'TopBar Craft-logo dropdown rendered in compact mode — Settings/Help submenus flatten.',
    component: AppMenuMobilePreview,
    layout: 'top',
    previewOverflow: 'visible',
    props: [
      {
        name: 'device',
        description: 'Phone preset for the frame.',
        control: { type: 'select', options: DEVICE_OPTIONS },
        defaultValue: 'iphone-15',
      },
      {
        name: 'showBezel',
        description: 'Show the iPhone-style bezel + status bar.',
        control: { type: 'boolean' },
        defaultValue: true,
      },
    ],
    variants: [
      { name: 'iPhone 15 (default)', props: { device: 'iphone-15', showBezel: true } },
      { name: 'iPhone SE (small)', props: { device: 'iphone-se', showBezel: true } },
      { name: 'No bezel', props: { device: 'iphone-15', showBezel: false } },
    ],
    mockData: () => ({}),
  },
  {
    id: 'mobile-webui-session-list',
    name: 'SessionList (Mobile)',
    category: 'Mobile WebUI',
    description: 'Production SessionList in compact mode with mock sessions across grouping modes.',
    component: SessionListMobilePreview,
    layout: 'top',
    previewOverflow: 'visible',
    props: [
      {
        name: 'device',
        description: 'Phone preset for the frame.',
        control: { type: 'select', options: DEVICE_OPTIONS },
        defaultValue: 'iphone-15',
      },
      {
        name: 'showBezel',
        description: 'Show the iPhone-style bezel + status bar.',
        control: { type: 'boolean' },
        defaultValue: true,
      },
      {
        name: 'groupingMode',
        description: 'How sessions are grouped.',
        control: {
          type: 'select',
          options: [
            { label: 'Date', value: 'date' },
            { label: 'Status', value: 'status' },
            { label: 'Unread', value: 'unread' },
          ],
        },
        defaultValue: 'date',
      },
      {
        name: 'searchActive',
        description: 'Activate the search header.',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'searchQuery',
        description: 'Search query text.',
        control: { type: 'string', placeholder: 'Search...' },
        defaultValue: '',
      },
      {
        name: 'empty',
        description: 'Render an empty list to exercise the empty state.',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    variants: [
      { name: 'Date grouping', props: { groupingMode: 'date' } },
      { name: 'Status grouping', props: { groupingMode: 'status' } },
      { name: 'Unread grouping', props: { groupingMode: 'unread' } },
      { name: 'Search — partial match', props: { searchActive: true, searchQuery: 'mobile' } },
      { name: 'Empty list', props: { empty: true } },
    ],
    mockData: () => ({}),
  },
  {
    id: 'mobile-webui-chat-display',
    name: 'ChatDisplay (Mobile)',
    category: 'Mobile WebUI',
    description: 'Production ChatDisplay in compact mode with hydrated mock conversation.',
    component: ChatDisplayMobilePreview,
    layout: 'top',
    previewOverflow: 'visible',
    props: [
      {
        name: 'device',
        description: 'Phone preset for the frame.',
        control: { type: 'select', options: DEVICE_OPTIONS },
        defaultValue: 'iphone-15',
      },
      {
        name: 'showBezel',
        description: 'Show the iPhone-style bezel + status bar.',
        control: { type: 'boolean' },
        defaultValue: true,
      },
      {
        name: 'messageCount',
        description: 'How many messages to render.',
        control: {
          type: 'select',
          options: [
            { label: '1 (single user message)', value: '1' },
            { label: '5 (multi-turn thread)', value: '5' },
            { label: '20 (long, scroll test)', value: '20' },
          ],
        },
        defaultValue: '5',
      },
      {
        name: 'streaming',
        description: 'Show the last assistant turn as still streaming.',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'permissionMode',
        description: 'Permission mode for the inline badge.',
        control: {
          type: 'select',
          options: [
            { label: 'Explore', value: 'safe' },
            { label: 'Ask', value: 'ask' },
            { label: 'Execute', value: 'allow-all' },
          ],
        },
        defaultValue: 'ask',
      },
    ],
    variants: [
      { name: 'Single user message', props: { messageCount: '1', streaming: false } },
      { name: 'Multi-turn with code', props: { messageCount: '5', streaming: false } },
      { name: 'Streaming reply', props: { messageCount: '5', streaming: true } },
      { name: 'Long thread (scroll)', props: { messageCount: '20', streaming: false } },
      { name: 'Explore mode', props: { messageCount: '5', permissionMode: 'safe' } },
    ],
    mockData: () => ({}),
  },
]
