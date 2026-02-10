import type { MainTranslationFn } from './i18n'
import type { MessageBoxOptions, OpenDialogOptions } from 'electron'

export function getMenuI18nLabels(t: MainTranslationFn, updateVersion?: string) {
  return {
    appName: t('menu:appName'),
    aboutApp: t('menu:aboutApp'),
    settings: t('menu:settings'),
    hideApp: t('menu:hideApp'),
    quitApp: t('menu:quitApp'),
    file: t('menu:file'),
    newChat: t('menu:newChat'),
    newWindow: t('menu:newWindow'),
    checkForUpdates: t('menu:checkForUpdates'),
    installUpdate: t('menu:installUpdate'),
    installUpdateWithVersion: t('menu:installUpdateWithVersion', { version: updateVersion ?? '' }),
    debug: t('menu:debug'),
    debugCheckForUpdates: t('menu:debugCheckForUpdates'),
    debugInstallUpdate: t('menu:debugInstallUpdate'),
    resetToDefaults: t('menu:resetToDefaults'),
    help: t('menu:help'),
    helpDocumentation: t('menu:helpDocumentation'),
    keyboardShortcuts: t('menu:keyboardShortcuts'),
    inspectElement: t('menu:inspectElement'),
    cut: t('menu:cut'),
    copy: t('menu:copy'),
    paste: t('menu:paste'),
  }
}

export function getContextMenuI18nLabels(t: MainTranslationFn) {
  return {
    inspectElement: t('menu:inspectElement'),
    cut: t('menu:cut'),
    copy: t('menu:copy'),
    paste: t('menu:paste'),
  }
}

export function buildLogoutDialogOptions(t: MainTranslationFn): MessageBoxOptions {
  return {
    type: 'warning',
    buttons: [t('dialogs:actions.cancel'), t('dialogs:actions.logout')],
    defaultId: 0,
    cancelId: 0,
    title: t('dialogs:logout.title'),
    message: t('dialogs:logout.message'),
    detail: t('dialogs:logout.detail'),
  }
}

export function buildDeleteSessionDialogOptions(t: MainTranslationFn, name: string): MessageBoxOptions {
  return {
    type: 'warning',
    buttons: [t('dialogs:actions.cancel'), t('dialogs:actions.delete')],
    defaultId: 0,
    cancelId: 0,
    title: t('dialogs:deleteSession.title'),
    message: t('dialogs:deleteSession.message', { name }),
    detail: t('dialogs:deleteSession.detail'),
  }
}

export function buildOpenFolderDialogOptions(t: MainTranslationFn): OpenDialogOptions {
  return {
    properties: ['openDirectory', 'createDirectory'],
    title: t('dialogs:openFolder.title'),
  }
}

export function buildGitBashBrowseDialogOptions(t: MainTranslationFn): OpenDialogOptions {
  return {
    title: t('dialogs:gitBash.selectTitle'),
    filters: [{ name: t('dialogs:gitBash.executableFilter'), extensions: ['exe'] }],
    properties: ['openFile'],
    defaultPath: 'C:\\Program Files\\Git\\bin',
  }
}

export function buildResetDefaultsDialogOptions(t: MainTranslationFn): MessageBoxOptions {
  return {
    type: 'info',
    message: t('dialogs:resetDefaults.title'),
    detail: t('dialogs:resetDefaults.detail'),
    buttons: [t('dialogs:actions.ok')],
  }
}
