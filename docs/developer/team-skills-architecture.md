# Team Skills Architecture

This document describes the technical architecture of Vesper's team skills sync feature, which enables internal distribution of shared skills through private GitHub repositories.

## Overview

Team skills provide a middle layer in the skill precedence hierarchy, sitting between workspace-local skills and Claude Code built-in skills. The implementation leverages GitHub's Contents API to fetch skill directories and stores them locally at `~/.vesper/team-skills/`.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Vesper UI                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │     TeamSkillsSettingsSection.tsx                   │   │
│  │  - Configuration form (repo URL, PAT)               │   │
│  │  - Sync button and status display                   │   │
│  │  - Skills count display                             │   │
│  └──────────────────┬──────────────────────────────────┘   │
└─────────────────────┼──────────────────────────────────────┘
                      │ IPC calls
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                   Electron Main Process                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              ipc.ts (IPC Handlers)                  │   │
│  │  - team-skills:setConfig                            │   │
│  │  - team-skills:sync                                 │   │
│  │  - team-skills:getStatus                            │   │
│  └──────────────────┬──────────────────────────────────┘   │
└─────────────────────┼──────────────────────────────────────┘
                      │
         ┌────────────┼────────────┐
         │            │            │
         ▼            ▼            ▼
┌────────────┐ ┌──────────┐ ┌─────────────────┐
│  Config    │ │  Creds   │ │  GitHub API     │
│  Storage   │ │  Manager │ │  (REST v3)      │
└─────┬──────┘ └────┬─────┘ └────────┬────────┘
      │             │                 │
      │             │                 │
      ▼             ▼                 ▼
┌──────────┐ ┌──────────────┐ ┌──────────────┐
│config.json│ │credentials.enc│ │Private GitHub│
│           │ │              │ │  Repository  │
│teamSkills-│ │team_skills_  │ │              │
│RepoUrl    │ │token         │ │  (Skills)    │
└───────────┘ └──────────────┘ └──────────────┘
                                       │
                                       │ Downloads to
                                       ▼
                              ┌─────────────────┐
                              │~/.vesper/       │
                              │  team-skills/   │
                              │    skill-1/     │
                              │    skill-2/     │
                              └─────────────────┘
```

## Components

### 1. UI Component (`TeamSkillsSettingsSection.tsx`)

**Location**: `apps/electron/src/renderer/components/skills/TeamSkillsSettingsSection.tsx`

**Responsibilities**:
- Display configuration form for repository URL and GitHub PAT
- Show current sync status (configured, skill count)
- Trigger sync operations
- Display sync progress and results

**Key Features**:
- Token input field (password type for security)
- Auto-sync after configuration save
- Loading states during sync
- Error handling with toast notifications
- Collapsible configuration form

**State Management**:
```typescript
interface TeamSkillsStatus {
  configured: boolean      // Has repo URL and PAT
  repoUrl: string | null   // GitHub repo URL
  hasToken: boolean        // Has encrypted PAT stored
  skillCount: number       // Number of synced skills
}
```

### 2. IPC Handlers (`ipc.ts`)

**Location**: `apps/electron/src/main/ipc.ts` (lines 1838-2039)

Three IPC handlers implement the team skills sync protocol:

#### `team-skills:setConfig`

**Input**:
```typescript
{
  repoUrl: string,  // owner/repo or https://github.com/owner/repo
  token: string     // GitHub Personal Access Token
}
```

**Process**:
1. Store GitHub PAT in encrypted credential manager
2. Store repository URL in `config.json`
3. Return success status

**Security**:
- Token stored with type `team_skills_token`
- AES-256-GCM encryption via credential manager
- Never logged or exposed in plaintext

#### `team-skills:sync`

**Input**: None (uses stored config)

**Process**:
1. Load repository URL from config
2. Fetch GitHub PAT from credential manager
3. Parse repository URL (supports multiple formats)
4. Fetch repository contents via GitHub API
5. Filter for skill directories
6. Validate skill directory names (security check)
7. Download each skill's files
8. Save to `~/.vesper/team-skills/`
9. Broadcast `skills-changed` event

**Output**:
```typescript
{
  success: boolean,
  syncedCount?: number,  // Number of skills synced
  error?: string         // Error message if failed
}
```

**GitHub API Flow**:
```
1. GET /repos/{owner}/{repo}/contents
   → Returns array of root-level items

2. For each directory:
   GET /repos/{owner}/{repo}/contents/{skill-path}
   → Returns array of files in skill directory

3. For each file:
   GET {download_url}
   → Returns file contents
```

**Security Validations**:
```typescript
// Skill ID validation regex
const VALID_SKILL_ID = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]?$/

// Prevents path traversal attacks:
// ✅ Valid: "code-review", "skill-1", "my-skill"
// ❌ Invalid: "../evil", "./bad", "UPPERCASE", "a", "abc-"
```

**Error Handling**:
- 404: Repository not found or no access
- 401: Invalid or expired token
- Network timeout: 30-second abort signal
- Invalid repo URL format: Regex validation
- Malformed skill directories: Skip and continue

#### `team-skills:getStatus`

**Input**: None

**Output**:
```typescript
{
  configured: boolean,    // Has both repo URL and token
  repoUrl: string | null, // Current repo URL
  hasToken: boolean,      // Has encrypted token stored
  skillCount: number      // Number of synced skills
}
```

**Process**:
1. Load config to check for `teamSkillsRepoUrl`
2. Check credential manager for `team_skills_token`
3. Count directories in `~/.vesper/team-skills/`

### 3. Storage Layer (`packages/shared/src/skills/storage.ts`)

#### `loadTeamSkills(): LoadedSkill[]`

**Location**: Lines 290-292

**Implementation**:
```typescript
export function loadTeamSkills(): LoadedSkill[] {
  return loadSkillsFromDir(TEAM_SKILLS_DIR, 'team')
}
```

**Process**:
1. Reads all directories in `~/.vesper/team-skills/`
2. For each directory, calls `loadSkillFromDir()`
3. Parses `SKILL.md` with gray-matter
4. Validates required fields (name, description)
5. Validates icon field (emoji or URL only)
6. Finds icon file (icon.png, icon.svg, etc.)
7. Returns array of `LoadedSkill` objects with `source: 'team'`

#### `loadAllSkills(workspaceRoot: string): LoadedSkill[]`

**Location**: Lines 317-344

**Skill Precedence Algorithm**:
```typescript
export function loadAllSkills(workspaceRoot: string): LoadedSkill[] {
  const skills: LoadedSkill[] = []
  const seenSlugs = new Set<string>()

  // 1. Workspace skills (highest priority)
  for (const skill of loadWorkspaceSkills(workspaceRoot)) {
    skills.push({ ...skill, source: 'workspace' })
    seenSlugs.add(skill.slug)
  }

  // 2. Team skills
  for (const skill of loadTeamSkills()) {
    if (!seenSlugs.has(skill.slug)) {
      skills.push(skill)
      seenSlugs.add(skill.slug)
    }
  }

  // 3. Claude Code skills (lowest priority)
  for (const skill of loadGlobalSkills()) {
    if (!seenSlugs.has(skill.slug)) {
      skills.push(skill)
      seenSlugs.add(skill.slug)
    }
  }

  return skills
}
```

**Precedence Order**:
1. **Workspace** (`~/.vesper/workspaces/{id}/skills/`) - Local overrides
2. **Team** (`~/.vesper/team-skills/`) - Shared from GitHub
3. **Claude Code** (`~/.claude/skills/` and `~/.claude/commands/`) - Built-in

**Deduplication Strategy**:
- First source with a given slug wins
- Uses `Set<string>` to track seen slugs
- Subsequent duplicates are skipped

### 4. Configuration Storage

#### Config File (`~/.vesper/config.json`)

**New Field**:
```typescript
interface StoredConfig {
  // ... other fields
  teamSkillsRepoUrl?: string  // GitHub repository URL
}
```

**Example**:
```json
{
  "workspaces": [...],
  "activeWorkspaceId": "...",
  "teamSkillsRepoUrl": "atherslabs/vesper-team-skills"
}
```

#### Credential Storage

**Type**: `team_skills_token`

**Storage**:
```typescript
await credentialManager.set(
  { type: 'team_skills_token' },
  { value: githubPAT }
)
```

**Retrieval**:
```typescript
const credential = await credentialManager.get({
  type: 'team_skills_token'
})
```

**Security**:
- AES-256-GCM encryption
- Stored at `~/.vesper/credentials.enc`
- Never logged or exposed in plaintext

### 5. File System Layout

```
~/.vesper/
├── config.json                    # Contains teamSkillsRepoUrl
├── credentials.enc                # Contains encrypted team_skills_token
└── team-skills/                   # Team skills synced from GitHub
    ├── code-review/
    │   ├── SKILL.md
    │   └── icon.png
    ├── testing-strategy/
    │   ├── SKILL.md
    │   └── icon.svg
    └── deployment-checklist/
        └── SKILL.md
```

## Type Definitions

### `SkillSource` Type

**Location**: `packages/shared/src/skills/types.ts`

```typescript
export type SkillSource = 'workspace' | 'team' | 'claude-code'
```

**Removed**: `'global'` type (deprecated in commit `d54b7f0`)

### `LoadedSkill` Interface

```typescript
export interface LoadedSkill {
  slug: string              // Directory name (e.g., "code-review")
  metadata: SkillMetadata   // Parsed YAML frontmatter
  content: string           // SKILL.md body (without frontmatter)
  iconPath?: string         // Absolute path to icon file
  path: string              // Absolute path to skill directory
  source?: SkillSource      // Source: workspace | team | claude-code
}
```

### `SkillMetadata` Interface

```typescript
export interface SkillMetadata {
  name: string              // Display name
  description: string       // Brief description
  globs?: string[]          // File patterns that trigger skill
  alwaysAllow?: string[]    // Tools to auto-allow
  icon?: string             // Emoji or URL (no inline SVG/relative paths)
}
```

## GitHub API Integration

### Authentication

**Method**: Bearer token authentication

**Headers**:
```typescript
{
  'Authorization': `Bearer ${githubPAT}`,
  'Accept': 'application/vnd.github.v3+json',
  'User-Agent': 'Vesper-Team-Skills'
}
```

### Rate Limiting

**GitHub API Limits**:
- 5,000 requests/hour for authenticated requests
- Vesper makes 1 + N requests per sync (N = number of skills)
- Example: 20 skills = 21 API requests

**Timeout Protection**:
- All requests have 30-second timeout via `AbortSignal.timeout(30000)`
- Prevents hanging connections

### Supported Repository URL Formats

```typescript
// Regex pattern
/(?:github\.com\/)?([^/]+)\/([^/]+?)(?:\.git)?$/

// Supported formats:
✅ "owner/repo"
✅ "https://github.com/owner/repo"
✅ "https://github.com/owner/repo.git"
✅ "github.com/owner/repo"

// Extracted groups:
// [1] = owner
// [2] = repo
```

## Security Considerations

### 1. Path Traversal Prevention

**Validation Regex**:
```typescript
const VALID_SKILL_ID = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]?$/
```

**Rules**:
- Only lowercase letters, numbers, hyphens
- Must start and end with alphanumeric
- 2-64 characters long
- No special characters (/, \, ., etc.)

**Attack Prevention**:
```
❌ "../../../etc/passwd"  → Rejected
❌ "./malicious"          → Rejected
❌ "skill/../evil"        → Rejected
❌ "UPPERCASE"            → Rejected
✅ "code-review"          → Accepted
✅ "skill-123"            → Accepted
```

### 2. Credential Security

**Encryption**:
- AES-256-GCM symmetric encryption
- Key derived from system-specific entropy
- Stored at `~/.vesper/credentials.enc`

**Token Handling**:
- Never logged to console or files
- Cleared from UI input after save
- Only transmitted over HTTPS to GitHub API
- Scoped to minimum permissions (`repo` only)

### 3. Network Security

**HTTPS Enforcement**:
- All GitHub API requests use HTTPS
- No fallback to HTTP

**Request Validation**:
- Repository URL validated before API calls
- Malformed URLs rejected early

**Timeout Protection**:
- 30-second timeout on all requests
- Prevents DoS from slow/hanging connections

### 4. Directory Cleanup

**Sync Strategy**:
```typescript
// Clear existing team skills before sync
if (existsSync(TEAM_SKILLS_DIR)) {
  rmSync(TEAM_SKILLS_DIR, { recursive: true })
}
mkdirSync(TEAM_SKILLS_DIR, { recursive: true })
```

**Rationale**:
- Ensures removed skills are deleted
- Prevents stale skills from accumulating
- Clean slate for each sync

**Trade-off**:
- Cannot do incremental sync
- Must re-download all skills each time
- Acceptable for typical repositories (10-50 skills)

## Error Handling

### Configuration Errors

```typescript
// No repo URL configured
{ success: false, error: 'No team skills repo configured' }

// No GitHub token configured
{ success: false, error: 'No GitHub token configured' }

// Invalid repo URL format
{ success: false, error: 'Invalid repo URL format' }
```

### GitHub API Errors

```typescript
// 404 Not Found
{ success: false, error: 'GitHub API error: 404' }

// 401 Unauthorized
{ success: false, error: 'GitHub API error: 401' }

// Rate limit exceeded
{ success: false, error: 'GitHub API error: 429' }

// Network timeout
{ success: false, error: 'Request timed out' }
```

### Skill Validation Errors

**Handling Strategy**: Skip invalid skills, continue sync

```typescript
for (const skillDir of skillDirs) {
  // Skip hidden directories
  if (skillDir.name.startsWith('.')) continue

  // Security: Validate skill ID
  if (!VALID_SKILL_ID.test(skillDir.name)) {
    ipcLog.warn(`Skipping invalid skill ID: ${skillDir.name}`)
    continue  // Continue to next skill
  }

  try {
    // Download skill...
  } catch (skillError) {
    ipcLog.error(`Failed to sync skill ${skillDir.name}:`, skillError)
    continue  // Continue to next skill
  }
}
```

**Rationale**:
- One bad skill shouldn't break entire sync
- Logs warnings for debugging
- Returns partial success with count of synced skills

## Performance Considerations

### API Request Batching

**Current Implementation**: Sequential requests

```typescript
for (const skillDir of skillDirs) {
  // 1. Fetch skill directory contents
  const skillResponse = await fetch(skillApiUrl, ...)

  // 2. For each file, download contents
  for (const file of skillFiles) {
    const fileResponse = await fetch(file.download_url, ...)
  }
}
```

**Trade-offs**:
- ✅ Simple implementation
- ✅ Easy error handling per skill
- ✅ Avoids rate limiting
- ❌ Slower for large repositories

**Future Optimization**: Parallel downloads with `Promise.all()` and concurrency limit

### File I/O

**Current Implementation**: Synchronous file operations

```typescript
writeFileSync(join(localSkillDir, file.name), content, 'utf-8')
```

**Rationale**:
- Simpler error handling
- No risk of concurrent write conflicts
- Sync operation already async (network bound)

**Trade-offs**:
- ✅ Simple, reliable
- ❌ Blocks event loop during write

### Skill Count Calculation

**Implementation**: Directory listing

```typescript
const skillCount = existsSync(TEAM_SKILLS_DIR)
  ? readdirSync(TEAM_SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory()).length
  : 0
```

**Performance**: O(N) where N = number of entries in directory

## Event Broadcasting

### `skills-changed` Event

**Trigger**: After successful team skills sync

**Implementation**:
```typescript
BrowserWindow.getAllWindows().forEach((win) => {
  win.webContents.send(IPC_CHANNELS.SKILLS_CHANGED)
})
```

**Purpose**:
- Notify all windows to reload skills
- Updates skills panel UI
- Refreshes session skill configurations

**Listeners**:
- Skills panel component
- Session configuration UI
- Any component displaying skill lists

## Migration from Global Skills

### Deprecated Architecture

**Removed in Commit**: `d54b7f0`

**Old Structure**:
```
~/.vesper/
└── global-skills/        # DEPRECATED
    └── skill-1/
        └── SKILL.md
```

**Problem**:
- SDK expected skills at `{plugin-root}/skills/{name}/SKILL.md`
- Global skills were at `{plugin-root}/{name}/SKILL.md`
- Path mismatch broke SDK integration

### New Architecture

**Consolidation**:
- Non-workspace skills → `~/.claude/skills/` (Claude Code)
- Team skills → `~/.vesper/team-skills/` (Team sync)

**Benefits**:
- ✅ SDK compatibility restored
- ✅ Clear separation of concerns
- ✅ Team skills properly isolated
- ✅ Precedence system simplified

## Testing

### IPC Handler Testing

**Location**: `apps/electron/src/main/__tests__/ipc.test.ts`

**Test Cases**:
```typescript
describe('team-skills IPC handlers', () => {
  test('setConfig stores repo URL and token')
  test('sync fetches skills from GitHub')
  test('sync validates skill directory names')
  test('sync handles API errors gracefully')
  test('getStatus returns correct configuration state')
})
```

### Storage Testing

**Location**: `packages/shared/src/skills/__tests__/storage.test.ts`

**Test Cases**:
```typescript
describe('Team Skills Storage', () => {
  test('loadTeamSkills returns empty array if directory missing')
  test('loadTeamSkills loads valid skills')
  test('loadTeamSkills skips invalid skill directories')
  test('loadAllSkills applies correct precedence order')
  test('loadAllSkills deduplicates by slug')
})
```

### UI Testing

**Location**: `apps/electron/src/renderer/components/skills/__tests__/TeamSkillsSettingsSection.test.tsx`

**Test Cases**:
```typescript
describe('TeamSkillsSettingsSection', () => {
  test('displays configuration form when unconfigured')
  test('displays status when configured')
  test('triggers sync on button click')
  test('shows error toast on sync failure')
  test('clears token input after save')
})
```

## Future Enhancements

### 1. Incremental Sync

**Current**: Full re-download on every sync

**Proposed**: Track file hashes, only download changed files

**Benefits**:
- Faster syncs for large repositories
- Reduced API usage
- Lower bandwidth consumption

**Implementation**:
```typescript
// Store metadata file with hashes
{
  "skills": {
    "code-review": {
      "sha": "abc123...",
      "files": {
        "SKILL.md": "def456...",
        "icon.png": "ghi789..."
      }
    }
  }
}
```

### 2. Auto-Sync on Interval

**Proposed**: Background sync every N hours

**Benefits**:
- Team members always have latest skills
- No manual sync required

**Configuration**:
```typescript
interface TeamSkillsConfig {
  autoSync: boolean
  syncIntervalHours: number  // Default: 24
}
```

### 3. Branch Selection

**Current**: Always syncs from default branch

**Proposed**: Allow selecting specific branch/tag

**Benefits**:
- Test pre-release skills
- Pin to specific versions
- Environment-specific skills (dev/staging/prod)

**Configuration**:
```typescript
interface TeamSkillsConfig {
  repoUrl: string
  branch?: string  // Default: default branch
}
```

### 4. Webhook-Based Sync

**Proposed**: GitHub webhook triggers sync

**Benefits**:
- Real-time updates
- No polling required
- Instant propagation

**Implementation**:
- Webhook receiver in Electron main process
- Secure webhook secret validation
- Broadcast to all running Vesper instances

### 5. Skill Versioning

**Proposed**: Track skill versions, allow pinning

**Benefits**:
- Stability for production workflows
- Rollback capability
- Version compatibility tracking

**Configuration**:
```typescript
interface SkillVersion {
  slug: string
  version: string      // Semantic version
  minVesperVersion?: string
}
```

## Related Documentation

- [User Guide: Team Skills](../user-guide/team-skills.md) - Setup and usage
- [Skills Storage](../../packages/shared/src/skills/storage.ts) - Storage implementation
- [IPC Handlers](../../apps/electron/src/main/ipc.ts) - IPC implementation
- [Credential Manager](../../packages/shared/src/credentials/) - Encryption details

## Changelog

### Commit `3b2f298` (2026-01-25)
- Initial implementation of team skills sync
- Add GitHub API integration
- Add encrypted credential storage
- Add UI configuration component

### Commit `d54b7f0` (2026-01-25)
- Remove deprecated global-skills directory
- Consolidate non-workspace skills to Claude Code
- Update skill precedence: workspace > team > claude-code
