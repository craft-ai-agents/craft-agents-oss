import { describe, expect, test } from 'bun:test'
import type { Message } from '../../../../../shared/types'
import { getRateLimitRecoveryMessageId } from '../rate-limit-recovery'

const draft: Message = { id: 'user', role: 'user', content: 'Hello', timestamp: 1 }
const error: Message = { id: 'limit', role: 'error', errorCode: 'rate_limited', content: 'Rate Limit Exceeded', timestamp: 2 }
const status: Message = { id: 'status', role: 'status', content: 'Ready', timestamp: 3 }

describe('rate-limit account recovery', () => {
  test('keeps the recovery action on the latest rate limit across trailing status messages', () => {
    expect(getRateLimitRecoveryMessageId([draft, error, status], false)).toBe(error.id)
  })

  test('does not offer to switch accounts while the chat is processing', () => {
    expect(getRateLimitRecoveryMessageId([draft, error], true)).toBeUndefined()
  })

  test('does not offer the action on historical errors after a follow-up or newer error', () => {
    const followUp = { ...draft, id: 'follow-up', timestamp: 4 }
    const newerError = { ...error, id: 'other-error', timestamp: 4, errorCode: 'invalid_request' }
    expect(getRateLimitRecoveryMessageId([draft, error, followUp], false)).toBeUndefined()
    expect(getRateLimitRecoveryMessageId([draft, error, newerError], false)).toBeUndefined()
  })

  test('does not infer rate limits from the displayed error text', () => {
    expect(getRateLimitRecoveryMessageId([draft, { ...error, errorCode: undefined }], false)).toBeUndefined()
  })
})
