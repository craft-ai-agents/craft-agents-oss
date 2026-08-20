import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  filterSecurityFindings,
  SECURITY_SNAKE_DOMAINS,
  type SecuritySnakeDomain,
} from '../security/SecuritySnake'

type Finding = { fingerprint: string; domain: SecuritySnakeDomain | 'other' }

const findings: readonly Finding[] = [
  { fingerprint: 'ingress-1', domain: 'ingress' },
  { fingerprint: 'tools-1', domain: 'tools' },
  { fingerprint: 'other-1', domain: 'other' },
]

describe('SecuritySnake semantics', () => {
  it('defines exactly the documented seven dashboard domains in order', () => {
    expect(SECURITY_SNAKE_DOMAINS).toEqual([
      'ingress',
      'sessions',
      'tools',
      'secrets',
      'network',
      'extensions',
      'isolation',
    ])
    expect(SECURITY_SNAKE_DOMAINS).not.toContain('other')
  })

  it('filters only after a snake segment is selected and preserves other findings in the unfiltered list', () => {
    expect(filterSecurityFindings(findings, null)).toBe(findings)
    expect(filterSecurityFindings(findings, 'tools')).toEqual([{ fingerprint: 'tools-1', domain: 'tools' }])
    expect(filterSecurityFindings(findings, 'other')).toEqual([{ fingerprint: 'other-1', domain: 'other' }])
  })

  it('uses native buttons with text and pressed/keyboard semantics rather than color-only controls', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'security', 'SecuritySnake.tsx'), 'utf8')

    expect(source).toContain('type="button"')
    expect(source).toContain('aria-pressed={selected}')
    expect(source).toContain('aria-label={ariaLabel}')
    expect(source).toContain('aria-keyshortcuts="Enter Space"')
    expect(source).toContain("t(`security.snake.domain.${domain}`)")
    expect(source).toContain("t('security.snake.hint')")
  })

  it('waits for a medium-width layout before seven columns and permits Russian labels to wrap', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'security', 'SecuritySnake.tsx'), 'utf8')

    expect(source).toContain('md:grid-cols-7')
    expect(source).not.toContain('sm:grid-cols-7')
    expect(source).toContain('min-w-0')
    expect(source).toContain('break-words')
  })
})
