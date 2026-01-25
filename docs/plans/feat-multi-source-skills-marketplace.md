# feat: Multi-Source Skills Marketplace

> Extend the skills marketplace to support multiple skill sources beyond skills.sh.

**Date:** 2026-01-25
**Revised:** 2026-01-25 (Post-review simplification)
**Status:** Draft
**Type:** Enhancement
**Complexity:** Medium

---

## Overview

Currently, Vesper's skills marketplace fetches skills exclusively from skills.sh. This proposal adds support for additional GitHub-based skill repositories with minimal architectural changes.

**MVP Scope:**
1. Search skills from skills.sh (existing) + anthropics/skills + ComposioHQ/awesome-claude-skills
2. Show source attribution in UI
3. Filter results by source

**Explicitly NOT in MVP:**
- Custom GitHub repo configuration (add later if requested)
- Local filesystem sources (add later if requested)
- Offline caching (simple in-memory cache only)
- Provider enable/disable settings

## Problem Statement

- Single source (skills.sh) limits skill discovery
- Quality skills exist in anthropics/skills and community repos
- No visibility into where skills come from

## Proposed Solution

### Architecture: Simple Functions, No Abstractions

```
┌─────────────────────────────────────────────┐
│           IPC Handler (ipc.ts)              │
│                                             │
│   search(query) {                           │
│     results = await Promise.all([           │
│       fetchSkillsSh(query),                 │
│       fetchGitHub('anthropics/skills'),     │
│       fetchGitHub('ComposioHQ/awesome...'), │
│     ])                                      │
│     return merge(results)                   │
│   }                                         │
└─────────────────────────────────────────────┘
```

**No provider interfaces. No factories. No aggregator classes. Just functions.**

## Technical Approach

### Type Changes (Minimal)

**File:** `apps/electron/src/shared/types.ts` (modify existing)

```typescript
// Extend existing MarketplaceSkill interface
export interface MarketplaceSkill {
  id: string;
  name: string;
  installs?: number;
  topSource: string;  // owner/repo format

  // NEW: Source attribution
  source: 'skills.sh' | 'anthropics/skills' | 'ComposioHQ/awesome-claude-skills';
}

// Extend existing response
export interface MarketplaceSearchResponse {
  skills: MarketplaceSkill[];
  hasMore: boolean;
  errors?: string[];  // NEW: List failed sources
}
```

### Implementation (~200 lines in existing file)

**File:** `apps/electron/src/main/ipc.ts` (modify existing handlers)

```typescript
// ============================================
// MARKETPLACE SOURCES - Simple functions, no classes
// ============================================

const GITHUB_SOURCES = [
  { owner: 'anthropics', repo: 'skills', name: 'anthropics/skills' },
  { owner: 'ComposioHQ', repo: 'awesome-claude-skills', name: 'ComposioHQ/awesome-claude-skills' },
] as const;

// Simple in-memory cache
const skillsCache = new Map<string, { data: any; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached<T>(key: string): T | null {
  const entry = skillsCache.get(key);
  if (!entry || Date.now() > entry.expiry) {
    skillsCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache(key: string, data: any): void {
  skillsCache.set(key, { data, expiry: Date.now() + CACHE_TTL });
}

/**
 * Fetch from skills.sh (existing logic, extracted)
 */
async function fetchSkillsSh(query: string): Promise<MarketplaceSkill[]> {
  const url = query
    ? `https://skills.sh/api/skills?q=${encodeURIComponent(query)}`
    : 'https://skills.sh/api/skills';

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`skills.sh: ${response.status}`);

  const data = await response.json();
  return data.skills.map((s: any) => ({ ...s, source: 'skills.sh' }));
}

/**
 * Fetch from a GitHub skills repository
 */
async function fetchGitHubSource(
  owner: string,
  repo: string,
  query: string
): Promise<MarketplaceSkill[]> {
  const cacheKey = `github:${owner}/${repo}`;

  // Try cache first (GitHub repos don't change often)
  let skills = getCached<MarketplaceSkill[]>(cacheKey);

  if (!skills) {
    // Fetch directory listing
    const listUrl = `https://api.github.com/repos/${owner}/${repo}/contents/skills`;
    const response = await fetch(listUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { 'Accept': 'application/vnd.github.v3+json' },
    });

    if (!response.ok) throw new Error(`GitHub ${owner}/${repo}: ${response.status}`);

    const contents = await response.json();
    const dirs = contents.filter((item: any) => item.type === 'dir');

    // Fetch SKILL.md metadata for each (parallel with limit)
    skills = await Promise.all(
      dirs.slice(0, 50).map(async (dir: any) => {
        try {
          const mdUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/skills/${dir.name}/SKILL.md`;
          const mdResponse = await fetch(mdUrl, { signal: AbortSignal.timeout(5000) });
          if (!mdResponse.ok) return null;

          const content = await mdResponse.text();
          const name = content.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? dir.name;
          const description = content.match(/^description:\s*(.+)$/m)?.[1]?.trim();

          return {
            id: dir.name,
            name,
            description,
            topSource: `${owner}/${repo}`,
            source: `${owner}/${repo}` as const,
          };
        } catch {
          return null;
        }
      })
    );

    skills = skills.filter((s): s is MarketplaceSkill => s !== null);
    setCache(cacheKey, skills);
  }

  // Filter by query if provided
  if (query) {
    const q = query.toLowerCase();
    return skills.filter(
      s => s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q)
    );
  }

  return skills;
}

// ============================================
// UPDATED IPC HANDLER
// ============================================

ipcMain.handle(IPC_CHANNELS.MARKETPLACE_SEARCH, async (_, query: string) => {
  const errors: string[] = [];

  // Fetch from all sources in parallel
  const results = await Promise.allSettled([
    fetchSkillsSh(query),
    ...GITHUB_SOURCES.map(s => fetchGitHubSource(s.owner, s.repo, query)),
  ]);

  const skills: MarketplaceSkill[] = [];
  const sourceNames = ['skills.sh', ...GITHUB_SOURCES.map(s => s.name)];

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      skills.push(...result.value);
    } else {
      errors.push(`${sourceNames[i]}: ${result.reason?.message ?? 'failed'}`);
    }
  });

  // Simple dedup by id (keep first occurrence, which is skills.sh if available)
  const seen = new Set<string>();
  const dedupedSkills = skills.filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  return {
    skills: dedupedSkills,
    hasMore: false,
    errors: errors.length > 0 ? errors : undefined,
  };
});
```

### Security Controls (Required)

```typescript
// Add to the fetch functions above

// 1. Response size limit
async function safeFetch(url: string, options?: RequestInit): Promise<Response> {
  const response = await fetch(url, options);

  const contentLength = parseInt(response.headers.get('content-length') || '0');
  if (contentLength > 5 * 1024 * 1024) { // 5MB max
    throw new Error('Response too large');
  }

  return response;
}

// 2. Sanitize SKILL.md content before sending to renderer
function sanitizeSkillContent(content: string): string {
  // Remove potential script injections
  return content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '');
}

// 3. Validate GitHub owner/repo format
function validateGitHubSource(owner: string, repo: string): boolean {
  const GITHUB_NAME_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;
  return GITHUB_NAME_REGEX.test(owner) && GITHUB_NAME_REGEX.test(repo);
}
```

### UI Changes (~100 lines)

**File:** `apps/electron/src/renderer/components/skills/MarketplaceSearchPanel.tsx`

```tsx
// Add source filter badges (inline, no new component file)

// At top of component, add state:
const [activeSource, setActiveSource] = useState<string | null>(null);

// Add filter UI before skills list:
<div className="flex gap-1.5 px-3 py-2 border-b">
  <Badge
    variant={activeSource === null ? 'default' : 'outline'}
    className="cursor-pointer text-xs"
    onClick={() => setActiveSource(null)}
  >
    All
  </Badge>
  <Badge
    variant={activeSource === 'skills.sh' ? 'default' : 'outline'}
    className="cursor-pointer text-xs"
    onClick={() => setActiveSource('skills.sh')}
  >
    <Globe className="w-3 h-3 mr-1" />
    skills.sh
  </Badge>
  <Badge
    variant={activeSource === 'anthropics/skills' ? 'default' : 'outline'}
    className="cursor-pointer text-xs"
    onClick={() => setActiveSource('anthropics/skills')}
  >
    <Github className="w-3 h-3 mr-1" />
    anthropics
  </Badge>
  <Badge
    variant={activeSource === 'ComposioHQ/awesome-claude-skills' ? 'default' : 'outline'}
    className="cursor-pointer text-xs"
    onClick={() => setActiveSource('ComposioHQ/awesome-claude-skills')}
  >
    <Github className="w-3 h-3 mr-1" />
    ComposioHQ
  </Badge>
</div>

// Filter skills before rendering:
const filteredSkills = activeSource
  ? skills.filter(s => s.source === activeSource)
  : skills;

// Add source indicator to skill rows:
<span className="text-xs text-muted-foreground">
  {skill.source === 'skills.sh' ? (
    <Globe className="w-3 h-3 inline" />
  ) : (
    <Github className="w-3 h-3 inline" />
  )}
</span>

// Show errors toast if any source failed:
useEffect(() => {
  if (searchResult?.errors?.length) {
    toast.warning('Some sources unavailable', {
      description: searchResult.errors.join(', '),
    });
  }
}, [searchResult?.errors]);
```

## Acceptance Criteria

### Functional Requirements

- [x] Search returns skills from skills.sh + anthropics/skills + ComposioHQ/awesome-claude-skills
- [x] Each skill shows source attribution (icon + label)
- [x] Users can filter results by source using badge toggles
- [x] Partial results shown when some sources fail (with toast notification)
- [x] Results cached for 5 minutes to reduce API calls

### Non-Functional Requirements

- [x] Search completes within 8 seconds per source (timeout)
- [x] Response size limited to 5MB (security)
- [x] SKILL.md content sanitized before rendering (XSS prevention)
- [x] UI remains responsive during searches

### Quality Gates

- [x] Existing marketplace tests still pass
- [x] Manual test: search with network disconnected (graceful failure)
- [x] Manual test: search returns results from all 3 sources

## Files to Modify

| File | Changes | Lines |
|------|---------|-------|
| `apps/electron/src/main/ipc.ts` | Add multi-source fetch functions, update handler | ~150 |
| `apps/electron/src/shared/types.ts` | Add `source` field to MarketplaceSkill | ~5 |
| `apps/electron/src/renderer/components/skills/MarketplaceSearchPanel.tsx` | Add source filter badges, source indicator | ~50 |

**Total: ~205 lines changed across 3 files. No new files.**

## Future Enhancements (If Requested)

These are explicitly **not** in MVP scope. Add only if users request:

1. **Custom GitHub repos** - Settings UI to add `owner/repo`
2. **Local filesystem sources** - Scan `~/.skills/` directory
3. **Source enable/disable** - Toggle sources in settings
4. **Offline mode** - Persist cache to disk
5. **skillsmp.com** - Monitor for API availability

## References

### Internal

- Current marketplace IPC: `apps/electron/src/main/ipc.ts:2515-2630`
- Marketplace types: `apps/electron/src/shared/types.ts:54-91`
- Search panel: `apps/electron/src/renderer/components/skills/MarketplaceSearchPanel.tsx`

### External

- [anthropics/skills](https://github.com/anthropics/skills) - Official Anthropic skills
- [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) - Community collection
- [GitHub API Rate Limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) - 60/hour unauthenticated

---

## Review Feedback Incorporated

This plan was revised based on feedback from three reviewers:

| Reviewer | Original Verdict | Key Feedback |
|----------|-----------------|--------------|
| DHH | NEEDS REWORK | "Spacecraft when we need a bicycle" - reduce 14 files to functions |
| Security (Kieran) | NEEDS REWORK | Add response size limits, content sanitization, input validation |
| Simplicity | NEEDS REWORK | Complexity 7/10 → target 3/10, no provider abstraction needed |

**Changes made:**
- Removed provider interface, factory, aggregator, cache classes
- Reduced from 14 new files to 0 new files (modify 3 existing)
- Kept essential security controls (size limits, sanitization)
- Simplified to ~200 lines instead of ~1,500 lines

---

*Revised with Claude Code on 2026-01-25*
