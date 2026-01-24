/**
 * MarketplaceSkillInfoPage
 *
 * Displays marketplace skill details fetched from SKILL.md on GitHub.
 * Uses the Info_ component system for consistent styling with SkillInfoPage.
 */

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { Download, Loader2, ExternalLink, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_Markdown,
} from '@/components/info'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

interface MarketplaceSkillInfoPageProps {
  source: string  // "owner/repo" format
  skillId: string
  onInstalled?: () => void
}

interface SkillMetadata {
  name?: string
  description?: string
  version?: string
  author?: string
  tags?: string[]
}

export default function MarketplaceSkillInfoPage({
  source,
  skillId,
  onInstalled,
}: MarketplaceSkillInfoPageProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<SkillMetadata>({})
  const [installing, setInstalling] = useState(false)

  // Parse YAML frontmatter from SKILL.md content
  const parseFrontmatter = (content: string): { metadata: SkillMetadata; body: string } => {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    if (!frontmatterMatch) {
      return { metadata: {}, body: content }
    }

    const [, frontmatter, body] = frontmatterMatch
    const metadata: SkillMetadata = {}

    // Simple YAML parsing for common fields
    const lines = frontmatter.split('\n')
    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.*)$/)
      if (match) {
        const [, key, value] = match
        if (key === 'name') metadata.name = value.replace(/^["']|["']$/g, '')
        if (key === 'description') metadata.description = value.replace(/^["']|["']$/g, '')
        if (key === 'version') metadata.version = value.replace(/^["']|["']$/g, '')
        if (key === 'author') metadata.author = value.replace(/^["']|["']$/g, '')
      }
    }

    return { metadata, body }
  }

  // Load skill content
  useEffect(() => {
    let isMounted = true
    setLoading(true)
    setError(null)

    const loadSkill = async () => {
      try {
        const result = await window.electronAPI.marketplaceGetSkillDetails(source, skillId)

        if (!isMounted) return

        if (result.success && result.content) {
          const { metadata: parsed, body } = parseFrontmatter(result.content)
          setMetadata({
            ...parsed,
            name: parsed.name || skillId,
          })
          setContent(body)
        } else {
          setError(result.error || 'Failed to load skill details')
        }
      } catch (err) {
        if (!isMounted) return
        setError(err instanceof Error ? err.message : 'Failed to load skill')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadSkill()

    return () => {
      isMounted = false
    }
  }, [source, skillId])

  // Handle install
  const handleInstall = useCallback(async () => {
    setInstalling(true)
    const toastId = toast.loading(`Installing ${metadata.name || skillId}...`)

    try {
      const result = await window.electronAPI.marketplaceInstall(source)

      if (result.success) {
        toast.success(`Installed ${metadata.name || skillId}`, { id: toastId })
        onInstalled?.()
      } else {
        toast.error(`Failed to install`, {
          id: toastId,
          description: result.error,
        })
      }
    } catch (error) {
      toast.error(`Failed to install`, {
        id: toastId,
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setInstalling(false)
    }
  }, [source, skillId, metadata.name, onInstalled])

  // Open GitHub repo
  const handleOpenGitHub = useCallback(() => {
    window.electronAPI.openUrl(`https://github.com/${source}/tree/main/skills/${skillId}`)
  }, [source, skillId])

  const displayName = metadata.name || skillId

  return (
    <Info_Page
      loading={loading}
      error={error ?? undefined}
      empty={!content && !loading && !error ? 'Skill content not available' : undefined}
    >
      <Info_Page.Header
        title={displayName}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleOpenGitHub}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              GitHub
            </Button>
            <Button
              size="sm"
              onClick={handleInstall}
              disabled={installing}
            >
              {installing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Download className="h-3.5 w-3.5 mr-1" />
              )}
              Install
            </Button>
          </div>
        }
      />

      {content && (
        <Info_Page.Content>
          {/* Hero: Title and description */}
          <Info_Page.Hero
            avatar={
              <Avatar className="h-12 w-12">
                <AvatarFallback className="bg-gradient-to-br from-purple-500 to-pink-500 text-white">
                  <Sparkles className="h-6 w-6" />
                </AvatarFallback>
              </Avatar>
            }
            title={displayName}
            tagline={metadata.description}
          />

          {/* Metadata */}
          <Info_Section title="Metadata">
            <Info_Table>
              <Info_Table.Row label="Source">{source}</Info_Table.Row>
              <Info_Table.Row label="Skill ID">{skillId}</Info_Table.Row>
              {metadata.version && (
                <Info_Table.Row label="Version">{metadata.version}</Info_Table.Row>
              )}
              {metadata.author && (
                <Info_Table.Row label="Author">{metadata.author}</Info_Table.Row>
              )}
            </Info_Table>
          </Info_Section>

          {/* Instructions */}
          <Info_Section title="Instructions">
            <Info_Markdown maxHeight={540} fullscreen>
              {content || '*No instructions provided.*'}
            </Info_Markdown>
          </Info_Section>
        </Info_Page.Content>
      )}
    </Info_Page>
  )
}
