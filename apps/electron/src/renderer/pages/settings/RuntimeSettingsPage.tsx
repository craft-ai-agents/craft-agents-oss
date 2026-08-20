/**
 * RuntimeSettingsPage — AI runtime management:
 * - compact default LLM connection card (full editor lives in AI settings)
 * - default thinking level
 * - workspace approval (permission) mode
 * - toolchain status rows (phase/progress, manual update/retry) + enable/disable
 *   toggles (toolchain.disabled)
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, ChevronRight, CloudOff, Plus, X } from 'lucide-react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { navigate, routes } from '@/lib/navigate'
import { useAppShellContext } from '@/context/AppShellContext'
import { activeSessionIdAtom } from '@/atoms/sessions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@craft-agent/ui'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
  SettingsMenuSelectRow,
} from '@/components/settings'
import { useToolchainStatus } from '@/hooks/useToolchainStatus'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { PermissionMode, ThinkingLevel, ToolchainToolName, ToolchainToolStatus } from '../../../shared/types'
import { cn } from '@/lib/utils'
import { DEFAULT_THINKING_LEVEL, THINKING_LEVELS } from '@craft-agent/shared/agent/thinking-levels'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'runtime',
}

// ============================================
// Toolchain status rows (restored from the absorbed ToolchainSettingsPage)
// ============================================

/**
 * Preferred display order for status rows. Unknown/new tools from the manager
 * append alphabetically after this list so default-on/opt-in (just, fzf, gbrain…)
 * are never dropped from the Runtime status section.
 */
const TOOL_ORDER: readonly ToolchainToolName[] = [
  'omp',
  'bun',
  'uv',
  'node',
  'python',
  'git',
  'gh',
  'jq',
  'yq',
  'ffmpeg',
  'pandoc',
  'just',
  'fzf',
  'mise',
  'worktrunk',
  'gbrain',
  'opencode-ai',
  'oh-my-codex',
  'oh-my-claude-sisyphus',
  'skills',
  'infisical',
  'eve',
  'agent-browser',
  'portless',
  'just-bash',
  'opensrc',
  'deepsec',
  'dev3000',
  'mole',
  'docker',
  'brew',
  'pip-packaging',
  'cli-anything',
]

const TOOL_LABELS: Partial<Record<ToolchainToolName, string>> = {
  omp: 'OMP runtime',
  bun: 'Bun',
  uv: 'uv',
  node: 'Node.js LTS',
  python: 'Python 3.12',
  git: 'git',
  gh: 'GitHub CLI',
  jq: 'jq',
  yq: 'yq',
  ffmpeg: 'ffmpeg',
  pandoc: 'pandoc',
  just: 'just',
  fzf: 'fzf',
  mise: 'mise',
  worktrunk: 'worktrunk (wt)',
  gbrain: 'gbrain',
  'opencode-ai': 'OpenCode',
  'oh-my-codex': 'oh-my-codex',
  'oh-my-claude-sisyphus': 'oh-my-claude-sisyphus',
  skills: 'skills CLI',
  infisical: 'Infisical CLI',
  eve: 'eve',
  'agent-browser': 'agent-browser',
  portless: 'portless',
  'just-bash': 'just-bash',
  opensrc: 'opensrc',
  deepsec: 'deepsec',
  dev3000: 'dev3000',
  mole: 'Mole',
  docker: 'Docker',
  brew: 'Homebrew',
  'pip-packaging': 'packaging (pip)',
  'cli-anything': 'CLI-Anything',
}

/** Detect/system tools: install-guide copy when missing / no brew (no auto-install). */
const INSTALL_GUIDES: Partial<Record<ToolchainToolName, { command: string; url?: string }>> = {
  docker: {
    command: 'https://docs.docker.com/get-docker/',
    url: 'https://docs.docker.com/get-docker/',
  },
  brew: {
    command: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    url: 'https://brew.sh',
  },
}

/** Detect-only tools stay guide/copy UX — never call update() to "install". */
const DETECT_ONLY_TOOLS: Record<string, true> = { docker: true, brew: true }

/** Extract a displayable message from an unknown caught value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Format bytes as compact MB, locale-agnostic. */
function formatSizeMb(bytes?: number): string | undefined {
  if (!bytes || bytes <= 0) return undefined
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Download progress percentage 0–100, or undefined when indeterminate. */
function downloadPercent(tool: ToolchainToolStatus): number | undefined {
  if (!tool.totalBytes || tool.totalBytes <= 0 || !tool.downloadedBytes) return undefined
  return Math.min(100, Math.max(0, Math.round((tool.downloadedBytes / tool.totalBytes) * 100)))
}

/** Small status chip styled after the existing settings badges. */
function StatusBadge({ tone, children }: { tone: 'muted' | 'warn' | 'error' | 'ok'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 h-5 px-2 text-[11px] font-medium rounded-[4px]',
        tone === 'muted' && 'bg-background shadow-minimal text-foreground/60',
        tone === 'ok' && 'bg-background shadow-minimal text-foreground/60',
        tone === 'warn' && 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
        tone === 'error' && 'bg-destructive/10 text-destructive',
      )}
    >
      {children}
    </span>
  )
}

interface ToolRowProps {
  tool: ToolchainToolStatus
  isUpdating: boolean
  onUpdate: (name: ToolchainToolName) => void
}

function ToolRow({ tool, isUpdating, onUpdate }: ToolRowProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const sizeLabel = formatSizeMb(tool.totalBytes)
  const versionLabel = tool.installedVersion ? `v${tool.installedVersion}` : undefined

  // Meta line: phase label + version + size (locale-independent ordering,
  // consistent with the "· "-joined rows elsewhere in settings)
  const metaParts: string[] = [t(`settings.toolchain.status.${tool.phase}`)]
  if (versionLabel) metaParts.push(versionLabel)
  if (sizeLabel) metaParts.push(sizeLabel)
  const meta = metaParts.join(' · ')

  const percent = downloadPercent(tool)
  const showProgress = tool.phase === 'downloading'
  const guide = INSTALL_GUIDES[tool.name]
  const needsGuide =
    !!guide && (tool.phase === 'missing' || tool.phase === 'skipped-no-brew' || tool.phase === 'offline')

  const copyGuide = async () => {
    if (!guide) return
    try {
      await navigator.clipboard.writeText(guide.command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard may be denied — ignore
    }
  }

  const action = (() => {
    // Opt-in installable tools (mole, cli-anything, pip, npm opt-in…): Install when missing.
    // Detect-only (docker/brew) keep guide/copy UX below — never call onUpdate to install.
    if (
      tool.phase === 'missing' &&
      tool.tier === 'opt-in' &&
      !DETECT_ONLY_TOOLS[tool.name]
    ) {
      return (
        <Button variant="outline" size="sm" disabled={isUpdating} onClick={() => onUpdate(tool.name)}>
          {isUpdating ? <Spinner className="mr-1.5" /> : null}
          {t('settings.toolchain.install')}
        </Button>
      )
    }
    if (tool.phase === 'outdated') {
      return (
        <Button variant="outline" size="sm" disabled={isUpdating} onClick={() => onUpdate(tool.name)}>
          {isUpdating ? <Spinner className="mr-1.5" /> : null}
          {t('settings.toolchain.updateNow')}
        </Button>
      )
    }
    if (tool.phase === 'error') {
      return (
        <Button variant="outline" size="sm" disabled={isUpdating} onClick={() => onUpdate(tool.name)}>
          {isUpdating ? <Spinner className="mr-1.5" /> : null}
          {t('settings.toolchain.retry')}
        </Button>
      )
    }
    if (needsGuide) {
      return (
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => void copyGuide()}>
            {copied ? t('settings.toolchain.guideCopied') : t('settings.toolchain.copyInstallGuide')}
          </Button>
          {guide?.url ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(guide.url, '_blank', 'noopener,noreferrer')}
            >
              {t('settings.toolchain.openDocs')}
            </Button>
          ) : null}
        </div>
      )
    }
    return null
  })()

  const badge = (() => {
    switch (tool.phase) {
      case 'ready':
        return (
          <StatusBadge tone="ok">
            <CheckCircle2 className="h-3 w-3" />
          </StatusBadge>
        )
      case 'outdated':
        return <StatusBadge tone="muted">{t('settings.toolchain.status.outdated')}</StatusBadge>
      case 'error':
        return (
          <StatusBadge tone="error">
            <AlertTriangle className="h-3 w-3" />
            {t('settings.toolchain.status.error')}
          </StatusBadge>
        )
      case 'offline':
        return (
          <StatusBadge tone="warn">
            <CloudOff className="h-3 w-3" />
            {t('settings.toolchain.status.offline')}
          </StatusBadge>
        )
      case 'skipped-no-brew':
        return <StatusBadge tone="warn">{t('settings.toolchain.status.skipped-no-brew')}</StatusBadge>
      case 'missing':
        return <StatusBadge tone="muted">{t('settings.toolchain.status.missing')}</StatusBadge>
      case 'downloading':
      case 'installing':
        return (
          <StatusBadge tone="muted">
            {percent != null ? `${percent}%` : t(`settings.toolchain.status.${tool.phase}`)}
          </StatusBadge>
        )
      default:
        return null
    }
  })()

  return (
    <div data-layout="settings-row" className="w-full px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{TOOL_LABELS[tool.name] ?? tool.name}</div>
          <div className="text-sm text-muted-foreground truncate">
            {meta}
            {tool.phase === 'error' && tool.error && (
              <span className="text-destructive" title={tool.error}>
                {' '}
                — {tool.error}
              </span>
            )}
          </div>
          {needsGuide && guide ? (
            <div className="mt-1 font-mono text-[11px] text-muted-foreground/90 truncate" title={guide.command}>
              {guide.command}
            </div>
          ) : null}
        </div>
        <div data-layout="settings-control" className="flex items-center gap-2 ml-4 shrink-0">
          {badge}
          {action}
        </div>
      </div>
      {showProgress && (
        <div className="mt-2 h-1.5 rounded-full bg-foreground/10 overflow-hidden">
          <div
            className={cn('h-full bg-foreground/60', percent != null && 'transition-all')}
            style={{ width: `${percent ?? 100}%` }}
          />
        </div>
      )}
    </div>
  )
}

export default function RuntimeSettingsPage() {
  const { t } = useTranslation()
  const { available, isLoading, tools, updateTool, updating } = useToolchainStatus()
  const { activeWorkspaceId, llmConnections, refreshLlmConnections } = useAppShellContext()
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const [disabledTools, setDisabledTools] = useState<ToolchainToolName[]>([])
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(DEFAULT_THINKING_LEVEL)
  const [permissionMode, setPermissionMode] = useState<PermissionMode | null>(null)
  const [envEntries, setEnvEntries] = useState<Array<{ key: string; value: string }> | null>(null)
  const [savedEnvSnapshot, setSavedEnvSnapshot] = useState<string | null>(null)
  const [envSaving, setEnvSaving] = useState(false)
  const [envSavedFlash, setEnvSavedFlash] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [llmSwitching, setLlmSwitching] = useState(false)
  const [llmSessionFlash, setLlmSessionFlash] = useState<string | null>(null)

  const defaultLlmConnection = useMemo(() => {
    return llmConnections.find((c) => c.isDefault) ?? llmConnections[0] ?? null
  }, [llmConnections])


  const llmConnectionOptions = useMemo(
    () =>
      llmConnections.map((c) => ({
        value: c.slug,
        label: c.name,
        description: [c.providerType, c.defaultModel].filter(Boolean).join(' · '),
      })),
    [llmConnections],
  )
  const orderedTools = useMemo(() => {
    // E3: hide pip-packaging from Runtime UI; users only see cli-anything among pip tools.
    // Manifest/tests still know pip-packaging.
    const visible = tools.filter((tool) => tool.name !== 'pip-packaging')
    const byName: Partial<Record<ToolchainToolName, ToolchainToolStatus>> = {}
    for (const tool of visible) byName[tool.name] = tool
    const preferred = TOOL_ORDER.map((name) => byName[name]).filter(
      (tool): tool is ToolchainToolStatus => tool !== undefined,
    )
    const preferredSet = new Set(TOOL_ORDER)
    const extras = visible
      .filter((tool) => !preferredSet.has(tool.name))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
    return [...preferred, ...extras]
  }, [tools])

  useEffect(() => {
    window.electronAPI
      .getToolchainDisabled()
      .then(setDisabledTools)
      .catch((error) => {
        console.error('Failed to load disabled toolchain tools:', error)
        setPageError(errorMessage(error))
      })
    window.electronAPI
      .getDefaultThinkingLevel()
      .then(setThinkingLevel)
      .catch((error) => {
        console.error('Failed to load default thinking level:', error)
        setPageError(errorMessage(error))
      })
    window.electronAPI
      .getEnvOverrides()
      .then((env) => {
        const entries = Object.entries(env).map(([key, value]) => ({ key, value }))
        setEnvEntries(entries)
        setSavedEnvSnapshot(JSON.stringify(entries))
      })
      .catch((error) => {
        console.error('Failed to load session env overrides:', error)
        setPageError(errorMessage(error))
        setEnvEntries([])
        setSavedEnvSnapshot(JSON.stringify([]))
      })
  }, [])

  useEffect(() => {
    if (!activeWorkspaceId) return
    window.electronAPI
      .getWorkspaceSettings(activeWorkspaceId)
      .then((settings) => setPermissionMode(settings?.permissionMode ?? 'ask'))
      .catch((error) => {
        console.error('Failed to load workspace permission mode:', error)
        setPageError(errorMessage(error))
      })
  }, [activeWorkspaceId])

  const toggleTool = async (name: ToolchainToolName, enabled: boolean) => {
    const next = enabled
      ? disabledTools.filter((n) => n !== name)
      : [...disabledTools, name]
    setDisabledTools(next)
    setPageError(null)
    try {
      await window.electronAPI.setToolchainDisabled(next)
    } catch (error) {
      console.error('Failed to update disabled toolchain tools:', error)
      setPageError(errorMessage(error))
    }
  }

  const handleThinkingLevelChange = useCallback(async (level: ThinkingLevel) => {
    const previous = thinkingLevel
    setThinkingLevel(level)
    setPageError(null)
    try {
      const result = await window.electronAPI.setDefaultThinkingLevel(level)
      if (!result.success) {
        console.error('Failed to set default thinking level:', result.error)
        setPageError(result.error ?? t('common.failed'))
        setThinkingLevel(previous)
      }
    } catch (error) {
      console.error('Failed to set default thinking level:', error)
      setPageError(errorMessage(error))
      setThinkingLevel(previous)
    }
  }, [thinkingLevel])

  const handleDefaultLlmChange = useCallback(async (slug: string) => {
    if (!window.electronAPI || slug === defaultLlmConnection?.slug) return
    setLlmSwitching(true)
    setPageError(null)
    setLlmSessionFlash(null)
    try {
      const result = await window.electronAPI.setDefaultLlmConnection(slug)
      if (!result.success) {
        console.error('Failed to set default LLM connection:', result.error)
        setPageError(result.error ?? t('common.failed'))
      } else {
        await refreshLlmConnections()
        // B4: also push model/connection onto the focused chat session when present
        // (same ElectronAPI ChatPage uses). Failures here must not undo the default.
        if (activeSessionId && activeWorkspaceId) {
          const conn = llmConnections.find((c) => c.slug === slug)
          try {
            await window.electronAPI.setSessionModel(
              activeSessionId,
              activeWorkspaceId,
              conn?.defaultModel ?? null,
              slug,
            )
            setLlmSessionFlash(t('settings.runtime.llmAppliedToSession'))
            window.setTimeout(() => setLlmSessionFlash(null), 3000)
          } catch (sessionErr) {
            console.error('Failed to apply LLM connection to active session:', sessionErr)
            setLlmSessionFlash(t('settings.runtime.llmSessionApplyFailed'))
            window.setTimeout(() => setLlmSessionFlash(null), 4000)
          }
        } else {
          setLlmSessionFlash(t('settings.runtime.llmNextSessionOnly'))
          window.setTimeout(() => setLlmSessionFlash(null), 3000)
        }
      }
    } catch (error) {
      console.error('Failed to set default LLM connection:', error)
      setPageError(errorMessage(error))
    } finally {
      setLlmSwitching(false)
    }
  }, [
    activeSessionId,
    activeWorkspaceId,
    defaultLlmConnection?.slug,
    llmConnections,
    refreshLlmConnections,
    t,
  ])


  const handlePermissionModeChange = useCallback(async (mode: PermissionMode) => {
    if (!activeWorkspaceId) return
    const previous = permissionMode
    setPermissionMode(mode)
    setPageError(null)
    try {
      await window.electronAPI.updateWorkspaceSetting(activeWorkspaceId, 'permissionMode', mode)
    } catch (error) {
      console.error('Failed to update permission mode:', error)
      setPageError(errorMessage(error))
      setPermissionMode(previous)
    }
  }, [activeWorkspaceId, permissionMode])

  const updateEnvEntry = useCallback((index: number, patch: Partial<{ key: string; value: string }>) => {
    setEnvEntries((entries) => entries?.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)) ?? entries)
  }, [])

  const removeEnvEntry = useCallback((index: number) => {
    setEnvEntries((entries) => entries?.filter((_, i) => i !== index) ?? entries)
  }, [])

  const addEnvEntry = useCallback(() => {
    setEnvEntries((entries) => [...(entries ?? []), { key: '', value: '' }])
  }, [])

  const envDirty = useMemo(() => {
    if (envEntries === null || savedEnvSnapshot === null) return false
    return JSON.stringify(envEntries) !== savedEnvSnapshot
  }, [envEntries, savedEnvSnapshot])

  const saveEnvOverrides = useCallback(async () => {
    if (!envEntries || !envDirty) return
    setEnvSaving(true)
    setPageError(null)
    setEnvSavedFlash(false)
    try {
      const env: Record<string, string> = {}
      const normalized: Array<{ key: string; value: string }> = []
      for (const { key, value } of envEntries) {
        const trimmedKey = key.trim()
        if (!trimmedKey) continue
        env[trimmedKey] = value
        normalized.push({ key: trimmedKey, value })
      }
      await window.electronAPI.setEnvOverrides(env)
      setEnvEntries(normalized)
      setSavedEnvSnapshot(JSON.stringify(normalized))
      setEnvSavedFlash(true)
      window.setTimeout(() => setEnvSavedFlash(false), 2000)
    } catch (error) {
      console.error('Failed to save session env overrides:', error)
      setPageError(errorMessage(error))
    } finally {
      setEnvSaving(false)
    }
  }, [envEntries, envDirty])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader
        title={t('settings.runtime.title')}
        actions={<HeaderMenu route={routes.view.settings('runtime')} />}
      />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto space-y-8">
            {pageError && (
              <div className="border border-destructive/40 bg-destructive/10 text-destructive text-sm rounded-lg px-4 py-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="min-w-0 break-words">{pageError}</span>
              </div>
            )}
            <SettingsSection
              title={t('settings.runtime.llmConnections')}
              description={t('settings.runtime.llmConnectionsDesc')}
            >
              {llmConnections.length === 0 ? (
                <SettingsCard>
                  <div className="px-4 py-6 text-center space-y-3">
                    <p className="text-sm text-muted-foreground">{t('settings.runtime.llmEmpty')}</p>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => navigate(routes.view.settings('ai'))}
                    >
                      {t('settings.runtime.llmOpenAiSettings')}
                    </Button>
                  </div>
                </SettingsCard>
              ) : (
                <SettingsCard>
                  {defaultLlmConnection && (
                    <div className="px-4 py-3.5 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="text-sm font-medium truncate">{defaultLlmConnection.name}</div>
                          <div className="text-xs text-muted-foreground space-y-0.5">
                            <div>
                              <span className="text-foreground/70">{t('settings.runtime.llmProvider')}: </span>
                              <span className="font-mono">{defaultLlmConnection.providerType}</span>
                            </div>
                            {defaultLlmConnection.defaultModel && (
                              <div className="truncate">
                                <span className="text-foreground/70">{t('settings.runtime.llmModel')}: </span>
                                <span className="font-mono">{defaultLlmConnection.defaultModel}</span>
                              </div>
                            )}
                            {defaultLlmConnection.baseUrl && (
                              <div className="truncate" title={defaultLlmConnection.baseUrl}>
                                <span className="text-foreground/70">{t('settings.runtime.llmBaseUrl')}: </span>
                                <span className="font-mono">{defaultLlmConnection.baseUrl}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <StatusBadge tone={defaultLlmConnection.isAuthenticated ? 'ok' : 'warn'}>
                          {defaultLlmConnection.isAuthenticated
                            ? t('settings.runtime.llmAuthenticated')
                            : t('settings.runtime.llmUnauthenticated')}
                        </StatusBadge>
                      </div>
                    </div>
                  )}
                  <div className="h-px bg-border/50 mx-4" />
                  <SettingsMenuSelectRow
                    label={t('settings.runtime.llmDefault')}
                    value={defaultLlmConnection?.slug ?? ''}
                    onValueChange={handleDefaultLlmChange}
                    options={llmConnectionOptions}
                    disabled={llmSwitching || llmConnections.length < 2}
                  />
                  {llmSessionFlash && (
                    <p className="px-4 pb-3 text-xs text-muted-foreground">{llmSessionFlash}</p>
                  )}
                  <div className="h-px bg-border/50 mx-4" />
                  <SettingsRow
                    label={t('settings.runtime.llmOpenAiSettings')}
                    description={t('settings.runtime.openAiSettingsDesc')}
                    onClick={() => navigate(routes.view.settings('ai'))}
                    action={<ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  />
                </SettingsCard>
              )}
            </SettingsSection>

            <SettingsSection
              title={t('settings.runtime.thinkingLevel')}
              description={t('settings.runtime.thinkingLevelDesc')}
            >
              <SettingsCard>
                <SettingsMenuSelectRow
                  label={t('settings.ai.thinking')}
                  description={t('settings.ai.thinkingDesc')}
                  value={thinkingLevel}
                  onValueChange={(value) => handleThinkingLevelChange(value as ThinkingLevel)}
                  options={THINKING_LEVELS.map(({ id, nameKey, descriptionKey }) => ({
                    value: id,
                    label: t(nameKey),
                    description: t(descriptionKey),
                  }))}
                />
              </SettingsCard>
            </SettingsSection>

            <SettingsSection
              title={t('settings.runtime.approvalTitle')}
              description={t('settings.runtime.approvalDesc')}
            >
              <SettingsCard>
                {permissionMode === null ? (
                  activeWorkspaceId ? (
                    <div className="flex justify-center py-8">
                      <Spinner className="w-4 h-4" />
                    </div>
                  ) : (
                    <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                      {t('settings.runtime.approvalSelectWorkspace')}
                    </div>
                  )
                ) : (
                  <>
                    <SettingsMenuSelectRow
                      label={t('settings.runtime.approvalMode')}
                      description={t('settings.runtime.approvalModeDesc')}
                      value={permissionMode}
                      onValueChange={(value) => handlePermissionModeChange(value as PermissionMode)}
                      options={[
                        { value: 'safe', label: t('mode.explore'), description: t('mode.exploreDesc') },
                        { value: 'ask', label: t('mode.ask'), description: t('mode.askDesc') },
                        { value: 'allow-all', label: t('mode.execute'), description: t('mode.executeDesc') },
                      ]}
                    />
                    <div className="h-px bg-border/50 mx-4" />
                    <div className="px-4 py-2.5 text-xs text-muted-foreground">
                      {t('settings.runtime.approvalRespawnNote')}
                    </div>
                  </>
                )}
              </SettingsCard>
            </SettingsSection>

            {available && (
              <>
                <SettingsSection
                  title={t('settings.toolchain.toolsTitle')}
                  description={t('settings.toolchain.toolsDesc')}
                >
                  {isLoading ? (
                    <div className="flex justify-center py-8">
                      <Spinner className="w-4 h-4" />
                    </div>
                  ) : orderedTools.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                      {t('settings.toolchain.empty')}
                    </div>
                  ) : (
                    <SettingsCard>
                      {orderedTools.map((tool) => (
                        <ToolRow
                          key={tool.name}
                          tool={tool}
                          isUpdating={updating === tool.name}
                          onUpdate={updateTool}
                        />
                      ))}
                    </SettingsCard>
                  )}
                </SettingsSection>

                <SettingsSection
                  title={t('settings.toolchain.enabledTitle')}
                  description={t('settings.toolchain.enabledDesc')}
                >
                  {isLoading ? (
                    <div className="flex justify-center py-8">
                      <Spinner className="w-4 h-4" />
                    </div>
                  ) : (
                    <SettingsCard>
                      {/*
                        Only default-on tools are toggleable (ensureAll respects
                        toolchain.disabled). Core is always installed; opt-in is
                        update-only. Missing tier on legacy payloads → core
                        (no toggle) fail-safe.
                      */}
                      {tools
                        .filter((tool) => tool.tier === 'default-on')
                        .map((tool) => (
                          <SettingsToggle
                            key={tool.name}
                            label={TOOL_LABELS[tool.name] ?? tool.name}
                            checked={!disabledTools.includes(tool.name)}
                            onCheckedChange={(enabled) => toggleTool(tool.name, enabled)}
                          />
                        ))}
                    </SettingsCard>
                  )}
                </SettingsSection>
              </>
            )}

            <SettingsSection
              title={t('settings.runtime.envTitle')}
              description={t('settings.runtime.envDesc')}
            >
              <SettingsCard divided={false}>
                <div className="p-3 space-y-2">
                  {envEntries === null ? (
                    <div className="flex justify-center py-4">
                      <Spinner className="w-4 h-4" />
                    </div>
                  ) : (
                    <>
                      {envEntries.map((entry, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <Input
                            value={entry.key}
                            onChange={(e) => updateEnvEntry(index, { key: e.target.value })}
                            placeholder={t('settings.runtime.envKeyPlaceholder')}
                            spellCheck={false}
                            className="font-mono text-xs flex-1"
                          />
                          <span className="text-muted-foreground">=</span>
                          <Input
                            value={entry.value}
                            onChange={(e) => updateEnvEntry(index, { value: e.target.value })}
                            placeholder={t('settings.runtime.envValuePlaceholder')}
                            spellCheck={false}
                            className="font-mono text-xs flex-1"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeEnvEntry(index)}
                            aria-label={t('settings.runtime.envRemove')}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                      <div className="flex items-center justify-between pt-1 gap-2">
                        <Button variant="ghost" size="sm" onClick={addEnvEntry}>
                          <Plus className="w-3 h-3 mr-1" />
                          {t('settings.runtime.envAdd')}
                        </Button>
                        <div className="flex items-center gap-2">
                          {envSavedFlash ? (
                            <span className="text-xs text-muted-foreground">{t('settings.runtime.envSaved')}</span>
                          ) : null}
                          <Button size="sm" onClick={() => void saveEnvOverrides()} disabled={envSaving || !envDirty}>
                            {envSaving ? <Spinner className="w-3 h-3" /> : t('settings.runtime.envSave')}
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </SettingsCard>
            </SettingsSection>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
