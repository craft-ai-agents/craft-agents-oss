# Multi-Source Skills Marketplace: Implementation Roadmap

## Overview

This document provides a detailed, phased implementation roadmap for extending Vesper's skills marketplace. It complements the edge cases and gaps analysis document with concrete implementation steps.

---

## Phase 1: Foundation (Week 1-2)

### Goal
Establish infrastructure for multi-source support without breaking existing functionality.

### 1.1 Extend Type System

**File:** `/packages/shared/src/skills/types.ts`

```typescript
// Add source type
export type SkillMarketplaceSource = 'skills.sh' | 'github' | 'local'

// Extend MarketplaceSkill interface
export interface MarketplaceSkill {
  id: string
  name: string
  installs: number
  topSource: string  // "owner/repo"

  // NEW FIELDS (Phase 1)
  sourceOrigin: SkillMarketplaceSource
  sourceUrl: string  // Full URL: https://github.com/anthropics/skills or file:///home/...
  sourceRepository?: string  // For GitHub: "anthropics/skills"
  lastUpdated?: string  // ISO 8601
  isDuplicate?: boolean  // Marked during deduplication
  duplicateOf?: string  // ID of canonical version if duplicate
}

// New config type
export interface MarketplaceSourceConfig {
  source: SkillMarketplaceSource
  enabled: boolean
  timeout?: number  // ms per source
  priority?: number  // Lower = higher priority in search results
}

export interface MarketplaceConfig {
  sources: MarketplaceSourceConfig[]
  deduplicateResults: boolean
  cacheTtlHours: number
  maxCacheSize: number  // MB
}
```

**Backward Compatibility:**
- Add fields as optional
- Default `sourceOrigin` detection from `topSource` format
- Existing code continues working

**Testing:**
```bash
bun test packages/shared/src/skills/types.ts
```

---

### 1.2 Create Cache Layer

**File:** `/packages/shared/src/skills/marketplace-cache.ts` (new)

```typescript
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface CacheEntry {
  query: string
  results: MarketplaceSkill[]
  timestamp: number
  source: SkillMarketplaceSource
  ttlHours: number
  etag?: string  // For GitHub API conditional requests
}

export class MarketplaceCache {
  private cachePath: string
  private entries: Map<string, CacheEntry[]> = new Map()
  private loadedAt: number = 0

  constructor(workspaceId?: string) {
    const cacheDir = join(homedir(), '.vesper', 'cache', 'marketplace')
    this.cachePath = workspaceId
      ? join(cacheDir, `${workspaceId}.jsonl`)
      : join(cacheDir, 'global.jsonl')
  }

  async load(): Promise<void> {
    if (!existsSync(this.cachePath)) {
      return
    }

    try {
      const content = await readFile(this.cachePath, 'utf-8')
      const lines = content.split('\n').filter(Boolean)

      for (const line of lines) {
        const entry = JSON.parse(line) as CacheEntry
        const key = entry.query.toLowerCase()

        if (!this.entries.has(key)) {
          this.entries.set(key, [])
        }
        this.entries.get(key)!.push(entry)
      }

      this.loadedAt = Date.now()
    } catch (error) {
      console.error('Failed to load marketplace cache:', error)
      this.entries.clear()
    }
  }

  async save(): Promise<void> {
    try {
      const dir = join(this.cachePath, '..')
      await mkdir(dir, { recursive: true })

      const lines: string[] = []
      for (const entries of this.entries.values()) {
        for (const entry of entries) {
          lines.push(JSON.stringify(entry))
        }
      }

      await writeFile(this.cachePath, lines.join('\n'))
    } catch (error) {
      console.error('Failed to save marketplace cache:', error)
    }
  }

  get(query: string, source?: SkillMarketplaceSource): CacheEntry | null {
    const key = query.toLowerCase()
    const entries = this.entries.get(key) || []

    const now = Date.now()

    // Filter by source if specified
    let candidates = entries
    if (source) {
      candidates = entries.filter(e => e.source === source)
    }

    // Find valid (non-expired) entry
    for (const entry of candidates) {
      const ageMs = now - entry.timestamp
      const ttlMs = entry.ttlHours * 60 * 60 * 1000

      if (ageMs < ttlMs) {
        return entry  // Cache hit
      }
    }

    return null  // Cache miss or expired
  }

  set(query: string, results: MarketplaceSkill[], source: SkillMarketplaceSource, ttlHours: number): void {
    const key = query.toLowerCase()

    if (!this.entries.has(key)) {
      this.entries.set(key, [])
    }

    const entry: CacheEntry = {
      query,
      results,
      timestamp: Date.now(),
      source,
      ttlHours
    }

    // Keep only 5 most recent entries per query to avoid unbounded growth
    const entries = this.entries.get(key)!
    entries.push(entry)
    entries.sort((a, b) => b.timestamp - a.timestamp)
    entries.splice(5)  // Keep only 5 most recent
  }

  invalidateByAge(maxAgeHours: number): void {
    const now = Date.now()
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000

    for (const entries of this.entries.values()) {
      entries.filter(e => now - e.timestamp < maxAgeMs)
    }
  }

  invalidateBySource(source: SkillMarketplaceSource): void {
    for (const entries of this.entries.values()) {
      const filtered = entries.filter(e => e.source !== source)
      entries.splice(0, entries.length, ...filtered)
    }
  }

  clear(): void {
    this.entries.clear()
  }

  getStats() {
    let totalSize = 0
    let totalEntries = 0

    for (const entries of this.entries.values()) {
      totalEntries += entries.length
      for (const entry of entries) {
        totalSize += JSON.stringify(entry).length
      }
    }

    return {
      size: totalSize,
      entries: totalEntries,
      uniqueQueries: this.entries.size,
      loadedAt: this.loadedAt
    }
  }
}

export async function initializeMarketplaceCache(workspaceId?: string): Promise<MarketplaceCache> {
  const cache = new MarketplaceCache(workspaceId)
  await cache.load()
  return cache
}
```

**Usage in Main Process:**
```typescript
// In apps/electron/src/main/ipc.ts around line 2526
import { initializeMarketplaceCache } from '@vesper/shared/skills'

// At app initialization
const marketplaceCaches = new Map<string, MarketplaceCache>()

// In MARKETPLACE_SEARCH handler
ipcMain.handle(IPC_CHANNELS.MARKETPLACE_SEARCH, async (_event, query: string) => {
  const workspaceId = getWorkspaceIdFromEvent(_event)
  const cache = marketplaceCaches.get(workspaceId) ||
               (await initializeMarketplaceCache(workspaceId))

  // Check cache first
  const cached = cache.get(query)
  if (cached) {
    ipcLog.debug('Marketplace cache hit', { query })
    return { skills: cached.results, hasMore: false, source: 'cache' }
  }

  // Otherwise query API
  // ... existing code ...
})
```

---

### 1.3 Rate Limit Management

**File:** `/packages/shared/src/skills/rate-limiter.ts` (new)

```typescript
export interface RateLimitState {
  source: string
  remaining: number
  limit: number
  reset: number  // Unix timestamp (seconds)
  lastUpdated: number  // Timestamp when we read the headers
  isExhausted: boolean
}

export class RateLimiter {
  private states = new Map<string, RateLimitState>()

  updateFromResponse(source: string, headers: Headers): void {
    const remaining = parseInt(headers.get('x-ratelimit-remaining') || '0')
    const limit = parseInt(headers.get('x-ratelimit-limit') || '60')
    const reset = parseInt(headers.get('x-ratelimit-reset') || '0')

    this.states.set(source, {
      source,
      remaining,
      limit,
      reset,
      lastUpdated: Date.now(),
      isExhausted: remaining === 0
    })
  }

  canMakeRequest(source: string): boolean {
    const state = this.states.get(source)
    if (!state) return true  // No data yet, assume OK

    // If exhausted and not yet reset
    if (state.isExhausted && Date.now() < state.reset * 1000) {
      return false
    }

    return state.remaining > 0
  }

  getBackoffMs(source: string): number {
    const state = this.states.get(source)
    if (!state || !state.isExhausted) return 0

    const now = Date.now()
    const resetTime = state.reset * 1000

    if (now >= resetTime) return 0

    return Math.max(100, resetTime - now)
  }

  getStatus(source: string): RateLimitState | null {
    return this.states.get(source) || null
  }

  clear(source?: string): void {
    if (source) {
      this.states.delete(source)
    } else {
      this.states.clear()
    }
  }
}
```

---

### 1.4 Update IPC Handler

**File:** `/apps/electron/src/main/ipc.ts` (modify lines 2526-2575)

```typescript
import { MarketplaceCache, RateLimiter } from '@vesper/shared/skills'

// At initialization
const rateLimiter = new RateLimiter()

ipcMain.handle(IPC_CHANNELS.MARKETPLACE_SEARCH, async (_event, query: string) => {
  try {
    const allSkills: MarketplaceSkill[] = []
    const errors: Array<{ source: string; error: string }> = []

    // 1. skills.sh source
    if (rateLimiter.canMakeRequest('skills.sh')) {
      try {
        const url = query
          ? `https://skills.sh/api/skills?q=${encodeURIComponent(query)}`
          : 'https://skills.sh/api/skills'

        const response = await fetch(url)
        const data = await response.json() as {
          skills?: Array<{ id: string; name: string; installs: number; topSource: string }>
          hasMore?: boolean
        }

        // Update rate limit info
        rateLimiter.updateFromResponse('skills.sh', response.headers)

        if (data.skills) {
          allSkills.push(
            ...data.skills.map(s => ({
              ...s,
              sourceOrigin: 'skills.sh' as const,
              sourceUrl: `https://skills.sh/skill/${s.id}`
            }))
          )
        }
      } catch (error) {
        errors.push({
          source: 'skills.sh',
          error: error instanceof Error ? error.message : 'Unknown error'
        })
        ipcLog.error('Error searching skills.sh:', error)
      }
    }

    // If we get results or no errors, return them
    if (allSkills.length > 0) {
      return { skills: allSkills, hasMore: false }
    }

    if (errors.length > 0) {
      ipcLog.warn('Marketplace search errors:', errors)
      // Return empty but don't crash
      return { skills: [], hasMore: false }
    }

    return { skills: [], hasMore: false }
  } catch (error) {
    ipcLog.error('Error searching marketplace:', error)
    return { skills: [], hasMore: false }
  }
})
```

---

## Phase 2: Multi-Source Support (Week 3-4)

### Goal
Add GitHub and local filesystem sources with deduplication.

### 2.1 GitHub Source Handler

**File:** `/packages/shared/src/skills/github-source.ts` (new)

```typescript
export interface GitHubSourceOptions {
  repository: string  // "anthropics/skills"
  token?: string  // Optional GitHub token
  timeout?: number  // ms
}

export class GitHubSkillSource {
  constructor(private options: GitHubSourceOptions) {}

  async search(query: string): Promise<{ skills: MarketplaceSkill[]; headers: Headers }> {
    // For now, just list all skills in repository
    // GitHub doesn't have built-in search across multiple repos easily

    const url = `https://api.github.com/repos/${this.options.repository}/contents/skills`
    const headers: HeadersInit = {
      'Accept': 'application/vnd.github.v3+json'
    }

    if (this.options.token) {
      headers['Authorization'] = `token ${this.options.token}`
    }

    const response = await Promise.race([
      fetch(url, { headers }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), this.options.timeout || 5000)
      )
    ]) as Response

    const folders = await response.json() as Array<{ name: string; type: string }>
    const skillFolders = folders.filter(f => f.type === 'dir')

    // Filter by query
    const filtered = query
      ? skillFolders.filter(f =>
          f.name.toLowerCase().includes(query.toLowerCase())
        )
      : skillFolders

    // Load metadata for each skill
    const skills: MarketplaceSkill[] = []
    for (const folder of filtered.slice(0, 50)) {  // Limit to 50 to avoid too many requests
      try {
        const skillMd = await this.getSkillMetadata(folder.name)
        if (skillMd) {
          skills.push({
            id: skillMd.name || folder.name,
            name: skillMd.name || folder.name,
            installs: 0,  // GitHub doesn't provide this
            topSource: this.options.repository,
            sourceOrigin: 'github',
            sourceUrl: `https://github.com/${this.options.repository}/tree/main/skills/${folder.name}`,
            sourceRepository: this.options.repository,
            lastUpdated: new Date().toISOString()
          })
        }
      } catch (error) {
        // Skip this skill on error
        continue
      }
    }

    return { skills, headers: response.headers }
  }

  private async getSkillMetadata(folderName: string): Promise<{ name?: string } | null> {
    const url = `https://raw.githubusercontent.com/${this.options.repository}/main/skills/${folderName}/SKILL.md`

    try {
      const response = await fetch(url)
      if (!response.ok) return null

      const content = await response.text()
      const nameMatch = content.match(/^name:\s*["']?([^"'\n]+)["']?/m)

      return { name: nameMatch?.[1]?.trim() }
    } catch {
      return null
    }
  }
}
```

### 2.2 Local Filesystem Source

**File:** `/packages/shared/src/skills/local-source.ts` (new)

```typescript
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

export class LocalSkillSource {
  constructor(private basePath: string) {}

  async search(query: string): Promise<MarketplaceSkill[]> {
    if (!existsSync(this.basePath)) {
      return []
    }

    try {
      const folders = await readdir(this.basePath)
      const skillFolders = folders.filter(f =>
        !f.startsWith('.')  // Skip hidden
      )

      const filtered = query
        ? skillFolders.filter(f =>
            f.toLowerCase().includes(query.toLowerCase())
          )
        : skillFolders

      const skills: MarketplaceSkill[] = []

      for (const folder of filtered) {
        const skillMd = join(this.basePath, folder, 'SKILL.md')

        try {
          if (existsSync(skillMd)) {
            const content = await readFile(skillMd, 'utf-8')
            const nameMatch = content.match(/^name:\s*["']?([^"'\n]+)["']?/m)
            const name = nameMatch?.[1]?.trim() || folder

            skills.push({
              id: folder,
              name,
              installs: 0,
              topSource: folder,
              sourceOrigin: 'local',
              sourceUrl: `file://${this.basePath}/${folder}`,
              lastUpdated: new Date().toISOString()
            })
          }
        } catch (error) {
          // Skip folders without SKILL.md
          continue
        }
      }

      return skills
    } catch (error) {
      ipcLog.error('Error searching local skills:', error)
      return []
    }
  }
}
```

### 2.3 Deduplication Engine

**File:** `/packages/shared/src/skills/deduplicator.ts` (new)

```typescript
export class SkillDeduplicator {
  private canonicalMap = new Map<string, string[]>()  // canonicalId → skillIds

  static computeCanonicalId(skillName: string): string {
    return skillName
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/_/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  deduplicateSkills(
    skills: MarketplaceSkill[],
    options: { strategy: 'merge' | 'showAll' } = { strategy: 'merge' }
  ): MarketplaceSkill[] {
    const grouped = new Map<string, MarketplaceSkill[]>()

    // Group by canonical ID
    for (const skill of skills) {
      const canonical = SkillDeduplicator.computeCanonicalId(skill.name)
      if (!grouped.has(canonical)) {
        grouped.set(canonical, [])
      }
      grouped.get(canonical)!.push(skill)
    }

    if (options.strategy === 'merge') {
      // Return best version of each skill
      const merged: MarketplaceSkill[] = []

      for (const duplicates of grouped.values()) {
        const best = this.selectBestVersion(duplicates)
        merged.push(best)
      }

      return merged
    } else {
      // Return all with dedup metadata
      const withMetadata: MarketplaceSkill[] = []

      for (const [canonical, duplicates] of grouped) {
        if (duplicates.length === 1) {
          withMetadata.push(duplicates[0])
        } else {
          // Mark as duplicate, prefer official source
          const best = this.selectBestVersion(duplicates)
          withMetadata.push({
            ...best,
            isDuplicate: true,
            duplicateOf: canonical
          })
        }
      }

      return withMetadata
    }
  }

  private selectBestVersion(duplicates: MarketplaceSkill[]): MarketplaceSkill {
    // Priority:
    // 1. Official source (anthropics/skills)
    // 2. Highest installs (popularity)
    // 3. Most recently updated
    // 4. GitHub > skills.sh > local

    const scoreSkill = (skill: MarketplaceSkill): number => {
      let score = 0

      // Official source
      if (skill.sourceRepository === 'anthropics/skills') {
        score += 10000
      }

      // Installs
      score += skill.installs || 0

      // Recently updated
      if (skill.lastUpdated) {
        const ageMs = Date.now() - new Date(skill.lastUpdated).getTime()
        const ageWeeks = ageMs / (7 * 24 * 60 * 60 * 1000)
        score += Math.max(0, 1000 - ageWeeks * 10)  // Decay over time
      }

      // Source priority
      const sourcePriority = {
        'github': 300,
        'skills.sh': 200,
        'local': 100
      }
      score += sourcePriority[skill.sourceOrigin] || 0

      return score
    }

    return duplicates.sort((a, b) => scoreSkill(b) - scoreSkill(a))[0]
  }
}
```

---

## Phase 3: Security & Polish (Week 5-6)

### 3.1 Content Validation

**File:** `/packages/shared/src/skills/content-validator.ts` (new)

```typescript
export interface SecurityIssue {
  type: 'size_exceeded' | 'suspicious_pattern' | 'invalid_url' | 'permission_issue'
  severity: 'low' | 'medium' | 'high'
  description: string
  location?: number
}

export class SkillContentValidator {
  private readonly MAX_SIZE = 100 * 1024  // 100KB
  private readonly SUSPICIOUS_PATTERNS = [
    /ignore.*previous.*instruction/i,
    /bypass.*safety/i,
    /remove.*restriction/i,
    /execute.*shell/i,
    /system.*prompt/i
  ]
  private readonly WHITELIST_DOMAINS = [
    'github.com',
    'githubusercontent.com',
    'api.github.com',
    'anthropic.com',
    'skills.sh'
  ]

  validate(content: string): { safe: boolean; issues: SecurityIssue[] } {
    const issues: SecurityIssue[] = []

    // Size check
    if (content.length > this.MAX_SIZE) {
      issues.push({
        type: 'size_exceeded',
        severity: 'high',
        description: `Content exceeds maximum size (${this.MAX_SIZE} bytes)`
      })
    }

    // Suspicious patterns
    for (const pattern of this.SUSPICIOUS_PATTERNS) {
      if (pattern.test(content)) {
        issues.push({
          type: 'suspicious_pattern',
          severity: 'medium',
          description: `Found suspicious pattern: ${pattern.source}`
        })
      }
    }

    // URL validation
    const urlRegex = /https?:\/\/[^\s)]+/g
    const urls = content.match(urlRegex) || []

    for (const url of urls) {
      try {
        const domain = new URL(url).hostname
        if (!this.WHITELIST_DOMAINS.some(allowed => domain.endsWith(allowed))) {
          issues.push({
            type: 'invalid_url',
            severity: 'low',
            description: `URL to non-whitelisted domain: ${domain}`
          })
        }
      } catch {
        // Invalid URL format
        issues.push({
          type: 'invalid_url',
          severity: 'low',
          description: `Invalid URL format: ${url.substring(0, 50)}`
        })
      }
    }

    const safe = !issues.some(i => i.severity === 'high')
    return { safe, issues }
  }
}
```

---

## Phase 4: UI Enhancements (Week 7)

### 4.1 Settings Page

**File:** `/apps/electron/src/renderer/components/settings/MarketplaceSettingsSection.tsx` (new)

```typescript
import React, { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Toggle } from '@/components/ui/toggle'
import { Trash2, Plus } from 'lucide-react'
import type { MarketplaceSourceConfig } from '@vesper/shared/skills'

export function MarketplaceSettingsSection() {
  const [sources, setSources] = useState<MarketplaceSourceConfig[]>([])
  const [newRepo, setNewRepo] = useState('')

  const handleToggleSource = (source: string) => {
    setSources(sources.map(s =>
      s.source === source ? { ...s, enabled: !s.enabled } : s
    ))
  }

  const handleAddRepository = () => {
    if (newRepo && newRepo.includes('/')) {
      setSources([...sources, {
        source: 'github',
        enabled: true,
        repositoriesToSearch: [newRepo]
      }])
      setNewRepo('')
    }
  }

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-4">Marketplace Sources</h3>

      {/* Built-in sources */}
      <div className="space-y-3 mb-6">
        {['skills.sh', 'local'].map(source => (
          <div key={source} className="flex items-center gap-3 p-3 border rounded">
            <Checkbox
              checked={sources.find(s => s.source === source)?.enabled ?? true}
              onCheckedChange={() => handleToggleSource(source)}
            />
            <span className="font-medium capitalize">{source}</span>
          </div>
        ))}
      </div>

      {/* Custom GitHub repositories */}
      <h4 className="font-semibold mb-3">GitHub Repositories</h4>
      <div className="space-y-2 mb-4">
        {sources
          .filter(s => s.source === 'github')
          .map((source, idx) => (
            <div key={idx} className="flex items-center justify-between p-3 border rounded">
              <span className="font-mono text-sm">{source.repositoriesToSearch?.[0]}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSources(sources.filter((_, i) => i !== idx))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
      </div>

      {/* Add custom repository */}
      <div className="flex gap-2">
        <Input
          placeholder="owner/repository"
          value={newRepo}
          onChange={(e) => setNewRepo(e.target.value)}
        />
        <Button onClick={handleAddRepository}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Cache settings */}
      <hr className="my-6" />
      <h4 className="font-semibold mb-3">Cache Settings</h4>
      <div className="flex justify-between items-center p-3 border rounded">
        <span>Clear marketplace cache</span>
        <Button variant="outline" size="sm">
          Clear Cache
        </Button>
      </div>
    </Card>
  )
}
```

---

## Testing Strategy

### Unit Tests

```bash
# Cache layer
bun test packages/shared/src/skills/marketplace-cache.test.ts

# Rate limiter
bun test packages/shared/src/skills/rate-limiter.test.ts

# Deduplicator
bun test packages/shared/src/skills/deduplicator.test.ts

# Content validator
bun test packages/shared/src/skills/content-validator.test.ts
```

### Integration Tests

```bash
# E2E marketplace search
bun test scripts/e2e/skills-marketplace.e2e.cjs

# Test scenarios:
# - Single source search (skills.sh)
# - Multi-source search (skills.sh + GitHub)
# - Rate limit handling
# - Timeout recovery
# - Deduplication
# - Cache hits/misses
```

### Performance Benchmarks

```bash
# Search with 1000 cached results
# Search with 10 concurrent users
# Rate limit header parsing
# Deduplication of 500 skills
```

---

## Rollout Plan

### Beta Release (Internal)
1. Phase 1 + cache layer
2. Test with internal team
3. Monitor cache hit rates

### Public Release 1.0
1. Phase 1 + Phase 2
2. skills.sh + GitHub (anthropics/skills only)
3. Gradual rollout to 10% of users

### Public Release 1.1
1. Phase 3 (security)
2. Content validation
3. Rollout to 50% of users

### Public Release 2.0
1. Phase 4 (UI)
2. Settings for source control
3. Full public release

---

## Deployment Checklist

- [ ] All tests passing
- [ ] Cache layer persisting correctly
- [ ] Rate limit headers read correctly
- [ ] Deduplication working for known duplicates
- [ ] Content validation catching malicious patterns
- [ ] UI displays source badges correctly
- [ ] Settings persist across restarts
- [ ] Performance benchmarks within targets
- [ ] No regression in existing marketplace functionality
- [ ] Documentation updated
- [ ] Release notes prepared

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Search latency (cached) | <200ms | P95 response time |
| Search latency (uncached) | <3s | P95 response time |
| Cache hit rate | >70% | Percentage of searches from cache |
| Rate limit incidents | 0 | Monthly count |
| Deduplication accuracy | >95% | Manual audit of results |
| Security issues from third-party skills | 0 | Reported incidents |
| User satisfaction | >4.5/5 | In-app rating |
