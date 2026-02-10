import type { TFunction } from 'i18next'

export function getSessionFilesLabels(t: TFunction) {
  return {
    title: t('common:rightSidebar.files.title'),
    loading: t('common:rightSidebar.files.loading'),
    empty: t('common:rightSidebar.files.empty'),
    directory: t('common:rightSidebar.files.directory'),
    clickExpand: t('common:rightSidebar.files.clickExpand'),
    clickReveal: t('common:rightSidebar.files.clickReveal'),
    doubleClickOpen: t('common:rightSidebar.files.doubleClickOpen'),
  }
}
