import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { discoverOAuthMetadata } from '../oauth';

describe('discoverOAuthMetadata', () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    mockFetch = mock(() => Promise.resolve(new Response('Not Found', { status: 404 })));
    (mockFetch as any).preconnect = () => {};
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('RFC 9728 protected resource discovery', () => {
    it('discovers metadata via WWW-Authenticate resource_metadata hint', async () => {
      const protectedResourceMetadata = {
        resource: 'https://mcp.craft.do/my',
        authorization_servers: ['https://mcp.craft.do/my/auth'],
      };

      const authServerMetadata = {
        authorization_endpoint: 'https://mcp.craft.do/my/auth/authorize',
        token_endpoint: 'https://mcp.craft.do/my/auth/token',
        registration_endpoint: 'https://mcp.craft.do/my/auth/register',
      };

      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        // HEAD request to MCP endpoint returns 401 with resource_metadata hint
        if (url === 'https://mcp.craft.do/my/mcp' && options?.method === 'HEAD') {
          return Promise.resolve(new Response(null, {
            status: 401,
            headers: {
              'WWW-Authenticate': 'Bearer error="invalid_token", resource_metadata="https://mcp.craft.do/.well-known/oauth-protected-resource/my"',
            },
          }));
        }
        // Protected resource metadata
        if (url === 'https://mcp.craft.do/.well-known/oauth-protected-resource/my') {
          return Promise.resolve(new Response(JSON.stringify(protectedResourceMetadata), { status: 200 }));
        }
        // Authorization server metadata
        if (url === 'https://mcp.craft.do/my/auth/.well-known/oauth-authorization-server') {
          return Promise.resolve(new Response(JSON.stringify(authServerMetadata), { status: 200 }));
        }
        return Promise.resolve(new Response('Not Found', { status: 404 }));
      });

      const result = await discoverOAuthMetadata('https://mcp.craft.do/my/mcp');
      expect(result).toEqual(authServerMetadata);
    });

    it('falls back to RFC 8414 when HEAD returns non-401', async () => {
      const metadata = {
        authorization_endpoint: 'https://example.com/oauth/authorize',
        token_endpoint: 'https://example.com/oauth/token',
      };

      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        // HEAD request returns 200 (no auth required or different auth)
        if (options?.method === 'HEAD') {
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        // RFC 8414 fallback
        if (url === 'https://example.com/.well-known/oauth-authorization-server') {
          return Promise.resolve(new Response(JSON.stringify(metadata), { status: 200 }));
        }
        return Promise.resolve(new Response('Not Found', { status: 404 }));
      });

      const result = await discoverOAuthMetadata('https://example.com/mcp');
      expect(result).toEqual(metadata);
    });

    it('falls back to RFC 8414 when no resource_metadata in header', async () => {
      const metadata = {
        authorization_endpoint: 'https://example.com/oauth/authorize',
        token_endpoint: 'https://example.com/oauth/token',
      };

      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        // HEAD request returns 401 but without resource_metadata
        if (options?.method === 'HEAD') {
          return Promise.resolve(new Response(null, {
            status: 401,
            headers: {
              'WWW-Authenticate': 'Bearer error="invalid_token"',
            },
          }));
        }
        // RFC 8414 fallback
        if (url === 'https://example.com/.well-known/oauth-authorization-server') {
          return Promise.resolve(new Response(JSON.stringify(metadata), { status: 200 }));
        }
        return Promise.resolve(new Response('Not Found', { status: 404 }));
      });

      const result = await discoverOAuthMetadata('https://example.com/mcp');
      expect(result).toEqual(metadata);
    });

    it('falls back when protected resource metadata fetch fails', async () => {
      const metadata = {
        authorization_endpoint: 'https://example.com/oauth/authorize',
        token_endpoint: 'https://example.com/oauth/token',
      };

      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'HEAD') {
          return Promise.resolve(new Response(null, {
            status: 401,
            headers: {
              'WWW-Authenticate': 'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"',
            },
          }));
        }
        // Protected resource metadata returns 404
        if (url === 'https://example.com/.well-known/oauth-protected-resource') {
          return Promise.resolve(new Response('Not Found', { status: 404 }));
        }
        // RFC 8414 fallback
        if (url === 'https://example.com/.well-known/oauth-authorization-server') {
          return Promise.resolve(new Response(JSON.stringify(metadata), { status: 200 }));
        }
        return Promise.resolve(new Response('Not Found', { status: 404 }));
      });

      const result = await discoverOAuthMetadata('https://example.com/mcp');
      expect(result).toEqual(metadata);
    });

    it('falls back to GET when HEAD returns 405', async () => {
      const protectedResourceMetadata = {
        resource: 'https://example.com/api',
        authorization_servers: ['https://example.com/auth'],
      };

      const authServerMetadata = {
        authorization_endpoint: 'https://example.com/auth/authorize',
        token_endpoint: 'https://example.com/auth/token',
      };

      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        // HEAD returns 405 Method Not Allowed
        if (options?.method === 'HEAD') {
          return Promise.resolve(new Response(null, { status: 405 }));
        }
        // GET returns 401 with resource_metadata
        if (url === 'https://example.com/mcp' && options?.method === 'GET') {
          return Promise.resolve(new Response(null, {
            status: 401,
            headers: {
              'WWW-Authenticate': 'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"',
            },
          }));
        }
        if (url === 'https://example.com/.well-known/oauth-protected-resource') {
          return Promise.resolve(new Response(JSON.stringify(protectedResourceMetadata), { status: 200 }));
        }
        if (url === 'https://example.com/auth/.well-known/oauth-authorization-server') {
          return Promise.resolve(new Response(JSON.stringify(authServerMetadata), { status: 200 }));
        }
        return Promise.resolve(new Response('Not Found', { status: 404 }));
      });

      const result = await discoverOAuthMetadata('https://example.com/mcp');
      expect(result).toEqual(authServerMetadata);
    });

    it('falls back when authorization_servers is empty array', async () => {
      const protectedResourceMetadata = {
        resource: 'https://example.com/api',
        authorization_servers: [], // Empty array
      };

      const metadata = {
        authorization_endpoint: 'https://example.com/oauth/authorize',
        token_endpoint: 'https://example.com/oauth/token',
      };

      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'HEAD') {
          return Promise.resolve(new Response(null, {
            status: 401,
            headers: {
              'WWW-Authenticate': 'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"',
            },
          }));
        }
        if (url === 'https://example.com/.well-known/oauth-protected-resource') {
          return Promise.resolve(new Response(JSON.stringify(protectedResourceMetadata), { status: 200 }));
        }
        if (url === 'https://example.com/.well-known/oauth-authorization-server') {
          return Promise.resolve(new Response(JSON.stringify(metadata), { status: 200 }));
        }
        return Promise.resolve(new Response('Not Found', { status: 404 }));
      });

      const result = await discoverOAuthMetadata('https://example.com/mcp');
      expect(result).toEqual(metadata);
    });

    it('falls back when protected resource returns malformed JSON', async () => {
      const metadata = {
        authorization_endpoint: 'https://example.com/oauth/authorize',
        token_endpoint: 'https://example.com/oauth/token',
      };

      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'HEAD') {
          return Promise.resolve(new Response(null, {
            status: 401,
            headers: {
              'WWW-Authenticate': 'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"',
            },
          }));
        }
        if (url === 'https://example.com/.well-known/oauth-protected-resource') {
          return Promise.resolve(new Response('not valid json {{{', { status: 200 }));
        }
        if (url === 'https://example.com/.well-known/oauth-authorization-server') {
          return Promise.resolve(new Response(JSON.stringify(metadata), { status: 200 }));
        }
        return Promise.resolve(new Response('Not Found', { status: 404 }));
      });

      const result = await discoverOAuthMetadata('https://example.com/mcp');
      expect(result).toEqual(metadata);
    });

    it('rejects resource_metadata URL pointing to private IP (SSRF protection)', async () => {
      const metadata = {
        authorization_endpoint: 'https://example.com/oauth/authorize',
        token_endpoint: 'https://example.com/oauth/token',
      };

      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'HEAD') {
          return Promise.resolve(new Response(null, {
            status: 401,
            headers: {
              // Malicious server tries to redirect to AWS metadata endpoint
              'WWW-Authenticate': 'Bearer resource_metadata="http://169.254.169.254/latest/meta-data/"',
            },
          }));
        }
        if (url === 'https://example.com/.well-known/oauth-authorization-server') {
          return Promise.resolve(new Response(JSON.stringify(metadata), { status: 200 }));
        }
        return Promise.resolve(new Response('Not Found', { status: 404 }));
      });

      const result = await discoverOAuthMetadata('https://example.com/mcp');
      // Should fall back to RFC 8414 instead of following SSRF URL
      expect(result).toEqual(metadata);
    });

    it('rejects resource_metadata URL with non-HTTPS scheme', async () => {
      const metadata = {
        authorization_endpoint: 'https://example.com/oauth/authorize',
        token_endpoint: 'https://example.com/oauth/token',
      };

      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'HEAD') {
          return Promise.resolve(new Response(null, {
            status: 401,
            headers: {
              'WWW-Authenticate': 'Bearer resource_metadata="http://example.com/.well-known/oauth-protected-resource"',
            },
          }));
        }
        if (url === 'https://example.com/.well-known/oauth-authorization-server') {
          return Promise.resolve(new Response(JSON.stringify(metadata), { status: 200 }));
        }
        return Promise.resolve(new Response('Not Found', { status: 404 }));
      });

      const result = await discoverOAuthMetadata('https://example.com/mcp');
      expect(result).toEqual(metadata);
    });

    it('handles trailing slash in authorization server URL', async () => {
      const protectedResourceMetadata = {
        resource: 'https://example.com/api',
        authorization_servers: ['https://example.com/auth/'], // Trailing slash
      };

      const authServerMetadata = {
        authorization_endpoint: 'https://example.com/auth/authorize',
        token_endpoint: 'https://example.com/auth/token',
      };

      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'HEAD') {
          return Promise.resolve(new Response(null, {
            status: 401,
            headers: {
              'WWW-Authenticate': 'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"',
            },
          }));
        }
        if (url === 'https://example.com/.well-known/oauth-protected-resource') {
          return Promise.resolve(new Response(JSON.stringify(protectedResourceMetadata), { status: 200 }));
        }
        // Should be normalized to single slash
        if (url === 'https://example.com/auth/.well-known/oauth-authorization-server') {
          return Promise.resolve(new Response(JSON.stringify(authServerMetadata), { status: 200 }));
        }
        return Promise.resolve(new Response('Not Found', { status: 404 }));
      });

      const result = await discoverOAuthMetadata('https://example.com/mcp');
      expect(result).toEqual(authServerMetadata);
    });

    it('parses resource_metadata with single quotes', async () => {
      const protectedResourceMetadata = {
        resource: 'https://example.com/api',
        authorization_servers: ['https://example.com/auth'],
      };

      const authServerMetadata = {
        authorization_endpoint: 'https://example.com/auth/authorize',
        token_endpoint: 'https://example.com/auth/token',
      };

      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'HEAD') {
          return Promise.resolve(new Response(null, {
            status: 401,
            headers: {
              // Single quotes instead of double quotes
              'WWW-Authenticate': "Bearer resource_metadata='https://example.com/.well-known/oauth-protected-resource'",
            },
          }));
        }
        if (url === 'https://example.com/.well-known/oauth-protected-resource') {
          return Promise.resolve(new Response(JSON.stringify(protectedResourceMetadata), { status: 200 }));
        }
        if (url === 'https://example.com/auth/.well-known/oauth-authorization-server') {
          return Promise.resolve(new Response(JSON.stringify(authServerMetadata), { status: 200 }));
        }
        return Promise.resolve(new Response('Not Found', { status: 404 }));
      });

      const result = await discoverOAuthMetadata('https://example.com/mcp');
      expect(result).toEqual(authServerMetadata);
    });
  });

  describe('RFC 8414 discovery fallback', () => {
    it('discovers metadata at origin root', async () => {
      const metadata = {
        authorization_endpoint: 'https://example.com/oauth/authorize',
        token_endpoint: 'https://example.com/oauth/token',
      };

      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        // HEAD request fails (no RFC 9728 support)
        if (options?.method === 'HEAD') {
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        if (url === 'https://example.com/.well-known/oauth-authorization-server') {
          return Promise.resolve(new Response(JSON.stringify(metadata), { status: 200 }));
        }
        return Promise.resolve(new Response('Not Found', { status: 404 }));
      });

      const result = await discoverOAuthMetadata('https://example.com/mcp');
      expect(result).toEqual(metadata);
    });

    it('falls back to path-scoped discovery', async () => {
      const metadata = {
        authorization_endpoint: 'https://api.ahrefs.com/oauth/authorize',
        token_endpoint: 'https://api.ahrefs.com/oauth/token',
      };

      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        // HEAD request fails
        if (options?.method === 'HEAD') {
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        if (url === 'https://api.ahrefs.com/.well-known/oauth-authorization-server/mcp/mcp') {
          return Promise.resolve(new Response(JSON.stringify(metadata), { status: 200 }));
        }
        return Promise.resolve(new Response('Not Found', { status: 404 }));
      });

      const result = await discoverOAuthMetadata('https://api.ahrefs.com/mcp/mcp');
      expect(result).toEqual(metadata);
    });
  });

  describe('error handling', () => {
    it('returns null when no metadata found', async () => {
      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'HEAD') {
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        return Promise.resolve(new Response('Not Found', { status: 404 }));
      });

      const result = await discoverOAuthMetadata('https://example.com/mcp');
      expect(result).toBeNull();
    });

    it('returns null for invalid URL', async () => {
      const result = await discoverOAuthMetadata('not-a-valid-url');
      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns null when metadata is missing required fields', async () => {
      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'HEAD') {
          return Promise.resolve(new Response(null, { status: 200 }));
        }
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
  });

  it('calls onLog callback with discovery progress', async () => {
    const logs: string[] = [];
    const onLog = (msg: string) => logs.push(msg);

    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (options?.method === 'HEAD') {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      return Promise.resolve(new Response('Not Found', { status: 404 }));
    });

    await discoverOAuthMetadata('https://example.com/mcp', onLog);

    expect(logs.some(l => l.includes('Discovering OAuth metadata'))).toBe(true);
    expect(logs.some(l => l.includes('RFC 9728'))).toBe(true);
    expect(logs.some(l => l.includes('No OAuth metadata found'))).toBe(true);
  });

  it('includes registration_endpoint when present', async () => {
    const metadata = {
      authorization_endpoint: 'https://example.com/oauth/authorize',
      token_endpoint: 'https://example.com/oauth/token',
      registration_endpoint: 'https://example.com/oauth/register',
    };

    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (options?.method === 'HEAD') {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      if (url === 'https://example.com/.well-known/oauth-authorization-server') {
        return Promise.resolve(new Response(JSON.stringify(metadata), { status: 200 }));
      }
      return Promise.resolve(new Response('Not Found', { status: 404 }));
    });

    const result = await discoverOAuthMetadata('https://example.com/mcp');
    expect(result?.registration_endpoint).toBe('https://example.com/oauth/register');
  });
});
