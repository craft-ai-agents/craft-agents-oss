import { describe, expect, it } from 'bun:test'
import { STARTUP_RENDERER_NAMESPACES } from '../i18n-namespaces'

describe('renderer i18n init namespaces', () => {
  it('includes onboarding namespace so api setup labels resolve', () => {
    expect(STARTUP_RENDERER_NAMESPACES).toContain('onboarding')
  })
})
