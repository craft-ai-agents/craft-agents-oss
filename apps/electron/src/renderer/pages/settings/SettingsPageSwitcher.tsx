import { useTranslation } from 'react-i18next'
import { SETTINGS_ITEMS } from '../../../shared/menu-schema'
import type { SettingsSubpage } from '../../../shared/settings-registry'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'

interface SettingsPageSwitcherProps {
  activeSubpage: SettingsSubpage
}

const PRIMARY_ORDER: SettingsSubpage[] = [
  'ai',
  'appearance',
  'app',
  'workspace',
  'permissions',
  'input',
  'labels',
  'messaging',
  'shortcuts',
  'preferences',
  'server',
]

export function SettingsPageSwitcher({ activeSubpage }: SettingsPageSwitcherProps) {
  const { t } = useTranslation()
  const orderedItems = [...SETTINGS_ITEMS].sort((a, b) => {
    return PRIMARY_ORDER.indexOf(a.id) - PRIMARY_ORDER.indexOf(b.id)
  })

  return (
    <div className="w-full max-w-[760px] rounded-[15px] border border-white/[0.075] bg-[#0b0b0d]/92 p-1 shadow-[0_18px_55px_rgba(0,0,0,0.32)] backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-1">
        {orderedItems.map((item) => {
          const selected = item.id === activeSubpage
          const label = item.id === 'ai' ? 'AI / Models' : t(item.labelKey)
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(routes.view.settings(item.id))}
              className={cn(
                'rounded-[11px] px-3 py-1.5 text-[11.5px] font-medium leading-4 transition-colors',
                selected
                  ? 'bg-white/[0.09] text-white shadow-minimal'
                  : 'text-white/42 hover:bg-white/[0.045] hover:text-white/72'
              )}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
