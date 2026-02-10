import type { TFunction } from 'i18next'

export function getChatLabels(t: TFunction) {
  return {
    title: t('chat:panel.title'),
    renameTitle: t('chat:rename.title'),
    renamePlaceholder: t('chat:rename.placeholder'),
    shareAction: t('chat:share.action'),
  }
}
