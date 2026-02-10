import type { SettingsSubpage } from '../../../shared/types'

export function getSettingsNavigatorLabels(t: (key: string) => string) {
  return {
    openInNewWindow: t('settings:navigator.openInNewWindow'),
    getItemLabel: (id: SettingsSubpage) => t(`settings:navigator.items.${id}.label`),
    getItemDescription: (id: SettingsSubpage) => t(`settings:navigator.items.${id}.description`),
  }
}
