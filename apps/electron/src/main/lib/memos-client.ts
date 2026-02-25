/**
 * MemOS Cloud HTTP client (OpenMem API).
 * Used in main process for searchMemory and addMemory.
 */

const DEFAULT_BASE_URL = 'https://memos.memtensor.cn/api/openmem/v1';
const TIMEOUT_MS = 8000;
const RETRIES = 1;

export interface MemosCredentials {
  apiKey: string;
  userId: string;
  baseUrl?: string;
}

export interface MemorySearchResult {
  facts: Array<{
    id: string;
    text: string;
    createTime?: string;
    confidence?: number;
  }>;
  preferences: Array<{
    id: string;
    text: string;
    type?: string;
  }>;
}

async function callApi<T>(
  credentials: MemosCredentials,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  if (!credentials.apiKey) throw new Error('MEMOS_API_KEY not set');
  const baseUrl = credentials.baseUrl || DEFAULT_BASE_URL;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token ${credentials.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return (await res.json()) as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < RETRIES) {
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

function extractData(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const data = r.data as Record<string, unknown> | undefined;
  return data ?? null;
}

/**
 * Search memory by query. Returns facts and preferences.
 */
export async function searchMemory(
  credentials: MemosCredentials,
  query: string,
  limit = 6,
): Promise<MemorySearchResult> {
  const result = await callApi<unknown>(credentials, '/search/memory', {
    user_id: credentials.userId,
    query,
    source: 'craft-agents',
    memory_limit_number: limit,
    include_preference: true,
    preference_limit_number: limit,
  });

  const data = extractData(result);
  if (!data) return { facts: [], preferences: [] };

  const memories = (data.memory_detail_list as Array<Record<string, unknown>>) ?? [];
  const prefs = (data.preference_detail_list as Array<Record<string, unknown>>) ?? [];

  return {
    facts: memories
      .map((item) => ({
        id: String(item.id ?? ''),
        text: String(item.memory_value || item.memory_key || ''),
        createTime: item.create_time ? String(item.create_time) : undefined,
        confidence:
          typeof item.confidence === 'number' ? item.confidence : undefined,
      }))
      .filter((f) => f.text),
    preferences: prefs
      .map((item) => ({
        id: String(item.id ?? ''),
        text: String(item.preference ?? ''),
        type: item.preference_type ? String(item.preference_type) : undefined,
      }))
      .filter((p) => p.text),
  };
}

/**
 * Format search result as text for prompt injection.
 */
export function formatSearchResult(result: MemorySearchResult): string {
  const lines: string[] = [];
  if (result.facts.length > 0) {
    lines.push('## Facts');
    for (const item of result.facts) {
      const time = item.createTime
        ? new Date(item.createTime).toLocaleString()
        : '';
      lines.push(time ? `- [${time}] ${item.text}` : `- ${item.text}`);
    }
  }
  if (result.preferences.length > 0) {
    lines.push('\n## Preferences');
    for (const item of result.preferences) {
      lines.push(item.type ? `- (${item.type}) ${item.text}` : `- ${item.text}`);
    }
  }
  return lines.length > 0 ? lines.join('\n') : 'No memories found.';
}

/**
 * Add a message pair for async memory extraction (OpenMem backend).
 */
export async function addMemory(
  credentials: MemosCredentials,
  params: {
    userMessage: string;
    assistantMessage?: string;
    conversationId?: string;
    tags?: string[];
  },
): Promise<void> {
  const messages: Array<{ role: string; content: string }> = [
    { role: 'user', content: params.userMessage },
  ];
  if (params.assistantMessage) {
    messages.push({ role: 'assistant', content: params.assistantMessage });
  }
  await callApi<unknown>(credentials, '/add/message', {
    user_id: credentials.userId,
    conversation_id: params.conversationId ?? `craft-${Date.now()}`,
    messages,
    source: 'craft-agents',
    tags: params.tags ?? ['craft-agents'],
    async_mode: true,
    info: { source: 'craft-agents-builtin' },
  });
}
