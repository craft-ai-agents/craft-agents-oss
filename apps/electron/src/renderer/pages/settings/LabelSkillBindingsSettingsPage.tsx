import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Copy, Info, Loader2, Plus, RefreshCcw, Trash2, WandSparkles } from 'lucide-react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  SettingsCard,
  SettingsCardContent,
  SettingsCardFooter,
  SettingsMenuSelect,
  SettingsSection,
  SettingsTextarea,
  SettingsToggle,
} from '@/components/settings'
import { useAppShellContext, useActiveWorkspace } from '@/context/AppShellContext'
import { useLabels } from '@/hooks/useLabels'
import { useLabelSkillBindings } from '@/hooks/useLabelSkillBindings'
import { routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { LabelConfig } from '@craft-agent/shared/labels'
import type {
  LabelSkillBinding,
  LabelSkillBindingApplyScope,
  LabelSkillBindingDiagnostic,
  LabelSkillBindingsConfig,
  RequiredSourceSnapshotEntry,
} from '@craft-agent/shared/label-skill-bindings'
import type { BindableSkillSummary, LoadedSource } from '../../../shared/types'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'skill-bindings',
}

const MAX_ACTIVE_BINDINGS = 8
const MAX_RUNTIME_PAYLOAD_BYTES = 12_000
const WARN_COMPACT_INSTRUCTION_CHARS = 1_200
const MAX_COMPACT_INSTRUCTION_CHARS = 12_000

interface BindingUiDiagnostic {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
}

const EMPTY_CONFIG: LabelSkillBindingsConfig = { version: 1, bindings: [] }

function createBindingId(existing: LabelSkillBinding[]): string {
  const existingIds = new Set(existing.map(binding => binding.id))
  for (let i = 0; i < 20; i++) {
    const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14)
    const id = `binding-${random}`
    if (!existingIds.has(id)) return id
  }
  return `binding-${Date.now().toString(36)}`
}

function scopeFromSkill(skill: BindableSkillSummary): LabelSkillBindingApplyScope {
  return {
    mode: 'source-fingerprint',
    source: skill.source,
    metadataHash: skill.metadataHash,
    scopeFingerprint: skill.scopeFingerprint,
  }
}

function requiredSourceSnapshotsForSkill(skill?: BindableSkillSummary): RequiredSourceSnapshotEntry[] {
  return (skill?.requiredSources ?? []).map(slug => ({ slug }))
}

function getRequiredSourceSlugs(binding: LabelSkillBinding, skill?: BindableSkillSummary): string[] {
  const slugs = new Set<string>()
  for (const slug of skill?.requiredSources ?? []) slugs.add(slug)
  for (const slug of binding.generatedFrom?.requiredSources ?? []) slugs.add(slug)
  for (const source of binding.requiredSourcesSnapshot ?? []) {
    if (source.slug) slugs.add(source.slug)
  }
  return Array.from(slugs).sort()
}

function runtimePayloadBytes(bindings: LabelSkillBinding[]): number {
  const payload = bindings
    .filter(binding => binding.enabled && binding.compactInstruction.trim().length > 0)
    .map(binding => `${binding.id}\n${binding.labelId}\n${binding.skillSlug}\n${binding.compactInstruction.trim()}`)
    .join('\n---\n')
  return new TextEncoder().encode(payload).byteLength
}

function stableConfigString(config: LabelSkillBindingsConfig): string {
  return JSON.stringify(config)
}

function formatDate(value: string | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString()
}

function getSourceSlug(source: LoadedSource): string {
  return source.config.slug
}

function buildLabelOptions(labels: LabelConfig[], t: (key: string, options?: Record<string, unknown>) => string) {
  return labels.map(label => ({
    value: label.id,
    label: label.name,
    description: label.valueType
      ? t('settings.skillBindings.labelOptionValued', { name: label.id, id: label.id, type: label.valueType })
      : label.id,
    searchText: [label.name, label.id, label.valueType].filter(Boolean).join(' '),
  }))
}

function buildSkillOptions(skills: BindableSkillSummary[]) {
  return skills.map(skill => ({
    value: skill.slug,
    label: skill.metadata.name,
    description: [skill.slug, skill.source, skill.scopeLabel, skill.metadata.description].filter(Boolean).join(' · '),
    searchText: [
      skill.metadata.name,
      skill.slug,
      skill.source,
      skill.scopeLabel,
      skill.metadata.description,
    ].filter(Boolean).join(' '),
  }))
}

function collectLocalDiagnostics(args: {
  binding: LabelSkillBinding
  labelIds: Set<string>
  labelsById: Map<string, LabelConfig>
  skill?: BindableSkillSummary
  skillExists: boolean
  sourcesBySlug: Map<string, LoadedSource>
  duplicateKeys: Set<string>
  t: (key: string, options?: Record<string, unknown>) => string
}): BindingUiDiagnostic[] {
  const { binding, labelIds, labelsById, skill, skillExists, sourcesBySlug, duplicateKeys, t } = args
  const diagnostics: BindingUiDiagnostic[] = []

  if (!labelIds.has(binding.labelId)) {
    diagnostics.push({ severity: 'warning', code: 'missing-label', message: t('settings.skillBindings.warningMissingLabel', { label: binding.labelId }) })
  }

  if (!skillExists) {
    diagnostics.push({ severity: 'warning', code: 'missing-skill', message: t('settings.skillBindings.warningMissingSkill', { skill: binding.skillSlug }) })
  }

  const label = labelsById.get(binding.labelId)
  if (label?.valueType) {
    diagnostics.push({ severity: 'info', code: 'valued-label', message: t('settings.skillBindings.infoValuedLabel', { label: label.id, type: label.valueType }) })
  }

  if (binding.enabled && binding.compactInstruction.trim().length === 0) {
    diagnostics.push({ severity: 'warning', code: 'empty-instruction', message: t('settings.skillBindings.warningEmptyInstruction') })
  }

  if (binding.compactInstruction.length > MAX_COMPACT_INSTRUCTION_CHARS) {
    diagnostics.push({ severity: 'error', code: 'instruction-too-long', message: t('settings.skillBindings.errorInstructionTooLong', { count: MAX_COMPACT_INSTRUCTION_CHARS }) })
  } else if (binding.compactInstruction.length > WARN_COMPACT_INSTRUCTION_CHARS) {
    diagnostics.push({ severity: 'warning', code: 'instruction-long', message: t('settings.skillBindings.warningInstructionLong', { count: WARN_COMPACT_INSTRUCTION_CHARS }) })
  }

  if (binding.enabled && duplicateKeys.has(binding.id)) {
    diagnostics.push({ severity: 'error', code: 'duplicate-enabled', message: t('settings.skillBindings.errorDuplicateEnabled') })
  }

  if (skill && binding.applyScope.mode === 'source-fingerprint') {
    if (binding.applyScope.source !== skill.source || binding.applyScope.scopeFingerprint !== skill.scopeFingerprint) {
      diagnostics.push({ severity: 'warning', code: 'scope-mismatch', message: t('settings.skillBindings.warningScopeMismatch') })
    }
    if (binding.applyScope.metadataHash !== skill.metadataHash) {
      diagnostics.push({ severity: 'warning', code: 'metadata-drift', message: t('settings.skillBindings.warningMetadataDrift') })
    }
  }

  for (const slug of getRequiredSourceSlugs(binding, skill)) {
    const source = sourcesBySlug.get(slug)
    if (!source) {
      diagnostics.push({ severity: 'warning', code: `missing-source:${slug}`, message: t('settings.skillBindings.warningMissingSource', { source: slug }) })
    } else if (!source.config.enabled) {
      diagnostics.push({ severity: 'warning', code: `disabled-source:${slug}`, message: t('settings.skillBindings.warningDisabledSource', { source: slug }) })
    }
  }

  return diagnostics
}

function buildDuplicateEnabledIds(bindings: LabelSkillBinding[]): Set<string> {
  const seen = new Map<string, string>()
  const duplicates = new Set<string>()
  for (const binding of bindings) {
    if (!binding.enabled || !binding.labelId || !binding.skillSlug) continue
    const key = `${binding.labelId}\u0000${binding.skillSlug}\u0000${JSON.stringify(binding.applyScope)}`
    const previous = seen.get(key)
    if (previous) {
      duplicates.add(previous)
      duplicates.add(binding.id)
    } else {
      seen.set(key, binding.id)
    }
  }
  return duplicates
}

function DiagnosticList({ diagnostics }: { diagnostics: BindingUiDiagnostic[] }) {
  if (diagnostics.length === 0) return null
  return (
    <div className="space-y-1.5">
      {diagnostics.map((diagnostic, index) => (
        <div
          key={`${diagnostic.code}-${index}`}
          className={cn(
            'flex gap-2 rounded-md px-3 py-2 text-xs leading-relaxed',
            diagnostic.severity === 'error' && 'bg-destructive/10 text-destructive',
            diagnostic.severity === 'warning' && 'bg-warning/10 text-warning',
            diagnostic.severity === 'info' && 'bg-foreground/5 text-muted-foreground',
          )}
        >
          {diagnostic.severity === 'info' ? <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span>{diagnostic.message}</span>
        </div>
      ))}
    </div>
  )
}

function FieldHeader({ label, description, className }: { label: string; description?: string; className?: string }) {
  return (
    <div className={cn('min-h-[3.25rem] space-y-1', className)}>
      <div className="text-sm font-medium text-foreground">{label}</div>
      {description ? <p className="text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
    </div>
  )
}

function SelectField({
  label,
  description,
  headerClassName,
  controlClassName,
  children,
}: {
  label: string
  description?: string
  headerClassName?: string
  controlClassName?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2 md:contents">
      <FieldHeader label={label} description={description} className={headerClassName} />
      <div className={cn('min-w-0', controlClassName)}>{children}</div>
    </div>
  )
}

export default function LabelSkillBindingsSettingsPage() {
  const { t } = useTranslation()
  const { activeWorkspaceId, activeWorkspaceSlug, activeSessionWorkingDirectory } = useAppShellContext()
  const activeWorkspace = useActiveWorkspace()
  const { flatLabels, isLoading: labelsLoading } = useLabels(activeWorkspaceId)
  const {
    config,
    validation,
    skills,
    sources,
    isLoading,
    isSaving,
    isGenerating,
    error,
    generationWarnings,
    refresh,
    save,
    generate,
  } = useLabelSkillBindings(activeWorkspaceId, activeSessionWorkingDirectory)

  const [draftConfig, setDraftConfig] = useState<LabelSkillBindingsConfig>(EMPTY_CONFIG)
  const [savedConfig, setSavedConfig] = useState<LabelSkillBindingsConfig>(EMPTY_CONFIG)
  const [deleteBindingId, setDeleteBindingId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    setDraftConfig(config)
    setSavedConfig(config)
    setStatusMessage(null)
    setLocalError(null)
  }, [config])

  const labelOptions = useMemo(() => buildLabelOptions(flatLabels, t), [flatLabels, t])
  const skillOptions = useMemo(() => buildSkillOptions(skills), [skills])
  const labelsById = useMemo(() => new Map(flatLabels.map(label => [label.id, label] as const)), [flatLabels])
  const labelIds = useMemo(() => new Set(flatLabels.map(label => label.id)), [flatLabels])
  const skillsBySlug = useMemo(() => new Map(skills.map(skill => [skill.slug, skill] as const)), [skills])
  const sourcesBySlug = useMemo(() => new Map(sources.map(source => [getSourceSlug(source), source] as const)), [sources])
  const duplicateEnabledIds = useMemo(() => buildDuplicateEnabledIds(draftConfig.bindings), [draftConfig])

  const validationDiagnosticsByBinding = useMemo(() => {
    const map = new Map<string, BindingUiDiagnostic[]>()
    for (const diagnostic of validation?.diagnostics ?? []) {
      if (!diagnostic.bindingId) continue
      const list = map.get(diagnostic.bindingId) ?? []
      list.push({
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
      })
      map.set(diagnostic.bindingId, list)
    }
    return map
  }, [validation])

  const globalDiagnostics = useMemo(() => {
    return (validation?.diagnostics ?? [])
      .filter((diagnostic: LabelSkillBindingDiagnostic) => !diagnostic.bindingId)
      .map((diagnostic) => ({ severity: diagnostic.severity, code: diagnostic.code, message: diagnostic.message }))
  }, [validation])

  const localDiagnosticsByBinding = useMemo(() => {
    const map = new Map<string, BindingUiDiagnostic[]>()
    for (const binding of draftConfig.bindings) {
      const skill = skillsBySlug.get(binding.skillSlug)
      map.set(binding.id, collectLocalDiagnostics({
        binding,
        labelIds,
        labelsById,
        skill,
        skillExists: skillsBySlug.has(binding.skillSlug),
        sourcesBySlug,
        duplicateKeys: duplicateEnabledIds,
        t,
      }))
    }
    return map
  }, [draftConfig.bindings, duplicateEnabledIds, labelIds, labelsById, skillsBySlug, sourcesBySlug, t])

  const dirty = useMemo(
    () => stableConfigString(draftConfig) !== stableConfigString(savedConfig),
    [draftConfig, savedConfig],
  )

  const activeBindingCount = useMemo(
    () => draftConfig.bindings.filter(binding => binding.enabled && binding.compactInstruction.trim().length > 0).length,
    [draftConfig.bindings],
  )
  const payloadBytes = useMemo(() => runtimePayloadBytes(draftConfig.bindings), [draftConfig.bindings])
  const hasLocalErrors = useMemo(() => {
    for (const diagnostics of localDiagnosticsByBinding.values()) {
      if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) return true
    }
    return false
  }, [localDiagnosticsByBinding])

  const updateBinding = useCallback((bindingId: string, updater: (binding: LabelSkillBinding) => LabelSkillBinding) => {
    setDraftConfig(prev => ({
      ...prev,
      bindings: prev.bindings.map(binding => binding.id === bindingId ? updater(binding) : binding),
    }))
    setStatusMessage(null)
    setLocalError(null)
  }, [])

  const handleAddBinding = useCallback(() => {
    const firstLabel = flatLabels[0]
    const firstSkill = skills[0]
    if (!firstLabel || !firstSkill) return
    const now = new Date().toISOString()
    setDraftConfig(prev => ({
      version: 1,
      bindings: [
        ...prev.bindings,
        {
          id: createBindingId(prev.bindings),
          enabled: true,
          labelId: firstLabel.id,
          skillSlug: firstSkill.slug,
          compactInstruction: '',
          applyScope: scopeFromSkill(firstSkill),
          requiredSourcesSnapshot: requiredSourceSnapshotsForSkill(firstSkill),
          createdAt: now,
          updatedAt: now,
        },
      ],
    }))
    setStatusMessage(null)
    setLocalError(null)
  }, [flatLabels, skills])

  const handleDuplicateBinding = useCallback((binding: LabelSkillBinding) => {
    const now = new Date().toISOString()
    setDraftConfig(prev => ({
      ...prev,
      bindings: [
        ...prev.bindings,
        {
          ...binding,
          id: createBindingId(prev.bindings),
          enabled: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
    }))
    setStatusMessage(t('settings.skillBindings.duplicatedDisabled'))
    setLocalError(null)
  }, [t])

  const handleDeleteBinding = useCallback(() => {
    if (!deleteBindingId) return
    setDraftConfig(prev => ({
      ...prev,
      bindings: prev.bindings.filter(binding => binding.id !== deleteBindingId),
    }))
    setDeleteBindingId(null)
    setStatusMessage(null)
    setLocalError(null)
  }, [deleteBindingId])

  const handleSave = useCallback(async () => {
    try {
      const result = await save(draftConfig)
      setDraftConfig(result.config)
      setSavedConfig(result.config)
      setStatusMessage(t('settings.skillBindings.saved'))
      setLocalError(null)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t('settings.skillBindings.saveFailed'))
    }
  }, [draftConfig, save, t])

  const handleRevert = useCallback(() => {
    setDraftConfig(savedConfig)
    setStatusMessage(null)
    setLocalError(null)
  }, [savedConfig])

  const handleGenerate = useCallback(async (binding: LabelSkillBinding) => {
    try {
      const result = await generate({ skillSlug: binding.skillSlug, workingDirectory: activeSessionWorkingDirectory })
      const skill = skillsBySlug.get(binding.skillSlug)
      updateBinding(binding.id, current => ({
        ...current,
        compactInstruction: result.compactInstruction,
        generatedFrom: result.generatedFrom,
        applyScope: skill ? scopeFromSkill(skill) : current.applyScope,
        requiredSourcesSnapshot: result.generatedFrom.requiredSources?.map(slug => ({ slug })) ?? current.requiredSourcesSnapshot,
        updatedAt: new Date().toISOString(),
      }))
      setStatusMessage(t('settings.skillBindings.generated'))
      setLocalError(null)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t('settings.skillBindings.generateFailed'))
    }
  }, [activeSessionWorkingDirectory, generate, skillsBySlug, t, updateBinding])

  const deleteBinding = draftConfig.bindings.find(binding => binding.id === deleteBindingId)
  const loading = isLoading || labelsLoading
  const canAdd = flatLabels.length > 0 && skills.length > 0

  return (
    <div className="h-full flex flex-col">
      <PanelHeader
        title={t('settings.skillBindings.title')}
        actions={<HeaderMenu route={routes.view.settings('skill-bindings')} helpFeature="label-skill-bindings" />}
      />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-8">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <SettingsSection title={t('settings.skillBindings.aboutTitle')}>
                    <SettingsCard>
                      <SettingsCardContent className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                        <p>{t('settings.skillBindings.aboutText1')}</p>
                        <p>{t('settings.skillBindings.aboutText2')}</p>
                        <div className="rounded-lg bg-foreground/5 px-3 py-2 text-xs leading-relaxed">
                          <strong className="text-foreground/80">{t('settings.skillBindings.generatePrivacyTitle')}</strong>{' '}
                          {t('settings.skillBindings.generatePrivacyBody')}
                        </div>
                        <div className="rounded-lg bg-foreground/5 px-3 py-2 text-xs leading-relaxed">
                          <strong className="text-foreground/80">{t('settings.skillBindings.runtimeCapsTitle')}</strong>{' '}
                          {t('settings.skillBindings.runtimeCapsBody', { count: MAX_ACTIVE_BINDINGS, bytes: MAX_RUNTIME_PAYLOAD_BYTES })}
                        </div>
                      </SettingsCardContent>
                    </SettingsCard>
                  </SettingsSection>

                  <SettingsSection
                    title={t('settings.skillBindings.bindingsTitle')}
                    description={t('settings.skillBindings.bindingsDescription')}
                    action={
                      <Button size="sm" onClick={handleAddBinding} disabled={!canAdd}>
                        <Plus className="h-4 w-4" />
                        {t('settings.skillBindings.addBinding')}
                      </Button>
                    }
                  >
                    <SettingsCard divided={false} className="overflow-visible">
                      <SettingsCardContent className="space-y-4">
                        {!canAdd && (
                          <div className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
                            {flatLabels.length === 0
                              ? t('settings.skillBindings.noLabelsWarning')
                              : t('settings.skillBindings.noSkillsWarning')}
                          </div>
                        )}

                        {(error || localError) && (
                          <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                            {localError ?? error}
                          </div>
                        )}

                        {statusMessage && (
                          <div className="rounded-lg bg-foreground/5 px-3 py-2 text-sm text-muted-foreground">
                            {statusMessage}
                          </div>
                        )}

                        {generationWarnings.length > 0 && (
                          <div className="space-y-1 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
                            {generationWarnings.map((warning, index) => <p key={index}>{warning}</p>)}
                          </div>
                        )}

                        <DiagnosticList diagnostics={globalDiagnostics} />

                        {(activeBindingCount > MAX_ACTIVE_BINDINGS || payloadBytes > MAX_RUNTIME_PAYLOAD_BYTES) && (
                          <DiagnosticList diagnostics={[{
                            severity: 'warning',
                            code: 'runtime-cap',
                            message: activeBindingCount > MAX_ACTIVE_BINDINGS
                              ? t('settings.skillBindings.warningRuntimeCountCap', { count: MAX_ACTIVE_BINDINGS })
                              : t('settings.skillBindings.warningRuntimePayloadCap', { bytes: MAX_RUNTIME_PAYLOAD_BYTES }),
                          }]} />
                        )}

                        {draftConfig.bindings.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-border/70 p-8 text-center">
                            <p className="text-sm text-foreground/80">{t('settings.skillBindings.emptyTitle')}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{t('settings.skillBindings.emptyDescription')}</p>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {draftConfig.bindings.map((binding) => {
                              const skill = skillsBySlug.get(binding.skillSlug)
                              const label = labelsById.get(binding.labelId)
                              const diagnostics = [
                                ...(localDiagnosticsByBinding.get(binding.id) ?? []),
                                ...(dirty ? [] : validationDiagnosticsByBinding.get(binding.id) ?? []),
                              ]
                              const requiredSources = getRequiredSourceSlugs(binding, skill)
                              const generatedAt = formatDate(binding.generatedFrom?.generatedAt)
                              return (
                                <div key={binding.id} className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-4">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 space-y-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="text-sm font-medium text-foreground">
                                          {label?.name ?? binding.labelId} → {skill?.metadata.name ?? binding.skillSlug}
                                        </h3>
                                        <Badge variant={binding.enabled ? 'secondary' : 'outline'}>
                                          {binding.enabled ? t('settings.skillBindings.enabled') : t('settings.skillBindings.disabled')}
                                        </Badge>
                                      </div>
                                      <p className="text-xs text-muted-foreground break-words">
                                        {binding.applyScope.mode === 'source-fingerprint'
                                          ? t('settings.skillBindings.scopeSourceFingerprint', {
                                            source: binding.applyScope.source,
                                            scope: skill?.scopeLabel ?? binding.generatedFrom?.workingDirectoryHint ?? t('common.unknown'),
                                          })
                                          : t('settings.skillBindings.scopeWorkspace', { workspace: binding.applyScope.workspaceSlug || activeWorkspaceSlug || activeWorkspace?.slug || activeWorkspace?.name || t('common.unknown') })}
                                      </p>
                                      {generatedAt && (
                                        <p className="text-xs text-muted-foreground">
                                          {t('settings.skillBindings.generatedFrom', { skill: binding.generatedFrom?.skillName ?? binding.skillSlug, date: generatedAt })}
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                      <Button variant="ghost" size="icon" title={t('settings.skillBindings.duplicate')} onClick={() => handleDuplicateBinding(binding)}>
                                        <Copy className="h-4 w-4" />
                                      </Button>
                                      <Button variant="ghost" size="icon" title={t('common.delete')} onClick={() => setDeleteBindingId(binding.id)}>
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>

                                  <SettingsToggle
                                    label={t('settings.skillBindings.enableBinding')}
                                    description={t('settings.skillBindings.enableBindingDescription')}
                                    checked={binding.enabled}
                                    onCheckedChange={(enabled) => updateBinding(binding.id, current => ({ ...current, enabled, updatedAt: new Date().toISOString() }))}
                                    inCard={false}
                                  />

                                  <div className="grid gap-x-4 gap-y-2 md:grid-cols-2">
                                    <SelectField
                                      label={t('settings.skillBindings.labelField')}
                                      description={t('settings.skillBindings.labelFieldDescription')}
                                      headerClassName="md:col-start-1 md:row-start-1"
                                      controlClassName="md:col-start-1 md:row-start-2"
                                    >
                                      <SettingsMenuSelect
                                        value={binding.labelId}
                                        options={labelOptions}
                                        onValueChange={(labelId) => updateBinding(binding.id, current => ({ ...current, labelId, updatedAt: new Date().toISOString() }))}
                                        placeholder={t('settings.skillBindings.selectLabel')}
                                        searchable
                                        searchPlaceholder={t('settings.skillBindings.searchLabels')}
                                        className="w-full justify-between"
                                        menuWidth={360}
                                      />
                                    </SelectField>
                                    <SelectField
                                      label={t('settings.skillBindings.skillField')}
                                      description={t('settings.skillBindings.skillFieldDescription')}
                                      headerClassName="md:col-start-2 md:row-start-1"
                                      controlClassName="md:col-start-2 md:row-start-2"
                                    >
                                      <SettingsMenuSelect
                                        value={binding.skillSlug}
                                        options={skillOptions}
                                        onValueChange={(skillSlug) => updateBinding(binding.id, current => {
                                          const nextSkill = skillsBySlug.get(skillSlug)
                                          return {
                                            ...current,
                                            skillSlug,
                                            applyScope: nextSkill ? scopeFromSkill(nextSkill) : current.applyScope,
                                            requiredSourcesSnapshot: nextSkill ? requiredSourceSnapshotsForSkill(nextSkill) : current.requiredSourcesSnapshot,
                                            generatedFrom: undefined,
                                            updatedAt: new Date().toISOString(),
                                          }
                                        })}
                                        placeholder={t('settings.skillBindings.selectSkill')}
                                        searchable
                                        searchPlaceholder={t('settings.skillBindings.searchSkills')}
                                        className="w-full justify-between"
                                        menuWidth={420}
                                      />
                                    </SelectField>
                                  </div>

                                  <div className="space-y-2">
                                    <SettingsTextarea
                                      label={t('settings.skillBindings.instructionField')}
                                      description={t('settings.skillBindings.instructionFieldDescription')}
                                      value={binding.compactInstruction}
                                      onChange={(compactInstruction) => updateBinding(binding.id, current => ({ ...current, compactInstruction, updatedAt: new Date().toISOString() }))}
                                      placeholder={t('settings.skillBindings.instructionPlaceholder')}
                                      maxLength={MAX_COMPACT_INSTRUCTION_CHARS}
                                      rows={5}
                                    />
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => handleGenerate(binding)}
                                        disabled={isGenerating || !binding.skillSlug || !skillsBySlug.has(binding.skillSlug)}
                                      >
                                        {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
                                        {t('settings.skillBindings.generate')}
                                      </Button>
                                      <span className="text-xs text-muted-foreground">
                                        {t('settings.skillBindings.generateDisclosure')}
                                      </span>
                                    </div>
                                  </div>

                                  {requiredSources.length > 0 && (
                                    <div className="space-y-2">
                                      <p className="text-xs font-medium text-foreground/70">{t('settings.skillBindings.requiredSources')}</p>
                                      <div className="flex flex-wrap gap-1.5">
                                        {requiredSources.map(slug => {
                                          const source = sourcesBySlug.get(slug)
                                          return (
                                            <Badge key={slug} variant={source?.config.enabled ? 'secondary' : 'outline'}>
                                              {source?.config.name ?? slug}
                                              {!source ? ` · ${t('settings.skillBindings.missing')}` : !source.config.enabled ? ` · ${t('settings.skillBindings.disabled')}` : ''}
                                            </Badge>
                                          )
                                        })}
                                      </div>
                                    </div>
                                  )}

                                  <DiagnosticList diagnostics={diagnostics} />
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </SettingsCardContent>
                      <SettingsCardFooter>
                        <div className="mr-auto text-xs text-muted-foreground">
                          {dirty
                            ? t('settings.skillBindings.unsavedChanges')
                            : t('settings.skillBindings.noUnsavedChanges')}
                        </div>
                        <Button variant="outline" size="sm" onClick={refresh} disabled={isSaving || isGenerating}>
                          <RefreshCcw className="h-4 w-4" />
                          {t('settings.skillBindings.reload')}
                        </Button>
                        <Button variant="outline" size="sm" onClick={handleRevert} disabled={!dirty || isSaving}>
                          {t('common.revert')}
                        </Button>
                        <Button size="sm" onClick={handleSave} disabled={!dirty || isSaving || hasLocalErrors}>
                          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          {t('common.save')}
                        </Button>
                      </SettingsCardFooter>
                    </SettingsCard>
                  </SettingsSection>
                </>
              )}
            </div>
          </div>
        </ScrollArea>
      </div>

      <Dialog open={!!deleteBindingId} onOpenChange={(open) => !open && setDeleteBindingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.skillBindings.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('settings.skillBindings.deleteDescription', {
                binding: deleteBinding ? `${deleteBinding.labelId} → ${deleteBinding.skillSlug}` : '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteBindingId(null)}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={handleDeleteBinding}>{t('common.delete')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
