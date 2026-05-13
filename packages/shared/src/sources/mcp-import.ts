import type { CreateSourceInput, McpSourceConfig, McpTransport } from './types.ts';

export interface McpImportFieldError {
  field: string;
  message: string;
}

export interface McpImportCandidate {
  key: string;
  input: CreateSourceInput;
  errors: McpImportFieldError[];
}

export interface McpImportParseResult {
  candidates: McpImportCandidate[];
  errors: McpImportFieldError[];
}

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

  const servers = parsed.mcpServers !== undefined
    ? parsed.mcpServers as Record<string, unknown>
    : { 'imported-mcp-server': parsed };

  return {
    candidates: Object.entries(servers).map(([key, server]) => buildCandidate(key, server)),
    errors: [],
  };
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
    errors.push({ field: server.transport !== undefined ? 'transport' : 'type', message: 'Transport must be one of: stdio, sse, http.' });
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
    .map((part) => part.toLowerCase() === 'mcp' ? 'MCP' : part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
