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
// These tests replace globalThis.fetch directly and restore it in try/finally.
// Each describe block calls mock.restore() in afterEach for module-level mocks.

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

  it('discovers Vercel-style skills under a skills directory at depth 2', async () => {
    const { resolveRemoteSkills } = await import('../remote-resolver.ts')

    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async (url: string) => {
      if (url.includes('raw.githubusercontent.com')) {
        if (url.includes('nextjs')) {
          return new Response(
            '---\nname: Next.js\ndescription: Build Next.js apps\n---\nNext.js body',
            { status: 200 }
          )
        }
        if (url.includes('sveltekit')) {
          return new Response(
            '---\nname: SvelteKit\ndescription: Build SvelteKit apps\n---\nSvelteKit body',
            { status: 200 }
          )
        }
        return new Response('Not found', { status: 404 })
      }

      if (url.endsWith('/contents/')) {
        return new Response(JSON.stringify([
          { name: 'skills', type: 'dir', path: 'skills' },
        ]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/contents/skills/nextjs')) {
        return new Response(JSON.stringify([
          {
            name: 'SKILL.md',
            type: 'file',
            path: 'skills/nextjs/SKILL.md',
            download_url:
              'https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/nextjs/SKILL.md',
          },
        ]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/contents/skills/sveltekit')) {
        return new Response(JSON.stringify([
          {
            name: 'SKILL.md',
            type: 'file',
            path: 'skills/sveltekit/SKILL.md',
            download_url:
              'https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/sveltekit/SKILL.md',
          },
        ]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/contents/skills')) {
        return new Response(JSON.stringify([
          { name: 'nextjs', type: 'dir', path: 'skills/nextjs' },
          { name: 'sveltekit', type: 'dir', path: 'skills/sveltekit' },
        ]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    }) as unknown as typeof fetch

    try {
      const result = await resolveRemoteSkills('vercel-labs/agent-skills')
      expect(Array.isArray(result)).toBe(true)
      const skills = result as import('../types.ts').DiscoveredSkill[]
      expect(skills).toHaveLength(2)
      expect(skills.map(s => s.slug).sort()).toEqual(['nextjs', 'sveltekit'])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('discovers skills grouped by category at depth 3', async () => {
    const { resolveRemoteSkills } = await import('../remote-resolver.ts')

    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async (url: string) => {
      if (url.includes('raw.githubusercontent.com')) {
        if (url.includes('diagnose')) {
          return new Response(
            '---\nname: Diagnose\ndescription: Debug hard bugs\n---\nDiagnose body',
            { status: 200 }
          )
        }
        return new Response('Not found', { status: 404 })
      }

      if (url.endsWith('/contents/')) {
        return new Response(JSON.stringify([
          { name: 'skills', type: 'dir', path: 'skills' },
          { name: 'README.md', type: 'file', path: 'README.md' },
        ]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/contents/skills/engineering/diagnose')) {
        return new Response(JSON.stringify([
          {
            name: 'SKILL.md',
            type: 'file',
            path: 'skills/engineering/diagnose/SKILL.md',
            download_url:
              'https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/diagnose/SKILL.md',
          },
        ]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/contents/skills/engineering')) {
        return new Response(JSON.stringify([
          { name: 'diagnose', type: 'dir', path: 'skills/engineering/diagnose' },
        ]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/contents/skills')) {
        return new Response(JSON.stringify([
          { name: 'engineering', type: 'dir', path: 'skills/engineering' },
        ]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    }) as unknown as typeof fetch

    try {
      const result = await resolveRemoteSkills('mattpocock/skills')
      expect(Array.isArray(result)).toBe(true)
      const skills = result as import('../types.ts').DiscoveredSkill[]
      expect(skills).toHaveLength(1)
      expect(skills[0]!.slug).toBe('diagnose')
      expect(skills[0]!.metadata.name).toBe('Diagnose')
      expect(skills[0]!.sourcePath).toBe(
        'https://github.com/mattpocock/skills/tree/HEAD/skills/engineering/diagnose'
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('does not discover SKILL.md deeper than 3 directory levels', async () => {
    const { resolveRemoteSkills } = await import('../remote-resolver.ts')

    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async (url: string) => {
      if (url.endsWith('/contents/')) {
        return new Response(JSON.stringify([
          { name: 'outer', type: 'dir', path: 'outer' },
        ]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/outer/inner/deep/too-deep')) {
        return new Response(JSON.stringify([
          {
            name: 'SKILL.md',
            type: 'file',
            path: 'outer/inner/deep/too-deep/SKILL.md',
            download_url:
              'https://raw.githubusercontent.com/owner/repo/main/outer/inner/deep/too-deep/SKILL.md',
          },
        ]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/outer/inner/deep')) {
        return new Response(JSON.stringify([
          { name: 'too-deep', type: 'dir', path: 'outer/inner/deep/too-deep' },
        ]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/outer/inner')) {
        return new Response(JSON.stringify([
          { name: 'deep', type: 'dir', path: 'outer/inner/deep' },
        ]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/outer')) {
        return new Response(JSON.stringify([
          { name: 'inner', type: 'dir', path: 'outer/inner' },
        ]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('raw.githubusercontent.com')) {
        return new Response(
          '---\nname: Too Deep\ndescription: Should not be found\n---\nToo deep body',
          { status: 200 }
        )
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
