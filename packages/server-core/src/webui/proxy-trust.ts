import { BlockList, isIP } from 'node:net'

/** Only the HTTP adapter may supply this metadata. Never populate it from headers. */
export interface HttpPeerContext { remoteAddress?: string | null }

export function normalizeIp(value: string | null | undefined): string | null {
  if (!value || value.includes('%') || !isIP(value)) return null
  if (isIP(value) === 4) return value
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1)
  const mapped = canonical.match(/^::ffff:([\da-f]+):([\da-f]+)$/i)
  if (mapped) {
    const high = parseInt(mapped[1]!, 16), low = parseInt(mapped[2]!, 16)
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
  }
  return canonical
}

/** Invalid/broad configuration fails at startup; no hostnames, wildcard trust or DNS lookup. */
export function createProxyTrust(entries: string[] = []): (address: string | null | undefined) => boolean {
  if (entries.length > 128) throw new Error('Too many trusted proxy entries')
  const list = new BlockList()
  for (const entry of entries) {
    const parts = entry.trim().split('/')
    const ip = normalizeIp(parts[0])
    const family = ip && isIP(ip) === 4 ? 'ipv4' : 'ipv6'
    const bits = family === 'ipv4' ? 32 : 128
    if (!ip || parts.length > 2) throw new Error('Trusted proxies must be IP literals or CIDRs')
    if (parts.length === 1) list.addAddress(ip, family)
    else {
      const prefix = parts[1]!
      // IPv4-mapped subnet notation is ambiguous after normalization; require plain IPv4 CIDRs.
      if (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > bits
        || (family === 'ipv4' && parts[0]!.includes(':'))) throw new Error('Invalid trusted proxy CIDR')
      list.addSubnet(ip, Number(prefix), family)
    }
  }
  return address => {
    const ip = normalizeIp(address)
    return !!ip && list.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6')
  }
}

export function resolveClientIp(req: Request, peer: HttpPeerContext | undefined, trusted: ReturnType<typeof createProxyTrust>): string {
  const address = normalizeIp(peer?.remoteAddress)
  if (!address) return 'unknown-peer'
  if (!trusted(address)) return address
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded !== null) {
    if (forwarded.length > 4096) return address
    const chain = forwarded.split(',').map(value => normalizeIp(value.trim()))
    if (chain.length > 32 || chain.some(value => !value)) return address
    // Walk from the connection toward the client, stopping at the first untrusted hop.
    let client = address
    for (let index = chain.length - 1; index >= 0 && trusted(client); index--) client = chain[index]!
    return client
  }
  return normalizeIp(req.headers.get('x-real-ip')?.trim()) ?? address
}

/** Trusted ingress must overwrite these headers; ambiguous lists are ignored. */
export function proxyOriginValue(req: Request, key: 'proto' | 'host'): string | null {
  const direct = req.headers.get(`x-forwarded-${key}`)
  if (direct !== null) return direct.length <= 512 && !direct.includes(',') ? direct.trim() : null
  const forwarded = req.headers.get('forwarded')
  if (!forwarded || forwarded.length > 2048 || forwarded.includes(',')) return null
  const fields = forwarded.split(';').map(part => part.trim()).filter(part => part.toLowerCase().startsWith(`${key}=`))
  if (fields.length !== 1) return null
  const value = fields[0]!.slice(key.length + 1)
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value
}

export function validHost(value: string | null): string | null {
  if (!value || value.length > 253 || /[\s/@\\?#,;]/.test(value)) return null
  try {
    const parsed = new URL(`http://${value}`)
    return parsed.hostname && parsed.pathname === '/' ? parsed.host : null
  } catch { return null }
}
