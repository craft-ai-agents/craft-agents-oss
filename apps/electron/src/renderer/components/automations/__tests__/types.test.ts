import { describe, it, expect } from 'bun:test'
import { AUTOMATIONS_LOAD_ISSUES_KEY } from '@craft-agent/shared/protocol'
import { parseAutomationsConfig, getUnattachedLoadIssues, getEventDisplayName } from '../types'
import { computeNextRuns } from '../utils'

describe('parseAutomationsConfig', () => {
  it('returns [] for null input', () => {
    expect(parseAutomationsConfig(null)).toEqual([])
  })

  it('returns [] for undefined input', () => {
    expect(parseAutomationsConfig(undefined)).toEqual([])
  })

  it('returns [] for non-object input', () => {
    expect(parseAutomationsConfig('string')).toEqual([])
    expect(parseAutomationsConfig(42)).toEqual([])
    expect(parseAutomationsConfig(true)).toEqual([])
  })

  it('returns [] for { automations: {} } (empty automations)', () => {
    expect(parseAutomationsConfig({ version: 2, automations: {} })).toEqual([])
  })

  it('returns [] for missing automations key', () => {
    expect(parseAutomationsConfig({ version: 2 })).toEqual([])
  })

  it('parses single event with one matcher', () => {
    const config = {
      version: 2,
      automations: {
        SchedulerTick: [{
          cron: '0 9 * * 1-5',
          actions: [{ type: 'prompt', prompt: 'echo hello' }],
        }],
      },
    }
    const items = parseAutomationsConfig(config)
    expect(items).toHaveLength(1)
    expect(items[0].event).toBe('SchedulerTick')
    expect(items[0].matcherIndex).toBe(0)
    expect(items[0].cron).toBe('0 9 * * 1-5')
    expect(items[0].actions).toHaveLength(1)
    expect(items[0].actions[0].type).toBe('prompt')
  })

  it('parses multiple events with multiple matchers', () => {
    const config = {
      version: 2,
      automations: {
        SchedulerTick: [
          { cron: '0 9 * * *', actions: [{ type: 'prompt', prompt: 'Run backup' }] },
          { cron: '0 18 * * *', actions: [{ type: 'prompt', prompt: 'Run cleanup' }] },
        ],
        LabelAdd: [
          { matcher: 'urgent', actions: [{ type: 'prompt', prompt: 'Handle urgent' }] },
        ],
      },
    }
    const items = parseAutomationsConfig(config)
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
      version: 2,
      automations: {
        SchedulerTick: [{
          name: 'Morning Backup',
          actions: [{ type: 'prompt', prompt: 'Run the morning backup' }],
        }],
      },
    }
    const items = parseAutomationsConfig(config)
    expect(items[0].name).toBe('Morning Backup')
  })

  it('derives name from @mention in prompt', () => {
    const config = {
      version: 2,
      automations: {
        UserPromptSubmit: [{
          actions: [{ type: 'prompt', prompt: 'Run @daily-standup task' }],
        }],
      },
    }
    const items = parseAutomationsConfig(config)
    expect(items[0].name).toBe('daily-standup prompt')
  })

  it('derives name from prompt when no name field', () => {
    const config = {
      version: 2,
      automations: {
        SessionStart: [{
          actions: [{ type: 'prompt', prompt: 'echo "hello world"' }],
        }],
      },
    }
    const items = parseAutomationsConfig(config)
    expect(items[0].name).toBe('echo "hello world"')
  })

  it('truncates long names to 40 chars with ellipsis', () => {
    const longPrompt = 'a'.repeat(50)
    const config = {
      version: 2,
      automations: {
        SessionStart: [{
          actions: [{ type: 'prompt', prompt: longPrompt }],
        }],
      },
    }
    const items = parseAutomationsConfig(config)
    expect(items[0].name).toBe('a'.repeat(40) + '...')
  })

  it('sets enabled: true when field is missing (default)', () => {
    const config = {
      version: 2,
      automations: {
        SessionStart: [{
          actions: [{ type: 'prompt', prompt: 'Run test' }],
        }],
      },
    }
    const items = parseAutomationsConfig(config)
    expect(items[0].enabled).toBe(true)
  })

  it('sets enabled: false when explicitly set', () => {
    const config = {
      version: 2,
      automations: {
        SessionStart: [{
          enabled: false,
          actions: [{ type: 'prompt', prompt: 'Run test' }],
        }],
      },
    }
    const items = parseAutomationsConfig(config)
    expect(items[0].enabled).toBe(false)
  })

  it('skips matchers with empty actions array', () => {
    const config = {
      version: 2,
      automations: {
        SessionStart: [
          { actions: [] },
          { actions: [{ type: 'prompt', prompt: 'valid' }] },
        ],
      },
    }
    const items = parseAutomationsConfig(config)
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('valid')
  })

  it('generates correct matcherIndex per event', () => {
    const config = {
      version: 2,
      automations: {
        SchedulerTick: [
          { actions: [{ type: 'prompt', prompt: 'a' }] },
          { actions: [{ type: 'prompt', prompt: 'b' }] },
          { actions: [{ type: 'prompt', prompt: 'c' }] },
        ],
      },
    }
    const items = parseAutomationsConfig(config)
    expect(items[0].matcherIndex).toBe(0)
    expect(items[1].matcherIndex).toBe(1)
    expect(items[2].matcherIndex).toBe(2)
  })

  it('generates unique IDs across events', () => {
    const config = {
      version: 2,
      automations: {
        SchedulerTick: [{ actions: [{ type: 'prompt', prompt: 'a' }] }],
        LabelAdd: [{ actions: [{ type: 'prompt', prompt: 'b' }] }],
        SessionStart: [{ actions: [{ type: 'prompt', prompt: 'c' }] }],
      },
    }
    const items = parseAutomationsConfig(config)
    const ids = items.map(i => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('preserves optional fields (matcher, cron, timezone, permissionMode, labels)', () => {
    const config = {
      version: 2,
      automations: {
        LabelAdd: [{
          matcher: 'urgent',
          permissionMode: 'ask',
          labels: ['important'],
          actions: [{ type: 'prompt', prompt: 'Handle it' }],
        }],
      },
    }
    const items = parseAutomationsConfig(config)
    expect(items[0].matcher).toBe('urgent')
    expect(items[0].permissionMode).toBe('ask')
    expect(items[0].labels).toEqual(['important'])
  })
})

describe('parseAutomationsConfig: script actions and load issues', () => {
  it('lists script automations (they run, so the screen must show them)', () => {
    const items = parseAutomationsConfig({
      automations: { SchedulerTick: [{ cron: '0 9 * * *', actions: [{ type: 'script', script: 'scripts/pull.ts', runtime: 'python3' }] }] },
    })
    expect(items).toHaveLength(1)
    expect(items[0].actions).toEqual([{ type: 'script', script: 'scripts/pull.ts', runtime: 'python3' }])
    expect(items[0].name).toBe('Script scripts/pull.ts')
    expect(items[0].issues).toBeUndefined()
  })

  it('attaches the server\'s issues to the row and keeps a row that has no showable action', () => {
    const items = parseAutomationsConfig({
      automations: {
        LabelAdd: [
          { id: 'old', matcher: '^urgent$', actions: [{ type: 'command', command: 'echo hi' }] },
          { id: 'ok', actions: [{ type: 'prompt', prompt: 'fine' }] },
        ],
      },
      [AUTOMATIONS_LOAD_ISSUES_KEY]: [
        { event: 'LabelAdd', index: 0, id: 'old', messages: ['Action 1 uses the removed "command" type; use a "script" action instead'] },
      ],
    })
    expect(items.map(i => i.id)).toEqual(['old', 'ok'])
    expect(items[0].actions).toEqual([])
    // A first action of an unknown type must not crash naming (it used to read .prompt)
    expect(items[0].name).toBe(getEventDisplayName('LabelAdd'))
    expect(items[0].issues).toEqual(['Action 1 uses the removed "command" type; use a "script" action instead'])
    expect(items[1].issues).toBeUndefined()
  })

  it('still skips a row with nothing to show when the server sends no issues (older servers)', () => {
    const items = parseAutomationsConfig({
      automations: { LabelAdd: [{ actions: [{ type: 'command', command: 'echo hi' }] }] },
    })
    expect(items).toEqual([])
  })

  it('skips non-object entries instead of crashing', () => {
    const items = parseAutomationsConfig({
      automations: { LabelAdd: [null, 'oops', { actions: [{ type: 'prompt', prompt: 'ok' }] }] },
    })
    expect(items.map(i => i.matcherIndex)).toEqual([2])
  })

  it('returns the issues no row shows, for the banner', () => {
    const json = {
      automations: {
        LabelAdd: [null, { actions: [{ type: 'prompt', prompt: 'ok' }] }],
      },
      [AUTOMATIONS_LOAD_ISSUES_KEY]: [
        { messages: ['automations.json is not valid JSON: Unexpected end'] },
        { event: 'LabelAdd', index: 0, messages: ['actions: Required'] },
        { event: 'LabelAdd', index: 1, name: 'Shown', messages: ['shown on its row'] },
      ],
    }
    const items = parseAutomationsConfig(json)
    expect(getUnattachedLoadIssues(json, items)).toEqual([
      'automations.json is not valid JSON: Unexpected end',
      'LabelAdd #1: actions: Required',
    ])
  })
})

describe('cron next-run timezone', () => {
  // A zone that is never the machine's own, so the test fails if the cron is evaluated in the local zone.
  const tz = 'Pacific/Kiritimati'

  it('computes next runs in the automation timezone, like the scheduler', () => {
    const [next] = computeNextRuns('0 9 * * *', 1, tz)
    expect(next).toBeDefined()
    const hour = next!.toLocaleString('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz })
    expect(Number(hour)).toBe(9)
  })

  it('shows the next run of a zoned automation at its own wall-clock time', () => {
    const [item] = parseAutomationsConfig({
      version: 2,
      automations: {
        SchedulerTick: [{ cron: '30 9 * * *', timezone: tz, actions: [{ type: 'prompt', prompt: 'standup' }] }],
      },
    })
    expect(item!.summary).toContain('9:30 AM')
    expect(item!.summary).toContain('(Kiritimati)')
  })
})
