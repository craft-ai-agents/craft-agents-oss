import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const editorPath = join(__dirname, '../AutomationGraphWorkspaceEditor.tsx')
const mainContentPath = join(__dirname, '../../app-shell/MainContentPanel.tsx')
const infoPagePath = join(__dirname, '../AutomationInfoPage.tsx')
const channelMapPath = join(__dirname, '../../../../transport/channel-map.ts')
const electronApiTypesPath = join(__dirname, '../../../../shared/types.ts')

describe('Automation graph workspace presentation', () => {
  const editor = readFileSync(editorPath, 'utf8')
  const mainContent = readFileSync(mainContentPath, 'utf8')
  const infoPage = readFileSync(infoPagePath, 'utf8')
  const channelMap = readFileSync(channelMapPath, 'utf8')
  const electronApiTypes = readFileSync(electronApiTypesPath, 'utf8')

  it('loads a workspace graph and persists through the revision-protected graph RPC', () => {
    expect(editor).toContain('window.electronAPI.getAutomationGraph(workspaceId)')
    expect(editor).toContain('baseRevision: projection.revision')
    expect(editor).toContain('window.electronAPI.saveAutomationGraph({')
    expect(editor).toContain('window.electronAPI.onAutomationsChanged')
    expect(channelMap).toContain('saveAutomationGraph: invoke(RPC_CHANNELS.automations.SAVE_GRAPH)')
    expect(electronApiTypes).toContain('saveAutomationGraph(payload: SaveAutomationGraphPayload)')
  })

  it('keeps the editable graph reachable from both automation navigation states', () => {
    const automationNavigation = mainContent.slice(
      mainContent.indexOf('if (isAutomationsNavigation(navState))'),
      mainContent.indexOf('// Projects navigator'),
    )

    expect(automationNavigation).toContain('<AutomationGraphWorkspaceEditor')
    expect(automationNavigation).toContain('workspaceId={activeWorkspaceId}')
    expect(infoPage).toContain('<AutomationGraphWorkspaceEditor')
    expect(infoPage).toContain('workspaceId={workspace?.id}')
  })
})
