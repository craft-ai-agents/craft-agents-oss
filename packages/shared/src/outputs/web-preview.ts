export interface WebPreviewLinkLike {
  label: string;
  url: string;
  role?: 'primary' | 'source' | 'related' | 'external';
}

export interface WebPreviewOutputLike {
  preview?: {
    mode?: string;
  };
  assets: unknown[];
  links: WebPreviewLinkLike[];
}

export interface LocalWebPreviewTarget {
  url: string;
  label: string;
  displayHost: string;
}

export interface WebPreviewPolicyOptions {
  blockedOrigins?: string[];
}

const LOCAL_WEB_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function isLocalWebPreviewUrl(value: string | undefined, options: WebPreviewPolicyOptions = {}): boolean {
  const parsed = parseUrl(value);
  if (!parsed) return false;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  if (options.blockedOrigins?.some((origin) => origin === parsed.origin)) return false;
  return LOCAL_WEB_HOSTS.has(normalizeLocalWebHostname(parsed.hostname));
}

export function resolveLocalWebPreviewTarget(
  output: WebPreviewOutputLike,
  options: WebPreviewPolicyOptions = {},
): LocalWebPreviewTarget | null {
  const candidate = selectPreviewLink(output, options);
  if (!candidate || !isLocalWebPreviewUrl(candidate.url, options)) return null;
  const parsed = parseUrl(candidate.url);
  if (!parsed) return null;
  const frameUrl = normalizeLocalWebFrameUrl(parsed);
  const hostname = normalizeLocalWebHostname(frameUrl.hostname);
  return {
    url: frameUrl.toString(),
    label: candidate.label || 'Local preview',
    displayHost: frameUrl.port ? `${hostname}:${frameUrl.port}` : hostname,
  };
}

export function normalizeLocalWebHostname(hostname: string): string {
  return hostname.replace(/^\[(.*)\]$/, '$1');
}

function normalizeLocalWebFrameUrl(url: URL): URL {
  const normalized = new URL(url.toString());
  if (normalizeLocalWebHostname(normalized.hostname) === '::1') {
    normalized.hostname = 'localhost';
  }
  return normalized;
}

function selectPreviewLink(output: WebPreviewOutputLike, options: WebPreviewPolicyOptions): WebPreviewLinkLike | null {
  if (output.preview?.mode === 'web' || output.preview?.mode === 'external-link') {
    return output.links.find((link) => link.role === 'primary') ?? output.links[0] ?? null;
  }

  if (output.assets.length > 0) return null;

  return output.links.find((link) => link.role === 'primary' && isLocalWebPreviewUrl(link.url, options))
    ?? output.links.find((link) => isLocalWebPreviewUrl(link.url, options))
    ?? null;
}

function parseUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
