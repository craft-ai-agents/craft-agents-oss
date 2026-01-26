/**
 * Access Control Tests
 *
 * Tests for DM policies, group policies, and allowlist management
 */

import { describe, it, expect } from 'bun:test'
import { checkDMAccess, checkGroupAccess } from '../access-control'

describe('Access Control', () => {
  describe('checkDMAccess', () => {
    it('should block all DMs when policy is disabled', () => {
      const result = checkDMAccess({
        userId: 123,
        policy: 'disabled',
        allowlist: []
      })

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('disabled')
    })

    it('should allow all DMs when policy is open', () => {
      const result = checkDMAccess({
        userId: 123,
        policy: 'open',
        allowlist: []
      })

      expect(result.allowed).toBe(true)
    })

    it('should allow allowlisted users when policy is allowlist', () => {
      const result = checkDMAccess({
        userId: 123,
        policy: 'allowlist',
        allowlist: [123, 456]
      })

      expect(result.allowed).toBe(true)
    })

    it('should block non-allowlisted users when policy is allowlist', () => {
      const result = checkDMAccess({
        userId: 999,
        policy: 'allowlist',
        allowlist: [123, 456]
      })

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('not authorized')
    })

    it('should allow allowlisted users in pairing mode', () => {
      const result = checkDMAccess({
        userId: 123,
        policy: 'pairing',
        allowlist: [123]
      })

      expect(result.allowed).toBe(true)
    })

    it('should generate pairing code for unknown users in pairing mode', () => {
      const result = checkDMAccess({
        userId: 12345,
        policy: 'pairing',
        allowlist: []
      })

      expect(result.allowed).toBe(false)
      expect(result.pairingCode).toBeDefined()
      expect(result.pairingCode).toContain('PAIR-')
      expect(result.pairingCode).toContain('2345') // Last 4 digits of 12345
      expect(result.reason).toContain('Pairing required')
    })

    it('should generate different pairing codes for different users', () => {
      const result1 = checkDMAccess({
        userId: 11111,
        policy: 'pairing',
        allowlist: []
      })

      const result2 = checkDMAccess({
        userId: 22222,
        policy: 'pairing',
        allowlist: []
      })

      expect(result1.pairingCode).toBeDefined()
      expect(result2.pairingCode).toBeDefined()
      expect(result1.pairingCode).not.toBe(result2.pairingCode)
    })

    it('should include last 4 digits of userId in pairing code', () => {
      const result = checkDMAccess({
        userId: 987654,
        policy: 'pairing',
        allowlist: []
      })

      expect(result.pairingCode).toContain('7654')
    })

    it('should handle userId with fewer than 4 digits', () => {
      const result = checkDMAccess({
        userId: 42,
        policy: 'pairing',
        allowlist: []
      })

      expect(result.pairingCode).toBeDefined()
      expect(result.pairingCode).toContain('42')
    })

    it('should respect empty allowlist in allowlist mode', () => {
      const result = checkDMAccess({
        userId: 123,
        policy: 'allowlist',
        allowlist: []
      })

      expect(result.allowed).toBe(false)
    })
  })

  describe('checkGroupAccess', () => {
    it('should block all group messages when policy is disabled', () => {
      const result = checkGroupAccess({
        chatId: 100,
        userId: 123,
        groupPolicy: 'disabled',
        allowedGroups: [],
        allowedUsers: []
      })

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('disabled')
    })

    it('should allow all group messages when policy is open', () => {
      const result = checkGroupAccess({
        chatId: 100,
        userId: 123,
        groupPolicy: 'open',
        allowedGroups: [],
        allowedUsers: []
      })

      expect(result.allowed).toBe(true)
    })

    it('should allow when both group and user are allowlisted', () => {
      const result = checkGroupAccess({
        chatId: 100,
        userId: 123,
        groupPolicy: 'allowlist',
        allowedGroups: [100, 200],
        allowedUsers: [123, 456]
      })

      expect(result.allowed).toBe(true)
    })

    it('should block when group is not allowlisted', () => {
      const result = checkGroupAccess({
        chatId: 999,
        userId: 123,
        groupPolicy: 'allowlist',
        allowedGroups: [100, 200],
        allowedUsers: [123, 456]
      })

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('group is not authorized')
    })

    it('should block when user is not allowlisted', () => {
      const result = checkGroupAccess({
        chatId: 100,
        userId: 999,
        groupPolicy: 'allowlist',
        allowedGroups: [100, 200],
        allowedUsers: [123, 456]
      })

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('You are not authorized')
    })

    it('should allow when allowedGroups is empty (all groups allowed)', () => {
      const result = checkGroupAccess({
        chatId: 999,
        userId: 123,
        groupPolicy: 'allowlist',
        allowedGroups: [], // Empty = all allowed
        allowedUsers: [123]
      })

      expect(result.allowed).toBe(true)
    })

    it('should allow when allowedUsers is empty (all users allowed)', () => {
      const result = checkGroupAccess({
        chatId: 100,
        userId: 999,
        groupPolicy: 'allowlist',
        allowedGroups: [100],
        allowedUsers: [] // Empty = all allowed
      })

      expect(result.allowed).toBe(true)
    })

    it('should allow when both allowlists are empty', () => {
      const result = checkGroupAccess({
        chatId: 999,
        userId: 888,
        groupPolicy: 'allowlist',
        allowedGroups: [],
        allowedUsers: []
      })

      expect(result.allowed).toBe(true)
    })

    it('should block when group not in list even if user is allowed', () => {
      const result = checkGroupAccess({
        chatId: 999,
        userId: 123,
        groupPolicy: 'allowlist',
        allowedGroups: [100, 200], // 999 not here
        allowedUsers: [123]
      })

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('group is not authorized')
    })

    it('should block when user not in list even if group is allowed', () => {
      const result = checkGroupAccess({
        chatId: 100,
        userId: 999,
        groupPolicy: 'allowlist',
        allowedGroups: [100],
        allowedUsers: [123, 456] // 999 not here
      })

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('You are not authorized')
    })
  })

  describe('Integration Scenarios', () => {
    it('should handle mixed DM and group access correctly', () => {
      // User 123 is allowlisted for DMs
      const dmResult = checkDMAccess({
        userId: 123,
        policy: 'allowlist',
        allowlist: [123]
      })

      expect(dmResult.allowed).toBe(true)

      // But not allowlisted for groups
      const groupResult = checkGroupAccess({
        chatId: 100,
        userId: 123,
        groupPolicy: 'allowlist',
        allowedGroups: [100],
        allowedUsers: [456] // 123 not here
      })

      expect(groupResult.allowed).toBe(false)
    })

    it('should handle different policies for DM and group', () => {
      const userId = 123

      // DMs open to all
      const dmResult = checkDMAccess({
        userId,
        policy: 'open',
        allowlist: []
      })

      expect(dmResult.allowed).toBe(true)

      // Groups disabled
      const groupResult = checkGroupAccess({
        chatId: 100,
        userId,
        groupPolicy: 'disabled',
        allowedGroups: [],
        allowedUsers: []
      })

      expect(groupResult.allowed).toBe(false)
    })

    it('should handle pairing mode for new users', () => {
      const newUserId = 99999

      // First attempt: get pairing code
      const firstAttempt = checkDMAccess({
        userId: newUserId,
        policy: 'pairing',
        allowlist: []
      })

      expect(firstAttempt.allowed).toBe(false)
      expect(firstAttempt.pairingCode).toBeDefined()

      // After admin approves (adds to allowlist)
      const secondAttempt = checkDMAccess({
        userId: newUserId,
        policy: 'pairing',
        allowlist: [newUserId]
      })

      expect(secondAttempt.allowed).toBe(true)
      expect(secondAttempt.pairingCode).toBeUndefined()
    })

    it('should handle edge case: negative user/chat IDs', () => {
      // Telegram allows negative IDs for groups/supergroups
      const result = checkGroupAccess({
        chatId: -100,
        userId: 123,
        groupPolicy: 'allowlist',
        allowedGroups: [-100],
        allowedUsers: [123]
      })

      expect(result.allowed).toBe(true)
    })

    it('should handle multiple allowlisted groups and users', () => {
      const result = checkGroupAccess({
        chatId: 300,
        userId: 789,
        groupPolicy: 'allowlist',
        allowedGroups: [100, 200, 300, 400],
        allowedUsers: [123, 456, 789, 1011]
      })

      expect(result.allowed).toBe(true)
    })
  })
})
