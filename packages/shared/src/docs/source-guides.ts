/**
 * Source Guides System
 *
 * Provides bundled guides for known services with dual-purpose content:
 * 1. Service Knowledge - Persistent understanding injected at runtime
 * 2. Setup Hints - One-time guidance for setup agent
 *
 * Guides are stored at ~/.craft-agent/docs/source-guides/ and copied on first run.
 */

import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { isDebugEnabled } from '../utils/debug.ts';
import { getAppVersion } from '../version/app-version.ts';

// Compute path directly to avoid circular dependency with ./index.ts
const CONFIG_DIR = join(homedir(), '.craft-agent');
const DOCS_DIR = join(CONFIG_DIR, 'docs');
const SOURCE_GUIDES_DIR = join(DOCS_DIR, 'source-guides');

// ============================================================
// Types
// ============================================================

export interface SourceGuideFrontmatter {
  domains?: string[];
  providers?: string[];
}

export interface ParsedSourceGuide {
  frontmatter: SourceGuideFrontmatter;
  knowledge: string; // Goes into guide.md AND runtime injection
  setupHints: string; // Only for setup agent
  raw: string; // Original content
}

// ============================================================
// Parsing
// ============================================================

/**
 * Parse YAML frontmatter from guide content.
 * Expects format: ---\nkey: value\n---
 */
function parseFrontmatter(content: string): { frontmatter: SourceGuideFrontmatter; body: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    return { frontmatter: {}, body: content };
  }

  const [, yamlContent, body] = frontmatterMatch;
  const frontmatter: SourceGuideFrontmatter = {};

  if (!yamlContent || !body) {
    return { frontmatter: {}, body: content };
  }

  // Simple YAML parsing for our specific format
  const lines = yamlContent.split('\n');
  let currentKey: 'domains' | 'providers' | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed === 'domains:') {
      currentKey = 'domains';
      frontmatter.domains = [];
    } else if (trimmed === 'providers:') {
      currentKey = 'providers';
      frontmatter.providers = [];
    } else if (trimmed.startsWith('- ') && currentKey) {
      const value = trimmed.slice(2).trim();
      frontmatter[currentKey]?.push(value);
    }
  }

  return { frontmatter, body };
}

/**
 * Parse a source guide into its components.
 * Splits on <!-- SETUP: --> marker.
 */
export function parseSourceGuide(content: string): ParsedSourceGuide {
  const { frontmatter, body } = parseFrontmatter(content);

  // Split on setup marker
  const setupMarker = '<!-- SETUP:';
  const setupIndex = body.indexOf(setupMarker);

  let knowledge: string;
  let setupHints: string;

  if (setupIndex === -1) {
    // No setup section - all content is knowledge
    knowledge = body.trim();
    setupHints = '';
  } else {
    knowledge = body.slice(0, setupIndex).trim();
    // Remove the marker line itself
    const afterMarker = body.slice(setupIndex);
    const markerEnd = afterMarker.indexOf('-->');
    setupHints = markerEnd !== -1 ? afterMarker.slice(markerEnd + 3).trim() : afterMarker.trim();
  }

  // Also remove <!-- KNOWLEDGE: --> marker if present
  const knowledgeMarker = '<!-- KNOWLEDGE:';
  if (knowledge.includes(knowledgeMarker)) {
    const markerStart = knowledge.indexOf(knowledgeMarker);
    const markerEnd = knowledge.indexOf('-->', markerStart);
    if (markerEnd !== -1) {
      knowledge =
        knowledge.slice(0, markerStart).trim() + '\n\n' + knowledge.slice(markerEnd + 3).trim();
    }
  }

  return {
    frontmatter,
    knowledge: knowledge.trim(),
    setupHints: setupHints.trim(),
    raw: content,
  };
}

// ============================================================
// Domain Extraction
// ============================================================

/**
 * Extract the primary domain from a URL.
 * e.g., "https://mcp.linear.app/foo" -> "linear.app"
 */
export function extractDomainFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    // Remove common subdomains
    const parts = hostname.split('.');
    if (parts.length > 2) {
      // Handle cases like mcp.linear.app -> linear.app
      // But keep things like co.uk domains intact
      const twoPartTlds = ['co.uk', 'com.au', 'co.nz', 'com.br'];
      const lastTwo = parts.slice(-2).join('.');
      if (twoPartTlds.includes(lastTwo)) {
        return parts.slice(-3).join('.');
      }
      return parts.slice(-2).join('.');
    }
    return hostname;
  } catch {
    return null;
  }
}

/**
 * Extract domain from a source config for guide matching.
 */
export function extractDomainFromSource(source: {
  type?: string;
  provider?: string;
  mcp?: { url?: string };
  api?: { baseUrl?: string };
}): string | null {
  // Try MCP URL first
  if (source.mcp?.url) {
    const domain = extractDomainFromUrl(source.mcp.url);
    if (domain) return domain;
  }

  // Try API baseUrl
  if (source.api?.baseUrl) {
    const domain = extractDomainFromUrl(source.api.baseUrl);
    if (domain) return domain;
  }

  // Fall back to provider as domain hint
  if (source.provider) {
    // Map common providers to domains
    const providerDomains: Record<string, string> = {
      linear: 'linear.app',
      github: 'github.com',
      notion: 'notion.so',
      slack: 'slack.com',
      craft: 'craft.do',
      exa: 'exa.ai',
      google: 'google.com',
    };
    return providerDomains[source.provider.toLowerCase()] || null;
  }

  return null;
}

// ============================================================
// Guide Lookup
// ============================================================

/**
 * Find a bundled guide matching the given domain or provider.
 */
export function getSourceGuideForDomain(domain: string): ParsedSourceGuide | null {
  const normalizedDomain = domain.toLowerCase();

  for (const [filename, content] of Object.entries(BUNDLED_SOURCE_GUIDES)) {
    const parsed = parseSourceGuide(content);

    // Check domains
    if (parsed.frontmatter.domains?.some((d) => normalizedDomain.includes(d.toLowerCase()))) {
      return parsed;
    }

    // Check providers
    if (
      parsed.frontmatter.providers?.some((p) => normalizedDomain.includes(p.toLowerCase()))
    ) {
      return parsed;
    }

    // Check filename match (e.g., "craft.do.md" matches "craft.do")
    const filenameBase = filename.replace('.md', '');
    if (normalizedDomain.includes(filenameBase.toLowerCase())) {
      return parsed;
    }
  }

  return null;
}

/**
 * Get guide for a source config.
 */
export function getSourceGuide(source: {
  type?: string;
  provider?: string;
  mcp?: { url?: string };
  api?: { baseUrl?: string };
}): ParsedSourceGuide | null {
  const domain = extractDomainFromSource(source);
  if (!domain) return null;
  return getSourceGuideForDomain(domain);
}

/**
 * Get the knowledge section for a source (for runtime injection).
 */
export function getSourceKnowledge(source: {
  type?: string;
  provider?: string;
  mcp?: { url?: string };
  api?: { baseUrl?: string };
}): string | null {
  const guide = getSourceGuide(source);
  return guide?.knowledge || null;
}

// ============================================================
// Initialization
// ============================================================

/**
 * Get the source guides directory path
 */
export function getSourceGuidesDir(): string {
  return SOURCE_GUIDES_DIR;
}

/**
 * Initialize source guides directory with bundled guides.
 */
export function initializeSourceGuides(): void {
  if (!existsSync(SOURCE_GUIDES_DIR)) {
    mkdirSync(SOURCE_GUIDES_DIR, { recursive: true });
  }

  const appVersion = getAppVersion();
  const debugMode = isDebugEnabled();

  for (const [filename, content] of Object.entries(BUNDLED_SOURCE_GUIDES)) {
    const guidePath = join(SOURCE_GUIDES_DIR, filename);
    const versionedContent = `<!-- version: ${appVersion} -->\n${content}`;

    if (!existsSync(guidePath)) {
      writeFileSync(guidePath, versionedContent, 'utf-8');
      console.log(`[source-guides] Created ${filename} (v${appVersion})`);
      continue;
    }

    if (debugMode) {
      writeFileSync(guidePath, versionedContent, 'utf-8');
      console.log(`[source-guides] Updated ${filename} (v${appVersion}, debug mode)`);
    }
  }
}

// ============================================================
// Bundled Source Guides
// ============================================================

const CRAFT_DO_GUIDE = `---
domains:
  - craft.do
  - mcp.craft.do
providers:
  - craft
---

# Craft

## Craft Environment

Everything in Craft is scoped to a **Space**. Users may have multiple spaces, but you can only act within the current space. Spaces can be shared, but are typically used by one person.

Within a space, documents can be organized into folders. There are also smart folders:

| Smart Folder | Purpose |
|--------------|---------|
| All Docs | All documents in the space |
| Starred | Starred documents |
| Unsorted | Documents not in any folder |
| Tags | Documents filtered by tag |
| Calendar | All daily notes |
| Tasks | Task inbox, today, upcoming, all |

When users ask about tasks in general (not in a specific document), refer them to the Tasks section.

## Documents

Documents are the core of Craft. Each document has a unique ID.

**Daily Notes** are special documents attached to calendar dates. Their titles follow the pattern \`2025.01.31\` but users see them in their regional date format.

## Document Structure

Documents are **not linear** - they are hierarchical structures made of blocks. Each block:
- Has a unique shortened ID (integer)
- Can contain nested child blocks (subblocks)
- When a block has children, it's called a "Page" or "Subpage"
- Users can open subpages to see nested content

The **root block** defines the document title and is a text block by default.

### Block Types

| Type | Description |
|------|-------------|
| text | Text content with styling (title, heading, body, quote, code, etc.) |
| url | Link/bookmark |
| image | Image content |
| video | Video content |
| file | File attachment |
| collection | Database-like structure (technically "objectList") |
| collection item | Database row (technically "object") |
| table | Table content |
| drawing | Drawing/sketch |
| line | Divider line |

### Text Blocks

Text blocks are versatile and can serve as:
- **Headings**: Different text styles act like markdown #, ##, ###, ####
- **Pages**: Visual indicator of nested content
- **Tasks**: Checkbox with optional schedule and due dates
- **List items**: Numbered, bullet, or toggle lists
- **Rich text**: Content styled with CommonMark markdown

### Block Properties

Each block can have:
- Child block IDs (for nested content)
- Attached reminders
- Comment threads

<!-- SETUP: This section is ONLY for the setup agent -->

## Setup Hints

### Recommended Questions
- What types of documents do you primarily work with?
- Do you use daily notes?
- Are there specific folders or documents you frequently access?

### Caching Recommendations
- Fetch and store folder structure (IDs + names)
- If user mentions specific docs, store their IDs
- Note any frequently used smart folders

### Configuration Notes
- Craft MCP uses OAuth authentication
- Rate limits: Check MCP server response headers
`;

const LINEAR_APP_GUIDE = `---
domains:
  - linear.app
  - mcp.linear.app
providers:
  - linear
---

# Linear

Linear organizes work into:
- **Issues** - Individual work items with status, priority, assignee
- **Projects** - Groups of related issues (like epics)
- **Cycles** - Time-boxed sprints
- **Teams** - Organizational units with their own backlogs

Issues have a unique identifier like \`ENG-123\` (team prefix + number).

## Key Concepts

### Issue States
Issues flow through workflow states: Backlog → Todo → In Progress → Done (or custom states).

### Priority Levels
- Urgent (P0)
- High (P1)
- Medium (P2)
- Low (P3)
- No priority

### Labels and Filters
Issues can be tagged with labels and filtered by any property.

<!-- SETUP: This section is ONLY for the setup agent -->

## Setup Hints

### Recommended Questions
- Which teams do you work with most?
- Do you use cycles/sprints?
- Read-only or full access?

### Caching Recommendations
- Fetch and store team IDs + names in guide.md
- Fetch and store project IDs for user's teams
- Cache workflow states (status options)

### Rate Limits
- 1500 requests per hour per user
- Use pagination for large result sets
`;

const GITHUB_COM_GUIDE = `---
domains:
  - github.com
  - api.github.com
  - mcp.github.com
providers:
  - github
---

# GitHub

GitHub organizes code and collaboration around:
- **Repositories** - Code projects with version control
- **Issues** - Bug reports, feature requests, tasks
- **Pull Requests** - Code changes for review and merge
- **Actions** - CI/CD workflows

## Key Concepts

### Repository Structure
- Branches (main/master is default)
- Commits and commit history
- Tags and releases

### Issues and PRs
- Can be assigned, labeled, milestoned
- Support markdown formatting
- Have a state: open or closed

### Organizations and Teams
- Repos can belong to users or organizations
- Teams provide access control within orgs

<!-- SETUP: This section is ONLY for the setup agent -->

## Setup Hints

### Recommended Questions
- Which repositories do you work with most?
- Do you need access to issues, PRs, or code?
- Personal repos or organization repos?

### Caching Recommendations
- Fetch and store frequently used repo names/owners
- Cache organization and team info if relevant
- Note default branches for key repos

### Rate Limits
- 5000 requests per hour for authenticated users
- Search API has separate lower limits
`;

/**
 * Map of bundled source guide files
 */
export const BUNDLED_SOURCE_GUIDES: Record<string, string> = {
  'craft.do.md': CRAFT_DO_GUIDE,
  'linear.app.md': LINEAR_APP_GUIDE,
  'github.com.md': GITHUB_COM_GUIDE,
};
