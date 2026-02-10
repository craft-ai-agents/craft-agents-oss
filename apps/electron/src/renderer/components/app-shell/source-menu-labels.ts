import type { TFunction } from 'i18next'

export function getSourceMenuLabels(t: TFunction) {
  return {
    openInNewWindow: t('common:menu.openInNewWindow'),
    showInFinder: t('common:menu.showInFinder'),
    deleteSource: t('common:menu.deleteSource'),
  }
}
