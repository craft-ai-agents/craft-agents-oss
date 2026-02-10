import type { TFunction } from 'i18next'

export function getChatDisplayLabels(t: TFunction) {
  return {
    compactTitle: t('common:chatDisplay.compactEmpty.title'),
    compactDescription: t('common:chatDisplay.compactEmpty.description'),
  }
}
