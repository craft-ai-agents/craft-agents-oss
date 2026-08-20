/**
 * LabelsSettingsPage
 *
 * Native-first label hierarchy editor:
 * - Inline rename, color picker, add child, delete
 * - Primary Save / Add actions
 * - Secondary «Спросить ИИ» opens existing EditPopover
 *
 * Auto-apply rules section keeps AI secondary as well.
 */

import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ColorPicker } from '@/components/ui/color-picker'
import { LabelIcon } from '@/components/ui/label-icon'
import { getDocUrl } from '@craft-agent/shared/docs/doc-links'
import { useAppShellContext, useActiveWorkspace } from '@/context/AppShellContext'
import { useLabels } from '@/hooks/useLabels'
import { useTheme } from '@/hooks/useTheme'
import { AutoRulesDataTable } from '@/components/info'
import {
  SettingsSection,
  SettingsCard,
} from '@/components/settings'
import { routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import { resolveEntityColor } from '@craft-agent/shared/colors'
import type { EntityColor } from '@craft-agent/shared/colors'
import type { LabelConfig } from '@craft-agent/shared/labels'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { resolveLabelDisplayName } from '@/config/session-status-config'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'labels',
}

const LABEL_COLOR_PRESETS = [
  '#3B82F6',
  '#8B5CF6',
  '#F43F5E',
  '#14B8A6',
  '#F59E0B',
  '#10B981',
  '#F97316',
  '#06B6D4',
  '#A855F7',
  '#64748B',
] as const

function colorToHex(color: EntityColor | undefined, isDark: boolean): string {
  if (!color) return ''
  if (typeof color === 'object' && color !== null && 'light' in color) {
    return (isDark ? color.dark : color.light) ?? ''
  }
  // System colors → resolved CSS is not always hex; fall back to empty for picker value
  const resolved = resolveEntityColor(color, isDark)
  return resolved.startsWith('#') ? resolved : ''
}

function hexToEntityColor(hex: string): EntityColor {
  const normalized = hex.startsWith('#') ? hex : `#${hex}`
  return { light: normalized, dark: normalized }
}

interface FlatLabelRow {
  label: LabelConfig
  depth: number
  parentId: string | null
}

function flattenWithDepth(labels: LabelConfig[], depth = 0, parentId: string | null = null): FlatLabelRow[] {
  const rows: FlatLabelRow[] = []
  for (const label of labels) {
    rows.push({ label, depth, parentId })
    if (label.children?.length) {
      rows.push(...flattenWithDepth(label.children, depth + 1, label.id))
    }
  }
  return rows
}

function AskAiButton({
  label,
  ...props
}: React.ComponentPropsWithoutRef<typeof Button> & { label: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 px-3 rounded-[6px] bg-background/60 shadow-minimal text-foreground/60 hover:text-foreground"
      {...props}
    >
      {label}
    </Button>
  )
}

export default function LabelsSettingsPage() {
  const { t } = useTranslation()
  const { isDark } = useTheme()
  const { activeWorkspaceId } = useAppShellContext()
  const activeWorkspace = useActiveWorkspace()
  const { labels, isLoading, refresh } = useLabels(activeWorkspaceId)

  const rootPath = activeWorkspace?.rootPath || ''
  const workspaceId = activeWorkspaceId || activeWorkspace?.id || ''
  const labelsEditConfig = getEditConfig('edit-labels', rootPath)
  const autoRulesEditConfig = getEditConfig('edit-auto-rules', rootPath)

  const editFileAction = rootPath
    ? {
        label: t('common.editFile'),
        filePath: `${rootPath}/labels/config.json`,
      }
    : undefined

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [draftNames, setDraftNames] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [addingParentId, setAddingParentId] = useState<string | null | undefined>(undefined)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#3B82F6')
  const [creating, setCreating] = useState(false)

  const rows = useMemo(() => {
    const all = flattenWithDepth(labels)
    return all.filter((row) => {
      // Walk parents; hide if any collapsed
      let parentId = row.parentId
      while (parentId) {
        if (expanded[parentId] === false) return false
        const parent = all.find((r) => r.label.id === parentId)
        parentId = parent?.parentId ?? null
      }
      return true
    })
  }, [labels, expanded])

  const isExpanded = useCallback(
    (id: string) => expanded[id] !== false,
    [expanded],
  )

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => ({
      ...prev,
      [id]: prev[id] === false ? true : false,
    }))
  }, [])

  const getDraftName = useCallback(
    (label: LabelConfig) => draftNames[label.id] ?? resolveLabelDisplayName(label, t),
    [draftNames, t],
  )

  const handleNameChange = useCallback((id: string, value: string) => {
    setDraftNames((prev) => ({ ...prev, [id]: value }))
  }, [])

  const handleSaveName = useCallback(
    async (label: LabelConfig) => {
      if (!workspaceId) return
      const next = (draftNames[label.id] ?? label.name).trim()
      if (!next || next === label.name) {
        setDraftNames((prev) => {
          const copy = { ...prev }
          delete copy[label.id]
          return copy
        })
        return
      }
      setSavingId(label.id)
      try {
        await window.electronAPI.updateLabel(workspaceId, label.id, { name: next })
        setDraftNames((prev) => {
          const copy = { ...prev }
          delete copy[label.id]
          return copy
        })
        await refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('settings.labels.saveFailed'))
      } finally {
        setSavingId(null)
      }
    },
    [workspaceId, draftNames, refresh, t],
  )

  const handleColorChange = useCallback(
    async (label: LabelConfig, hex: string) => {
      if (!workspaceId || !hex) return
      setSavingId(label.id)
      try {
        await window.electronAPI.updateLabel(workspaceId, label.id, {
          color: hexToEntityColor(hex),
        })
        await refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('settings.labels.saveFailed'))
      } finally {
        setSavingId(null)
      }
    },
    [workspaceId, refresh, t],
  )

  const handleDelete = useCallback(
    async (label: LabelConfig) => {
      if (!workspaceId) return
      const ok = window.confirm(
        t('settings.labels.deleteConfirm', { name: resolveLabelDisplayName(label, t) }),
      )
      if (!ok) return
      setSavingId(label.id)
      try {
        await window.electronAPI.deleteLabel(workspaceId, label.id)
        await refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('settings.labels.deleteFailed'))
      } finally {
        setSavingId(null)
      }
    },
    [workspaceId, refresh, t],
  )

  const openAddForm = useCallback((parentId: string | null) => {
    setAddingParentId(parentId)
    setNewName('')
    setNewColor('#3B82F6')
  }, [])

  const handleCreate = useCallback(async () => {
    if (!workspaceId || !newName.trim()) return
    setCreating(true)
    try {
      await window.electronAPI.createLabel(workspaceId, {
        name: newName.trim(),
        color: hexToEntityColor(newColor),
        parentId: addingParentId || undefined,
      })
      setAddingParentId(undefined)
      setNewName('')
      // Expand parent so the new child is visible
      if (addingParentId) {
        setExpanded((prev) => ({ ...prev, [addingParentId]: true }))
      }
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.labels.createFailed'))
    } finally {
      setCreating(false)
    }
  }, [workspaceId, newName, newColor, addingParentId, refresh, t])

  const askAiLabel = t('common.askAi')

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t('settings.labels.title')} actions={<HeaderMenu route={routes.view.settings('labels')} />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-8">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <SettingsSection title={t('settings.labels.aboutLabels')}>
                    <SettingsCard className="px-4 py-3.5">
                      <div className="text-sm text-muted-foreground leading-relaxed space-y-1.5">
                        <p>{t('settings.labels.aboutText1')}</p>
                        <p>{t('settings.labels.aboutText2')}</p>
                        <p>{t('settings.labels.aboutText3')}</p>
                        <p>
                          <button
                            type="button"
                            onClick={() => window.electronAPI?.openUrl(getDocUrl('labels'))}
                            className="text-foreground/70 hover:text-foreground underline underline-offset-2"
                          >
                            {t('chat.learnMore')}
                          </button>
                        </p>
                      </div>
                    </SettingsCard>
                  </SettingsSection>

                  <SettingsSection
                    title={t('settings.labels.labelHierarchy')}
                    description={t('settings.labels.labelHierarchyDesc')}
                    action={
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 px-3 rounded-[6px]"
                          onClick={() => openAddForm(null)}
                        >
                          <Plus className="w-3.5 h-3.5 mr-1" />
                          {t('settings.labels.addRoot')}
                        </Button>
                        {rootPath && (
                          <EditPopover
                            trigger={<AskAiButton label={askAiLabel} />}
                            context={labelsEditConfig.context}
                            example={labelsEditConfig.example}
                            displayLabel={labelsEditConfig.displayLabel}
                            model={labelsEditConfig.model}
                            systemPromptPreset={labelsEditConfig.systemPromptPreset}
                            secondaryAction={editFileAction}
                          />
                        )}
                      </div>
                    }
                  >
                    <SettingsCard className="p-0 overflow-hidden">
                      {labels.length === 0 && addingParentId === undefined ? (
                        <div className="p-8 text-center text-muted-foreground">
                          <p className="text-sm">{t('settings.labels.noLabels')}</p>
                          <p className="text-xs mt-1 text-foreground/40">
                            {t('settings.labels.noLabelsDesc')}
                          </p>
                        </div>
                      ) : (
                        <div className="divide-y divide-border/40">
                          {rows.map(({ label, depth }) => {
                            const hasChildren = !!label.children?.length
                            const draft = getDraftName(label)
                            const dirty = draft.trim() !== label.name
                            const hex = colorToHex(label.color, isDark)
                            const busy = savingId === label.id

                            return (
                              <div
                                key={label.id}
                                className={cn(
                                  'flex items-center gap-2 px-3 py-2 min-h-11',
                                  busy && 'opacity-60 pointer-events-none',
                                )}
                                style={{ paddingLeft: `${depth * 16 + 12}px` }}
                              >
                                {hasChildren ? (
                                  <button
                                    type="button"
                                    onClick={() => toggleExpanded(label.id)}
                                    className="p-0.5 rounded hover:bg-foreground/5 shrink-0"
                                    aria-label={isExpanded(label.id) ? 'Collapse' : 'Expand'}
                                  >
                                    <ChevronRight
                                      className={cn(
                                        'w-3.5 h-3.5 text-muted-foreground transition-transform',
                                        isExpanded(label.id) && 'rotate-90',
                                      )}
                                    />
                                  </button>
                                ) : (
                                  <span className="w-4.5 shrink-0" />
                                )}

                                <ColorPicker
                                  value={hex}
                                  onChange={(next) => handleColorChange(label, next)}
                                  presets={LABEL_COLOR_PRESETS}
                                  fallbackColor="#64748B"
                                  ariaLabel={t('common.color')}
                                  trigger={
                                    <button
                                      type="button"
                                      className="shrink-0 rounded-full focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                      aria-label={t('common.color')}
                                    >
                                      <LabelIcon
                                        label={label}
                                        size="sm"
                                        hasChildren={hasChildren}
                                      />
                                    </button>
                                  }
                                />

                                <Input
                                  value={draft}
                                  onChange={(e) => handleNameChange(label.id, e.target.value)}
                                  onBlur={() => handleSaveName(label)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.currentTarget.blur()
                                    } else if (e.key === 'Escape') {
                                      setDraftNames((prev) => {
                                        const copy = { ...prev }
                                        delete copy[label.id]
                                        return copy
                                      })
                                      e.currentTarget.blur()
                                    }
                                  }}
                                  className="h-8 text-sm flex-1 min-w-0 bg-muted/30 border-border/50"
                                  aria-label={t('common.name')}
                                />

                                {dirty && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-7 px-2.5 shrink-0"
                                    onClick={() => handleSaveName(label)}
                                  >
                                    {t('common.save')}
                                  </Button>
                                )}

                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-foreground"
                                  onClick={() => openAddForm(label.id)}
                                  title={t('settings.labels.addChild')}
                                  aria-label={t('settings.labels.addChild')}
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </Button>

                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                                  onClick={() => handleDelete(label)}
                                  title={t('common.delete')}
                                  aria-label={t('common.delete')}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            )
                          })}

                          {addingParentId !== undefined && (
                            <div
                              className="flex items-center gap-2 px-3 py-2.5 bg-muted/20"
                              style={{
                                paddingLeft: `${
                                  (addingParentId
                                    ? (rows.find((r) => r.label.id === addingParentId)?.depth ?? 0) + 1
                                    : 0) *
                                    16 +
                                  12
                                }px`,
                              }}
                            >
                              <ColorPicker
                                value={newColor}
                                onChange={setNewColor}
                                presets={LABEL_COLOR_PRESETS}
                                ariaLabel={t('common.color')}
                              />
                              <Input
                                autoFocus
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void handleCreate()
                                  if (e.key === 'Escape') setAddingParentId(undefined)
                                }}
                                placeholder={t('settings.labels.newLabelPlaceholder')}
                                className="h-8 text-sm flex-1 min-w-0 bg-background border-border/50"
                              />
                              <Button
                                type="button"
                                size="sm"
                                className="h-7 px-2.5"
                                disabled={!newName.trim() || creating}
                                onClick={() => void handleCreate()}
                              >
                                {creating ? t('common.saving') : t('common.create')}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2.5"
                                onClick={() => setAddingParentId(undefined)}
                              >
                                {t('common.cancel')}
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </SettingsCard>
                  </SettingsSection>

                  <SettingsSection
                    title={t('settings.labels.autoApplyRules')}
                    description={t('settings.labels.autoApplyRulesDesc')}
                    action={
                      rootPath ? (
                        <EditPopover
                          trigger={<AskAiButton label={askAiLabel} />}
                          context={autoRulesEditConfig.context}
                          example={autoRulesEditConfig.example}
                          displayLabel={autoRulesEditConfig.displayLabel}
                          model={autoRulesEditConfig.model}
                          systemPromptPreset={autoRulesEditConfig.systemPromptPreset}
                          secondaryAction={editFileAction}
                        />
                      ) : undefined
                    }
                  >
                    <SettingsCard className="p-0">
                      <AutoRulesDataTable
                        data={labels}
                        searchable
                        maxHeight={350}
                        fullscreen
                        fullscreenTitle={t('settings.labels.autoApplyRules')}
                      />
                    </SettingsCard>
                  </SettingsSection>
                </>
              )}
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
