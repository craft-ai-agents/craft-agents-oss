/**
 * Logo URL utility
 *
 * Returns Google Favicon URLs for APIs and MCP servers.
 * Browser handles caching - no need to save files locally.
 */

import { debug } from './debug.ts';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';

// Cache path for persisted provider domains
const CRAFT_AGENT_DIR = join(homedir(), '.craft-agent');
const PROVIDER_DOMAINS_CACHE_PATH = join(CRAFT_AGENT_DIR, 'provider-domains.json');

// Google Favicon V2 API - free, reliable, no API key needed
// Updated URL: Google migrated from /s2/favicons to faviconV2
const GOOGLE_FAVICON_URL = 'https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=';

/**
 * Canonical domains for known providers.
 * Maps provider names to their canonical domain for proper favicon resolution.
 * This fixes issues like api.gmail.com returning a globe icon instead of Gmail logo.
 */
/**
 * Direct icon URLs for providers that need explicit URLs.
 * These take precedence over domain-based favicon fetching.
 */
export const PROVIDER_ICON_URLS: Record<string, string> = {
  // Docs and Sheets need direct URLs - their domains return generic Google logo
  docs: 'https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico',
  sheets: 'https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico',
};

/**
 * Canonical domains for known providers.
 * Maps provider names to their canonical domain for proper favicon resolution.
 */
export const PROVIDER_CANONICAL_DOMAINS: Record<string, string> = {
  // Google services - use product-specific subdomains (docs/sheets use direct URLs instead)
  gmail: 'mail.google.com',
  calendar: 'calendar.google.com',
  drive: 'drive.google.com',
  // Common MCP providers - their MCP URLs differ from their main domain
  github: 'github.com',
  linear: 'linear.app',
  slack: 'slack.com',
  notion: 'notion.so',
};

/**
 * Derive a service URL from source config for favicon resolution.
 * For stdio sources (no URL), falls back to https://{provider}.com
 *
 * This is a pure function that can be used in both Node.js and browser contexts.
 */
export function deriveServiceUrl(
  config: {
    mcp?: { url?: string };
    api?: { baseUrl?: string; googleService?: string };
    provider?: string;
  }
): string | null {
  // Get URL from config (API baseUrl takes precedence)
  let url = config.api?.baseUrl ?? config.mcp?.url ?? null;

  // For stdio sources (no URL), try provider name as domain
  if (!url && config.provider) {
    url = `https://${config.provider}.com`;
  }

  return url;
}

/**
 * Cache structure for persisted provider domains
 */
interface ProviderDomainsCache {
  version: 1;
  domains: Record<string, string>;
  updatedAt: number;
}

/**
 * Load cached provider domains from filesystem
 */
function loadProviderDomainsCache(): Record<string, string> {
  try {
    if (!existsSync(PROVIDER_DOMAINS_CACHE_PATH)) return {};
    const content = readFileSync(PROVIDER_DOMAINS_CACHE_PATH, 'utf-8');
    const cache = JSON.parse(content) as ProviderDomainsCache;
    return cache.domains || {};
  } catch {
    return {};
  }
}

/**
 * Save provider domain to cache file
 */
function saveProviderDomainToCache(provider: string, domain: string): void {
  try {
    // ~/.craft-agent/ always exists at this point (created during app setup)
    const existing = loadProviderDomainsCache();
    existing[provider.toLowerCase()] = domain;

    const cache: ProviderDomainsCache = {
      version: 1,
      domains: existing,
      updatedAt: Date.now(),
    };
    writeFileSync(PROVIDER_DOMAINS_CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
  } catch (error) {
    debug('[saveProviderDomainToCache] Failed:', error);
  }
}

/**
 * Lazy initialization flag for cached domains
 */
let providerDomainsInitialized = false;

/**
 * Load cached provider domains into memory on first use
 */
function ensureProviderDomainsLoaded(): void {
  if (providerDomainsInitialized) return;
  providerDomainsInitialized = true;

  const cached = loadProviderDomainsCache();
  // Merge cached domains into static map, but static takes precedence.
  // Using for loop over Object.assign for clarity - we only add keys that don't exist.
  for (const [provider, domain] of Object.entries(cached)) {
    if (!PROVIDER_CANONICAL_DOMAINS[provider]) {
      PROVIDER_CANONICAL_DOMAINS[provider] = domain;
    }
  }
  if (Object.keys(cached).length > 0) {
    debug(`[logo] Loaded ${Object.keys(cached).length} cached provider domains`);
  }
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Extract root domain from hostname (strips subdomains like api., www., etc.)
 * e.g., "api.github.com" -> "github.com"
 *       "mcp.linear.app" -> "linear.app"
 */
export function extractRootDomain(hostname: string): string {
  const parts = hostname.split('.');

  // Handle special TLDs like .co.uk, .com.au, etc.
  const specialTlds = ['co.uk', 'com.au', 'co.nz', 'co.jp', 'com.br', 'co.in'];
  const lastTwo = parts.slice(-2).join('.');

  if (specialTlds.includes(lastTwo) && parts.length > 2) {
    // Return last 3 parts: example.co.uk
    return parts.slice(-3).join('.');
  }

  // Return last 2 parts: github.com
  if (parts.length >= 2) {
    return parts.slice(-2).join('.');
  }

  return hostname;
}

/**
 * Common high-resolution favicon paths to try (in order of preference)
 */
const HIGH_RES_FAVICON_PATHS = [
  '/favicon.svg',              // SVG - best quality, scalable
  '/apple-touch-icon.png',     // Usually 180x180
  '/favicon.png',              // Common high-res PNG
  '/android-chrome-512x512.png', // Often 512x512
  '/fluidicon.png',            // GitHub-specific, 512x512
  '/icon.svg',                 // Alternative SVG path
];

/**
 * Check if a URL exists and returns an image (returns true for 2xx status codes with image content-type)
 */
async function urlExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    if (!response.ok) return false;

    // Verify it's actually an image, not HTML
    const contentType = response.headers.get('content-type');
    if (!contentType) return false;

    // Accept image types (svg, png, ico, etc.)
    return contentType.startsWith('image/');
  } catch {
    return false;
  }
}

/**
 * Parse favicon links from HTML <head> section
 * Returns array of {href: string, sizes: string | null} objects
 */
async function parseFaviconsFromHtml(url: string): Promise<Array<{href: string, sizes: string | null}>> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' } // Some sites block headless requests
    });

    if (!response.ok) return [];

    const html = await response.text();

    // Extract <head> section (basic regex - good enough for favicon parsing)
    const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    if (!headMatch || !headMatch[1]) return [];

    const head = headMatch[1];

    // Find all <link> tags with rel containing "icon"
    const linkRegex = /<link\s+([^>]*rel=["'](?:[^"']*\s)?(?:icon|apple-touch-icon)(?:\s[^"']*)?["'][^>]*)>/gi;
    const favicons: Array<{href: string, sizes: string | null}> = [];

    let match;
    while ((match = linkRegex.exec(head)) !== null) {
      const attrs = match[1];
      if (!attrs) continue;

      // Extract href attribute
      const hrefMatch = attrs.match(/href=["']([^"']+)["']/i);
      if (!hrefMatch || !hrefMatch[1]) continue;

      let href = hrefMatch[1];

      // Convert relative URLs to absolute
      if (href.startsWith('//')) {
        href = `https:${href}`;
      } else if (href.startsWith('/')) {
        const origin = new URL(url).origin;
        href = `${origin}${href}`;
      } else if (!href.startsWith('http')) {
        const baseUrl = new URL(url);
        href = `${baseUrl.origin}/${href}`;
      }

      // Extract sizes attribute (e.g., "180x180", "512x512")
      const sizesMatch = attrs.match(/sizes=["']([^"']+)["']/i);
      const sizes = sizesMatch && sizesMatch[1] ? sizesMatch[1] : null;

      favicons.push({ href, sizes });
    }

    return favicons;
  } catch {
    return [];
  }
}

/**
 * Pick the best favicon from parsed HTML links
 * Prefers SVG, then largest PNG/ICO by size attribute
 */
function pickBestFavicon(favicons: Array<{href: string, sizes: string | null}>): string | null {
  if (favicons.length === 0) return null;

  // Prefer SVG (scalable, always best quality)
  const svg = favicons.find(f => f.href.endsWith('.svg'));
  if (svg) return svg.href;

  // Sort by size (largest first)
  const withSizes = favicons
    .filter(f => f.sizes && f.sizes !== 'any')
    .map(f => {
      const sizeMatch = f.sizes?.match(/(\d+)x(\d+)/);
      const size = sizeMatch && sizeMatch[1] ? parseInt(sizeMatch[1], 10) : 0;
      return { ...f, sizeNum: size };
    })
    .sort((a, b) => b.sizeNum - a.sizeNum);

  const largestWithSize = withSizes[0];
  if (largestWithSize && largestWithSize.sizeNum >= 128) {
    return largestWithSize.href;
  }

  // Fall back to first available
  return favicons[0]?.href ?? null;
}

/**
 * Validate provider name is safe for LLM prompt interpolation.
 * Only allows alphanumeric, hyphens, underscores. 2-50 chars.
 * Prevents prompt injection attacks.
 */
function isValidProviderName(provider: string): boolean {
  // Must be 2-50 chars, alphanumeric with hyphens/underscores (no leading/trailing special chars)
  // Also allow single alphanumeric char for edge cases
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,48}[a-zA-Z0-9]$|^[a-zA-Z0-9]{1,2}$/.test(provider);
}

/**
 * Validate domain looks legitimate and safe.
 * Prevents accepting malicious or internal domains from LLM.
 */
function isValidDomain(domain: string): boolean {
  // Basic domain format: alphanumeric segments separated by dots, 2-63 char TLD
  // (some new TLDs are longer than 6 chars, e.g., .technology, .international)
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$/.test(domain)) {
    return false;
  }

  // Block obvious bad patterns
  if (domain.includes('..') || domain.startsWith('-') || domain.endsWith('-')) {
    return false;
  }

  // Block localhost and private/internal domains
  if (domain === 'localhost' || domain.endsWith('.local') || domain.endsWith('.internal')) {
    return false;
  }

  return true;
}

/**
 * Use Haiku to resolve unknown provider names to canonical domains.
 * Only called when static maps don't have the provider.
 *
 * Security: Input is validated to prevent prompt injection,
 * output is validated to prevent accepting malicious domains.
 */
async function resolveProviderWithHaiku(provider: string): Promise<string | null> {
  // Input validation - reject suspicious provider names to prevent prompt injection
  if (!isValidProviderName(provider)) {
    debug(`[resolveProviderWithHaiku] Rejected invalid provider name: "${provider.slice(0, 50)}"`);
    return null;
  }

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();

    const response = await client.messages.create({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 50,
      messages: [{
        role: 'user',
        content: `What is the main website domain for the service "${provider}"? Reply with ONLY the domain (e.g., "notion.so", "github.com", "brave.com") or "unknown" if you're not sure.`
      }]
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const domain = text.trim().toLowerCase();

    // Output validation - reject invalid/suspicious domains
    if (domain === 'unknown' || !isValidDomain(domain)) {
      debug(`[resolveProviderWithHaiku] Rejected invalid domain: "${domain}" for provider: "${provider}"`);
      return null;
    }

    // Cache for future calls in this process
    PROVIDER_CANONICAL_DOMAINS[provider.toLowerCase()] = domain;

    // Persist to filesystem for future app restarts
    saveProviderDomainToCache(provider, domain);

    debug(`[resolveProviderWithHaiku] Resolved "${provider}" → "${domain}"`);

    return domain;
  } catch (error) {
    debug(`[resolveProviderWithHaiku] Failed for "${provider}":`, error);
    return null;
  }
}

/**
 * Get high-quality logo URL for a service
 * Tries direct favicon paths, then parses HTML <head>, before falling back to Google API
 *
 * This function makes HTTP requests to find the best quality favicon.
 * Results should be cached (stored in source config) to avoid repeated requests.
 *
 * @param serviceUrl - The service URL to get logo for
 * @param provider - Optional provider name (e.g., 'gmail') to use canonical domain mapping
 */
export async function getHighQualityLogoUrl(serviceUrl: string, provider?: string): Promise<string | null> {
  // Load cached provider domains on first call
  ensureProviderDomainsLoaded();

  // Check if provider has a direct icon URL (highest priority)
  if (provider) {
    const directIconUrl = PROVIDER_ICON_URLS[provider.toLowerCase()];
    if (directIconUrl) {
      return directIconUrl;
    }

    // Check if provider has a canonical domain mapping
    const canonicalDomain = PROVIDER_CANONICAL_DOMAINS[provider.toLowerCase()];
    if (canonicalDomain) {
      // Use canonical domain for favicon resolution
      return getHighQualityLogoUrl(`https://${canonicalDomain}`);
    }

    // Try Haiku resolution for unknown providers
    const resolvedDomain = await resolveProviderWithHaiku(provider);
    if (resolvedDomain) {
      return getHighQualityLogoUrl(`https://${resolvedDomain}`);
    }
  }

  const fullDomain = extractDomain(serviceUrl);
  if (!fullDomain) {
    return null;
  }

  // Skip internal domains
  if (fullDomain === 'localhost' || fullDomain.endsWith('.local') || /^[\d.]+$/.test(fullDomain)) {
    return null;
  }

  const rootDomain = extractRootDomain(fullDomain);
  const hasSubdomain = fullDomain !== rootDomain;

  // Helper to try favicon paths on a domain
  async function tryFaviconPaths(domain: string): Promise<string | null> {
    const origin = `https://${domain}`;

    // Try high-res favicon paths
    for (const path of HIGH_RES_FAVICON_PATHS) {
      const url = `${origin}${path}`;
      if (await urlExists(url)) {
        return url;
      }
    }

    // Parse HTML <head> for favicon links
    const favicons = await parseFaviconsFromHtml(origin);
    if (favicons.length > 0) {
      const bestFavicon = pickBestFavicon(favicons);
      if (bestFavicon && await urlExists(bestFavicon)) {
        return bestFavicon;
      }
    }

    return null;
  }

  // Step 1: Try full domain first (e.g., mail.google.com)
  if (hasSubdomain) {
    const result = await tryFaviconPaths(fullDomain);
    if (result) {
      return result;
    }
  }

  // Step 2: Try root domain (e.g., google.com)
  const result = await tryFaviconPaths(rootDomain);
  if (result) {
    return result;
  }

  // Step 3: Fall back to Google Favicon V2 API (uses full domain for better results)
  return `${GOOGLE_FAVICON_URL}128&url=https://${fullDomain}`;
}

/**
 * Get logo URL for a service (synchronous, uses Google Favicon API)
 * Returns Google Favicon URL or null for internal domains
 *
 * @param serviceUrl - The service URL to get logo for
 * @param provider - Optional provider name (e.g., 'gmail') to use canonical domain mapping
 * @deprecated Use getHighQualityLogoUrl() when possible for better quality
 */
export function getLogoUrl(serviceUrl: string, provider?: string): string | null {
  // Check if provider has a direct icon URL (highest priority)
  if (provider) {
    const directIconUrl = PROVIDER_ICON_URLS[provider.toLowerCase()];
    if (directIconUrl) {
      return directIconUrl;
    }

    // Check if provider has a canonical domain mapping
    const canonicalDomain = PROVIDER_CANONICAL_DOMAINS[provider.toLowerCase()];
    if (canonicalDomain) {
      return `${GOOGLE_FAVICON_URL}128&url=https://${canonicalDomain}`;
    }
  }

  const fullDomain = extractDomain(serviceUrl);
  if (!fullDomain) {
    return null;
  }

  // Skip internal domains
  if (fullDomain === 'localhost' || fullDomain.endsWith('.local') || /^[\d.]+$/.test(fullDomain)) {
    return null;
  }

  // Extract root domain (strips subdomains like api., www., etc.)
  const rootDomain = extractRootDomain(fullDomain);

  // Return Google Favicon V2 URL - browser handles caching
  return `${GOOGLE_FAVICON_URL}128&url=https://${rootDomain}`;
}

/**
 * Download icon and save to folder as icon.[ext]
 * Returns relative path (e.g., "./icon.png") or null on failure
 */
export async function cacheIcon(iconUrl: string, destDir: string): Promise<string | null> {
  const { existsSync, mkdirSync, writeFileSync } = await import('fs');
  const { join } = await import('path');

  try {
    const response = await fetch(iconUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) return null;

    // Verify it's actually an image
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) return null;

    // Get extension from content-type or URL
    const typeToExt: Record<string, string> = {
      'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg',
      'image/webp': 'webp', 'image/gif': 'gif', 'image/x-icon': 'ico',
    };
    const urlExt = iconUrl.match(/\.(png|jpg|jpeg|svg|webp|gif|ico)$/i)?.[1]?.toLowerCase();
    const ext = typeToExt[contentType.split(';')[0] ?? ''] ?? urlExt ?? 'png';
    const filename = `icon.${ext}`;

    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, filename), Buffer.from(await response.arrayBuffer()));

    return `./${filename}`;
  } catch {
    return null;
  }
}
