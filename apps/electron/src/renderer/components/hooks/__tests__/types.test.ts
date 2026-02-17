import { describe, it, expect } from 'bun:test'
import { parseHooksConfig } from '../types'

describe('parseHooksConfig', () => {
  it('returns [] for null input', () => {
    expect(parseHooksConfig(null)).toEqual([])
  })

  it('returns [] for undefined input', () => {
    expect(parseHooksConfig(undefined)).toEqual([])
  })

  it('returns [] for non-object input', () => {
    expect(parseHooksConfig('string')).toEqual([])
    expect(parseHooksConfig(42)).toEqual([])
    expect(parseHooksConfig(true)).toEqual([])
  })

  it('returns [] for { hooks: {} } (empty hooks)', () => {
    expect(parseHooksConfig({ version: 1, hooks: {} })).toEqual([])
  })

  it('returns [] for missing hooks key', () => {
    expect(parseHooksConfig({ version: 1 })).toEqual([])
  })

  it('parses single event with one matcher', () => {
    const config = {
      version: 1,
      hooks: {
        SchedulerTick: [{
          cron: '0 9 * * 1-5',
          hooks: [{ type: 'command', command: 'echo hello' }],
        }],
      },
    }
    const items = parseHooksConfig(config)
    expect(items).toHaveLength(1)
    expect(items[0].event).toBe('SchedulerTick')
    expect(items[0].matcherIndex).toBe(0)
    expect(items[0].cron).toBe('0 9 * * 1-5')
    expect(items[0].hooks).toHaveLength(1)
    expect(items[0].hooks[0].type).toBe('command')
  })

  it('parses multiple events with multiple matchers', () => {
    const config = {
      version: 1,
      hooks: {
        SchedulerTick: [
          { cron: '0 9 * * *', hooks: [{ type: 'command', command: 'backup' }] },
          { cron: '0 18 * * *', hooks: [{ type: 'command', command: 'cleanup' }] },
        ],
        LabelAdd: [
          { matcher: 'urgent', hooks: [{ type: 'prompt', prompt: 'Handle urgent' }] },
        ],
      },
    }
    const items = parseHooksConfig(config)
    expect(items).toHaveLength(3)
    expect(items[0].event).toBe('SchedulerTick')
    expect(items[0].matcherIndex).toBe(0)
    expect(items[1].event).toBe('SchedulerTick')
    expect(items[1].matcherIndex).toBe(1)
    expect(items[2].event).toBe('LabelAdd')
    expect(items[2].matcherIndex).toBe(0)
  })

  it('derives name from name field when present', () => {
    const config = {
      version: 1,
      hooks: {
        SchedulerTick: [{
          name: 'Morning Backup',
          hooks: [{ type: 'command', command: 'backup.sh' }],
        }],
      },
    }
    const items = parseHooksConfig(config)
    expect(items[0].name).toBe('Morning Backup')
  })

  it('derives name from @mention in prompt', () => {
    const config = {
      version: 1,
      hooks: {
        UserPromptSubmit: [{
          hooks: [{ type: 'prompt', prompt: 'Run @daily-standup task' }],
        }],
      },
    }
    const items = parseHooksConfig(config)
    expect(items[0].name).toBe('daily-standup prompt')
  })

  it('derives name from command when no name field', () => {
    const config = {
      version: 1,
      hooks: {
        SessionStart: [{
          hooks: [{ type: 'command', command: 'echo "hello world"' }],
        }],
      },
    }
    const items = parseHooksConfig(config)
    expect(items[0].name).toBe('echo "hello world"')
  })

  it('truncates long names to 40 chars with ellipsis', () => {
    const longCommand = 'a'.repeat(50)
    const config = {
      version: 1,
      hooks: {
        SessionStart: [{
          hooks: [{ type: 'command', command: longCommand }],
        }],
      },
    }
    const items = parseHooksConfig(config)
    expect(items[0].name).toBe('a'.repeat(40) + '...')
  })

  it('sets enabled: true when field is missing (default)', () => {
    const config = {
      version: 1,
      hooks: {
        SessionStart: [{
          hooks: [{ type: 'command', command: 'test' }],
        }],
      },
    }
    const items = parseHooksConfig(config)
    expect(items[0].enabled).toBe(true)
  })

  it('sets enabled: false when explicitly set', () => {
    const config = {
      version: 1,
      hooks: {
        SessionStart: [{
          enabled: false,
          hooks: [{ type: 'command', command: 'test' }],
        }],
      },
    }
    const items = parseHooksConfig(config)
    expect(items[0].enabled).toBe(false)
  })

  it('skips matchers with empty hooks array', () => {
    const config = {
      version: 1,
      hooks: {
        SessionStart: [
          { hooks: [] },
          { hooks: [{ type: 'command', command: 'valid' }] },
        ],
      },
    }
    const items = parseHooksConfig(config)
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('valid')
  })

  it('generates correct matcherIndex per event', () => {
    const config = {
      version: 1,
      hooks: {
        SchedulerTick: [
          { hooks: [{ type: 'command', command: 'a' }] },
          { hooks: [{ type: 'command', command: 'b' }] },
          { hooks: [{ type: 'command', command: 'c' }] },
        ],
      },
    }
    const items = parseHooksConfig(config)
    expect(items[0].matcherIndex).toBe(0)
    expect(items[1].matcherIndex).toBe(1)
    expect(items[2].matcherIndex).toBe(2)
  })

  it('generates unique IDs across events', () => {
    const config = {
      version: 1,
      hooks: {
        SchedulerTick: [{ hooks: [{ type: 'command', command: 'a' }] }],
        LabelAdd: [{ hooks: [{ type: 'command', command: 'b' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: 'c' }] }],
      },
    }
    const items = parseHooksConfig(config)
    const ids = items.map(i => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('preserves optional fields (matcher, cron, timezone, permissionMode, labels)', () => {
    const config = {
      version: 1,
      hooks: {
        LabelAdd: [{
          matcher: 'urgent',
          permissionMode: 'ask',
          labels: ['important'],
          hooks: [{ type: 'prompt', prompt: 'Handle it' }],
        }],
      },
    }
    const items = parseHooksConfig(config)
    expect(items[0].matcher).toBe('urgent')
    expect(items[0].permissionMode).toBe('ask')
    expect(items[0].labels).toEqual(['important'])
  })
})
