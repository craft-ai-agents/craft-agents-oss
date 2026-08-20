/**
 * Task 6 — messaging settings access-mode migration.
 *
 * Behavioral helpers live in the access-mode module so these assertions
 * fail for the wrong policy, not for React render noise. Source contracts
 * lock the page/popover/banner/i18n to the three explicit labels and
 * forbid recreating an `open` control path.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyDisplayedSenderApproval,
  bindingRoutesInbound,
  canCommitOwnerControl,
  DEFAULT_UI_ACCESS_MODE,
  normalizeUiAccessMode,
  pendingApprovalLeavesOwnerControl,
  toBindingAccess,
  UI_ACCESS_MODES,
} from '../../../components/messaging/access/access-mode'

const settingsDir = join(import.meta.dir, '..')
const accessDir = join(import.meta.dir, '../../../components/messaging/access')
const atomsPath = join(import.meta.dir, '../../../atoms/messaging.ts')
const mockUtilsPath = join(import.meta.dir, '../../../playground/mock-utils.ts')
const enJsonPath = join(
  import.meta.dir,
  '../../../../../../../packages/shared/src/i18n/locales/en.json',
)

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('normalizeUiAccessMode', () => {
  it('maps every legacy missing/open/inherit value to public-inbox', () => {
    expect(normalizeUiAccessMode(undefined)).toBe('public-inbox')
    expect(normalizeUiAccessMode('open')).toBe('public-inbox')
    expect(normalizeUiAccessMode('inherit')).toBe('public-inbox')
    expect(normalizeUiAccessMode('public-inbox')).toBe('public-inbox')
  })

  it('maps owner-only and allow-list to owner-control', () => {
    expect(normalizeUiAccessMode('owner-only')).toBe('owner-control')
    expect(normalizeUiAccessMode('allow-list')).toBe('owner-control')
    expect(normalizeUiAccessMode('owner-control')).toBe('owner-control')
  })

  it('keeps disabled as disabled', () => {
    expect(normalizeUiAccessMode('disabled')).toBe('disabled')
  })

  it('defaults the settings surface to public-inbox', () => {
    expect(DEFAULT_UI_ACCESS_MODE).toBe('public-inbox')
    expect(UI_ACCESS_MODES).toEqual(['public-inbox', 'owner-control', 'disabled'])
  })
})

describe('owner-control save gate', () => {
  it('disables save until at least one allowed sender is selected', () => {
    expect(canCommitOwnerControl([])).toBe(false)
    expect(canCommitOwnerControl([''])).toBe(false)
    expect(canCommitOwnerControl(['  '])).toBe(false)
    expect(canCommitOwnerControl(['sender-1'])).toBe(true)
  })
})

describe('disabled binding routing', () => {
  it('removes inbound routing only for disabled', () => {
    expect(bindingRoutesInbound('disabled')).toBe(false)
    expect(bindingRoutesInbound('public-inbox')).toBe(true)
    expect(bindingRoutesInbound('owner-control')).toBe(true)
    expect(bindingRoutesInbound('open')).toBe(true)
  })
})

describe('binding wire conversion', () => {
  it('treats a missing accessMode as public-inbox, not open', () => {
    expect(toBindingAccess({})).toEqual({
      mode: 'public-inbox',
      allowedSenderIds: [],
    })
  })
})

describe('pending approval mutation', () => {
  it('leaves the binding in owner-control and never opens the platform', () => {
    expect(
      pendingApprovalLeavesOwnerControl({
        reason: 'not-on-binding-allowlist',
        bindingId: 'b1',
        userId: 'u1',
      }),
    ).toEqual({
      mode: 'owner-control',
      userId: 'u1',
      bindingId: 'b1',
    })
  })

  it('mutates only the displayed sender allowlist record and preserves other modes', () => {
    const records = {
      b1: { mode: 'owner-control' as const, allowedSenderIds: ['existing'] },
      b2: { mode: 'public-inbox' as const, allowedSenderIds: ['other'] },
    }
    const result = applyDisplayedSenderApproval(records, {
      reason: 'not-on-binding-allowlist',
      bindingId: 'b1',
      userId: 'u1',
    })
    expect(result.mode).toBe('owner-control')
    expect(result.userId).toBe('u1')
    expect(result.bindingId).toBe('b1')
    expect(result.records.b1).toEqual({
      mode: 'owner-control',
      allowedSenderIds: ['existing', 'u1'],
    })
    expect(result.records.b2).toEqual({
      mode: 'public-inbox',
      allowedSenderIds: ['other'],
    })
  })
})

describe('MessagingSettingsPage source contracts', () => {
  const page = read(join(settingsDir, 'MessagingSettingsPage.tsx'))
  const banner = read(join(accessDir, 'AccessModeBanner.tsx'))
  const popover = read(join(accessDir, 'BindingAllowListPopover.tsx'))
  const telegram = read(join(accessDir, 'TelegramAccessSection.tsx'))
  const pending = read(join(accessDir, 'PendingSendersList.tsx'))
  const atoms = read(atomsPath)
  const mocks = read(mockUtilsPath)
  const en = JSON.parse(read(enJsonPath)) as Record<string, string>

  it('does not offer an Unlock / set-open control', () => {
    expect(page).not.toContain("setMessagingPlatformAccessMode('telegram', 'open')")
    expect(page).not.toContain('handleUnlock')
    expect(page).not.toContain("useState<PlatformAccessMode>('open')")
    expect(page).not.toContain("mode: binding.accessMode ?? 'open'")
  })

  it('defaults the settings surface to public-inbox', () => {
    expect(page).toContain("useState<PlatformAccessMode>('public-inbox')")
    expect(page).toContain('toBindingAccess')
    expect(atoms).toContain("'public-inbox' | 'owner-control' | 'disabled'")
    expect(atoms).not.toMatch(/UI treats missing values as `'open'`/)
    expect(mocks).toContain("accessMode: 'public-inbox'")
    expect(mocks).not.toContain("accessMode: 'open'")
  })

  it('labels binding controls Public inbox, Owner control, and Disabled', () => {
    expect(popover).toContain("'public-inbox'")
    expect(popover).toContain("'owner-control'")
    expect(popover).toContain("'disabled'")
    expect(popover).not.toContain("'inherit'")
    expect(popover).not.toContain("'allow-list'")
    expect(popover).not.toMatch(/mode\.open\.label/)
    expect(popover).toContain('Public inbox')
    expect(popover).toContain('Owner control')
    expect(popover).toContain('Disabled')
    expect(en['settings.messaging.telegram.access.bindingPopover.mode.publicInbox.label']).toBe(
      'Public inbox',
    )
    expect(en['settings.messaging.telegram.access.bindingPopover.mode.ownerControl.label']).toBe(
      'Owner control',
    )
    expect(en['settings.messaging.telegram.access.bindingPopover.mode.disabled.label']).toBe(
      'Disabled',
    )
  })

  it('public-inbox copy does not claim messages run in an agent session', () => {
    const bannerDescription = en['settings.messaging.telegram.access.banner.description']
    const publicInboxDescription =
      en['settings.messaging.telegram.access.bindingPopover.mode.publicInbox.description']
    expect(bannerDescription.toLowerCase()).not.toMatch(/start a new session|run in an agent session/)
    expect(publicInboxDescription.toLowerCase()).toMatch(/do not start an agent session/)
    expect(banner).toContain('AccessModeBanner')
    expect(banner).toContain('do not start an agent session')
    expect(popover).toContain('do not start an agent session')
    expect(telegram).toContain("accessMode === 'public-inbox'")
    expect(telegram).not.toContain("accessMode === 'open'")
  })

  it('owner-control save is gated on at least one allowed sender', () => {
    expect(page).toContain('canCommitOwnerControl')
    expect(popover).toContain('canCommitOwnerControl')
    expect(popover).not.toContain('workspaceOwners.map((o) => o.userId)')
    expect(mocks).toContain('owner-control requires an exact selected sender')
  })

  it('pending allow is a narrow allow-list mutation with an audit reason', () => {
    expect(pending).toContain('settings.messaging.telegram.access.pending.audit')
    expect(pending).toContain('exact sender')
    expect(pending).not.toMatch(/unlock all/i)
    expect(mocks).toContain('applyDisplayedSenderApproval')
    expect(en['settings.messaging.telegram.access.pending.audit.notOnBindingAllowlist']).toMatch(
      /exact sender/i,
    )
  })
})
