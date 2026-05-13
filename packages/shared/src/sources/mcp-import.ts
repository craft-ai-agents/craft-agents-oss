import { randomUUID } from 'crypto';
import { basename } from 'path';
import type { StoredCredential } from '../credentials/types.ts';
import { generateSourceSlug, getSourcePath, saveSourceConfig, saveSourceGuide } from './storage.ts';
import { getSourceCredentialManager } from './credential-manager.ts';
import type { CreateSourceInput, FolderSourceConfig, LoadedSource, McpSourceConfig, McpTransport, SourceGuide } from './types.ts';

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
  /** Candidate-specific validation errors. */
  errors: McpImportFieldError[];
}

/** Minimal credential persistence interface used by MCP import creation. */
export interface McpImportCredentialManager {
  save(source: LoadedSource, credential: StoredCredential): Promise<void>;
}

export interface McpImportCreateOptions {
  credentialManager?: McpImportCredentialManager;
}

export type McpImportCreateResult =
  | { key: string; success: true; sourceSlug: string }
  | { key: string; success: false; errors: McpImportFieldError[] };

export interface McpImportBatchCreateResult {
  results: McpImportCreateResult[];
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
    if (candidate.errors.length > 0) {
      results.push({ key: candidate.key, success: false, errors: candidate.errors });
      continue;
    }

    try {
      const created = await createMcpSourceFromCandidate(workspaceRootPath, candidate, credentialManager);
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

function getServerEntries(parsed: Record<string, unknown>): Record<string, unknown> {
  if (parsed.mcpServers !== undefined) {
    return parsed.mcpServers as Record<string, unknown>;
  }
  return { 'imported-mcp-server': parsed };
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
      errors.push({ field: 'url', message: 'HTTP and SSE MCP servers require a URL string.' });
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
): Promise<FolderSourceConfig> {
  const slug = generateSourceSlug(workspaceRootPath, candidate.input.name);
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

  saveSourceConfig(workspaceRootPath, config);
  saveSourceGuide(workspaceRootPath, slug, guide);
  return config;
}

function buildCreationMcpConfig(candidate: McpImportCandidate): McpSourceConfig {
  const mcp: McpSourceConfig = { ...candidate.input.mcp };
  if (mcp.transport !== 'stdio' && !mcp.authType) {
    mcp.authType = 'none';
  }
  const credentialStoreSecrets = (candidate.secrets ?? []).filter((secret) => secret.handling === 'credential-store');
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
  const credentialStoreSecrets = (candidate.secrets ?? []).filter((secret) => secret.handling === 'credential-store');
  if (credentialStoreSecrets.length === 0) return null;

  const values: Record<string, string> = {};
  for (const secret of credentialStoreSecrets) {
    values[secret.name] = secret.value;
  }
  return JSON.stringify(values);
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
  const context = description && !isShortDescription(description)
    ? description
    : '(Add context about this source)';
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
  if (explicitTransport === 'stdio' || explicitTransport === 'sse' || explicitTransport === 'http') {
    return explicitTransport;
  }
  if (explicitTransport !== undefined) {
    const field = server.transport !== undefined ? 'transport' : 'type';
    errors.push({ field, message: 'Transport must be one of: stdio, sse, http.' });
  }
  if (server.command) {
    return 'stdio';
  }
  return 'http';
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

function capitalizeKeyPart(part: string): string {
  if (part.toLowerCase() === 'mcp') {
    return 'MCP';
  }
  return part.charAt(0).toUpperCase() + part.slice(1);
}
