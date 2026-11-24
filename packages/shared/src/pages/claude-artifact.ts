/**
 * "Publish as Claude artifact" — puts a page on claude.ai as an artifact.
 *
 * Claude Code's built-in `Artifact` tool is the only publish path (no CLI
 * subcommand, no model-free control request), so one tightly scoped SDK query
 * runs it: only the Artifact tool, pre-approved (`permissionMode: 'dontAsk'`),
 * no filesystem settings (the user's own Claude Code hooks/permissions stay out),
 * no MCP servers (Claude Code would otherwise connect the account's claude.ai
 * connectors), a temp working folder holding just the HTML, and a cheap model.
 * The outcome is read from the tool's structured output (`tool_use_result.url` /
 * `artifact_id`), never from the model's text.
 *
 * The query authenticates like Craft's chats: the caller passes the Claude
 * account connection's auth env (`CLAUDE_CODE_OAUTH_TOKEN`), and every other
 * Claude credential in the host env is dropped. SDK sessions get no Artifact
 * tool unless `CLAUDE_CODE_ARTIFACT=1` (Claude Code's `sdk_default_off` gate,
 * verified on SDK 0.3.296); the account's plan and its organization's policy
 * still decide whether the tool appears.
 *
 * The published copy is the page's index.html with a bridge shim injected as its
 * first script. On claude.ai there is no Craft host to answer the
 * `craft-pages/v1` bridge, so the shim plays that role: it answers `ready` with
 * the page's `init` (the current data snapshot, no grants), declines source
 * actions like Craft's public share does, and opens links in a new tab.
 *
 * Node-only (SDK + fs): import from '@craft-agent/shared/pages/claude-artifact',
 * never from the pages barrel the renderer uses.
 */
import { query as sdkQuery, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { PageClaudeArtifactInfo, PageConfig, PageKind } from '@craft-agent/core';
import { CLAUDE_AUTH_ENV_KEYS, getDefaultOptions } from '../agent/options.ts';
import { isAdaptiveThinkingAlwaysOnModel } from '../config/models.ts';
import {
  computePageContentDigest,
  getPageSnapshotPath,
  loadPageConfig,
  loadPageContent,
  setPageClaudeArtifactState,
} from './storage.ts';

/** claude.ai artifacts are single HTML files; keep the published copy well under typical limits. */
export const CLAUDE_ARTIFACT_MAX_HTML_BYTES = 5 * 1024 * 1024;

const PUBLISH_TIMEOUT_MS = 3 * 60_000;

export type ClaudeArtifactErrorCode =
  | 'PAGE_NOT_FOUND'
  | 'PAGE_NO_CONTENT'
  | 'ARTIFACT_TOO_LARGE'
  | 'ARTIFACT_UNAVAILABLE'
  | 'ARTIFACT_AUTH_REQUIRED'
  | 'ARTIFACT_CONFLICT'
  | 'ARTIFACT_PUBLISH_FAILED';

/** Typed error (code survives transport as the message prefix, like PageShareError). */
export class ClaudeArtifactError extends Error {
  constructor(
    public readonly code: ClaudeArtifactErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'ClaudeArtifactError';
  }
}

/** JSON safe to embed inside an inline <script> (no `</script>`, no line separators). */
function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}

/**
 * The page's HTML with the claude.ai bridge shim as its first script.
 * Pure: `snapshot` is the parsed data/snapshot.json (or null).
 */
export function buildClaudeArtifactHtml(
  content: string,
  page: { slug: string; kind: PageKind },
  snapshot: unknown,
): string {
  const shim = `<script data-craft-artifact-bridge>
(function () {
  var P = 'craft-pages/v1';
  var INIT = { page: ${scriptSafeJson({ slug: page.slug, kind: page.kind })}, nonce: 'claude-artifact', snapshot: ${scriptSafeJson(snapshot ?? null)}, grants: [] };
  function deliver(type, payload) {
    window.dispatchEvent(new MessageEvent('message', { data: { protocol: P, type: type, payload: payload } }));
  }
  // Published copy: no Craft host. Answer the bridge here, view-only.
  var host = {
    postMessage: function (msg) {
      if (!msg || msg.protocol !== P) return;
      setTimeout(function () {
        if (msg.type === 'ready') deliver('init', INIT);
        else if (msg.type === 'grant-request') deliver('grants', { grants: [] });
        else if (msg.type === 'action') deliver('action-result', { result: { requestId: msg.requestId, ok: false, error: 'Source actions are not available in a published copy.', durationMs: 0 } });
        else if (msg.type === 'open-url' && typeof msg.url === 'string' && /^https?:\\/\\//.test(msg.url)) window.open(msg.url, '_blank', 'noopener');
      }, 0);
    }
  };
  try { Object.defineProperty(window, 'parent', { value: host, configurable: true }); } catch (e) {}
  // Like Craft's host, also deliver init once the page has loaded.
  window.addEventListener('load', function () { setTimeout(function () { deliver('init', INIT); }, 0); });
})();
</script>`;

  const headOpen = content.match(/<head[^>]*>/i);
  if (headOpen?.index !== undefined) {
    const at = headOpen.index + headOpen[0].length;
    return content.slice(0, at) + '\n' + shim + content.slice(at);
  }
  const htmlOpen = content.match(/<html[^>]*>/i);
  if (htmlOpen?.index !== undefined) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return content.slice(0, at) + '\n<head>' + shim + '</head>' + content.slice(at);
  }
  return shim + '\n' + content;
}

/** Inputs for the Claude Code query that runs the Artifact tool. */
export interface ClaudeArtifactPublishRequest {
  filePath: string;
  title: string;
  description?: string;
  /** Existing artifact to update in place */
  existingUrl?: string;
}

function buildPublishPrompt(request: ClaudeArtifactPublishRequest): string {
  const fields = [
    `- file_path: ${JSON.stringify(request.filePath)}`,
    `- title: ${JSON.stringify(request.title)}`,
    ...(request.description ? [`- description: ${JSON.stringify(request.description)}`] : []),
    ...(request.existingUrl
      ? [`- url: ${JSON.stringify(request.existingUrl)}`]
      : ['- icon: one short generic word that fits the title (for example chart, calendar, list, map)']),
  ];
  return [
    'Publish this file as a Claude artifact. Call the Artifact tool (action "publish") with:',
    ...fields,
    '',
    request.existingUrl
      ? 'This updates the existing artifact at that url. First call the Artifact tool with {"action":"read","url":' +
        JSON.stringify(request.existingUrl) +
        '}, then publish the file with that url. Publish the file exactly as it is: do not edit, merge or rewrite it. ' +
        'If the publish is refused because the artifact changed elsewhere, stop and reply with only the word CONFLICT.'
      : 'Publish the file exactly as it is: do not edit or rewrite it.',
    'Use no other tool. When the publish succeeds, reply with only the artifact URL.',
  ].join('\n');
}

/** Inherited when Craft itself runs inside a Claude Code session; they would make the CLI that session's child. */
const NESTED_SESSION_ENV_KEYS = ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID'] as const;

/**
 * Env for the publishing query: `baseEnv` without Claude credentials, routing
 * ({@link CLAUDE_AUTH_ENV_KEYS}) or nested-session markers, plus the publishing
 * connection's `authEnv` (the Artifact tool needs a claude.ai account) and the
 * Artifact opt-in.
 */
export function claudeArtifactEnv(
  baseEnv: Record<string, string | undefined>,
  authEnv: Record<string, string>,
): Record<string, string> {
  const drop = new Set<string>([...CLAUDE_AUTH_ENV_KEYS, ...NESTED_SESSION_ENV_KEYS]);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value !== undefined && !drop.has(key)) out[key] = value;
  }
  return { ...out, ...authEnv, CLAUDE_CODE_ARTIFACT: '1' };
}

export const CLAUDE_ARTIFACT_AUTH_REQUIRED_MESSAGE =
  'Your Claude account connection needs to sign in again. Reconnect it in Settings → AI, then publish again.';

/** Whether a failure text means the Claude account credential was rejected. */
export function isClaudeAuthFailure(text: string): boolean {
  return /failed to authenticate|oauth access token is invalid|not logged in|please run \/login|claude\.ai login|invalid api key|authentication_failed/i.test(text);
}

/** A tool error made readable for the UI: no `<tool_use_error>` wrapper, first sentence only. */
function toolErrorSummary(text: string): string {
  const clean = text.replace(/<\/?tool_use_error>/g, '').trim();
  const sentence = clean.match(/^[\s\S]*?[.!?](?=\s|$)/)?.[0] ?? clean;
  return sentence.length > 300 ? `${sentence.slice(0, 299)}…` : sentence;
}

/** Minimal SDK `query` shape (injectable for tests). */
export type ClaudeArtifactQueryFn = (args: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

export interface ClaudeArtifactRunOptions {
  /** Model for the publishing turn (a cheap utility model) */
  model: string;
  /** Working folder for the query (the temp folder holding the file) */
  cwd: string;
  /** The Claude account connection's auth env (`resolveAuthEnvVars`), e.g. CLAUDE_CODE_OAUTH_TOKEN */
  authEnv: Record<string, string>;
  signal?: AbortSignal;
  query?: ClaudeArtifactQueryFn;
}

interface ArtifactPublishOutput {
  url: string;
  artifactId?: string;
  title?: string;
}

function isPublishOutput(value: unknown): value is { url: string; path: string; artifact_id?: string; title?: string } {
  return typeof value === 'object' && value !== null
    && typeof (value as { url?: unknown }).url === 'string'
    && typeof (value as { path?: unknown }).path === 'string';
}

function toolResultText(block: { content?: unknown }): string {
  const { content } = block;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => (typeof part === 'object' && part && 'text' in part ? String((part as { text: unknown }).text) : '')).join('\n');
  }
  return '';
}

/**
 * Run the scoped Claude Code query and return the publish result. Throws
 * ClaudeArtifactError: ARTIFACT_AUTH_REQUIRED when the connection's credential
 * is rejected, ARTIFACT_UNAVAILABLE when the account (its plan or its
 * organization's policy) has no artifacts, ARTIFACT_CONFLICT when the artifact
 * changed on claude.ai, ARTIFACT_PUBLISH_FAILED otherwise.
 */
export async function runClaudeArtifactPublish(
  request: ClaudeArtifactPublishRequest,
  options: ClaudeArtifactRunOptions,
): Promise<ArtifactPublishOutput> {
  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => abortController.abort(), PUBLISH_TIMEOUT_MS);

  const defaults = getDefaultOptions();
  const sdkOptions: Options = {
    ...defaults,
    env: claudeArtifactEnv(defaults.env ?? process.env, options.authEnv),
    model: options.model,
    cwd: options.cwd,
    // The Artifact tool checks Read permission on the file before publishing, and
    // narrowing `tools` without Read turns into a Read deny rule. Read stays limited
    // to the working folder (the temp folder holding only the HTML): nothing else
    // is pre-approved, and `dontAsk` denies the rest.
    tools: ['Artifact', 'Read'],
    allowedTools: ['Artifact'],
    permissionMode: 'dontAsk',
    settingSources: [],
    strictMcpConfig: true,
    persistSession: false,
    maxTurns: 5,
    abortController,
    systemPrompt: 'You publish files as Claude artifacts with the Artifact tool, exactly as instructed, and nothing else.',
    ...(isAdaptiveThinkingAlwaysOnModel(options.model)
      ? { thinking: { type: 'adaptive' as const }, effort: 'low' as const }
      : { thinking: { type: 'disabled' as const } }),
  };

  const artifactCalls = new Set<string>();
  let published: ArtifactPublishOutput | undefined;
  let lastToolError: string | undefined;
  let finalText = '';
  let resultError: string | undefined;
  // A rejected credential only shows once the turn reaches the API, so a missing
  // tool is judged after the turn: auth failures take precedence.
  let artifactToolMissing = false;
  let authFailed = false;

  try {
    const run = (options.query ?? sdkQuery)({ prompt: buildPublishPrompt(request), options: sdkOptions });
    for await (const message of run) {
      const msg = message as SDKMessage & Record<string, unknown>;
      if (msg.type === 'system' && msg.subtype === 'init') {
        const tools = Array.isArray(msg.tools) ? (msg.tools as string[]) : [];
        artifactToolMissing = !tools.includes('Artifact');
      } else if (msg.type === 'assistant') {
        if (msg.error === 'authentication_failed') authFailed = true;
        for (const block of (msg.message as { content?: unknown[] }).content ?? []) {
          const b = block as { type?: string; id?: string; name?: string; text?: string };
          if (b.type === 'tool_use' && b.name === 'Artifact' && b.id) artifactCalls.add(b.id);
          if (b.type === 'text' && b.text) finalText = b.text;
        }
      } else if (msg.type === 'user') {
        const blocks = ((msg.message as { content?: unknown })?.content ?? []) as unknown[];
        const toolResult = Array.isArray(blocks)
          ? (blocks.find(b => (b as { type?: string }).type === 'tool_result') as { tool_use_id?: string; is_error?: boolean; content?: unknown } | undefined)
          : undefined;
        if (!toolResult?.tool_use_id || !artifactCalls.has(toolResult.tool_use_id)) continue;
        if (isPublishOutput(msg.tool_use_result)) {
          published = {
            url: msg.tool_use_result.url,
            ...(msg.tool_use_result.artifact_id ? { artifactId: msg.tool_use_result.artifact_id } : {}),
            ...(msg.tool_use_result.title ? { title: msg.tool_use_result.title } : {}),
          };
        } else if (toolResult.is_error) {
          lastToolError = toolResultText(toolResult).slice(0, 500);
        }
      } else if (msg.type === 'result') {
        const text = msg.subtype === 'success'
          ? (msg.is_error ? String(msg.result ?? '') : '')
          : (Array.isArray(msg.errors) ? (msg.errors as string[]).join(', ') : String(msg.subtype));
        if (text) resultError = text;
        if (text && isClaudeAuthFailure(text)) authFailed = true;
      }
    }
  } catch (error) {
    if (error instanceof ClaudeArtifactError) throw error;
    if (published) return published;
    const message = error instanceof Error ? error.message : String(error);
    if (authFailed || isClaudeAuthFailure(message)) {
      throw new ClaudeArtifactError('ARTIFACT_AUTH_REQUIRED', CLAUDE_ARTIFACT_AUTH_REQUIRED_MESSAGE);
    }
    throw new ClaudeArtifactError(
      'ARTIFACT_PUBLISH_FAILED',
      abortController.signal.aborted ? 'Publishing took too long and was stopped.' : message,
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }

  if (published) return published;
  if (authFailed || (lastToolError && isClaudeAuthFailure(lastToolError))) {
    throw new ClaudeArtifactError('ARTIFACT_AUTH_REQUIRED', CLAUDE_ARTIFACT_AUTH_REQUIRED_MESSAGE);
  }
  if (artifactToolMissing) {
    throw new ClaudeArtifactError(
      'ARTIFACT_UNAVAILABLE',
      "Claude artifacts aren't available for this Claude account. Its plan or its organization's settings may not allow them.",
    );
  }
  // The tool explains policy refusals itself ("…disabled by your organization's policy…").
  if (lastToolError && /organization/i.test(lastToolError)) {
    throw new ClaudeArtifactError('ARTIFACT_UNAVAILABLE', toolErrorSummary(lastToolError));
  }
  if (finalText.trim() === 'CONFLICT') {
    throw new ClaudeArtifactError(
      'ARTIFACT_CONFLICT',
      'The artifact was changed on claude.ai since the last publish. Open it there, or publish again after reconciling.',
    );
  }
  throw new ClaudeArtifactError(
    'ARTIFACT_PUBLISH_FAILED',
    lastToolError ? toolErrorSummary(lastToolError) : (resultError ?? 'Claude did not publish the artifact.'),
  );
}

export interface PublishPageAsClaudeArtifactOptions extends Omit<ClaudeArtifactRunOptions, 'cwd'> {
  workspaceRootPath: string;
  pageSlug: string;
}

/**
 * Publish (or update) a page as a claude.ai artifact and record the pointer on
 * page.json. Returns the updated config.
 */
export async function publishPageAsClaudeArtifact(options: PublishPageAsClaudeArtifactOptions): Promise<PageConfig> {
  const { workspaceRootPath, pageSlug } = options;
  const config = loadPageConfig(workspaceRootPath, pageSlug);
  if (!config) throw new ClaudeArtifactError('PAGE_NOT_FOUND', `Page not found: ${pageSlug}`);
  const content = loadPageContent(workspaceRootPath, pageSlug);
  if (!content?.trim()) throw new ClaudeArtifactError('PAGE_NO_CONTENT', 'The page has no content yet.');

  let snapshot: unknown = null;
  const snapshotPath = getPageSnapshotPath(workspaceRootPath, pageSlug);
  if (existsSync(snapshotPath)) {
    try {
      snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
    } catch {
      snapshot = null; // a damaged snapshot publishes as "no data yet"
    }
  }

  const html = buildClaudeArtifactHtml(content, { slug: config.slug, kind: config.kind }, snapshot);
  const bytes = Buffer.byteLength(html, 'utf-8');
  if (bytes > CLAUDE_ARTIFACT_MAX_HTML_BYTES) {
    throw new ClaudeArtifactError(
      'ARTIFACT_TOO_LARGE',
      `The page and its data are too large to publish (${Math.round(bytes / 1024 / 1024)} MB, limit 5 MB).`,
    );
  }

  const dir = mkdtempSync(join(tmpdir(), 'craft-claude-artifact-'));
  try {
    // The basename is the artifact's last-resort title.
    const filePath = join(dir, `${config.slug}.html`);
    writeFileSync(filePath, html, 'utf-8');
    const result = await runClaudeArtifactPublish(
      {
        filePath,
        title: config.name,
        ...(config.description ? { description: config.description } : {}),
        ...(config.claudeArtifact ? { existingUrl: config.claudeArtifact.url } : {}),
      },
      { ...options, cwd: dir },
    );
    const now = Date.now();
    const pointer: PageClaudeArtifactInfo = {
      url: result.url,
      ...(result.artifactId ?? config.claudeArtifact?.artifactId
        ? { artifactId: result.artifactId ?? config.claudeArtifact?.artifactId }
        : {}),
      publishedContentDigest: computePageContentDigest(content),
      publishedAt: config.claudeArtifact?.publishedAt ?? now,
      updatedAt: now,
    };
    return setPageClaudeArtifactState(workspaceRootPath, pageSlug, pointer);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
