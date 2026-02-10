import type { TFunction } from 'i18next'

export function getFreeFormInputLabels(t: TFunction) {
  return {
    placeholders: {
      workOn: t('common:chatInput.placeholders.workOn'),
      shiftTabMode: t('common:chatInput.placeholders.shiftTabMode'),
      mentionHint: t('common:chatInput.placeholders.mentionHint'),
      labelHint: t('common:chatInput.placeholders.labelHint'),
      newlineHint: t('common:chatInput.placeholders.newlineHint'),
      sidebarToggleHint: t('common:chatInput.placeholders.sidebarToggleHint'),
      focusModeHint: t('common:chatInput.placeholders.focusModeHint'),
    },
    actions: {
      attachFiles: t('common:chatInput.actions.attachFiles'),
      attachFilesTooltip: t('common:chatInput.actions.attachFilesTooltip'),
      chooseSources: t('common:chatInput.actions.chooseSources'),
      noSourcesConfigured: t('common:chatInput.actions.noSourcesConfigured'),
      sourcesTooltip: t('common:chatInput.actions.sourcesTooltip'),
      addSourcesInSettings: t('common:chatInput.actions.addSourcesInSettings'),
      searchSources: t('common:chatInput.actions.searchSources'),
      workInFolder: t('common:chatInput.actions.workInFolder'),
      folderFallback: t('common:chatInput.actions.folderFallback'),
      filterFolders: t('common:chatInput.actions.filterFolders'),
      noFoldersFound: t('common:chatInput.actions.noFoldersFound'),
      chooseFolder: t('common:chatInput.actions.chooseFolder'),
      resetFolder: t('common:chatInput.actions.resetFolder'),
      gitBranchPrefix: t('common:chatInput.actions.gitBranchPrefix'),
      noDetailsProvided: t('common:chatInput.actions.noDetailsProvided'),
    },
  }
}
