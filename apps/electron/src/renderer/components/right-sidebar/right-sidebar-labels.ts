import type { TFunction } from 'i18next'

export function getRightSidebarLabels(t: TFunction) {
  return {
    filesComingSoon: t('common:rightSidebar.files.comingSoon'),
    historyComingSoon: t('common:rightSidebar.history.comingSoon'),
  }
}
