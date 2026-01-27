/**
 * SkillGalleryPage
 *
 * Browse and install community skills from the skills.sh registry.
 * Displays a searchable, sortable grid of skill cards with install counts
 * and one-click installation. Clicking a card navigates to the detail page.
 *
 * Layout follows the settings page patterns (max-w-3xl, px-5, py-7)
 * but uses the SkillGallery_* component system.
 */

import * as React from 'react'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Search, Loader2 } from 'lucide-react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useAtomValue } from 'jotai'
import { skillsAtom } from '@/atoms/skills'
import { routes, navigate } from '@/lib/navigate'
import { SkillGallery_Card } from './skill-gallery/components'
import type { GallerySkill, GallerySort } from '../../shared/types'

// ============================================================
// Props
// ============================================================

interface SkillGalleryPageProps {
  workspaceId: string
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Convert kebab-case skill ID to human-readable title.
 * e.g. "vercel-react-best-practices" → "Vercel React Best Practices"
 */
function formatSkillName(id: string): string {
  return id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// Sort option labels displayed in the UI
const SORT_OPTIONS: { value: GallerySort; label: string }[] = [
  { value: 'alltime', label: 'All Time' },
  { value: 'trending', label: 'Trending' },
  { value: 'hot', label: 'Hot' },
]

// ============================================================
// Main Component
// ============================================================

export default function SkillGalleryPage({ workspaceId }: SkillGalleryPageProps) {
  // Gallery state
  const [skills, setSkills] = useState<GallerySkill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sort, setSort] = useState<GallerySort>('alltime')
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  // Track which skills are currently being installed (by ID)
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set())

  // Local skills for "already installed" detection
  const localSkills = useAtomValue(skillsAtom)
  const installedSlugs = useMemo(
    () => new Set(localSkills.map((s) => s.slug)),
    [localSkills]
  )

  // Debounce timer ref for search
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // --------------------------------------------------------
  // Data fetching
  // --------------------------------------------------------

  /** Fetch gallery skills (initial load or sort change) */
  const fetchSkills = useCallback(async (sortValue: GallerySort) => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.galleryFetchSkills(sortValue, 0)
      setSkills(result.skills)
      setHasMore(result.hasMore)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load gallery')
      setSkills([])
    } finally {
      setLoading(false)
    }
  }, [])

  /** Search gallery skills (debounced) */
  const searchSkills = useCallback(async (query: string) => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.gallerySearchSkills(query, 50)
      setSkills(result.skills)
      setHasMore(result.hasMore)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
      setSkills([])
    } finally {
      setLoading(false)
    }
  }, [])

  /** Load more skills (pagination) */
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const result = await window.electronAPI.galleryFetchSkills(sort, skills.length)
      setSkills((prev) => [...prev, ...result.skills])
      setHasMore(result.hasMore)
    } catch {
      // Silently fail on load-more — user can retry
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, sort, skills.length])

  // Load on mount and when sort changes (only when not searching)
  useEffect(() => {
    if (!searchQuery) {
      fetchSkills(sort)
    }
  }, [sort, fetchSkills, searchQuery])

  // Debounced search when query changes
  useEffect(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current)
    }

    if (!searchQuery) {
      // Empty search: revert to sorted list
      fetchSkills(sort)
      return
    }

    // Debounce search by 300ms
    searchTimerRef.current = setTimeout(() => {
      searchSkills(searchQuery)
    }, 300)

    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current)
      }
    }
  }, [searchQuery, sort, fetchSkills, searchSkills])

  // --------------------------------------------------------
  // Handlers
  // --------------------------------------------------------

  /** Install a skill from the gallery */
  const handleInstall = useCallback(
    async (skill: GallerySkill) => {
      if (installingIds.has(skill.id) || installedSlugs.has(skill.id)) return

      setInstallingIds((prev) => new Set(prev).add(skill.id))
      try {
        await window.electronAPI.galleryInstallSkill(workspaceId, skill.id, skill.topSource)
        toast.success('Skill installed', {
          description: formatSkillName(skill.id),
        })
      } catch (err) {
        toast.error('Install failed', {
          description: err instanceof Error ? err.message : 'Unknown error',
        })
      } finally {
        setInstallingIds((prev) => {
          const next = new Set(prev)
          next.delete(skill.id)
          return next
        })
      }
    },
    [workspaceId, installingIds, installedSlugs]
  )

  /** Navigate to gallery skill detail page */
  const handleCardClick = useCallback((skill: GallerySkill) => {
    navigate(routes.view.skills({ gallerySkillId: skill.id, topSource: skill.topSource }))
  }, [])

  // --------------------------------------------------------
  // Render
  // --------------------------------------------------------

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title="Skill Gallery" />

      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-6">
              {/* Header description */}
              <div className="pl-1">
                <p className="text-sm text-muted-foreground">
                  Browse and install community skills from the{' '}
                  <button
                    className="underline underline-offset-2 hover:text-foreground transition-colors"
                    onClick={() => window.electronAPI.openUrl('https://skills.sh')}
                  >
                    skills.sh
                  </button>{' '}
                  open registry.
                </p>
              </div>

              {/* Search + Sort controls */}
              <div className="space-y-3">
                {/* Search input */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/30" />
                  <input
                    className="w-full h-9 pl-9 pr-3 text-sm rounded-[8px] bg-background shadow-minimal border border-border/50 focus:border-foreground/20 outline-none transition-colors placeholder:text-foreground/30"
                    placeholder="Search skills..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                {/* Sort tabs — hidden when searching */}
                {!searchQuery && (
                  <div className="flex gap-1">
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        className={cn(
                          'px-3 py-1.5 text-xs font-medium rounded-[6px] transition-colors',
                          sort === opt.value
                            ? 'bg-foreground/5 text-foreground'
                            : 'text-foreground/50 hover:text-foreground/70'
                        )}
                        onClick={() => setSort(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Loading state */}
              {loading && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-foreground/30" />
                </div>
              )}

              {/* Error state */}
              {error && !loading && (
                <div className="rounded-[8px] bg-destructive/5 border border-destructive/20 px-4 py-3">
                  <p className="text-sm text-destructive">{error}</p>
                  <button
                    className="mt-2 text-xs text-destructive/70 underline hover:text-destructive"
                    onClick={() => fetchSkills(sort)}
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Skills grid */}
              {!loading && !error && skills.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {skills.map((skill) => (
                    <SkillGallery_Card
                      key={skill.id}
                      name={formatSkillName(skill.id)}
                      source={skill.topSource}
                      installs={skill.installs}
                      isInstalled={installedSlugs.has(skill.id)}
                      isInstalling={installingIds.has(skill.id)}
                      onClick={() => handleCardClick(skill)}
                      onInstall={() => handleInstall(skill)}
                    />
                  ))}
                </div>
              )}

              {/* Empty search results */}
              {!loading && !error && skills.length === 0 && searchQuery && (
                <div className="flex items-center justify-center py-12">
                  <p className="text-sm text-muted-foreground">
                    No skills found for &ldquo;{searchQuery}&rdquo;
                  </p>
                </div>
              )}

              {/* Load more button */}
              {!loading && !error && hasMore && !searchQuery && (
                <div className="flex justify-center pt-2 pb-4">
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="h-8 px-4 text-xs font-medium rounded-[8px] bg-foreground/[0.02] shadow-minimal hover:bg-foreground/[0.05] transition-colors disabled:opacity-50"
                  >
                    {loadingMore ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      'Load More'
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
