import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';
import { createMcpSourcesFromCandidates, parseMcpJsonImportCandidates } from '../mcp-import.ts';
import { loadSourceConfig, loadSourceGuide } from '../storage.ts';
import type { LoadedSource } from '../types.ts';
import type { StoredCredential } from '../../credentials/types.ts';

describe('parseMcpJsonImportCandidates', () => {
  test('parses a single stdio server object into one import candidate', () => {
    const result = parseMcpJsonImportCandidates(JSON.stringify({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    }));

    expect(result.errors).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toEqual({
      key: 'imported-mcp-server',
      input: {
        name: 'Imported MCP Server',
        provider: 'imported-mcp-server',
        type: 'mcp',
        enabled: true,
        mcp: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        },
      },
      errors: [],
    });
  });

  test('parses a top-level mcpServers object into one candidate per server key', () => {
    const result = parseMcpJsonImportCandidates(JSON.stringify({
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        },
        linear: {
          url: 'https://mcp.linear.app/mcp',
        },
      },
    }));

    expect(result.errors).toEqual([]);
    expect(result.candidates).toEqual([
      {
        key: 'filesystem',
        input: {
          name: 'Filesystem',
          provider: 'filesystem',
          type: 'mcp',
          enabled: true,
          mcp: {
            transport: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
          },
        },
        errors: [],
      },
      {
        key: 'linear',
        input: {
          name: 'Linear',
          provider: 'linear',
          type: 'mcp',
          enabled: true,
          mcp: {
            transport: 'http',
            url: 'https://mcp.linear.app/mcp',
          },
        },
        errors: [],
      },
    ]);
  });

  test('infers stdio, SSE, and HTTP transports from server fields', () => {
    const result = parseMcpJsonImportCandidates(JSON.stringify({
      mcpServers: {
        local: { command: 'bun', args: ['server.ts'] },
        events: { transport: 'sse', url: 'https://example.com/sse' },
        streamable: { type: 'http', url: 'https://example.com/mcp' },
      },
    }));

    expect(result.candidates.map((candidate) => candidate.input.mcp)).toEqual([
      { transport: 'stdio', command: 'bun', args: ['server.ts'] },
      { transport: 'sse', url: 'https://example.com/sse' },
      { transport: 'http', url: 'https://example.com/mcp' },
    ]);
    expect(result.candidates.every((candidate) => candidate.errors.length === 0)).toBe(true);
  });

  test('reports invalid JSON as a top-level field error', () => {
    const result = parseMcpJsonImportCandidates('{ "mcpServers": ');

    expect(result.candidates).toEqual([]);
    expect(result.errors).toEqual([
      { field: '$', message: 'Invalid JSON.' },
    ]);
  });

  test('reports unsupported top-level mcpServers shapes', () => {
    const result = parseMcpJsonImportCandidates(JSON.stringify({
      mcpServers: [],
    }));

    expect(result.candidates).toEqual([]);
    expect(result.errors).toEqual([
      { field: 'mcpServers', message: 'mcpServers must be an object keyed by server name.' },
    ]);
  });

  test('reports invalid candidate fields while preserving import previews', () => {
    const result = parseMcpJsonImportCandidates(JSON.stringify({
      mcpServers: {
        missingCommand: { transport: 'stdio', args: ['server.ts'] },
        missingUrl: { transport: 'sse' },
        badTransport: { transport: 'websocket', url: 'https://example.com/mcp' },
        badArgs: { command: 'npx', args: '--yes' },
        badHeaders: { url: 'https://example.com/mcp', headers: ['Authorization'] },
      },
    }));

    expect(result.errors).toEqual([]);
    expect(result.candidates.map((candidate) => ({
      key: candidate.key,
      mcp: candidate.input.mcp,
      errors: candidate.errors,
    }))).toEqual([
      {
        key: 'missingCommand',
        mcp: { transport: 'stdio', args: ['server.ts'] },
        errors: [{ field: 'command', message: 'Stdio MCP servers require a command string.' }],
      },
      {
        key: 'missingUrl',
        mcp: { transport: 'sse' },
        errors: [{ field: 'url', message: 'HTTP and SSE MCP servers require a URL string.' }],
      },
      {
        key: 'badTransport',
        mcp: { transport: 'http', url: 'https://example.com/mcp' },
        errors: [{ field: 'transport', message: 'Transport must be one of: stdio, sse, http.' }],
      },
      {
        key: 'badArgs',
        mcp: { transport: 'stdio', command: 'npx' },
        errors: [{ field: 'args', message: 'Args must be an array of strings.' }],
      },
      {
        key: 'badHeaders',
        mcp: { transport: 'http', url: 'https://example.com/mcp' },
        errors: [{ field: 'headers', message: 'Headers must be an object with string values.' }],
      },
    ]);
  });

  test('classifies credential-like env and header values as redacted credential-store secrets', () => {
    const result = parseMcpJsonImportCandidates(JSON.stringify({
      mcpServers: {
        secured: {
          command: 'npx',
          env: {
            API_TOKEN: 'tok_live_123',
            PUBLIC_HOST: 'localhost',
            NOTSECRET_BUT_MATCHES: 'accepted-false-positive',
          },
        },
        remote: {
          url: 'https://example.com/mcp',
          headers: {
            Authorization: 'Bearer secret-token',
            'X-API-Key': 'api-key-123',
            'X-Trace-ID': 'trace-123',
          },
        },
      },
    }));

    expect(result.errors).toEqual([]);
    expect(result.candidates.map((candidate) => ({
      key: candidate.key,
      mcp: candidate.input.mcp,
      secrets: candidate.secrets,
    }))).toEqual([
      {
        key: 'secured',
        mcp: {
          transport: 'stdio',
          command: 'npx',
          env: {
            API_TOKEN: '••••••••',
            PUBLIC_HOST: 'localhost',
            NOTSECRET_BUT_MATCHES: '••••••••',
          },
        },
        secrets: [
          {
            id: 'secured:env:API_TOKEN',
            location: 'env',
            name: 'API_TOKEN',
            value: 'tok_live_123',
            previewValue: '••••••••',
            handling: 'credential-store',
          },
          {
            id: 'secured:env:NOTSECRET_BUT_MATCHES',
            location: 'env',
            name: 'NOTSECRET_BUT_MATCHES',
            value: 'accepted-false-positive',
            previewValue: '••••••••',
            handling: 'credential-store',
          },
        ],
      },
      {
        key: 'remote',
        mcp: {
          transport: 'http',
          url: 'https://example.com/mcp',
          headers: {
            Authorization: '••••••••',
            'X-API-Key': '••••••••',
            'X-Trace-ID': 'trace-123',
          },
        },
        secrets: [
          {
            id: 'remote:header:Authorization',
            location: 'header',
            name: 'Authorization',
            value: 'Bearer secret-token',
            previewValue: '••••••••',
            handling: 'credential-store',
          },
          {
            id: 'remote:header:X-API-Key',
            location: 'header',
            name: 'X-API-Key',
            value: 'api-key-123',
            previewValue: '••••••••',
            handling: 'credential-store',
          },
        ],
      },
    ]);
  });

  test('keeps explicit config-handled secrets unredacted in the source preview', () => {
    const result = parseMcpJsonImportCandidates(JSON.stringify({
      mcpServers: {
        remote: {
          url: 'https://example.com/mcp',
          headers: {
            Authorization: 'Bearer secret-token',
            'X-API-Key': 'api-key-123',
          },
        },
      },
    }), {
      secretHandling: {
        'remote:header:X-API-Key': 'config',
      },
    });

    expect(result.candidates[0]?.input.mcp?.headers).toEqual({
      Authorization: '••••••••',
      'X-API-Key': 'api-key-123',
    });
    expect(result.candidates[0]?.secrets).toEqual([
      {
        id: 'remote:header:Authorization',
        location: 'header',
        name: 'Authorization',
        value: 'Bearer secret-token',
        previewValue: '••••••••',
        handling: 'credential-store',
      },
      {
        id: 'remote:header:X-API-Key',
        location: 'header',
        name: 'X-API-Key',
        value: 'api-key-123',
        previewValue: 'api-key-123',
        handling: 'config',
      },
    ]);
  });
});

describe('createMcpSourcesFromCandidates', () => {
  test('creates a workspace MCP source from a valid candidate and persists selected credentials outside config', async () => {
    const workspaceRootPath = makeTempWorkspace();
    const savedCredentials: Array<{ source: LoadedSource; credential: StoredCredential }> = [];
    try {
      const parsed = parseMcpJsonImportCandidates(JSON.stringify({
        mcpServers: {
          linear: {
            url: 'https://mcp.linear.app/mcp',
            description: 'Issue tracking for product work.',
            headers: {
              Authorization: 'Bearer lin_secret',
              'X-Trace-ID': 'trace-123',
            },
          },
        },
      }));

      const result = await createMcpSourcesFromCandidates(workspaceRootPath, parsed.candidates, {
        credentialManager: {
          save: async (source, credential) => {
            savedCredentials.push({ source, credential });
          },
        },
      });

      expect(result.results).toEqual([
        { key: 'linear', success: true, sourceSlug: 'linear' },
      ]);
      expect(savedCredentials).toHaveLength(1);
      expect(savedCredentials[0]?.source.config.slug).toBe('linear');
      expect(savedCredentials[0]?.credential.value).toBe(JSON.stringify({ Authorization: 'Bearer lin_secret' }));

      const config = loadSourceConfig(workspaceRootPath, 'linear');
      expect(config?.type).toBe('mcp');
      expect(config?.tagline).toBe('Issue tracking for product work.');
      expect(config?.mcp).toEqual({
        transport: 'http',
        authType: 'none',
        url: 'https://mcp.linear.app/mcp',
        headers: { 'X-Trace-ID': 'trace-123' },
        headerNames: ['Authorization'],
      });

      const guide = loadSourceGuide(workspaceRootPath, 'linear');
      expect(guide?.raw).toContain('# Linear');
      expect(guide?.raw).toContain('## Context');
      expect(readFileSync(join(workspaceRootPath, 'sources', 'linear', 'config.json'), 'utf-8')).not.toContain('lin_secret');
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true });
    }
  });

  test('blocks creating a source when credential persistence fails', async () => {
    const workspaceRootPath = makeTempWorkspace();
    try {
      const parsed = parseMcpJsonImportCandidates(JSON.stringify({
        mcpServers: {
          secured: {
            url: 'https://example.com/mcp',
            headers: { 'X-API-Key': 'secret-key' },
          },
        },
      }));

      const result = await createMcpSourcesFromCandidates(workspaceRootPath, parsed.candidates, {
        credentialManager: {
          save: async () => {
            throw new Error('credential store unavailable');
          },
        },
      });

      expect(result.results).toEqual([
        {
          key: 'secured',
          success: false,
          errors: [{ field: '$', message: 'credential store unavailable' }],
        },
      ]);
      expect(loadSourceConfig(workspaceRootPath, 'secured')).toBeNull();
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true });
    }
  });

  test('returns per-candidate results for partial batch success', async () => {
    const workspaceRootPath = makeTempWorkspace();
    try {
      const parsed = parseMcpJsonImportCandidates(JSON.stringify({
        mcpServers: {
          valid: { command: 'npx', args: ['server'] },
          invalid: { transport: 'stdio', args: ['missing-command'] },
        },
      }));

      const result = await createMcpSourcesFromCandidates(workspaceRootPath, parsed.candidates, {
        credentialManager: {
          save: async () => {
            throw new Error('unexpected credential save');
          },
        },
      });

      expect(result.results).toEqual([
        { key: 'valid', success: true, sourceSlug: 'valid' },
        {
          key: 'invalid',
          success: false,
          errors: [{ field: 'command', message: 'Stdio MCP servers require a command string.' }],
        },
      ]);
      expect(loadSourceConfig(workspaceRootPath, 'valid')?.mcp).toEqual({
        transport: 'stdio',
        command: 'npx',
        args: ['server'],
      });
      expect(loadSourceConfig(workspaceRootPath, 'invalid')).toBeNull();
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true });
    }
  });

  test('places long imported descriptions into guide context instead of config tagline', async () => {
    const workspaceRootPath = makeTempWorkspace();
    const longDescription = 'This MCP server exposes customer support case search, escalation workflows, account lookup, and internal runbook retrieval for the support operations team.';
    try {
      const parsed = parseMcpJsonImportCandidates(JSON.stringify({
        mcpServers: {
          support: {
            url: 'https://support.example.com/mcp',
            description: longDescription,
          },
        },
      }));

      const result = await createMcpSourcesFromCandidates(workspaceRootPath, parsed.candidates, {
        credentialManager: {
          save: async () => {
            throw new Error('unexpected credential save');
          },
        },
      });

      expect(result.results).toEqual([
        { key: 'support', success: true, sourceSlug: 'support' },
      ]);
      expect(loadSourceConfig(workspaceRootPath, 'support')?.tagline).toBeUndefined();
      const guide = loadSourceGuide(workspaceRootPath, 'support');
      expect(guide?.context).toBe(longDescription);
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true });
    }
  });
});

function makeTempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'mcp-import-'));
}
