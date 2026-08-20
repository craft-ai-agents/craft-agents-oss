import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { setupI18n, i18n } from '@craft-agent/shared/i18n/setupI18n'

// Bootstrap i18next with bundled resources before importing the
// component-under-test so its top-level i18n.t() calls return real strings.
// The app default language is Russian (localStorage detection only); pin
// English for deterministic assertions and restore the language afterwards.
setupI18n()

import {
  getToolchainBannerCopy,
  getToolchainBannerPhase,
  toolchainBannerPercent,
} from '../ToolchainStatusBanner'
import type { ToolchainToolStatus } from '../../../../shared/types'

let previousLanguage: string
beforeAll(() => {
  previousLanguage = i18n.language
  i18n.changeLanguage('en')
})
afterAll(() => {
  i18n.changeLanguage(previousLanguage)
})

function tool(overrides: Partial<ToolchainToolStatus>): ToolchainToolStatus {
  return {
    name: 'omp',
    phase: 'ready',
    ...overrides,
  }
}

describe('getToolchainBannerPhase', () => {
  it('is hidden without a tool snapshot', () => {
    expect(getToolchainBannerPhase(undefined)).toBe(null)
  })

  it('is hidden while the manager has not started (missing)', () => {
    expect(getToolchainBannerPhase(tool({ phase: 'missing' }))).toBe(null)
  })

  it('is hidden when the runtime is ready', () => {
    expect(getToolchainBannerPhase(tool({ phase: 'ready' }))).toBe(null)
  })

  it('is hidden when the runtime is usable but outdated', () => {
    expect(getToolchainBannerPhase(tool({ phase: 'outdated' }))).toBe(null)
  })

  it('is shown while downloading', () => {
    expect(getToolchainBannerPhase(tool({ phase: 'downloading' }))).toBe('downloading')
  })

  it('is shown while installing', () => {
    expect(getToolchainBannerPhase(tool({ phase: 'installing' }))).toBe('installing')
  })

  it('is shown on error and offline', () => {
    expect(getToolchainBannerPhase(tool({ phase: 'error' }))).toBe('error')
    expect(getToolchainBannerPhase(tool({ phase: 'offline' }))).toBe('offline')
  })
})

describe('toolchainBannerPercent', () => {
  it('rounds download progress to whole percents', () => {
    expect(toolchainBannerPercent(tool({ phase: 'downloading', downloadedBytes: 41, totalBytes: 100 }))).toBe(41)
    expect(toolchainBannerPercent(tool({ phase: 'downloading', downloadedBytes: 2, totalBytes: 3 }))).toBe(67)
  })

  it('clamps into the 0–100 range', () => {
    expect(toolchainBannerPercent(tool({ phase: 'downloading', downloadedBytes: 150, totalBytes: 100 }))).toBe(100)
  })

  it('is indeterminate without byte totals', () => {
    expect(toolchainBannerPercent(tool({ phase: 'downloading', downloadedBytes: 10 }))).toBe(undefined)
    expect(toolchainBannerPercent(tool({ phase: 'downloading', totalBytes: 100 }))).toBe(undefined)
  })
})

describe('getToolchainBannerCopy', () => {
  it('reports nothing for phases the banner hides', () => {
    expect(getToolchainBannerCopy(tool({ phase: 'ready' }))).toBe(null)
    expect(getToolchainBannerCopy(tool({ phase: 'missing' }))).toBe(null)
  })

  it('maps downloading to info copy with percent and progress bar', () => {
    const copy = getToolchainBannerCopy(tool({ phase: 'downloading', downloadedBytes: 25, totalBytes: 100 }))

    expect(copy?.text).toContain('Downloading AI runtime')
    expect(copy?.text).toContain('25%')
    expect(copy?.tone).toBe('info')
    expect(copy?.showProgress).toBe(true)
    expect(copy?.showOpenToolchain).toBe(false)
  })

  it('maps downloading without totals to indeterminate copy', () => {
    const copy = getToolchainBannerCopy(tool({ phase: 'downloading' }))

    expect(copy?.text).toBe('Downloading AI runtime…')
    expect(copy?.percent).toBe(undefined)
    expect(copy?.showProgress).toBe(true)
  })

  it('maps installing to info copy without a progress bar', () => {
    const copy = getToolchainBannerCopy(tool({ phase: 'installing' }))

    expect(copy?.text).toContain('Installing AI runtime')
    expect(copy?.tone).toBe('info')
    expect(copy?.showProgress).toBe(false)
    expect(copy?.showOpenToolchain).toBe(false)
  })

  it('maps error to the critical copy with the Toolchain shortcut', () => {
    const copy = getToolchainBannerCopy(tool({ phase: 'error', error: 'boom' }))

    expect(copy?.text).toContain('not ready')
    expect(copy?.text).toContain('Error')
    expect(copy?.tone).toBe('error')
    expect(copy?.showOpenToolchain).toBe(true)
  })

  it('maps offline to warning copy with the Toolchain shortcut', () => {
    const copy = getToolchainBannerCopy(tool({ phase: 'offline' }))

    expect(copy?.text).toContain('not ready')
    expect(copy?.text).toContain('Offline')
    expect(copy?.tone).toBe('warning')
    expect(copy?.showOpenToolchain).toBe(true)
  })
})
