const STOP_WORDS = new Set([
  'a',
  'agent',
  'agents',
  'and',
  'best',
  'for',
  'if',
  'one',
  'specialist',
  'the',
  'to',
]);

export interface AgentSearchCandidate {
  slug: string;
  name: string;
  description?: string;
  inputs?: string;
  outputs?: string;
  tags?: string[];
}

function searchableText(agent: AgentSearchCandidate): string {
  return [
    agent.slug,
    agent.name,
    agent.description,
    agent.inputs,
    agent.outputs,
    agent.tags?.join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function queryTokens(search: string): string[] {
  return Array.from(new Set(
    search
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .map(token => token.trim())
      .filter(token => token.length >= 3 && !STOP_WORDS.has(token)),
  ));
}

export function agentMatchesSearch(agent: AgentSearchCandidate, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;

  const haystack = searchableText(agent);
  if (haystack.includes(needle)) return true;

  const tokens = queryTokens(needle);
  if (tokens.length === 0) return false;
  return tokens.some(token => haystack.includes(token));
}
