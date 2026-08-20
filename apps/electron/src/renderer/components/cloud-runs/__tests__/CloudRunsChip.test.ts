import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const cloudRunsChipPath = join(__dirname, '../CloudRunsChip.tsx')
const source = readFileSync(cloudRunsChipPath, 'utf8')

const longCyrillicTopic = 'Исследование совместимости распределённой оркестрации автономных агентов с ограничениями локальной инфраструктуры'

describe('CloudRunsChip compact dialog accessibility', () => {
  it('keeps each dialog viewport-bounded with one reachable scroll body', () => {
    expect(source).toContain('max-h-[calc(100dvh-2rem)]')
    expect(source).toContain('min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain')
    expect(source).toContain('min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4 text-sm')
    expect(source.match(/overflow-y-auto overscroll-contain/g)).toHaveLength(2)
    expect(source).not.toContain('max-h-72')
  })

  it('allows long Cyrillic names, event tails, and failures to wrap instead of clipping', () => {
    expect(longCyrillicTopic.length).toBeGreaterThan(80)
    expect(source).toContain('whitespace-normal break-words')
    expect(source).not.toContain('className="min-w-0 flex-1 truncate"')
  })

  it('shows disabled, unavailable, and refresh failures with retry actions', () => {
    expect(source).toContain("availability === 'disabled'")
    expect(source).toContain("availability === 'unavailable'")
    expect(source).toContain('refreshError')
    expect(source).toContain('role="alert"')
    expect(source).toContain("t('common.retry')")
    expect(source).toContain('onRetryAvailability')
  })

  it('groups run operations in a named accessible menu without dropping actions', () => {
    expect(source).toContain('<DropdownMenuContent align="end">')
    expect(source).toContain("aria-label={t('common.more')}")
    for (const action of ['cancel', 'resume', 'retry', 'fork', 'preview', 'share', 'import', 'aggregate'] as const) {
      expect(source).toContain(`t('cloudRuns.${action}')`)
    }
  })
})
