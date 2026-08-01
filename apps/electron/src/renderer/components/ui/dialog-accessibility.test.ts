import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const describedDialogSources = [
  new URL('../KeyboardShortcutsDialog.tsx', import.meta.url),
  new URL('../ServerDirectoryBrowser.tsx', import.meta.url),
  new URL('../projects/CreateProjectDialog.tsx', import.meta.url),
  new URL('./command.tsx', import.meta.url),
  new URL('./rename-dialog.tsx', import.meta.url),
  new URL('../app-shell/CompactSessionListFilter.tsx', import.meta.url),
  new URL('../app-shell/CompactSessionMenu.tsx', import.meta.url),
  new URL('../app-shell/CompactWorkspaceSwitcher.tsx', import.meta.url),
  new URL('../app-shell/SessionInfoPopover.tsx', import.meta.url),
  new URL('../app-shell/input/CompactModelSelector.tsx', import.meta.url),
  new URL('../app-shell/input/CompactPermissionModeSelector.tsx', import.meta.url),
  new URL('./CompactSourceSelector.tsx', import.meta.url),
  new URL('./CompactWorkingDirectorySelector.tsx', import.meta.url),
  new URL('../../../../../../packages/ui/src/components/chat/CompactAcceptPlanDrawer.tsx', import.meta.url),
  new URL('../../../../../../packages/ui/src/components/overlay/FullscreenOverlayBase.tsx', import.meta.url),
]

describe('dialog accessibility inventory', () => {
  it('keeps every audited dialog and drawer explicitly described', () => {
    for (const sourceUrl of describedDialogSources) {
      const source = readFileSync(sourceUrl, 'utf8')
      const hasDescription =
        source.includes('<DialogDescription') ||
        source.includes('<Dialog.Description') ||
        source.includes('<DrawerDescription')

      expect(hasDescription, sourceUrl.pathname).toBe(true)
    }
  })
})
