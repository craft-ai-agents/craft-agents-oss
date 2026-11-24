import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Cpu,
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
  getModelShortName,
  getModelContextWindow,
} from '@config/models'
import {
  isCompatProvider,
  modelSupportsImages,
  type LlmConnectionWithStatus,
} from '@config/llm-connections'
import {
  THINKING_LEVELS,
  type ThinkingLevel,
} from '@craft-agent/shared/agent/thinking-levels'
import { ConnectionIcon } from '@/components/icons/ConnectionIcon'
import { stripPiPrefixForDisplay } from './model-picker-helpers'
import { useModelPickerState } from './useModelPickerState'
import { getContextDisplay, getContextDisplayLabels, type ContextStatus } from './context-display'
import { useModelVisionToggle } from './useModelVisionToggle'
import { COMPOSER_CHIP } from './composer-styles'

// Bottom-sheet rows (spec §7.16): 44px touch rows, 15px names, tertiary details.
// shrink-0: the list is height-capped (scrolls), so rows must never compress below their content
// Rows and section labels sit on the sheet title's 16px edge: 8px container inset + 8px padding.
const SHEET_ROW = 'flex min-h-row-touch w-full shrink-0 items-center rounded-md px-2 py-2 text-left transition-colors hover:duration-instant'
const SHEET_SECTION = 'px-2 pt-4 pb-1 text-label-sm font-medium text-tertiary select-none'

interface CompactModelSelectorProps {
  currentModel: string
  currentConnection?: string
  onModelChange: (model: string, connection?: string) => void
  onConnectionChange?: (connectionSlug: string) => void
  thinkingLevel?: ThinkingLevel
  onThinkingLevelChange?: (level: ThinkingLevel) => void
  isEmptySession?: boolean
  connectionUnavailable?: boolean
  contextStatus?: ContextStatus
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

  const {
    effectiveConnection,
    effectiveConnectionDetails,
    connectionDefaultModel,
    pickerMode,
    availableModels,
    currentModelDisplayName,
    thinkingDisabled,
    connectionsByProvider,
  } = useModelPickerState({
    llmConnections,
    workspaceDefaultConnection,
    currentConnection,
    currentModel,
    isEmptySession,
    connectionUnavailable,
  })

  const showConnectionIcon =
    !!effectiveConnectionDetails &&
    llmConnections.length > 1 &&
    storage.get(storage.KEYS.showConnectionIcons, true)
  const contextDisplay = getContextDisplay(contextStatus, getModelContextWindow(currentModel))
  const contextLabels = getContextDisplayLabels(contextDisplay, t)

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
            COMPOSER_CHIP,
            'min-w-7 shrink gap-1 pl-2.5 pr-2 @max-[26rem]/panel:px-2',
            connectionUnavailable && 'bg-destructive-tint text-destructive hover:bg-destructive-tint hover:text-destructive',
          )}
        >
          {connectionUnavailable ? (
            <>
              <AlertCircle className="size-3.5 shrink-0 text-destructive" />
              <span className="min-w-0 truncate">{t('common.unavailable')}</span>
            </>
          ) : (
            <>
              {showConnectionIcon && effectiveConnectionDetails && (
                <ConnectionIcon connection={effectiveConnectionDetails} size={14} />
              )}
              {/* A model glyph is clearer than an unreadable one-letter ellipsis. The full
                  model name remains the accessible name and the sheet's selected row. */}
              <Cpu className="size-4 shrink-0 @min-[26rem]/panel:hidden" aria-hidden />
              <span className="truncate min-w-0 @max-[26rem]/panel:hidden">{currentModelDisplayName}</span>
              {pickerMode !== 'locked-single' && (
                <ChevronDown className="size-3.5 shrink-0 @max-[26rem]/panel:hidden" />
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
              <AlertCircle className="size-8 text-destructive mb-2" />
              <div className="text-copy font-medium mb-1">
                {t('chat.connectionUnavailable')}
              </div>
              <div className="text-label text-tertiary mb-3">
                {t('chat.connectionUnavailableDescription')}
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  navigate(routes.view.settings('ai'))
                }}
                className="min-h-control text-label text-accent underline underline-offset-2"
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
                <div className={SHEET_SECTION}>
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
                          SHEET_ROW,
                          'gap-2',
                          !isAuthenticated && 'cursor-not-allowed text-disabled',
                          isAuthenticated && 'hover:bg-fill-hover active:bg-fill-pressed',
                          isCurrentConnection && !isExpanded && 'bg-fill-selected',
                        )}
                      >
                        <ConnectionIcon connection={conn} size={14} />
                        <div className="flex-1 min-w-0">
                          <div className="text-copy font-medium truncate">{conn.name}</div>
                          {!isAuthenticated && (
                            <div className="text-label text-tertiary">
                              {t('settings.ai.notAuthenticated')}
                            </div>
                          )}
                        </div>
                        {isCurrentConnection && (
                          <Check className="size-4 text-secondary shrink-0" />
                        )}
                        {isAuthenticated && (
                          <ChevronRight
                            className={cn(
                              'size-4 text-tertiary shrink-0 transition-transform duration-[calc(var(--spring-snap-dur)*var(--motion-scale))] ease-[var(--spring-snap)]',
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
                                    SHEET_ROW,
                                    'justify-between',
                                    isSelectedModel
                                      ? 'bg-fill-selected'
                                      : 'hover:bg-fill-hover active:bg-fill-pressed',
                                  )}
                                >
                                  <span className="text-copy font-medium truncate">{modelName}</span>
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
                                      <Check className="size-4 text-secondary" />
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
                      SHEET_ROW,
                      'justify-between',
                      isSelected ? 'bg-fill-selected' : 'hover:bg-fill-hover active:bg-fill-pressed',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="text-copy font-medium truncate">{modelName}</div>
                      {description && (
                        <div className="text-label text-tertiary truncate">
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
                        <Check className="size-4 text-secondary" />
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
              <div className={SHEET_SECTION}>
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
                        SHEET_ROW,
                        'justify-between',
                        thinkingDisabled && 'cursor-not-allowed text-disabled',
                        !thinkingDisabled && isSelected && 'bg-fill-selected',
                        !thinkingDisabled && !isSelected && 'hover:bg-fill-hover active:bg-fill-pressed',
                      )}
                    >
                      <div className="min-w-0">
                        <div className="text-copy font-medium">{t(nameKey)}</div>
                        <div className={cn('text-label', thinkingDisabled ? 'text-disabled' : 'text-tertiary')}>
                          {t(descriptionKey)}
                        </div>
                      </div>
                      {isSelected && (
                        <Check className="size-4 text-secondary shrink-0 ml-3" />
                      )}
                    </button>
                  </DrawerClose>
                )
              })}
            </>
          )}

          {/* === Context section === */}
          {contextDisplay.visible && (
            <>
              <div className={SHEET_SECTION}>
                {t('chat.modelPicker.contextSection')}
              </div>
              <div className="px-2 py-2 text-label text-tertiary tabular-nums select-none">
                <div className="flex items-center justify-between gap-3">
                  <span>{contextLabels.window}</span>
                  <span className="flex min-w-0 items-center gap-1.5 text-right">
                    {contextStatus?.isCompacting && <Spinner className="h-3 w-3 shrink-0" />}
                    <span>{contextLabels.usage}</span>
                  </span>
                </div>
                {(contextLabels.percent || contextLabels.qualifier) && (
                  <div className="mt-0.5 text-label-sm text-tertiary">
                    {[contextLabels.percent, contextLabels.qualifier].filter(Boolean).join(' · ')}
                  </div>
                )}
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
    <div className={cn(SHEET_ROW, 'justify-between select-none')}>
      <div className="min-w-0">
        <div className="text-copy font-medium truncate">{stripPiPrefixForDisplay(modelId)}</div>
        <div className="text-label text-tertiary">{t('chat.connectionDefault')}</div>
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
        <Check className="size-4 text-secondary" />
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
      className="inline-flex size-9 items-center justify-center rounded-md cursor-pointer hover:bg-fill-hover"
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onToggle(e)
      }}
    >
      <ImageIcon
        className={cn(
          'size-4',
          visionOn ? 'text-foreground' : 'text-tertiary',
        )}
      />
    </span>
  )
}
