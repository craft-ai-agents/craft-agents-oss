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

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'
import { X, MoreHorizontal, Pencil, Trash2, Star, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, RefreshCcw, Settings2, MessageSquareMore, Zap, Clock, Check } from 'lucide-react'
import type { CredentialHealthStatus, CredentialHealthIssue } from '../../../shared/types'
import { Spinner, FullscreenOverlayBase, Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import { useSetAtom } from 'jotai'
import { fullscreenOverlayOpenAtom } from '@/atoms/overlay'
import { DECISION_SETTINGS_CHANGED_EVENT } from '@/atoms/permission-modes'
import { motion, AnimatePresence } from 'motion/react'
import type { LlmConnectionWithStatus, ThinkingLevel, WorkspaceSettings, Workspace } from '../../../shared/types'
import type { DecisionLayerFeature, DecisionLayerStatus, DecisionLayerSettingsPatch, DecisionProviderId, DecisionServerProbe, DecisionTestResult, DecisionToggleUsage } from '../../../shared/types'
import { DEFAULT_THINKING_LEVEL, THINKING_LEVELS } from '@craft-agent/shared/agent/thinking-levels'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
  DropdownMenuSub,
  StyledDropdownMenuSubTrigger,
  StyledDropdownMenuSubContent,
} from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import { ConnectionIcon } from '@/components/icons/ConnectionIcon'

import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsMenuSelectRow,
  SettingsToggle,
  SettingsInput,
} from '@/components/settings'
import { useOnboarding } from '@/hooks/useOnboarding'
import { RtkUpdateDialog, type RtkStatusInfo } from '@/components/RtkUpdateDialog'
import { useWorkspaceIcon } from '@/hooks/useWorkspaceIcon'
import { OnboardingWizard, type ApiSetupMethod } from '@/components/onboarding'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { useAppShellContext } from '@/context/AppShellContext'
import { getModelShortName, type ModelDefinition } from '@config/models'
import { getModelsForProviderType, resolveMidStreamBehavior, type CustomEndpointApi, type MidStreamBehavior } from '@config/llm-connections'
import { toast } from 'sonner'

/** Checks with an outcome after which a feature that changed nothing is pointed out. */
const DECISION_NO_CHANGE_MIN_CHECKS = 30

/**
 * Compact token count: 1234 → "1.2K", 1234567 → "1.2M". Used by the RTK
 * efficiency meter. Locale-agnostic — the suffix is universal across the
 * 7 supported locales.
 */
function formatTokenCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/**
 * Derive model dropdown options from a connection's models array,
 * falling back to registry models for the connection's provider type.
 */
function getModelOptionsForConnection(
  connection: LlmConnectionWithStatus | undefined,
): Array<{ value: string; label: string; description: string; descriptionKey?: string }> {
  if (!connection) return []

  // If connection has explicit models, use those
  if (connection.models && connection.models.length > 0) {
    return connection.models.map((m) => {
      if (typeof m === 'string') {
        return { value: m, label: getModelShortName(m), description: '' }
      }
      // ModelDefinition object
      const def = m as ModelDefinition
      return { value: def.id, label: def.name, description: def.description, descriptionKey: def.descriptionKey }
    })
  }

  // Fall back to registry models for this provider type
  const registryModels = getModelsForProviderType(connection.providerType, connection.piAuthProvider)
  return registryModels.map((m) => ({
    value: m.id,
    label: m.name,
    description: m.description,
    descriptionKey: m.descriptionKey,
  }))
}

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'ai',
}

// ============================================
// Credential Health Warning Banner
// ============================================

/** Get user-friendly message for credential health issue */
function getHealthIssueMessage(issue: CredentialHealthIssue, t: (key: string) => string): string {
  switch (issue.type) {
    case 'file_corrupted':
      return t("settings.ai.credentialCorrupted")
    case 'decryption_failed':
      return t("settings.ai.credentialOtherMachine")
    case 'no_default_credentials':
      return t("settings.ai.credentialNotFound")
    default:
      return issue.message || 'Credential issue detected.'
  }
}

interface CredentialHealthBannerProps {
  issues: CredentialHealthIssue[]
  onReauthenticate: () => void
}

function CredentialHealthBanner({ issues, onReauthenticate }: CredentialHealthBannerProps) {
  const { t } = useTranslation()
  if (issues.length === 0) return null

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 mb-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-amber-700 dark:text-amber-400">
            {t("settings.ai.credentialIssue")}
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
          {t("settings.ai.reAuthenticate")}
        </Button>
      </div>
    </div>
  )
}

// ============================================
// Pi Auth Provider Display Names
// ============================================

const PI_AUTH_PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic API',
  openai: 'OpenAI API',
  'openai-codex': 'OpenAI API',
  google: 'Google AI Studio',
  openrouter: 'OpenRouter',
  'azure-openai-responses': 'Azure OpenAI',
  'amazon-bedrock': 'Amazon Bedrock',
  groq: 'Groq',
  mistral: 'Mistral',
  deepseek: 'DeepSeek',
  xai: 'xAI',
  cerebras: 'Cerebras',
  zai: 'z.ai',
  huggingface: 'Hugging Face',
  minimax: 'Minimax',
  'minimax-cn': 'Minimax (CN)',
  'kimi-coding': 'Kimi (Coding)',
  moonshotai: 'Moonshot AI',
  'moonshotai-cn': 'Moonshot AI (CN)',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  'github-copilot': 'GitHub Copilot',
}

// ============================================
// Connection Row Component
// ============================================

type ValidationState = 'idle' | 'validating' | 'success' | 'error'

interface ConnectionRowProps {
  connection: LlmConnectionWithStatus
  isLastConnection: boolean
  onRenameClick: () => void
  onDelete: () => void
  onSetDefault: () => void
  onValidate: () => void
  onReauthenticate: () => void
  onEdit: () => void
  onSetMidStreamBehavior: (behavior: MidStreamBehavior) => void
  validationState: ValidationState
  validationError?: string
  /** True when another OAuth connection resolves to the same Anthropic account (issue #838) */
  isDuplicateAccount?: boolean
}

function ConnectionRow({ connection, isLastConnection, onRenameClick, onDelete, onSetDefault, onValidate, onReauthenticate, onEdit, onSetMidStreamBehavior, validationState, validationError, isDuplicateAccount }: ConnectionRowProps) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [piBaseUrl, setPiBaseUrl] = useState<string | undefined>(undefined)

  // Opening dialog/overlay flows directly from a dropdown item can race with
  // menu teardown and leave a transient interaction lock behind on some systems.
  // Force menu close first, then trigger action on next frame.
  const runAfterMenuClose = useCallback((action: () => void) => {
    setMenuOpen(false)
    requestAnimationFrame(() => {
      action()
    })
  }, [])

  // Load Pi provider base URL via IPC (Pi SDK can't run in renderer)
  useEffect(() => {
    const provider = connection.providerType || connection.type
    if (provider === 'pi' && connection.piAuthProvider && !connection.baseUrl) {
      window.electronAPI.getPiProviderBaseUrl(connection.piAuthProvider).then(url => setPiBaseUrl(url))
    }
  }, [connection.providerType, connection.type, connection.piAuthProvider, connection.baseUrl])

  // Build description with provider, default indicator, auth status, and validation state
  const getDescription = () => {
    // Show validation state if not idle
    if (validationState === 'validating') return t("settings.ai.validating")
    if (validationState === 'success') return t("settings.ai.connectionValid")
    if (validationState === 'error') return validationError || t("settings.ai.validationFailed")

    const parts: string[] = []

    // Provider type (fall back to legacy 'type' field if providerType missing)
    // OAuth = subscription (Pro/Plus/Max), API key = API
    const provider = connection.providerType || connection.type
    const isSubscription = connection.authType === 'oauth'
    switch (provider) {
      case 'anthropic': parts.push(isSubscription ? 'Anthropic Subscription' : 'Anthropic API'); break
      case 'pi': {
        // Show upstream provider name for API key connections (e.g. "Google AI Studio")
        const piLabel = !isSubscription && connection.piAuthProvider
          ? PI_AUTH_PROVIDER_LABELS[connection.piAuthProvider]
          : null
        parts.push(piLabel ?? 'Craft Agents Backend')
        break
      }
      case 'pi_compat':
        parts.push(connection.baseUrl?.toLowerCase().includes('manifest.build')
          ? 'Manifest'
          : 'Craft Agents Backend Compatible')
        break
      default: parts.push(provider || 'Unknown')
    }

    // Base URL for API key connections (show custom endpoint or default for provider)
    if (connection.authType !== 'oauth') {
      let endpoint = connection.baseUrl
      // Use default endpoints for standard providers if no custom baseUrl
      if (!endpoint) {
        if (provider === 'anthropic') endpoint = 'https://api.anthropic.com'
        else if (provider === 'pi' && connection.piAuthProvider) {
          endpoint = piBaseUrl
        }
      }
      if (endpoint) {
        // Extract hostname from URL for cleaner display
        try {
          const url = new URL(endpoint)
          parts.push(url.host)
        } catch {
          parts.push(endpoint)
        }
      }
    }

    // Auth status
    if (!connection.isAuthenticated) parts.push(t("settings.ai.notAuthenticated"))

    return parts.join(' · ')
  }

  // Resolved Anthropic identity (issue #838): render `email · org` independently of
  // validation state. It cannot live in getDescription() — that short-circuits for
  // validating/success/error and would hide the identity during those states.
  const oauthIdentityLine = connection.authType === 'oauth' && connection.oauthAccountEmail
    ? [connection.oauthAccountEmail, connection.oauthOrganizationName].filter(Boolean).join(' · ')
    : null

  return (
    <SettingsRow
      label={(
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-1">
            <ConnectionIcon connection={connection} size={14} />
            <span>{connection.name}</span>
            {connection.isDefault && (
              <span className="inline-flex items-center h-5 px-2 text-[11px] font-medium rounded-[4px] bg-background shadow-minimal text-foreground/60">
                {t("common.default")}
              </span>
            )}
            {isDuplicateAccount && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center" aria-label={t("settings.ai.duplicateAccount")}>
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t("settings.ai.duplicateAccount")}</TooltipContent>
              </Tooltip>
            )}
          </div>
          {oauthIdentityLine && (
            <span className="text-xs text-muted-foreground truncate">{oauthIdentityLine}</span>
          )}
        </div>
      )}
      description={getDescription()}
    >
      <DropdownMenu modal={false} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className="p-1.5 rounded-md hover:bg-foreground/[0.05] data-[state=open]:bg-foreground/[0.05] transition-colors"
            data-state={menuOpen ? 'open' : 'closed'}
          >
            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <StyledDropdownMenuContent align="end">
          <StyledDropdownMenuItem onClick={() => runAfterMenuClose(onRenameClick)}>
            <Pencil className="h-3.5 w-3.5" />
            <span>{t("common.rename")}</span>
          </StyledDropdownMenuItem>
          {!connection.isDefault && (
            <StyledDropdownMenuItem onClick={onSetDefault}>
              <Star className="h-3.5 w-3.5" />
              <span>{t("settings.ai.setAsDefault")}</span>
            </StyledDropdownMenuItem>
          )}
          {connection.authType === 'oauth' ? (
            <StyledDropdownMenuItem onClick={() => runAfterMenuClose(onReauthenticate)}>
              <RefreshCcw className="h-3.5 w-3.5" />
              <span>{t("settings.ai.reAuthenticate")}</span>
            </StyledDropdownMenuItem>
          ) : (
            <StyledDropdownMenuItem onClick={() => runAfterMenuClose(onEdit)}>
              <Settings2 className="h-3.5 w-3.5" />
              <span>{t("common.edit")}</span>
            </StyledDropdownMenuItem>
          )}
          <StyledDropdownMenuItem
            onClick={onValidate}
            disabled={validationState === 'validating'}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{t("settings.ai.validateConnection")}</span>
          </StyledDropdownMenuItem>
          {(() => {
            const currentBehavior = resolveMidStreamBehavior(connection)
            return (
              <DropdownMenuSub>
                <StyledDropdownMenuSubTrigger>
                  <MessageSquareMore className="h-3.5 w-3.5" />
                  <span>{t("settings.ai.midStream.title")}</span>
                </StyledDropdownMenuSubTrigger>
                <StyledDropdownMenuSubContent>
                  <StyledDropdownMenuItem onClick={() => onSetMidStreamBehavior('steer')}>
                    <Zap className="h-3.5 w-3.5" />
                    <span className="flex-1">{t("settings.ai.midStream.steer")}</span>
                    {currentBehavior === 'steer' && <Check className="h-3.5 w-3.5" />}
                  </StyledDropdownMenuItem>
                  <StyledDropdownMenuItem onClick={() => onSetMidStreamBehavior('queue')}>
                    <Clock className="h-3.5 w-3.5" />
                    <span className="flex-1">{t("settings.ai.midStream.queue")}</span>
                    {currentBehavior === 'queue' && <Check className="h-3.5 w-3.5" />}
                  </StyledDropdownMenuItem>
                </StyledDropdownMenuSubContent>
              </DropdownMenuSub>
            )
          })()}
          <StyledDropdownMenuSeparator />
          <StyledDropdownMenuItem
            onClick={onDelete}
            variant="destructive"
            disabled={isLastConnection}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{t("common.delete")}</span>
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
  onSettingsChange: () => void
}

const WORKSPACE_SETTING_LABELS: Partial<Record<keyof WorkspaceSettings, string>> = {
  defaultLlmConnection: 'workspace connection override',
  model: 'workspace model override',
  thinkingLevel: 'workspace thinking override',
}

function WorkspaceOverrideCard({ workspace, llmConnections, onSettingsChange }: WorkspaceOverrideCardProps) {
  const { t } = useTranslation()
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

  // Save workspace setting helper (optimistic update with rollback)
  const updateSetting = useCallback(async <K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) => {
    if (!window.electronAPI) return

    const previousValue = settings?.[key]

    // Optimistic UI update for immediate feedback
    setSettings(prev => prev ? { ...prev, [key]: value } : prev)

    try {
      await window.electronAPI.updateWorkspaceSetting(workspace.id, key, value)
      onSettingsChange()
    } catch (error) {
      // Roll back only the changed key
      setSettings(prev => prev ? { ...prev, [key]: previousValue } : prev)

      const message = error instanceof Error ? error.message : 'Unknown error'
      const settingLabel = WORKSPACE_SETTING_LABELS[key] ?? String(key)
      console.error(`Failed to save ${String(key)}:`, error)
      toast.error(t("toast.failedToSaveSetting", { setting: settingLabel }), {
        description: message,
      })
    }
  }, [workspace.id, onSettingsChange, settings])

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

  // Derive workspace's effective connection (override or default)
  const workspaceEffectiveConnection = useMemo(() => {
    const connSlug = settings?.defaultLlmConnection
    return connSlug ? llmConnections.find(c => c.slug === connSlug) : llmConnections.find(c => c.isDefault)
  }, [settings?.defaultLlmConnection, llmConnections])

  // Get summary text for collapsed state
  const getSummary = () => {
    if (!hasOverrides) return t("settings.ai.usingDefaults")
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
      parts.push(level ? t(level.nameKey) : settings.thinkingLevel)
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
              {isLoading ? t("common.loading") : getSummary()}
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
                label={t("settings.ai.connection")}
                description={t("settings.ai.connectionDesc")}
                value={currentConnection}
                onValueChange={handleConnectionChange}
                options={[
                  { value: 'global', label: t("settings.ai.useDefault"), description: t("settings.ai.inheritFromApp") },
                  ...llmConnections.map((conn) => ({
                    value: conn.slug,
                    label: conn.name,
                    description: conn.providerType === 'anthropic' ? 'Anthropic' :
                                 conn.providerType === 'pi' ? 'Craft Agents Backend' :
                                 conn.providerType || 'Unknown',
                  })),
                ]}
              />
              <SettingsMenuSelectRow
                label={t("settings.ai.model")}
                description={t("settings.ai.modelDesc")}
                value={currentModel}
                onValueChange={handleModelChange}
                options={[
                  { value: 'global', label: t("settings.ai.useDefault"), description: t("settings.ai.inheritFromApp") },
                  ...getModelOptionsForConnection(workspaceEffectiveConnection).map(o => ({
                    ...o, description: o.descriptionKey ? t(o.descriptionKey) : o.description,
                  })),
                ]}
              />
              <SettingsMenuSelectRow
                label={t("settings.ai.thinking")}
                description={t("settings.ai.thinkingDesc")}
                value={currentThinking}
                onValueChange={handleThinkingChange}
                options={[
                  { value: 'global', label: t("settings.ai.useDefault"), description: t("settings.ai.inheritFromApp") },
                  ...THINKING_LEVELS.map(({ id, nameKey, descriptionKey }) => ({
                    value: id,
                    label: t(nameKey),
                    description: t(descriptionKey),
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
// Helpers
// ============================================

/** Map a connection's provider type to the corresponding API key setup method. */
function getApiKeyMethodForConnection(conn: LlmConnectionWithStatus): ApiSetupMethod {
  const provider = conn.providerType || conn.type
  if (provider === 'pi' || provider === 'pi_compat') return 'pi_api_key'
  return 'anthropic_api_key'
}

// ============================================
// Main Component
// ============================================

export default function AiSettingsPage() {
  const { t } = useTranslation()
  const { llmConnections, refreshLlmConnections, activeWorkspaceId } = useAppShellContext()

  // API Setup overlay state
  const [showApiSetup, setShowApiSetup] = useState(false)
  const [editingConnectionSlug, setEditingConnectionSlug] = useState<string | null>(null)
  const [isDirectEdit, setIsDirectEdit] = useState(false)
  const [editInitialValues, setEditInitialValues] = useState<{
    apiKey?: string
    baseUrl?: string
    connectionDefaultModel?: string
    activePreset?: string
    models?: string[]
    customApi?: CustomEndpointApi
  } | undefined>(undefined)
  const setFullscreenOverlayOpen = useSetAtom(fullscreenOverlayOpenAtom)

  // Workspaces for override cards
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])

  // Default settings state (app-level)
  const [defaultThinking, setDefaultThinking] = useState<ThinkingLevel>(DEFAULT_THINKING_LEVEL)
  const [extendedPromptCache, setExtendedPromptCache] = useState(false)
  const [enable1MContext, setEnable1MContext] = useState(false)
  const [rtkEnabled, setRtkEnabled] = useState(false)
  const [rtkStatus, setRtkStatus] = useState<RtkStatusInfo | null>(null)
  const [rtkUpdateOpen, setRtkUpdateOpen] = useState(false)
  const [rtkRechecking, setRtkRechecking] = useState(false)
  const [rtkGain, setRtkGain] = useState<{ totalCommands: number; totalInput: number; totalOutput: number; totalSaved: number; avgSavingsPct: number; totalTimeMs: number; avgTimeMs: number } | null>(null)

  // Decision model (Jev / TypeSafe System One) — opt-in decision layer.
  // The card is always shown; everything behind it stays off until the user enables it.
  const [decisionStatus, setDecisionStatus] = useState<DecisionLayerStatus | null>(null)
  const [decisionAdvancedOpen, setDecisionAdvancedOpen] = useState(false)
  const [decisionUsage, setDecisionUsage] = useState<Partial<Record<DecisionLayerFeature, DecisionToggleUsage>>>({})
  const [decisionKeyDraft, setDecisionKeyDraft] = useState('')
  const [decisionModelDraft, setDecisionModelDraft] = useState('')
  const [decisionBaseUrlDraft, setDecisionBaseUrlDraft] = useState('')
  const [decisionTesting, setDecisionTesting] = useState(false)
  const [decisionTestResult, setDecisionTestResult] = useState<DecisionTestResult | null>(null)
  // Local servers (Laya, custom): GET /health so the card can say whether the server is up.
  const [decisionProbe, setDecisionProbe] = useState<DecisionServerProbe | null>(null)
  const [decisionProbing, setDecisionProbing] = useState(false)
  // Drafts are seeded from stored settings once (and after a provider switch),
  // never on background refreshes, so in-progress typing is not clobbered.
  const decisionDraftsSeededRef = useRef(false)


  // Validation state per connection
  const [validationStates, setValidationStates] = useState<Record<string, {
    state: ValidationState
    error?: string
  }>>({})

  // Credential health state (for startup warning banner)
  const [credentialHealthIssues, setCredentialHealthIssues] = useState<CredentialHealthIssue[]>([])

  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renamingConnection, setRenamingConnection] = useState<{ slug: string; name: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Load workspaces, default settings, and credential health
  useEffect(() => {
    const load = async () => {
      if (!window.electronAPI) return
      try {
        const ws = await window.electronAPI.getWorkspaces()
        setWorkspaces(ws)

        const defaultThinkingLevel = await window.electronAPI.getDefaultThinkingLevel()
        setDefaultThinking(defaultThinkingLevel)

        const extendedCache = await window.electronAPI.getExtendedPromptCache()
        setExtendedPromptCache(extendedCache)

        const enable1M = await window.electronAPI.getEnable1MContext()
        setEnable1MContext(enable1M)

        const rtkOn = await window.electronAPI.getRtkEnabled()
        setRtkEnabled(rtkOn)

        const status = await window.electronAPI.getRtkStatus()
        setRtkStatus(status)

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
  }, [activeWorkspaceId])

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

  // Derive existing slugs for unique slug generation
  const existingSlugs = useMemo(
    () => new Set(llmConnections.map(c => c.slug)),
    [llmConnections],
  )

  // OnboardingWizard hook for editing API connection
  const apiSetupOnboarding = useOnboarding({
    initialStep: 'provider-select',
    onConfigSaved: refreshLlmConnections,
    onComplete: () => {
      closeApiSetup()
      refreshLlmConnections?.()
      apiSetupOnboarding.reset()
    },
    onDismiss: () => {
      closeApiSetup()
      apiSetupOnboarding.reset()
    },
    editingSlug: editingConnectionSlug,
    existingSlugs,
  })

  const handleApiSetupFinish = useCallback(() => {
    closeApiSetup()
    refreshLlmConnections?.()
    apiSetupOnboarding.reset()
    // Clear any credential health issues after successful re-authentication
    setCredentialHealthIssues([])
    setIsDirectEdit(false)
    setEditInitialValues(undefined)
  }, [closeApiSetup, refreshLlmConnections, apiSetupOnboarding])

  // Handler for closing the modal via X button or Escape - resets state and cancels OAuth
  const handleCloseApiSetup = useCallback(() => {
    closeApiSetup()
    apiSetupOnboarding.reset()
    setIsDirectEdit(false)
    setEditInitialValues(undefined)
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
  const handleRenameClick = useCallback((connection: LlmConnectionWithStatus) => {
    setRenamingConnection({ slug: connection.slug, name: connection.name })
    setRenameValue(connection.name)
    // Defer dialog open to next frame to let dropdown fully unmount first
    requestAnimationFrame(() => {
      setRenameDialogOpen(true)
    })
  }, [])

  const handleRenameSubmit = useCallback(async () => {
    if (!renamingConnection || !window.electronAPI) return
    const trimmedName = renameValue.trim()
    if (!trimmedName || trimmedName === renamingConnection.name) {
      setRenameDialogOpen(false)
      return
    }
    try {
      // Get the full connection, update name, and save
      const connection = await window.electronAPI.getLlmConnection(renamingConnection.slug)
      if (connection) {
        const result = await window.electronAPI.saveLlmConnection({ ...connection, name: trimmedName })
        if (result.success) {
          refreshLlmConnections?.()
        } else {
          console.error('Failed to rename connection:', result.error)
        }
      }
    } catch (error) {
      console.error('Failed to rename connection:', error)
    }
    setRenameDialogOpen(false)
    setRenamingConnection(null)
    setRenameValue('')
  }, [renamingConnection, renameValue, refreshLlmConnections])

  const handleReauthenticateConnection = useCallback((connection: LlmConnectionWithStatus) => {
    openApiSetup(connection.slug)
    apiSetupOnboarding.reset()

    if (connection.authType === 'oauth') {
      const method = connection.providerType === 'pi'
                   ? (connection.piAuthProvider === 'github-copilot' ? 'pi_copilot_oauth' : 'pi_chatgpt_oauth')
                   : 'claude_oauth'
      apiSetupOnboarding.handleStartOAuth(method, connection.slug)
    }
  }, [apiSetupOnboarding, openApiSetup])

  const handleEditConnection = useCallback(async (connection: LlmConnectionWithStatus) => {
    // Fetch stored API key (best-effort — if IPC not available yet, skip pre-fill)
    let apiKey: string | undefined
    try {
      apiKey = (await window.electronAPI.getLlmConnectionApiKey(connection.slug)) ?? undefined
    } catch {
      // IPC method may not exist if app wasn't restarted after code change
    }

    // Build model string from connection's models array
    const modelStr = connection.models
      ?.map((m: string | ModelDefinition) => typeof m === 'string' ? m : m.id)
      .join(', ') || connection.defaultModel || ''

    // Set initial values before opening overlay so ApiKeyInput mounts with them
    const modelIds = connection.models
      ?.map((m: string | ModelDefinition) => typeof m === 'string' ? m : m.id)
      .filter(Boolean)

    const isCustomEndpointConnection = !!connection.customEndpoint && !!connection.baseUrl?.trim()

    setEditInitialValues({
      apiKey,
      baseUrl: connection.baseUrl,
      connectionDefaultModel: modelStr,
      activePreset: isCustomEndpointConnection ? 'custom' : (connection.piAuthProvider || undefined),
      models: modelIds,
      customApi: connection.customEndpoint?.api,
    })

    // Open overlay and jump directly to credentials step (no reset — jumpToCredentials sets state)
    openApiSetup(connection.slug)
    setIsDirectEdit(true)
    const method = getApiKeyMethodForConnection(connection)
    apiSetupOnboarding.jumpToCredentials(method)
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
        [slug]: { state: 'error', error: t("settings.ai.validationFailed") }
      }))
      setTimeout(() => {
        setValidationStates(prev => ({ ...prev, [slug]: { state: 'idle' } }))
      }, 5000)
    }
  }, [t])

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

  // Update a connection's mid-stream send behavior (steer vs queue).
  // Uses the same saveLlmConnection RPC as other connection edits.
  const handleSetMidStreamBehavior = useCallback(async (
    connection: LlmConnectionWithStatus,
    behavior: MidStreamBehavior,
  ) => {
    if (!window.electronAPI) return
    if (resolveMidStreamBehavior(connection) === behavior) return
    try {
      const updated = { ...connection, midStreamBehavior: behavior }
      const { isAuthenticated: _a, authError: _b, isDefault: _c, ...connectionData } = updated
      const result = await window.electronAPI.saveLlmConnection(connectionData as import('../../../shared/types').LlmConnection)
      if (result.success) {
        refreshLlmConnections?.()
      } else {
        console.error('Failed to update mid-stream behavior:', result.error)
        toast.error(t('settings.ai.midStream.updateFailed'))
      }
    } catch (error) {
      console.error('Failed to update mid-stream behavior:', error)
      toast.error(t('settings.ai.midStream.updateFailed'))
    }
  }, [refreshLlmConnections, t])

  // Get the default connection for display
  const defaultConnection = useMemo(() => {
    return llmConnections.find(c => c.isDefault)
  }, [llmConnections])

  // Anthropic account UUIDs that resolve from 2+ connections (issue #838).
  // Surfaces a warning when several Claude connections share one account/quota.
  const duplicateAccountUuids = useMemo(() => {
    const counts = new Map<string, number>()
    for (const conn of llmConnections) {
      const uuid = conn.oauthAccountUuid
      if (uuid) counts.set(uuid, (counts.get(uuid) ?? 0) + 1)
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([uuid]) => uuid))
  }, [llmConnections])

  const defaultModel = defaultConnection?.defaultModel ?? ''

  // App-level default handlers
  const handleDefaultModelChange = useCallback(async (model: string) => {
    if (!window.electronAPI || !defaultConnection) return
    // Update defaultModel on the connection, then save the full connection
    const updated = { ...defaultConnection, defaultModel: model }
    // Remove status fields that aren't part of LlmConnection
    const { isAuthenticated: _a, authError: _b, isDefault: _c, ...connectionData } = updated
    await window.electronAPI.saveLlmConnection(connectionData as import('../../../shared/types').LlmConnection)
    await refreshLlmConnections()
  }, [defaultConnection, refreshLlmConnections])

  const handleDefaultThinkingChange = useCallback(async (level: ThinkingLevel) => {
    if (!window.electronAPI) return

    const previous = defaultThinking
    setDefaultThinking(level)

    try {
      const result = await window.electronAPI.setDefaultThinkingLevel(level)
      if (!result.success) {
        console.error('Failed to set default thinking level:', result.error)
        setDefaultThinking(previous)
      }
    } catch (error) {
      console.error('Failed to set default thinking level:', error)
      setDefaultThinking(previous)
    }
  }, [defaultThinking])

  const handleExtendedPromptCacheChange = useCallback(async (enabled: boolean) => {
    setExtendedPromptCache(enabled)
    await window.electronAPI?.setExtendedPromptCache(enabled)
  }, [])

  const handleEnable1MContextChange = useCallback(async (enabled: boolean) => {
    setEnable1MContext(enabled)
    await window.electronAPI?.setEnable1MContext(enabled)
  }, [])

  const handleRtkToggle = useCallback(async (enabled: boolean) => {
    setRtkEnabled(enabled)
    await window.electronAPI?.setRtkEnabled(enabled)
  }, [])

  const handleRecheckRtk = useCallback(async () => {
    setRtkRechecking(true)
    try {
      const status = await window.electronAPI?.getRtkStatus({ forceRecheck: true })
      if (status) setRtkStatus(status)
    } finally {
      setRtkRechecking(false)
    }
  }, [])

  const handleGetRtk = useCallback(() => {
    window.electronAPI?.openUrl('https://github.com/rtk-ai/rtk')
  }, [])

  const refreshRtkGain = useCallback(async () => {
    const gain = await window.electronAPI?.getRtkGain()
    setRtkGain(gain ?? null)
  }, [])

  // Refresh gain stats whenever rtk transitions to installed-and-enabled
  useEffect(() => {
    if (rtkStatus?.installed && rtkEnabled) {
      refreshRtkGain()
    } else {
      setRtkGain(null)
    }
  }, [rtkStatus?.installed, rtkEnabled, refreshRtkGain])

  // ---- Decision model (Jev) ----
  const refreshDecisionStatus = useCallback(async (seedDrafts: boolean) => {
    if (typeof window.electronAPI?.getDecisionLayerStatus !== 'function') return
    try {
      const status = await window.electronAPI.getDecisionLayerStatus()
      setDecisionStatus(status)
      if (seedDrafts) {
        setDecisionModelDraft(status.settings.model ?? '')
        setDecisionBaseUrlDraft(status.settings.baseUrl ?? '')
        decisionDraftsSeededRef.current = true
      }
    } catch (error) {
      console.error('Failed to load decision model settings:', error)
    }
  }, [])

  // Reusable connections come from the LLM connection list, so refresh with it
  // (background model fetches re-emit that list; only the first load seeds drafts).
  useEffect(() => {
    void refreshDecisionStatus(!decisionDraftsSeededRef.current)
  }, [refreshDecisionStatus, llmConnections])

  const updateDecisionSettings = useCallback(async (patch: DecisionLayerSettingsPatch) => {
    try {
      const next = await window.electronAPI.setDecisionLayerSettings(patch)
      setDecisionStatus(prev => (prev ? { ...prev, settings: next } : prev))
      setDecisionTestResult(null)
      // Mode pickers offer Guarded mode only while it is on: let them refresh.
      window.dispatchEvent(new Event(DECISION_SETTINGS_CHANGED_EVENT))
      // A provider/connection switch drops the model + base URL overrides server-side
      // (they belonged to the previous provider) — mirror that in the inputs.
      if ('provider' in patch || 'connectionSlug' in patch) {
        setDecisionModelDraft(next.model ?? '')
        setDecisionBaseUrlDraft(next.baseUrl ?? '')
      }
    } catch (error) {
      console.error('Failed to update decision model settings:', error)
      toast.error(t("settings.ai.decisions.saveFailed"))
    }
  }, [t])

  const decisionPreset = useMemo(
    () => decisionStatus?.presets.find(p => p.id === decisionStatus.settings.provider),
    [decisionStatus],
  )
  // Decision-model features for Advanced settings, grouped by what they touch.
  // Literal t() keys keep the i18n coverage check effective.
  // What each feature did over the last 7 days, loaded when Advanced settings opens.
  useEffect(() => {
    if (!decisionAdvancedOpen || typeof window.electronAPI?.getDecisionUsage !== 'function') return
    window.electronAPI.getDecisionUsage().then(setDecisionUsage).catch((error) => console.error('Failed to load decision usage:', error))
  }, [decisionAdvancedOpen])
  const decisionUsageNote = (usage: DecisionToggleUsage | undefined): string | undefined => {
    if (!usage) return undefined
    if (usage.withOutcome === 0) return t("settings.ai.decisions.usageChecks", { calls: usage.calls, failures: usage.failures })
    const line = t("settings.ai.decisions.usageChanged", { calls: usage.calls, changed: usage.changed, failures: usage.failures })
    // Every extra call should earn its place: say so when a feature has had its chances and changed nothing.
    return usage.withOutcome >= DECISION_NO_CHANGE_MIN_CHECKS && usage.changed === 0 ? `${line} · ${t("settings.ai.decisions.usageNoChange")}` : line
  }

  const decisionFeatureGroups: Array<{ id: string; title: string; toggles: Array<{ feature: DecisionLayerFeature; label: string; description: string; tooltip: string }> }> = [
    { id: 'agent', title: t("settings.ai.decisions.groupAgent"), toggles: [
      { feature: 'decideTool', label: t("settings.ai.decisions.featureDecideTool"), description: t("settings.ai.decisions.featureDecideToolDesc"), tooltip: t("settings.ai.decisions.featureDecideToolTooltip") },
      { feature: 'suggestions', label: t("settings.ai.decisions.featureSuggestions"), description: t("settings.ai.decisions.featureSuggestionsDesc"), tooltip: t("settings.ai.decisions.featureSuggestionsTooltip") },
      { feature: 'adaptiveThinking', label: t("settings.ai.decisions.featureAdaptiveThinking"), description: t("settings.ai.decisions.featureAdaptiveThinkingDesc"), tooltip: t("settings.ai.decisions.featureAdaptiveThinkingTooltip") },
      { feature: 'largeResults', label: t("settings.ai.decisions.featureLargeResults"), description: t("settings.ai.decisions.featureLargeResultsDesc"), tooltip: t("settings.ai.decisions.featureLargeResultsTooltip") },
    ] },
    { id: 'conversation', title: t("settings.ai.decisions.groupConversation"), toggles: [
      { feature: 'midTurnMessages', label: t("settings.ai.decisions.featureMidTurnMessages"), description: t("settings.ai.decisions.featureMidTurnMessagesDesc"), tooltip: t("settings.ai.decisions.featureMidTurnMessagesTooltip") },
      { feature: 'turnOutcome', label: t("settings.ai.decisions.featureTurnOutcome"), description: t("settings.ai.decisions.featureTurnOutcomeDesc"), tooltip: t("settings.ai.decisions.featureTurnOutcomeTooltip") },
      { feature: 'smartTitles', label: t("settings.ai.decisions.featureSmartTitles"), description: t("settings.ai.decisions.featureSmartTitlesDesc"), tooltip: t("settings.ai.decisions.featureSmartTitlesTooltip") },
    ] },
    { id: 'permissions', title: t("settings.ai.decisions.groupPermissions"), toggles: [
      { feature: 'guardedMode', label: t("settings.ai.decisions.featureGuardedMode"), description: t("settings.ai.decisions.featureGuardedModeDesc"), tooltip: t("settings.ai.decisions.featureGuardedModeTooltip") },
      { feature: 'riskBadges', label: t("settings.ai.decisions.featureRiskBadges"), description: t("settings.ai.decisions.featureRiskBadgesDesc"), tooltip: t("settings.ai.decisions.featureRiskBadgesTooltip") },
    ] },
    { id: 'automations', title: t("settings.ai.decisions.groupAutomations"), toggles: [
      { feature: 'semanticLabels', label: t("settings.ai.decisions.featureSemanticLabels"), description: t("settings.ai.decisions.featureSemanticLabelsDesc"), tooltip: t("settings.ai.decisions.featureSemanticLabelsTooltip") },
      { feature: 'automationConditions', label: t("settings.ai.decisions.featureAutomationConditions"), description: t("settings.ai.decisions.featureAutomationConditionsDesc"), tooltip: t("settings.ai.decisions.featureAutomationConditionsTooltip") },
      { feature: 'taskVerdicts', label: t("settings.ai.decisions.featureTaskVerdicts"), description: t("settings.ai.decisions.featureTaskVerdictsDesc"), tooltip: t("settings.ai.decisions.featureTaskVerdictsTooltip") },
      { feature: 'taskRepairs', label: t("settings.ai.decisions.featureTaskRepairs"), description: t("settings.ai.decisions.featureTaskRepairsDesc"), tooltip: t("settings.ai.decisions.featureTaskRepairsTooltip") },
    ] },
  ]
  // A remote server on an older version reports fewer features: show and count only what it knows.
  const decisionReportedGroups = decisionStatus
    ? decisionFeatureGroups
      .map(group => ({ ...group, toggles: group.toggles.filter(({ feature }) => feature in decisionStatus.settings.features) }))
      .filter(group => group.toggles.length > 0)
    : []
  const decisionReportedToggles = decisionReportedGroups.flatMap(group => group.toggles)
  const decisionFeaturesOn = decisionReportedToggles.filter(({ feature }) => decisionStatus?.settings.features[feature]).length
  const decisionKeySourceValue = decisionStatus?.settings.connectionSlug
    ? `connection:${decisionStatus.settings.connectionSlug}`
    : `provider:${decisionStatus?.settings.provider ?? 'typesafe'}`
  const decisionKeySourceOptions = useMemo(() => {
    if (!decisionStatus) return []
    return [
      ...decisionStatus.presets.map(p => ({
        value: `provider:${p.id}`,
        label: p.label,
        description: p.local
          ? (p.id === 'custom' ? t("settings.ai.decisions.customProviderDesc") : t("settings.ai.decisions.localProviderDesc"))
          : p.baseUrl,
      })),
      ...decisionStatus.reusableConnections.map(c => ({
        value: `connection:${c.slug}`,
        label: t("settings.ai.decisions.reuseConnection", { name: c.name }),
        description: decisionStatus.presets.find(p => p.id === c.provider)?.label ?? c.provider,
      })),
    ]
  }, [decisionStatus, t])
  const decisionHasStoredKey = !!decisionStatus && decisionStatus.providersWithKey.includes(decisionStatus.settings.provider)
  const decisionKeyHelpUrl = decisionPreset?.dashboardUrl ?? decisionPreset?.docsUrl
  const decisionUsesConnection = !!decisionStatus?.settings.connectionSlug
  // Local presets (Laya, custom) expose the base URL and a server probe instead of a key hint.
  const decisionUsesLocalProvider = !!decisionPreset?.local && !decisionUsesConnection
  const decisionUsesCustomProvider = decisionStatus?.settings.provider === 'custom' && !decisionUsesConnection

  const probeDecisionServer = useCallback(async (baseUrl?: string) => {
    if (typeof window.electronAPI?.probeDecisionServer !== 'function') return
    setDecisionProbing(true)
    try {
      setDecisionProbe(await window.electronAPI.probeDecisionServer(baseUrl ? { baseUrl } : undefined))
    } catch (error) {
      console.error('Failed to probe decision server:', error)
      setDecisionProbe(null)
    } finally {
      setDecisionProbing(false)
    }
  }, [])

  // Probe whenever a local provider is selected or its base URL changes on disk.
  useEffect(() => {
    if (!decisionUsesLocalProvider) { setDecisionProbe(null); return }
    void probeDecisionServer()
  }, [decisionUsesLocalProvider, decisionStatus?.settings.provider, decisionStatus?.settings.baseUrl, probeDecisionServer])

  const decisionProbeDescription = decisionProbing || (decisionUsesLocalProvider && !decisionProbe)
    ? t("common.checking")
    : decisionProbe?.reachable && decisionProbe.health
      ? t("settings.ai.decisions.localServerRunning", { url: decisionProbe.baseUrl, models: decisionProbe.health.loaded?.length ? decisionProbe.health.loaded.join(', ') : '—' })
      : decisionProbe?.reachable
        ? t("settings.ai.decisions.localServerReachable", { url: decisionProbe.baseUrl })
        : t("settings.ai.decisions.localServerUnreachable", { url: decisionProbe?.baseUrl ?? '' })

  const handleDecisionKeySourceChange = useCallback((value: string) => {
    setDecisionKeyDraft('')
    if (value.startsWith('connection:')) {
      const slug = value.slice('connection:'.length)
      const provider = decisionStatus?.reusableConnections.find(c => c.slug === slug)?.provider
      void updateDecisionSettings({ connectionSlug: slug, ...(provider ? { provider } : {}) })
    } else if (value.startsWith('provider:')) {
      void updateDecisionSettings({ connectionSlug: null, provider: value.slice('provider:'.length) as DecisionProviderId })
    }
  }, [decisionStatus, updateDecisionSettings])

  const commitDecisionField = useCallback((field: 'model' | 'baseUrl', value: string) => {
    const current = decisionStatus?.settings[field] ?? ''
    if (value.trim() === current) return
    void updateDecisionSettings({ [field]: value.trim() || null })
  }, [decisionStatus, updateDecisionSettings])

  const handleSaveDecisionKey = useCallback(async () => {
    if (!decisionStatus || !decisionKeyDraft.trim()) return
    try {
      await window.electronAPI.setDecisionApiKey(decisionStatus.settings.provider, decisionKeyDraft.trim())
      setDecisionKeyDraft('')
      toast.success(t("settings.ai.decisions.keySaved"))
      await refreshDecisionStatus(false)
    } catch (error) {
      console.error('Failed to save decision model key:', error)
      toast.error(t("settings.ai.decisions.saveFailed"))
    }
  }, [decisionStatus, decisionKeyDraft, refreshDecisionStatus, t])

  const handleRemoveDecisionKey = useCallback(async () => {
    if (!decisionStatus) return
    try {
      await window.electronAPI.deleteDecisionApiKey(decisionStatus.settings.provider)
      toast.success(t("settings.ai.decisions.keyRemoved"))
      await refreshDecisionStatus(false)
    } catch (error) {
      console.error('Failed to remove decision model key:', error)
      toast.error(t("settings.ai.decisions.saveFailed"))
    }
  }, [decisionStatus, refreshDecisionStatus, t])

  const handleTestDecision = useCallback(async () => {
    setDecisionTesting(true)
    setDecisionTestResult(null)
    try {
      const result = await window.electronAPI.testDecisionConnection({
        settings: { model: decisionModelDraft.trim() || null, baseUrl: decisionBaseUrlDraft.trim() || null },
        apiKey: decisionKeyDraft.trim() || undefined,
      })
      setDecisionTestResult(result)
    } catch (error) {
      setDecisionTestResult({ ok: false, failure: { kind: 'unavailable', message: error instanceof Error ? error.message : String(error) } })
    } finally {
      setDecisionTesting(false)
    }
  }, [decisionModelDraft, decisionBaseUrlDraft, decisionKeyDraft])

  const decisionTestDescription = decisionTestResult
    ? decisionTestResult.ok
      ? t("settings.ai.decisions.testSuccess", { model: decisionTestResult.model, latency: decisionTestResult.latencyMs })
      : t("settings.ai.decisions.testFailed", { message: decisionTestResult.failure.message })
    : t("settings.ai.decisions.testDesc")


  // Refresh callback for workspace cards
  const handleWorkspaceSettingsChange = useCallback(() => {
    // Refresh context so changes propagate immediately
    refreshLlmConnections?.()
  }, [refreshLlmConnections])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t("settings.ai.title")} actions={<HeaderMenu route={routes.view.settings('ai')} />} />
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
              <SettingsSection title={t("settings.ai.defaultSection")} description={t("settings.ai.defaultSectionDesc")}>
                <SettingsCard>
                  <SettingsMenuSelectRow
                    label={t("settings.ai.connection")}
                    description={t("settings.ai.connectionDesc")}
                    value={defaultConnection?.slug || ''}
                    onValueChange={handleSetDefaultConnection}
                    options={llmConnections.map((conn) => ({
                      value: conn.slug,
                      label: conn.name,
                      description: conn.providerType === 'anthropic' ? 'Anthropic API' :
                                   conn.providerType === 'pi' ? 'Craft Agents Backend' :
                                   conn.providerType === 'pi_compat' ? (conn.baseUrl?.toLowerCase().includes('manifest.build') ? 'Manifest' : 'Craft Agents Backend Compatible') :
                                   conn.providerType || 'Unknown',
                    }))}
                  />
                  <SettingsMenuSelectRow
                    label={t("settings.ai.model")}
                    description={t("settings.ai.modelDesc")}
                    value={defaultModel}
                    onValueChange={handleDefaultModelChange}
                    options={getModelOptionsForConnection(defaultConnection).map(o => ({
                      ...o, description: o.descriptionKey ? t(o.descriptionKey) : o.description,
                    }))}
                  />
                  <SettingsMenuSelectRow
                    label={t("settings.ai.thinking")}
                    description={t("settings.ai.thinkingDesc")}
                    value={defaultThinking}
                    onValueChange={(v) => handleDefaultThinkingChange(v as ThinkingLevel)}
                    options={THINKING_LEVELS.map(({ id, nameKey, descriptionKey }) => ({
                      value: id,
                      label: t(nameKey),
                      description: t(descriptionKey),
                    }))}
                  />
                </SettingsCard>
              </SettingsSection>
              )}

              {/* Workspace Overrides - only show if connections exist */}
              {workspaces.length > 0 && llmConnections.length > 0 && (
                <SettingsSection title={t("settings.ai.workspaceOverrides")} description={t("settings.ai.workspaceOverridesDesc")}>
                  <div className="space-y-2">
                    {workspaces.map((workspace) => (
                      <WorkspaceOverrideCard
                        key={workspace.id}
                        workspace={workspace}
                        llmConnections={llmConnections}
                        onSettingsChange={handleWorkspaceSettingsChange}
                      />
                    ))}
                  </div>
                </SettingsSection>
              )}

              {/* Connections Management */}
              <SettingsSection title={t("settings.ai.connections")} description={t("settings.ai.connectionsDesc")}>
                <SettingsCard>
                  {llmConnections.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                      {t("settings.ai.noConnections")}
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
                        onRenameClick={() => handleRenameClick(conn)}
                        onDelete={() => handleDeleteConnection(conn.slug)}
                        onSetDefault={() => handleSetDefaultConnection(conn.slug)}
                        onValidate={() => handleValidateConnection(conn.slug)}
                        onReauthenticate={() => handleReauthenticateConnection(conn)}
                        onEdit={() => handleEditConnection(conn)}
                        onSetMidStreamBehavior={(behavior) => handleSetMidStreamBehavior(conn, behavior)}
                        validationState={validationStates[conn.slug]?.state || 'idle'}
                        validationError={validationStates[conn.slug]?.error}
                        isDuplicateAccount={!!conn.oauthAccountUuid && duplicateAccountUuids.has(conn.oauthAccountUuid)}
                      />
                    ))
                  )}
                </SettingsCard>
                <div className="pt-0">
                  <button
                    onClick={() => openApiSetup()}
                    className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.02] transition-colors"
                  >
                    {t("settings.ai.addConnection")}
                  </button>
                </div>
              </SettingsSection>

              {/* Performance */}
              <SettingsSection title={t("settings.ai.performance")} description={t("settings.ai.performanceDesc")}>
                <SettingsCard>
                  <SettingsToggle
                    label={t("settings.ai.extendedContext")}
                    description={t("settings.ai.extendedContextDesc")}
                    checked={enable1MContext}
                    onCheckedChange={handleEnable1MContextChange}
                  />
                  <SettingsToggle
                    label={t("settings.ai.extendedPromptCache")}
                    description={t("settings.ai.extendedPromptCacheDesc")}
                    checked={extendedPromptCache}
                    onCheckedChange={handleExtendedPromptCacheChange}
                  />
                  {rtkStatus?.installed ? (
                    <>
                      <SettingsToggle
                        label={t("settings.ai.rtk.title")}
                        description={t("settings.ai.rtk.description")}
                        checked={rtkEnabled}
                        onCheckedChange={handleRtkToggle}
                      />
                      {rtkStatus.outdated && (
                        <SettingsRow
                          label={t("settings.ai.rtk.outdated", { version: rtkStatus.version ?? '?' })}
                          description={t("settings.ai.rtk.outdatedDesc", { min: rtkStatus.minSafeVersion })}
                        >
                          <Button
                            size="sm"
                            onClick={() => setRtkUpdateOpen(true)}
                            className="bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                          >
                            {t("settings.ai.rtk.update")}
                          </Button>
                        </SettingsRow>
                      )}
                      {rtkStatus.outdated && (
                        <RtkUpdateDialog open={rtkUpdateOpen} onOpenChange={setRtkUpdateOpen} status={rtkStatus} onStatusChange={setRtkStatus} />
                      )}
                      {rtkEnabled && rtkGain && rtkGain.totalCommands > 0 && (
                        <div className="px-4 pb-4 -mt-1">
                          <div className="flex items-center justify-between text-xs text-foreground/60">
                            <span>
                              {t("settings.ai.rtk.gainSummary", {
                                saved: formatTokenCount(rtkGain.totalSaved),
                                count: rtkGain.totalCommands,
                                pct: rtkGain.avgSavingsPct.toFixed(1),
                              })}
                            </span>
                            <button
                              type="button"
                              onClick={refreshRtkGain}
                              className="text-foreground/60 hover:text-foreground transition-colors"
                              aria-label={t("settings.ai.rtk.gainRefresh")}
                            >
                              <RefreshCcw className="size-3" />
                            </button>
                          </div>
                          <div className="mt-2 h-1.5 rounded-full bg-foreground/10 overflow-hidden">
                            <div
                              className="h-full bg-foreground/60 transition-all"
                              style={{ width: `${Math.min(100, Math.max(0, rtkGain.avgSavingsPct))}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <SettingsRow
                      label={t("settings.ai.rtk.title")}
                      description={rtkStatus === null ? t("common.checking") : t("settings.ai.rtk.notInstalledDesc")}
                    >
                      <Button
                        size="sm"
                        onClick={handleGetRtk}
                        className="bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                      >
                        {t("settings.ai.rtk.getRtk")}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleRecheckRtk}
                        disabled={rtkRechecking || rtkStatus === null}
                        className="bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                      >
                        {rtkRechecking ? t("common.checking") : t("settings.ai.rtk.recheck")}
                      </Button>
                    </SettingsRow>
                  )}
                </SettingsCard>
              </SettingsSection>

              {/* Decision model (Jev) — opt-in decision layer, off by default */}
              {decisionStatus && (
                <SettingsSection title={t("settings.ai.decisions.title")} description={t("settings.ai.decisions.sectionDesc")}>
                  <SettingsCard>
                    <SettingsToggle
                      label={t("settings.ai.decisions.enable")}
                      description={t("settings.ai.decisions.enableDesc")}
                      checked={decisionStatus.settings.enabled}
                      onCheckedChange={(enabled) => { void updateDecisionSettings({ enabled }) }}
                    />
                    <SettingsMenuSelectRow
                      label={t("settings.ai.decisions.keySource")}
                      description={t("settings.ai.decisions.keySourceDesc")}
                      value={decisionKeySourceValue}
                      onValueChange={handleDecisionKeySourceChange}
                      options={decisionKeySourceOptions}
                      menuWidth={340}
                    />
                    {decisionUsesLocalProvider && (
                      <SettingsInput
                        inCard
                        type="url"
                        label={t("settings.ai.decisions.baseUrl")}
                        description={decisionUsesCustomProvider ? t("settings.ai.decisions.baseUrlDesc") : t("settings.ai.decisions.baseUrlLocalDesc")}
                        value={decisionBaseUrlDraft}
                        onChange={setDecisionBaseUrlDraft}
                        onBlur={() => commitDecisionField('baseUrl', decisionBaseUrlDraft)}
                        placeholder={decisionPreset?.baseUrl || 'http://localhost:8080'}
                      />
                    )}
                    {decisionUsesLocalProvider && (
                      <SettingsRow
                        label={t("settings.ai.decisions.localServer")}
                        description={decisionProbeDescription}
                      >
                        {decisionPreset?.docsUrl && (
                          <Button
                            size="sm"
                            onClick={() => window.electronAPI?.openUrl(decisionPreset.docsUrl!)}
                            className="bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                          >
                            {t("settings.ai.decisions.localServerDocs")}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() => { void probeDecisionServer(decisionBaseUrlDraft.trim() || undefined) }}
                          disabled={decisionProbing}
                          className="bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                        >
                          {decisionProbing ? t("common.checking") : t("settings.ai.decisions.recheck")}
                        </Button>
                      </SettingsRow>
                    )}
                    {decisionUsesLocalProvider && decisionPreset?.installHint && decisionProbe && !decisionProbe.reachable && (
                      <p className="px-4 pb-3 -mt-1 text-xs text-foreground/60">
                        {t("settings.ai.decisions.localServerInstallHint")}{' '}
                        <code className="font-mono text-[11px] text-foreground/80 select-all">{decisionPreset.installHint}</code>
                      </p>
                    )}
                    {!decisionUsesConnection && (
                      decisionHasStoredKey ? (
                        <SettingsRow
                          label={t("settings.ai.decisions.apiKey")}
                          description={t("settings.ai.decisions.apiKeySaved")}
                        >
                          <Button
                            size="sm"
                            onClick={handleRemoveDecisionKey}
                            className="bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                          >
                            {t("settings.ai.decisions.removeKey")}
                          </Button>
                        </SettingsRow>
                      ) : (
                        <SettingsInput
                          inCard
                          type="password"
                          label={t("settings.ai.decisions.apiKey")}
                          description={decisionKeyHelpUrl
                            ? t("settings.ai.decisions.apiKeyDesc", { url: decisionKeyHelpUrl })
                            : t("settings.ai.decisions.apiKeyDescGeneric")}
                          value={decisionKeyDraft}
                          onChange={setDecisionKeyDraft}
                          placeholder={decisionPreset?.keyPlaceholder}
                          action={(
                            <Button
                              size="sm"
                              onClick={handleSaveDecisionKey}
                              disabled={!decisionKeyDraft.trim()}
                              className="bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                            >
                              {t("settings.ai.decisions.saveKey")}
                            </Button>
                          )}
                        />
                      )
                    )}
                    <SettingsInput
                      inCard
                      label={t("settings.ai.decisions.model")}
                      description={t("settings.ai.decisions.modelDesc")}
                      value={decisionModelDraft}
                      onChange={setDecisionModelDraft}
                      onBlur={() => commitDecisionField('model', decisionModelDraft)}
                      placeholder={decisionPreset?.defaultModel}
                    />
                    <SettingsRow
                      label={t("settings.ai.decisions.test")}
                      description={decisionTestDescription}
                    >
                      <Button
                        size="sm"
                        onClick={handleTestDecision}
                        disabled={decisionTesting}
                        className="bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                      >
                        {decisionTesting ? t("common.checking") : t("settings.ai.decisions.testRun")}
                      </Button>
                    </SettingsRow>
                    <p className="px-4 pb-4 -mt-1 text-xs text-foreground/60">
                      {t("settings.ai.decisions.privacyNote")}
                    </p>
                  </SettingsCard>

                  {/* Advanced settings: what the decision model is used for, collapsed by default.
                      Same structure as the Workspace Overrides cards: the toggles expand inside the card. */}
                  <SettingsCard>
                    <button
                      type="button"
                      aria-expanded={decisionAdvancedOpen}
                      onClick={() => setDecisionAdvancedOpen(open => !open)}
                      className="w-full flex items-center justify-between py-3 px-4 hover:bg-foreground/[0.02] transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full bg-foreground/5 ring-1 ring-border/50 flex items-center justify-center">
                          <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <div className="text-left">
                          <div className="text-sm font-medium">{t("settings.ai.decisions.advanced")}</div>
                          <div className="text-xs text-muted-foreground">
                            {decisionStatus.settings.enabled
                              ? t("settings.ai.decisions.advancedSummary", { on: decisionFeaturesOn, total: decisionReportedToggles.length })
                              : t("settings.ai.decisions.advancedSummaryOff")}
                          </div>
                        </div>
                      </div>
                      {decisionAdvancedOpen ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>

                    <AnimatePresence initial={false}>
                      {decisionAdvancedOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                          className="overflow-hidden"
                        >
                          <div className="border-t border-border/50 px-4 py-2">
                            {decisionReportedGroups.map((group, index) => (
                              <div key={group.id} className={cn(index > 0 && 'mt-1 border-t border-border/30')}>
                                <div className="px-4 pt-3 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  {group.title}
                                </div>
                                {group.toggles.map(({ feature, label, description, tooltip }) => (
                                  <SettingsToggle
                                    key={feature}
                                    label={label}
                                    description={description}
                                    tooltip={tooltip}
                                    note={decisionUsageNote(decisionUsage[feature])}
                                    checked={decisionStatus.settings.features[feature] ?? false}
                                    disabled={!decisionStatus.settings.enabled}
                                    onCheckedChange={(checked) => { void updateDecisionSettings({ features: { [feature]: checked } }) }}
                                  />
                                ))}
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </SettingsCard>
                </SettingsSection>
              )}

              {/* API Setup Fullscreen Overlay */}
              <FullscreenOverlayBase
                isOpen={showApiSetup}
                onClose={handleCloseApiSetup}
                className="z-splash flex flex-col bg-foreground-2"
              >
                <OnboardingWizard
                  state={apiSetupOnboarding.state}
                  onContinue={apiSetupOnboarding.handleContinue}
                  onBack={isDirectEdit ? handleCloseApiSetup : apiSetupOnboarding.handleBack}
                  onSelectProvider={apiSetupOnboarding.handleSelectProvider}
                  onSelectApiSetupMethod={apiSetupOnboarding.handleSelectApiSetupMethod}
                  onSubmitCredential={apiSetupOnboarding.handleSubmitCredential}
                  onSubmitLocalModel={apiSetupOnboarding.handleSubmitLocalModel}
                  onStartOAuth={apiSetupOnboarding.handleStartOAuth}
                  onFinish={handleApiSetupFinish}
                  isWaitingForCode={apiSetupOnboarding.isWaitingForCode}
                  isProviderOAuthPending={apiSetupOnboarding.isProviderOAuthPending}
                  onSubmitAuthCode={apiSetupOnboarding.handleSubmitAuthCode}
                  onCancelOAuth={apiSetupOnboarding.handleCancelOAuth}
                  copilotDeviceCode={apiSetupOnboarding.copilotDeviceCode}
                  editInitialValues={editInitialValues}
                  className="h-full"
                />
                <div
                  className="fixed top-0 right-0 h-[50px] flex items-center pr-5 [-webkit-app-region:no-drag]"
                  style={{ zIndex: 'var(--z-fullscreen, 350)' }}
                >
                  <button
                    onClick={handleCloseApiSetup}
                    className="p-1.5 rounded-[6px] transition-all bg-background shadow-minimal text-muted-foreground/50 hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    title={t("common.closeEsc")}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </FullscreenOverlayBase>

              {/* Rename Connection Dialog */}
              <RenameDialog
                open={renameDialogOpen}
                onOpenChange={setRenameDialogOpen}
                title={t("settings.ai.renameConnection")}
                value={renameValue}
                onValueChange={setRenameValue}
                onSubmit={handleRenameSubmit}
                placeholder={t("settings.ai.enterConnectionName")}
              />
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
