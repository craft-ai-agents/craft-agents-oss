export interface MockAgent {
  id: string
  name: string
  path: string // folder/name format, e.g., "work/coder"
  description?: string
}

export const mockAgents: MockAgent[] = [
  { id: 'writer', name: 'Writer', path: 'writer', description: 'Content writing assistant' },
  { id: 'coder', name: 'Coder', path: 'work/coder', description: 'Code generation and review' },
  { id: 'reviewer', name: 'Reviewer', path: 'work/reviewer', description: 'Code review specialist' },
  { id: 'debugger', name: 'Debugger', path: 'work/debugger', description: 'Bug finder and fixer' },
  { id: 'storyteller', name: 'Storyteller', path: 'personal/creative/storyteller', description: 'Creative writing' },
  { id: 'poet', name: 'Poet', path: 'personal/creative/poet', description: 'Poetry generator' },
  { id: 'researcher', name: 'Researcher', path: 'personal/researcher', description: 'Research assistant' },
]

export interface AgentTreeNode {
  type: 'folder' | 'agent'
  name: string
  // For folders
  children?: AgentTreeNode[]
  // For agents
  agent?: MockAgent
}

/**
 * Build a tree structure from flat agent list based on path
 */
export function buildAgentTree(agents: MockAgent[]): AgentTreeNode[] {
  const root: AgentTreeNode[] = []

  for (const agent of agents) {
    const parts = agent.path.split('/')
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1

      if (isLast) {
        // This is the agent itself
        current.push({
          type: 'agent',
          name: agent.name,
          agent
        })
      } else {
        // This is a folder
        let folder = current.find(
          (node) => node.type === 'folder' && node.name === part
        )
        if (!folder) {
          folder = {
            type: 'folder',
            name: part,
            children: []
          }
          current.push(folder)
        }
        current = folder.children!
      }
    }
  }

  // Sort: folders first, then agents, alphabetically within each group
  const sortNodes = (nodes: AgentTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
    for (const node of nodes) {
      if (node.children) {
        sortNodes(node.children)
      }
    }
  }
  sortNodes(root)

  return root
}
