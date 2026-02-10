import type { TFunction } from 'i18next'

export function getTaskActionLabels(t: TFunction) {
  return {
    title: t('common:taskActions.title'),
    typeTask: t('common:taskActions.type.task'),
    typeShell: t('common:taskActions.type.shell'),
    viewOutput: t('common:taskActions.viewOutput'),
    stopTask: t('common:taskActions.stopTask'),
    overlayUnavailable: t('common:taskActions.overlayUnavailable'),
    outputFallback: t('common:taskActions.outputFallback'),
    loadFailed: t('common:taskActions.loadFailed'),
  }
}
