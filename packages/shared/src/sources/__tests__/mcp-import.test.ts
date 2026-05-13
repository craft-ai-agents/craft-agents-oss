import { describe, expect, test } from 'bun:test';
import { parseMcpJsonImportCandidates } from '../mcp-import.ts';

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
});
