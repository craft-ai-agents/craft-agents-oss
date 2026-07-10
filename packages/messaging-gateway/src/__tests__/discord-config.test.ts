import { describe, it, expect } from 'bun:test'
import {
  getDefaultBindingConfig,
  normalizeBindingConfig,
  DEFAULT_BINDING_CONFIG,
} from '../types'

describe('discord binding config', () => {
  it('defaults discordGuildTrigger to "mention"', () => {
    expect(DEFAULT_BINDING_CONFIG.discordGuildTrigger).toBe('mention')
    expect(getDefaultBindingConfig('discord').discordGuildTrigger).toBe('mention')
  })

  it('uses chat approval for discord (buttons supported)', () => {
    expect(getDefaultBindingConfig('discord').approvalChannel).toBe('chat')
  })

  it('preserves an explicit "all" trigger through normalize', () => {
    const cfg = normalizeBindingConfig('discord', { discordGuildTrigger: 'all' })
    expect(cfg.discordGuildTrigger).toBe('all')
  })

  it('backfills discordGuildTrigger for legacy configs missing the field', () => {
    const cfg = normalizeBindingConfig('discord', { responseMode: 'progress' })
    expect(cfg.discordGuildTrigger).toBe('mention')
  })
})
