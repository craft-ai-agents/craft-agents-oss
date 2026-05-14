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

    expect(formSource).toContain('<TabsTrigger value="http">HTTP</TabsTrigger>')
    expect(formSource).toContain('<TabsTrigger value="sse">SSE</TabsTrigger>')
    expect(formSource).toContain('<TabsTrigger value="stdio">Command</TabsTrigger>')
    expect(formSource).toContain('args: parseListLines(argsText)')
    expect(formSource).not.toContain('.split(\' \')')
    expect(formSource).not.toContain('.split(" ")')
    expect(formSource).toContain('authCredential')
  })
})
