/**
 * AiSettingsPage
 *
 * Unified AI settings page that consolidates all LLM-related configuration:
 * - Default connection, model, and thinking level
 * - Per-workspace overrides
 * - Connection management (add/edit/delete)
 *
 * Follows the Appearance settings pattern: app-level defaults + workspace overrides.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'
import { X, MoreHorizontal, Pencil, Trash2, Star, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, RefreshCcw } from 'lucide-react'
import type { CredentialHealthStatus, CredentialHealthIssue } from '../../../shared/types'
import { Spinner, FullscreenOverlayBase } from '@g4os/ui'
import { useSetAtom } from 'jotai'
import { fullscreenOverlayOpenAtom } from '@/atoms/overlay'
import { motion, AnimatePresence } from 'motion/react'
import type { LlmConnectionWithStatus, ThinkingLevel, WorkspaceSettings, Workspace } from '../../../shared/types'
import { DEFAULT_THINKING_LEVEL, THINKING_LEVELS } from '@g4os/shared/agent/thinking-levels'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import { getProviderIcon, getProviderDisplayName } from '@/lib/provider-icons'

import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsMenuSelectRow,
} from '@/components/settings'
import { useOnboarding } from '@/hooks/useOnboarding'
import { useWorkspaceIcon } from '@/hooks/useWorkspaceIcon'
import { OnboardingWizard } from '@/components/onboarding'
import { useAppShellContext } from '@/context/AppShellContext'
import { useLocale } from '@/context/LocaleContext'
import { getDefaultModelForProvider, getModelShortName, getModelOptionsForProvider, DEFAULT_MODEL, DEFAULT_CODEX_MODEL, type ModelDefaults } from '@config/models'
import type { ModelProvider } from '@config/models'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'ai',
}

// ============================================
// Credential Health Warning Banner
// ============================================

/** Get user-friendly message for credential health issue */
function getHealthIssueMessage(issue: CredentialHealthIssue, t: (key: any, params?: any) => string): string {
  switch (issue.type) {
    case 'file_corrupted':
      return t('settings.ai.healthFileCorrupted')
    case 'decryption_failed':
      return t('settings.ai.healthDecryptionFailed')
    case 'no_default_credentials':
      return t('settings.ai.healthNoDefault')
    default:
      return issue.message || t('settings.ai.healthGeneric')
  }
}

interface CredentialHealthBannerProps {
  issues: CredentialHealthIssue[]
  onReauthenticate: () => void
}

function CredentialHealthBanner({ issues, onReauthenticate }: CredentialHealthBannerProps) {
  const { t } = useLocale()
  if (issues.length === 0) return null

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 mb-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-amber-700 dark:text-amber-400">
            {t('settings.ai.credentialIssue')}
          </h4>
          <p className="mt-1 text-sm text-amber-600 dark:text-amber-300/80">
            {getHealthIssueMessage(issues[0], t)}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onReauthenticate}
          className="flex-shrink-0 border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
        >
          {t('settings.ai.reauthenticate')}
        </Button>
      </div>
    </div>
  )
}

// ============================================
// Connection Row Component
// ============================================

type ValidationState = 'idle' | 'validating' | 'success' | 'error'

interface ConnectionRowProps {
  connection: LlmConnectionWithStatus
  isLastConnection: boolean
  onEdit: () => void
  onDelete: () => void
  onSetDefault: () => void
  onValidate: () => void
  onReauthenticate: () => void
  validationState: ValidationState
  validationError?: string
}

function ConnectionRow({ connection, isLastConnection, onEdit, onDelete, onSetDefault, onValidate, onReauthenticate, validationState, validationError }: ConnectionRowProps) {
  const { t } = useLocale()
  const [menuOpen, setMenuOpen] = useState(false)

  // Build description with provider, default indicator, auth status, and validation state
  const getDescription = () => {
    // Show validation state if not idle
    if (validationState === 'validating') return t('settings.ai.validating')
    if (validationState === 'success') return t('settings.ai.connectionValid')
    if (validationState === 'error') return validationError || t('settings.ai.validationFailed')

    const parts: string[] = []

    // Provider type (fall back to legacy 'type' field if providerType missing)
    const provider = connection.providerType || connection.type
    if (provider) {
      parts.push(getProviderDisplayName(provider, connection.baseUrl))
    } else {
      parts.push('Unknown')
    }

    // Auth status
    if (!connection.isAuthenticated) parts.push(t('settings.ai.notAuthenticated'))

    return parts.join(' · ')
  }

  const providerType = connection.providerType || connection.type
  const iconUrl = providerType ? getProviderIcon(providerType, connection.baseUrl) : undefined

  return (
    <SettingsRow
      label={(
        <div className="flex items-center gap-1.5">
          {iconUrl && (
            <img src={iconUrl} alt="" className="h-4 w-4 opacity-60 dark:invert" />
          )}
          <span>{connection.name}</span>
          {connection.isDefault && (
            <span className="inline-flex items-center h-5 px-2 text-[11px] font-medium rounded-[4px] bg-background shadow-minimal text-foreground/60">
              {t('settings.ai.badgeDefault')}
            </span>
          )}
        </div>
      )}
      description={getDescription()}
    >
      <DropdownMenu modal={true} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className="p-1.5 rounded-md hover:bg-foreground/[0.05] data-[state=open]:bg-foreground/[0.05] transition-colors"
            data-state={menuOpen ? 'open' : 'closed'}
          >
            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <StyledDropdownMenuContent align="end">
          <StyledDropdownMenuItem onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
            <span>{t('settings.ai.menuEdit')}</span>
          </StyledDropdownMenuItem>
          {!connection.isDefault && (
            <StyledDropdownMenuItem onClick={onSetDefault}>
              <Star className="h-3.5 w-3.5" />
              <span>{t('settings.ai.menuSetDefault')}</span>
            </StyledDropdownMenuItem>
          )}
          <StyledDropdownMenuItem
            onClick={onReauthenticate}
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            <span>{t('settings.ai.menuReauthenticate')}</span>
          </StyledDropdownMenuItem>
          <StyledDropdownMenuItem
            onClick={onValidate}
            disabled={validationState === 'validating'}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{t('settings.ai.menuValidate')}</span>
          </StyledDropdownMenuItem>
          <StyledDropdownMenuSeparator />
          <StyledDropdownMenuItem
            onClick={onDelete}
            variant="destructive"
            disabled={isLastConnection}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{t('settings.ai.menuDelete')}</span>
          </StyledDropdownMenuItem>
        </StyledDropdownMenuContent>
      </DropdownMenu>
    </SettingsRow>
  )
}

// ============================================
// Workspace Override Card Component
// ============================================

interface WorkspaceOverrideCardProps {
  workspace: Workspace
  llmConnections: LlmConnectionWithStatus[]
  customModel: string | null
  onSettingsChange: () => void
}

function WorkspaceOverrideCard({ workspace, llmConnections, customModel, onSettingsChange }: WorkspaceOverrideCardProps) {
  const { t } = useLocale()
  const [isExpanded, setIsExpanded] = useState(false)
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Fetch workspace icon as data URL (file:// URLs don't work in renderer)
  const iconUrl = useWorkspaceIcon(workspace)

  // Load workspace settings
  useEffect(() => {
    const loadSettings = async () => {
      if (!window.electronAPI) return
      setIsLoading(true)
      try {
        const ws = await window.electronAPI.getWorkspaceSettings(workspace.id)
        setSettings(ws)
      } catch (error) {
        console.error('Failed to load workspace settings:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadSettings()
  }, [workspace.id])

  // Save workspace setting helper
  const updateSetting = useCallback(async <K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) => {
    if (!window.electronAPI) return
    try {
      await window.electronAPI.updateWorkspaceSetting(workspace.id, key, value)
      setSettings(prev => prev ? { ...prev, [key]: value } : null)
      onSettingsChange()
    } catch (error) {
      console.error(`Failed to save ${key}:`, error)
    }
  }, [workspace.id, onSettingsChange])

  const handleConnectionChange = useCallback((slug: string) => {
    // 'global' means use app default (clear workspace override)
    updateSetting('defaultLlmConnection', slug === 'global' ? undefined : slug)
  }, [updateSetting])

  const handleModelChange = useCallback((model: string) => {
    // 'global' means use app default (clear workspace override)
    updateSetting('model', model === 'global' ? undefined : model)
  }, [updateSetting])

  const handleThinkingChange = useCallback((level: string) => {
    // 'global' means use app default (clear workspace override)
    updateSetting('thinkingLevel', level === 'global' ? undefined : level as ThinkingLevel)
  }, [updateSetting])

  // Determine if workspace has any overrides
  const hasOverrides = settings && (
    settings.defaultLlmConnection ||
    settings.model ||
    settings.thinkingLevel
  )

  // Get display values
  const currentConnection = settings?.defaultLlmConnection || 'global'
  const currentModel = settings?.model || 'global'
  const currentThinking = settings?.thinkingLevel || 'global'

  // Derive model provider from this workspace's connection override (or fall back to default connection)
  const workspaceModelProvider: ModelProvider = useMemo(() => {
    const connSlug = settings?.defaultLlmConnection
    const conn = connSlug ? llmConnections.find(c => c.slug === connSlug) : llmConnections.find(c => c.isDefault)
    const pt = conn?.providerType
    return (pt === 'openai' || pt === 'openai_compat') ? 'openai' : 'anthropic'
  }, [settings?.defaultLlmConnection, llmConnections])

  // Get summary text for collapsed state
  const getSummary = () => {
    if (!hasOverrides) return t('settings.ai.usingDefaults')
    const parts: string[] = []
    if (settings?.defaultLlmConnection) {
      const conn = llmConnections.find(c => c.slug === settings.defaultLlmConnection)
      parts.push(conn?.name || settings.defaultLlmConnection)
    }
    if (settings?.model) {
      parts.push(getModelShortName(settings.model))
    }
    if (settings?.thinkingLevel) {
      const level = THINKING_LEVELS.find(l => l.id === settings.thinkingLevel)
      parts.push(level?.name || settings.thinkingLevel)
    }
    return parts.join(' · ')
  }

  return (
    <SettingsCard>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between py-3 px-4 hover:bg-foreground/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-6 h-6 rounded-full overflow-hidden bg-foreground/5 flex items-center justify-center',
              'ring-1 ring-border/50'
            )}
          >
            {iconUrl ? (
              <img src={iconUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs font-medium text-muted-foreground">
                {workspace.name?.charAt(0)?.toUpperCase() || 'W'}
              </span>
            )}
          </div>
          <div className="text-left">
            <div className="text-sm font-medium">{workspace.name}</div>
            <div className="text-xs text-muted-foreground">
              {isLoading ? t('settings.ai.loading') : getSummary()}
            </div>
          </div>
        </div>
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/50 px-4 py-2">
              <SettingsMenuSelectRow
                label={t('settings.ai.connection')}
                description={t('settings.ai.connectionDescription')}
                value={currentConnection}
                onValueChange={handleConnectionChange}
                options={[
                  { value: 'global', label: t('settings.ai.useDefault'), description: t('settings.ai.inheritFromApp') },
                  ...llmConnections.map((conn) => ({
                    value: conn.slug,
                    label: conn.name,
                    description: conn.providerType === 'anthropic' ? 'Anthropic' :
                                 conn.providerType === 'openai' ? 'OpenAI' :
                                 conn.providerType || 'Unknown',
                  })),
                ]}
              />
              {/* Only show model selector if no custom model from connection */}
              {!customModel && (
                <SettingsMenuSelectRow
                  label={t('settings.ai.model')}
                  description={t('settings.ai.modelDescription')}
                  value={currentModel}
                  onValueChange={handleModelChange}
                  options={[
                    { value: 'global', label: t('settings.ai.useDefault'), description: t('settings.ai.inheritFromApp') },
                    ...getModelOptionsForProvider(workspaceModelProvider),
                  ]}
                />
              )}
              <SettingsMenuSelectRow
                label={t('settings.ai.thinking')}
                description={t('settings.ai.thinkingDescription')}
                value={currentThinking}
                onValueChange={handleThinkingChange}
                options={[
                  { value: 'global', label: t('settings.ai.useDefault'), description: t('settings.ai.inheritFromApp') },
                  ...THINKING_LEVELS.map(({ id, name, description }) => ({
                    value: id,
                    label: name,
                    description,
                  })),
                ]}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </SettingsCard>
  )
}

// ============================================
// Main Component
// ============================================

export default function AiSettingsPage() {
  const { t } = useLocale()
  const { refreshCustomModel, refreshModelDefaults, llmConnections, refreshLlmConnections, customModel } = useAppShellContext()

  // API Setup overlay state
  const [showApiSetup, setShowApiSetup] = useState(false)
  const [editingConnectionSlug, setEditingConnectionSlug] = useState<string | null>(null)
  const setFullscreenOverlayOpen = useSetAtom(fullscreenOverlayOpenAtom)

  // Workspaces for override cards
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])

  // Default settings state (app-level)
  const [modelDefaults, setModelDefaults] = useState<ModelDefaults>({
    anthropic: DEFAULT_MODEL,
    openai: DEFAULT_CODEX_MODEL,
  })
  const [defaultThinking, setDefaultThinking] = useState<ThinkingLevel>(DEFAULT_THINKING_LEVEL)

  // Validation state per connection
  const [validationStates, setValidationStates] = useState<Record<string, {
    state: ValidationState
    error?: string
  }>>({})

  // Credential health state (for startup warning banner)
  const [credentialHealthIssues, setCredentialHealthIssues] = useState<CredentialHealthIssue[]>([])

  // Load workspaces, default settings, and credential health
  useEffect(() => {
    const load = async () => {
      if (!window.electronAPI) return
      try {
        const ws = await window.electronAPI.getWorkspaces()
        setWorkspaces(ws)

        // Load provider-scoped default models
        const defaults = await window.electronAPI.getModelDefaults?.()
        if (defaults) {
          setModelDefaults({
            anthropic: defaults.anthropic ?? DEFAULT_MODEL,
            openai: defaults.openai ?? DEFAULT_CODEX_MODEL,
          })
        }

        // Check credential health for potential issues (corruption, machine migration)
        const health = await window.electronAPI.getCredentialHealth()
        if (!health.healthy) {
          setCredentialHealthIssues(health.issues)
        }
      } catch (error) {
        console.error('Failed to load settings:', error)
      }
    }
    load()
  }, [])

  // Helpers to open/close the fullscreen API setup overlay
  const openApiSetup = useCallback((connectionSlug?: string) => {
    setEditingConnectionSlug(connectionSlug || null)
    setShowApiSetup(true)
    setFullscreenOverlayOpen(true)
  }, [setFullscreenOverlayOpen])

  const closeApiSetup = useCallback(() => {
    setShowApiSetup(false)
    setFullscreenOverlayOpen(false)
    setEditingConnectionSlug(null)
  }, [setFullscreenOverlayOpen])

  // OnboardingWizard hook for editing API connection
  const apiSetupOnboarding = useOnboarding({
    initialStep: 'api-setup',
    onConfigSaved: refreshCustomModel,
    onComplete: () => {
      closeApiSetup()
      refreshLlmConnections?.()
      apiSetupOnboarding.reset()
    },
    onDismiss: () => {
      closeApiSetup()
      apiSetupOnboarding.reset()
    },
  })

  const handleApiSetupFinish = useCallback(() => {
    closeApiSetup()
    refreshLlmConnections?.()
    apiSetupOnboarding.reset()
    // Clear any credential health issues after successful re-authentication
    setCredentialHealthIssues([])
  }, [closeApiSetup, refreshLlmConnections, apiSetupOnboarding])

  // Handler for closing the modal via X button or Escape - resets state and cancels OAuth
  const handleCloseApiSetup = useCallback(() => {
    closeApiSetup()
    apiSetupOnboarding.reset()
  }, [closeApiSetup, apiSetupOnboarding])

  // Handler for re-authenticate button in credential health banner
  const handleReauthenticate = useCallback(() => {
    // Open API setup for the default connection (or first connection if available)
    const defaultConn = llmConnections.find(c => c.isDefault) || llmConnections[0]
    if (defaultConn) {
      openApiSetup(defaultConn.slug)
    } else {
      openApiSetup()
    }
  }, [llmConnections, openApiSetup])

  // Connection action handlers
  const handleEditConnection = useCallback((slug: string) => {
    openApiSetup(slug)
  }, [openApiSetup])

  const handleReauthenticateConnection = useCallback((connection: LlmConnectionWithStatus) => {
    openApiSetup(connection.slug)
    apiSetupOnboarding.reset()

    if (connection.authType === 'oauth') {
      const method = connection.providerType === 'openai' ? 'chatgpt_oauth' : 'claude_oauth'
      apiSetupOnboarding.handleStartOAuth(method)
    }
  }, [apiSetupOnboarding, openApiSetup])

  const handleDeleteConnection = useCallback(async (slug: string) => {
    if (!window.electronAPI) return
    try {
      const result = await window.electronAPI.deleteLlmConnection(slug)
      if (result.success) {
        refreshLlmConnections?.()
      } else {
        console.error('Failed to delete connection:', result.error)
      }
    } catch (error) {
      console.error('Failed to delete connection:', error)
    }
  }, [refreshLlmConnections])

  const handleValidateConnection = useCallback(async (slug: string) => {
    if (!window.electronAPI) return

    // Set validating state
    setValidationStates(prev => ({ ...prev, [slug]: { state: 'validating' } }))

    try {
      const result = await window.electronAPI.testLlmConnection(slug)

      if (result.success) {
        setValidationStates(prev => ({ ...prev, [slug]: { state: 'success' } }))
        // Auto-clear success state after 3 seconds
        setTimeout(() => {
          setValidationStates(prev => ({ ...prev, [slug]: { state: 'idle' } }))
        }, 3000)
      } else {
        setValidationStates(prev => ({
          ...prev,
          [slug]: { state: 'error', error: result.error }
        }))
        // Auto-clear error state after 5 seconds
        setTimeout(() => {
          setValidationStates(prev => ({ ...prev, [slug]: { state: 'idle' } }))
        }, 5000)
      }
    } catch (error) {
      setValidationStates(prev => ({
        ...prev,
        [slug]: { state: 'error', error: 'Validation failed' }
      }))
      setTimeout(() => {
        setValidationStates(prev => ({ ...prev, [slug]: { state: 'idle' } }))
      }, 5000)
    }
  }, [])

  const handleSetDefaultConnection = useCallback(async (slug: string) => {
    if (!window.electronAPI) return
    try {
      const result = await window.electronAPI.setDefaultLlmConnection(slug)
      if (result.success) {
        refreshLlmConnections?.()
      } else {
        console.error('Failed to set default connection:', result.error)
      }
    } catch (error) {
      console.error('Failed to set default connection:', error)
    }
  }, [refreshLlmConnections])

  // Get the default connection for display
  const defaultConnection = useMemo(() => {
    return llmConnections.find(c => c.isDefault)
  }, [llmConnections])

  // Derive the model provider from the default connection's provider type
  const defaultModelProvider: ModelProvider = useMemo(() => {
    const pt = defaultConnection?.providerType
    return (pt === 'openai' || pt === 'openai_compat') ? 'openai' : 'anthropic'
  }, [defaultConnection])

  const defaultModel = useMemo(() => {
    return modelDefaults[defaultModelProvider] ?? getDefaultModelForProvider(defaultModelProvider)
  }, [modelDefaults, defaultModelProvider])

  // App-level default handlers
  const handleDefaultModelChange = useCallback(async (model: string) => {
    if (!window.electronAPI) return
    await window.electronAPI.setModelDefault?.(defaultModelProvider, model)
    setModelDefaults(prev => ({ ...prev, [defaultModelProvider]: model }))
    refreshModelDefaults?.()
  }, [defaultModelProvider, refreshModelDefaults])

  const handleDefaultThinkingChange = useCallback(async (level: ThinkingLevel) => {
    setDefaultThinking(level)
    // TODO: Add app-level thinking level storage
  }, [])

  // Refresh callback for workspace cards
  const handleWorkspaceSettingsChange = useCallback(() => {
    // Refresh context so changes propagate immediately
    refreshLlmConnections?.()
  }, [refreshLlmConnections])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t('settings.ai.title')} actions={<HeaderMenu route={routes.view.settings('ai')} />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            {/* Credential Health Warning Banner */}
            <CredentialHealthBanner
              issues={credentialHealthIssues}
              onReauthenticate={handleReauthenticate}
            />

            <div className="space-y-8">
              {/* Default Settings - only show if connections exist */}
              {llmConnections.length > 0 && (
              <SettingsSection title={t('settings.ai.section.default')} description={t('settings.ai.section.default.description')}>
                <SettingsCard>
                  <SettingsMenuSelectRow
                    label={t('settings.ai.connection')}
                    description={t('settings.ai.connectionDescription')}
                    value={defaultConnection?.slug || ''}
                    onValueChange={handleSetDefaultConnection}
                    options={llmConnections.map((conn) => ({
                      value: conn.slug,
                      label: conn.name,
                      description: conn.providerType === 'anthropic' ? 'Anthropic API' :
                                   conn.providerType === 'openai' ? 'OpenAI API' :
                                   conn.providerType === 'openai_compat' ? 'OpenAI Compatible' :
                                   conn.providerType === 'bedrock' ? 'AWS Bedrock' :
                                   conn.providerType === 'vertex' ? 'Google Vertex' :
                                   conn.providerType || 'Unknown',
                    }))}
                  />
                  {/* Only show model selector if no custom model from connection */}
                  {!customModel ? (
                    <SettingsMenuSelectRow
                      label={t('settings.ai.model')}
                      description={t('settings.ai.modelDescription')}
                      value={defaultModel}
                      onValueChange={handleDefaultModelChange}
                      options={getModelOptionsForProvider(defaultModelProvider)}
                    />
                  ) : (
                    <SettingsRow
                      label={t('settings.ai.model')}
                      description={t('settings.ai.modelSetViaConnection')}
                    >
                      <span className="text-sm text-muted-foreground">{customModel}</span>
                    </SettingsRow>
                  )}
                  <SettingsMenuSelectRow
                    label={t('settings.ai.thinking')}
                    description={t('settings.ai.thinkingDescription')}
                    value={defaultThinking}
                    onValueChange={(v) => handleDefaultThinkingChange(v as ThinkingLevel)}
                    options={THINKING_LEVELS.map(({ id, name, description }) => ({
                      value: id,
                      label: name,
                      description,
                    }))}
                  />
                </SettingsCard>
              </SettingsSection>
              )}

              {/* Workspace Overrides - only show if connections exist */}
              {workspaces.length > 0 && llmConnections.length > 0 && (
                <SettingsSection title={t('settings.ai.section.workspaceOverrides')} description={t('settings.ai.section.workspaceOverrides.description')}>
                  <div className="space-y-2">
                    {workspaces.map((workspace) => (
                      <WorkspaceOverrideCard
                        key={workspace.id}
                        workspace={workspace}
                        llmConnections={llmConnections}
                        customModel={customModel}
                        onSettingsChange={handleWorkspaceSettingsChange}
                      />
                    ))}
                  </div>
                </SettingsSection>
              )}

              {/* Connections Management */}
              <SettingsSection title={t('settings.ai.section.connections')} description={t('settings.ai.section.connections.description')}>
                <SettingsCard>
                  {llmConnections.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                      {t('settings.ai.noConnections')}
                    </div>
                  ) : (
                    [...llmConnections]
                      .sort((a, b) => {
                        if (a.isDefault && !b.isDefault) return -1
                        if (!a.isDefault && b.isDefault) return 1
                        return a.name.localeCompare(b.name)
                      })
                      .map((conn) => (
                      <ConnectionRow
                        key={conn.slug}
                        connection={conn}
                        isLastConnection={false}
                        onEdit={() => handleEditConnection(conn.slug)}
                        onDelete={() => handleDeleteConnection(conn.slug)}
                        onSetDefault={() => handleSetDefaultConnection(conn.slug)}
                        onValidate={() => handleValidateConnection(conn.slug)}
                        onReauthenticate={() => handleReauthenticateConnection(conn)}
                        validationState={validationStates[conn.slug]?.state || 'idle'}
                        validationError={validationStates[conn.slug]?.error}
                      />
                    ))
                  )}
                </SettingsCard>
                <div className="pt-0">
                  <button
                    onClick={() => openApiSetup()}
                    className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.02] transition-colors"
                  >
                    {t('settings.ai.addConnection')}
                  </button>
                </div>
              </SettingsSection>

              {/* API Setup Fullscreen Overlay */}
              <FullscreenOverlayBase
                isOpen={showApiSetup}
                onClose={handleCloseApiSetup}
                className="z-splash flex flex-col bg-foreground-2"
              >
                <OnboardingWizard
                  state={apiSetupOnboarding.state}
                  onContinue={apiSetupOnboarding.handleContinue}
                  onBack={apiSetupOnboarding.handleBack}
                  onSelectApiSetupMethod={apiSetupOnboarding.handleSelectApiSetupMethod}
                  onSubmitCredential={apiSetupOnboarding.handleSubmitCredential}
                  onSubmitBedrockCredential={apiSetupOnboarding.handleSubmitBedrockCredential}
                  onStartOAuth={apiSetupOnboarding.handleStartOAuth}
                  onFinish={handleApiSetupFinish}
                  isWaitingForCode={apiSetupOnboarding.isWaitingForCode}
                  onSubmitAuthCode={apiSetupOnboarding.handleSubmitAuthCode}
                  onCancelOAuth={apiSetupOnboarding.handleCancelOAuth}
                  className="h-full"
                />
                <div
                  className="fixed top-0 right-0 h-[50px] flex items-center pr-5 [-webkit-app-region:no-drag]"
                  style={{ zIndex: 'var(--z-fullscreen, 350)' }}
                >
                  <button
                    onClick={handleCloseApiSetup}
                    className="p-1.5 rounded-[6px] transition-all bg-background shadow-minimal text-muted-foreground/50 hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    title={t('settings.ai.closeEsc')}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </FullscreenOverlayBase>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
