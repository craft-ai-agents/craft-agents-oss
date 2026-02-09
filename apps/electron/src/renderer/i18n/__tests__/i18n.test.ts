import { describe, it, expect } from 'bun:test'
import { format } from 'date-fns'
import { translate, getDateFnsLocale } from '../index'
import { ptBR } from '../locales/pt-BR'

describe('i18n runtime', () => {
  it('returns localized strings for pt-BR', () => {
    expect(translate('pt-BR', 'settings.app.section.language')).toBe('Idioma')
  })

  it('interpolates dynamic parameters', () => {
    expect(
      translate('pt-BR', 'settings.app.about.updateToVersion', { version: '1.2.3' })
    ).toBe('Atualizar para 1.2.3')
  })

  it('falls back to en-US when current locale key is missing', () => {
    const key = 'menu.action.quit'
    const previous = ptBR[key]
    try {
      // Simulate missing current-locale translation at runtime
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (ptBR as any)[key]
      expect(translate('pt-BR', key)).toBe('Quit G4 OS')
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(ptBR as any)[key] = previous
    }
  })

  it('maps date locale to pt-BR', () => {
    const month = format(new Date('2026-01-15T00:00:00.000Z'), 'MMMM', {
      locale: getDateFnsLocale('pt-BR'),
    })
    expect(month.toLowerCase()).toContain('jane')
  })
})
