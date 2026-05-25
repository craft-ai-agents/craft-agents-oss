import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
} from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import * as storage from '@/lib/local-storage'
import { navigate, routes } from '@/lib/navigate'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import {
  ANTHROPIC_MODELS,
  getModelDisplayName,
  getModelShortName,
} from '@config/models'
import {
  isCompatProvider,
  modelSupportsImages,
  resolveEffectiveConnectionSlug,
  type LlmConnectionWithStatus,
} from '@config/llm-connections'
import {
  THINKING_LEVELS,
  type ThinkingLevel,
} from '@craft-agent/shared/agent/thinking-levels'
import { ConnectionIcon } from '@/components/icons/ConnectionIcon'
import { derivePickerMode } from './picker-mode'
import {
  formatTokenCount,
  groupConnectionsByProvider,
  stripPiPrefixForDisplay,
} from './model-picker-helpers'
import { useModelVisionToggle } from './useModelVisionToggle'

interface CompactModelSelectorProps {
  currentModel: string
  currentConnection?: string
  onModelChange: (model: string, connection?: string) => void
  onConnectionChange?: (connectionSlug: string) => void
  thinkingLevel?: ThinkingLevel
  onThinkingLevelChange?: (level: ThinkingLevel) => void
  isEmptySession?: boolean
  connectionUnavailable?: boolean
  contextStatus?: {
    isCompacting?: boolean
    inputTokens?: number
    contextWindow?: number
  }
}

export function CompactModelSelector({
  currentModel,
  currentConnection,
  onModelChange,
  onConnectionChange,
  thinkingLevel = 'medium',
  onThinkingLevelChange,
  isEmptySession = false,
  connectionUnavailable = false,
  contextStatus,
}: CompactModelSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [expandedConnection, setExpandedConnection] = React.useState<string | null>(null)

  const appShellCtx = useOptionalAppShellContext()
  const llmConnections = appShellCtx?.llmConnections ?? []
  const workspaceDefaultConnection = appShellCtx?.workspaceDefaultLlmConnection

  const toggleVision = useModelVisionToggle()

  const effectiveConnection = resolveEffectiveConnectionSlug(
    currentConnection,
    workspaceDefaultConnection,
    llmConnections,
  )

  const effectiveConnectionDetails = React.useMemo(() => {
    if (!effectiveConnection) return null
    return llmConnections.find(c => c.slug === effectiveConnection) ?? null
  }, [llmConnections, effectiveConnection])

  const connectionDefaultModel = React.useMemo(() => {
    const conn = effectiveConnectionDetails
    if (!conn) return null
    if (!isCompatProvider(conn.providerType)) return null
    if (conn.models && conn.models.length > 1) return null
    return conn.defaultModel ?? null
  }, [effectiveConnectionDetails])

  const pickerMode = derivePickerMode({
    connectionUnavailable,
    connectionDefaultModel,
    isEmptySession,
    connectionCount: llmConnections.length,
  })

  const availableModels = React.useMemo(() => {
    if (connectionUnavailable) return []
    if (!effectiveConnectionDetails) return ANTHROPIC_MODELS
    return effectiveConnectionDetails.models || ANTHROPIC_MODELS
  }, [effectiveConnectionDetails, connectionUnavailable])

  const currentModelDisplayName = React.useMemo(() => {
    const modelToDisplay = connectionDefaultModel ?? currentModel
    const model = availableModels.find(m =>
      typeof m === 'string' ? m === modelToDisplay : m.id === modelToDisplay,
    )
    if (!model) return stripPiPrefixForDisplay(getModelDisplayName(modelToDisplay))
    if (typeof model === 'string') return stripPiPrefixForDisplay(model)
    return model.name ?? stripPiPrefixForDisplay(model.id)
  }, [availableModels, currentModel, connectionDefaultModel])

  const thinkingDisabled = React.useMemo(() => {
    const model = availableModels.find(
      m => typeof m !== 'string' && m.id === currentModel,
    )
    return typeof model !== 'string' && model?.supportsThinking === false
  }, [availableModels, currentModel])

  const connectionsByProvider = React.useMemo(
    () => groupConnectionsByProvider(llmConnections),
    [llmConnections],
  )

  const showConnectionIcon =
    !!effectiveConnectionDetails &&
    llmConnections.length > 1 &&
    storage.get(storage.KEYS.showConnectionIcons, true)

  // Reset accordion state when the drawer closes so re-open shows top-level switcher.
  React.useEffect(() => {
    if (!open) setExpandedConnection(null)
  }, [open])

  const handlePickFlatModel = React.useCallback(
    (modelId: string) => {
      onModelChange(modelId, effectiveConnection)
      setOpen(false)
    },
    [onModelChange, effectiveConnection],
  )

  const handlePickSwitcherModel = React.useCallback(
    (connSlug: string, modelId: string) => {
      const isCurrentConnection = effectiveConnection === connSlug
      if (!isCurrentConnection && onConnectionChange) {
        onConnectionChange(connSlug)
      }
      onModelChange(modelId, connSlug)
      setOpen(false)
    },
    [onModelChange, onConnectionChange, effectiveConnection],
  )

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button
          type="button"
          aria-label={connectionUnavailable
            ? t('common.unavailable')
            : `${t('common.model')}: ${currentModelDisplayName}`}
          className={cn(
            'h-7 pl-2 pr-2 text-xs font-medium rounded-[6px] flex items-center gap-1.5 shadow-tinted outline-none select-none min-w-[64px] shrink',
            connectionUnavailable
              ? 'bg-destructive/10 text-destructive'
              : 'bg-foreground/5 text-foreground/70',
          )}
          style={{ '--shadow-color': 'var(--foreground-rgb)' } as React.CSSProperties}
        >
          {connectionUnavailable ? (
            <>
              <AlertCircle className="h-3.5 w-3.5" />
              <span>{t('common.unavailable')}</span>
            </>
          ) : (
            <>
              {showConnectionIcon && effectiveConnectionDetails && (
                <ConnectionIcon connection={effectiveConnectionDetails} size={14} />
              )}
              <span className="truncate min-w-0">{currentModelDisplayName}</span>
              {pickerMode !== 'locked-single' && (
                <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
              )}
            </>
          )}
        </button>
      </DrawerTrigger>

      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t('common.model')}</DrawerTitle>
        </DrawerHeader>

        <div className="px-2 pb-4 flex flex-col gap-0.5 max-h-[55vh] overflow-y-auto">
          {/* === Models section === */}
          {pickerMode === 'unavailable' ? (
            <div className="flex flex-col items-center justify-center py-6 px-4 text-center">
              <AlertCircle className="h-8 w-8 text-destructive mb-2" />
              <div className="font-medium text-sm mb-1">
                {t('chat.connectionUnavailable')}
              </div>
              <div className="text-xs text-muted-foreground mb-3">
                {t('chat.connectionUnavailableDescription')}
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  navigate(routes.view.settings('ai'))
                }}
                className="text-xs underline text-foreground/70 hover:text-foreground"
              >
                {t('chat.modelPicker.openAiSettings')}
              </button>
            </div>
          ) : pickerMode === 'locked-single' && connectionDefaultModel ? (
            <LockedSingleRow
              modelId={connectionDefaultModel}
              connection={effectiveConnectionDetails}
              onToggleVision={toggleVision}
            />
          ) : pickerMode === 'switcher' ? (
            connectionsByProvider.map(([providerName, connections]) => (
              <React.Fragment key={providerName}>
                <div className="px-3 pt-3 pb-1 text-xs font-medium text-foreground/60 uppercase tracking-wide select-none">
                  {providerName}
                </div>
                {connections.map(conn => {
                  const isCurrentConnection = effectiveConnection === conn.slug
                  const isAuthenticated = conn.isAuthenticated
                  const isExpanded = expandedConnection === conn.slug
                  return (
                    <React.Fragment key={conn.slug}>
                      <button
                        type="button"
                        disabled={!isAuthenticated}
                        onClick={() =>
                          setExpandedConnection(prev => (prev === conn.slug ? null : conn.slug))
                        }
                        className={cn(
                          'flex items-center gap-2 w-full px-3 py-2 rounded-lg text-left transition-colors',
                          !isAuthenticated && 'opacity-50 cursor-not-allowed',
                          isAuthenticated && 'hover:bg-foreground/5',
                          isCurrentConnection && !isExpanded && 'bg-foreground/5',
                        )}
                      >
                        <ConnectionIcon connection={conn} size={14} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{conn.name}</div>
                          {!isAuthenticated && (
                            <div className="text-xs text-muted-foreground">
                              {t('settings.ai.notAuthenticated')}
                            </div>
                          )}
                        </div>
                        {isCurrentConnection && (
                          <Check className="h-3 w-3 text-foreground/60 shrink-0" />
                        )}
                        {isAuthenticated && (
                          <ChevronRight
                            className={cn(
                              'h-3 w-3 opacity-60 shrink-0 transition-transform',
                              isExpanded && 'rotate-90',
                            )}
                          />
                        )}
                      </button>
                      {isAuthenticated && isExpanded && (
                        <div className="pl-6 flex flex-col gap-0.5">
                          {(conn.models || ANTHROPIC_MODELS).map(model => {
                            const modelId = typeof model === 'string' ? model : model.id
                            const modelName = typeof model === 'string'
                              ? stripPiPrefixForDisplay(getModelShortName(model))
                              : (model.name ?? stripPiPrefixForDisplay(model.id))
                            const isSelectedModel =
                              isCurrentConnection && currentModel === modelId
                            const showVision = isCompatProvider(conn.providerType)
                            const visionOn = showVision && modelSupportsImages(conn, modelId)
                            return (
                              <DrawerClose asChild key={modelId}>
                                <button
                                  type="button"
                                  onClick={() => handlePickSwitcherModel(conn.slug, modelId)}
                                  className={cn(
                                    'flex items-center justify-between w-full px-3 py-2 rounded-lg text-left transition-colors',
                                    isSelectedModel
                                      ? 'bg-foreground/5'
                                      : 'hover:bg-foreground/5',
                                  )}
                                >
                                  <span className="text-sm font-medium truncate">{modelName}</span>
                                  <div className="flex items-center gap-1 ml-3 shrink-0">
                                    {showVision && (
                                      <VisionToggle
                                        visionOn={visionOn}
                                        onToggle={(e) => {
                                          e.preventDefault()
                                          e.stopPropagation()
                                          toggleVision(conn.slug, modelId, !visionOn)
                                        }}
                                      />
                                    )}
                                    {isSelectedModel && (
                                      <Check className="h-3 w-3 text-foreground/60" />
                                    )}
                                  </div>
                                </button>
                              </DrawerClose>
                            )
                          })}
                        </div>
                      )}
                    </React.Fragment>
                  )
                })}
              </React.Fragment>
            ))
          ) : (
            // 'flat' — list models of the active connection
            availableModels.map(model => {
              const modelId = typeof model === 'string' ? model : model.id
              const modelName = typeof model === 'string'
                ? stripPiPrefixForDisplay(getModelShortName(model))
                : (model.name ?? stripPiPrefixForDisplay(model.id))
              const isSelected = currentModel === modelId
              const descriptionKey =
                typeof model !== 'string' && 'descriptionKey' in model
                  ? (model.descriptionKey as string)
                  : undefined
              const description = descriptionKey
                ? t(descriptionKey)
                : (typeof model !== 'string' && 'description' in model
                    ? (model.description as string)
                    : '')
              const showVision =
                !!effectiveConnectionDetails &&
                isCompatProvider(effectiveConnectionDetails.providerType)
              const visionOn =
                showVision && modelSupportsImages(effectiveConnectionDetails!, modelId)
              return (
                <DrawerClose asChild key={modelId}>
                  <button
                    type="button"
                    onClick={() => handlePickFlatModel(modelId)}
                    className={cn(
                      'flex items-center justify-between w-full px-3 py-2 rounded-lg text-left transition-colors',
                      isSelected ? 'bg-foreground/5' : 'hover:bg-foreground/5',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{modelName}</div>
                      {description && (
                        <div className="text-xs text-foreground/50 truncate">
                          {description}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 ml-3 shrink-0">
                      {showVision && effectiveConnectionDetails && (
                        <VisionToggle
                          visionOn={visionOn}
                          onToggle={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            toggleVision(
                              effectiveConnectionDetails.slug,
                              modelId,
                              !visionOn,
                            )
                          }}
                        />
                      )}
                      {isSelected && (
                        <Check className="h-3 w-3 text-foreground/60" />
                      )}
                    </div>
                  </button>
                </DrawerClose>
              )
            })
          )}

          {/* === Thinking section === */}
          {THINKING_LEVELS.length > 0 && pickerMode !== 'unavailable' && (
            <>
              <div className="px-3 pt-4 pb-1 text-xs font-medium text-foreground/60 uppercase tracking-wide select-none">
                {t('chat.modelPicker.thinkingSection')}
              </div>
              {THINKING_LEVELS.map(({ id, nameKey, descriptionKey }) => {
                const isSelected = thinkingLevel === id
                return (
                  <DrawerClose asChild key={id}>
                    <button
                      type="button"
                      disabled={thinkingDisabled}
                      onClick={() => onThinkingLevelChange?.(id)}
                      className={cn(
                        'flex items-center justify-between w-full px-3 py-2 rounded-lg text-left transition-colors',
                        thinkingDisabled && 'opacity-50 cursor-not-allowed',
                        !thinkingDisabled && isSelected && 'bg-foreground/5',
                        !thinkingDisabled && !isSelected && 'hover:bg-foreground/5',
                      )}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{t(nameKey)}</div>
                        <div className="text-xs text-foreground/50">
                          {t(descriptionKey)}
                        </div>
                      </div>
                      {isSelected && (
                        <Check className="h-3 w-3 text-foreground/60 shrink-0 ml-3" />
                      )}
                    </button>
                  </DrawerClose>
                )
              })}
            </>
          )}

          {/* === Context section === */}
          {contextStatus?.inputTokens != null && contextStatus.inputTokens > 0 && (
            <>
              <div className="px-3 pt-4 pb-1 text-xs font-medium text-foreground/60 uppercase tracking-wide select-none">
                {t('chat.modelPicker.contextSection')}
              </div>
              <div className="flex items-center justify-between px-3 py-2 text-xs text-foreground/60 select-none">
                <span>{t('chat.context')}</span>
                <span className="flex items-center gap-1.5">
                  {contextStatus.isCompacting && <Spinner className="h-3 w-3" />}
                  {t('chat.tokensUsed', {
                    displayCount: formatTokenCount(contextStatus.inputTokens),
                  })}
                </span>
              </div>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function LockedSingleRow({
  modelId,
  connection,
  onToggleVision,
}: {
  modelId: string
  connection: LlmConnectionWithStatus | null
  onToggleVision: (connectionSlug: string, modelId: string, enabled: boolean) => Promise<void>
}) {
  const { t } = useTranslation()
  const showVision = !!connection && isCompatProvider(connection.providerType)
  const visionOn = !!(showVision && connection && modelSupportsImages(connection, modelId))
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg opacity-80 select-none">
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{stripPiPrefixForDisplay(modelId)}</div>
        <div className="text-xs text-foreground/50">{t('chat.connectionDefault')}</div>
      </div>
      <div className="flex items-center gap-1 ml-3 shrink-0">
        {showVision && connection && (
          <VisionToggle
            visionOn={visionOn}
            onToggle={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onToggleVision(connection.slug, modelId, !visionOn)
            }}
          />
        )}
        <Check className="h-3 w-3 text-foreground/60" />
      </div>
    </div>
  )
}

function VisionToggle({
  visionOn,
  onToggle,
}: {
  visionOn: boolean
  onToggle: (e: React.MouseEvent | React.KeyboardEvent) => void
}) {
  const { t } = useTranslation()
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={visionOn
        ? t('chat.modelPicker.supportsImagesOn')
        : t('chat.modelPicker.supportsImagesOff')}
      className="inline-flex items-center justify-center p-2 rounded hover:bg-foreground/5 cursor-pointer"
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onToggle(e)
      }}
    >
      <ImageIcon
        className={cn(
          'h-3.5 w-3.5',
          visionOn ? 'text-foreground/70' : 'text-foreground/30',
        )}
      />
    </span>
  )
}
