export interface WebPreviewLinkLike {
  label: string;
  url: string;
  role?: 'primary' | 'source' | 'related' | 'external';
}

export interface WebPreviewAssetLike {
  id: string;
  label?: string;
  role?: string;
  path: string;
  mimeType?: string;
}

export interface WebPreviewOutputLike {
  id?: string;
  workspaceId?: string;
  title?: string;
  preview?: {
    mode?: string;
    assetId?: string;
  };
  primary?: WebPreviewAssetLike;
  assets: WebPreviewAssetLike[];
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
export const RUNNER_OUTPUT_SCHEME = 'runner-output';

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

export function resolveGeneratedHtmlPreviewTarget(output: WebPreviewOutputLike): LocalWebPreviewTarget | null {
  if (output.preview?.mode !== 'web') return null;
  if (!output.workspaceId || !output.id) return null;

  const asset = selectHtmlPreviewAsset(output);
  if (!asset || !isSafeProtocolAssetPath(asset.path)) return null;

  return {
    url: buildRunnerOutputAssetUrl(output.workspaceId, output.id, asset.path),
    label: asset.label || output.title || 'HTML preview',
    displayHost: 'generated output',
  };
}

export function buildRunnerOutputAssetUrl(workspaceId: string, outputId: string, assetPath: string): string {
  const segments = assetPath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  return `${RUNNER_OUTPUT_SCHEME}://asset/${encodeURIComponent(workspaceId)}/${encodeURIComponent(outputId)}/${segments}`;
}

export function parseRunnerOutputAssetUrl(value: string): { workspaceId: string; outputId: string; assetPath: string } | null {
  const parsed = parseUrl(value);
  if (!parsed || parsed.protocol !== `${RUNNER_OUTPUT_SCHEME}:` || parsed.hostname !== 'asset') return null;
  const segments = parsed.pathname.split('/').filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return '';
    }
  });
  const [workspaceId, outputId, ...assetSegments] = segments;
  const assetPath = assetSegments.join('/');
  if (!workspaceId || !outputId || !isSafeProtocolAssetPath(assetPath)) return null;
  return { workspaceId, outputId, assetPath };
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

function selectHtmlPreviewAsset(output: WebPreviewOutputLike): WebPreviewAssetLike | null {
  if (output.preview?.assetId) {
    return output.assets.find((asset) => asset.id === output.preview?.assetId && isHtmlAsset(asset)) ?? null;
  }
  if (output.primary && isHtmlAsset(output.primary)) return output.primary;
  return output.assets.find((asset) => asset.role === 'primary' && isHtmlAsset(asset))
    ?? output.assets.find(isHtmlAsset)
    ?? null;
}

function isHtmlAsset(asset: WebPreviewAssetLike): boolean {
  const mime = asset.mimeType?.toLowerCase() ?? '';
  const path = asset.path.toLowerCase();
  return mime === 'text/html' || path.endsWith('.html') || path.endsWith('.htm');
}

function isSafeProtocolAssetPath(assetPath: string): boolean {
  if (!assetPath || assetPath.includes('\0') || assetPath.startsWith('/') || /^[a-z]:[\\/]/i.test(assetPath)) return false;
  const segments = assetPath.split('/');
  return segments.every((segment) => segment && segment !== '.' && segment !== '..' && !segment.includes('\\'));
}

function parseUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
