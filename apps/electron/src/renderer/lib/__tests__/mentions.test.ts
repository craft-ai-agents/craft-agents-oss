/**
 * Tests for mentions.ts skill pattern parsing
 *
 * These tests verify that skill mentions with various workspace ID formats
 * are correctly parsed, including workspace IDs containing:
 * - Whitespace (spaces)
 * - Hyphens (-)
 * - Underscores (_)
 * - Dots (.)
 */
import { describe, it, expect } from 'bun:test'
import { parseMentions, findMentionMatches, removeMention, stripAllMentions, resolveSkillMentions, resolveSourceMentions, resolveKnowledgeMentions, formatKnowledgeBadgeLabel, serializeKnowledgeRef, DEFAULT_KNOWLEDGE_PROVIDER, extractBadges } from '../mentions'

// ============================================================================
// parseMentions - Skill Pattern Tests
// ============================================================================

describe('parseMentions - skill pattern with workspace IDs', () => {
  const availableSkills = ['commit', 'review-pr', 'my_skill', 'skill.name']

  describe('simple skill mentions [skill:slug]', () => {
    it('parses skill with hyphen in slug', () => {
      const result = parseMentions('[skill:review-pr]', availableSkills, [])
      expect(result.skills).toEqual(['review-pr'])
    })

    it('parses skill with underscore in slug', () => {
      const result = parseMentions('[skill:my_skill]', availableSkills, [])
      expect(result.skills).toEqual(['my_skill'])
    })

    it('parses multiple skills', () => {
      const result = parseMentions('[skill:commit] and [skill:review-pr]', availableSkills, [])
      expect(result.skills).toEqual(['commit', 'review-pr'])
    })
  })

  describe('skill mentions with workspace ID [skill:workspaceId:slug]', () => {
    it('parses skill with simple workspace ID', () => {
      const result = parseMentions('[skill:MyWorkspace:commit]', availableSkills, [])
      expect(result.skills).toEqual(['commit'])
    })

    it('parses skill with workspace ID containing space', () => {
      const result = parseMentions('[skill:My Workspace:commit]', availableSkills, [])
      expect(result.skills).toEqual(['commit'])
    })

    it('parses skill with workspace ID containing multiple spaces', () => {
      const result = parseMentions('[skill:My Cool Workspace:commit]', availableSkills, [])
      expect(result.skills).toEqual(['commit'])
    })

    it('parses skill with workspace ID containing hyphen', () => {
      const result = parseMentions('[skill:my-workspace:commit]', availableSkills, [])
      expect(result.skills).toEqual(['commit'])
    })

    it('parses skill with workspace ID containing underscore', () => {
      const result = parseMentions('[skill:my_workspace:commit]', availableSkills, [])
      expect(result.skills).toEqual(['commit'])
    })

    it('parses skill with workspace ID containing dot', () => {
      const result = parseMentions('[skill:my.workspace:commit]', availableSkills, [])
      expect(result.skills).toEqual(['commit'])
    })

    it('parses skill with workspace ID containing mixed special chars', () => {
      const result = parseMentions('[skill:My-Cool_Workspace:commit]', availableSkills, [])
      expect(result.skills).toEqual(['commit'])
    })

    it('parses skill with workspace ID containing spaces and hyphens', () => {
      const result = parseMentions('[skill:My Cool-Workspace:review-pr]', availableSkills, [])
      expect(result.skills).toEqual(['review-pr'])
    })
  })

  describe('edge cases', () => {
    it('returns empty array for non-existent skill', () => {
      const result = parseMentions('[skill:nonexistent]', availableSkills, [])
      expect(result.skills).toEqual([])
    })

    it('does not duplicate skills when mentioned multiple times', () => {
      const result = parseMentions('[skill:commit] [skill:commit]', availableSkills, [])
      expect(result.skills).toEqual(['commit'])
    })

    it('parses skills in text with other content', () => {
      const result = parseMentions('Please run [skill:commit] after fixing the bug', availableSkills, [])
      expect(result.skills).toEqual(['commit'])
    })
  })
})

// ============================================================================
// findMentionMatches - Skill Pattern Tests
// ============================================================================

describe('findMentionMatches - skill pattern with workspace IDs', () => {
  const availableSkills = ['commit', 'review-pr']

  it('finds skill with workspace ID containing space', () => {
    const matches = findMentionMatches('[skill:My Workspace:commit]', availableSkills, [])
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      type: 'skill',
      id: 'commit',
      fullMatch: '[skill:My Workspace:commit]',
    })
  })

  it('finds skill with workspace ID containing hyphen', () => {
    const matches = findMentionMatches('[skill:my-workspace:review-pr]', availableSkills, [])
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      type: 'skill',
      id: 'review-pr',
      fullMatch: '[skill:my-workspace:review-pr]',
    })
  })

  it('finds skill with workspace ID containing dot', () => {
    const matches = findMentionMatches('[skill:my.workspace:commit]', availableSkills, [])
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      type: 'skill',
      id: 'commit',
      fullMatch: '[skill:my.workspace:commit]',
    })
  })

  it('returns correct start index', () => {
    const text = 'Please use [skill:My Workspace:commit] for this'
    const matches = findMentionMatches(text, availableSkills, [])
    expect(matches[0]?.startIndex).toBe(11)
  })
})

// ============================================================================
// removeMention - Skill Pattern Tests
// ============================================================================

describe('removeMention - skill pattern with workspace IDs', () => {
  it('removes skill with workspace ID containing space', () => {
    const result = removeMention('[skill:My Workspace:commit] please', 'skill', 'commit')
    expect(result).toBe('please')
  })

  it('removes skill with workspace ID containing hyphen', () => {
    const result = removeMention('[skill:my-workspace:commit] please', 'skill', 'commit')
    expect(result).toBe('please')
  })

  it('removes skill with workspace ID containing underscore', () => {
    const result = removeMention('[skill:my_workspace:commit] please', 'skill', 'commit')
    expect(result).toBe('please')
  })

  it('removes skill with workspace ID containing dot', () => {
    const result = removeMention('[skill:my.workspace:commit] please', 'skill', 'commit')
    expect(result).toBe('please')
  })

  it('removes simple skill mention', () => {
    const result = removeMention('[skill:commit] please', 'skill', 'commit')
    expect(result).toBe('please')
  })
})

// ============================================================================
// removeMention - Knowledge Pattern Tests (P3-16)
// ============================================================================

describe('removeMention - knowledge tokens', () => {
  it('removes the picker-inserted full-form token', () => {
    const result = removeMention('see [knowledge:siyuan/block/b-1] please', 'knowledge', 'siyuan/block/b-1')
    expect(result).toBe('see please')
  })

  it('removes the hand-typed compact token (provider segment omitted)', () => {
    const result = removeMention('see [knowledge:block/b-1] please', 'knowledge', 'siyuan/block/b-1')
    expect(result).toBe('see please')
  })

  it('removes compact and full spellings of the same ref together', () => {
    const result = removeMention('[knowledge:block/b-1] and [knowledge:siyuan/block/b-1]', 'knowledge', 'siyuan/block/b-1')
    expect(result).toBe('and')
  })

  it('removes a non-default-provider token by its full form', () => {
    const result = removeMention('see [knowledge:yuan/block/b-1] please', 'knowledge', 'yuan/block/b-1')
    expect(result).toBe('see please')
  })

  it('does not remove a compact default-provider token when a non-default provider badge is removed', () => {
    const result = removeMention('[knowledge:block/b-1] stays', 'knowledge', 'yuan/block/b-1')
    expect(result).toBe('[knowledge:block/b-1] stays')
  })

  it('does not remove a different block that extends the id', () => {
    const result = removeMention('[knowledge:block/b-12]', 'knowledge', 'siyuan/block/b-1')
    expect(result).toBe('[knowledge:block/b-12]')
  })
})

// ============================================================================
// stripAllMentions - Replaces mentions with slugs
// ============================================================================

describe('stripAllMentions - replaces skill mentions with slugs', () => {
  it('replaces skill with workspace ID containing space', () => {
    const result = stripAllMentions('[skill:My Workspace:commit] do this')
    expect(result).toBe('commit do this')
  })

  it('replaces skill with workspace ID containing hyphen', () => {
    const result = stripAllMentions('[skill:my-workspace:commit] do this')
    expect(result).toBe('commit do this')
  })

  it('replaces skill with workspace ID containing underscore', () => {
    const result = stripAllMentions('[skill:my_workspace:commit] do this')
    expect(result).toBe('commit do this')
  })

  it('replaces skill with workspace ID containing dot', () => {
    const result = stripAllMentions('[skill:my.workspace:commit] do this')
    expect(result).toBe('commit do this')
  })

  it('replaces multiple skills with different workspace ID formats', () => {
    const result = stripAllMentions('[skill:My Workspace:commit] and [skill:my-workspace:review]')
    expect(result).toBe('commit and review')
  })

  it('replaces source mentions with slug', () => {
    const result = stripAllMentions('[source:github] check this')
    expect(result).toBe('github check this')
  })
})

// ============================================================================
// resolveSkillMentions - Semantic marker tests
// ============================================================================

describe('resolveSkillMentions', () => {
  const skillNames = new Map([
    ['commit', 'Git Commit'],
    ['review-pr', 'Review PR'],
  ])

  it('resolves simple skill mention with display name', () => {
    const result = resolveSkillMentions('[skill:commit] do this', skillNames)
    expect(result).toBe('[Mentioned skill: Git Commit (slug: commit)] do this')
  })

  it('resolves skill with workspace ID', () => {
    const result = resolveSkillMentions('[skill:My Workspace:commit] do this', skillNames)
    expect(result).toBe('[Mentioned skill: Git Commit (slug: commit)] do this')
  })

  it('falls back to slug when not in map', () => {
    const result = resolveSkillMentions('[skill:unknown-skill] do this', skillNames)
    expect(result).toBe('[Mentioned skill: unknown-skill (slug: unknown-skill)] do this')
  })

  it('preserves sentence structure', () => {
    const result = resolveSkillMentions('find the root cause in [skill:review-pr]', skillNames)
    expect(result).toBe('find the root cause in [Mentioned skill: Review PR (slug: review-pr)]')
  })

  it('resolves multiple skill mentions', () => {
    const result = resolveSkillMentions('[skill:commit] and [skill:review-pr]', skillNames)
    expect(result).toBe('[Mentioned skill: Git Commit (slug: commit)] and [Mentioned skill: Review PR (slug: review-pr)]')
  })

  it('leaves text without mentions unchanged', () => {
    const result = resolveSkillMentions('no mentions here', skillNames)
    expect(result).toBe('no mentions here')
  })
})

// ============================================================================
// resolveSourceMentions - Semantic marker tests
// ============================================================================

describe('resolveSourceMentions', () => {
  it('resolves source mention to semantic marker', () => {
    const result = resolveSourceMentions('[source:github] check this')
    expect(result).toBe('[Mentioned source: github] check this')
  })

  it('preserves sentence structure', () => {
    const result = resolveSourceMentions('check my emails in [source:gmail]')
    expect(result).toBe('check my emails in [Mentioned source: gmail]')
  })

  it('resolves multiple source mentions', () => {
    const result = resolveSourceMentions('[source:github] and [source:linear]')
    expect(result).toBe('[Mentioned source: github] and [Mentioned source: linear]')
  })

  it('leaves text without mentions unchanged', () => {
    const result = resolveSourceMentions('no mentions here')
    expect(result).toBe('no mentions here')
  })
})

// ============================================================================
// extractBadges - Skill Qualification Tests
// ============================================================================

describe('extractBadges - skill qualification with workspace slug', () => {
  const mockSkills = [
    { slug: 'commit', metadata: { name: 'Commit' }, source: 'workspace' },
    { slug: 'review-pr', metadata: { name: 'Review PR' }, source: 'workspace' },
  ] as any[]
  const mockSources = [] as any[]

  it('qualifies skill rawText with workspace slug (not UUID)', () => {
    const badges = extractBadges('[skill:commit]', mockSkills, mockSources, 'my-project')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.rawText).toBe('[skill:my-project:commit]')
    expect(badges[0]!.label).toBe('Commit')
    expect(badges[0]!.type).toBe('skill')
  })

  it('qualifies skill rawText preserving slug with hyphens', () => {
    const badges = extractBadges('[skill:review-pr]', mockSkills, mockSources, 'my-workspace')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.rawText).toBe('[skill:my-workspace:review-pr]')
    expect(badges[0]!.label).toBe('Review PR')
  })

  it('does not re-qualify already qualified skill mentions', () => {
    // When message already has workspace:slug format, rawText should still be workspace:slug
    const badges = extractBadges('[skill:other-ws:commit]', mockSkills, mockSources, 'my-project')
    expect(badges).toHaveLength(1)
    // extractBadges always overwrites rawText for skills with the provided workspaceId
    expect(badges[0]!.rawText).toBe('[skill:my-project:commit]')
  })

  it('does not modify source rawText', () => {
    const sources = [{ config: { slug: 'linear', name: 'Linear' } }] as any[]
    const badges = extractBadges('[source:linear]', [], sources, 'my-project')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.rawText).toBe('[source:linear]')
    expect(badges[0]!.type).toBe('source')
  })
})

// ============================================================================
// extractBadges - Knowledge Mentions (spec K-03 §3.5.2)
// ============================================================================

describe('extractBadges - knowledge mentions', () => {
  it('extracts a knowledge badge for the full-form token', () => {
    const badges = extractBadges('[knowledge:siyuan/block/20240101120000-abcde]', [], [], 'my-project')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.type).toBe('knowledge')
    // Long SiYuan id shortens to its random suffix
    expect(badges[0]!.label).toBe('@siyuan/block/abcde')
    expect(badges[0]!.rawText).toBe('[knowledge:siyuan/block/20240101120000-abcde]')
    expect(badges[0]!.iconDataUrl).toBeUndefined()
  })

  it('extracts a knowledge badge for the compact form (default provider)', () => {
    const badges = extractBadges('[knowledge:document/my-doc-id]', [], [], 'my-project')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.type).toBe('knowledge')
    // Short id (<=12 chars) passes through unchanged
    expect(badges[0]!.label).toBe('@siyuan/document/my-doc-id')
  })

  it('preserves a non-default provider in the label', () => {
    const badges = extractBadges('[knowledge:obsidian/notebook/nb-1]', [], [], 'my-project')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.label).toBe('@obsidian/notebook/nb-1')
  })

  it('truncates long ids without a hyphen to 12 chars', () => {
    const badges = extractBadges('[knowledge:siyuan/asset/abcdefghijklmnop.png]', [], [], 'my-project')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.label).toBe('@siyuan/asset/abcdefghijkl')
  })

  it('coexists with file/folder badges in one message', () => {
    const text = '[file:src/index.ts] then [knowledge:block/abc] and [folder:docs]'
    const badges = extractBadges(text, [], [], 'my-project')
    expect(badges).toHaveLength(3)
    expect(badges.map(b => b.type)).toEqual(['file', 'knowledge', 'folder'])
    expect(badges[1]!.label).toBe('@siyuan/block/abc')
    expect(text.slice(badges[1]!.start, badges[1]!.end)).toBe('[knowledge:block/abc]')
  })

  it('round-trips: picker token → badge keeps the original token as rawText', () => {
    const token = '[knowledge:siyuan/block/20240101120000-abcde]'
    const badges = extractBadges(`look at ${token} please`, [], [], 'ws')
    expect(badges).toHaveLength(1)
    const badge = badges[0]!
    // rawText is the original token; start/end span exactly it
    expect(badge.rawText).toBe(token)
    expect(`look at ${token} please`.slice(badge.start, badge.end)).toBe(token)
  })
})

// ============================================================================
// parseMentions - Knowledge Grammar (spec K-03 §3.1/§3.5.2)
// ============================================================================

describe('parseMentions - knowledge grammar', () => {
  it('parses the full-form token into a serialized provider ref', () => {
    const result = parseMentions('[knowledge:siyuan/block/20240101120000-abcde]', [], [])
    expect(result.knowledge).toEqual(['siyuan/block/20240101120000-abcde'])
  })

  it('serializes the compact form to the default provider', () => {
    const result = parseMentions('[knowledge:block/20240101120000-abcde]', [], [])
    expect(result.knowledge).toEqual([`${DEFAULT_KNOWLEDGE_PROVIDER}/block/20240101120000-abcde`])
  })

  it('supports every kind in the grammar union', () => {
    for (const kind of ['notebook', 'document', 'block', 'database', 'asset'] as const) {
      const result = parseMentions(`[knowledge:${kind}/id-1]`, [], [])
      expect(result.knowledge).toEqual([`siyuan/${kind}/id-1`])
    }
  })

  it('preserves a non-default provider in the serialized ref', () => {
    const result = parseMentions('[knowledge:obsidian/notebook/nb-1]', [], [])
    expect(result.knowledge).toEqual(['obsidian/notebook/nb-1'])
  })

  it('serializes via serializeKnowledgeRef for both forms', () => {
    expect(serializeKnowledgeRef('siyuan', 'block', 'b-1')).toBe('siyuan/block/b-1')
    expect(serializeKnowledgeRef(undefined, 'block', 'b-1')).toBe(`siyuan/block/b-1`)
    expect(serializeKnowledgeRef('obsidian', 'notebook', 'n-1')).toBe('obsidian/notebook/n-1')
  })

  it('deduplicates repeated tokens', () => {
    const result = parseMentions('[knowledge:block/a] [knowledge:block/a]', [], [])
    expect(result.knowledge).toEqual(['siyuan/block/a'])
  })

  it('rejects tokens outside the grammar (unknown kind, uppercase provider)', () => {
    expect(parseMentions('[knowledge:note/x]', [], []).knowledge).toEqual([])
    expect(parseMentions('[knowledge:Page/x]', [], []).knowledge).toEqual([])
    expect(parseMentions('[knowledge:SiYuan/block/x]', [], []).knowledge).toEqual([])
    expect(parseMentions('[knowledge:block/]', [], []).knowledge).toEqual([])
  })

  it('parses repeated calls identically (no global-regex lastIndex leakage)', () => {
    const first = parseMentions('[knowledge:block/a]', [], [])
    const second = parseMentions('[knowledge:block/a]', [], [])
    expect(first.knowledge).toEqual(['siyuan/block/a'])
    expect(second.knowledge).toEqual(['siyuan/block/a'])
  })

  it('is isolated from skill, source, file, and folder buckets', () => {
    const result = parseMentions(
      '[skill:commit] [source:linear] [file:src/a.ts] [folder:docs] [knowledge:block/x]',
      ['commit'],
      ['linear'],
    )
    expect(result.skills).toEqual(['commit'])
    expect(result.sources).toEqual(['linear'])
    expect(result.files).toEqual(['src/a.ts'])
    expect(result.folders).toEqual(['docs'])
    expect(result.knowledge).toEqual(['siyuan/block/x'])
    // …and the inverse: a knowledge token leaks nothing into the other buckets
    const only = parseMentions('[knowledge:block/x]', ['commit'], ['linear'])
    expect(only.skills).toEqual([])
    expect(only.sources).toEqual([])
    expect(only.files).toEqual([])
    expect(only.folders).toEqual([])
    expect(only.knowledge).toEqual(['siyuan/block/x'])
  })

  it('round-trips: token → serialized ref → badge label (compact form)', () => {
    // The contract between the mention picker token and all three consumers.
    const token = '[knowledge:block/20240101120000-abcde]'
    const parsed = parseMentions(token, [], [])
    const serialized = parsed.knowledge[0]!
    expect(serialized).toBe('siyuan/block/20240101120000-abcde')
    // Serialized ref feeds the badge label used by UserMessageBubble/rich-text-input chips
    expect(formatKnowledgeBadgeLabel(serialized)).toBe('@siyuan/block/abcde')
    // …and matches the badge extractBadges produces from the raw token
    const badges = extractBadges(token, [], [], 'ws')
    expect(badges[0]!.label).toBe(formatKnowledgeBadgeLabel(serialized))
    expect(badges[0]!.type).toBe('knowledge')
  })
})

// ============================================================================
// stripAllMentions - Knowledge (legacy strip path)
// ============================================================================

describe('stripAllMentions - knowledge mentions', () => {
  it('replaces the token with the serialized provider ref', () => {
    expect(stripAllMentions('see [knowledge:block/abc] now')).toBe('see siyuan/block/abc now')
    expect(stripAllMentions('see [knowledge:siyuan/block/abc] now')).toBe('see siyuan/block/abc now')
  })
})

// ============================================================================
// resolveKnowledgeMentions - Semantic marker tests (spec K-03 §3.5.2)
// ============================================================================

describe('resolveKnowledgeMentions', () => {
  it('resolves the full-form token to the [Knowledge: <kind> <id>] marker', () => {
    const result = resolveKnowledgeMentions('read [knowledge:siyuan/block/20240101120000-abcde] please')
    expect(result).toBe('read [Knowledge: block 20240101120000-abcde] please')
  })

  it('resolves the compact form identically (marker drops the provider)', () => {
    const result = resolveKnowledgeMentions('[knowledge:document/my-doc]')
    expect(result).toBe('[Knowledge: document my-doc]')
  })

  it('leaves every other mention type untouched', () => {
    const text = '[skill:commit] [source:linear] [file:src/a.ts] [folder:docs]'
    expect(resolveKnowledgeMentions(text)).toBe(text)
  })

  it('leaves out-of-grammar tokens and plain text untouched', () => {
    expect(resolveKnowledgeMentions('[knowledge:note/x]')).toBe('[knowledge:note/x]')
    expect(resolveKnowledgeMentions('plain text, no mentions')).toBe('plain text, no mentions')
  })

  it('composes with the other resolvers on a mixed message', () => {
    const skillNames = new Map([['commit', 'Git Commit']])
    const resolved = resolveKnowledgeMentions(
      resolveSourceMentions(
        resolveSkillMentions('[skill:commit] [source:github] [knowledge:block/x]', skillNames),
      ),
    )
    expect(resolved).toBe(
      '[Mentioned skill: Git Commit (slug: commit)] [Mentioned source: github] [Knowledge: block x]',
    )
  })
})
