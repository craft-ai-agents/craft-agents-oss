#!/usr/bin/env node
/**
 * craft-runner v2 — baked into the RunAgent image at /opt/craft-runner/.
 *
 * Agent-loop research runner (F4-B) with structured artifacts (F5).
 * Executes a PACK of subtasks concurrently in-process:
 *   node /opt/craft-runner/runner.mjs <workspaceRoot> [configName]
 *
 * Config (<workspaceRoot>/.craft-run/<configName>):
 *   { baseUrl, apiKey, model, concurrency, agentic?: boolean,
 *     subtasks: [{id,title,prompt, model?}] }
 *
 * Per subtask (when agentic !== false): bounded tool-loop — LLM may call
 * web_search / fetch_url (OpenAI tools) up to 6 rounds, then emit a
 * final structured JSON brief {summary, claims[{text,confidence,sources}], links[]}
 * rendered into answer.md (+ brief.json + trace.jsonl). Falls back to the
 * one-shot path automatically when the model doesn't do tool calls.
 *
 * Markers per subtask drive the DO state machine. Process exit: 0 whenever
 * the pack loop survived; outcomes ride on done/fail markers.
 */
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const workspaceRoot = process.argv[2];
if (!workspaceRoot) {
  console.error('usage: runner.mjs <workspaceRoot> [configName]');
  process.exit(2);
}

const configName = process.argv[3] ?? 'config.json';
const config = JSON.parse(await readFile(join(workspaceRoot, '.craft-run', configName), 'utf8'));
const { baseUrl, apiKey, model } = config;
const subtasks = config.subtasks ?? (config.subtask ? [config.subtask] : null);
if (!baseUrl || !model || !Array.isArray(subtasks) || subtasks.length === 0) {
  console.error('config missing baseUrl/model/subtasks');
  process.exit(2);
}
const concurrency = Math.min(Math.max(config.concurrency ?? 2, 1), 4);
const agentic = config.agentic !== false;
const usageDir = join(workspaceRoot, 'artifacts', '_usage');
await mkdir(usageDir, { recursive: true });

const API = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
const authHeaders = () => (apiKey ? { authorization: `Bearer ${apiKey}` } : {});

const BASE_SYSTEM_PROMPT =
  'You are a research sub-agent. Investigate the subtask with the given tools, then answer thoroughly. Be factual, structured, cite sources.';

// F7: prior-run briefs in <workspaceRoot>/context — short digest into the prompt.
async function loadContextDigest(root) {
  try {
    const { readdir } = await import('node:fs/promises');
    const dir = join(root, 'context');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).slice(0, 12);
    if (files.length === 0) return '';
    const parts = [];
    for (const file of files) {
      const content = (await readFile(join(dir, file), 'utf8')).slice(0, 1500);
      parts.push(`### ${file}\n${content}`);
    }
    return `\n\nPRIOR RESEARCH CONTEXT (from a related previous run — build on it, do not repeat it):\n\n${parts.join('\n\n---\n\n')}`.slice(0, 20000);
  } catch {
    return '';
  }
}

const contextDigest = await loadContextDigest(workspaceRoot);
const SYSTEM_PROMPT = BASE_SYSTEM_PROMPT + contextDigest;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web. Returns titles, links and snippets.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetch a web page and return extracted plain text (first ~8000 chars).',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
      },
    },
  },
];

const MAX_TOOL_ROUNDS = 6;

// ----------------------------------------------------------
// tools

async function webSearch(query) {
  // DuckDuckGo HTML: no key, good enough for tool-loop grounding.
  // TAVILY_API_KEY (gateway env) upgrades accuracy when present.
  if (config.tavilyApiKey) {
    try {
      const resp = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ api_key: config.tavilyApiKey, query, max_results: 5 }),
      });
      const data = await resp.json();
      return (data.results ?? [])
        .map((r) => `- ${r.title}\n  ${r.url}\n  ${(r.content ?? '').slice(0, 300)}`)
        .join('\n') || 'no results';
    } catch (error) {
      return `tavily error: ${error instanceof Error ? error.message : String(error)} (falling back to ddg)`;
    }
  }
  try {
    const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    });
    const html = await resp.text();
    const results = [];
    const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snipRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    const links = [...html.matchAll(linkRe)].slice(0, 5);
    const snippets = [...html.matchAll(snipRe)].slice(0, 5);
    const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").trim();
    for (let i = 0; i < links.length; i++) {
      const href = links[i][1].replace(/.*uddg=/, '').split('&')[0];
      results.push(`- ${strip(links[i][2])}\n  ${decodeURIComponent(href)}\n  ${snippets[i] ? strip(snippets[i][1]).slice(0, 300) : ''}`);
    }
    return results.join('\n') || 'no results';
  } catch (error) {
    return `search error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function fetchUrl(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) return `fetch error: HTTP ${resp.status}`;
    if ((resp.headers.get('content-type') ?? '').includes('html') === false) {
      return `fetch error: non-HTML content (${resp.headers.get('content-type')})`;
    }
    const html = await resp.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > 0 ? text.slice(0, 8000) : 'empty page';
  } catch (error) {
    return `fetch error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ----------------------------------------------------------
// LLM calls

async function llm(messages, { useTools, jsonMode, modelOverride } = {}) {
  const body = {
    model: modelOverride ?? model,
    stream: false,
    messages,
    ...(useTools ? { tools: TOOLS, tool_choice: 'auto' } : {}),
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    signal: AbortSignal.timeout(570_000),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err = new Error(`LLM gateway error ${response.status}: ${text.slice(0, 400)}`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

function messageContent(payload) {
  return payload?.choices?.[0]?.message?.content ?? '';
}

// ----------------------------------------------------------
// per-subtask pipeline

async function researchLoop(subtask, trace) {
  const modelOverride = subtask.model?.modelId;
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: subtask.prompt },
  ];
  let acted = false;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const payload = await llm(messages, { useTools: true, modelOverride });
    const message = payload?.choices?.[0]?.message ?? {};
    await trace({ round, kind: 'assistant', tool_calls: message.tool_calls?.length ?? 0, content: (message.content ?? '').slice(0, 200) });
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      acted = true;
      messages.push(message);
      for (const call of message.tool_calls) {
        let args = {};
        try { args = JSON.parse(call.function?.arguments ?? '{}'); } catch { /* keep {} */ }
        let result;
        if (call.function?.name === 'web_search') {
          result = await webSearch(String(args.query ?? ''));
        } else if (call.function?.name === 'fetch_url') {
          result = await fetchUrl(String(args.url ?? ''));
        } else {
          result = `unknown tool: ${call.function?.name}`;
        }
        await trace({ round, kind: 'tool', name: call.function?.name, args, result: result.slice(0, 200) });
        messages.push({ role: 'tool', tool_call_id: call.id, content: result });
      }
      continue;
    }
    // No tool calls → the model finished on its own.
    return { acted, text: message.content ?? '', usage: payload?.usage ?? null };
  }
  return { acted, text: '', usage: null, roundsExhausted: true };
}

const STRUCTURED_INSTRUCTION = `
Now deliver the final structured brief as ONE JSON object, nothing else:
{
  "summary": "3-5 sentence executive summary",
  "claims": [{"text": "factual claim", "confidence": "high|medium|low", "sources": ["https://url"]}],
  "links": [{"title": "source title", "url": "https://url"}]
}`;

function renderMarkdown(subtask, briefJson, fallbackText) {
  if (!briefJson) {
    return [`# ${subtask.title ?? subtask.id}`, '', '## Prompt', '', subtask.prompt, '', '## Brief', '', fallbackText, ''].join('\n');
  }
  const lines = [`# ${subtask.title ?? subtask.id}`, '', '## Prompt', '', subtask.prompt, '', '## Summary', '', briefJson.summary ?? fallbackText, ''];
  if (Array.isArray(briefJson.claims) && briefJson.claims.length > 0) {
    lines.push('## Key claims', '');
    for (const c of briefJson.claims) {
      lines.push(`- **[${c.confidence ?? 'medium'}]** ${c.text}`);
      for (const s of c.sources ?? []) lines.push(`  - ${s}`);
    }
    lines.push('');
  }
  if (Array.isArray(briefJson.links) && briefJson.links.length > 0) {
    lines.push('## Sources', '');
    for (const l of briefJson.links) lines.push(`- [${l.title ?? l.url}](${l.url})`);
    lines.push('');
  }
  return lines.join('\n');
}

async function runSubtask(subtask) {
  const outDir = join(workspaceRoot, 'artifacts', subtask.id);
  const startedAt = Date.now();
  await mkdir(outDir, { recursive: true });
  const tracePath = join(outDir, 'trace.jsonl');
  const trace = async (event) => appendFile(tracePath, JSON.stringify({ t: Date.now(), ...event }) + '\n').catch(() => {});

  const finish = async (kind, error) => {
    const durationMs = Date.now() - startedAt;
    await writeFile(
      join(outDir, kind === 'done' ? 'done.marker' : 'fail.marker'),
      JSON.stringify(kind === 'done' ? { finishedAt: new Date().toISOString(), durationMs } : { error: String(error).slice(0, 1000), durationMs }) + '\n',
    );
  };

  try {
    try {
      await readFile(join(outDir, 'done.marker'), 'utf8');
      return true; // previous attempt finished this subtask
    } catch { /* not done yet */ }

    let acted = false;
    let loopText = '';
    let usage = null;
    let totalTokens = { prompt: 0, completion: 0 };
    const accumulate = (u) => {
      if (u) {
        totalTokens.prompt += u.prompt_tokens ?? 0;
        totalTokens.completion += u.completion_tokens ?? 0;
        usage = { prompt_tokens: totalTokens.prompt, completion_tokens: totalTokens.completion };
      }
    };

    if (agentic) {
      const result = await researchLoop(subtask, trace);
      acted = result.acted;
      loopText = result.text;
      accumulate(result.usage);
    } else {
      const payload = await llm([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: subtask.prompt },
      ], { modelOverride });
      loopText = messageContent(payload);
      accumulate(payload?.usage);
    }
    if (!loopText && !acted) throw new Error('LLM gateway returned no content');

    // F5: structured pass (JSON); falls back to free text when the model
    // doesn't do JSON-mode — brief.json is then absent by design.
    let briefJson = null;
    try {
      const structPayload = await llm(
        [
          { role: 'system', content: 'You summarize research into strict JSON.' },
          {
            role: 'user',
            content: `Subtask: ${subtask.prompt}\n\nResearch material:\n${loopText.slice(0, 12000)}\n${STRUCTURED_INSTRUCTION}`,
          },
        ],
        { jsonMode: true },
      );
      accumulate(structPayload?.usage);
      briefJson = JSON.parse(messageContent(structPayload) || 'null');
    } catch {
      briefJson = null;
    }

    if (briefJson) {
      await writeFile(join(outDir, 'brief.json'), JSON.stringify(briefJson, null, 2) + '\n');
    }
    await writeFile(join(outDir, 'answer.md'), renderMarkdown(subtask, briefJson, loopText));
    // F16: optional slide deck from the brief (CF image only — modal
    // sandbox image carries no marp, so the DO must not request it there).
    if (Array.isArray(config.outputs) && config.outputs.includes('slides')) {
      try {
        await execFileAsync('marp', ['--html', '--no-stdin', join(outDir, 'answer.md'), '-o', join(outDir, 'slides.html')], { timeout: 120_000 });
      } catch (error) {
        await trace({ kind: 'slides_error', message: error instanceof Error ? error.message : String(error) });
      }
    }
    await writeFile(
      join(usageDir, `${subtask.id}.json`),
      JSON.stringify({ ...(usage ?? { note: 'usage unavailable' }), durationMs: Date.now() - startedAt }) + '\n',
    );
    await finish('done');
    console.log(`subtask ${subtask.id} done (agentic=${agentic && acted})`);
    return true;
  } catch (error) {
    await trace({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    await finish('fail', error instanceof Error ? error.message : String(error));
    return false;
  }
}

let failures = 0;
for (let i = 0; i < subtasks.length; i += concurrency) {
  const batch = subtasks.slice(i, i + concurrency);
  const results = await Promise.all(batch.map((s) => runSubtask(s)));
  failures += results.filter((r) => !r).length;
}
console.log(`pack done: ${subtasks.length - failures}/${subtasks.length} subtasks ok`);
