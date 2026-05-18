import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'

describe('MCP source form flow wiring', () => {
  test('routes MCP Add Source entry points to the form dialog', () => {
    const appShellSource = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf-8')
    const sourcesListPanelSource = readFileSync(join(import.meta.dir, '../SourcesListPanel.tsx'), 'utf-8')

    expect(appShellSource).toContain('sourceFilter.sourceType === \'mcp\'')
    expect(appShellSource).toContain('<McpSourceFormDialog')
    expect(sourcesListPanelSource).toContain('sourceFilter.sourceType === \'mcp\'')
    expect(sourcesListPanelSource).toContain('<McpSourceFormDialog')
  })

  test('form submits transport-specific MCP payloads without shell-splitting args', () => {
    const formSource = readFileSync(join(import.meta.dir, '../McpSourceFormDialog.tsx'), 'utf-8')

    expect(formSource).toContain('value="streamable_http"')
    expect(formSource).toContain('value="stdio"')
    expect(formSource).toContain('Streamable HTTP')
    expect(formSource).toContain('Command')
    expect(formSource).toContain('args: parseListLines(values.argsText)')
    expect(formSource).not.toContain('.split(\' \')')
    expect(formSource).not.toContain('.split(" ")')
    expect(formSource).toContain('authCredential')
  })

  test('JSON tab previews parsed import candidates before batch creation', () => {
    const formSource = readFileSync(join(import.meta.dir, '../McpSourceFormDialog.tsx'), 'utf-8')
    const apiTypesSource = readFileSync(join(import.meta.dir, '../../../../shared/types.ts'), 'utf-8')

    expect(formSource).toContain('value="json"')
    expect(formSource).toContain('JSON')
    expect(formSource).toContain('parseMcpJsonImport')
    expect(formSource).toContain('importMcpJsonCandidates')
    expect(formSource).toContain('selectedCandidateKeys')
    expect(formSource).toContain('fieldErrors')
    expect(formSource).toContain('Replace existing source')
    expect(formSource).toContain('Secret handling')
    expect(formSource).toContain('mcpForm.importSelected')
    expect(apiTypesSource).toContain('parseMcpJsonImport(workspaceId: string, json: string)')
    expect(apiTypesSource).toContain('importMcpJsonCandidates(workspaceId: string')
  })

  test('edit mode wires SourceMenu Edit item to form pre-fill', () => {
    const sourceMenuSource = readFileSync(join(import.meta.dir, '../SourceMenu.tsx'), 'utf-8')
    const sourcesListPanelSource = readFileSync(join(import.meta.dir, '../SourcesListPanel.tsx'), 'utf-8')
    const appShellSource = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf-8')
    const formSource = readFileSync(join(import.meta.dir, '../McpSourceFormDialog.tsx'), 'utf-8')

    // SourceMenu: Edit item with pencil icon
    expect(sourceMenuSource).toContain('onEdit?: () => void')
    expect(sourceMenuSource).toContain('Pencil')
    expect(sourceMenuSource).toContain('common.edit')

    // SourcesListPanel: onEditSource prop wired to SourceMenu.onEdit
    expect(sourcesListPanelSource).toContain('onEditSource: (source: LoadedSource) => void')
    expect(sourcesListPanelSource).toContain("onEdit={() => onEditSource(source)}")

    // AppShell: editingSource state and handleEditSource callback
    expect(appShellSource).toContain('editingSource')
    expect(appShellSource).toContain('handleEditSource')
    expect(appShellSource).toContain('onEditSource={handleEditSource}')

    // McpSourceFormDialog: editSource prop and edit mode UI
    expect(formSource).toContain('editSource?: LoadedSource')
    expect(formSource).toContain('onEditComplete?: () => void')
    expect(formSource).toContain('mcpForm.editTitle')
    expect(formSource).toContain('updateSource')
    expect(formSource).toContain('common.save')
    expect(formSource).toContain('isEditMode')
  })
})
