function stripErrorWrappers(content: string): string {
  return content
    .replace(/<\/?error>/gi, '')
    .replace(/<\/?tool_use_error>/gi, '')
    .replace(/^\[ERROR]\s*/i, '')
    .trim()
}

export function normalizeMcpErrorMessage(raw: string | undefined | null): string {
  const cleaned = stripErrorWrappers(String(raw ?? '')).replace(/^MCP connection failed health check:\s*/i, '').trim()
  if (!cleaned) return 'MCP connection failed.'

  const lower = cleaned.toLowerCase()

  if (
    lower.includes('source requires authentication')
    || lower.includes('authentication failed')
    || lower.includes('401')
    || lower.includes('403')
    || lower.includes('unauthorized')
    || lower.includes('forbidden')
    || lower.includes('token refresh failed')
    || lower.includes('refresh error:')
  ) {
    return 'Authentication failed. Please re-authenticate with this source.'
  }

  if (lower.includes('not been tested yet')) {
    return 'Source has not been tested yet.'
  }

  if (lower.includes('no command configured')) {
    return 'MCP server command is not configured.'
  }

  if (lower.includes('enoent') && lower.includes('spawn')) {
    return 'MCP server command was not found. Check that it is installed and available on PATH.'
  }

  if (lower.includes('404') || lower.includes('not found') || lower.includes('endpoint not found')) {
    return 'MCP server endpoint not found. Check that the URL is correct and the server is online.'
  }

  if (lower.includes('timed out') || lower.includes('timeout') || lower.includes('abort')) {
    return 'MCP server timed out. Check that the server is running and responding.'
  }

  if (
    lower.includes('fetch failed')
    || lower.includes('failed to fetch')
    || lower.includes('failed to connect')
    || lower.includes('connection refused')
    || lower.includes('econnrefused')
    || lower.includes('econnreset')
    || lower.includes('enotfound')
    || lower.includes('socket hang up')
    || lower.includes('networkerror')
    || lower.includes('network error')
  ) {
    return 'MCP server is unreachable. Check that the server is running and reachable.'
  }

  return cleaned
}

export function maybeNormalizeMcpErrorMessage(raw: string | undefined | null): string | undefined {
  if (raw == null) return undefined
  const cleaned = stripErrorWrappers(String(raw))
  const lower = cleaned.toLowerCase()
  const looksLikeMcpError =
    lower.includes('mcp')
    || lower.includes('source requires authentication')
    || lower.includes('token refresh failed')
    || lower.includes('refresh error:')
    || (lower.includes('spawn') && lower.includes('enoent'))

  return looksLikeMcpError ? normalizeMcpErrorMessage(cleaned) : cleaned
}
