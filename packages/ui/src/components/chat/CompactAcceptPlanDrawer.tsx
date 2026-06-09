import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from '../ui/drawer'
import { cn } from '../../lib/utils'

/**
 * CompactAcceptPlanDrawer — drawer-based Accept-Plan picker for compact /
 * mobile contexts.
 *
 * Same UX shape as `CompactPermissionModeSelector` / `CompactModelSelector` in
 * apps/electron: a slim trigger button opens a bottom-sheet (`vaul` drawer)
 * with the two acceptance options as full-width tap targets. Used by
 * `TurnCard`'s compact footer (WebUI mobile / auto-compact / EditPopover).
 *
 * Desktop and non-compact contexts keep using `AcceptPlanDropdown`
 * (Radix dropdown menu).
 */

interface CompactAcceptPlanDrawerProps {
  /** Callback when user selects "Accept" (execute immediately) */
  onAccept: () => void
  /** Callback when user selects "Accept & Compact" (compact first, then execute) */
  onAcceptWithCompact: () => void
  /** Trigger label */
  acceptLabel?: string
  /** Primary drawer option label */
  acceptOptionLabel?: string
  /** Additional className for the trigger button */
  className?: string
}

export function CompactAcceptPlanDrawer({
  onAccept,
  onAcceptWithCompact,
  acceptLabel,
  acceptOptionLabel,
  className,
}: CompactAcceptPlanDrawerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)

  const effectiveAcceptLabel = acceptLabel ?? t('plan.acceptPlan')
  const effectiveAcceptOptionLabel = acceptOptionLabel ?? t('plan.accept')

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button
          type="button"
          aria-label={effectiveAcceptLabel}
          className={cn(
            'group/accept h-[28px] pl-2.5 pr-2 text-xs font-medium rounded-[6px] flex items-center gap-1.5 transition-all',
            'bg-success/5 text-success hover:bg-success/10 shadow-tinted',
            'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            className,
          )}
          style={{ '--shadow-color': '34, 136, 82' } as React.CSSProperties}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 25 24" fill="currentColor">
            <path fillRule="nonzero" d="M13.7207031,22.6523438 C13.264974,22.6523438 12.9361979,22.4895833 12.734375,22.1640625 C12.5325521,21.8385417 12.360026,21.4316406 12.2167969,20.9433594 L10.6640625,15.7871094 C10.5729167,15.4615885 10.5403646,15.1995443 10.5664062,15.0009766 C10.5924479,14.8024089 10.6998698,14.6022135 10.8886719,14.4003906 L20.859375,3.6484375 C20.9179688,3.58984375 20.9472656,3.52473958 20.9472656,3.453125 C20.9472656,3.38151042 20.921224,3.32291667 20.8691406,3.27734375 C20.8170573,3.23177083 20.7568359,3.20735677 20.6884766,3.20410156 C20.6201172,3.20084635 20.5566406,3.22851562 20.4980469,3.28710938 L9.78515625,13.296875 C9.5703125,13.4921875 9.36197917,13.601237 9.16015625,13.6240234 C8.95833333,13.6468099 8.70117188,13.609375 8.38867188,13.5117188 L3.11523438,11.9101562 C2.64648438,11.7669271 2.25911458,11.5960286 1.953125,11.3974609 C1.64713542,11.1988932 1.49414062,10.875 1.49414062,10.4257812 C1.49414062,10.0742188 1.63411458,9.77148438 1.9140625,9.51757812 C2.19401042,9.26367188 2.5390625,9.05859375 2.94921875,8.90234375 L19.7460938,2.46679688 C19.9739583,2.38216146 20.1871745,2.31542969 20.3857422,2.26660156 C20.5843099,2.21777344 20.764974,2.19335938 20.9277344,2.19335938 C21.2467448,2.19335938 21.4973958,2.28450521 21.6796875,2.46679688 C21.8619792,2.64908854 21.953125,2.89973958 21.953125,3.21875 C21.953125,3.38802083 21.9287109,3.5703125 21.8798828,3.765625 C21.8310547,3.9609375 21.7643229,4.17252604 21.6796875,4.40039062 L15.2832031,21.109375 C15.1009115,21.578125 14.8828125,21.952474 14.6289062,22.2324219 C14.375,22.5123698 14.0722656,22.6523438 13.7207031,22.6523438 Z" />
          </svg>
          <span>{effectiveAcceptLabel}</span>
          <ChevronDown className="h-3 w-3 transition-transform duration-150 group-data-[state=open]/accept:rotate-180" />
        </button>
      </DrawerTrigger>

      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t('plan.acceptPlan')}</DrawerTitle>
        </DrawerHeader>

        <div className="px-4 pb-6 flex flex-col gap-1">
          <DrawerClose asChild>
            <button
              type="button"
              className="flex flex-col items-start gap-0.5 w-full px-3 py-3 rounded-lg text-left transition-colors hover:bg-foreground/5"
              onClick={() => onAccept()}
            >
              <span className="text-sm font-medium">{effectiveAcceptOptionLabel}</span>
              <span className="text-xs text-muted-foreground">
                {t('plan.executeImmediately')}
              </span>
            </button>
          </DrawerClose>

          <DrawerClose asChild>
            <button
              type="button"
              className="flex flex-col items-start gap-0.5 w-full px-3 py-3 rounded-lg text-left transition-colors hover:bg-foreground/5"
              onClick={() => onAcceptWithCompact()}
            >
              <span className="text-sm font-medium">{t('plan.acceptAndCompact')}</span>
              <span className="text-xs text-muted-foreground">
                {t('plan.worksForComplex')}
              </span>
            </button>
          </DrawerClose>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
