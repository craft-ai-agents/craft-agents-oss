/**
 * SoundPackBadge — Per-session sound pack selector badge for FreeFormInput.
 *
 * Shows a speaker icon in the input toolbar. Clicking opens a dropdown
 * to select a sound pack for the current session, or reset to global default.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Volume2 } from 'lucide-react'
import {
  FreeFormInputContextBadge,
} from './FreeFormInputContextBadge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PackInfo {
  name: string
  displayName: string
  soundCount: number
  source: string
  trustTier?: 'official' | 'community'
}

interface SoundPackBadgeProps {
  /** Session ID for per-session pack persistence */
  sessionId: string
  /** Currently active pack name for this session */
  activePack?: string
  /** Whether this is an empty (new) session — affects expanded state */
  isEmptySession?: boolean
  /** Whether badge is disabled */
  disabled?: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SoundPackBadge({
  sessionId,
  activePack,
  isEmptySession = false,
  disabled = false,
}: SoundPackBadgeProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [packs, setPacks] = React.useState<PackInfo[]>([])
  const [loading, setLoading] = React.useState(false)
  const [optimisticPack, setOptimisticPack] = React.useState<string | undefined>(activePack)

  // Sync optimistic pack when activePack prop changes (e.g., after server update)
  React.useEffect(() => {
    setOptimisticPack(activePack)
  }, [activePack])

  // Load available packs when popover opens
  React.useEffect(() => {
    if (open && packs.length === 0) {
      setLoading(true)
      window.electronAPI.getSoundPacks()
        .then((result) => {
          if (result) setPacks(result)
        })
        .catch((err) => console.error('[sound] Failed to load packs:', err))
        .finally(() => setLoading(false))
    }
  }, [open, packs.length])

  const handleSelectPack = React.useCallback(async (packName: string | undefined) => {
    const previousPack = optimisticPack
    setOptimisticPack(packName)
    try {
      await window.electronAPI.setSoundPack(sessionId, packName)
    } catch (err) {
      console.error('[sound] Failed to set pack:', err)
      setOptimisticPack(previousPack)
    }
    setOpen(false)
  }, [sessionId, optimisticPack])

  const selectedPack = optimisticPack
    ? packs.find(p => p.name === optimisticPack)
    : undefined

  // Show the pack name even before the pack list is loaded.
  // When the popover hasn't been opened yet, packs is empty so
  // selectedPack is undefined — but we still know the raw name.
  const label = optimisticPack
    ? (selectedPack?.displayName ?? optimisticPack)
    : t('settings.sound.defaultPack', 'Default')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span className="shrink min-w-0">
          <FreeFormInputContextBadge
            icon={<Volume2 className="h-3.5 w-3.5" />}
            label={label}
            isExpanded={isEmptySession}
            hasSelection={!!optimisticPack}
            showChevron={true}
            isOpen={open}
            disabled={disabled}
          />
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={4}
        className="w-56 p-1 popover-styled"
      >
          <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
            Sound Pack
          </div>

          {/* Default (global) option */}
          <button
            onClick={() => handleSelectPack(undefined)}
            className={cn(
              'w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-foreground/5 transition-colors text-left',
              !optimisticPack && 'bg-foreground/5'
            )}
          >
            <Volume2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate">{t('settings.sound.defaultPack', 'Default')}</span>
            {!optimisticPack && (
              <span className="text-[10px] text-primary">✓</span>
            )}
          </button>

          {/* Pack list */}
          {loading && (
            <div className="px-2 py-3 text-xs text-muted-foreground text-center">
              Loading...
            </div>
          )}
          {!loading && packs.map(pack => (
            <button
              key={pack.name}
              onClick={() => handleSelectPack(pack.name)}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-foreground/5 transition-colors text-left',
                optimisticPack === pack.name && 'bg-foreground/5'
              )}
            >
              <span className="flex-1 truncate">{pack.displayName}</span>
              {pack.source === 'builtin' && (
                <span className="text-[10px] text-muted-foreground">built-in</span>
              )}
              {pack.trustTier === 'official' && (
                <span className="text-[10px] text-green-500">✓</span>
              )}
              {optimisticPack === pack.name && (
                <span className="text-[10px] text-primary">✓</span>
              )}
            </button>
          ))}

          {!loading && packs.length === 0 && (
            <div className="px-2 py-3 text-xs text-muted-foreground text-center">
              No packs installed
            </div>
          )}
        </PopoverContent>
    </Popover>
  )
}
