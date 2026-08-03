import { OwnerAgentShell } from '../owner-agent/OwnerAgentShell'
import type { ComponentEntry } from './types'

export const ownerAgentComponents: ComponentEntry[] = [
  {
    id: 'owner-agent-command-shell',
    name: 'Command Shell',
    category: 'Owner Agent',
    description: 'Single-owner command workspace with runtime, scope, run state, navigation, and composer.',
    component: OwnerAgentShell,
    props: [
      {
        name: 'state',
        description: 'Current command execution state',
        control: {
          type: 'select',
          options: [
            { label: 'Loading', value: 'loading' },
            { label: 'Empty', value: 'empty' },
            { label: 'Active', value: 'active' },
            { label: 'Streaming', value: 'streaming' },
            { label: 'Tool running', value: 'tool-running' },
            { label: 'Permission', value: 'permission' },
            { label: 'Error', value: 'error' },
            { label: 'Disconnected', value: 'disconnected' },
          ],
        },
        defaultValue: 'streaming',
      },
      {
        name: 'compact',
        description: 'Collapse context navigation for compact layouts',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    layout: 'full',
    previewOverflow: 'hidden',
  },
]
