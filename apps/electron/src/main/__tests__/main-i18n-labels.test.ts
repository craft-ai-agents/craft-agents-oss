import { describe, expect, it } from 'bun:test'
import { getContextMenuI18nLabels, getMenuI18nLabels } from '../i18n-labels'
import {
  buildDeleteSessionDialogOptions,
  buildGitBashBrowseDialogOptions,
  buildLogoutDialogOptions,
  buildOpenFolderDialogOptions,
} from '../i18n-labels'

describe('main process i18n key mappings', () => {
  it('maps menu labels to menu namespace keys', () => {
    const t = (key: string, params?: Record<string, string | number>) => {
      if (key === 'menu:installUpdateWithVersion') {
        return `menu:installUpdateWithVersion:${params?.version}`
      }
      return key
    }

    const labels = getMenuI18nLabels(t, '1.2.3')

    expect(labels.appName).toBe('menu:appName')
    expect(labels.aboutApp).toBe('menu:aboutApp')
    expect(labels.checkForUpdates).toBe('menu:checkForUpdates')
    expect(labels.installUpdateWithVersion).toBe('menu:installUpdateWithVersion:1.2.3')
    expect(labels.newChat).toBe('menu:newChat')
    expect(labels.helpDocumentation).toBe('menu:helpDocumentation')
    expect(labels.inspectElement).toBe('menu:inspectElement')
  })

  it('maps dev context menu labels to menu namespace keys', () => {
    const t = (key: string) => key
    const labels = getContextMenuI18nLabels(t)

    expect(labels.inspectElement).toBe('menu:inspectElement')
    expect(labels.cut).toBe('menu:cut')
    expect(labels.copy).toBe('menu:copy')
    expect(labels.paste).toBe('menu:paste')
  })

  it('maps logout confirmation dialog to dialogs namespace keys', () => {
    const t = (key: string) => key
    const options = buildLogoutDialogOptions(t)

    expect(options.buttons).toEqual(['dialogs:actions.cancel', 'dialogs:actions.logout'])
    expect(options.title).toBe('dialogs:logout.title')
    expect(options.message).toBe('dialogs:logout.message')
    expect(options.detail).toBe('dialogs:logout.detail')
  })

  it('maps delete session dialog to dialogs namespace keys with interpolation', () => {
    const t = (key: string, params?: Record<string, string | number>) => {
      if (key === 'dialogs:deleteSession.message') {
        return `delete:${params?.name}`
      }
      return key
    }
    const options = buildDeleteSessionDialogOptions(t, 'Session A')

    expect(options.buttons).toEqual(['dialogs:actions.cancel', 'dialogs:actions.delete'])
    expect(options.title).toBe('dialogs:deleteSession.title')
    expect(options.message).toBe('delete:Session A')
    expect(options.detail).toBe('dialogs:deleteSession.detail')
  })

  it('maps file/folder dialog labels to dialogs namespace keys', () => {
    const t = (key: string) => key
    const gitBashOptions = buildGitBashBrowseDialogOptions(t)
    const openFolderOptions = buildOpenFolderDialogOptions(t)

    expect(gitBashOptions.title).toBe('dialogs:gitBash.selectTitle')
    expect(gitBashOptions.filters?.[0]?.name).toBe('dialogs:gitBash.executableFilter')
    expect(openFolderOptions.title).toBe('dialogs:openFolder.title')
  })
})
