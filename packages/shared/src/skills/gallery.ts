/**
 * Skills Gallery API Client
 *
 * Fetches skill listings from the skills.sh public registry.
 * Used in the main process to proxy gallery data to the renderer via IPC.
 *
 * API endpoints:
 * - GET https://skills.sh/api/skills?offset=N  — paginated skill listing (50/page)
 * - GET https://skills.sh/api/search?q=query&limit=N — search skills
 *
 * Skill content (SKILL.md) is fetched from GitHub raw content using the
 * topSource field (e.g. "vercel-labs/agent-skills") to construct the URL.
 *
 * NOTE: Trending & Hot sorting — the skills.sh /api/skills endpoint ignores the
 * `sort` query parameter (always returns all-time data). However, the skills.sh
 * website embeds pre-rendered datasets in its Next.js RSC payload under these keys:
 *   - "allTimeSkills" — all-time leaderboard
 *   - "trendingSkills" — 24h trending leaderboard
 *   - "trulyTrendingSkills" — hot leaderboard (with change deltas)
 * All three arrays are embedded on every page. For trending/hot sorts, we scrape
 * the root page HTML and extract the relevant JSON array from the RSC payload,
 * falling back to the API (all-time data) if scraping fails.
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { TTLCache } from '@isaacs/ttlcache';
import { getWorkspaceSkillsPath } from '../workspaces/storage.ts';
import { downloadSkillIcon } from './storage.ts';
import matter from 'gray-matter';

// ============================================================
// Types
// ============================================================

export interface GallerySkill {
  /** Skill identifier (slug), e.g. "vercel-react-best-practices" */
  id: string
  /** Display name (same as id in current API) */
  name: string
  /** Total install count */
  installs: number
  /** Source repository, e.g. "vercel-labs/agent-skills" */
  topSource: string
}

export interface GalleryResponse {
  skills: GallerySkill[]
  hasMore: boolean
}

export type GallerySort = 'alltime' | 'trending' | 'hot'

// ============================================================
// Constants
// ============================================================

const SKILLS_API_BASE = 'https://skills.sh';
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ============================================================
// In-Memory Cache
// ============================================================
// Two separate caches so we can selectively invalidate:
// - listCache: list/search results — cleared after install (stale install counts)
// - contentCache: SKILL.md content — kept across installs (content doesn't change)

const listCache = new TTLCache<string, GalleryResponse>({ ttl: CACHE_TTL_MS });
const contentCache = new TTLCache<string, string | null>({ ttl: CACHE_TTL_MS });

// ============================================================
// RSC Payload Scraping (for trending/hot sort)
// ============================================================
// The skills.sh API ignores the `sort` parameter, but the website embeds
// all three leaderboard datasets in its Next.js RSC payload on every page.
// We extract the relevant JSON array from the HTML for trending/hot sorts.

/** Maps our GallerySort values to the RSC payload key names in the skills.sh HTML */
const SORT_TO_RSC_KEY: Record<string, string> = {
  trending: 'trendingSkills',
  hot: 'trulyTrendingSkills',
}

/** Shape of skill entries in the RSC payload (superset of GallerySkill) */
interface RscSkillEntry {
  source: string
  skillId: string
  name: string
  installs: number
  // trulyTrendingSkills entries also have these, but we don't need them:
  installsYesterday?: number
  change?: number
}

/**
 * Extract a named JSON array from the skills.sh RSC payload embedded in the HTML.
 *
 * The RSC payload is escaped JSON within the HTML (quotes as \"). We find the
 * target key, then use bracket-depth tracking to extract the full array, unescape
 * it, and parse as JSON.
 *
 * @param sort - 'trending' or 'hot' (alltime uses the API directly)
 * @returns GalleryResponse with scraped skills, or null if scraping fails
 */
async function scrapeGallerySkills(sort: GallerySort): Promise<GalleryResponse | null> {
  const rscKey = SORT_TO_RSC_KEY[sort]
  if (!rscKey) return null

  try {
    const response = await fetchWithTimeout(SKILLS_API_BASE, 15_000)
    if (!response.ok) return null

    const html = await response.text()

    // Find the RSC key in the escaped JSON payload.
    // The pattern in the HTML looks like: trendingSkills\":[{\"source\":...}]
    const keyPattern = `${rscKey}\\":[`
    const keyIndex = html.indexOf(keyPattern)
    if (keyIndex < 0) return null

    // Position cursor at the opening bracket of the array
    const arrayStart = keyIndex + keyPattern.length - 1

    // Track bracket depth to find the matching closing bracket.
    // The content is escaped JSON (\" for quotes), so we just count [ and ]
    // characters — escaped quotes don't contain brackets.
    let depth = 0
    let arrayEnd = -1
    for (let i = arrayStart; i < html.length; i++) {
      if (html[i] === '[') depth++
      else if (html[i] === ']') depth--
      if (depth === 0) {
        arrayEnd = i + 1
        break
      }
    }
    if (arrayEnd < 0) return null

    // Extract and unescape the JSON array
    const escapedJson = html.slice(arrayStart, arrayEnd)
    const json = escapedJson.replace(/\\"/g, '"').replace(/\\\\/g, '\\')

    const entries = JSON.parse(json) as RscSkillEntry[]
    if (!Array.isArray(entries) || entries.length === 0) return null

    // Convert RSC entries to our GallerySkill format
    const skills: GallerySkill[] = entries.map((entry) => ({
      id: entry.skillId,
      name: entry.name,
      installs: entry.installs,
      topSource: entry.source,
    }))

    return { skills, hasMore: false }
  } catch {
    // Scraping failed (network error, parse error, HTML structure changed, etc.)
    return null
  }
}

// ============================================================
// Website Content Scraping (for skill detail viewing)
// ============================================================
// When the GitHub raw path doesn't match the skillId (common — see plan),
// we fall back to scraping the skills.sh detail page. The page renders
// the SKILL.md as HTML inside a <div class="prose prose-invert ..."> element.
// We extract that HTML and convert it to markdown for display.

/**
 * Fetch skill content by scraping the skills.sh detail page.
 *
 * The skills.sh website always resolves the correct SKILL.md internally,
 * even when the skillId doesn't match the GitHub directory name. We extract
 * the rendered HTML from the prose div and convert it back to markdown.
 *
 * Note: Frontmatter fields (globs, alwaysAllow) are lost — only the rendered
 * body is available. This is acceptable for viewing; install uses GitHub resolution.
 *
 * @param topSource - Repository path, e.g. "vercel-labs/agent-skills"
 * @param skillId - Skill identifier from skills.sh
 * @returns Markdown content string, or null if scraping fails
 */
async function fetchSkillContentFromWebsite(
  topSource: string,
  skillId: string
): Promise<string | null> {
  try {
    const url = `${SKILLS_API_BASE}/${topSource}/${skillId}`
    const response = await fetchWithTimeout(url, 15_000)
    if (!response.ok) return null

    const html = await response.text()

    // Find the prose div that contains the rendered SKILL.md content.
    // The div uses dangerouslySetInnerHTML, so the content is inline HTML.
    // We look for the opening tag with the distinctive "prose prose-invert" classes.
    const proseMarker = 'prose prose-invert'
    const proseIdx = html.indexOf(proseMarker)
    if (proseIdx < 0) return null

    // Find the start of the inner HTML content (after the opening tag's ">")
    const tagClose = html.indexOf('>', proseIdx)
    if (tagClose < 0) return null
    const contentStart = tagClose + 1

    // Find the matching closing </div> using depth tracking.
    // We start inside the prose div (depth 1) and track nested divs.
    let depth = 1
    let contentEnd = -1
    let i = contentStart
    while (i < html.length && depth > 0) {
      if (html.startsWith('<div', i)) {
        depth++
        i += 4
      } else if (html.startsWith('</div>', i)) {
        depth--
        if (depth === 0) {
          contentEnd = i
          break
        }
        i += 6
      } else {
        i++
      }
    }
    if (contentEnd < 0) return null

    const innerHtml = html.slice(contentStart, contentEnd)
    if (!innerHtml.trim()) return null

    // Convert the HTML to markdown for display in the gallery detail page
    const markdown = htmlToMarkdown(innerHtml)
    return markdown || null
  } catch {
    return null
  }
}

/**
 * Basic HTML-to-markdown converter for skill content scraped from skills.sh.
 *
 * Handles the common elements found in SKILL.md rendered content:
 * headings, paragraphs, lists, code blocks, inline formatting, and links.
 * Not a general-purpose converter — just enough for clean skill display.
 */
function htmlToMarkdown(html: string): string {
  let md = html

  // Normalize line endings and collapse whitespace between tags
  md = md.replace(/\r\n/g, '\n')

  // Code blocks: <pre><code ...>...</code></pre> → ```\n...\n```
  // Must be done before inline code to avoid double-processing
  md = md.replace(/<pre[^>]*>\s*<code[^>]*class="language-([^"]*)"[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_match, lang, code) => {
      const decoded = decodeHtmlEntities(code.trim())
      return `\n\`\`\`${lang === 'text' ? '' : lang}\n${decoded}\n\`\`\`\n`
    })
  md = md.replace(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_match, code) => `\n\`\`\`\n${decodeHtmlEntities(code.trim())}\n\`\`\`\n`)
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi,
    (_match, code) => `\n\`\`\`\n${decodeHtmlEntities(code.trim())}\n\`\`\`\n`)

  // Headings: <h1>...</h1> → # ...
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_m, t) => `\n# ${stripTags(t).trim()}\n`)
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m, t) => `\n## ${stripTags(t).trim()}\n`)
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_m, t) => `\n### ${stripTags(t).trim()}\n`)
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_m, t) => `\n#### ${stripTags(t).trim()}\n`)
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_m, t) => `\n##### ${stripTags(t).trim()}\n`)
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_m, t) => `\n###### ${stripTags(t).trim()}\n`)

  // Bold and italic (before paragraph processing)
  md = md.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**')
  md = md.replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*')

  // Inline code: <code>...</code> → `...`
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi,
    (_m, c) => `\`${decodeHtmlEntities(c)}\``)

  // Links: <a href="...">...</a> → [text](url)
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href, text) => `[${stripTags(text).trim()}](${href})`)

  // List items: <li>...</li> → - ...
  // Process before stripping <ul>/<ol> tags
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi,
    (_m, content) => `- ${stripTags(content).trim()}\n`)

  // Strip list wrappers
  md = md.replace(/<\/?(?:ul|ol)[^>]*>/gi, '\n')

  // Paragraphs: <p>...</p> → text with double newline
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, t) => `\n${t.trim()}\n`)

  // Line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n')

  // Horizontal rules
  md = md.replace(/<hr[^>]*>/gi, '\n---\n')

  // Tables: basic conversion
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, table) => {
    return convertTableToMarkdown(table)
  })

  // Strip any remaining HTML tags
  md = stripTags(md)

  // Decode HTML entities
  md = decodeHtmlEntities(md)

  // Clean up excessive newlines (max 2 consecutive)
  md = md.replace(/\n{3,}/g, '\n\n')

  return md.trim()
}

/** Strip all HTML tags from a string */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '')
}

/** Decode common HTML entities */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
}

/** Convert an HTML table to markdown table format */
function convertTableToMarkdown(tableHtml: string): string {
  const rows: string[][] = []

  // Extract rows
  const rowMatches = tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)
  if (!rowMatches) return stripTags(tableHtml)

  for (const rowHtml of rowMatches) {
    const cells: string[] = []
    const cellMatches = rowHtml.match(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)
    if (cellMatches) {
      for (const cellHtml of cellMatches) {
        const content = cellHtml.replace(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/i, '$1')
        cells.push(stripTags(content).trim())
      }
    }
    if (cells.length > 0) rows.push(cells)
  }

  const headerRow = rows[0]
  if (!headerRow || rows.length === 0) return ''

  // Build markdown table
  const lines: string[] = []
  // Header row
  lines.push(`| ${headerRow.join(' | ')} |`)
  // Separator
  lines.push(`| ${headerRow.map(() => '---').join(' | ')} |`)
  // Data rows
  for (let r = 1; r < rows.length; r++) {
    lines.push(`| ${rows[r]!.join(' | ')} |`)
  }

  return '\n' + lines.join('\n') + '\n'
}

// ============================================================
// API Functions
// ============================================================

/**
 * Fetch paginated gallery skills from skills.sh
 *
 * For 'alltime' sort: uses the /api/skills JSON endpoint directly.
 * For 'trending' or 'hot' sort: scrapes the skills.sh website HTML to extract
 * real sorted data from the RSC payload, falling back to the API if scraping fails.
 *
 * @param sort - Sort order: 'alltime' (default), 'trending', or 'hot'
 * @param offset - Pagination offset (default 0, each page returns 50 skills)
 */
export async function fetchGallerySkills(
  sort: GallerySort = 'alltime',
  offset: number = 0
): Promise<GalleryResponse> {
  const cacheKey = `list:${sort}:${offset}`;
  const cached = listCache.get(cacheKey);
  if (cached) return cached;

  // For trending/hot: try scraping the website first (only for first page,
  // since the scraped data isn't paginated — it returns the full list at once)
  if (sort !== 'alltime' && offset === 0) {
    const scraped = await scrapeGallerySkills(sort)
    if (scraped) {
      listCache.set(cacheKey, scraped)
      return scraped
    }
    // Scraping failed — fall through to API (returns all-time data as fallback)
  }

  const params = new URLSearchParams();
  if (offset > 0) params.set('offset', String(offset));
  if (sort && sort !== 'alltime') params.set('sort', sort);

  const url = `${SKILLS_API_BASE}/api/skills${params.toString() ? '?' + params.toString() : ''}`;

  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Gallery API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as GalleryResponse;
  listCache.set(cacheKey, data);
  return data;
}

/**
 * Search gallery skills by query string
 *
 * @param query - Search query (minimum 2 characters recommended)
 * @param limit - Max results (default 10)
 */
export async function searchGallerySkills(
  query: string,
  limit: number = 20
): Promise<GalleryResponse> {
  const cacheKey = `search:${query}:${limit}`;
  const cached = listCache.get(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const url = `${SKILLS_API_BASE}/api/search?${params.toString()}`;

  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Gallery search error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as GalleryResponse;
  listCache.set(cacheKey, data);
  return data;
}

/**
 * Fetch skill content for viewing in the gallery detail page.
 *
 * Tries GitHub raw paths first (fast, returns raw SKILL.md with frontmatter).
 * If those fail (common when skillId doesn't match the GitHub directory name),
 * falls back to scraping the skills.sh detail page which always has the content.
 *
 * The GitHub paths tried:
 *   1. /skills/{skillId}/SKILL.md (standard location)
 *   2. /skills/.curated/{skillId}/SKILL.md (curated skills)
 *   3. /{skillId}/SKILL.md (root-level skills)
 *
 * @param topSource - Repository path, e.g. "vercel-labs/agent-skills"
 * @param skillId - Skill identifier, e.g. "vercel-react-best-practices"
 * @returns SKILL.md content string (raw or converted from HTML), or null if not found
 */
export async function fetchSkillContent(
  topSource: string,
  skillId: string
): Promise<string | null> {
  const cacheKey = `${topSource}/${skillId}`;
  // Use .has() because null is a valid cached value (skill not found — avoids re-trying)
  if (contentCache.has(cacheKey)) return contentCache.get(cacheKey) ?? null;

  // First: try GitHub raw paths (fast, returns raw SKILL.md with frontmatter)
  const baseUrl = `https://raw.githubusercontent.com/${topSource}/main`;
  const paths = [
    `${baseUrl}/skills/${skillId}/SKILL.md`,
    `${baseUrl}/skills/.curated/${skillId}/SKILL.md`,
    `${baseUrl}/${skillId}/SKILL.md`,
  ];

  for (const url of paths) {
    try {
      const response = await fetchWithTimeout(url);
      if (response.ok) {
        const content = await response.text();
        contentCache.set(cacheKey, content);
        return content;
      }
    } catch {
      // Try next path
    }
  }

  // Second: GitHub paths failed (skillId doesn't match directory name).
  // Fall back to scraping the skills.sh detail page, which always resolves correctly.
  const websiteContent = await fetchSkillContentFromWebsite(topSource, skillId)
  if (websiteContent) {
    contentCache.set(cacheKey, websiteContent)
    return websiteContent
  }

  // Cache null result so we don't re-attempt on every visit
  contentCache.set(cacheKey, null);
  return null;
}

/**
 * Fetch skill content for installation (needs the raw SKILL.md with frontmatter).
 *
 * The skillId from skills.sh often doesn't match the GitHub directory name
 * (e.g., skillId "vercel-react-best-practices" lives in directory "react-best-practices").
 * This function uses the GitHub Tree API to discover the correct path, then fetches
 * the raw SKILL.md content.
 *
 * Falls back to fetchSkillContent (which may return website-scraped content) if
 * tree resolution fails.
 *
 * @param topSource - Repository path, e.g. "vercel-labs/agent-skills"
 * @param skillId - Skill identifier (from skills.sh, may not match directory name)
 * @returns Raw SKILL.md content string, or null if not found
 */
export async function resolveAndFetchSkillMd(
  topSource: string,
  skillId: string
): Promise<string | null> {
  // First try the standard paths (fast — works when skillId matches directory name)
  const baseUrl = `https://raw.githubusercontent.com/${topSource}/main`;
  const quickPaths = [
    `${baseUrl}/skills/${skillId}/SKILL.md`,
    `${baseUrl}/skills/.curated/${skillId}/SKILL.md`,
    `${baseUrl}/${skillId}/SKILL.md`,
  ];

  for (const url of quickPaths) {
    try {
      const response = await fetchWithTimeout(url);
      if (response.ok) {
        return await response.text()
      }
    } catch {
      // Try next path
    }
  }

  // Quick paths failed — use GitHub Tree API to find all SKILL.md files in the repo,
  // then check each one for a matching `name` field in the frontmatter.
  try {
    const treeUrl = `https://api.github.com/repos/${topSource}/git/trees/main?recursive=1`
    const treeResponse = await fetchWithTimeout(treeUrl)
    if (!treeResponse.ok) return null

    const tree = await treeResponse.json() as { tree: Array<{ path: string; type: string }> }

    // Find all SKILL.md file paths in the repo
    const skillMdPaths = tree.tree
      .filter(entry => entry.type === 'blob' && entry.path.endsWith('/SKILL.md'))
      .map(entry => entry.path)

    // Try each SKILL.md path — fetch raw content and check if the `name` frontmatter matches
    for (const path of skillMdPaths) {
      try {
        const rawUrl = `https://raw.githubusercontent.com/${topSource}/main/${path}`
        const response = await fetchWithTimeout(rawUrl)
        if (!response.ok) continue

        const content = await response.text()
        // Check if the frontmatter `name` field matches our skillId
        const nameMatch = content.match(/^---[\s\S]*?^name:\s*(.+)$/m)
        if (nameMatch?.[1]) {
          const name = nameMatch[1].trim().replace(/^["']|["']$/g, '')
          if (name === skillId) {
            return content
          }
        }
      } catch {
        // Try next path
      }
    }
  } catch {
    // Tree API failed — fall through
  }

  return null
}

/**
 * Install a gallery skill into a workspace.
 *
 * Downloads the SKILL.md from GitHub, saves it to the workspace skills directory,
 * and downloads the icon if one is specified in the metadata.
 *
 * @param workspaceRoot - Absolute path to workspace root
 * @param skillId - Skill identifier (becomes the directory slug)
 * @param skillMdContent - Pre-fetched SKILL.md content
 */
export async function installGallerySkill(
  workspaceRoot: string,
  skillId: string,
  skillMdContent: string
): Promise<void> {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const skillDir = join(skillsDir, skillId);

  // Create skill directory (and parent skills/ dir if needed)
  if (!existsSync(skillsDir)) {
    mkdirSync(skillsDir, { recursive: true });
  }
  if (!existsSync(skillDir)) {
    mkdirSync(skillDir, { recursive: true });
  }

  // Write SKILL.md
  writeFileSync(join(skillDir, 'SKILL.md'), skillMdContent, 'utf-8');

  // Download icon if metadata has a URL icon
  try {
    const parsed = matter(skillMdContent);
    const iconValue = parsed.data?.icon;
    if (typeof iconValue === 'string' && (iconValue.startsWith('http://') || iconValue.startsWith('https://'))) {
      await downloadSkillIcon(skillDir, iconValue);
    }
  } catch {
    // Icon download is best-effort, don't fail the install
  }

  // Invalidate list/search cache so install counts refresh on next browse.
  // Content cache is kept — the SKILL.md itself didn't change.
  listCache.clear();
}

// ============================================================
// Helpers
// ============================================================

/**
 * Fetch with a timeout to avoid hanging on slow/unreachable endpoints
 */
async function fetchWithTimeout(url: string, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}
