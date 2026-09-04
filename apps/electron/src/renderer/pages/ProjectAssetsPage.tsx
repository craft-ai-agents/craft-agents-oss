import * as React from 'react'
import { useAtomValue } from 'jotai'
import { FileImage, FileSpreadsheet, FileText, Presentation, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { useLabels } from '@/hooks/useLabels'
import { useProjects } from '@/hooks/useProjects'
import { useStatuses } from '@/hooks/useStatuses'
import { Input } from '@/components/ui/input'
import { Info_Page, Info_Section } from '@/components/info'
import { collectSessionArtifacts } from '@/components/right-sidebar/SessionArtifactsSection'
import { getSessionTitle } from '@/utils/session'
import { extractLabelId, flattenLabels } from '@craft-agent/shared/labels'
import type { SessionFile } from '../../shared/types'

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])
const SHEET_EXTENSIONS = new Set(['csv', 'xls', 'xlsx'])
const PRESENTATION_EXTENSIONS = new Set(['ppt', 'pptx'])

type AssetType = 'image' | 'sheet' | 'presentation' | 'document'

interface AssetResult {
  file: SessionFile
  session: SessionMeta
  projectName: string | null
  assetType: AssetType
}

function extension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function getAssetType(name: string): AssetType {
  const ext = extension(name)
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (SHEET_EXTENSIONS.has(ext)) return 'sheet'
  if (PRESENTATION_EXTENSIONS.has(ext)) return 'presentation'
  return 'document'
}

function AssetIcon({ type }: { type: AssetType }) {
  if (type === 'image') return <FileImage className="h-4 w-4" />
  if (type === 'sheet') return <FileSpreadsheet className="h-4 w-4" />
  if (type === 'presentation') return <Presentation className="h-4 w-4" />
  return <FileText className="h-4 w-4" />
}

export default function ProjectAssetsPage() {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const { onOpenFile } = useAppShellContext()
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const { projects } = useProjects(workspace?.id ?? null)
  const { labels } = useLabels(workspace?.id ?? null)
  const { statuses } = useStatuses(workspace?.id ?? null)

  const [projectId, setProjectId] = React.useState('')
  const [sessionId, setSessionId] = React.useState('')
  const [statusId, setStatusId] = React.useState('')
  const [labelId, setLabelId] = React.useState('')
  const [assetType, setAssetType] = React.useState<AssetType | ''>('')
  const [keyword, setKeyword] = React.useState('')
  const [rawResults, setRawResults] = React.useState<AssetResult[]>([])
  const [loading, setLoading] = React.useState(false)

  const projectMap = React.useMemo(
    () => new Map(projects.map(project => [project.config.id, project.config.name])),
    [projects],
  )
  const flatLabels = React.useMemo(() => flattenLabels(labels), [labels])
  const sessions = React.useMemo(() => {
    if (!workspace) return []
    return Array.from(sessionMetaMap.values())
      .filter(session => !session.hidden && session.workspaceId === workspace.id)
      .filter(session => !projectId || session.projectId === projectId)
      .sort((a, b) => (b.lastMessageAt ?? b.createdAt ?? 0) - (a.lastMessageAt ?? a.createdAt ?? 0))
  }, [projectId, sessionMetaMap, workspace])

  const candidateSessions = React.useMemo(() => sessions.filter(session => {
    if (sessionId && session.id !== sessionId) return false
    if (statusId && (session.sessionStatus || 'todo') !== statusId) return false
    if (labelId && !session.labels?.some(label => extractLabelId(label) === labelId)) return false
    return true
  }), [labelId, sessionId, sessions, statusId])

  const results = React.useMemo(() => {
    const normalizedKeyword = keyword.trim().toLocaleLowerCase()
    return rawResults.filter(result => {
      if (assetType && result.assetType !== assetType) return false
      if (!normalizedKeyword) return true
      return `${result.file.name} ${getSessionTitle(result.session)} ${result.projectName ?? ''}`
        .toLocaleLowerCase()
        .includes(normalizedKeyword)
    })
  }, [assetType, keyword, rawResults])

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)

    void Promise.all(candidateSessions.slice(0, 100).map(async session => {
      try {
        const files = await window.electronAPI.getSessionFiles(session.id)
        return collectSessionArtifacts(files).map(file => ({
          file,
          session,
          projectName: session.projectId ? projectMap.get(session.projectId) ?? null : null,
          assetType: getAssetType(file.name),
        }))
      } catch {
        return []
      }
    })).then(groups => {
      if (cancelled) return
      setRawResults(groups.flat())
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [candidateSessions, projectMap])

  return (
    <Info_Page>
      <Info_Page.Header title={t('sidebar.projectAssets')} />
      <Info_Page.Content>
        <p className="mb-4 text-sm text-foreground/55">{t('projectAssets.description')}</p>

        <div className="mb-4 grid grid-cols-2 gap-2 xl:grid-cols-5">
          <DimensionSelect value={projectId} onChange={value => { setProjectId(value); setSessionId('') }} label={t('sidebar.projects')}>
            {projects.map(project => <option key={project.config.id} value={project.config.id}>{project.config.name}</option>)}
          </DimensionSelect>
          <DimensionSelect value={sessionId} onChange={setSessionId} label={t('rightDock.sessions')}>
            {sessions.map(session => <option key={session.id} value={session.id}>{getSessionTitle(session)}</option>)}
          </DimensionSelect>
          <DimensionSelect value={statusId} onChange={setStatusId} label={t('sidebar.statuses')}>
            {statuses.map(status => <option key={status.id} value={status.id}>{status.label}</option>)}
          </DimensionSelect>
          <DimensionSelect value={labelId} onChange={setLabelId} label={t('sidebar.labels')}>
            {flatLabels.map(label => <option key={label.id} value={label.id}>{label.name}</option>)}
          </DimensionSelect>
          <DimensionSelect value={assetType} onChange={value => setAssetType(value as AssetType | '')} label={t('projectAssets.fileType')}>
            {(['image', 'document', 'sheet', 'presentation'] as AssetType[]).map(type => (
              <option key={type} value={type}>{t(`projectAssets.type.${type}`)}</option>
            ))}
          </DimensionSelect>
        </div>

        <div className="relative mb-4 max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/35" />
          <Input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder={t('sidebar.search')} className="pl-8" />
        </div>

        <Info_Section title={t('projectAssets.results', { count: results.length })}>
          {loading ? (
            <div className="px-4 py-8 text-sm text-foreground/45">{t('common.loading')}</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-8 text-sm text-foreground/45">{t('projectAssets.noResults')}</div>
          ) : (
            <ul className="divide-y divide-foreground/[0.06]">
              {results.map(result => (
                <li key={`${result.session.id}:${result.file.path}`}>
                  <button
                    type="button"
                    onClick={() => onOpenFile(result.file.path)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-foreground/[0.025]"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground/50 shadow-minimal">
                      <AssetIcon type={result.assetType} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{result.file.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-foreground/45">
                        {[result.projectName, getSessionTitle(result.session), extension(result.file.name).toUpperCase()].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Info_Section>
      </Info_Page.Content>
    </Info_Page>
  )
}

function DimensionSelect({
  value,
  onChange,
  label,
  children,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <label className="min-w-0 text-xs text-foreground/50">
      <span className="mb-1 block">{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-9 w-full rounded-lg border-0 bg-background px-2 text-sm text-foreground shadow-minimal outline-none focus:ring-1 focus:ring-accent/40"
      >
        <option value="">{t('sidebar.all')}</option>
        {children}
      </select>
    </label>
  )
}
