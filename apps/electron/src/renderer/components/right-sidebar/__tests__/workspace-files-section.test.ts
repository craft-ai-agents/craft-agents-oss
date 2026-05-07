import { describe, expect, it } from 'bun:test'
import type { SessionFile } from '../../../../shared/types'
import { loadWorkspaceRootFiles } from '../WorkspaceFilesSection'

describe('WorkspaceFilesSection data loading', () => {
  it('loads the workspace root without a dirPath', async () => {
    const files: SessionFile[] = [
      { name: 'src', path: '/workspace/src', type: 'directory' },
      { name: 'README.md', path: '/workspace/README.md', type: 'file', size: 42 },
    ]
    const calls: Array<[string, string | undefined]> = []

    const result = await loadWorkspaceRootFiles('ws-1', async (workspaceId, dirPath) => {
      calls.push([workspaceId, dirPath])
      return files
    })

    expect(result).toEqual(files)
    expect(calls).toEqual([['ws-1', undefined]])
  })
})
