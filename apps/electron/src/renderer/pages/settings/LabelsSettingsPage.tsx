/**
 * LabelsSettingsPage
 *
 * Displays workspace label configuration in three data tables:
 * 1. Label Hierarchy - tree table with expand/collapse showing all labels
 * 2. Auto-Apply Rules - flat table showing all regex rules across labels
 * 3. Path Rules - path-to-label mappings for automatic labeling based on workingDirectory
 *
 * Each section has an Edit button that opens an EditPopover for AI-assisted editing
 * of the underlying configuration files.
 *
 * Data is loaded via the useLabels and usePathRules hooks which subscribe to live config changes.
 */

import * as React from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import { getDocUrl } from '@craft-agent/shared/docs/doc-links'
import { Loader2 } from 'lucide-react'
import { useAppShellContext, useActiveWorkspace } from '@/context/AppShellContext'
import { useLabels } from '@/hooks/useLabels'
import { usePathRules } from '@/hooks/usePathRules'
import {
  LabelsDataTable,
  AutoRulesDataTable,
  PathRulesDataTable,
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
  const { activeWorkspaceId } = useAppShellContext()
  const activeWorkspace = useActiveWorkspace()
  const { labels, isLoading } = useLabels(activeWorkspaceId)
  const { rules: pathRules, isLoading: isLoadingPathRules } = usePathRules(activeWorkspaceId)

  // Resolve edit configs using the workspace root path
  const rootPath = activeWorkspace?.rootPath || ''
  const labelsEditConfig = getEditConfig('edit-labels', rootPath)
  const autoRulesEditConfig = getEditConfig('edit-auto-rules', rootPath)
  const pathRulesEditConfig = getEditConfig('edit-path-rules', rootPath)

  // Secondary action: open the labels config file directly in system editor
  const editFileAction = rootPath ? {
    label: 'Edit File',
    filePath: `${rootPath}/labels/config.json`,
  } : undefined

  // Secondary action for path rules
  const pathRulesEditFileAction = rootPath ? {
    label: 'Edit File',
    filePath: `${rootPath}/labels/path-rules.json`,
  } : undefined

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title="Labels" actions={<HeaderMenu route={routes.view.settings('labels')} />} />
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
                  <SettingsSection title="About Labels">
                    <SettingsCard className="px-4 py-3.5">
                      <div className="text-sm text-muted-foreground leading-relaxed space-y-1.5">
                        <p>
                          Labels help you organize sessions with colored tags. Use them to categorize conversations by project, topic, or priority — making it easy to filter and find related sessions later.
                        </p>
                        <p>
                          Each label can optionally carry a <span className="text-foreground/80 font-medium">value</span> with a specific type (text, number, or date). This turns labels into structured metadata — for example, a "priority" label with value 3, or a "due" label with a date.
                        </p>
                        <p>
                          <span className="text-foreground/80 font-medium">Auto-apply rules</span> assign labels automatically when a message matches a regex pattern. For example, pasting a Linear issue URL can auto-tag the session with the project name and issue ID — no manual tagging needed.
                        </p>
                        <p>
                          <button
                            type="button"
                            onClick={() => window.electronAPI?.openUrl(getDocUrl('labels'))}
                            className="text-foreground/70 hover:text-foreground underline underline-offset-2"
                          >
                            Learn more
                          </button>
                        </p>
                      </div>
                    </SettingsCard>
                  </SettingsSection>

                  {/* Label Hierarchy Section */}
                  <SettingsSection
                    title="Label Hierarchy"
                    description="All labels configured for this workspace. Labels can be nested to form groups."
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
                          fullscreenTitle="Label Hierarchy"
                        />
                      ) : (
                        <div className="p-8 text-center text-muted-foreground">
                          <p className="text-sm">No labels configured.</p>
                          <p className="text-xs mt-1 text-foreground/40">
                            Labels can be created by the agent or by editing <code className="bg-foreground/5 px-1 rounded">labels/config.json</code> in your workspace.
                          </p>
                        </div>
                      )}
                    </SettingsCard>
                  </SettingsSection>

                  {/* Auto-Apply Rules Section */}
                  <SettingsSection
                    title="Auto-Apply Rules"
                    description="Regex patterns that automatically apply labels when matched in user messages. For example, paste a Linear issue URL and automatically tag the session with the project name and issue ID."
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
                        fullscreenTitle="Auto-Apply Rules"
                      />
                    </SettingsCard>
                  </SettingsSection>

                  {/* Path Rules Section */}
                  <SettingsSection
                    title="Path Rules"
                    description="Automatically apply labels based on the session's working directory. When you start a chat in a specific folder, matching labels are automatically assigned."
                    action={
                      <EditPopover
                        trigger={<EditButton />}
                        context={pathRulesEditConfig.context}
                        example={pathRulesEditConfig.example}
                        model={pathRulesEditConfig.model}
                        systemPromptPreset={pathRulesEditConfig.systemPromptPreset}
                        secondaryAction={pathRulesEditFileAction}
                      />
                    }
                  >
                    <SettingsCard className="p-0">
                      {isLoadingPathRules ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : pathRules.length > 0 ? (
                        <PathRulesDataTable
                          rules={pathRules}
                          labels={labels}
                          searchable
                          maxHeight={350}
                          fullscreen
                          fullscreenTitle="Path Rules"
                        />
                      ) : (
                        <div className="p-8 text-center text-muted-foreground">
                          <p className="text-sm">No path rules configured.</p>
                          <p className="text-xs mt-1 text-foreground/40">
                            Path rules can be created by the agent or by editing <code className="bg-foreground/5 px-1 rounded">labels/path-rules.json</code> in your workspace.
                          </p>
                        </div>
                      )}
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
