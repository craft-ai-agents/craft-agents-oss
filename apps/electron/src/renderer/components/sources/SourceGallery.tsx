/**
 * SourceGallery - Main container for the source gallery "App Store" view.
 *
 * Features:
 * - Search bar with instant filtering
 * - Category filter pills
 * - Responsive card grid
 * - Empty state when no results
 * - Modal integration for source details
 */

import { useState, useMemo } from 'react'
import { Search, SearchX, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SourceGalleryCard } from './SourceGalleryCard'
import { SourceCategoryFilter } from './SourceCategoryFilter'
import { SourceDetailModal } from './SourceDetailModal'
import type { GallerySource, GalleryCategory } from './gallery-data'
import { GALLERY_SOURCES, searchSources, getSourcesByCategory, getFeaturedSources } from './gallery-data'

interface SourceGalleryProps {
  sources?: GallerySource[]
  installedSlugs?: string[]
  onInstall?: (source: GallerySource) => void
  showFeaturedSection?: boolean
  className?: string
}

export function SourceGallery({
  sources = GALLERY_SOURCES,
  installedSlugs = [],
  onInstall,
  showFeaturedSection = true,
  className,
}: SourceGalleryProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<GalleryCategory>('all')
  const [selectedSource, setSelectedSource] = useState<GallerySource | null>(null)

  // Filter sources based on search and category
  const filteredSources = useMemo(() => {
    let result = sources

    // Apply search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.provider.toLowerCase().includes(q) ||
          s.tagline.toLowerCase().includes(q)
      )
    }

    // Apply category filter
    if (activeCategory !== 'all') {
      result = result.filter((s) => s.category === activeCategory)
    }

    // Sort by popularity
    return result.sort((a, b) => b.popularity - a.popularity)
  }, [sources, searchQuery, activeCategory])

  // Get featured sources (only show when no search and viewing "all")
  const featuredSources = useMemo(() => {
    if (searchQuery || activeCategory !== 'all' || !showFeaturedSection) return []
    return getFeaturedSources()
  }, [searchQuery, activeCategory, showFeaturedSection])

  // Non-featured sources for the main grid
  const mainSources = useMemo(() => {
    if (featuredSources.length === 0) return filteredSources
    const featuredSlugs = new Set(featuredSources.map((s) => s.slug))
    return filteredSources.filter((s) => !featuredSlugs.has(s.slug))
  }, [filteredSources, featuredSources])

  const isInstalled = (slug: string) => installedSlugs.includes(slug)

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header: Search + Filters */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm pb-4 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/40" />
          <input
            type="text"
            placeholder="Search sources..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              'w-full pl-10 pr-4 py-2.5 rounded-xl',
              'bg-foreground/[0.05] border border-border/50',
              'text-sm placeholder:text-foreground/40',
              'focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/30',
              'transition-all duration-150'
            )}
          />
        </div>

        {/* Category Filter */}
        <SourceCategoryFilter
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {filteredSources.length === 0 ? (
          // Empty State
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-foreground/[0.05] flex items-center justify-center mb-4">
              <SearchX className="w-8 h-8 text-foreground/30" />
            </div>
            <p className="text-lg font-medium text-foreground/80 mb-1">No sources found</p>
            <p className="text-sm text-foreground/50">
              Try a different search term or category
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Featured Section */}
            {featuredSources.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="w-4 h-4 text-accent" />
                  <h2 className="text-sm font-semibold text-foreground/70 uppercase tracking-wide">
                    Featured
                  </h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {featuredSources.map((source) => (
                    <SourceGalleryCard
                      key={source.slug}
                      source={source}
                      isInstalled={isInstalled(source.slug)}
                      onClick={() => setSelectedSource(source)}
                      onInstall={() => onInstall?.(source)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Main Grid */}
            {mainSources.length > 0 && (
              <div>
                {featuredSources.length > 0 && (
                  <h2 className="text-sm font-semibold text-foreground/70 uppercase tracking-wide mb-4">
                    All Sources
                  </h2>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {mainSources.map((source) => (
                    <SourceGalleryCard
                      key={source.slug}
                      source={source}
                      isInstalled={isInstalled(source.slug)}
                      onClick={() => setSelectedSource(source)}
                      onInstall={() => onInstall?.(source)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      <SourceDetailModal
        source={selectedSource}
        isOpen={selectedSource !== null}
        onClose={() => setSelectedSource(null)}
        isInstalled={selectedSource ? isInstalled(selectedSource.slug) : false}
        onInstall={() => {
          if (selectedSource) {
            onInstall?.(selectedSource)
          }
        }}
      />
    </div>
  )
}
