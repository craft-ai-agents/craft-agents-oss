import type { TFunction } from 'i18next'

export function getWorkspaceChoiceLabels(t: TFunction) {
  return {
    title: t('settings:workspace.add.title'),
    description: t('settings:workspace.add.description'),
    createNew: t('settings:workspace.add.createNew'),
    createDescription: t('settings:workspace.add.createDescription'),
    openFolder: t('settings:workspace.add.openFolder'),
    openDescription: t('settings:workspace.add.openDescription'),
  }
}
