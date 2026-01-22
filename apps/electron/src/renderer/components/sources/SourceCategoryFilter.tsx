/**
 * SourceCategoryFilter - Horizontal pill-style category filter.
 *
 * Features:
 * - Smooth transitions between active states
 * - Horizontal scroll on small screens
 * - Accent color for active pill
 */

import { cn } from '@/lib/utils'
import type { GalleryCategory } from './gallery-data'
import { GALLERY_CATEGORIES } from './gallery-data'

interface SourceCategoryFilterProps {
  activeCategory: GalleryCategory
  onCategoryChange: (category: GalleryCategory) => void
  className?: string
}

export function SourceCategoryFilter({
  activeCategory,
  onCategoryChange,
  className,
}: SourceCategoryFilterProps) {
  return (
    <div
      className={cn(
        'flex gap-2 overflow-x-auto pb-1 scrollbar-hide',
        '-mx-1 px-1', // Allow pills to have breathing room
        className
      )}
    >
      {GALLERY_CATEGORIES.map((category) => {
        const isActive = activeCategory === category.id
        return (
          <button
            key={category.id}
            onClick={() => onCategoryChange(category.id)}
            className={cn(
              'px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap',
              'transition-all duration-150 ease-out',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
              isActive
                ? 'bg-accent text-white shadow-sm'
                : 'bg-foreground/[0.06] text-foreground/70 hover:bg-foreground/10 hover:text-foreground'
            )}
          >
            {category.label}
          </button>
        )
      })}
    </div>
  )
}
