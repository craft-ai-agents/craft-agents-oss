import type { MarkdownEntry } from '../markdown-entry-parser/index.ts';

export interface TeamKnowledgeSafety {
  instructionLike: boolean;
  action: 'full' | 'summarized';
  reasons: string[];
}

const INSTRUCTION_PATTERNS: readonly { reason: string; pattern: RegExp }[] = [
  { reason: 'ignore_or_override_instructions', pattern: /\b(ignore|disregard|override)\b.{0,80}\b(previous|prior|above|system|developer|user)\b.{0,80}\binstructions?\b/i },
  { reason: 'role_or_policy_override', pattern: /\b(system|developer|assistant)\s+(prompt|message|instruction|policy)\b/i },
  { reason: 'secret_or_token_request', pattern: /\b(reveal|print|exfiltrate|send|dump)\b.{0,80}\b(secret|token|api key|password|credential|private key)\b/i },
  { reason: 'dangerous_shell_command', pattern: /\b(rm\s+-rf|curl\b.+\|\s*(sh|bash)|chmod\s+777|sudo\s+rm|delete\s+all)\b/i },
  { reason: 'tool_or_network_command', pattern: /\b(run|execute|call|invoke)\b.{0,80}\b(tool|command|shell|terminal|http request|webhook)\b/i },
  { reason: 'prompt_injection_marker', pattern: /\b(prompt injection|jailbreak|do not mention this|hidden instructions?)\b/i },
];

const MAX_EXCERPT_LENGTH = 280;

export function analyzeTeamKnowledgeText(value: string): TeamKnowledgeSafety {
  const reasons = INSTRUCTION_PATTERNS
    .filter(({ pattern }) => pattern.test(value))
    .map(({ reason }) => reason);

  return {
    instructionLike: reasons.length > 0,
    action: reasons.length > 0 ? 'summarized' : 'full',
    reasons,
  };
}

export function createTeamKnowledgeExcerpt(value: string, maxLength: number = MAX_EXCERPT_LENGTH): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 16)).trimEnd()}... [truncated]`;
}

export function safeTeamKnowledgeSummary(entry: MarkdownEntry, source: string): {
  summary: string;
  excerpt: string;
  safety: TeamKnowledgeSafety;
} {
  const candidateText = [entry.summary, entry.content].filter(Boolean).join('\n\n');
  const safety = analyzeTeamKnowledgeText(candidateText);
  const excerpt = createTeamKnowledgeExcerpt(entry.content);

  if (!safety.instructionLike) {
    return {
      summary: entry.summary ?? excerpt,
      excerpt,
      safety,
    };
  }

  const label = entry.title ?? entry.term ?? entry.headingPath[entry.headingPath.length - 1] ?? entry.kind;
  return {
    summary: `Instruction-like team knowledge was summarized instead of injected verbatim. Entry "${label}" from "${source}" is ${entry.kind} reference data; inspect the entry by id for full content.`,
    excerpt: 'Instruction-like excerpt withheld from prefetch context.',
    safety,
  };
}
