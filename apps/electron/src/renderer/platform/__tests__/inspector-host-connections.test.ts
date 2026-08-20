import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const host = readFileSync(join(__dirname, '../InspectorHost.tsx'), 'utf8')
const page = readFileSync(join(__dirname, '../../pages/ConnectionsPage.tsx'), 'utf8')

describe('CF-6.4 InspectorHost connections', () => {
  it('specializes the info section for the connections navigator', () => {
    expect(host).toContain('isConnectionsNavigation')
    expect(host).toContain('projectConnectionInspector')
    expect(host).toContain('selectedConnectionAtom')
    expect(host).toContain('inspector.field.provider')
    expect(host).toContain('inspector.field.storageMode')
    expect(host).toContain('inspector.field.credentialRef')
    expect(host).toContain('inspector.field.scopes')
    expect(host.toLowerCase()).not.toContain('<iframe')
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('lets the services list publish a selected connection into the inspector', () => {
    expect(page).toContain('selectedConnectionAtom')
    expect(page).toContain('aria-selected')
    expect(page).toContain('data-testid="connections-row"')
  })

  it('exposes test, repair, and confirmed rotate without secret fields', () => {
    expect(host).toContain('testConnection')
    expect(host).toContain('repairConnection')
    expect(host).toContain('rotateConnection')
    expect(host).toContain('connections.test')
    expect(host).toContain('connections.repair')
    expect(host).toContain('connections.rotate')
    expect(host).toContain('connections.rotateConfirm')
    expect(host).toContain('workspaceId')
    expect(host.toLowerCase()).not.toContain('<iframe')
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('surfaces inspector action errors and lists consumers before mutate', () => {
    expect(host).toContain('errorMessage')
    expect(host).toContain('connections-inspector-error')
    expect(host).toContain('listConnectionBindings')
    expect(host).toContain('sanitizeConnectionBindingRows')
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })
})
