import { describe, expect, it } from 'bun:test'
import { APP_VERSION } from '../../shared/src/version/index.ts'
import { buildCustomEndpointRequestHeaders } from './custom-endpoint-headers.ts'

describe('buildCustomEndpointRequestHeaders', () => {
  it('uses the Craft app version in the user agent', () => {
    expect(buildCustomEndpointRequestHeaders()).toEqual({
      'User-Agent': `CraftAgents/${APP_VERSION}`,
    })
  })
})
