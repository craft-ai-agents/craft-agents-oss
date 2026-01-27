/**
 * GallerySkillDetailPage
 *
 * Detail view for a skill from the skills.sh gallery.
 * Fetches SKILL.md from GitHub, parses frontmatter for metadata,
 * and renders instructions using the SkillGallery_* component system.
 *
 * Accessed via: skills/gallery-skill/{owner}/{repo}/{skillId}
 */

import * as React from 'react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Download, Check, Loader2, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { useAtomValue } from 'jotai'
import { skillsAtom } from '@/atoms/skills'
// Navigation imports available if back-navigation is needed in the future
// import { routes, navigate } from '@/lib/navigate'
import {
  SkillGallery_Page,
  SkillGallery_Section,
  SkillGallery_Table,
  SkillGallery_Markdown,
} from './skill-gallery/components'

// ============================================================
// Types & Props
// ============================================================

interface GallerySkillDetailPageProps {
  skillId: string
  topSource: string
  workspaceId: string
}

/** Parsed SKILL.md frontmatter fields */
interface SkillFrontmatter {
  name?: string
  description?: string
  globs?: string[]
  alwaysAllow?: string[]
}

// ============================================================
// Frontmatter Parsing
// ============================================================

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Uses a simple regex approach — no heavy YAML library needed
 * for the handful of fields we extract.
 *
 * Returns { frontmatter, body } where body is the markdown after the `---` block.
 */
function parseSkillMd(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) {
    return { frontmatter: {}, body: content }
  }

  const yamlBlock = match[1]
  const body = match[2]
  const frontmatter: SkillFrontmatter = {}

  // Parse simple key: value pairs from YAML
  for (const line of yamlBlock.split('\n')) {
    const trimmed = line.trim()

    // Skip array items (handled below) and empty lines
    if (trimmed.startsWith('-') || !trimmed) continue

    const colonIdx = trimmed.indexOf(':')
    if (colonIdx === -1) continue

    const key = trimmed.slice(0, colonIdx).trim()
    const value = trimmed.slice(colonIdx + 1).trim()

    if (key === 'name') {
      frontmatter.name = value.replace(/^["']|["']$/g, '')
    } else if (key === 'description') {
      frontmatter.description = value.replace(/^["']|["']$/g, '')
    }
  }

  // Parse array fields (globs, alwaysAllow) — look for YAML list items under each key
  const parseYamlArray = (key: string): string[] | undefined => {
    const pattern = new RegExp(`^${key}:\\s*$`, 'm')
    const keyMatch = yamlBlock.match(pattern)
    if (!keyMatch || keyMatch.index === undefined) {
      // Check for inline array: key: ["item1", "item2"]
      const inlinePattern = new RegExp(`^${key}:\\s*\\[(.*)\\]`, 'm')
      const inlineMatch = yamlBlock.match(inlinePattern)
      if (inlineMatch) {
        return inlineMatch[1]
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean)
      }
      return undefined
    }
    // Collect indented list items after the key
    const afterKey = yamlBlock.slice(keyMatch.index + keyMatch[0].length)
    const items: string[] = []
    for (const line of afterKey.split('\n')) {
      const itemMatch = line.match(/^\s+-\s+(.+)/)
      if (itemMatch) {
        items.push(itemMatch[1].trim().replace(/^["']|["']$/g, ''))
      } else if (line.trim() && !line.match(/^\s/)) {
        // Non-indented line = next key, stop collecting
        break
      }
    }
    return items.length > 0 ? items : undefined
  }

  frontmatter.globs = parseYamlArray('globs')
  frontmatter.alwaysAllow = parseYamlArray('alwaysAllow')

  return { frontmatter, body }
}

/**
 * Convert kebab-case skill ID to human-readable title.
 */
function formatSkillName(id: string): string {
  return id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// ============================================================
// Main Component
// ============================================================

export default function GallerySkillDetailPage({
  skillId,
  topSource,
  workspaceId,
}: GallerySkillDetailPageProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rawContent, setRawContent] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)

  // Local skills for "already installed" detection
  const localSkills = useAtomValue(skillsAtom)
  const isInstalled = useMemo(
    () => localSkills.some((s) => s.slug === skillId),
    [localSkills, skillId]
  )

  // Parse SKILL.md into frontmatter + body
  const parsed = useMemo(() => {
    if (!rawContent) return null
    return parseSkillMd(rawContent)
  }, [rawContent])

  const skillName = parsed?.frontmatter.name || formatSkillName(skillId)

  // --------------------------------------------------------
  // Fetch SKILL.md content from GitHub
  // --------------------------------------------------------

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const load = async () => {
      try {
        const content = await window.electronAPI.galleryFetchSkillContent(topSource, skillId)
        if (cancelled) return
        if (content) {
          setRawContent(content)
        } else {
          setError('Could not fetch skill content. The skill may have been removed or the repository is private.')
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to fetch skill content')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [topSource, skillId])

  // --------------------------------------------------------
  // Handlers
  // --------------------------------------------------------

  const handleInstall = useCallback(async () => {
    if (installing || isInstalled) return
    setInstalling(true)
    try {
      await window.electronAPI.galleryInstallSkill(workspaceId, skillId, topSource)
      toast.success('Skill installed', { description: skillName })
    } catch (err) {
      toast.error('Install failed', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setInstalling(false)
    }
  }, [installing, isInstalled, workspaceId, skillId, topSource, skillName])

  const handleOpenOnSkillsSh = useCallback(() => {
    window.electronAPI.openUrl(`https://skills.sh/${topSource}/${skillId}`)
  }, [topSource, skillId])

  // --------------------------------------------------------
  // Render
  // --------------------------------------------------------

  // Install button for the header
  const headerActions = (
    <div className="flex items-center gap-2">
      <button
        onClick={handleOpenOnSkillsSh}
        className="h-7 px-2.5 text-xs font-medium rounded-[6px] text-foreground/50 hover:text-foreground/80 transition-colors flex items-center gap-1.5"
        title="View on skills.sh"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </button>
      {isInstalled ? (
        <span className="flex items-center gap-1 text-xs text-foreground/30 font-medium px-2 h-7">
          <Check className="h-3.5 w-3.5" />
          Installed
        </span>
      ) : (
        <button
          onClick={handleInstall}
          disabled={installing || loading}
          className="h-7 px-3 text-xs font-medium rounded-[6px] bg-foreground/[0.03] shadow-minimal hover:bg-foreground/[0.07] transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {installing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <>
              <Download className="h-3.5 w-3.5" />
              Install
            </>
          )}
        </button>
      )}
    </div>
  )

  return (
    <SkillGallery_Page loading={loading} error={error ?? undefined}>
      <SkillGallery_Page.Header
        title={skillName}
        actions={headerActions}
      />

      {parsed && (
        <SkillGallery_Page.Content>
          {/* Hero: name and description */}
          <SkillGallery_Page.Hero
            title={skillName}
            tagline={parsed.frontmatter.description}
          />

          {/* Metadata section */}
          <SkillGallery_Section title="Metadata">
            <SkillGallery_Table>
              <SkillGallery_Table.Row label="Skill ID" value={skillId} />
              <SkillGallery_Table.Row label="Source">
                <button
                  onClick={() => window.electronAPI.openUrl(`https://github.com/${topSource}`)}
                  className="hover:underline cursor-pointer text-left"
                >
                  {topSource}
                </button>
              </SkillGallery_Table.Row>
              {parsed.frontmatter.globs && parsed.frontmatter.globs.length > 0 && (
                <SkillGallery_Table.Row label="File Globs">
                  <div className="flex flex-wrap gap-1.5">
                    {parsed.frontmatter.globs.map((glob, i) => (
                      <code
                        key={i}
                        className="px-1.5 py-0.5 text-xs bg-foreground/[0.04] rounded-[4px]"
                      >
                        {glob}
                      </code>
                    ))}
                  </div>
                </SkillGallery_Table.Row>
              )}
              {parsed.frontmatter.alwaysAllow && parsed.frontmatter.alwaysAllow.length > 0 && (
                <SkillGallery_Table.Row label="Always Allow">
                  <div className="flex flex-wrap gap-1.5">
                    {parsed.frontmatter.alwaysAllow.map((tool, i) => (
                      <code
                        key={i}
                        className="px-1.5 py-0.5 text-xs bg-foreground/[0.04] rounded-[4px]"
                      >
                        {tool}
                      </code>
                    ))}
                  </div>
                </SkillGallery_Table.Row>
              )}
            </SkillGallery_Table>
          </SkillGallery_Section>

          {/* Instructions section — the markdown body of SKILL.md */}
          {parsed.body.trim() && (
            <SkillGallery_Section title="Instructions">
              <SkillGallery_Markdown maxHeight={540} fullscreen>
                {parsed.body}
              </SkillGallery_Markdown>
            </SkillGallery_Section>
          )}
        </SkillGallery_Page.Content>
      )}
    </SkillGallery_Page>
  )
}
