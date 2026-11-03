import { describe, expect, it } from 'bun:test'
import { spawnedSessionOptions, type SpawnParent } from './spawn-options.ts'

const parent: SpawnParent = {
  id: 'parent',
  llmConnection: 'anthropic',
  model: 'claude-opus-5-5',
  enabledSourceSlugs: ['github'],
  thinkingLevel: 'high',
  labels: ['bug'],
  projectId: 'app',
  workingDirectory: '/repos/app-feature',
  codingMode: true,
}

describe('spawnedSessionOptions', () => {
  it('inherits everything the request leaves out, the folder and Coding mode included', () => {
    expect(spawnedSessionOptions({ name: 'child' }, parent)).toEqual({
      name: 'child',
      llmConnection: 'anthropic',
      model: 'claude-opus-5-5',
      enabledSourceSlugs: ['github'],
      thinkingLevel: 'high',
      labels: ['bug'],
      workingDirectory: '/repos/app-feature',
      projectId: 'app',
      codingMode: true,
      parentSessionId: 'parent',
    })
  })

  it('lets the request override what it names', () => {
    const options = spawnedSessionOptions({ model: 'claude-haiku-5-5', enabledSourceSlugs: [], workingDirectory: '/repos/app-other' }, parent)
    expect(options).toMatchObject({ model: 'claude-haiku-5-5', enabledSourceSlugs: [], workingDirectory: '/repos/app-other', projectId: 'app' })
  })

  it("leaves the folder to another project's own setting when the child moves there", () => {
    expect(spawnedSessionOptions({ projectId: 'docs' }, parent)).toMatchObject({ projectId: 'docs', workingDirectory: undefined })
    expect(spawnedSessionOptions({ projectId: 'app' }, parent).workingDirectory).toBe('/repos/app-feature')
    expect(spawnedSessionOptions({ projectId: 'docs', workingDirectory: '/repos/docs' }, parent).workingDirectory).toBe('/repos/docs')
  })

  it('keeps a default-mode parent\'s child out of Coding mode even where the workspace default is on', () => {
    // false (not undefined) so createSession doesn't fall back to the workspace default
    expect(spawnedSessionOptions({}, { ...parent, codingMode: undefined }).codingMode).toBe(false)
    expect(spawnedSessionOptions({}, { ...parent, codingMode: false }).codingMode).toBe(false)
  })
})
