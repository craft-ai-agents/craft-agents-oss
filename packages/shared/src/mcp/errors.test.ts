import { describe, expect, it } from 'bun:test'
import { normalizeMcpErrorMessage } from './errors.ts'

describe('normalizeMcpErrorMessage', () => {
  it('normalizes auth failures to a consistent re-auth message', () => {
    expect(normalizeMcpErrorMessage('401 Unauthorized')).toBe(
      'Authentication failed. Please re-authenticate with this source.',
    )
    expect(normalizeMcpErrorMessage('Source requires authentication')).toBe(
      'Authentication failed. Please re-authenticate with this source.',
    )
    expect(normalizeMcpErrorMessage('Token refresh failed')).toBe(
      'Authentication failed. Please re-authenticate with this source.',
    )
  })

  it('normalizes endpoint and transport failures', () => {
    expect(normalizeMcpErrorMessage('MCP connection failed health check: 404 Not Found')).toBe(
      'MCP server endpoint not found. Check that the URL is correct and the server is online.',
    )
    expect(normalizeMcpErrorMessage('fetch failed')).toBe(
      'MCP server is unreachable. Check that the server is running and reachable.',
    )
    expect(normalizeMcpErrorMessage('Connection refused')).toBe(
      'MCP server is unreachable. Check that the server is running and reachable.',
    )
    expect(normalizeMcpErrorMessage('Request timed out after 10 seconds')).toBe(
      'MCP server timed out. Check that the server is running and responding.',
    )
  })

  it('normalizes stdio command errors', () => {
    expect(normalizeMcpErrorMessage('No command configured for stdio MCP source')).toBe(
      'MCP server command is not configured.',
    )
    expect(normalizeMcpErrorMessage('spawn uv ENOENT')).toBe(
      'MCP server command was not found. Check that it is installed and available on PATH.',
    )
  })

  it('strips wrappers and preserves unknown details', () => {
    expect(normalizeMcpErrorMessage('[ERROR] <error><tool_use_error>boom</tool_use_error></error>')).toBe('boom')
  })
})
