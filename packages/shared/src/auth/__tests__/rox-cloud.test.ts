import { describe, expect, it } from 'bun:test'
import { getRoxAuthBaseUrl, isRoxCloudRequired } from '../rox-cloud.ts'

describe('rox-cloud config', () => {
  it('defaults auth base to rox.one', () => {
    const prev = process.env.ROX_AUTH_BASE_URL
    delete process.env.ROX_AUTH_BASE_URL
    expect(getRoxAuthBaseUrl()).toBe('https://rox.one')
    if (prev !== undefined) process.env.ROX_AUTH_BASE_URL = prev
  })

  it('strips trailing slash', () => {
    process.env.ROX_AUTH_BASE_URL = 'https://rox.one/'
    expect(getRoxAuthBaseUrl()).toBe('https://rox.one')
    delete process.env.ROX_AUTH_BASE_URL
  })

  it('respects ROX_CLOUD_REQUIRED=0', () => {
    process.env.ROX_CLOUD_REQUIRED = '0'
    expect(isRoxCloudRequired()).toBe(false)
    delete process.env.ROX_CLOUD_REQUIRED
  })

  it('defaults cloud required true', () => {
    delete process.env.ROX_CLOUD_REQUIRED
    expect(isRoxCloudRequired()).toBe(true)
  })
})
