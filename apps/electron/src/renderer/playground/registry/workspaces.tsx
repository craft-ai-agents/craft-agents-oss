import type { ComponentEntry } from './types'
import { RemoveWorkspaceDialog } from '@/components/workspace/RemoveWorkspaceDialog'
import { WorkspaceSwitcher } from '@/components/app-shell/WorkspaceSwitcher'
import type { Workspace } from '../../../shared/types'

const localWorkspace: Workspace = {
  id: 'ws-research',
  name: 'Research',
  slug: 'research',
  rootPath: '/Users/you/.craft-agent/workspaces/research',
  createdAt: 0,
}

const remoteWorkspace: Workspace = {
  ...localWorkspace,
  id: 'ws-team',
  name: 'Team server',
  slug: 'team',
  rootPath: '/Users/you/.craft-agent/workspaces/team',
  remoteServer: { url: 'wss://agents.example.com:9100', token: 'playground', remoteWorkspaceId: 'w1' },
}

const noop = () => console.log('[Playground] RemoveWorkspaceDialog closed')

export const workspaceComponents: ComponentEntry[] = [
  {
    id: 'remove-workspace-dialog',
    name: 'RemoveWorkspaceDialog',
    category: 'Settings',
    description: 'Confirmation before the workspace switcher removes a workspace (folder and sessions stay)',
    component: RemoveWorkspaceDialog,
    props: [],
    mockData: () => ({ workspace: localWorkspace, onClose: noop }),
    variants: [
      { name: 'Local folder', props: { workspace: localWorkspace } },
      {
        name: 'Long path',
        props: {
          workspace: {
            ...localWorkspace,
            name: 'Quarterly planning and research notes for the platform team',
            rootPath: '/Users/you/Library/Mobile Documents/com~apple~CloudDocs/Work/Craft Agents/workspaces/quarterly-planning-research',
          },
        },
      },
      { name: 'Remote server', props: { workspace: remoteWorkspace } },
    ],
  },
  {
    id: 'workspace-switcher-remove',
    name: 'WorkspaceSwitcher · remove',
    category: 'Settings',
    description: 'Hover a workspace that is not active and click the trash icon: the menu closes and RemoveWorkspaceDialog asks',
    component: WorkspaceSwitcher,
    props: [],
    mockData: () => ({
      variant: 'topbar',
      workspaces: [{ ...localWorkspace, id: 'ws-active', name: 'My Workspace', slug: 'my-workspace' }, localWorkspace, remoteWorkspace],
      activeWorkspaceId: 'ws-active',
      onSelect: (id: string) => console.log('[Playground] select workspace', id),
      onWorkspaceRemoved: () => console.log('[Playground] workspace removed'),
    }),
  },
]
