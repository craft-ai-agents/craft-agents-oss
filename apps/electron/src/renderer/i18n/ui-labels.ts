export type TranslationFn = (key: string, options?: Record<string, unknown>) => string

export const getAppMenuLabels = (t: TranslationFn) => ({
  craftMenuAriaLabel: t('menu:craftMenuAriaLabel'),
  newChat: t('menu:newChat'),
  newWindow: t('menu:newWindow'),
  settingsLabel: t('common:navigation.settings'),
  settingsAction: t('menu:settings'),
  help: t('menu:help'),
  helpDocumentation: t('menu:helpDocumentation'),
  keyboardShortcuts: t('menu:keyboardShortcuts'),
  debug: t('menu:debug'),
  checkForUpdates: t('menu:checkForUpdates'),
  installUpdate: t('menu:installUpdate'),
  debugCheckForUpdates: t('menu:debugCheckForUpdates'),
  debugInstallUpdate: t('menu:debugInstallUpdate'),
  toggleDevTools: t('menu:toggleDevTools'),
  quitApp: t('menu:quitApp'),
  goBack: t('menu:goBack'),
  goForward: t('menu:goForward'),
})

export const getSessionMenuLabels = (t: TranslationFn) => ({
  share: t('chat:share.action'),
  shared: t('chat:share.shared'),
  openInBrowser: t('chat:share.openInBrowser'),
  copyLink: t('chat:share.copyLink'),
  updateShare: t('chat:share.updateShare'),
  stopSharing: t('chat:share.stopSharing'),
  status: t('common:menu.status'),
  labels: t('common:menu.labels'),
  flag: t('common:menu.flag'),
  unflag: t('common:menu.unflag'),
  markAsUnread: t('common:menu.markAsUnread'),
  rename: t('common:menu.rename'),
  regenerateTitle: t('common:menu.regenerateTitle'),
  openInNewWindow: t('common:menu.openInNewWindow'),
  showInFinder: t('common:menu.showInFinder'),
  copyPath: t('common:menu.copyPath'),
  delete: t('common:menu.delete'),
  linkCopied: t('chat:toast.linkCopied'),
  shareFailed: t('chat:toast.shareFailed'),
  shareUnknownError: t('chat:toast.shareUnknownError'),
  shareUpdated: t('chat:toast.shareUpdated'),
  shareUpdateFailed: t('chat:toast.updateShareFailed'),
  shareStopped: t('chat:toast.shareStopped'),
  shareStopFailed: t('chat:toast.stopShareFailed'),
  pathCopied: t('common:pathCopied'),
  titleRefreshed: t('chat:toast.titleRefreshed'),
  titleRefreshFailed: t('chat:toast.titleRefreshFailed'),
  open: t('chat:actions.open'),
  unknownError: t('common:unknownError'),
})

export const getPermissionModeLabels = (t: TranslationFn) => ({
  shortcutHint: t('settings:workspace.permissions.modeOptions.shortcutHint'),
  safe: {
    displayName: t('settings:workspace.permissions.modeOptions.safe.label'),
    shortName: t('settings:workspace.permissions.modeOptions.safe.shortLabel'),
    description: t('settings:workspace.permissions.modeOptions.safe.description'),
  },
  ask: {
    displayName: t('settings:workspace.permissions.modeOptions.ask.label'),
    shortName: t('settings:workspace.permissions.modeOptions.ask.shortLabel'),
    description: t('settings:workspace.permissions.modeOptions.ask.description'),
  },
  allowAll: {
    displayName: t('settings:workspace.permissions.modeOptions.allowAll.label'),
    shortName: t('settings:workspace.permissions.modeOptions.allowAll.shortLabel'),
    description: t('settings:workspace.permissions.modeOptions.allowAll.description'),
  },
})

export const getThinkingLevelLabels = (t: TranslationFn) => ({
  off: {
    label: t('settings:workspace.model.thinkingLevels.off.label'),
    description: t('settings:workspace.model.thinkingLevels.off.description'),
  },
  think: {
    label: t('settings:workspace.model.thinkingLevels.think.label'),
    description: t('settings:workspace.model.thinkingLevels.think.description'),
  },
  max: {
    label: t('settings:workspace.model.thinkingLevels.max.label'),
    description: t('settings:workspace.model.thinkingLevels.max.description'),
  },
})

export const getSlashCommandLabels = (t: TranslationFn) => ({
  searchPlaceholder: t('common:commands.searchPlaceholder'),
  noCommandsFound: t('common:commands.noCommandsFound'),
  footerHint: t('common:commands.footerHint'),
  sections: {
    modes: t('common:commands.sections.modes'),
    features: t('common:commands.sections.features'),
    recentDirectories: t('common:commands.sections.recentDirectories'),
  },
  ultrathink: {
    label: t('common:commands.ultrathink.label'),
    description: t('common:commands.ultrathink.description'),
  },
})

export const getTodoFilterLabels = (t: TranslationFn) => ({
  placeholder: t('common:filters.statusFilterPlaceholder'),
  emptyState: t('common:filters.noStatusFound'),
})

export const getMainContentLabels = (t: TranslationFn) => ({
  emptySources: t('common:sources.emptyTitle'),
  emptySkills: t('common:skills.emptyTitle'),
  emptyFlaggedChats: t('common:sessionList.flaggedEmptyTitle'),
  emptyChats: t('common:sessionList.emptyTitle'),
  emptyChatPrompt: t('common:sessionList.selectPrompt'),
})

export const getSearchLabels = (t: TranslationFn) => ({
  matchesFoundTitle: t('common:search.matchesFoundTitle'),
  noMatchingFilters: t('common:filters.noMatchingFilters'),
  search: t('common:filters.search'),
  noLabelsConfigured: t('common:filters.noLabelsConfigured'),
  openInBrowser: t('chat:share.openInBrowser'),
  copyLink: t('chat:share.copyLink'),
  updateShare: t('chat:share.updateShare'),
  stopSharing: t('chat:share.stopSharing'),
})

export const getRenameDialogLabels = (t: TranslationFn) => ({
  title: t('chat:rename.title'),
  placeholder: t('chat:rename.placeholder'),
})

export const getEditPopoverLabels = (t: TranslationFn) => ({
  basePlaceholder: t('common:editPopover.basePlaceholder'),
  compactPlaceholders: [
    t('common:editPopover.placeholders.justTellMe'),
    t('common:editPopover.placeholders.describeUpdate'),
    t('common:editPopover.placeholders.whatModify'),
  ],
})

export const getTableLabels = (t: TranslationFn) => ({
  searchPlaceholder: t('common:tables.searchPlaceholder'),
  emptyDefault: t('common:tables.emptyDefault'),
  placeholderEmdash: t('common:placeholder.emdash'),
  permissions: {
    headers: {
      access: t('common:tables.permissions.accessHeader'),
      type: t('common:tables.permissions.typeHeader'),
      pattern: t('common:tables.permissions.patternHeader'),
      comment: t('common:tables.permissions.commentHeader'),
    },
    searchPlaceholder: t('common:tables.permissions.searchPlaceholder'),
    empty: t('common:tables.permissions.empty'),
    patternCopied: t('common:tables.permissions.patternCopied'),
    patternCopyFailed: t('common:tables.permissions.patternCopyFailed'),
    fullscreen: t('common:tables.permissions.fullscreen'),
    subtitle: {
      rule: t('common:tables.permissions.subtitle.rule'),
      rules: t('common:tables.permissions.subtitle.rules'),
    },
    table: {
      customBlockedTool: t('settings:permissions.table.customBlockedTool'),
      customBashPattern: t('settings:permissions.table.customBashPattern'),
      customMcpPattern: t('settings:permissions.table.customMcpPattern'),
      customApiEndpoint: t('settings:permissions.table.customApiEndpoint'),
      allowedWritePath: t('settings:permissions.table.allowedWritePath'),
      writeToPattern: t('settings:permissions.table.writeToPattern'),
    },
  },
  labels: {
    headers: {
      color: t('common:tables.labels.colorHeader'),
      name: t('common:tables.labels.nameHeader'),
      type: t('common:tables.labels.typeHeader'),
    },
    searchPlaceholder: t('common:tables.labels.searchPlaceholder'),
    empty: t('common:tables.labels.empty'),
    fullscreen: t('common:tables.labels.fullscreen'),
    subtitle: {
      label: t('common:tables.labels.subtitle.label'),
      labels: t('common:tables.labels.subtitle.labels'),
    },
  },
  autoRules: {
    headers: {
      label: t('common:tables.autoRules.labelHeader'),
      pattern: t('common:tables.autoRules.patternHeader'),
      flags: t('common:tables.autoRules.flagsHeader'),
      template: t('common:tables.autoRules.templateHeader'),
      description: t('common:tables.autoRules.descriptionHeader'),
    },
    searchPlaceholder: t('common:tables.autoRules.searchPlaceholder'),
    empty: t('common:tables.autoRules.empty'),
    fullscreen: t('common:tables.autoRules.fullscreen'),
    subtitle: {
      rule: t('common:tables.autoRules.subtitle.rule'),
      rules: t('common:tables.autoRules.subtitle.rules'),
    },
    patternCopied: t('common:tables.autoRules.patternCopied'),
    patternCopyFailed: t('common:tables.autoRules.patternCopyFailed'),
  },
  tools: {
    headers: {
      access: t('common:tables.tools.accessHeader'),
      tool: t('common:tables.tools.toolHeader'),
      description: t('common:tables.tools.descriptionHeader'),
    },
    empty: t('common:tables.tools.empty'),
  },
  status: {
    allowed: t('common:permissionsStatus.allowed'),
    blocked: t('common:permissionsStatus.blocked'),
    ask: t('common:permissionsStatus.ask'),
  },
})

export const getPermissionsCommentLabels = (t: TranslationFn) => ({
  writeToPattern: (pattern: string) => t('settings:permissions.table.writeToPattern', { pattern }),
  customBlockedTool: t('settings:permissions.table.customBlockedTool'),
  customBashPattern: t('settings:permissions.table.customBashPattern'),
  customMcpPattern: t('settings:permissions.table.customMcpPattern'),
  customApiEndpoint: t('settings:permissions.table.customApiEndpoint'),
  allowedWritePath: t('settings:permissions.table.allowedWritePath'),
})
