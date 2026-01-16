/**
 * Unified Icon Cache
 *
 * Single cache for source, skill, and status icons.
 * Used by SourceAvatar, SkillAvatar, todo-states, and RichTextInput.
 *
 * Icons are stored as data URLs for consistent usage across:
 * - React components (img src)
 * - HTML string generation (inline badges)
 *
 * Cache key format uses type prefixes to avoid collisions:
 * - source:{workspaceId}:{slug}
 * - skill:{workspaceId}:{slug}
 * - status:{workspaceId}:{relativePath}
 */

// ============================================================================
// Types
// ============================================================================

interface SourceConfig {
  slug: string
  name: string
  type: string
  icon?: string  // Emoji or URL (local icon files are auto-discovered separately)
  provider?: string
  mcp?: {
    url?: string
  }
  api?: {
    baseUrl?: string
  }
}

interface SkillConfig {
  slug: string
  iconPath?: string
}

// ============================================================================
// Unified Cache
// ============================================================================

/**
 * Single unified cache for all icon types.
 * Key format: `{type}:{workspaceId}:{identifier}`
 * - source:wsId:slug
 * - skill:wsId:slug
 * - status:wsId:relativePath
 */
export const iconCache = new Map<string, string>()

/**
 * Cache for resolved logo URLs (from service URL resolution).
 * Kept separate because it caches URL resolution, not icon data,
 * and uses a different key format: `{serviceUrl}:{provider}`
 */
export const logoUrlCache = new Map<string, string | null>()

// ============================================================================
// Legacy exports (for backward compatibility during migration)
// These are views into the unified cache, not separate maps.
// ============================================================================

// Proxy objects that redirect to the unified cache with appropriate prefixes
// This allows consumers to continue using the old API while we migrate them

/** @deprecated Use iconCache directly with 'source:' prefix */
export const sourceIconCache = {
  get: (key: string) => iconCache.get(`source:${key}`),
  set: (key: string, value: string) => iconCache.set(`source:${key}`, value),
  has: (key: string) => iconCache.has(`source:${key}`),
  delete: (key: string) => iconCache.delete(`source:${key}`),
  clear: () => {
    // Clear only source entries
    for (const key of iconCache.keys()) {
      if (key.startsWith('source:')) iconCache.delete(key)
    }
  },
}

/** @deprecated Use iconCache directly with 'skill:' prefix */
export const skillIconCache = {
  get: (key: string) => iconCache.get(`skill:${key}`),
  set: (key: string, value: string) => iconCache.set(`skill:${key}`, value),
  has: (key: string) => iconCache.has(`skill:${key}`),
  delete: (key: string) => iconCache.delete(`skill:${key}`),
  clear: () => {
    // Clear only skill entries
    for (const key of iconCache.keys()) {
      if (key.startsWith('skill:')) iconCache.delete(key)
    }
  },
}

/** @deprecated Use iconCache directly with 'status:' prefix */
export const statusIconCache = {
  get: (key: string) => iconCache.get(`status:${key}`),
  set: (key: string, value: string) => iconCache.set(`status:${key}`, value),
  has: (key: string) => iconCache.has(`status:${key}`),
  delete: (key: string) => iconCache.delete(`status:${key}`),
  clear: () => {
    // Clear only status entries
    for (const key of iconCache.keys()) {
      if (key.startsWith('status:')) iconCache.delete(key)
    }
  },
}

// ============================================================================
// Cache Management
// ============================================================================

/**
 * Clear all icon caches
 */
export function clearIconCaches(): void {
  iconCache.clear()
  logoUrlCache.clear()
}

/**
 * Clear source icon caches only
 */
export function clearSourceIconCaches(): void {
  sourceIconCache.clear()
  logoUrlCache.clear()
}

/**
 * Clear skill icon caches only
 */
export function clearSkillIconCaches(): void {
  skillIconCache.clear()
}

/**
 * Clear status icon caches only
 */
export function clearStatusIconCaches(): void {
  statusIconCache.clear()
}

// ============================================================================
// Source Icon Loading
// ============================================================================

/**
 * Load a source icon into the cache.
 * For local icons (./path), loads via IPC.
 * For remote sources, resolves favicon URL.
 *
 * @returns Promise resolving to the icon URL (data URL or favicon URL)
 */
export async function loadSourceIcon(
  source: { config: SourceConfig; workspaceId: string },
): Promise<string | null> {
  const { config, workspaceId } = source
  const cacheKey = `${workspaceId}:${config.slug}`

  // Check cache first
  const cached = sourceIconCache.get(cacheKey)
  if (cached) return cached

  // Check if icon is a local path (legacy format - new sources use auto-discovered icon files)
  const icon = config.icon
  if (icon?.startsWith('./')) {
    // Local icon - load via IPC
    const iconFilename = icon.slice(2) // Remove './'
    const relativePath = `sources/${config.slug}/${iconFilename}`

    try {
      const result = await window.electronAPI.readWorkspaceImage(workspaceId, relativePath)
      // For SVG, theme and convert to data URL
      // This injects foreground color since currentColor doesn't work in background-image
      let url = result
      if (relativePath.endsWith('.svg')) {
        url = svgToThemedDataUrl(result)
      }
      sourceIconCache.set(cacheKey, url)
      return url
    } catch (error) {
      console.error(`[IconCache] Failed to load source icon ${relativePath}:`, error)
      return null
    }
  }

  // Remote source - resolve favicon URL
  const serviceUrl = deriveServiceUrl(config)
  if (!serviceUrl) return null

  // Use slug for favicon resolution - it's more specific than generic provider names
  const provider = config.slug ?? config.provider
  const logoCacheKey = `${serviceUrl}:${provider ?? ''}`

  // Check logo URL cache
  const cachedLogoUrl = logoUrlCache.get(logoCacheKey)
  if (cachedLogoUrl !== undefined) {
    if (cachedLogoUrl) {
      sourceIconCache.set(cacheKey, cachedLogoUrl)
    }
    return cachedLogoUrl
  }

  try {
    const logoUrl = await window.electronAPI.getLogoUrl(serviceUrl, provider)
    logoUrlCache.set(logoCacheKey, logoUrl)
    if (logoUrl) {
      sourceIconCache.set(cacheKey, logoUrl)
    }
    return logoUrl
  } catch (error) {
    console.error(`[IconCache] Failed to resolve logo URL:`, error)
    logoUrlCache.set(logoCacheKey, null)
    return null
  }
}

/**
 * Get a source icon synchronously from cache.
 * Returns null if not cached (use loadSourceIcon to populate).
 */
export function getSourceIconSync(workspaceId: string, slug: string): string | null {
  const cacheKey = `${workspaceId}:${slug}`
  return sourceIconCache.get(cacheKey) ?? null
}

// ============================================================================
// Skill Icon Loading
// ============================================================================

/**
 * Load a skill icon into the cache.
 *
 * @returns Promise resolving to the icon data URL
 */
export async function loadSkillIcon(
  skill: SkillConfig,
  workspaceId: string,
): Promise<string | null> {
  const iconPath = skill.iconPath
  if (!iconPath) return null

  const cacheKey = `${workspaceId}:${skill.slug}`

  // Check cache first
  const cached = skillIconCache.get(cacheKey)
  if (cached) return cached

  // Extract relative path from absolute icon path
  // iconPath is absolute, we need to get the skills/slug/icon.ext part
  const skillsMatch = iconPath.match(/skills\/([^/]+)\/(.+)$/)
  if (!skillsMatch) return null

  const relativePath = `skills/${skillsMatch[1]}/${skillsMatch[2]}`

  try {
    const result = await window.electronAPI.readWorkspaceImage(workspaceId, relativePath)
    // For SVG, theme and convert to data URL
    // This injects foreground color since currentColor doesn't work in background-image
    let url = result
    if (relativePath.endsWith('.svg')) {
      url = svgToThemedDataUrl(result)
    }
    skillIconCache.set(cacheKey, url)
    return url
  } catch (error) {
    console.error(`[IconCache] Failed to load skill icon ${relativePath}:`, error)
    return null
  }
}

/**
 * Get a skill icon synchronously from cache.
 * Returns null if not cached (use loadSkillIcon to populate).
 */
export function getSkillIconSync(workspaceId: string, slug: string): string | null {
  const cacheKey = `${workspaceId}:${slug}`
  return skillIconCache.get(cacheKey) ?? null
}

// ============================================================================
// SVG Theming
// ============================================================================

/**
 * Get the current foreground color from CSS custom properties.
 * Returns the computed value of --foreground or a fallback.
 */
export function getForegroundColor(): string {
  if (typeof document === 'undefined') {
    // SSR/Node fallback - dark theme default
    return '#e3e2e5'
  }

  const computedColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--foreground')
    .trim()

  // If we got an oklch value, return it as-is (browsers handle it)
  // If empty, return a sensible default
  return computedColor || '#e3e2e5'
}

/**
 * Process SVG content to inject theme foreground color.
 *
 * This fixes SVGs that use currentColor or have no fill specified,
 * which would otherwise render as black when used as background-image
 * (since CSS color inheritance doesn't work for background images).
 *
 * @param svgContent - Raw SVG string content
 * @param foregroundColor - Color to inject (defaults to current theme foreground)
 * @returns Processed SVG string with colors injected
 */
export function themeSvgContent(
  svgContent: string,
  foregroundColor?: string
): string {
  const color = foregroundColor ?? getForegroundColor()

  let processed = svgContent

  // Replace all currentColor references with the actual color
  processed = processed.replace(/currentColor/gi, color)

  // For SVGs with no fill attribute on the root element, add one
  // This catches SVGs that rely on default black fill
  processed = processed.replace(
    /<svg([^>]*)>/i,
    (match, attrs) => {
      // Don't add fill if already has fill attribute (even fill="none")
      if (/\bfill\s*=/i.test(attrs)) {
        return match
      }
      // Add fill attribute to SVG root
      return `<svg${attrs} fill="${color}">`
    }
  )

  return processed
}

/**
 * Convert SVG content to a themed data URL.
 * Injects foreground color and encodes as base64.
 */
export function svgToThemedDataUrl(svgContent: string, foregroundColor?: string): string {
  const themedSvg = themeSvgContent(svgContent, foregroundColor)
  return `data:image/svg+xml;base64,${btoa(themedSvg)}`
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Derive service URL from source config (for favicon resolution)
 */
function deriveServiceUrl(config: SourceConfig): string | null {
  // MCP sources - use mcp.url
  if (config.type === 'mcp' && config.mcp?.url) {
    return config.mcp.url
  }

  // API sources - use api.baseUrl
  if (config.type === 'api' && config.api?.baseUrl) {
    return config.api.baseUrl
  }

  return null
}
