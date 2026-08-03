import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'bun:test'
import { OwnerAgentShell } from './OwnerAgentShell'
import type { OwnerAgentShellState } from './OwnerAgentShell'

describe('OwnerAgentShell', () => {
  it('renders the command workspace with runtime, scope, run state, and primary destinations', () => {
    const html = renderToStaticMarkup(<OwnerAgentShell />)

    expect(html).toContain('Owner Agent navigation')
    expect(html).toContain('Command')
    expect(html).toContain('Runs')
    expect(html).toContain('Projects')
    expect(html).toContain('Memory')
    expect(html).toContain('Media Lab')
    expect(html).toContain('Integrations')
    expect(html).toContain('Settings')
    expect(html).toContain('Owner Auto')
    expect(html).toContain('data-state="streaming"')
    expect(html).toContain('GPT-5.6 Codex')
    expect(html).toContain('aria-live="polite"')
  })

  it.each([
    ['loading', 'Preparing your command workspace'],
    ['empty', 'What should we tackle?'],
    ['active', 'Baseline repair complete'],
    ['streaming', 'Working through validation'],
    ['tool-running', 'Running validation'],
    ['permission', 'Approval needed'],
    ['error', 'Run failed'],
    ['disconnected', 'Runtime disconnected'],
  ] as const)('renders the %s workspace state', (state, expectedText) => {
    const html = renderToStaticMarkup(<OwnerAgentShell state={state} />)

    expect(html).toContain(`data-state="${state}"`)
    expect(html).toContain(expectedText)
  })

  it.each(['loading', 'empty', 'active', 'permission', 'error', 'disconnected'] as const)(
    'does not offer a stop action in the %s state',
    (state) => {
      const html = renderToStaticMarkup(<OwnerAgentShell state={state} />)

      expect(html).not.toContain('aria-label="Stop current run"')
      expect(html).toContain('aria-label="Send command"')
    },
  )

  it.each(['streaming', 'tool-running'] as const)(
    'shows stop + queue in the %s state',
    (state) => {
      const html = renderToStaticMarkup(<OwnerAgentShell state={state} />)

      expect(html).toContain('aria-label="Stop current run"')
      expect(html).toContain('aria-label="Queue follow-up"')
    },
  )

  // State-sensitive chrome: health, footer, session status
  it('shows healthy runtime and All systems ready in streaming state', () => {
    const html = renderToStaticMarkup(<OwnerAgentShell state="streaming" />)

    expect(html).toContain('All systems ready')
    expect(html).toContain('4 local services')
    expect(html).toContain('is-running')
    expect(html).not.toContain('is-degraded')
  })

  it('shows degraded health and runtime offline in disconnected state', () => {
    const html = renderToStaticMarkup(<OwnerAgentShell state="disconnected" />)

    expect(html).toContain('Runtime offline')
    expect(html).toContain('0 connected')
    expect(html).toContain('is-degraded')
    expect(html).toContain('is-disconnected')
    expect(html).not.toContain('All systems ready')
  })

  it('shows degraded health and Last run failed in error state', () => {
    const html = renderToStaticMarkup(<OwnerAgentShell state="error" />)

    expect(html).toContain('Last run failed')
    expect(html).toContain('is-degraded')
    expect(html).toContain('is-failed')
    expect(html).not.toContain('All systems ready')
  })

  it('shows loading health and Connecting in loading state', () => {
    const html = renderToStaticMarkup(<OwnerAgentShell state="loading" />)

    expect(html).toContain('Connecting')
    expect(html).toContain('is-loading')
    expect(html).not.toContain('All systems ready')
  })

  it('shows Awaiting approval in permission state', () => {
    const html = renderToStaticMarkup(<OwnerAgentShell state="permission" />)

    expect(html).toContain('Awaiting approval')
    expect(html).toContain('is-paused')
  })

  it('shows completed session status in active state', () => {
    const html = renderToStaticMarkup(<OwnerAgentShell state="active" />)

    expect(html).toContain('is-complete')
    expect(html).toContain('Verified · 127 tests')
  })

  // Accessibility: filter tabs use role=tab + aria-selected
  it('uses tab role and aria-selected for session filters', () => {
    const html = renderToStaticMarkup(<OwnerAgentShell state="active" />)

    expect(html).toContain('role="tablist"')
    expect(html).toContain('role="tab"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('aria-selected="false"')
  })

  // Accessibility: selected session uses aria-current
  it('uses aria-current for the selected session', () => {
    const html = renderToStaticMarkup(<OwnerAgentShell state="active" />)

    expect(html).toContain('aria-current="true"')
  })

  // Accessibility: transcript is aria-live
  it('has an aria-live polite region for the transcript', () => {
    const html = renderToStaticMarkup(<OwnerAgentShell state="permission" />)

    expect(html).toContain('aria-live="polite"')
  })
})
