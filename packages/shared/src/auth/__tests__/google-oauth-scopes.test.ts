import { describe, expect, it } from 'bun:test'

import { getGoogleScopes } from '../google-oauth'

describe('Google OAuth scope defaults', () => {
  it('uses narrow Gmail scopes by default', () => {
    expect(getGoogleScopes({ service: 'gmail' })).toEqual([
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/userinfo.email',
    ])
  })

  it('uses event-level Calendar access by default', () => {
    expect(getGoogleScopes({ service: 'calendar' })).toEqual([
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/userinfo.email',
    ])
  })

  it('uses limited Drive access by default', () => {
    expect(getGoogleScopes({ service: 'drive' })).toEqual([
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ])
  })
})
