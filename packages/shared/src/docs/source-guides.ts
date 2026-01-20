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
import * as semver from 'semver';
import { isDebugEnabled } from '../utils/debug.ts';
import { getAppVersion } from '../version/app-version.ts';

// Compute path directly to avoid circular dependency with ./index.ts
const CONFIG_DIR = join(homedir(), '.craft-agent');
const DOCS_DIR = join(CONFIG_DIR, 'docs');
const SOURCE_GUIDES_DIR = join(DOCS_DIR, 'source-guides');

// Track if source guides have been initialized this session (prevents re-init on hot reload)
let sourceGuidesInitialized = false;

// ============================================================
// Version Helpers
// ============================================================

/**
 * Extract version from a guide file's first line.
 * Expected format: <!-- version: X.Y.Z -->
 */
function extractVersion(content: string): string | null {
  const match = content.match(/^<!--\s*version:\s*([^\s]+)\s*-->/);
  return match?.[1] ?? null;
}

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
  // Skip if already initialized this session (prevents re-init on hot reload)
  if (sourceGuidesInitialized) {
    return;
  }
  sourceGuidesInitialized = true;

  if (!existsSync(SOURCE_GUIDES_DIR)) {
    mkdirSync(SOURCE_GUIDES_DIR, { recursive: true });
  }

  const appVersion = getAppVersion();
  const debugMode = isDebugEnabled();

  for (const [filename, content] of Object.entries(BUNDLED_SOURCE_GUIDES)) {
    const guidePath = join(SOURCE_GUIDES_DIR, filename);
    const versionedContent = `<!-- version: ${appVersion} -->\n${content}`;

    if (!existsSync(guidePath)) {
      // File doesn't exist - create it
      writeFileSync(guidePath, versionedContent, 'utf-8');
      console.log(`[source-guides] Created ${filename} (v${appVersion})`);
      continue;
    }

    if (debugMode) {
      // Debug mode - always overwrite
      writeFileSync(guidePath, versionedContent, 'utf-8');
      console.log(`[source-guides] Updated ${filename} (v${appVersion}, debug mode)`);
      continue;
    }

    // Production - check version
    try {
      const existingContent = readFileSync(guidePath, 'utf-8');
      const installedVersion = extractVersion(existingContent);

      if (!installedVersion || semver.gt(appVersion, installedVersion)) {
        // No version or bundled is newer - update
        writeFileSync(guidePath, versionedContent, 'utf-8');
        console.log(`[source-guides] Updated ${filename} (v${installedVersion || 'none'} → v${appVersion})`);
      }
    } catch {
      // Error reading - overwrite
      writeFileSync(guidePath, versionedContent, 'utf-8');
      console.log(`[source-guides] Recreated ${filename} (v${appVersion})`);
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
- **MCP URL**: \`https://mcp.craft.do/my/mcp\`
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
  - api.githubcopilot.com
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

### CRITICAL - Check for GitHub CLI First (MANDATORY)

**Before creating ANY GitHub source, you MUST:**

1. **Check if \`gh\` CLI is installed** by running \`which gh\` or \`gh --version\`
2. **If \`gh\` is installed**, you MUST ask the user before proceeding

**If \`gh\` is installed and authenticated:**
- The user ALREADY has full GitHub access through the built-in Bash tool
- \`gh\` commands work out of the box: \`gh issue list\`, \`gh pr view\`, \`gh repo clone\`, etc.
- Creating a separate GitHub source is REDUNDANT in most cases

**You MUST ask the user explicitly (do NOT proceed without asking):**
> "I noticed you have the GitHub CLI (\`gh\`) installed. You already have full GitHub access through \`gh\` commands:
> - \`gh issue list\` - List issues
> - \`gh pr list\` - List pull requests
> - \`gh repo view\` - View repository info
> - \`gh api /repos/{owner}/{repo}/issues\` - Direct API access
>
> Do you still want me to create a separate GitHub MCP source? This would require a Personal Access Token and is usually only needed if you want structured MCP tools instead of CLI commands."

**ONLY proceed with source creation if:**
1. \`gh\` is NOT installed, OR
2. User EXPLICITLY says yes to creating the source after being asked

**DO NOT create the source if the user doesn't respond or seems unsure - default to using \`gh\` CLI.**

### If Creating a GitHub Source

#### CRITICAL - Do NOT Search for MCP URLs

The MCP URL \`https://api.githubcopilot.com/mcp/\` is **CORRECT**. Do NOT use WebSearch or WebFetch to find alternative URLs. The URL works - the issue is authentication method only.

#### Authentication - OAuth Will Fail (Expected)

GitHub's MCP server requires OAuth with a **pre-registered client app**. Craft Agent is NOT registered with GitHub, so OAuth authentication WILL fail. This is expected behavior - do NOT troubleshoot or search for solutions.

**The ONLY solution is a Personal Access Token (PAT):**

1. Ask the user to create a PAT at: GitHub Settings → Developer settings → Personal access tokens
2. Required scopes: \`repo\`, \`read:org\` (optional)
3. Set \`authType: "bearer"\` in config (NOT "oauth")
4. Use \`source_credential_prompt\` to collect the PAT from the user

**Required config.json:**
\`\`\`json
{
  "type": "mcp",
  "mcp": {
    "url": "https://api.githubcopilot.com/mcp/",
    "authType": "bearer"
  }
}
\`\`\`

**Alternative - Local MCP Server (if user prefers):**
\`\`\`json
{
  "type": "mcp",
  "mcp": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." }
  }
}
\`\`\`

### Recommended Questions
- Do you have the GitHub CLI (\`gh\`) installed? (Check first!)
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

const GMAIL_GUIDE = `---
domains:
  - gmail.com
  - api.gmail.com
  - gmail.googleapis.com
providers:
  - google
---

# Gmail

Access and manage your Gmail emails through the Gmail API.

## API Reference

This source provides a single flexible \`api_gmail\` tool that accepts:
- \`path\`: API endpoint (e.g., "/gmail/v1/users/me/messages")
- \`method\`: HTTP method (GET, POST, etc.)
- \`params\`: Request body or query parameters

### Common Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| /gmail/v1/users/me/messages | GET | List messages (use \`q\` param for search) |
| /gmail/v1/users/me/messages/{id} | GET | Get message by ID |
| /gmail/v1/users/me/drafts | POST | Create draft |
| /gmail/v1/users/me/messages/{id}/trash | POST | Trash message |

## Guidelines

- **Privacy**: This source accesses personal email. All data remains local.
- **IMPORTANT - Trashing**: ALWAYS ask for explicit user permission before trashing any emails.
- **Drafts not sent**: Draft emails are saved but NOT sent automatically.

## Gmail Search Syntax

Common search operators:
- \`from:sender@example.com\` - Messages from specific sender
- \`to:recipient@example.com\` - Messages to specific recipient
- \`subject:keyword\` - Messages with keyword in subject
- \`is:unread\` - Unread messages
- \`is:starred\` - Starred messages
- \`has:attachment\` - Messages with attachments
- \`after:2024/01/01\` - Messages after a date
- \`before:2024/12/31\` - Messages before a date
- \`label:important\` - Messages with specific label
- \`in:inbox\` - Messages in inbox
- \`in:sent\` - Sent messages

Combine operators with spaces: \`from:john@example.com after:2024/01/01 has:attachment\`

## Rate Limits

- 250 quota units per user per second
- Most read operations cost 1-5 units
- Avoid rapid sequential requests

<!-- SETUP: This section is ONLY for the setup agent -->

## Setup Hints

### Configuration

**Recommended config.json:**
\`\`\`json
{
  "id": "src_gmail",
  "name": "Gmail",
  "slug": "gmail",
  "enabled": true,
  "provider": "google",
  "type": "api",
  "api": {
    "baseUrl": "https://gmail.googleapis.com/",
    "authType": "bearer",
    "googleService": "gmail"
  },
  "iconUrl": "https://mail.google.com"
}
\`\`\`

### Authentication
Use \`source_google_oauth_trigger\` to start the Google OAuth flow.

### Recommended Questions
- What kinds of emails do you typically search for?
- Do you need to filter by labels or folders?
`;

const GOOGLE_CALENDAR_GUIDE = `---
domains:
  - calendar.google.com
  - www.googleapis.com
providers:
  - google-calendar
  - google
---

# Google Calendar

Access and manage Google Calendar events.

## API Reference

This source provides a single flexible \`api_google-calendar\` tool that accepts:
- \`path\`: API endpoint (e.g., "/calendar/v3/calendars/primary/events")
- \`method\`: HTTP method (GET, POST, PUT, DELETE)
- \`params\`: Request body or query parameters

### Common Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| /calendar/v3/calendars/primary/events | GET | List events |
| /calendar/v3/calendars/primary/events | POST | Create event |
| /calendar/v3/calendars/primary/events/{id} | GET | Get event by ID |
| /calendar/v3/calendars/primary/events/{id} | PUT | Update event |
| /calendar/v3/calendars/primary/events/{id} | DELETE | Delete event |

### Query Parameters

- \`timeMin\`: Start of time range (RFC3339)
- \`timeMax\`: End of time range
- \`q\`: Free text search
- \`maxResults\`: Max events to return
- \`singleEvents\`: Expand recurring events (true/false)
- \`orderBy\`: Sort order ("startTime" or "updated")

## Guidelines

- **Privacy**: This source accesses personal calendar data.
- **Time zones**: Always include timezone info in date/time parameters.

<!-- SETUP: This section is ONLY for the setup agent -->

## Setup Hints

### Configuration

**Required config.json:**
\`\`\`json
{
  "id": "src_google_calendar",
  "name": "Google Calendar",
  "slug": "google-calendar",
  "enabled": true,
  "provider": "google",
  "type": "api",
  "api": {
    "baseUrl": "https://www.googleapis.com/calendar/v3/",
    "authType": "bearer",
    "googleService": "calendar"
  },
  "iconUrl": "https://calendar.google.com"
}
\`\`\`

### Authentication
Use \`source_google_oauth_trigger\` to start the Google OAuth flow.
`;

const GOOGLE_DRIVE_GUIDE = `---
domains:
  - drive.google.com
  - www.googleapis.com
providers:
  - google-drive
  - google
---

# Google Drive

Access and manage Google Drive files.

## API Reference

This source provides a single flexible \`api_google-drive\` tool that accepts:
- \`path\`: API endpoint (e.g., "/drive/v3/files")
- \`method\`: HTTP method (GET, POST, PATCH, DELETE)
- \`params\`: Request body or query parameters

### Common Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| /drive/v3/files | GET | List files |
| /drive/v3/files/{id} | GET | Get file metadata |
| /drive/v3/files/{id}?alt=media | GET | Download file content |
| /drive/v3/files | POST | Create file (metadata) |
| /drive/v3/files/{id} | PATCH | Update file metadata |
| /drive/v3/files/{id} | DELETE | Delete file |

### Search Syntax

Use the \`q\` parameter:
- \`name contains 'keyword'\` - Name contains keyword
- \`mimeType = 'application/pdf'\` - File type filter
- \`'folderId' in parents\` - Files in folder
- \`modifiedTime > '2024-01-01'\` - Modified after date

## Guidelines

- **Privacy**: This source accesses Google Drive files.
- **File content**: Use \`alt=media\` query param to download actual file content.

<!-- SETUP: This section is ONLY for the setup agent -->

## Setup Hints

### Configuration

**Required config.json:**
\`\`\`json
{
  "id": "src_google_drive",
  "name": "Google Drive",
  "slug": "google-drive",
  "enabled": true,
  "provider": "google",
  "type": "api",
  "api": {
    "baseUrl": "https://www.googleapis.com/drive/v3/",
    "authType": "bearer",
    "googleService": "drive"
  },
  "iconUrl": "https://drive.google.com"
}
\`\`\`

### Authentication
Use \`source_google_oauth_trigger\` to start the Google OAuth flow.
`;

const GOOGLE_DOCS_GUIDE = `---
domains:
  - docs.google.com
  - docs.googleapis.com
providers:
  - google-docs
  - google
---

# Google Docs

Access and manage Google Docs documents.

## API Reference

This source provides a single flexible \`api_google-docs\` tool that accepts:
- \`path\`: API endpoint (e.g., "/v1/documents/{documentId}")
- \`method\`: HTTP method (GET, POST)
- \`params\`: Request body or query parameters

### Common Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| /v1/documents | POST | Create a new document |
| /v1/documents/{documentId} | GET | Get document content and structure |
| /v1/documents/{documentId}:batchUpdate | POST | Update document content |

### Document Structure

Google Docs uses a structured document model:
- **Body**: Main document content
- **Paragraphs**: Text blocks with styling
- **Tables**: Grid-based content
- **Lists**: Bulleted/numbered items
- **Headers/Footers**: Page headers and footers
- **Footnotes**: Reference notes

### batchUpdate Requests

The \`:batchUpdate\` endpoint accepts an array of requests:

\`\`\`json
{
  "requests": [
    {
      "insertText": {
        "location": { "index": 1 },
        "text": "Hello World"
      }
    }
  ]
}
\`\`\`

**Common request types:**
- \`insertText\` - Insert text at a location
- \`deleteContentRange\` - Delete content in a range
- \`updateTextStyle\` - Apply text formatting
- \`insertTable\` - Insert a table
- \`replaceAllText\` - Find and replace text
- \`insertInlineImage\` - Insert an image

### Reading Document Content

When getting a document, the response includes:
- \`documentId\` - Unique document ID
- \`title\` - Document title
- \`body\` - Document content structure
- \`namedStyles\` - Style definitions
- \`revisionId\` - Current revision

## Guidelines

- **Privacy**: This source accesses Google Docs documents.
- **Batch updates**: Use \`:batchUpdate\` for efficient multi-operation updates.
- **Indexes**: Text positions use 1-based indexing (index 1 = start of document).
- **Read before write**: Get document structure before making targeted edits.

## Rate Limits

- 300 read requests per minute per user
- 60 write requests per minute per user
- Batch operations are more efficient than individual requests

<!-- SETUP: This section is ONLY for the setup agent -->

## Setup Hints

### Configuration

**Required config.json:**
\`\`\`json
{
  "id": "src_google_docs",
  "name": "Google Docs",
  "slug": "google-docs",
  "enabled": true,
  "provider": "google",
  "type": "api",
  "api": {
    "baseUrl": "https://docs.googleapis.com/v1/",
    "authType": "bearer",
    "googleService": "docs"
  },
  "iconUrl": "https://docs.google.com"
}
\`\`\`

### Authentication
Use \`source_google_oauth_trigger\` to start the Google OAuth flow.

### Recommended Questions
- What types of documents do you work with most?
- Do you need to create new documents or primarily read/edit existing ones?
- Are there specific documents or folders you frequently access?

### Permissions for Explore Mode
\`\`\`json
{
  "allowedApiEndpoints": [
    { "method": "GET", "path": ".*", "comment": "All GET requests are read-only" }
  ]
}
\`\`\`
`;

const GOOGLE_SHEETS_GUIDE = `---
domains:
  - sheets.google.com
  - sheets.googleapis.com
providers:
  - google-sheets
  - google
---

# Google Sheets

Access and manage Google Sheets spreadsheets.

## API Reference

This source provides a single flexible \`api_google-sheets\` tool that accepts:
- \`path\`: API endpoint (e.g., "/v4/spreadsheets/{spreadsheetId}")
- \`method\`: HTTP method (GET, POST, PUT)
- \`params\`: Request body or query parameters

### Common Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| /v4/spreadsheets | POST | Create a new spreadsheet |
| /v4/spreadsheets/{spreadsheetId} | GET | Get spreadsheet metadata and sheets |
| /v4/spreadsheets/{spreadsheetId}/values/{range} | GET | Read cell values |
| /v4/spreadsheets/{spreadsheetId}/values/{range} | PUT | Write cell values |
| /v4/spreadsheets/{spreadsheetId}/values:batchGet | GET | Read multiple ranges |
| /v4/spreadsheets/{spreadsheetId}/values:batchUpdate | POST | Write multiple ranges |
| /v4/spreadsheets/{spreadsheetId}:batchUpdate | POST | Batch update spreadsheet |

### A1 Notation

Ranges use A1 notation:
- \`Sheet1!A1:B10\` - Cells A1 to B10 on Sheet1
- \`Sheet1!A:A\` - Entire column A on Sheet1
- \`Sheet1!1:1\` - Entire row 1 on Sheet1
- \`A1:B10\` - First sheet, cells A1 to B10
- \`'Sheet Name'!A1:B10\` - Use quotes for sheets with spaces

### Reading Values

GET \`/v4/spreadsheets/{id}/values/{range}\`

Query parameters:
- \`valueRenderOption\`: FORMATTED_VALUE, UNFORMATTED_VALUE, FORMULA
- \`dateTimeRenderOption\`: SERIAL_NUMBER, FORMATTED_STRING
- \`majorDimension\`: ROWS, COLUMNS

### Writing Values

PUT \`/v4/spreadsheets/{id}/values/{range}\`

Query parameters:
- \`valueInputOption\`: RAW, USER_ENTERED (applies formatting/formulas)

Request body:
\`\`\`json
{
  "values": [
    ["Row1Col1", "Row1Col2"],
    ["Row2Col1", "Row2Col2"]
  ]
}
\`\`\`

### Batch Updates

POST \`/v4/spreadsheets/{id}:batchUpdate\`

Request body for structural changes:
\`\`\`json
{
  "requests": [
    {
      "addSheet": {
        "properties": { "title": "New Sheet" }
      }
    }
  ]
}
\`\`\`

**Common request types:**
- \`addSheet\` - Add a new sheet
- \`deleteSheet\` - Delete a sheet
- \`updateCells\` - Update cell formatting
- \`autoResizeDimensions\` - Auto-fit column/row sizes
- \`mergeCells\` - Merge cell ranges
- \`addChart\` - Insert a chart

## Guidelines

- **Privacy**: This source accesses Google Sheets spreadsheets.
- **Value input**: Use \`valueInputOption=USER_ENTERED\` for formulas and dates.
- **Batch operations**: Use batch endpoints for efficiency with multiple ranges.
- **Sheet names**: Quote sheet names with spaces in A1 notation.

## Rate Limits

- 300 read requests per minute per user
- 60 write requests per minute per user
- Batch operations count as single requests

<!-- SETUP: This section is ONLY for the setup agent -->

## Setup Hints

### Configuration

**Required config.json:**
\`\`\`json
{
  "id": "src_google_sheets",
  "name": "Google Sheets",
  "slug": "google-sheets",
  "enabled": true,
  "provider": "google",
  "type": "api",
  "api": {
    "baseUrl": "https://sheets.googleapis.com/v4/",
    "authType": "bearer",
    "googleService": "sheets"
  },
  "iconUrl": "https://sheets.google.com"
}
\`\`\`

### Authentication
Use \`source_google_oauth_trigger\` to start the Google OAuth flow.

### Recommended Questions
- What spreadsheets do you work with most frequently?
- Do you need to create new spreadsheets or primarily read/edit existing ones?
- Are there specific sheets or data ranges you access regularly?

### Permissions for Explore Mode
\`\`\`json
{
  "allowedApiEndpoints": [
    { "method": "GET", "path": ".*", "comment": "All GET requests are read-only" }
  ]
}
\`\`\`
`;

const FILESYSTEM_GUIDE = `---
providers:
  - filesystem
  - fs
  - files
  - local-files
---

# Filesystem

Access and manage local filesystem directories through the MCP protocol.

## Capabilities

- **List directories** - Browse directory contents with filtering
- **Read files** - Get file contents (text, code, documents)
- **Write files** - Create or update files (if allowed)
- **Search** - Find files by name patterns

## Guidelines

- Paths must be within the configured allowed directories
- Respects OS file permissions
- Best for exploring project structures and local codebases
- Large files may be truncated

<!-- SETUP: This section is ONLY for the setup agent -->

## Setup Hints

### Configuration

This is a **local stdio MCP server** - it runs on the user's machine via npx.

**Required config.json:**
\`\`\`json
{
  "type": "mcp",
  "mcp": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/directory"]
  }
}
\`\`\`

**Important:** The last argument is the directory path the server will have access to. Ask the user which directory they want to access.

### Recommended Questions
- Which directory do you want to access? (e.g., ~/Documents, ~/Projects)
- Do you need read-only or full file access?

### Permissions for Explore Mode
\`\`\`json
{
  "allowedMcpPatterns": [
    { "pattern": "list", "comment": "List directory contents" },
    { "pattern": "read", "comment": "Read file contents" },
    { "pattern": "search", "comment": "Search for files" }
  ]
}
\`\`\`

### No Authentication Required
This is a local server - no API keys or OAuth needed.
`;

const BRAVE_SEARCH_GUIDE = `---
providers:
  - brave
  - brave-search
---

# Brave Search

Web and news search using the Brave Search API via MCP.

## Capabilities

- **Web search** - General web search with ranking
- **News search** - Recent news articles
- **Local search** - Location-based results (if enabled)

## Guidelines

- Results include titles, URLs, and descriptions
- Rate limits apply based on API plan
- Respects Brave Search's content policies

<!-- SETUP: This section is ONLY for the setup agent -->

## Setup Hints

### Configuration

This is a **local stdio MCP server** that requires a Brave Search API key.

**Required config.json:**
\`\`\`json
{
  "type": "mcp",
  "mcp": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-brave-search"],
    "env": {
      "BRAVE_API_KEY": "YOUR_API_KEY"
    }
  }
}
\`\`\`

### Getting an API Key
1. Go to https://brave.com/search/api/
2. Sign up for an API account
3. Create an API key
4. Use \`source_credential_prompt\` to securely store the key

### Recommended Questions
- Do you have a Brave Search API key?
- What types of searches will you perform? (web, news, local)

### Permissions for Explore Mode
\`\`\`json
{
  "allowedMcpPatterns": [
    { "pattern": "search", "comment": "All search operations are read-only" }
  ]
}
\`\`\`
`;

const SLACK_GUIDE = `---
domains:
  - slack.com
  - api.slack.com
providers:
  - slack
---

# Slack

Access Slack workspaces, channels, and messages through the Slack Web API.

**IMPORTANT:** Always use the native Slack API integration (type: "api", provider: "slack"). Do NOT use third-party Slack MCP servers - they require manual credential management and don't support OAuth.

## API Reference

This source provides a single flexible \`api_slack\` tool that accepts:
- \`path\`: API endpoint (e.g., "conversations.list")
- \`method\`: HTTP method (typically POST for Slack)
- \`params\`: Request body parameters

### Common Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| search.all | POST | Search channels, messages, files by name/content |
| conversations.info | GET | Get channel details by ID (**note: GET not POST**) |
| conversations.list | POST | List channels, DMs, and groups (paginated) |
| conversations.history | POST | Get messages from a channel |
| chat.postMessage | POST | Send a message |
| users.list | POST | List workspace users |
| users.info | POST | Get user details |
| search.messages | POST | Search messages (requires search scope) |
| reactions.add | POST | Add emoji reaction |
| files.list | POST | List files |

### Key Parameters

**conversations.list:**
- \`types\`: Channel types to include (public_channel, private_channel, mpim, im)
- \`limit\`: Max results per page (default 100, max 1000)
- \`cursor\`: Pagination cursor

**conversations.history:**
- \`channel\`: Channel ID (required)
- \`limit\`: Max messages (default 100)
- \`oldest\`: Start of time range (Unix timestamp)
- \`latest\`: End of time range (Unix timestamp)

**chat.postMessage:**
- \`channel\`: Channel ID or name (required)
- \`text\`: Message text
- \`blocks\`: Block Kit formatted message
- \`thread_ts\`: Reply in thread

### Response Format

Slack API responses include:
- \`ok\`: Boolean indicating success
- \`error\`: Error code if \`ok\` is false
- Payload specific to each endpoint

## Guidelines

- **Finding channels by name**: Use \`search.all\` instead of paginating \`conversations.list\`. Much faster since \`conversations.list\` returns ~800+ tokens of metadata per channel, making pagination expensive.
- **Two-step pattern for channel details**:
  1. Use \`search.all\` with \`query\` param to find channels by name → get channel ID
  2. Use \`conversations.info\` (note: **GET** not POST) with the channel ID for full details
- **Channel IDs**: Use channel IDs (e.g., C01234567) not names for most operations
- **Rate limits**: Tier 1 (1 req/sec), Tier 2 (20 req/min), Tier 3 (50 req/min) - varies by endpoint
- **Pagination**: For \`conversations.history\` and other list endpoints, use \`cursor\` and check \`response_metadata.next_cursor\`
- **Timestamps**: Use Unix timestamps with microseconds (e.g., 1234567890.123456)
- **Privacy**: Respect user privacy - avoid reading private channels unless explicitly requested

## Rate Limits

Slack uses tiered rate limiting:
- **Tier 1**: 1 request per second (e.g., chat.postMessage)
- **Tier 2**: 20 requests per minute (e.g., conversations.list)
- **Tier 3**: 50 requests per minute (e.g., users.info)
- **Tier 4**: 100+ requests per minute (bulk operations)

Check \`Retry-After\` header when rate limited.

<!-- SETUP: This section is ONLY for the setup agent -->

## Setup Hints

### Configuration

**Required config.json:**
\`\`\`json
{
  "name": "Slack",
  "slug": "slack",
  "enabled": true,
  "provider": "slack",
  "type": "api",
  "api": {
    "baseUrl": "https://slack.com/api/",
    "authType": "bearer",
    "testEndpoint": {
      "method": "POST",
      "path": "auth.test"
    }
  },
  "iconUrl": "slack.com"
}
\`\`\`

**IMPORTANT**: Use \`auth.test\` (not \`api.test\`) as the testEndpoint - it validates the OAuth token. Use trailing slash on baseUrl and no leading slash on path.

### Authentication
Use \`source_slack_oauth_trigger\` to start the Slack OAuth flow. This is a native integration that handles token storage automatically.

### Required Scopes
Common scopes needed:
- \`channels:read\` - View basic channel info
- \`channels:history\` - Read public channel messages
- \`groups:read\` - View private channels
- \`groups:history\` - Read private channel messages
- \`im:read\` - View DM info
- \`im:history\` - Read DMs
- \`users:read\` - View users
- \`chat:write\` - Send messages
- \`search:read\` - Search messages

### Recommended Questions
- Which Slack workspace do you want to connect?
- Do you need access to private channels?
- Will you need to send messages or just read?

### Permissions for Explore Mode
\`\`\`json
{
  "allowedApiEndpoints": [
    { "method": "POST", "path": "conversations\\\\.list", "comment": "List channels" },
    { "method": "POST", "path": "conversations\\\\.history", "comment": "Read messages" },
    { "method": "POST", "path": "conversations\\\\.info", "comment": "Channel info" },
    { "method": "POST", "path": "users\\\\.list", "comment": "List users" },
    { "method": "POST", "path": "users\\\\.info", "comment": "User info" },
    { "method": "POST", "path": "api\\\\.test", "comment": "Test connection" }
  ]
}
\`\`\`
`;

const OUTLOOK_GUIDE = `---
domains:
  - outlook.live.com
  - outlook.office.com
  - graph.microsoft.com
providers:
  - microsoft
  - outlook
---

# Outlook

Access to Microsoft Outlook email via the Microsoft Graph API.

## Scope

- Read, send, and manage emails
- Access mail folders (Inbox, Sent, Drafts, etc.)
- Search messages
- Manage attachments

## Guidelines

- Use the \`api_outlook\` tool with \`path\`, \`method\`, and optional \`params\`
- Base URL: \`https://graph.microsoft.com/v1.0\`
- All paths are relative to the base URL

## Common Endpoints

### List Messages
\`\`\`
GET /me/messages
\`\`\`
Query params: \`$top\`, \`$skip\`, \`$filter\`, \`$orderby\`, \`$select\`

### Get a Message
\`\`\`
GET /me/messages/{id}
\`\`\`

### Search Messages
\`\`\`
GET /me/messages?$search="keyword"
\`\`\`

### List Mail Folders
\`\`\`
GET /me/mailFolders
\`\`\`

### Send Email
\`\`\`
POST /me/sendMail
Body: { "message": { "subject": "...", "body": { "contentType": "Text", "content": "..." }, "toRecipients": [{ "emailAddress": { "address": "..." } }] } }
\`\`\`

## Rate Limits

Microsoft Graph has throttling limits. If you receive 429 errors, wait before retrying.

<!-- SETUP: This section is ONLY for the setup agent -->

## Setup Hints

### Configuration

**Required config.json:**
\`\`\`json
{
  "id": "src_outlook",
  "name": "Outlook",
  "slug": "outlook",
  "enabled": true,
  "provider": "microsoft",
  "type": "api",
  "api": {
    "baseUrl": "https://graph.microsoft.com/v1.0/",
    "authType": "bearer",
    "microsoftService": "outlook",
    "testEndpoint": {
      "method": "GET",
      "path": "me/mailFolders?$top=1"
    }
  },
  "iconUrl": "https://res.cdn.office.net/files/fabric-cdn-prod_20241209.001/assets/brand-icons/product/svg/outlook_48x1.svg"
}
\`\`\`

### Authentication
Use \`source_microsoft_oauth_trigger\` to start the Microsoft OAuth flow.

### Recommended Questions
- What kinds of emails do you typically search for?
- Do you need to send emails or just read?

### Permissions for Explore Mode
\`\`\`json
{
  "allowedApiEndpoints": [
    { "method": "GET", "path": ".*", "comment": "All GET requests are read-only" }
  ]
}
\`\`\`
`;

const TEAMS_GUIDE = `---
providers:
  - microsoft
  - teams
---

# Microsoft Teams

Access to Microsoft Teams via the Microsoft Graph API.

## Scope

- List joined teams and channels
- Read and send channel messages
- Access chat messages
- View team members

## Guidelines

- Use the \`api_teams\` tool with \`path\`, \`method\`, and optional \`params\`
- Base URL: \`https://graph.microsoft.com/v1.0\`
- All paths are relative to the base URL

## Common Endpoints

### List Joined Teams
\`\`\`
GET /me/joinedTeams
\`\`\`
Returns all teams the user is a member of.

### List Channels
\`\`\`
GET /teams/{team-id}/channels
\`\`\`

### Get Channel Messages
\`\`\`
GET /teams/{team-id}/channels/{channel-id}/messages
\`\`\`
Query params: \`$top\`, \`$skip\`

### Send Channel Message
\`\`\`
POST /teams/{team-id}/channels/{channel-id}/messages
Body: { "body": { "content": "Hello!" } }
\`\`\`

### List Chats
\`\`\`
GET /me/chats
\`\`\`

### Get Chat Messages
\`\`\`
GET /me/chats/{chat-id}/messages
\`\`\`

## Rate Limits

Microsoft Graph has throttling limits. If you receive 429 errors, wait before retrying.

<!-- SETUP: This section is ONLY for the setup agent -->

## Setup Hints

### Configuration

**Required config.json:**
\`\`\`json
{
  "id": "src_teams",
  "name": "Microsoft Teams",
  "slug": "teams",
  "enabled": true,
  "provider": "microsoft",
  "type": "api",
  "api": {
    "baseUrl": "https://graph.microsoft.com/v1.0/",
    "authType": "bearer",
    "microsoftService": "teams",
    "testEndpoint": {
      "method": "GET",
      "path": "me/chats?$top=1"
    }
  },
  "iconUrl": "https://res.cdn.office.net/files/fabric-cdn-prod_20241209.001/assets/brand-icons/product/svg/teams_48x1.svg"
}
\`\`\`

### Authentication
Use \`source_microsoft_oauth_trigger\` to start the Microsoft OAuth flow.

### Recommended Questions
- Which teams or channels do you primarily work with?
- Do you need to send messages or just read?

### Permissions for Explore Mode
\`\`\`json
{
  "allowedApiEndpoints": [
    { "method": "GET", "path": ".*", "comment": "All GET requests are read-only" }
  ]
}
\`\`\`
`;

const MEMORY_GUIDE = `---
providers:
  - memory
  - knowledge-graph
---

# Memory

Persistent key-value storage and knowledge graph for maintaining context across sessions.

## Capabilities

- **Store entities** - Save named entities with observations
- **Create relations** - Link entities together
- **Query knowledge** - Retrieve stored information
- **Persistent storage** - Data persists between sessions

## Guidelines

- Useful for remembering user preferences, project context
- Entities have names and lists of observations
- Relations connect entities (e.g., "project X uses technology Y")
- Storage is local to the machine

<!-- SETUP: This section is ONLY for the setup agent -->

## Setup Hints

### Configuration

This is a **local stdio MCP server** with no external dependencies.

**Required config.json:**
\`\`\`json
{
  "type": "mcp",
  "mcp": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-memory"]
  }
}
\`\`\`

### Recommended Questions
- What kind of information do you want to persist? (preferences, project notes, etc.)
- Should this be shared across workspaces or specific to one?

### Permissions for Explore Mode
\`\`\`json
{
  "allowedMcpPatterns": [
    { "pattern": "read", "comment": "Read stored entities" },
    { "pattern": "search", "comment": "Search knowledge graph" },
    { "pattern": "open", "comment": "Open knowledge graph nodes" }
  ]
}
\`\`\`

### No Authentication Required
This is a local server - no API keys or OAuth needed.
`;

const MICROSOFT_CALENDAR_GUIDE = `---
domains:
  - outlook.live.com
  - outlook.office.com
  - graph.microsoft.com
providers:
  - microsoft
  - microsoft-calendar
---

# Microsoft Calendar

Access to Microsoft Outlook Calendar via the Microsoft Graph API.

## Scope

- List and manage calendar events
- Access multiple calendars
- Create, update, and delete events
- View free/busy information

## Guidelines

- Use the \`api_microsoft-calendar\` tool with \`path\`, \`method\`, and optional \`params\`
- Base URL: \`https://graph.microsoft.com/v1.0\`
- All paths are relative to the base URL

## Common Endpoints

### List Calendars
\`\`\`
GET /me/calendars
\`\`\`
Returns all calendars for the user.

### List Events
\`\`\`
GET /me/events
\`\`\`
Query params: \`$top\`, \`$skip\`, \`$filter\`, \`$orderby\`, \`$select\`

### List Events in Date Range
\`\`\`
GET /me/calendarView?startDateTime={start}&endDateTime={end}
\`\`\`
Use ISO 8601 format for dates (e.g., 2024-01-01T00:00:00Z)

### Get Event
\`\`\`
GET /me/events/{id}
\`\`\`

### Create Event
\`\`\`
POST /me/events
Body: { "subject": "...", "start": { "dateTime": "...", "timeZone": "..." }, "end": { "dateTime": "...", "timeZone": "..." } }
\`\`\`

### Update Event
\`\`\`
PATCH /me/events/{id}
Body: { fields to update }
\`\`\`

### Delete Event
\`\`\`
DELETE /me/events/{id}
\`\`\`

## Rate Limits

Microsoft Graph has throttling limits. If you receive 429 errors, wait before retrying.

<!-- SETUP: This section is ONLY for the setup agent -->

## Setup Hints

### Configuration

**Required config.json:**
\`\`\`json
{
  "id": "src_microsoft_calendar",
  "name": "Microsoft Calendar",
  "slug": "microsoft-calendar",
  "enabled": true,
  "provider": "microsoft",
  "type": "api",
  "api": {
    "baseUrl": "https://graph.microsoft.com/v1.0/",
    "authType": "bearer",
    "microsoftService": "microsoft-calendar",
    "testEndpoint": {
      "method": "GET",
      "path": "me/calendars?$top=1"
    }
  },
  "iconUrl": "https://res.cdn.office.net/files/fabric-cdn-prod_20241209.001/assets/brand-icons/product/svg/outlook_48x1.svg"
}
\`\`\`

### Authentication
Use \`source_microsoft_oauth_trigger\` to start the Microsoft OAuth flow.

### Recommended Questions
- What types of calendar events do you typically work with?
- Do you need to create/modify events or just view them?

### Permissions for Explore Mode
\`\`\`json
{
  "allowedApiEndpoints": [
    { "method": "GET", "path": ".*", "comment": "All GET requests are read-only" }
  ]
}
\`\`\`
`;

const SHAREPOINT_GUIDE = `---
domains:
  - sharepoint.com
  - graph.microsoft.com
providers:
  - microsoft
  - sharepoint
---

# SharePoint

Access to Microsoft SharePoint sites, document libraries, and files via the Microsoft Graph API.

## Scope

- List and search SharePoint sites
- Access document libraries and folders
- Read, upload, and manage files
- Access site lists and list items

## Guidelines

- Use the \`api_sharepoint\` tool with \`path\`, \`method\`, and optional \`params\`
- Base URL: \`https://graph.microsoft.com/v1.0\`
- All paths are relative to the base URL

## Common Endpoints

### List All Sites
\`\`\`
GET /sites?search=*
\`\`\`
Returns all SharePoint sites the user has access to.

### Get Root Site
\`\`\`
GET /sites/root
\`\`\`

### Get Site by ID
\`\`\`
GET /sites/{site-id}
\`\`\`

### Search Sites
\`\`\`
GET /sites?search={query}
\`\`\`

### List Document Libraries (Drives)
\`\`\`
GET /sites/{site-id}/drives
\`\`\`

### List Files in Drive Root
\`\`\`
GET /sites/{site-id}/drive/root/children
\`\`\`

### List Files in Folder
\`\`\`
GET /sites/{site-id}/drive/root:/{folder-path}:/children
\`\`\`

### Get File Metadata
\`\`\`
GET /sites/{site-id}/drive/items/{item-id}
\`\`\`

### Download File Content
\`\`\`
GET /sites/{site-id}/drive/items/{item-id}/content
\`\`\`

### Search Files in Site
\`\`\`
GET /sites/{site-id}/drive/root/search(q='{query}')
\`\`\`

### List Site Lists
\`\`\`
GET /sites/{site-id}/lists
\`\`\`

### Get List Items
\`\`\`
GET /sites/{site-id}/lists/{list-id}/items
\`\`\`

### Upload File
\`\`\`
PUT /sites/{site-id}/drive/root:/{filename}:/content
Body: [file content]
\`\`\`

## Query Parameters

Common OData query parameters:
- \`$select\`: Choose specific fields
- \`$expand\`: Include related entities
- \`$filter\`: Filter results
- \`$orderby\`: Sort results
- \`$top\`: Limit number of results
- \`$skip\`: Skip results for pagination

## Rate Limits

Microsoft Graph has throttling limits. If you receive 429 errors, wait before retrying.

<!-- SETUP: This section is ONLY for the setup agent -->

## Setup Hints

### Configuration

**Required config.json:**
\`\`\`json
{
  "id": "src_sharepoint",
  "name": "SharePoint",
  "slug": "sharepoint",
  "enabled": true,
  "provider": "microsoft",
  "type": "api",
  "api": {
    "baseUrl": "https://graph.microsoft.com/v1.0/",
    "authType": "bearer",
    "microsoftService": "sharepoint",
    "testEndpoint": {
      "method": "GET",
      "path": "sites?search=*"
    }
  },
  "iconUrl": "https://res.cdn.office.net/files/fabric-cdn-prod_20241209.001/assets/brand-icons/product/svg/sharepoint_48x1.svg"
}
\`\`\`

### Authentication
Use \`source_microsoft_oauth_trigger\` to start the Microsoft OAuth flow.

### Recommended Questions
- Which SharePoint sites do you primarily work with?
- Do you need to upload files or just read/browse?
- Are there specific document libraries you frequently access?

### Permissions for Explore Mode
\`\`\`json
{
  "allowedApiEndpoints": [
    { "method": "GET", "path": ".*", "comment": "All GET requests are read-only" }
  ]
}
\`\`\`
`;

/**
 * Map of bundled source guide files
 */
export const BUNDLED_SOURCE_GUIDES: Record<string, string> = {
  'craft.do.md': CRAFT_DO_GUIDE,
  'linear.app.md': LINEAR_APP_GUIDE,
  'github.com.md': GITHUB_COM_GUIDE,
  'gmail.com.md': GMAIL_GUIDE,
  'google-calendar.md': GOOGLE_CALENDAR_GUIDE,
  'google-drive.md': GOOGLE_DRIVE_GUIDE,
  'google-docs.md': GOOGLE_DOCS_GUIDE,
  'google-sheets.md': GOOGLE_SHEETS_GUIDE,
  'slack.com.md': SLACK_GUIDE,
  'outlook.com.md': OUTLOOK_GUIDE,
  'microsoft-calendar.md': MICROSOFT_CALENDAR_GUIDE,
  'teams.microsoft.com.md': TEAMS_GUIDE,
  'sharepoint.com.md': SHAREPOINT_GUIDE,
  'filesystem.md': FILESYSTEM_GUIDE,
  'brave-search.md': BRAVE_SEARCH_GUIDE,
  'memory.md': MEMORY_GUIDE,
};
