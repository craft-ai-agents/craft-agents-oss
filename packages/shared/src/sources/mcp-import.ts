import { randomUUID } from 'crypto';
import { basename } from 'path';
import type { StoredCredential } from '../credentials/types.ts';
import {
  deleteSource,
  generateSourceSlug,
  loadSourceConfig,
  getSourcePath,
  loadWorkspaceSources,
  saveSourceConfig,
  saveSourceGuide,
} from './storage.ts';
import { getSourceCredentialManager } from './credential-manager.ts';
import type { CreateSourceInput, FolderSourceConfig, LoadedSource, McpSourceConfig, McpTransport, SourceConnectionStatus, SourceGuide } from './types.ts';
import { isLocalMcpEnabled } from '../workspaces/storage.ts';

/**
 * Field-level error reported while parsing pasted MCP JSON.
 */
export interface McpImportFieldError {
  /** JSON field path or property name that caused the error. */
  field: string;
  /** Human-readable validation message for the field. */
  message: string;
}

/** Source config field that may contain imported secret-like values. */
export type McpImportSecretLocation = 'env' | 'header';

/** Persistence choice for an imported secret-like value. */
export type McpImportSecretHandling = 'credential-store' | 'config';

/**
 * Secret-like env or header value detected while parsing an MCP import candidate.
 */
export interface McpImportSecret {
  /** Stable candidate-local ID for persisting a handling choice before creation. */
  id: string;
  /** Source field where the secret-like value was imported from. */
  location: McpImportSecretLocation;
  /** Env var or header name. */
  name: string;
  /** Original value, retained for credential persistence. */
  value: string;
  /** Value safe to render in import previews. */
  previewValue: string;
  /** Whether to persist this value in the credential store or keep it in config. */
  handling: McpImportSecretHandling;
}

/** Reason an import candidate may duplicate an existing workspace source. */
export type McpImportDuplicateReason = 'name' | 'slug' | 'url' | 'command-args';

/** Existing source matched by a normalized MCP import candidate. */
export interface McpImportDuplicateMatch {
  /** Existing source slug that can be replaced. */
  sourceSlug: string;
  /** Existing source display name for preview. */
  sourceName: string;
  /** Duplicate semantics that matched this source. */
  reasons: McpImportDuplicateReason[];
}

/** Import action selected for a candidate. */
export type McpImportCandidateAction =
  | { type: 'create' }
  | { type: 'replace'; sourceSlug: string }
  | { type: 'skip' };

/**
 * Options that affect MCP import candidate parsing.
 */
export interface McpImportParseOptions {
  /** Per-secret handling overrides keyed by McpImportSecret.id. */
  secretHandling?: Record<string, McpImportSecretHandling>;
}

/**
 * Normalized source creation preview for one MCP server entry.
 */
export interface McpImportCandidate {
  /** Original server key from mcpServers, or the generated key for single-server JSON. */
  key: string;
  /** Source input that can be previewed before creating the source. */
  input: CreateSourceInput;
  /** Optional imported description from the original MCP server entry. */
  description?: string;
  /** Classified secret-like env/header values, including originals for persistence. */
  secrets?: McpImportSecret[];
  /** Explicit credential value collected by the manual form. */
  credential?: StoredCredential;
  /** Existing workspace source this candidate may duplicate. */
  duplicate?: McpImportDuplicateMatch;
  /** Available creation actions for preview UI. */
  availableActions?: McpImportCandidateAction[];
  /** Selected creation action. Defaults to create when absent. */
  action?: McpImportCandidateAction;
  /** Whether to add this source to workspace defaults as an enabled source after creation. */
  enableInWorkspace?: boolean;
  /** Candidate-specific validation errors. */
  errors: McpImportFieldError[];
}

/** Minimal credential persistence interface used by MCP import creation. */
export interface McpImportCredentialManager {
  /** Persist the credential for a source before the source config is written. */
  save(source: LoadedSource, credential: StoredCredential): Promise<void>;
}

/** Result from a post-create MCP connection test. */
export interface McpPostCreateConnectionTestResult {
  /** Whether the source connected and returned tools successfully. */
  success: boolean;
  /** User-facing failure message when success is false. */
  error?: string;
  /** Failure classification used to choose the persisted connection status. */
  errorType?: 'failed' | 'needs-auth' | 'pending' | 'invalid-schema' | 'disabled' | 'unknown';
}

/** Context passed to post-create MCP connection testers. */
export interface McpPostCreateConnectionTestContext {
  /** Newly-created source to test. */
  source: LoadedSource;
  /** Credential-store value saved for the source, when available. */
  credentialValue?: string;
}

/** Tests a newly-created MCP source and returns a user-facing status result. */
export type McpPostCreateConnectionTester = (
  context: McpPostCreateConnectionTestContext
) => Promise<McpPostCreateConnectionTestResult>;

/**
 * Tests a newly-created MCP source using the same validators as explicit
 * connection checks.
 */
export const defaultMcpPostCreateConnectionTester: McpPostCreateConnectionTester = async ({ source, credentialValue }) => {
  if (source.config.type !== 'mcp' || !source.config.mcp) {
    return { success: false, error: 'Source is not an MCP source.', errorType: 'failed' };
  }

  const mcp = source.config.mcp;
  const { validateMcpConnection, validateStdioMcpConnection } = await import('../mcp/validation.ts');
  if (mcp.transport === 'stdio') {
    if (!mcp.command) {
      return { success: false, error: 'Stdio MCP source is missing a command.', errorType: 'failed' };
    }
    return validateStdioMcpConnection({
      command: mcp.command,
      args: mcp.args,
      env: mcp.env,
    });
  }

  if (!mcp.url) {
    return { success: false, error: 'MCP source URL is required for HTTP/SSE transport.', errorType: 'failed' };
  }

  const credentialHeaders = parseCredentialHeaders(credentialValue);
  let accessToken: string | undefined;
  if (!credentialHeaders && (mcp.authType === 'bearer' || mcp.authType === 'oauth')) {
    accessToken = credentialValue;
  }

  return validateMcpConnection({
    mcpUrl: mcp.url,
    mcpTransport: mcp.transport,
    mcpHeaders: {
      ...(mcp.headers ?? {}),
      ...(credentialHeaders ?? {}),
    },
    mcpAccessToken: accessToken,
  });
};

/**
 * Compute a stable fingerprint for a stdio command + args combination.
 * Used to track first-run confirmation state for local MCP servers.
 * The same command + args will always produce the same fingerprint,
 * enabling remembered confirmation across creation sessions.
 */
export function stdioCommandFingerprint(command: string, args?: string[]): string {
  return `${command}\0${JSON.stringify(args ?? [])}`;
}

/** Optional dependencies for creating MCP sources from import candidates. */
export interface McpImportCreateOptions {
  /** Credential manager override, primarily for tests and alternate storage backends. */
  credentialManager?: McpImportCredentialManager;
  /**
   * Optional connection tester run after a source is saved. Failures update
   * source status but do not turn creation into a failed result.
   */
  connectionTester?: McpPostCreateConnectionTester;
  /**
   * Record of confirmed stdio command fingerprints. When present, stdio sources
   * whose command fingerprint is not in this set skip post-create connection
   * testing. Defaults to the set of commands being created (auto-confirmed).
   * Pass an empty record to require explicit confirmation for all stdio sources.
   */
  confirmedStdioCommands?: Record<string, true>;
  /**
   * When true, the local MCP servers enabled check is skipped. Used for testing
   * environments where workspace config may not exist. Defaults to false.
   */
  skipLocalMcpEnabledCheck?: boolean;
}

/** Manual form input for creating a single MCP source. */
export interface McpManualSourceInput extends Omit<CreateSourceInput, 'type' | 'api' | 'local'> {
  /** MCP source config collected by the manual form. */
  mcp: McpSourceConfig;
  /** Bearer token or header API key collected by auth-specific form controls. */
  authCredential?: McpManualAuthCredentialInput;
  /** Optional description used for the generated source tagline or guide context. */
  description?: string;
  /** Whether to add this source to workspace defaults as an enabled source after creation. */
  enableInWorkspace?: boolean;
}

/** Credential-like values collected by the manual MCP form. */
export type McpManualAuthCredentialInput =
  | { kind: 'bearer'; value: string; handling?: McpImportSecretHandling }
  | { kind: 'api-key'; headerName: string; value: string; handling?: McpImportSecretHandling };

/** Per-candidate result from MCP import source creation. */
export type McpImportCreateResult =
  | { key: string; success: true; sourceSlug: string }
  | { key: string; success: true; skipped: true }
  | { key: string; success: false; errors: McpImportFieldError[] };

/** Batch creation result that preserves one result per input candidate. */
export interface McpImportBatchCreateResult {
  /** Ordered results corresponding to the input candidates. */
  results: McpImportCreateResult[];
}

interface McpSourceCreationOptions {
  replacementSlug?: string;
  connectionTester?: McpPostCreateConnectionTester;
  confirmedStdioCommands?: Record<string, true>;
  skipLocalMcpEnabledCheck?: boolean;
}

interface ManualCandidateBuildState {
  errors: McpImportFieldError[];
  mcp: McpSourceConfig;
  secrets: McpImportSecret[];
  credential?: StoredCredential;
}

/**
 * Result of parsing pasted MCP JSON into import candidates.
 */
export interface McpImportParseResult {
  /** Parsed server candidates. Empty when top-level JSON is invalid. */
  candidates: McpImportCandidate[];
  /** Top-level parse or shape errors that prevent candidate creation. */
  errors: McpImportFieldError[];
}

/**
 * Parse pasted MCP JSON into normalized import candidates for preview and later source creation.
 */
export function parseMcpJsonImportCandidates(json: string, options: McpImportParseOptions = {}): McpImportParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      candidates: [],
      errors: [{ field: '$', message: 'Invalid JSON.' }],
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      candidates: [],
      errors: [{ field: '$', message: 'MCP JSON must be an object.' }],
    };
  }

  if (parsed.mcpServers !== undefined && !isPlainObject(parsed.mcpServers)) {
    return {
      candidates: [],
      errors: [{ field: 'mcpServers', message: 'mcpServers must be an object keyed by server name.' }],
    };
  }

  const servers = getServerEntries(parsed);

  return {
    candidates: Object.entries(servers).map(([key, server]) => buildCandidate(key, server, options)),
    errors: [],
  };
}

/**
 * Mark normalized MCP import candidates that may duplicate existing workspace sources.
 */
export function detectDuplicateMcpImportCandidates(
  workspaceRootPath: string,
  candidates: McpImportCandidate[],
): McpImportCandidate[] {
  const existingSources = loadWorkspaceSources(workspaceRootPath);
  return candidates.map((candidate) => {
    const duplicate = findDuplicateMcpSource(candidate, existingSources);
    return {
      ...candidate,
      ...(duplicate ? { duplicate } : {}),
      availableActions: buildAvailableImportActions(duplicate),
      action: candidate.action ?? buildDefaultImportAction(duplicate),
    };
  });
}

/**
 * Create workspace MCP sources from normalized import candidates.
 *
 * Each candidate is handled independently so batch imports can partially
 * succeed. Credential-store secrets are persisted before config/guide files
 * are written for that candidate.
 */
export async function createMcpSourcesFromCandidates(
  workspaceRootPath: string,
  candidates: McpImportCandidate[],
  options: McpImportCreateOptions = {},
): Promise<McpImportBatchCreateResult> {
  const credentialManager = options.credentialManager ?? getSourceCredentialManager();
  const results: McpImportCreateResult[] = [];

  for (const candidate of candidates) {
    if (candidate.action?.type === 'skip') {
      results.push({ key: candidate.key, success: true, skipped: true });
      continue;
    }

    if (candidate.errors.length > 0) {
      results.push({ key: candidate.key, success: false, errors: candidate.errors });
      continue;
    }

    try {
      const replacementSlug = candidate.action?.type === 'replace' ? candidate.action.sourceSlug : undefined;
      const created = await createMcpSourceFromCandidate(workspaceRootPath, candidate, credentialManager, {
        replacementSlug,
        connectionTester: options.connectionTester,
        confirmedStdioCommands: options.confirmedStdioCommands,
        skipLocalMcpEnabledCheck: options.skipLocalMcpEnabledCheck,
      });
      results.push({ key: candidate.key, success: true, sourceSlug: created.slug });
    } catch (error) {
      results.push({
        key: candidate.key,
        success: false,
        errors: [{ field: '$', message: error instanceof Error ? error.message : String(error) }],
      });
    }
  }

  return { results };
}

/**
 * Create one MCP source from manual form input through the same normalized
 * candidate creation path used by pasted MCP imports.
 */
export async function createMcpSourceFromManualInput(
  workspaceRootPath: string,
  input: McpManualSourceInput,
  options: McpImportCreateOptions = {},
): Promise<FolderSourceConfig> {
  const candidate = buildManualCandidate(input);
  const result = await createMcpSourcesFromCandidates(workspaceRootPath, [candidate], options);
  const created = result.results[0];
  if (!created || !created.success || 'skipped' in created) {
    const errors = created && !created.success ? created.errors : candidate.errors;
    throw new Error(errors.map((error) => `${error.field}: ${error.message}`).join('\n') || 'Failed to create MCP source.');
  }

  const config = loadWorkspaceSources(workspaceRootPath).find((source) => source.config.slug === created.sourceSlug)?.config;
  if (!config) {
    throw new Error(`Created source not found: ${created.sourceSlug}`);
  }
  return config;
}

function buildAvailableImportActions(duplicate: McpImportDuplicateMatch | undefined): McpImportCandidateAction[] {
  if (!duplicate) {
    return [{ type: 'create' }, { type: 'skip' }];
  }

  return [
    { type: 'create' },
    { type: 'replace', sourceSlug: duplicate.sourceSlug },
    { type: 'skip' },
  ];
}

function buildDefaultImportAction(duplicate: McpImportDuplicateMatch | undefined): McpImportCandidateAction {
  if (!duplicate) {
    return { type: 'create' };
  }

  return { type: 'replace', sourceSlug: duplicate.sourceSlug };
}

function getServerEntries(parsed: Record<string, unknown>): Record<string, unknown> {
  if (parsed.mcpServers !== undefined) {
    return parsed.mcpServers as Record<string, unknown>;
  }
  return { 'imported-mcp-server': parsed };
}

function buildManualCandidate(input: McpManualSourceInput): McpImportCandidate {
  const errors: McpImportFieldError[] = [];
  const name = input.name.trim();
  const provider = input.provider.trim();
  if (!name) {
    errors.push({ field: 'name', message: 'MCP source name is required.' });
  }
  if (!provider) {
    errors.push({ field: 'provider', message: 'MCP source provider is required.' });
  }

  // Normalize legacy transport values (http/sse → streamable_http) for backward compatibility
  const rawTransport: string | undefined = input.mcp.transport;
  const transport: McpTransport = ((rawTransport === 'http' || rawTransport === 'sse') ? 'streamable_http' : (rawTransport ?? 'streamable_http')) as McpTransport;
  const state: ManualCandidateBuildState = {
    errors,
    mcp: { transport },
    secrets: [],
  };

  if (transport === 'stdio') {
    addManualStdioFields(input.mcp, provider, state);
  } else if (transport === 'streamable_http') {
    addManualRemoteFields(input.mcp, input.authCredential, provider, state);
  } else {
    errors.push({ field: 'transport', message: 'Transport must be one of: streamable_http, stdio.' });
  }

  const candidate: McpImportCandidate = {
    key: provider || 'manual-mcp-source',
    input: {
      name,
      provider,
      type: 'mcp',
      enabled: input.enabled ?? true,
      mcp: state.mcp,
      ...(input.icon ? { icon: input.icon } : {}),
    },
    enableInWorkspace: input.enableInWorkspace ?? true,
    errors,
  };
  if (input.description?.trim()) {
    candidate.description = input.description.trim();
  }
  if (state.secrets.length > 0) {
    candidate.secrets = state.secrets;
  }
  if (state.credential) {
    candidate.credential = state.credential;
  }
  return candidate;
}

function addManualStdioFields(mcpInput: McpSourceConfig, provider: string, state: ManualCandidateBuildState): void {
  if (typeof mcpInput.command === 'string' && mcpInput.command.trim()) {
    state.mcp.command = mcpInput.command.trim();
  } else {
    state.errors.push({ field: 'command', message: 'Stdio MCP servers require a command string.' });
  }

  if (mcpInput.args !== undefined) {
    if (isStringArray(mcpInput.args)) {
      state.mcp.args = mcpInput.args;
    } else {
      state.errors.push({ field: 'args', message: 'Args must be an array of strings.' });
    }
  }

  if (mcpInput.env !== undefined) {
    if (isStringRecord(mcpInput.env)) {
      const classifiedEnv = classifyConfigRecord(provider || 'manual-mcp-source', 'env', mcpInput.env, {});
      state.mcp.env = classifiedEnv.preview;
      state.secrets.push(...classifiedEnv.secrets);
    } else {
      state.errors.push({ field: 'env', message: 'Env must be an object with string values.' });
    }
  }
}

function addManualRemoteFields(
  mcpInput: McpSourceConfig,
  authCredential: McpManualAuthCredentialInput | undefined,
  provider: string,
  state: ManualCandidateBuildState,
): void {
  if (typeof mcpInput.url === 'string' && mcpInput.url.trim()) {
    state.mcp.url = mcpInput.url.trim();
  } else {
    state.errors.push({ field: 'url', message: 'HTTP and SSE MCP servers require a URL string.' });
  }

  state.mcp.authType = mcpInput.authType ?? 'none';
  if (mcpInput.clientId) {
    state.mcp.clientId = mcpInput.clientId;
  }

  addManualHeaderFields(mcpInput, provider, state);

  const manualAuth = buildManualAuthCredential(authCredential, state.errors);
  if (manualAuth?.headerName) {
    state.mcp.headerNames = Array.from(new Set([...(state.mcp.headerNames ?? []), manualAuth.headerName]));
  }
  if (manualAuth?.credential) {
    state.credential = manualAuth.credential;
  }
}

function addManualHeaderFields(mcpInput: McpSourceConfig, provider: string, state: ManualCandidateBuildState): void {
  if (mcpInput.headers !== undefined) {
    if (isStringRecord(mcpInput.headers)) {
      const classifiedHeaders = classifyConfigRecord(provider || 'manual-mcp-source', 'header', mcpInput.headers, {});
      state.mcp.headers = classifiedHeaders.preview;
      state.secrets.push(...classifiedHeaders.secrets);
    } else {
      state.errors.push({ field: 'headers', message: 'Headers must be an object with string values.' });
    }
  }

  if (mcpInput.headerNames !== undefined) {
    if (isStringArray(mcpInput.headerNames)) {
      state.mcp.headerNames = mcpInput.headerNames;
    } else {
      state.errors.push({ field: 'headerNames', message: 'Header names must be an array of strings.' });
    }
  }
}

function findDuplicateMcpSource(
  candidate: McpImportCandidate,
  existingSources: LoadedSource[],
): McpImportDuplicateMatch | undefined {
  for (const source of existingSources) {
    const reasons = getDuplicateReasons(candidate, source);
    if (reasons.length > 0) {
      return {
        sourceSlug: source.config.slug,
        sourceName: source.config.name,
        reasons,
      };
    }
  }
  return undefined;
}

function getDuplicateReasons(candidate: McpImportCandidate, source: LoadedSource): McpImportDuplicateReason[] {
  const reasons: McpImportDuplicateReason[] = [];
  if (normalizeComparable(candidate.input.name) === normalizeComparable(source.config.name)) {
    reasons.push('name');
  }
  if (sourceSlugFromName(candidate.input.name) === source.config.slug) {
    reasons.push('slug');
  }
  if (source.config.type === 'mcp' && isUrlEndpointMatch(candidate.input.mcp, source.config.mcp)) {
    reasons.push('url');
  }
  if (source.config.type === 'mcp' && isCommandArgsMatch(candidate.input.mcp, source.config.mcp)) {
    reasons.push('command-args');
  }
  return reasons;
}

function isUrlEndpointMatch(candidateMcp: McpSourceConfig | undefined, sourceMcp: McpSourceConfig | undefined): boolean {
  const candidateUrl = normalizeEndpointUrl(candidateMcp?.url);
  const sourceUrl = normalizeEndpointUrl(sourceMcp?.url);
  return candidateUrl !== undefined && candidateUrl === sourceUrl;
}

function isCommandArgsMatch(candidateMcp: McpSourceConfig | undefined, sourceMcp: McpSourceConfig | undefined): boolean {
  if (!candidateMcp?.command || !sourceMcp?.command) return false;
  return (
    candidateMcp.command === sourceMcp.command &&
    JSON.stringify(candidateMcp.args ?? []) === JSON.stringify(sourceMcp.args ?? [])
  );
}

function buildCandidate(key: string, server: unknown, options: McpImportParseOptions): McpImportCandidate {
  const errors: McpImportFieldError[] = [];
  const secrets: McpImportSecret[] = [];
  const serverObject = isPlainObject(server) ? server : {};
  if (!isPlainObject(server)) {
    errors.push({ field: '$', message: 'Server config must be an object.' });
  }

  const transport = inferTransport(serverObject, errors);
  const mcp: McpSourceConfig = { transport };

  if (transport === 'stdio') {
    if (typeof serverObject.command === 'string' && serverObject.command.trim()) {
      mcp.command = serverObject.command;
      // Flag single-string shell commands that are not split into command and args.
      if (serverObject.command.includes(' ') && serverObject.args === undefined) {
        errors.push({
          field: 'command',
          message: 'Command appears to be a shell command string. Split into "command" and "args" fields. For example, use "command": "npx" with "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"].',
        });
      }
    } else {
      errors.push({ field: 'command', message: 'Stdio MCP servers require a command string.' });
    }
    if (serverObject.args !== undefined) {
      if (isStringArray(serverObject.args)) {
        mcp.args = serverObject.args;
      } else {
        errors.push({ field: 'args', message: 'Args must be an array of strings.' });
      }
    }
    if (serverObject.env !== undefined) {
      if (isStringRecord(serverObject.env)) {
        const classifiedEnv = classifyConfigRecord(key, 'env', serverObject.env, options);
        mcp.env = classifiedEnv.preview;
        secrets.push(...classifiedEnv.secrets);
      } else {
        errors.push({ field: 'env', message: 'Env must be an object with string values.' });
      }
    }
  } else {
    if (typeof serverObject.url === 'string' && serverObject.url.trim()) {
      mcp.url = serverObject.url;
    } else {
      errors.push({ field: 'url', message: 'Streamable HTTP MCP servers require a URL string.' });
    }
    if (serverObject.headers !== undefined) {
      if (isStringRecord(serverObject.headers)) {
        const classifiedHeaders = classifyConfigRecord(key, 'header', serverObject.headers, options);
        mcp.headers = classifiedHeaders.preview;
        secrets.push(...classifiedHeaders.secrets);
      } else {
        errors.push({ field: 'headers', message: 'Headers must be an object with string values.' });
      }
    }
    if (serverObject.headerNames !== undefined) {
      if (isStringArray(serverObject.headerNames)) {
        mcp.headerNames = serverObject.headerNames;
      } else {
        errors.push({ field: 'headerNames', message: 'Header names must be an array of strings.' });
      }
    }
  }

  const candidate: McpImportCandidate = {
    key,
    input: {
      name: titleizeKey(key),
      provider: key,
      type: 'mcp',
      enabled: true,
      mcp,
    },
    enableInWorkspace: true,
    errors,
  };
  if (typeof serverObject.description === 'string' && serverObject.description.trim()) {
    candidate.description = serverObject.description.trim();
  }
  if (secrets.length > 0) {
    candidate.secrets = secrets;
  }
  return candidate;
}

async function createMcpSourceFromCandidate(
  workspaceRootPath: string,
  candidate: McpImportCandidate,
  credentialManager: McpImportCredentialManager,
  options: McpSourceCreationOptions,
): Promise<FolderSourceConfig> {
  const replacementSlug = options.replacementSlug;
  const slug = replacementSlug ?? generateSourceSlug(workspaceRootPath, candidate.input.name);
  const now = Date.now();
  const config: FolderSourceConfig = {
    id: `${slug}_${randomUUID().slice(0, 8)}`,
    name: candidate.input.name,
    slug,
    enabled: candidate.input.enabled ?? true,
    provider: candidate.input.provider,
    type: 'mcp',
    mcp: buildCreationMcpConfig(candidate),
    createdAt: now,
    updatedAt: now,
  };
  if (candidate.input.icon) {
    config.icon = candidate.input.icon;
  }

  const description = candidate.description?.trim();
  if (description && isShortDescription(description)) {
    config.tagline = description;
  }

  const guide = buildImportedGuide(candidate.input.name, description);
  const source = buildLoadedSource(workspaceRootPath, config, guide);
  const credentialValue = buildCredentialStoreValue(candidate);
  if (credentialValue) {
    await credentialManager.save(source, { value: credentialValue });
  }

  if (replacementSlug) {
    deleteSource(workspaceRootPath, replacementSlug);
  }
  saveSourceConfig(workspaceRootPath, config);
  saveSourceGuide(workspaceRootPath, slug, guide);
  await testCreatedMcpSource(workspaceRootPath, slug, guide, credentialValue, options);
  return config;
}

async function testCreatedMcpSource(
  workspaceRootPath: string,
  sourceSlug: string,
  guide: SourceGuide,
  credentialValue: string | null,
  options: McpSourceCreationOptions,
): Promise<void> {
  const { connectionTester, confirmedStdioCommands, skipLocalMcpEnabledCheck } = options;
  if (!connectionTester) return;

  const config = loadSourceConfig(workspaceRootPath, sourceSlug);
  if (!config) return;

  const isStdio = config.type === 'mcp' && config.mcp?.transport === 'stdio';
  if (isStdio) {
    if (!skipLocalMcpEnabledCheck && !isLocalMcpEnabled(workspaceRootPath)) {
      config.connectionStatus = 'local_disabled';
      config.lastTestedAt = Date.now();
      saveSourceConfig(workspaceRootPath, config);
      return;
    }

    if (config.mcp?.command && confirmedStdioCommands !== undefined) {
      const fingerprint = stdioCommandFingerprint(config.mcp.command, config.mcp.args);
      if (!confirmedStdioCommands[fingerprint]) {
        return;
      }
    }
  }

  const source = buildLoadedSource(workspaceRootPath, config, guide);
  const startedAt = Date.now();
  try {
    const result = await connectionTester({
      source,
      ...(credentialValue ? { credentialValue } : {}),
    });
    persistConnectionTestResult(workspaceRootPath, sourceSlug, result, startedAt);
  } catch (error) {
    persistConnectionTestResult(workspaceRootPath, sourceSlug, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      errorType: 'failed',
    }, startedAt);
  }
}

function persistConnectionTestResult(
  workspaceRootPath: string,
  sourceSlug: string,
  result: McpPostCreateConnectionTestResult,
  testedAt: number,
): void {
  const config = loadSourceConfig(workspaceRootPath, sourceSlug);
  if (!config) return;

  config.lastTestedAt = testedAt;
  if (result.success) {
    config.isAuthenticated = true;
    config.connectionStatus = 'connected';
    config.connectionError = undefined;
  } else {
    config.isAuthenticated = false;
    config.connectionStatus = getFailedConnectionStatus(result.errorType);
    config.connectionError = result.error || 'Connection test failed';
  }
  saveSourceConfig(workspaceRootPath, config);
}

function getFailedConnectionStatus(errorType: McpPostCreateConnectionTestResult['errorType']): SourceConnectionStatus {
  return errorType === 'needs-auth' ? 'needs_auth' : 'failed';
}

function parseCredentialHeaders(credentialValue: string | null | undefined): Record<string, string> | undefined {
  if (!credentialValue) return undefined;
  try {
    const parsed = JSON.parse(credentialValue);
    return isStringRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function buildCreationMcpConfig(candidate: McpImportCandidate): McpSourceConfig {
  const mcp: McpSourceConfig = { ...candidate.input.mcp };
  if (mcp.transport !== 'stdio' && !mcp.authType) {
    mcp.authType = 'none';
  }
  const credentialStoreSecrets = getCredentialStoreSecrets(candidate);
  const envSecretNames = new Set(credentialStoreSecrets.filter((secret) => secret.location === 'env').map((secret) => secret.name));
  const headerSecretNames = new Set(credentialStoreSecrets.filter((secret) => secret.location === 'header').map((secret) => secret.name));

  if (mcp.env && envSecretNames.size > 0) {
    mcp.env = omitKeys(mcp.env, envSecretNames);
    if (Object.keys(mcp.env).length === 0) delete mcp.env;
  }

  if (mcp.headers && headerSecretNames.size > 0) {
    mcp.headers = omitKeys(mcp.headers, headerSecretNames);
    if (Object.keys(mcp.headers).length === 0) delete mcp.headers;
  }

  if (headerSecretNames.size > 0) {
    mcp.headerNames = Array.from(new Set([...(mcp.headerNames ?? []), ...headerSecretNames]));
  }

  return mcp;
}

function buildCredentialStoreValue(candidate: McpImportCandidate): string | null {
  if (candidate.credential?.value) {
    return candidate.credential.value;
  }

  const credentialStoreSecrets = getCredentialStoreSecrets(candidate);
  if (credentialStoreSecrets.length === 0) return null;

  const values: Record<string, string> = {};
  for (const secret of credentialStoreSecrets) {
    values[secret.name] = secret.value;
  }
  return JSON.stringify(values);
}

function buildManualAuthCredential(
  credential: McpManualAuthCredentialInput | undefined,
  errors: McpImportFieldError[],
): { credential?: StoredCredential; headerName?: string } | undefined {
  if (!credential) return undefined;
  const handling = credential.handling ?? 'credential-store';
  if (credential.kind === 'bearer') {
    if (!credential.value.trim()) {
      errors.push({ field: 'authCredential.value', message: 'Bearer token is required when bearer auth is selected.' });
      return undefined;
    }
    return handling === 'credential-store' ? { credential: { value: credential.value } } : undefined;
  }

  if (!credential.headerName.trim()) {
    errors.push({ field: 'authCredential.headerName', message: 'API key header name is required.' });
    return undefined;
  }
  if (!credential.value.trim()) {
    errors.push({ field: 'authCredential.value', message: 'API key value is required.' });
    return undefined;
  }

  if (handling === 'credential-store') {
    return {
      credential: { value: JSON.stringify({ [credential.headerName]: credential.value }) },
      headerName: credential.headerName,
    };
  }
  return undefined;
}

function getCredentialStoreSecrets(candidate: McpImportCandidate): McpImportSecret[] {
  return (candidate.secrets ?? []).filter((secret) => secret.handling === 'credential-store');
}

function buildLoadedSource(workspaceRootPath: string, config: FolderSourceConfig, guide: SourceGuide): LoadedSource {
  return {
    config,
    guide,
    folderPath: getSourcePath(workspaceRootPath, config.slug),
    workspaceRootPath,
    workspaceId: basename(workspaceRootPath),
  };
}

function buildImportedGuide(name: string, description: string | undefined): SourceGuide {
  let context = '(Add context about this source)';
  if (description && !isShortDescription(description)) {
    context = description;
  }

  return {
    raw: `# ${name}

## Guidelines

(Add usage guidelines here)

## Context

${context}

## API Notes

(Add API notes here)
`,
  };
}

function isShortDescription(description: string): boolean {
  return description.length <= 100;
}

function omitKeys(values: Record<string, string>, keys: Set<string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([key]) => !keys.has(key)));
}

interface ClassifiedConfigRecord {
  preview: Record<string, string>;
  secrets: McpImportSecret[];
}

function classifyConfigRecord(
  candidateKey: string,
  location: McpImportSecretLocation,
  values: Record<string, string>,
  options: McpImportParseOptions,
): ClassifiedConfigRecord {
  const preview: Record<string, string> = {};
  const secrets: McpImportSecret[] = [];
  for (const [name, value] of Object.entries(values)) {
    if (!isProbableSecretName(name)) {
      preview[name] = value;
      continue;
    }

    const id = `${candidateKey}:${location}:${name}`;
    const handling = options.secretHandling?.[id] ?? 'credential-store';
    const previewValue = handling === 'config' ? value : REDACTED_PREVIEW_VALUE;
    preview[name] = previewValue;
    secrets.push({
      id,
      location,
      name,
      value,
      previewValue,
      handling,
    });
  }
  return { preview, secrets };
}

function inferTransport(server: Record<string, unknown>, errors: McpImportFieldError[]): McpTransport {
  const explicitTransport = server.transport ?? server.type;
  if (explicitTransport === 'stdio') {
    return 'stdio';
  }
  if (explicitTransport === 'streamable_http' || explicitTransport === 'http' || explicitTransport === 'sse') {
    return 'streamable_http';
  }
  if (explicitTransport !== undefined) {
    const field = server.transport !== undefined ? 'transport' : 'type';
    errors.push({ field, message: 'Transport must be one of: streamable_http, stdio.' });
  }
  if (server.command) {
    return 'stdio';
  }
  return 'streamable_http';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isPlainObject(value) && Object.values(value).every((item) => typeof item === 'string');
}

const REDACTED_PREVIEW_VALUE = '••••••••';
const CREDENTIAL_NAME_SIGNALS = [
  'api_key',
  'apikey',
  'authorization',
  'auth',
  'bearer',
  'client_secret',
  'credential',
  'key',
  'password',
  'private_key',
  'secret',
  'token',
] as const;

function isProbableSecretName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const compact = normalized.replaceAll('_', '');
  const parts = normalized.split('_').filter(Boolean);

  return CREDENTIAL_NAME_SIGNALS.some((signal) => (
    compact.includes(signal.replaceAll('_', '')) ||
    parts.includes(signal)
  ));
}

function titleizeKey(key: string): string {
  return key
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(capitalizeKeyPart)
    .join(' ');
}

function sourceSlugFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
  return slug || 'source';
}

function normalizeComparable(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeEndpointUrl(url: string | undefined): string | undefined {
  if (!url?.trim()) return undefined;
  try {
    const parsed = new URL(url.trim());
    parsed.hash = '';
    const normalized = parsed.toString();
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  } catch {
    const trimmed = url.trim();
    return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  }
}

function capitalizeKeyPart(part: string): string {
  if (part.toLowerCase() === 'mcp') {
    return 'MCP';
  }
  return part.charAt(0).toUpperCase() + part.slice(1);
}
