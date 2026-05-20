import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';
import { createMcpSourceFromManualInput, createMcpSourcesFromCandidates, detectDuplicateMcpImportCandidates, parseMcpJsonImportCandidates, stdioCommandFingerprint } from '../mcp-import.ts';
import { loadSourceConfig, loadSourceGuide, saveSourceConfig } from '../storage.ts';
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
      enableInWorkspace: true,
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
        enableInWorkspace: true,
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
            transport: 'streamable_http',
            url: 'https://mcp.linear.app/mcp',
          },
        },
        enableInWorkspace: true,
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
      { transport: 'streamable_http', url: 'https://example.com/sse' },
      { transport: 'streamable_http', url: 'https://example.com/mcp' },
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
        mcp: { transport: 'streamable_http' },
        errors: [{ field: 'url', message: 'Streamable HTTP MCP servers require a URL string.' }],
      },
      {
        key: 'badTransport',
        mcp: { transport: 'streamable_http', url: 'https://example.com/mcp' },
        errors: [{ field: 'transport', message: 'Transport must be one of: streamable_http, stdio.' }],
      },
      {
        key: 'badArgs',
        mcp: { transport: 'stdio', command: 'npx' },
        errors: [{ field: 'args', message: 'Args must be an array of strings.' }],
      },
      {
        key: 'badHeaders',
        mcp: { transport: 'streamable_http', url: 'https://example.com/mcp' },
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
          transport: 'streamable_http',
          authType: 'bearer',
          url: 'https://example.com/mcp',
          headers: {
            'X-API-Key': '••••••••',
            'X-Trace-ID': 'trace-123',
          },
        },
        secrets: [
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

    // Authorization: Bearer xxx is auto-detected as bearer auth — removed from headers preview
    expect(result.candidates[0]?.input.mcp?.headers).toEqual({
      'X-API-Key': 'api-key-123',
    });
    // Authorization secret is replaced by a bearer credential
    expect(result.candidates[0]?.credential).toEqual({ value: 'secret-token' });
    expect(result.candidates[0]?.input.mcp?.authType).toBe('bearer');
    // Only the config-handled X-API-Key secret remains
    expect(result.candidates[0]?.secrets).toEqual([
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

  test('flags single-string shell commands that are not split into command and args', () => {
    const result = parseMcpJsonImportCandidates(JSON.stringify({
      mcpServers: {
        bad: {
          command: 'npx -y @modelcontextprotocol/server-filesystem /tmp',
        },
      },
    }));

    expect(result.errors).toEqual([]);
    expect(result.candidates[0]?.errors).toHaveLength(1);
    expect(result.candidates[0]?.errors[0]?.field).toBe('command');
    expect(result.candidates[0]?.errors[0]?.message).toContain('shell command string');
  });

  test('does not flag properly split command and args', () => {
    const result = parseMcpJsonImportCandidates(JSON.stringify({
      mcpServers: {
        good: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        },
      },
    }));

    expect(result.candidates[0]?.errors).toEqual([]);
  });

  test('does not flag a command without spaces even when args are missing', () => {
    const result = parseMcpJsonImportCandidates(JSON.stringify({
      mcpServers: {
        simple: {
          command: 'bun',
        },
      },
    }));

    expect(result.candidates[0]?.errors).toEqual([]);
  });

  test('does not flag a command with spaces when args are explicitly provided', () => {
    const result = parseMcpJsonImportCandidates(JSON.stringify({
      mcpServers: {
        withArgs: {
          command: '/path/with space/binary',
          args: ['--flag'],
        },
      },
    }));

    expect(result.candidates[0]?.errors).toEqual([]);
  });
});

describe('stdioCommandFingerprint', () => {
  test('produces consistent fingerprints for the same command and args', () => {
    expect(stdioCommandFingerprint('node', ['server.js']))
      .toBe(stdioCommandFingerprint('node', ['server.js']));
  });

  test('produces different fingerprints for different commands', () => {
    expect(stdioCommandFingerprint('node', ['server.js']))
      .not.toBe(stdioCommandFingerprint('bun', ['server.js']));
  });

  test('produces different fingerprints for different args', () => {
    expect(stdioCommandFingerprint('npx', ['-y', 'package']))
      .not.toBe(stdioCommandFingerprint('npx', ['package']));
  });

  test('handles undefined args as empty array', () => {
    expect(stdioCommandFingerprint('node'))
      .toBe(stdioCommandFingerprint('node', []));
  });
});

describe('detectDuplicateMcpImportCandidates', () => {
  test('marks candidates as duplicate when their name and slug match an existing source', () => {
    const workspaceRootPath = makeTempWorkspace();
    try {
      writeExistingMcpSource(workspaceRootPath, {
        name: 'Linear',
        slug: 'linear',
        mcp: { transport: 'streamable_http', authType: 'none', url: 'https://mcp.linear.app/mcp' },
      });

      const parsed = parseMcpJsonImportCandidates(JSON.stringify({
        mcpServers: {
          linear: { url: 'https://other.example.com/mcp' },
        },
      }));

      const candidates = detectDuplicateMcpImportCandidates(workspaceRootPath, parsed.candidates);

      expect(candidates[0]?.duplicate).toEqual({
        sourceSlug: 'linear',
        sourceName: 'Linear',
        reasons: ['name', 'slug'],
      });
      expect(candidates[0]?.action).toEqual({ type: 'replace', sourceSlug: 'linear' });
      expect(candidates[0]?.availableActions).toEqual([
        { type: 'create' },
        { type: 'replace', sourceSlug: 'linear' },
        { type: 'skip' },
      ]);
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true });
    }
  });

  test('marks HTTP and SSE candidates as duplicate when their URL matches an existing MCP source endpoint', () => {
    const workspaceRootPath = makeTempWorkspace();
    try {
      writeExistingMcpSource(workspaceRootPath, {
        name: 'Existing Linear',
        slug: 'existing-linear',
        mcp: { transport: 'streamable_http', authType: 'none', url: 'https://mcp.linear.app/sse' },
      });

      const parsed = parseMcpJsonImportCandidates(JSON.stringify({
        mcpServers: {
          linear: { transport: 'http', url: 'https://mcp.linear.app/sse' },
        },
      }));

      const candidates = detectDuplicateMcpImportCandidates(workspaceRootPath, parsed.candidates);

      expect(candidates[0]?.duplicate).toEqual({
        sourceSlug: 'existing-linear',
        sourceName: 'Existing Linear',
        reasons: ['url'],
      });
      expect(candidates[0]?.action).toEqual({ type: 'replace', sourceSlug: 'existing-linear' });
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true });
    }
  });

  test('marks stdio candidates as duplicate when command plus args match an existing MCP source endpoint', () => {
    const workspaceRootPath = makeTempWorkspace();
    try {
      writeExistingMcpSource(workspaceRootPath, {
        name: 'Filesystem MCP',
        slug: 'filesystem-mcp',
        mcp: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] },
      });

      const parsed = parseMcpJsonImportCandidates(JSON.stringify({
        mcpServers: {
          fs: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
          },
        },
      }));

      const candidates = detectDuplicateMcpImportCandidates(workspaceRootPath, parsed.candidates);

      expect(candidates[0]?.duplicate).toEqual({
        sourceSlug: 'filesystem-mcp',
        sourceName: 'Filesystem MCP',
        reasons: ['command-args'],
      });
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true });
    }
  });

  test('leaves non-duplicate candidates as new-source imports', () => {
    const workspaceRootPath = makeTempWorkspace();
    try {
      writeExistingMcpSource(workspaceRootPath, {
        name: 'Linear',
        slug: 'linear',
        mcp: { transport: 'streamable_http', authType: 'none', url: 'https://mcp.linear.app/mcp' },
      });

      const parsed = parseMcpJsonImportCandidates(JSON.stringify({
        mcpServers: {
          notion: { url: 'https://mcp.notion.com/mcp' },
        },
      }));

      const candidates = detectDuplicateMcpImportCandidates(workspaceRootPath, parsed.candidates);

      expect(candidates[0]?.duplicate).toBeUndefined();
      expect(candidates[0]?.action).toEqual({ type: 'create' });
      expect(candidates[0]?.availableActions).toEqual([
        { type: 'create' },
        { type: 'skip' },
      ]);
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true });
    }
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
      expect(savedCredentials[0]?.credential.value).toBe('lin_secret');

      const config = loadSourceConfig(workspaceRootPath, 'linear');
      expect(config?.type).toBe('mcp');
      expect(config?.tagline).toBe('Issue tracking for product work.');
      expect(config?.mcp).toEqual({
        transport: 'streamable_http',
        authType: 'bearer',
        url: 'https://mcp.linear.app/mcp',
        headers: { 'X-Trace-ID': 'trace-123' },
      });

      const guide = loadSourceGuide(workspaceRootPath, 'linear');
      expect(guide?.raw).toContain('# Linear');
      expect(guide?.raw).toContain('## Context');
      expect(readFileSync(join(workspaceRootPath, 'sources', 'linear', 'config.json'), 'utf-8')).not.toContain('lin_secret');
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true });
    }
  });

  test('marks a created MCP source connected after a successful post-create connection test', async () => {
    const workspaceRootPath = makeTempWorkspace();
    try {
      const parsed = parseMcpJsonImportCandidates(JSON.stringify({
        mcpServers: {
          linear: {
            url: 'https://mcp.linear.app/mcp',
          },
        },
      }));

      const result = await createMcpSourcesFromCandidates(workspaceRootPath, parsed.candidates, {
        connectionTester: async () => ({ success: true }),
      });

      expect(result.results).toEqual([
        { key: 'linear', success: true, sourceSlug: 'linear' },
      ]);
      const config = loadSourceConfig(workspaceRootPath, 'linear');
      expect(config).toMatchObject({
        connectionStatus: 'connected',
        isAuthenticated: true,
      });
      expect(config?.connectionError).toBeUndefined();
      expect(config?.lastTestedAt).toBeGreaterThan(0);
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true });
    }
  });

  test('marks a created MCP source needs_auth after an auth post-create connection failure', async () => {
    const workspaceRootPath = makeTempWorkspace();
    try {
      const parsed = parseMcpJsonImportCandidates(JSON.stringify({
        mcpServers: {
          secured: {
            url: 'https://secure.example.com/mcp',
            headers: { Authorization: 'Bearer stale-token' },
          },
        },
      }));

      const result = await createMcpSourcesFromCandidates(workspaceRootPath, parsed.candidates, {
        credentialManager: {
          save: async () => {},
        },
        connectionTester: async () => ({
          success: false,
          errorType: 'needs-auth',
          error: 'Authentication failed. Re-authenticate this MCP source.',
        }),
      });

      expect(result.results).toEqual([
        { key: 'secured', success: true, sourceSlug: 'secured' },
      ]);
      const config = loadSourceConfig(workspaceRootPath, 'secured');
      expect(config).toMatchObject({
        connectionStatus: 'needs_auth',
        connectionError: 'Authentication failed. Re-authenticate this MCP source.',
        isAuthenticated: false,
      });
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true });
    }
  });

  test('marks a created MCP source failed after an ordinary post-create connection failure without rolling back creation', async () => {
    const workspaceRootPath = makeTempWorkspace();
    try {
      const parsed = parseMcpJsonImportCandidates(JSON.stringify({
        mcpServers: {
          offline: {
            url: 'https://offline.example.com/mcp',
          },
        },
      }));

      const result = await createMcpSourcesFromCandidates(workspaceRootPath, parsed.candidates, {
        connectionTester: async () => ({
          success: false,
          errorType: 'failed',
          error: 'MCP server endpoint not found. Check the URL and try again.',
        }),
      });

      expect(result.results).toEqual([
        { key: 'offline', success: true, sourceSlug: 'offline' },
      ]);
      const config = loadSourceConfig(workspaceRootPath, 'offline');
      expect(config).toMatchObject({
        connectionStatus: 'failed',
        connectionError: 'MCP server endpoint not found. Check the URL and try again.',
        isAuthenticated: false,
      });
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

  test('honors skip and replace actions when creating detected duplicate candidates', async () => {
    const workspaceRootPath = makeTempWorkspace();
    try {
      writeExistingMcpSource(workspaceRootPath, {
        name: 'Linear',
        slug: 'linear',
        mcp: { transport: 'streamable_http', authType: 'none', url: 'https://old.example.com/mcp' },
      });

      const parsed = parseMcpJsonImportCandidates(JSON.stringify({
        mcpServers: {
          linear: { url: 'https://new.example.com/mcp' },
          skipped: { url: 'https://skipped.example.com/mcp' },
        },
      }));
      const candidates = detectDuplicateMcpImportCandidates(workspaceRootPath, parsed.candidates);
      candidates[1] = { ...candidates[1]!, action: { type: 'skip' } };

      const result = await createMcpSourcesFromCandidates(workspaceRootPath, candidates, {
        credentialManager: {
          save: async () => {
            throw new Error('unexpected credential save');
          },
        },
      });

      expect(result.results).toEqual([
        { key: 'linear', success: true, sourceSlug: 'linear' },
        { key: 'skipped', success: true, skipped: true },
      ]);
      expect(loadSourceConfig(workspaceRootPath, 'linear')?.mcp).toEqual({
        transport: 'streamable_http',
        authType: 'none',
        url: 'https://new.example.com/mcp',
      });
      expect(loadSourceConfig(workspaceRootPath, 'skipped')).toBeNull();
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true });
    }
  });

  test('runs post-create connection test for confirmed stdio sources', async () => {
    const workspaceRootPath = makeTempWorkspace();
    let testRan = false;
    try {
      const parsed = parseMcpJsonImportCandidates(JSON.stringify({
        mcpServers: {
          local: {
            command: 'node',
            args: ['server.js'],
          },
        },
      }));

      const result = await createMcpSourcesFromCandidates(workspaceRootPath, parsed.candidates, {
        credentialManager: { save: async () => { throw new Error('unexpected'); } },
        connectionTester: async () => {
          testRan = true;
          return { success: true };
        },
        confirmedStdioCommands: {
          [stdioCommandFingerprint('node', ['server.js'])]: true,
        },
      });

      expect(result.results).toEqual([
        { key: 'local', success: true, sourceSlug: 'local' },
      ]);
      expect(testRan).toBe(true);
      const config = loadSourceConfig(workspaceRootPath, 'local');
      expect(config?.connectionStatus).toBe('connected');
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true });
    }
  });

  test('skips post-create connection test for unconfirmed stdio sources', async () => {
    const workspaceRootPath = makeTempWorkspace();
    let testRan = false;
    try {
      const parsed = parseMcpJsonImportCandidates(JSON.stringify({
        mcpServers: {
          local: {
            command: 'node',
            args: ['server.js'],
          },
        },
      }));

      const result = await createMcpSourcesFromCandidates(workspaceRootPath, parsed.candidates, {
        credentialManager: { save: async () => { throw new Error('unexpected'); } },
        connectionTester: async () => {
          testRan = true;
          return { success: true };
        },
        confirmedStdioCommands: {},
      });

      expect(result.results).toEqual([
        { key: 'local', success: true, sourceSlug: 'local' },
      ]);
      expect(testRan).toBe(false);
      const config = loadSourceConfig(workspaceRootPath, 'local');
      expect(config?.connectionStatus).toBeUndefined();
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true });
    }
  });

  test('sets local_disabled status when local MCP servers are disabled globally', async () => {
    const origEnv = process.env.CRAFT_LOCAL_MCP_ENABLED;
    process.env.CRAFT_LOCAL_MCP_ENABLED = 'false';
    const workspaceRootPath = makeTempWorkspace();
    let testRan = false;
    try {
      const parsed = parseMcpJsonImportCandidates(JSON.stringify({
        mcpServers: {
          local: {
            command: 'node',
            args: ['server.js'],
          },
        },
      }));

      const result = await createMcpSourcesFromCandidates(workspaceRootPath, parsed.candidates, {
        credentialManager: { save: async () => { throw new Error('unexpected'); } },
        connectionTester: async () => {
          testRan = true;
          return { success: true };
        },
        confirmedStdioCommands: {
          [stdioCommandFingerprint('node', ['server.js'])]: true,
        },
      });

      expect(result.results).toEqual([
        { key: 'local', success: true, sourceSlug: 'local' },
      ]);
      expect(testRan).toBe(false);
      const config = loadSourceConfig(workspaceRootPath, 'local');
      expect(config?.connectionStatus).toBe('local_disabled');
    } finally {
      process.env.CRAFT_LOCAL_MCP_ENABLED = origEnv;
      rmSync(workspaceRootPath, { recursive: true, force: true });
    }
  });

  test('HTTP sources are unaffected by the stdio first-run confirmation gate', async () => {
    const workspaceRootPath = makeTempWorkspace();
    let testRan = false;
    try {
      const parsed = parseMcpJsonImportCandidates(JSON.stringify({
        mcpServers: {
          remote: {
            url: 'https://example.com/mcp',
          },
        },
      }));

      const result = await createMcpSourcesFromCandidates(workspaceRootPath, parsed.candidates, {
        credentialManager: { save: async () => { throw new Error('unexpected'); } },
        connectionTester: async () => {
          testRan = true;
          return { success: true };
        },
        confirmedStdioCommands: {},
      });

      expect(result.results).toEqual([
        { key: 'remote', success: true, sourceSlug: 'remote' },
      ]);
      expect(testRan).toBe(true);
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true });
    }
  });

  test('remembered confirmation allows same command fingerprint across multiple sources', async () => {
    const workspaceRootPath = makeTempWorkspace();
    const testedCommands: string[] = [];
    try {
      const parsed1 = parseMcpJsonImportCandidates(JSON.stringify({
        mcpServers: {
          first: { command: 'node', args: ['server.js'] },
        },
      }));
      const parsed2 = parseMcpJsonImportCandidates(JSON.stringify({
        mcpServers: {
          second: { command: 'node', args: ['server.js'] },
        },
      }));

      const confirmed: Record<string, true> = { [stdioCommandFingerprint('node', ['server.js'])]: true };

      const result1 = await createMcpSourcesFromCandidates(workspaceRootPath, parsed1.candidates, {
        credentialManager: { save: async () => { throw new Error('unexpected'); } },
        connectionTester: async () => {
          testedCommands.push('first');
          return { success: true };
        },
        confirmedStdioCommands: confirmed,
      });
      expect(result1.results).toEqual([
        { key: 'first', success: true, sourceSlug: 'first' },
      ]);

      const result2 = await createMcpSourcesFromCandidates(workspaceRootPath, parsed2.candidates, {
        credentialManager: { save: async () => { throw new Error('unexpected'); } },
        connectionTester: async () => {
          testedCommands.push('second');
          return { success: true };
        },
        confirmedStdioCommands: confirmed,
      });
      expect(result2.results).toEqual([
        { key: 'second', success: true, sourceSlug: 'second' },
      ]);

      expect(testedCommands).toEqual(['first', 'second']);
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true });
    }
  });
});

describe('createMcpSourceFromManualInput', () => {
  test('tests a form-created MCP source after creation', async () => {
    const workspaceRootPath = makeTempWorkspace();
    const testedSlugs: string[] = [];
    try {
      const created = await createMcpSourceFromManualInput(workspaceRootPath, {
        name: 'Manual Remote',
        provider: 'manual-remote',
        mcp: {
          transport: 'streamable_http',
          url: 'https://manual.example.com/mcp',
          authType: 'none',
        },
      }, {
        connectionTester: async ({ source }) => {
          testedSlugs.push(source.config.slug);
          return { success: true };
        },
      });

      expect(created.slug).toBe('manual-remote');
      expect(testedSlugs).toEqual(['manual-remote']);
      const config = loadSourceConfig(workspaceRootPath, 'manual-remote');
      expect(config?.connectionStatus).toBe('connected');
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true });
    }
  });

  test('creates a command MCP source without shell-splitting argument values', async () => {
    const workspaceRootPath = makeTempWorkspace();
    try {
      const created = await createMcpSourceFromManualInput(workspaceRootPath, {
        name: 'Local Tools',
        provider: 'local-tools',
        icon: 'https://example.com/icon.png',
        enabled: false,
        mcp: {
          transport: 'stdio',
          command: 'node',
          args: ['server with spaces.js', '--label', 'two words'],
          env: {
            PUBLIC_MODE: 'test',
          },
        },
      }, {
        credentialManager: {
          save: async () => {
            throw new Error('unexpected credential save');
          },
        },
      });

      expect(created.slug).toBe('local-tools');
      expect(loadSourceConfig(workspaceRootPath, 'local-tools')?.mcp).toEqual({
        transport: 'stdio',
        command: 'node',
        args: ['server with spaces.js', '--label', 'two words'],
        env: {
          PUBLIC_MODE: 'test',
        },
      });
      expect(loadSourceConfig(workspaceRootPath, 'local-tools')?.enabled).toBe(false);
      expect(loadSourceConfig(workspaceRootPath, 'local-tools')?.icon).toBe('https://example.com/icon.png');
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true });
    }
  });

  test('persists manual bearer and API-key style inputs through the credential store by default', async () => {
    const workspaceRootPath = makeTempWorkspace();
    const savedCredentials: Array<{ source: LoadedSource; credential: StoredCredential }> = [];
    try {
      const bearer = await createMcpSourceFromManualInput(workspaceRootPath, {
        name: 'Bearer Remote',
        provider: 'bearer-remote',
        mcp: {
          transport: 'streamable_http',
          url: 'https://example.com/mcp',
          authType: 'bearer',
        },
        authCredential: {
          kind: 'bearer',
          value: 'bearer-token-123',
        },
      }, {
        credentialManager: {
          save: async (source, credential) => {
            savedCredentials.push({ source, credential });
          },
        },
      });

      const apiKey = await createMcpSourceFromManualInput(workspaceRootPath, {
        name: 'API Key Remote',
        provider: 'api-key-remote',
        mcp: {
          transport: 'streamable_http',
          url: 'https://example.com/sse',
          authType: 'none',
        },
        authCredential: {
          kind: 'api-key',
          headerName: 'X-API-Key',
          value: 'api-key-123',
        },
      }, {
        credentialManager: {
          save: async (source, credential) => {
            savedCredentials.push({ source, credential });
          },
        },
      });

      expect(savedCredentials.map((entry) => ({
        slug: entry.source.config.slug,
        value: entry.credential.value,
      }))).toEqual([
        { slug: 'bearer-remote', value: 'bearer-token-123' },
        { slug: 'api-key-remote', value: JSON.stringify({ 'X-API-Key': 'api-key-123' }) },
      ]);
      expect(bearer.mcp).toEqual({
        transport: 'streamable_http',
        authType: 'bearer',
        url: 'https://example.com/mcp',
      });
      expect(apiKey.mcp).toEqual({
        transport: 'streamable_http',
        authType: 'none',
        url: 'https://example.com/sse',
        headerNames: ['X-API-Key'],
      });
      expect(readFileSync(join(workspaceRootPath, 'sources', 'bearer-remote', 'config.json'), 'utf-8')).not.toContain('bearer-token-123');
      expect(readFileSync(join(workspaceRootPath, 'sources', 'api-key-remote', 'config.json'), 'utf-8')).not.toContain('api-key-123');
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true });
    }
  });
});

describe('enableInWorkspace', () => {
  test('sets enableInWorkspace: true by default on parsed JSON candidates', () => {
    const result = parseMcpJsonImportCandidates(JSON.stringify({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    }));

    expect(result.candidates[0]?.enableInWorkspace).toBe(true);
  });

  test('enableInWorkspace is metadata not consumed by creation functions', async () => {
    const workspaceRootPath = makeTempWorkspace();
    try {
      const created = await createMcpSourceFromManualInput(workspaceRootPath, {
        name: 'Metadata Test',
        provider: 'metadata-test',
        enableInWorkspace: false,
        mcp: {
          transport: 'streamable_http',
          url: 'https://example.com/mcp',
          authType: 'none',
        },
      }, {
        credentialManager: { save: async () => {} },
        connectionTester: async () => ({ success: true }),
      });

      expect(created.slug).toBe('metadata-test');
      expect(created.enabled).toBe(true);
      // enableInWorkspace does not affect the stored config
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true });
    }
  });

  test('JSON import candidates can set enableInWorkspace: false for opt-out', async () => {
    const workspaceRootPath = makeTempWorkspace();
    try {
      const parsed = parseMcpJsonImportCandidates(JSON.stringify({
        mcpServers: {
          optedOut: { url: 'https://opted-out.example.com/mcp' },
          enabledByDefault: { url: 'https://enabled.example.com/mcp' },
        },
      }));

      // Default is true
      expect(parsed.candidates.every((c) => c.enableInWorkspace === true)).toBe(true);

      // Opt out specific candidates
      const candidates = parsed.candidates.map((c) =>
        c.key === 'optedOut' ? { ...c, enableInWorkspace: false } : c
      );

      const enabled = candidates.filter((c) => c.enableInWorkspace !== false);
      expect(enabled).toHaveLength(1);
      expect(enabled[0]?.key).toBe('enabledByDefault');
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true });
    }
  });
});

function makeTempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'mcp-import-'));
}

function writeExistingMcpSource(
  workspaceRootPath: string,
  input: {
    name: string;
    slug: string;
    mcp: NonNullable<LoadedSource['config']['mcp']>;
  },
): void {
  const now = Date.now();
  saveSourceConfig(workspaceRootPath, {
    id: `${input.slug}_existing`,
    name: input.name,
    slug: input.slug,
    enabled: true,
    provider: input.slug,
    type: 'mcp',
    mcp: input.mcp,
    createdAt: now,
    updatedAt: now,
  });
}
