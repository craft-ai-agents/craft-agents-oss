import type { AgentDefinitionDTO } from '../../shared/types'

export interface ConciergeAgentLaunchSuggestion {
  agent: AgentDefinitionDTO
  prompt: string
}

const PROMPT_LABEL_RE = /^\s*(?:exact\s+)?(?:prompt|suggested prompt|prompt to run|run this prompt)\s*:?\s*$/i

export function extractConciergeAgentLaunchSuggestion(
  text: string,
  agents: AgentDefinitionDTO[],
): ConciergeAgentLaunchSuggestion | null {
  const agent = findReferencedAgent(text, agents)
  if (!agent) return null

  const prompt = extractSuggestedPrompt(text)
  if (!prompt) return null

  return { agent, prompt }
}

function findReferencedAgent(text: string, agents: AgentDefinitionDTO[]): AgentDefinitionDTO | null {
  const bySlug = new Map(agents.map((agent) => [agent.slug.toLowerCase(), agent]))
  const mentions = new Set<string>()
  const mentionRe = /(^|[^\w/])@([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)(?=$|[^\w-])/gi
  let match: RegExpExecArray | null
  while ((match = mentionRe.exec(text)) !== null) {
    const slug = match[2]?.toLowerCase()
    if (slug && bySlug.has(slug)) mentions.add(slug)
  }

  if (mentions.size !== 1) return null
  const [slug] = mentions
  return slug ? bySlug.get(slug) ?? null : null
}

function extractSuggestedPrompt(text: string): string | null {
  const fenced = extractPromptFromFencedBlock(text)
  if (fenced) return fenced

  const quoted = extractPromptFromQuotedLine(text)
  if (quoted) return quoted

  const inline = extractPromptFromInlineLabel(text)
  if (inline) return inline

  return extractPromptFromLabeledBlock(text)
}

function extractPromptFromFencedBlock(text: string): string | null {
  const blockRe = /```[^\n`]*\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = blockRe.exec(text)) !== null) {
    const before = text.slice(Math.max(0, match.index - 120), match.index).toLowerCase()
    const body = match[1]?.trim()
    if (body && /\bprompt\b/.test(before)) return body
  }
  return null
}

function extractPromptFromQuotedLine(text: string): string | null {
  const match = text.match(/(?:exact\s+)?(?:prompt|suggested prompt|prompt to run|run this prompt)\s*:\s*["“]([^"”]+)["”]/i)
  return match?.[1]?.trim() || null
}

function extractPromptFromInlineLabel(text: string): string | null {
  const match = text.match(/(?:exact\s+)?(?:prompt|suggested prompt|prompt to run|run this prompt)\s*:\s*([^\n]+)/i)
  const value = match?.[1]?.replace(/^["“]|["”]$/g, '').trim()
  return value || null
}

function extractPromptFromLabeledBlock(text: string): string | null {
  const lines = text.split(/\r?\n/)
  const labelIndex = lines.findIndex((line) => PROMPT_LABEL_RE.test(line))
  if (labelIndex < 0) return null

  const promptLines: string[] = []
  for (const rawLine of lines.slice(labelIndex + 1)) {
    const line = rawLine.replace(/^\s{0,3}>\s?/, '').trimEnd()
    if (!line.trim()) {
      if (promptLines.length > 0) break
      continue
    }
    if (/^\s*(?:recommendation|agent|why|because|next)\b/i.test(line)) break
    promptLines.push(line)
  }

  return promptLines.join('\n').trim() || null
}
