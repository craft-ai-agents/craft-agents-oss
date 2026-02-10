import { describe, expect, it } from 'bun:test'
import type { TFunction } from 'i18next'
import { getRenameDialogLabels } from '../rename-dialog'
import { getResetDialogLabels } from '../../ResetConfirmationDialog'

describe('common dialog labels', () => {
  it('returns localized labels', () => {
    const t: TFunction = ((key: string) => ({
      'common:actions.cancel': '取消',
      'common:actions.save': '保存',
      'common:rename.title': '重命名',
      'common:rename.placeholder': '输入名称...',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getRenameDialogLabels(t)
    expect(labels.title).toBe('重命名')
    expect(labels.placeholder).toBe('输入名称...')
    expect(labels.cancel).toBe('取消')
    expect(labels.save).toBe('保存')
  })

  it('returns localized reset dialog labels', () => {
    const t: TFunction = ((key: string) => ({
      'common:reset.title': '重置应用',
      'common:reset.description': '这将永久删除：',
      'common:reset.warningTitle': '请先备份重要数据！',
      'common:reset.warningDescription': '此操作无法撤销。',
      'common:reset.confirmationPrompt': '确认请计算：{{a}} + {{b}} =',
      'common:reset.placeholder': '输入答案',
      'common:reset.confirm': '重置应用',
      'common:reset.items.workspaces': '所有工作区及其设置',
      'common:reset.items.credentials': '所有凭据与 API Key',
      'common:reset.items.preferences': '所有偏好设置与会话数据',
      'common:actions.cancel': '取消',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getResetDialogLabels(t)
    expect(labels.title).toBe('重置应用')
    expect(labels.description).toBe('这将永久删除：')
    expect(labels.warningTitle).toBe('请先备份重要数据！')
    expect(labels.warningDescription).toBe('此操作无法撤销。')
    expect(labels.confirmationPrompt).toBe('确认请计算：{{a}} + {{b}} =')
    expect(labels.placeholder).toBe('输入答案')
    expect(labels.cancel).toBe('取消')
    expect(labels.confirm).toBe('重置应用')
    expect(labels.items).toEqual([
      '所有工作区及其设置',
      '所有凭据与 API Key',
      '所有偏好设置与会话数据',
    ])
  })
})
