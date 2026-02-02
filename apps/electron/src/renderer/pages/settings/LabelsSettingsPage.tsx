/**
 * LabelsSettingsPage
 *
 * Displays workspace label configuration in two data tables:
 * 1. Label Hierarchy - tree table with expand/collapse showing all labels
 * 2. Auto-Apply Rules - flat table showing all regex rules across labels
 *
 * Each section has an Edit button that opens an EditPopover for AI-assisted editing
 * of the underlying labels/config.json file.
 *
 * Data is loaded via the useLabels hook which subscribes to live config changes.
 */

import * as React from 'react'
import { useI18n } from '@/i18n'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import { getDocUrl } from '@craft-agent/shared/docs/doc-links'
import { Loader2 } from 'lucide-react'
import { useAppShellContext, useActiveWorkspace } from '@/context/AppShellContext'
import { useLabels } from '@/hooks/useLabels'
import {
  LabelsDataTable,
  AutoRulesDataTable,
} from '@/components/info'
import {
  SettingsSection,
  SettingsCard,
} from '@/components/settings'
import { routes } from '@/lib/navigate'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'labels',
}

export default function LabelsSettingsPage() {
  const { t } = useI18n('settings')
  const { activeWorkspaceId } = useAppShellContext()
  const activeWorkspace = useActiveWorkspace()
  const { labels, isLoading } = useLabels(activeWorkspaceId)

  // Resolve edit configs using the workspace root path
  const rootPath = activeWorkspace?.rootPath || ''
  const labelsEditConfig = getEditConfig('edit-labels', rootPath)
  const autoRulesEditConfig = getEditConfig('edit-auto-rules', rootPath)

  // Secondary action: open the labels config file directly in system editor
  const editFileAction = rootPath ? {
    label: t('labels.editFile'),
    filePath: `${rootPath}/labels/config.json`,
  } : undefined

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t('labels.title')} actions={<HeaderMenu route={routes.view.settings('labels')} />} />
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
                  {/* About Section */}
                  <SettingsSection title={t('labels.aboutLabels.title')}>
                    <SettingsCard className="px-4 py-3.5">
                      <div className="text-sm text-muted-foreground leading-relaxed space-y-1.5">
                        <p>
                          {t('labels.aboutLabels.paragraph1')}
                        </p>
                        <p>
                          {t('labels.aboutLabels.paragraph2')}
                        </p>
                        <p>
                          {t('labels.aboutLabels.paragraph3')}
                        </p>
                        <p>
                          <button
                            type="button"
                            onClick={() => window.electronAPI?.openUrl(getDocUrl('labels'))}
                            className="text-foreground/70 hover:text-foreground underline underline-offset-2"
                          >
                            {t('labels.aboutLabels.learnMore')}
                          </button>
                        </p>
                      </div>
                    </SettingsCard>
                  </SettingsSection>

                  {/* Label Hierarchy Section */}
                  <SettingsSection
                    title={t('labels.labelHierarchy.title')}
                    description={t('labels.labelHierarchy.description')}
                    action={
                      <EditPopover
                        trigger={<EditButton />}
                        context={labelsEditConfig.context}
                        example={labelsEditConfig.example}
                        model={labelsEditConfig.model}
                        systemPromptPreset={labelsEditConfig.systemPromptPreset}
                        secondaryAction={editFileAction}
                      />
                    }
                  >
                    <SettingsCard className="p-0">
                      {labels.length > 0 ? (
                        <LabelsDataTable
                          data={labels}
                          searchable
                          maxHeight={350}
                          fullscreen
                          fullscreenTitle={t('labels.labelHierarchy.title')}
                        />
                      ) : (
                        <div className="p-8 text-center text-muted-foreground">
                          <p className="text-sm">{t('labels.labelHierarchy.empty')}</p>
                          <p className="text-xs mt-1 text-foreground/40">
                            {t('labels.labelHierarchy.emptyHint')}
                          </p>
                        </div>
                      )}
                    </SettingsCard>
                  </SettingsSection>

                  {/* Auto-Apply Rules Section */}
                  <SettingsSection
                    title={t('labels.autoRules.title')}
                    description={t('labels.autoRules.description')}
                    action={
                      <EditPopover
                        trigger={<EditButton />}
                        context={autoRulesEditConfig.context}
                        example={autoRulesEditConfig.example}
                        model={autoRulesEditConfig.model}
                        systemPromptPreset={autoRulesEditConfig.systemPromptPreset}
                        secondaryAction={editFileAction}
                      />
                    }
                  >
                    <SettingsCard className="p-0">
                      <AutoRulesDataTable
                        data={labels}
                        searchable
                        maxHeight={350}
                        fullscreen
                        fullscreenTitle={t('labels.autoRules.fullscreenTitle')}
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
