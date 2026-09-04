import type { Message, SessionFile } from '../../../shared/types'
import { collectSessionArtifacts } from './SessionArtifactsSection'

export interface DeliverableManifest {
  schemaVersion?: number
  status?: string
  briefPath?: string
  brief?: { confirmed?: boolean; confirmedAt?: string | null }
  materials?: { status?: string; missing?: string[] }
  skillRouting?: { status?: string; reason?: string }
  skills?: Array<string | { slug?: string; name?: string }>
  deliverables?: Array<{
    name?: string
    path?: string
    type?: string
    status?: string
    version?: number
  }>
  validation?: {
    passed?: boolean
    notes?: string[]
    checkedAt?: string | null
    criteria?: Array<{ name?: string; passed?: boolean; evidence?: string }>
  }
  approval?: { approved?: boolean; approvedAt?: string | null }
}

export interface DeliverableWorkflowState {
  hasConversation: boolean
  hasSkillSelection: boolean
  materialCount: number
  materialsReady: boolean
  hasBrief: boolean
  briefConfirmed: boolean
  deliverableCount: number
  hasValidation: boolean
  acceptanceCriteriaPassed: boolean
  hasApproval: boolean
  isFinal: boolean
  blockers: string[]
}

export function findSessionFile(files: SessionFile[], name: string): SessionFile | undefined {
  for (const file of files) {
    if (file.name.toLowerCase() === name.toLowerCase()) return file
    if (file.type === 'directory') {
      const nested = findSessionFile(file.children ?? [], name)
      if (nested) return nested
    }
  }
  return undefined
}

function normalizedPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLocaleLowerCase()
}

function hasValidTimestamp(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0 && !Number.isNaN(Date.parse(value))
}

function hasValidSkillSelection(skills: DeliverableManifest['skills']): boolean {
  if (!skills?.length) return false
  return skills.every(skill => {
    const slug = typeof skill === 'string' ? skill : skill.slug
    return typeof slug === 'string' && /^[\w-]+$/u.test(slug.trim())
  })
}

function hasResolvedSkillRouting(manifest: DeliverableManifest | null): boolean {
  const status = manifest?.skillRouting?.status?.trim().toLowerCase()
  if (status === 'matched') return hasValidSkillSelection(manifest?.skills)
  if (status === 'builtin_fallback') {
    return (manifest?.skills?.length ?? 0) === 0
      && typeof manifest?.skillRouting?.reason === 'string'
      && manifest.skillRouting.reason.trim().length > 0
  }
  return false
}

function manifestDeliverableExists(
  deliverable: NonNullable<DeliverableManifest['deliverables']>[number],
  artifacts: SessionFile[],
): boolean {
  const manifestPath = deliverable.path ? normalizedPath(deliverable.path) : ''
  const manifestName = deliverable.name?.trim().toLocaleLowerCase() ?? ''
  return artifacts.some(artifact => {
    const artifactPath = normalizedPath(artifact.path)
    const artifactName = artifact.name.trim().toLocaleLowerCase()
    const identityMatches = (manifestPath.length > 0 && artifactPath === manifestPath)
      || (manifestName.length > 0 && artifactName === manifestName)
    return identityMatches && typeof artifact.size === 'number' && artifact.size > 0
  })
}

export function analyzeDeliverableWorkflow(
  messages: Message[],
  files: SessionFile[],
  manifest: DeliverableManifest | null,
): DeliverableWorkflowState {
  const userMessages = messages.filter(message => message.role === 'user' && !message.hidden)
  const materialCount = userMessages.reduce((count, message) => count + (message.attachments?.length ?? 0), 0)
  const artifacts = collectSessionArtifacts(files)
  const manifestDeliverables = manifest?.deliverables ?? []
  const validationCriteria = manifest?.validation?.criteria ?? []
  const hasSkillSelection = hasResolvedSkillRouting(manifest)
  const materialsStatus = manifest?.materials?.status?.trim().toLowerCase()
  const materialsReady = materialsStatus === 'waived'
    || (materialsStatus === 'complete' && (manifest?.materials?.missing?.length ?? 0) === 0)
  const hasBrief = Boolean(findSessionFile(files, 'deliverable-brief.md'))
  const briefConfirmed = hasBrief
    && manifest?.brief?.confirmed === true
    && hasValidTimestamp(manifest.brief.confirmedAt)
  const hasValidation = manifest?.validation?.passed === true
    && hasValidTimestamp(manifest.validation.checkedAt)
  const acceptanceCriteriaPassed = validationCriteria.length > 0
    && validationCriteria.every(criterion =>
      criterion.passed === true
      && typeof criterion.name === 'string'
      && criterion.name.trim().length > 0
      && typeof criterion.evidence === 'string'
      && criterion.evidence.trim().length > 0
    )
  const hasApproval = manifest?.approval?.approved === true
    && hasValidTimestamp(manifest.approval.approvedAt)
  const normalizedStatus = manifest?.status?.trim().toLowerCase()
  const allManifestDeliverablesFinal = manifestDeliverables.length > 0 && manifestDeliverables.every(deliverable =>
    ['final', 'approved', 'complete', 'completed'].includes(deliverable.status?.trim().toLowerCase() ?? '')
      && Number.isInteger(deliverable.version)
      && (deliverable.version ?? 0) > 0
      && manifestDeliverableExists(deliverable, artifacts)
  )
  const manifestIsFinal = ['final', 'approved', 'complete', 'completed'].includes(normalizedStatus ?? '')
  const blockers: string[] = []
  if (!hasSkillSelection) blockers.push('skills')
  if (!materialsReady) blockers.push('materials')
  if (!hasBrief) blockers.push('brief')
  else if (!briefConfirmed) blockers.push('briefConfirmation')
  if (artifacts.length === 0 || !allManifestDeliverablesFinal) blockers.push('deliverables')
  if (!hasValidation || !acceptanceCriteriaPassed) blockers.push('validation')
  if (!hasApproval) blockers.push('approval')

  return {
    hasConversation: userMessages.length > 0,
    hasSkillSelection,
    materialCount,
    materialsReady,
    hasBrief,
    briefConfirmed,
    deliverableCount: artifacts.length,
    hasValidation,
    acceptanceCriteriaPassed,
    hasApproval,
    isFinal: manifest?.schemaVersion === 2 && manifestIsFinal && blockers.length === 0,
    blockers,
  }
}
