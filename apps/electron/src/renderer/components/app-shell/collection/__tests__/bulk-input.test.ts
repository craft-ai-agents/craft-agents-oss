import { describe, expect, it } from 'bun:test'
import { NO_PROJECT_VALUE, projectPatchForBulkValue } from '../bulk-input'

describe('projectPatchForBulkValue', () => {
  it('keeps the placeholder inert while clearing an assigned project explicitly', () => {
    expect(projectPatchForBulkValue('')).toBeNull()
    expect(projectPatchForBulkValue(NO_PROJECT_VALUE)).toEqual({ projectId: null })
  })

  it('maps a selected project id to its bulk patch', () => {
    expect(projectPatchForBulkValue('project-42')).toEqual({ projectId: 'project-42' })
  })
})
