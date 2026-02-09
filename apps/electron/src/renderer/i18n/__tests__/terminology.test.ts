import { describe, it, expect } from 'bun:test'
import { LOCKED_TERMS, isLockedTerm } from '../glossary'
import { ptBR } from '../locales/pt-BR'

function valueOf(entry: string | { value: string }) {
  return typeof entry === 'string' ? entry : entry.value
}

describe('terminology guardrails', () => {
  it('contains required locked terms', () => {
    expect(LOCKED_TERMS).toContain('Skills')
    expect(LOCKED_TERMS).toContain('Codex')
    expect(LOCKED_TERMS).toContain('Claude Code')
    expect(LOCKED_TERMS).toContain('MCP')
    expect(LOCKED_TERMS).toContain('OAuth')
    expect(LOCKED_TERMS).toContain('API')
    expect(LOCKED_TERMS).toContain('OpenAI')
    expect(LOCKED_TERMS).toContain('Anthropic')
    expect(LOCKED_TERMS).toContain('G4 OS')
  })

  it('keeps Skills untranslated in feature-name contexts', () => {
    expect(valueOf(ptBR['sidebar.nav.skills_feature'])).toBe('Skills')
    expect(valueOf(ptBR['sidebar.help.skills_feature'])).toBe('Skills')
    expect(valueOf(ptBR['sidebar.menu.addSkill_feature'])).toBe('Add Skill')
  })

  it('uses requested pt-BR terminology for sidebar and navigation labels', () => {
    expect(valueOf(ptBR['sidebar.nav.labels'])).toBe('Tags')
    expect(valueOf(ptBR['sidebar.nav.sources'])).toBe('Fontes')
    expect(valueOf(ptBR['sidebar.nav.settings'])).toBe('Configurações')
    expect(valueOf(ptBR['session.action.newSession'])).toBe('Nova Sessão')
  })

  it('validates locked term helper', () => {
    expect(isLockedTerm('Skills')).toBe(true)
    expect(isLockedTerm('Habilidades')).toBe(false)
  })
})
