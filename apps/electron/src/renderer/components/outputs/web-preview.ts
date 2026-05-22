import type { OutputLinkDTO, OutputManifestDTO } from '@/hooks/useOutputs'

const LOCAL_WEB_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export interface WebPreviewTarget {
  url: string
  label: string
  displayHost: string
}

export function isLocalWebPreviewUrl(value: string | undefined): boolean {
  const parsed = parseUrl(value)
  if (!parsed) return false
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (parsed.username || parsed.password) return false
  return LOCAL_WEB_HOSTS.has(normalizeHostname(parsed.hostname))
}

export function resolveWebPreviewTarget(manifest: OutputManifestDTO): WebPreviewTarget | null {
  const candidate = selectPreviewLink(manifest)
  if (!candidate || !isLocalWebPreviewUrl(candidate.url)) return null
  const parsed = parseUrl(candidate.url)
  if (!parsed) return null
  const frameUrl = normalizeFrameUrl(parsed)
  return {
    url: frameUrl.toString(),
    label: candidate.label || 'Local preview',
    displayHost: frameUrl.port ? `${normalizeHostname(frameUrl.hostname)}:${frameUrl.port}` : normalizeHostname(frameUrl.hostname),
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[(.*)\]$/, '$1')
}

function normalizeFrameUrl(url: URL): URL {
  const normalized = new URL(url.toString())
  if (normalizeHostname(normalized.hostname) === '::1') {
    normalized.hostname = 'localhost'
  }
  return normalized
}

function selectPreviewLink(manifest: OutputManifestDTO): OutputLinkDTO | null {
  if (manifest.preview?.mode === 'web' || manifest.preview?.mode === 'external-link') {
    const primary = manifest.links.find((link) => link.role === 'primary')
    if (primary) return primary
    return manifest.links[0] ?? null
  }

  if (manifest.assets.length > 0) return null

  return manifest.links.find((link) => link.role === 'primary' && isLocalWebPreviewUrl(link.url))
    ?? manifest.links.find((link) => isLocalWebPreviewUrl(link.url))
    ?? null
}

function parseUrl(value: string | undefined): URL | null {
  if (!value) return null
  try {
    return new URL(value)
  } catch {
    return null
  }
}
