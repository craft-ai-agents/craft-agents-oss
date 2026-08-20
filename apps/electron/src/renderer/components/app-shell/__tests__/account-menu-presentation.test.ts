import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * AccountMenu uses a nested Drawer in compact headers and a DropdownMenu in
 * desktop headers. Both presentations intentionally expose only workspace
 * selection controls; profile/account actions belong to ProfileStrip.
 */
const accountMenuPath = join(__dirname, '../AccountMenu.tsx')

describe('AccountMenu presentation mode', () => {
  const src = readFileSync(accountMenuPath, 'utf8')

  it('uses a nested Drawer when compact is true', () => {
    expect(src).toContain('if (compact)')
    expect(src).toContain('<Drawer nested open={open} onOpenChange={handleOpenChange}>')
    expect(src).toContain('DrawerContent')
    expect(src).toContain('data-account-menu={compact ? \'compact\' : \'topbar\'}')
    expect(src).toContain("<DrawerTitle>{t('workspace.selectWorkspace')}</DrawerTitle>")
  })

  it('keeps DropdownMenu on the desktop (!compact) path only', () => {
    expect(src).toContain('<DropdownMenu open={open} onOpenChange={handleOpenChange}>')
    expect(src).toContain('StyledDropdownMenuContent')

    // Compact branch must not construct DropdownMenu; only the desktop return does.
    const compactBranch = src.slice(src.indexOf('if (compact)'), src.indexOf('// Desktop: DropdownMenu'))
    expect(compactBranch).toContain('<Drawer nested')
    expect(compactBranch).not.toContain('<DropdownMenu')
    expect(compactBranch).not.toContain('StyledDropdownMenuContent')
  })

  it('keeps profile, connection, and security destinations out of the workspace selector', () => {
    expect(src).toContain("const triggerLabel = selectedWorkspace?.name || t('workspace.selectWorkspace')")
    expect(src).not.toContain('identityGetState')
    expect(src).not.toContain('getCredentialHealth')
    expect(src).not.toContain('profileMode')
    expect(src).not.toContain('siyuanCloud')
    expect(src).toContain('onSelectWorkspace: (workspaceId: string, openInNewWindow?: boolean) => void | Promise<void>')
    expect(src).toContain('onWorkspaceCreated?.(workspace)')
    expect(src).toContain('onWorkspaceRemoved?.()')
    expect(src).not.toContain('routes.view.settings')
  })
})
