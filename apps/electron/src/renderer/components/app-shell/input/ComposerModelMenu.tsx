import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Check, ChevronDown, Image as ImageIcon } from 'lucide-react'
import { Spinner, Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import * as storage from '@/lib/local-storage'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuSub,
} from '@/components/ui/dropdown-menu'
import {
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
  StyledDropdownMenuSubTrigger,
  StyledDropdownMenuSubContent,
} from '@/components/ui/styled-dropdown'
import { ConnectionIcon } from '@/components/icons/ConnectionIcon'
import { ANTHROPIC_MODELS, getModelShortName, type ModelDefinition } from '@config/models'
import { isCompatProvider, modelSupportsImages, type LlmConnectionWithStatus } from '@config/llm-connections'
import { THINKING_LEVELS, getThinkingLevelNameKey, type ThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'
import { stripPiPrefixForDisplay } from './model-picker-helpers'
import type { PickerMode } from './picker-mode'
import type { ToggleModelVision } from './useModelVisionToggle'
import type { getContextDisplay, getContextDisplayLabels } from './context-display'
import { COMPOSER_CHIP } from './composer-styles'

const MENU_GROUP_LABEL = 'px-2 pt-2 pb-1 text-label-sm font-medium text-tertiary select-none'
const ITEM_NAME = 'text-label font-medium'
const ITEM_DESCRIPTION = 'text-label-sm text-tertiary'

export interface ComposerModelMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionUnavailable: boolean
  llmConnections: LlmConnectionWithStatus[]
  effectiveConnection: string | undefined
  effectiveConnectionDetails: LlmConnectionWithStatus | null
  currentConnectionDetails: LlmConnectionWithStatus | null
  connectionsByProvider: Array<[string, LlmConnectionWithStatus[]]>
  connectionDefaultModel: string | null
  pickerMode: PickerMode
  currentModel: string
  currentModelDisplayName: string
  availableModels: Array<ModelDefinition | string>
  isEmptySession: boolean
  onModelChange: (model: string, connection?: string) => void
  onConnectionChange?: (connectionSlug: string) => void
  onToggleVision: ToggleModelVision
  thinkingLevel: ThinkingLevel
  thinkingDisabled: boolean
  onThinkingLevelChange?: (level: ThinkingLevel) => void
  /** The context-usage footer; left out when not given (Crafty's short sessions). */
  contextDisplay?: ReturnType<typeof getContextDisplay>
  contextLabels?: ReturnType<typeof getContextDisplayLabels>
  isCompacting?: boolean
  /**
   * Radix's modal menu blocks pointer events outside it. Crafty's click-through window passes
   * false: there, a blocked panel reads as the pointer leaving it, and the next click falls through
   * to the app underneath.
   */
  modal?: boolean
  /** Restyles the trigger chip (Crafty's quieter, smaller one). */
  triggerClassName?: string
}

/** Per-model image-input toggle (pi_compat connections only). */
function VisionToggle({ visionOn, onToggle }: { visionOn: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  const label = visionOn ? t('chat.modelPicker.supportsImagesOn') : t('chat.modelPicker.supportsImagesOff')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          aria-label={label}
          className="pointer-events-auto inline-flex cursor-pointer items-center justify-center rounded-sm p-1 opacity-100 hover:bg-fill-hover"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onToggle()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              onToggle()
            }
          }}
        >
          <ImageIcon className={cn('size-3.5', visionOn ? 'text-foreground' : 'text-tertiary')} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Desktop model picker (mockup "Opus 5.5 ⌄" chip). Moved out of FreeFormInput unchanged in
 * behavior: the four picker modes, vision toggles, thinking level and context footer are the
 * same; only the trigger and menu rows use the toolbar-chip and menu materials.
 */
export function ComposerModelMenu({
  open,
  onOpenChange,
  connectionUnavailable,
  llmConnections,
  effectiveConnection,
  effectiveConnectionDetails,
  currentConnectionDetails,
  connectionsByProvider,
  connectionDefaultModel,
  pickerMode,
  currentModel,
  currentModelDisplayName,
  availableModels,
  isEmptySession,
  onModelChange,
  onConnectionChange,
  onToggleVision,
  thinkingLevel,
  thinkingDisabled,
  onThinkingLevelChange,
  contextDisplay,
  contextLabels,
  isCompacting,
  modal,
  triggerClassName,
}: ComposerModelMenuProps) {
  const { t } = useTranslation()
  const availableThinkingLevels = THINKING_LEVELS

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={modal}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                COMPOSER_CHIP,
                // Truncates first when the toolbar runs out of room (FreeFormInput right group)
                'shrink gap-1 pl-2.5 pr-2',
                triggerClassName,
                // Tooltip and menu triggers share this node, so its data-state is the tooltip's
                open && 'bg-fill-hover text-foreground',
                connectionUnavailable && 'text-destructive hover:text-destructive',
              )}
            >
              {connectionUnavailable ? (
                <>
                  <AlertCircle className="size-3.5 shrink-0 text-destructive" />
                  {t('common.unavailable')}
                </>
              ) : (
                <>
                  {effectiveConnectionDetails && llmConnections.length > 1 && storage.get(storage.KEYS.showConnectionIcons, true) && <ConnectionIcon connection={effectiveConnectionDetails} size={14} showTooltip />}
                  <span className="min-w-0 truncate">{currentModelDisplayName}</span>
                  {pickerMode !== 'locked-single' && <ChevronDown className="size-3.5 shrink-0" />}
                </>
              )}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          {t('common.model')}
        </TooltipContent>
      </Tooltip>
      <StyledDropdownMenuContent side="top" align="end" sideOffset={8} className="min-w-[260px]">
        {/* Connection unavailable message */}
        {pickerMode === 'unavailable' ? (
          <div className="flex flex-col items-center justify-center px-4 py-6 text-center whitespace-normal">
            <AlertCircle className="mb-2 size-8 text-destructive" />
            <div className="mb-1 text-label font-medium">{t('chat.connectionUnavailable')}</div>
            <div className={ITEM_DESCRIPTION}>
              {t('chat.connectionUnavailableDescription')}
            </div>
          </div>
        ) : pickerMode === 'locked-single' && connectionDefaultModel ? (
          (() => {
            // Single-model pi_compat connection on a non-empty session (or
            // when there's only one connection, so no switcher to show).
            // Model row is disabled (locked to this session); vision toggle
            // remains interactive.
            const showVisionToggle =
              !!effectiveConnectionDetails && isCompatProvider(effectiveConnectionDetails.providerType)
            const visionOn = showVisionToggle && modelSupportsImages(effectiveConnectionDetails!, connectionDefaultModel)
            return (
              <StyledDropdownMenuItem
                disabled
                className="flex items-center justify-between py-1.5"
              >
                <div className="text-left">
                  <div className={ITEM_NAME}>{stripPiPrefixForDisplay(connectionDefaultModel)}</div>
                  <div className={ITEM_DESCRIPTION}>{t('chat.connectionDefault')}</div>
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-1">
                  {showVisionToggle && effectiveConnectionDetails && (
                    <VisionToggle
                      visionOn={visionOn}
                      onToggle={() => onToggleVision(effectiveConnectionDetails.slug, connectionDefaultModel, !visionOn)}
                    />
                  )}
                  <Check className="size-4 text-secondary" />
                </div>
              </StyledDropdownMenuItem>
            )
          })()
        ) : pickerMode === 'switcher' ? (
          /* Hierarchical view: Provider → Connection → Models (empty session with multiple connections — lets the user switch BEFORE the first message locks the connection) */
          connectionsByProvider.map(([providerName, connections], index) => (
            <React.Fragment key={providerName}>
              {/* Provider group label */}
              <div className={MENU_GROUP_LABEL}>
                {providerName}
              </div>
              {connections.map((conn) => {
                const isCurrentConnection = effectiveConnection === conn.slug
                const isAuthenticated = conn.isAuthenticated
                return (
                  <DropdownMenuSub key={conn.slug}>
                    <StyledDropdownMenuSubTrigger
                      disabled={!isAuthenticated}
                      className={cn(
                        'flex items-center justify-between py-1.5',
                        isCurrentConnection && 'bg-fill-selected',
                        !isAuthenticated && 'text-disabled',
                      )}
                    >
                      <div className="flex-1 text-left">
                        <div className={cn(ITEM_NAME, 'flex items-center gap-1.5')}>
                          <ConnectionIcon connection={conn} size={14} />
                          {conn.name}
                          {isCurrentConnection && <Check className="size-3.5 text-secondary" />}
                        </div>
                        {!isAuthenticated && (
                          <div className={ITEM_DESCRIPTION}>{t('settings.ai.notAuthenticated')}</div>
                        )}
                      </div>
                    </StyledDropdownMenuSubTrigger>
                    {isAuthenticated && (
                      <StyledDropdownMenuSubContent className="min-w-[220px]">
                        {/* Show models for this connection - use provider-specific models as fallback */}
                        {(conn.models || ANTHROPIC_MODELS).map((model) => {
                          const modelId = typeof model === 'string' ? model : model.id
                          const modelName = typeof model === 'string'
                            ? stripPiPrefixForDisplay(getModelShortName(model))
                            : (model.name ?? stripPiPrefixForDisplay(model.id))
                          const isSelectedModel = isCurrentConnection && currentModel === modelId
                          const showVisionToggle = isCompatProvider(conn.providerType)
                          const visionOn = showVisionToggle && modelSupportsImages(conn, modelId)
                          return (
                            <StyledDropdownMenuItem
                              key={modelId}
                              onSelect={() => {
                                // If selecting a different connection, update both connection and model
                                if (!isCurrentConnection && onConnectionChange) {
                                  onConnectionChange(conn.slug)
                                }
                                // Always pass connection with model for proper persistence
                                onModelChange(modelId, conn.slug)
                              }}
                              className="flex cursor-pointer items-center justify-between"
                            >
                              <div className={ITEM_NAME}>{modelName}</div>
                              <div className="ml-3 flex shrink-0 items-center gap-1">
                                {showVisionToggle && (
                                  <VisionToggle
                                    visionOn={visionOn}
                                    onToggle={() => onToggleVision(conn.slug, modelId, !visionOn)}
                                  />
                                )}
                                {isSelectedModel && (
                                  <Check className="size-4 text-secondary" />
                                )}
                              </div>
                            </StyledDropdownMenuItem>
                          )
                        })}
                      </StyledDropdownMenuSubContent>
                    )}
                  </DropdownMenuSub>
                )
              })}
              {index < connectionsByProvider.length - 1 && (
                <StyledDropdownMenuSeparator className="my-1" />
              )}
            </React.Fragment>
          ))
        ) : (
          /* Flat model list (single connection or session started) */
          <>
            {/* Indicator showing which connection is being used */}
            {!isEmptySession && currentConnectionDetails && llmConnections.length > 1 && (
              <>
                <div className={MENU_GROUP_LABEL}>
                  <span>{t('chat.usingConnection', { name: currentConnectionDetails.name })}</span>
                </div>
                <StyledDropdownMenuSeparator className="my-1" />
              </>
            )}
            {/* Model options based on effective connection's provider type */}
            {availableModels.map((model) => {
              const modelId = typeof model === 'string' ? model : model.id
              const modelName = typeof model === 'string'
                ? stripPiPrefixForDisplay(getModelShortName(model))
                : (model.name ?? stripPiPrefixForDisplay(model.id))
              const isSelected = currentModel === modelId
              const descriptionKey = typeof model !== 'string' && 'descriptionKey' in model ? (model.descriptionKey as string) : undefined
              const description = descriptionKey ? t(descriptionKey) : (typeof model !== 'string' && 'description' in model ? (model.description as string) : '')
              const showVisionToggle =
                !!effectiveConnectionDetails && isCompatProvider(effectiveConnectionDetails.providerType)
              const visionOn = showVisionToggle && modelSupportsImages(effectiveConnectionDetails!, modelId)
              return (
                <StyledDropdownMenuItem
                  key={modelId}
                  onSelect={() => onModelChange(modelId, effectiveConnection)}
                  className="flex cursor-pointer items-center justify-between py-1.5"
                >
                  <div className="text-left">
                    <div className={ITEM_NAME}>{modelName}</div>
                    {description && (
                      <div className={ITEM_DESCRIPTION}>{description}</div>
                    )}
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-1">
                    {showVisionToggle && effectiveConnectionDetails && (
                      <VisionToggle
                        visionOn={visionOn}
                        onToggle={() => onToggleVision(effectiveConnectionDetails.slug, modelId, !visionOn)}
                      />
                    )}
                    {isSelected && (
                      <Check className="size-4 text-secondary" />
                    )}
                  </div>
                </StyledDropdownMenuItem>
              )
            })}
          </>
        )}

        {/* Thinking level selector — only shown when thinking levels are available
            (Claude supports extended thinking, OpenAI backends may not) */}
        {availableThinkingLevels.length > 0 && (
          <>
            <StyledDropdownMenuSeparator className="my-1" />

            <DropdownMenuSub>
              <StyledDropdownMenuSubTrigger disabled={thinkingDisabled} className={cn('flex items-center justify-between py-1.5', thinkingDisabled && 'cursor-not-allowed')}>
                <div className="flex-1 text-left">
                  <div className={cn(ITEM_NAME, thinkingDisabled && 'text-disabled')}>{t(getThinkingLevelNameKey(thinkingLevel))}</div>
                  <div className={cn(ITEM_DESCRIPTION, thinkingDisabled && 'text-disabled')}>{thinkingDisabled ? t('thinking.notSupported') : t('thinking.extendedDesc')}</div>
                </div>
              </StyledDropdownMenuSubTrigger>
              <StyledDropdownMenuSubContent className="min-w-[220px]">
                {availableThinkingLevels.map(({ id, nameKey, descriptionKey }) => {
                  const isSelected = thinkingLevel === id
                  return (
                    <StyledDropdownMenuItem
                      key={id}
                      onSelect={() => onThinkingLevelChange?.(id)}
                      className="flex cursor-pointer items-center justify-between py-1.5"
                    >
                      <div className="text-left">
                        <div className={ITEM_NAME}>{t(nameKey)}</div>
                        <div className={ITEM_DESCRIPTION}>{t(descriptionKey)}</div>
                      </div>
                      {isSelected && (
                        <Check className="ml-3 size-4 shrink-0 text-secondary" />
                      )}
                    </StyledDropdownMenuItem>
                  )
                })}
              </StyledDropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}

        {/* Context usage footer - snapshot-aware occupancy, not cumulative billing. */}
        {contextDisplay?.visible && contextLabels && (
          <>
            <StyledDropdownMenuSeparator className="my-1" />
            <div className="px-2 py-1.5 select-none">
              <div className="flex items-center justify-between gap-3 text-label-sm text-tertiary">
                <span>{contextLabels.window}</span>
                <span className="flex min-w-0 items-center gap-1.5 text-right tabular-nums">
                  {isCompacting && (
                    <Spinner className="h-3 w-3 shrink-0" />
                  )}
                  <span>{contextLabels.usage}</span>
                </span>
              </div>
              {(contextLabels.percent || contextLabels.qualifier) && (
                <div className="mt-0.5 text-caption font-normal text-tertiary">
                  {[contextLabels.percent, contextLabels.qualifier].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          </>
        )}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
