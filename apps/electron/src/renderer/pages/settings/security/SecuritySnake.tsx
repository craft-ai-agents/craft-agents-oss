import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { SecurityDomain, SecurityDomainSummary } from '@craft-agent/shared/openclaw'

export const SECURITY_SNAKE_DOMAINS = [
  'ingress',
  'sessions',
  'tools',
  'secrets',
  'network',
  'extensions',
  'isolation',
] as const

export type SecuritySnakeDomain = (typeof SECURITY_SNAKE_DOMAINS)[number]

type SnakeDirection = 'left' | 'right' | 'center' | 'unknown'

const RISK_DIRECTION_BY_DOMAIN: Record<SecuritySnakeDomain, Exclude<SnakeDirection, 'center' | 'unknown'>> = {
  ingress: 'left',
  sessions: 'left',
  tools: 'right',
  secrets: 'right',
  network: 'left',
  extensions: 'right',
  isolation: 'right',
}

const SNAKE_POSITION_CLASSES = [
  'md:translate-y-0',
  'md:translate-y-3',
  'md:translate-y-0',
  'md:translate-y-3',
  'md:translate-y-0',
  'md:translate-y-3',
  'md:translate-y-0',
] as const

const SEVERITY_CLASSES: Record<SecurityDomainSummary['severity'], string> = {
  critical: 'border-destructive/60 bg-destructive/10 text-destructive',
  warn: 'border-amber-500/60 bg-amber-500/10 text-amber-800 dark:text-amber-200',
  info: 'border-sky-500/60 bg-sky-500/10 text-sky-800 dark:text-sky-200',
  pass: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
  unavailable: 'border-muted-foreground/50 bg-muted/40 text-muted-foreground',
}

export interface SecuritySnakeProps {
  readonly domains: readonly SecurityDomainSummary[]
  readonly selectedDomain: SecurityDomain | null
  readonly onSelectDomain: (domain: SecuritySnakeDomain | null) => void
}

/** Keeps `other` findings visible in the default list without inventing an eighth snake segment. */
export function filterSecurityFindings<T extends { readonly domain: SecurityDomain }>(
  findings: readonly T[],
  selectedDomain: SecurityDomain | null,
): readonly T[] {
  if (selectedDomain === null) return findings
  return findings.filter((finding) => finding.domain === selectedDomain)
}

export function SecuritySnake({ domains, selectedDomain, onSelectDomain }: SecuritySnakeProps) {
  const { t } = useTranslation()

  return (
    <section aria-labelledby="security-snake-heading" className="space-y-3">
      <div>
        <h3 id="security-snake-heading" className="text-sm font-semibold">
          {t('security.section.snake')}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">{t('security.snake.hint')}</p>
      </div>
      <ol className="grid grid-cols-1 gap-2 md:grid-cols-7 md:gap-1" aria-label={t('security.section.snake')}>
        {SECURITY_SNAKE_DOMAINS.map((domain, index) => {
          const summary = domains.find((entry) => entry.domain === domain)
          const coverage = summary?.coverage ?? 'none'
          const severity = summary?.severity ?? 'unavailable'
          const findingCount = summary?.findingCount ?? 0
          const direction: SnakeDirection =
            coverage !== 'complete'
              ? 'unknown'
              : severity === 'pass' || findingCount === 0
                ? 'center'
                : RISK_DIRECTION_BY_DOMAIN[domain]
          const selected = selectedDomain === domain
          const domainLabel = t(`security.snake.domain.${domain}`)
          const coverageLabel = t(`security.snake.coverage.${coverage}`)
          const severityLabel = t(`security.snake.status.${severity}`)
          const directionLabel = t(`security.snake.direction.${direction}`)
          const ariaLabel = t('security.snake.aria', {
            domain: domainLabel,
            status: severityLabel,
            coverage: coverageLabel,
            direction: directionLabel,
            count: findingCount,
          })

          return (
            <li key={domain} className={`min-w-0 ${SNAKE_POSITION_CLASSES[index]}`}>
              <button
                type="button"
                aria-pressed={selected}
                aria-label={ariaLabel}
                aria-keyshortcuts="Enter Space"
                data-direction={direction}
                onClick={() => onSelectDomain(selected ? null : domain)}
                className={`flex min-h-28 w-full min-w-0 flex-col items-start rounded-md border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  SEVERITY_CLASSES[severity]
                } ${
                  coverage === 'complete' ? 'border-solid' : 'border-dashed'
                } ${selected ? 'ring-2 ring-ring ring-offset-2 ring-offset-background' : ''}`}
              >
                <span className="break-words text-sm font-semibold">{domainLabel}</span>
                <span className="mt-1 break-words text-xs font-medium">{severityLabel}</span>
                <span className="break-words text-xs">{t('security.snake.findings', { count: findingCount })}</span>
                <span className="mt-auto break-words text-xs">{coverageLabel}</span>
                <span className="break-words text-xs">{directionLabel}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
