import type { TFunction } from 'i18next'

export function getSessionMetadataLabels(t: TFunction) {
  return {
    title: t('common:rightSidebar.metadata.title'),
    noSession: t('common:rightSidebar.metadata.noSession'),
    loading: t('common:rightSidebar.metadata.loading'),
    name: t('common:rightSidebar.metadata.name'),
    namePlaceholder: t('common:rightSidebar.metadata.namePlaceholder'),
    notes: t('common:rightSidebar.metadata.notes'),
    notesPlaceholder: t('common:rightSidebar.metadata.notesPlaceholder'),
    notesLoading: t('common:rightSidebar.metadata.notesLoading'),
  }
}
