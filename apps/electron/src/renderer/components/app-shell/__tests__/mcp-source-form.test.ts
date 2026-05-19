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
    expect(formSource).toContain('value="json"')
    expect(formSource).toContain('Streamable HTTP')
    expect(formSource).toContain('Command')
    expect(formSource).toContain('JSON')
    expect(formSource).toContain('className="grid w-full grid-cols-3"')
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
    expect(sourceMenuSource).toContain('sidebarMenu.editSource')

    // SourcesListPanel: onEditSource prop wired to SourceMenu.onEdit
    expect(sourcesListPanelSource).toContain('onEditSource: (source: LoadedSource) => void')
    expect(sourcesListPanelSource).toContain("onEdit={() => onEditSource(source)}")

    // AppShell: editingSource state and handleEditSource callback
    expect(appShellSource).toContain('editingSource')
    expect(appShellSource).toContain('handleEditSource')
    expect(appShellSource).toContain('onEditSource={handleEditSource}')

    // McpSourceFormDialog: editSource prop, edit mode UI, and pre-fill
    expect(formSource).toContain('editSource?: LoadedSource')
    expect(formSource).toContain('onEditComplete?: () => void')
    expect(formSource).toContain('mcpForm.editTitle')
    expect(formSource).toContain('mcpForm.transportLocked')
    expect(formSource).toContain('mcpForm.credentialConfigured')
    expect(formSource).toContain('updateSource')
    expect(formSource).toContain('common.save')
    expect(formSource).toContain('isEditMode')
    expect(formSource).toContain('setMode(transport === \'stdio\' ? \'stdio\' : \'streamable_http\')')
    expect(formSource).toContain('setName(config.name)')
    expect(formSource).toContain('setProvider(config.provider ?? \'\')')
    expect(formSource).toContain('setUrl(mcp.url ?? \'\')')
    expect(formSource).toContain('setCommand(mcp.command ?? \'\')')
    expect(formSource).toContain('setArgsText(mcp.args ? mcp.args.join(\'\\n\') : \'\')')
    expect(formSource).toContain('setEnvText(objectToLines(mcp.env))')
    expect(formSource).toContain('serializeAuthCredentialForUpdate(authCredential)')
  })

  test('MCP dialog select menus render inside the dialog portal so options remain clickable', () => {
    const formSource = readFileSync(join(import.meta.dir, '../McpSourceFormDialog.tsx'), 'utf-8')

    expect(formSource).toContain('SelectContent as BaseSelectContent')
    expect(formSource).toContain('setSelectPortalContainer')
    expect(formSource).toContain('<McpSelectPortalContext.Provider value={selectPortalContainer}>')
    expect(formSource).toContain('<BaseSelectContent container={container} {...props} />')
    expect(formSource).not.toContain('<SelectContent>')
  })

  test('API key auth type persists header metadata when saving MCP edits', () => {
    const formSource = readFileSync(join(import.meta.dir, '../McpSourceFormDialog.tsx'), 'utf-8')

    expect(formSource).toContain('apiKeyHeader,')
    expect(formSource).toContain("headerNames: values.authType === 'api-key' && values.apiKeyHeader.trim() ? [values.apiKeyHeader.trim()] : undefined")
    expect(formSource).toContain("return JSON.stringify({ [authCredential.headerName]: authCredential.value })")
  })
})
