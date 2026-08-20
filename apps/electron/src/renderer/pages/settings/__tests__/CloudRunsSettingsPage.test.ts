import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const cloudRunsSettingsPath = join(__dirname, '../CloudRunsSettingsPage.tsx')
const source = readFileSync(cloudRunsSettingsPath, 'utf8')

const longCyrillicDescription = 'Фоновое выполнение облачных задач продолжает работать после закрытия приложения и должно оставаться полностью читаемым'

describe('CloudRunsSettingsPage compact layout and recovery', () => {
  it('uses one viewport-sized local body scroll owner between fixed header and footer', () => {
    expect(source).toContain('h-[calc(100dvh-3rem)] min-h-0 flex-col')
    expect(source).toContain('<header className="flex shrink-0')
    expect(source).toContain('min-h-0 flex-1 overflow-y-auto overscroll-contain')
    expect(source.match(/overflow-y-auto overscroll-contain/g)).toHaveLength(1)
    expect(source).toContain('<footer className="shrink-0')
  })

  it('keeps long Cyrillic settings labels and descriptions readable', () => {
    expect(longCyrillicDescription.length).toBeGreaterThan(80)
    expect(source).toContain('function SettingText')
    expect(source).toContain('min-w-0 whitespace-normal break-words')
    expect(source).toContain('<SettingsRow label={<SettingText')
    expect(source).toContain("label={<SettingText label={t('settings.cloudRuns.enable')}")
  })

  it('keeps unavailable load and failed-save states visible and retryable', () => {
    expect(source).toContain('setLoadError')
    expect(source).toContain('setSaveError')
    expect(source).toContain('setFailedPatch(nextPatch)')
    expect(source).toContain('role="alert"')
    expect(source).toContain('onClick={() => void load()}')
    expect(source).toContain('onClick={() => patch(failedPatch)}')
    expect(source).toContain("t('common.retry')")
  })

  it('names the refresh operation and exposes enabled or disabled status', () => {
    expect(source).toContain("t('automations.statusActive')")
    expect(source).toContain("t('automations.statusDisabled')")
  })
})
