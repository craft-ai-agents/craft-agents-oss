import type { CreateSourceInput, McpSourceConfig, McpTransport } from './types.ts';

/**
 * Field-level error reported while parsing pasted MCP JSON.
 */
export interface McpImportFieldError {
  /** JSON field path or property name that caused the error. */
  field: string;
  /** Human-readable validation message for the field. */
  message: string;
}

/**
 * Normalized source creation preview for one MCP server entry.
 */
export interface McpImportCandidate {
  /** Original server key from mcpServers, or the generated key for single-server JSON. */
  key: string;
  /** Source input that can be previewed before creating the source. */
  input: CreateSourceInput;
  /** Candidate-specific validation errors. */
  errors: McpImportFieldError[];
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
export function parseMcpJsonImportCandidates(json: string): McpImportParseResult {
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
    candidates: Object.entries(servers).map(([key, server]) => buildCandidate(key, server)),
    errors: [],
  };
}

function getServerEntries(parsed: Record<string, unknown>): Record<string, unknown> {
  if (parsed.mcpServers !== undefined) {
    return parsed.mcpServers as Record<string, unknown>;
  }
  return { 'imported-mcp-server': parsed };
}

function buildCandidate(key: string, server: unknown): McpImportCandidate {
  const errors: McpImportFieldError[] = [];
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
        mcp.env = serverObject.env;
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
        mcp.headers = serverObject.headers;
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

  return {
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
