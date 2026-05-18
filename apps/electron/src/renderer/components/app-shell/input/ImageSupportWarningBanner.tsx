import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'

interface ImageSupportWarningBannerProps {
  modelName: string
  onEnable: () => void
}

export function ImageSupportWarningBanner({
  modelName,
  onEnable,
}: ImageSupportWarningBannerProps) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-2 px-3 py-2 mx-2 mt-2 rounded-md bg-amber-500/10 text-foreground/70 text-xs">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
      <span className="flex-1 min-w-0">
        {t('chat.imageWarning.title', {
          modelName,
          defaultValue: '{{modelName}} is set to text-only. Images will be skipped.',
        })}
      </span>
      <button
        type="button"
        onClick={onEnable}
        className="shrink-0 underline underline-offset-2 hover:text-foreground"
      >
        {t('chat.imageWarning.action', { defaultValue: 'Enable images' })}
      </button>
    </div>
  )
}
