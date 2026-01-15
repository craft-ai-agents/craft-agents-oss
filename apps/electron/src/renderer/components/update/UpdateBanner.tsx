/**
 * UpdateBanner
 *
 * A floating notification shown when an app update is ready to install.
 * Positioned at the bottom of the screen to avoid title bar conflicts.
 */

import * as React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface UpdateBannerProps {
  /** Whether an update is available */
  updateAvailable: boolean
  /** Latest version available */
  latestVersion: string | null
  /** Whether update is ready to install */
  isReadyToInstall: boolean
  /** Callback to install the update */
  onInstall: () => void
  /** Callback to dismiss the banner */
  onDismiss: () => void
  /** Whether the banner has been dismissed */
  isDismissed: boolean
}

export function UpdateBanner({
  updateAvailable,
  latestVersion,
  isReadyToInstall,
  onInstall,
  onDismiss,
  isDismissed,
}: UpdateBannerProps) {
  // Only show when ready to install (download complete), unless dismissed
  const showBanner = updateAvailable && isReadyToInstall && !isDismissed

  return (
    <AnimatePresence>
      {showBanner && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{
            type: 'spring',
            stiffness: 400,
            damping: 30,
            mass: 0.8,
          }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-overlay"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div
            className={cn(
              'flex items-center gap-3 px-4 py-2.5 rounded-full',
              'bg-background/95 backdrop-blur-xl',
              'border border-border/50 shadow-lg',
              'text-sm text-foreground'
            )}
          >
            <span>
              Update v{latestVersion} ready
            </span>

            <Button
              size="sm"
              variant="default"
              onClick={onInstall}
              className="h-7 px-3 text-xs gap-1.5 rounded-full"
            >
              <RefreshCw className="h-3 w-3" />
              Restart to Update
            </Button>

            <button
              onClick={onDismiss}
              className="p-1 rounded-full hover:bg-foreground/10 transition-colors"
              title="Dismiss"
            >
              <X className="h-4 w-4 text-foreground/50" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
