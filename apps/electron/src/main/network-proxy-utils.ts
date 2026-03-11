export interface NoProxyRule {
  host: string
  port?: string
  matchAll?: boolean
}

function normalizeHost(host: string): string {
  return host.trim().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '').toLowerCase()
}

function getEffectivePort(url: URL): string {
  if (url.port) return url.port
  return url.protocol === 'https:' ? '443' : url.protocol === 'http:' ? '80' : ''
}

function isIpLiteral(host: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':')
}

export function parseNoProxyRules(noProxy?: string): NoProxyRule[] {
  if (!noProxy?.trim()) return []

  return noProxy
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map<NoProxyRule | null>((part) => {
      if (part === '*') {
        return { host: '*', matchAll: true }
      }

      let hostPort = part
      if (part.includes('://')) {
        try {
          const parsed = new URL(part)
          hostPort = parsed.host
        } catch {
          return null
        }
      }

      let port: string | undefined
      let host = hostPort

      if (hostPort.startsWith('[')) {
        const closingBracket = hostPort.indexOf(']')
        if (closingBracket === -1) return null
        host = hostPort.slice(1, closingBracket)
        const rest = hostPort.slice(closingBracket + 1)
        port = rest.startsWith(':') ? rest.slice(1) || undefined : undefined
      } else {
        const parts = hostPort.split(':')
        if (parts.length === 2) {
          ;[host, port] = parts
        } else if (parts.length > 2) {
          host = hostPort
        }
      }

      host = normalizeHost(host.replace(/^\./, ''))
      if (!host) return null

      return { host, port }
    })
    .filter((rule): rule is NoProxyRule => !!rule)
}

export function shouldBypassProxy(url: URL, rules: NoProxyRule[]): boolean {
  if (!rules.length) return false

  const hostname = normalizeHost(url.hostname)
  const port = getEffectivePort(url)

  return rules.some((rule) => {
    if (rule.matchAll) return true
    if (rule.port && rule.port !== port) return false
    if (hostname === rule.host) return true
    if (isIpLiteral(hostname) || isIpLiteral(rule.host)) return false
    return hostname.endsWith(`.${rule.host}`)
  })
}
