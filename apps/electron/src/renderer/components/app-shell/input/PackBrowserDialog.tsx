/**
 * PackBrowserDialog — Browse and install sound packs from the OpenPeon registry.
 *
 * Full-featured modal dialog that fetches the OpenPeon registry index,
 * displays available packs with filtering, preview, and one-click install.
 * Preview cycles through sounds sequentially per pack.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Registry types
// ---------------------------------------------------------------------------

interface RegistryPackAuthor {
  name?: string
  github?: string
}

interface RegistryPack {
  name: string
  display_name?: string
  description?: string
  version?: string
  author?: string | RegistryPackAuthor
  language?: string
  category_count?: number
  sound_count?: number
  trust_tier?: 'official' | 'community'
  source_repo?: string
  tags?: string[]
}

interface PackBrowserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a pack is installed successfully */
  onPackInstalled?: (packName: string) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PackBrowserDialog({
  open,
  onOpenChange,
  onPackInstalled,
}: PackBrowserDialogProps) {
  const { t } = useTranslation()
  const [registry, setRegistry] = React.useState<RegistryPack[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [filter, setFilter] = React.useState('')
  const [installing, setInstalling] = React.useState<string | null>(null)
  const [previewing, setPreviewing] = React.useState<string | null>(null)

  // Track the next sequential preview index per pack name
  const previewIndexRef = React.useRef<Map<string, number>>(new Map())

  // Fetch registry on open
  React.useEffect(() => {
    if (!open) return
    if (registry.length > 0) return // already loaded
    setLoading(true)
    setError(null)
    window.electronAPI.getSoundRegistry()
      .then((result) => {
        if (!result) {
          setError('No response from sound service')
          return
        }
        if (result.error) {
          setError(result.error)
          return
        }
        const packs = Array.isArray(result.packs) ? result.packs : []
        setRegistry(packs as RegistryPack[])
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setLoading(false))
  }, [open, registry.length])

  const handleInstall = async (packName: string) => {
    setInstalling(packName)
    try {
      const result = await window.electronAPI.installSoundPack(packName)
      if (result.success) {
        onPackInstalled?.(packName)
      }
    } catch (err) {
      console.error('[sound] Install failed:', err)
    } finally {
      setInstalling(null)
    }
  }

  const handlePreview = async (packName: string) => {
    setPreviewing(packName)
    // Get current index and advance for next click
    const currentIndex = previewIndexRef.current.get(packName) ?? 0
    try {
      const result = await window.electronAPI.previewSoundPack(packName, currentIndex)
      // Advance index (wrap around when we reach the end)
      if (result.totalSounds) {
        previewIndexRef.current.set(packName, (currentIndex + 1) % result.totalSounds)
      }
    } catch (err) {
      console.error('[sound] Preview failed:', err)
    } finally {
      setTimeout(() => setPreviewing(null), 1500)
    }
  }

  // Filter packs by name, display name, description, or tags
  const filteredPacks = React.useMemo(() => {
    if (!filter.trim()) return registry
    const lower = filter.toLowerCase()
    return registry.filter(pack =>
      pack.name.toLowerCase().includes(lower) ||
      pack.display_name?.toLowerCase().includes(lower) ||
      pack.description?.toLowerCase().includes(lower) ||
      pack.tags?.some(tag => tag.toLowerCase().includes(lower))
    )
  }, [registry, filter])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col overflow-hidden" style={{ display: 'flex' }}>
        <DialogHeader>
          <DialogTitle>
            {t('settings.sound.browsePacks', 'Browse Sound Packs')}
          </DialogTitle>
          <DialogDescription>
            {registry.length > 0
              ? `${filteredPacks.length} pack${filteredPacks.length !== 1 ? 's' : ''} available${filter ? ` (filtered from ${registry.length})` : ''}`
              : 'Download sound packs from the community registry'}
          </DialogDescription>
        </DialogHeader>

        {/* Search/Filter */}
        <div className="relative">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search packs by name, tag, or description..."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {filter && (
            <button
              onClick={() => setFilter('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          )}
        </div>

        {/* Pack List — scrolls natively via ScrollArea */}
        <ScrollArea className="flex-1 min-h-0 overflow-hidden">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mb-2" />
              <span className="text-sm">Loading registry...</span>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-12 text-destructive">
              <span className="text-sm">Failed to load registry: {error}</span>
              <button
                onClick={() => { setRegistry([]) }}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Retry
              </button>
            </div>
          )}

          {!loading && !error && filteredPacks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <span className="text-sm">
                {filter ? `No packs matching "${filter}"` : 'No packs available'}
              </span>
            </div>
          )}

          {!loading && !error && filteredPacks.length > 0 && (
            <div className="space-y-1 py-1">
              {filteredPacks.map(pack => (
                <div
                  key={pack.name}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-foreground/[0.03] transition-colors"
                >
                  {/* Pack info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {pack.display_name || pack.name}
                      </span>
                      {pack.trust_tier === 'official' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 font-medium">
                          Official
                        </span>
                      )}
                      {pack.language && pack.language !== 'en' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {pack.language.toUpperCase()}
                        </span>
                      )}
                    </div>
                    {pack.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        {pack.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                      {pack.author && <span>by {typeof pack.author === 'string' ? pack.author : (pack.author as RegistryPackAuthor).name ?? 'Unknown'}</span>}
                      {pack.sound_count !== undefined && <span>{pack.sound_count} sounds</span>}
                      {pack.version && <span>v{pack.version}</span>}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handlePreview(pack.name)}
                      disabled={previewing === pack.name}
                      className={cn(
                        'text-xs px-2 py-1 rounded-md transition-colors',
                        previewing === pack.name
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted hover:bg-muted/80'
                      )}
                      title="Preview next sound (clicks cycle through sounds)"
                    >
                      {previewing === pack.name ? '🔊...' : '▶'}
                    </button>
                    <button
                      onClick={() => handleInstall(pack.name)}
                      disabled={installing === pack.name}
                      className={cn(
                        'text-xs px-3 py-1 rounded-md transition-colors font-medium',
                        installing === pack.name
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-primary text-primary-foreground hover:bg-primary/90'
                      )}
                    >
                      {installing === pack.name ? 'Installing...' : 'Install'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer info */}
        <div className="text-[10px] text-muted-foreground text-center pt-2 border-t border-border/50">
          Packs are downloaded from github.com via the OpenPeon registry (CESP v1.0)
        </div>
      </DialogContent>
    </Dialog>
  )
}