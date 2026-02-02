import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { getMcpBaseUrl, discoverOAuthMetadata } from '../oauth';

describe('getMcpBaseUrl', () => {
  it('extracts origin from standard MCP URL', () => {
    expect(getMcpBaseUrl('https://example.com/mcp')).toBe('https://example.com');
  });

  it('extracts origin from double-path URL (Ahrefs case)', () => {
    expect(getMcpBaseUrl('https://api.ahrefs.com/mcp/mcp')).toBe('https://api.ahrefs.com');
  });

  it('extracts origin from URL with port', () => {
    expect(getMcpBaseUrl('http://localhost:3000/mcp')).toBe('http://localhost:3000');
  });

  it('extracts origin from URL with deep path', () => {
    expect(getMcpBaseUrl('https://company.com/api/v2/mcp')).toBe('https://company.com');
  });

  it('extracts origin from URL with query params', () => {
    expect(getMcpBaseUrl('https://example.com/mcp?version=1')).toBe('https://example.com');
  });

  it('extracts origin from URL with trailing slash', () => {
    expect(getMcpBaseUrl('https://example.com/mcp/')).toBe('https://example.com');
  });

  it('extracts origin from SSE endpoint', () => {
    expect(getMcpBaseUrl('https://mcp.linear.app/sse')).toBe('https://mcp.linear.app');
  });

  it('extracts origin from GitHub Copilot MCP', () => {
    expect(getMcpBaseUrl('https://api.githubcopilot.com/mcp/')).toBe('https://api.githubcopilot.com');
  });

  it('returns as-is for invalid URL', () => {
    expect(getMcpBaseUrl('not-a-valid-url')).toBe('not-a-valid-url');
  });

  it('returns as-is for empty string', () => {
    expect(getMcpBaseUrl('')).toBe('');
  });
});

describe('discoverOAuthMetadata', () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    mockFetch = mock(() => Promise.resolve(new Response('Not Found', { status: 404 })));
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('discovers metadata at origin root', async () => {
    const metadata = {
      authorization_endpoint: 'https://example.com/oauth/authorize',
      token_endpoint: 'https://example.com/oauth/token',
    };

    mockFetch.mockImplementation((url: string) => {
      if (url === 'https://example.com/.well-known/oauth-authorization-server') {
        return Promise.resolve(new Response(JSON.stringify(metadata), { status: 200 }));
      }
      return Promise.resolve(new Response('Not Found', { status: 404 }));
    });

    const result = await discoverOAuthMetadata('https://example.com/mcp');
    expect(result).toEqual(metadata);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to path-scoped discovery', async () => {
    const metadata = {
      authorization_endpoint: 'https://api.ahrefs.com/oauth/authorize',
      token_endpoint: 'https://api.ahrefs.com/oauth/token',
    };

    mockFetch.mockImplementation((url: string) => {
      if (url === 'https://api.ahrefs.com/.well-known/oauth-authorization-server/mcp/mcp') {
        return Promise.resolve(new Response(JSON.stringify(metadata), { status: 200 }));
      }
      return Promise.resolve(new Response('Not Found', { status: 404 }));
    });

    const result = await discoverOAuthMetadata('https://api.ahrefs.com/mcp/mcp');
    expect(result).toEqual(metadata);
    expect(mockFetch).toHaveBeenCalledTimes(2); // First tries origin, then path-scoped
  });

  it('returns null when no metadata found', async () => {
    const result = await discoverOAuthMetadata('https://example.com/mcp');
    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2); // Tries both candidates
  });

  it('returns null for invalid URL', async () => {
    const result = await discoverOAuthMetadata('not-a-valid-url');
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null when metadata is missing required fields', async () => {
    mockFetch.mockImplementation(() => {
      return Promise.resolve(new Response(JSON.stringify({ some: 'data' }), { status: 200 }));
    });

    const result = await discoverOAuthMetadata('https://example.com/mcp');
    expect(result).toBeNull();
  });

  it('handles network errors gracefully', async () => {
    mockFetch.mockImplementation(() => {
      return Promise.reject(new Error('Network error'));
    });

    const result = await discoverOAuthMetadata('https://example.com/mcp');
    expect(result).toBeNull();
  });

  it('calls onLog callback with discovery progress', async () => {
    const logs: string[] = [];
    const onLog = (msg: string) => logs.push(msg);

    await discoverOAuthMetadata('https://example.com/mcp', onLog);

    expect(logs.some(l => l.includes('Discovering OAuth metadata'))).toBe(true);
    expect(logs.some(l => l.includes('Trying:'))).toBe(true);
    expect(logs.some(l => l.includes('No OAuth metadata found'))).toBe(true);
  });

  it('includes registration_endpoint when present', async () => {
    const metadata = {
      authorization_endpoint: 'https://example.com/oauth/authorize',
      token_endpoint: 'https://example.com/oauth/token',
      registration_endpoint: 'https://example.com/oauth/register',
    };

    mockFetch.mockImplementation(() => {
      return Promise.resolve(new Response(JSON.stringify(metadata), { status: 200 }));
    });

    const result = await discoverOAuthMetadata('https://example.com/mcp');
    expect(result?.registration_endpoint).toBe('https://example.com/oauth/register');
  });
});
