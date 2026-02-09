export const LOCKED_TERMS = [
  'Skills',
  'Codex',
  'Claude Code',
  'MCP',
  'OAuth',
  'API',
  'OpenAI',
  'Anthropic',
  'G4 OS',
] as const

export type LockedTerm = (typeof LOCKED_TERMS)[number]

export function isLockedTerm(term: string): term is LockedTerm {
  return LOCKED_TERMS.includes(term as LockedTerm)
}

