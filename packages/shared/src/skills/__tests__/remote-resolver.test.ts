import { describe, it, expect, mock, afterEach } from 'bun:test'
import { parseRemoteInput } from '../remote-resolver.ts'

// ── parseRemoteInput ──────────────────────────────────────────────────────────

describe('parseRemoteInput', () => {
  it('owner/repo shorthand → github-repo', () => {
    const result = parseRemoteInput('anthropics/skills')
    expect(result).toEqual({ kind: 'github-repo', owner: 'anthropics', repo: 'skills' })
  })

  it('owner/repo with dots and dashes → github-repo', () => {
    const result = parseRemoteInput('my-org/my.repo')
    expect(result).toEqual({ kind: 'github-repo', owner: 'my-org', repo: 'my.repo' })
  })

  it('full GitHub URL → github-repo', () => {
    const result = parseRemoteInput('https://github.com/owner/repo')
    expect(result).toEqual({ kind: 'github-repo', owner: 'owner', repo: 'repo' })
  })

  it('full GitHub URL with trailing slash → github-repo', () => {
    const result = parseRemoteInput('https://github.com/owner/repo/')
    expect(result).toEqual({ kind: 'github-repo', owner: 'owner', repo: 'repo' })
  })

  it('full GitHub URL with .git suffix → github-repo', () => {
    const result = parseRemoteInput('https://github.com/owner/repo.git')
    expect(result).toEqual({ kind: 'github-repo', owner: 'owner', repo: 'repo' })
  })

  it('GitHub subpath URL → github-subpath', () => {
    const result = parseRemoteInput('https://github.com/owner/repo/tree/main/skills/my-skill')
    expect(result).toEqual({
      kind: 'github-subpath',
      owner: 'owner',
      repo: 'repo',
      ref: 'main',
      subpath: 'skills/my-skill',
    })
  })

  it('GitHub subpath URL with nested path → github-subpath', () => {
    const result = parseRemoteInput('https://github.com/owner/repo/tree/develop/a/b/c')
    expect(result).toEqual({
      kind: 'github-subpath',
      owner: 'owner',
      repo: 'repo',
      ref: 'develop',
      subpath: 'a/b/c',
    })
  })

  it('GitLab URL → gitlab-repo', () => {
    const result = parseRemoteInput('https://gitlab.com/org/repo')
    expect(result).toEqual({ kind: 'gitlab-repo', owner: 'org', repo: 'repo' })
  })

  it('GitLab URL with .git suffix → gitlab-repo', () => {
    const result = parseRemoteInput('https://gitlab.com/org/repo.git')
    expect(result).toEqual({ kind: 'gitlab-repo', owner: 'org', repo: 'repo' })
  })

  it('raw git URL → git-clone', () => {
    const result = parseRemoteInput('https://bitbucket.org/owner/repo.git')
    expect(result).toEqual({ kind: 'git-clone', url: 'https://bitbucket.org/owner/repo.git' })
  })

  it('SSH git remote → git-clone', () => {
    const result = parseRemoteInput('git@github.com:owner/repo.git')
    expect(result).toEqual({ kind: 'git-clone', url: 'git@github.com:owner/repo.git' })
  })

  it('self-hosted URL → git-clone', () => {
    const result = parseRemoteInput('https://git.example.com/owner/repo')
    expect(result).toEqual({ kind: 'git-clone', url: 'https://git.example.com/owner/repo' })
  })
})

// ── resolveRemoteSkills — unit tests with mocked fetch ───────────────────────
//
// These tests use mock.module to replace node:fetch so no real network calls
// are made. Each describe block resets the mock after running.

describe('resolveRemoteSkills — GitHub repo (multi-skill)', () => {
  afterEach(() => {
    mock.restore()
  })

  it('returns multiple DiscoveredSkills when repo has SKILL.md files in subdirs', async () => {
    const { resolveRemoteSkills } = await import('../remote-resolver.ts')

    // Mock fetch to simulate GitHub API returning two skill directories at depth 1
    const originalFetch = globalThis.fetch
    let callCount = 0
    globalThis.fetch = mock(async (url: string) => {
      callCount++
      // Raw SKILL.md content — check raw host first to avoid URL overlap with API URLs
      if (url.includes('raw.githubusercontent.com')) {
        if (url.includes('skill-alpha')) {
          return new Response('---\nname: Alpha Skill\ndescription: First skill\n---\nAlpha body', { status: 200 })
        }
        if (url.includes('skill-beta')) {
          return new Response('---\nname: Beta Skill\ndescription: Second skill\n---\nBeta body', { status: 200 })
        }
        return new Response('Not found', { status: 404 })
      }
      // Root listing — api.github.com URL ending in /contents/
      if (url.includes('api.github.com') && url.endsWith('/contents/')) {
        return new Response(JSON.stringify([
          { name: 'skill-alpha', type: 'dir', path: 'skill-alpha' },
          { name: 'skill-beta', type: 'dir', path: 'skill-beta' },
          { name: 'README.md', type: 'file', path: 'README.md' },
        ]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      // Subdirectory listings
      if (url.includes('api.github.com') && url.includes('/skill-alpha')) {
        return new Response(JSON.stringify([
          {
            name: 'SKILL.md',
            type: 'file',
            path: 'skill-alpha/SKILL.md',
            download_url: 'https://raw.githubusercontent.com/owner/repo/main/skill-alpha/SKILL.md',
          },
        ]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('api.github.com') && url.includes('/skill-beta')) {
        return new Response(JSON.stringify([
          {
            name: 'SKILL.md',
            type: 'file',
            path: 'skill-beta/SKILL.md',
            download_url: 'https://raw.githubusercontent.com/owner/repo/main/skill-beta/SKILL.md',
          },
        ]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    }) as unknown as typeof fetch

    try {
      const result = await resolveRemoteSkills('owner/repo')
      expect(Array.isArray(result)).toBe(true)
      const skills = result as import('../types.ts').DiscoveredSkill[]
      expect(skills.length).toBe(2)
      const slugs = skills.map(s => s.slug).sort()
      expect(slugs).toEqual(['skill-alpha', 'skill-beta'])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('resolveRemoteSkills — GitHub repo depth cap', () => {
  afterEach(() => {
    mock.restore()
  })

  it('does not discover SKILL.md deeper than 2 directory levels', async () => {
    const { resolveRemoteSkills } = await import('../remote-resolver.ts')

    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async (url: string) => {
      // Root: one dir at depth 1
      if (url.endsWith('/contents/')) {
        return new Response(JSON.stringify([
          { name: 'outer', type: 'dir', path: 'outer' },
        ]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      // depth-1 dir contains another dir (no SKILL.md yet)
      if (url.includes('/outer') && !url.includes('/outer/inner')) {
        return new Response(JSON.stringify([
          { name: 'inner', type: 'dir', path: 'outer/inner' },
        ]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      // depth-2 dir contains another dir (depth 3 — not scanned)
      if (url.includes('/outer/inner')) {
        return new Response(JSON.stringify([
          { name: 'deep', type: 'dir', path: 'outer/inner/deep' },
          // No SKILL.md here either
        ]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('[]', { status: 200 })
    }) as unknown as typeof fetch

    try {
      const result = await resolveRemoteSkills('owner/repo')
      expect(Array.isArray(result)).toBe(true)
      expect((result as import('../types.ts').DiscoveredSkill[]).length).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('resolveRemoteSkills — API 404 error shape', () => {
  afterEach(() => {
    mock.restore()
  })

  it('returns structured error on 404', async () => {
    const { resolveRemoteSkills } = await import('../remote-resolver.ts')

    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async (_url: string) => {
      return new Response('Not Found', { status: 404 })
    }) as unknown as typeof fetch

    try {
      const result = await resolveRemoteSkills('owner/private-repo')
      expect('error' in result).toBe(true)
      expect((result as { error: string }).error).toContain('not accessible')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns structured error on 403', async () => {
    const { resolveRemoteSkills } = await import('../remote-resolver.ts')

    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async (_url: string) => {
      return new Response('Forbidden', { status: 403 })
    }) as unknown as typeof fetch

    try {
      const result = await resolveRemoteSkills('owner/private-repo')
      expect('error' in result).toBe(true)
      expect((result as { error: string }).error).toContain('not accessible')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('resolveRemoteSkills — GitHub subpath (single skill)', () => {
  afterEach(() => {
    mock.restore()
  })

  it('returns single DiscoveredSkill for a direct subpath URL', async () => {
    const { resolveRemoteSkills } = await import('../remote-resolver.ts')

    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async (url: string) => {
      if (url.includes('SKILL.md')) {
        return new Response(
          '---\nname: My Skill\ndescription: A skill from subpath\n---\nBody here',
          { status: 200 }
        )
      }
      return new Response('Not found', { status: 404 })
    }) as unknown as typeof fetch

    try {
      const result = await resolveRemoteSkills(
        'https://github.com/owner/repo/tree/main/skills/my-skill'
      )
      expect(Array.isArray(result)).toBe(true)
      const skills = result as import('../types.ts').DiscoveredSkill[]
      expect(skills.length).toBe(1)
      expect(skills[0]!.slug).toBe('my-skill')
      expect(skills[0]!.metadata.name).toBe('My Skill')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
