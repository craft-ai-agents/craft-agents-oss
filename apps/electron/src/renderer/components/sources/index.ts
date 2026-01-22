/**
 * Source Gallery components - App Store style source discovery.
 */

export { SourceGallery } from './SourceGallery'
export { SourceGalleryCard } from './SourceGalleryCard'
export { SourceCategoryFilter } from './SourceCategoryFilter'
export { SourceDetailModal } from './SourceDetailModal'

export type { GallerySource, GalleryCategory } from './gallery-data'
export {
  GALLERY_SOURCES,
  GALLERY_CATEGORIES,
  getSourcesByCategory,
  getFeaturedSources,
  getNewSources,
  searchSources,
} from './gallery-data'
