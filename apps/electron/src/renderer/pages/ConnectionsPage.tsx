import { useAtom } from 'jotai'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { selectedConnectionAtom } from '@/atoms/connections'
import { useActiveWorkspace } from '@/context/AppShellContext'
import {
  sanitizeConnectionAuditRows,
  sanitizeConnectionBindingRows,
  sanitizeConnectionRows,
  type ConnectionAuditRow,
  type ConnectionBindingRow,
  type ConnectionListRow,
} from './connections-list'
import {
  CONNECT_SOURCES,
  IMPORT_PLACEHOLDERS,
  consumersForConnection,
  cycleTab,
  errorMessage,
  firstPickedPath,
  formatConfirmTargets,
  isImportPanelVisible,
  matchesConnectSource,
  removeCommittedPreview,
  testStatusFromError,
  testStatusFromResult,
  type ConnectSource,
  type PreviewSource,
  type TestStatus,
} from './connections-ui'

const TABS = ['services', 'credentials', 'imports', 'policies', 'audit'] as const
type ConnectionsTab = (typeof TABS)[number]
type PreviewRow = {
  candidateId: string
  label: string
  maskedSummary: string
  source: PreviewSource
}

function ImportPanel({
  source,
  active,
  children,
}: {
  source: PreviewSource
  active: ConnectSource | null
  children: ReactNode
}) {
  if (!isImportPanelVisible(source, active)) return null
  return (
    <div data-testid="connections-import-panel" data-source={source} className="space-y-3">
      {children}
    </div>
  )
}

export default function ConnectionsPage() {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const [tab, setTab] = useState<ConnectionsTab>('services')
  const [selected, setSelected] = useAtom(selectedConnectionAtom)
  const [rows, setRows] = useState<ConnectionListRow[] | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [rotatingId, setRotatingId] = useState<string | null>(null)
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const [unbindingId, setUnbindingId] = useState<string | null>(null)
  const [envPath, setEnvPath] = useState('')
  const [gitConfigPath, setGitConfigPath] = useState('')
  const [dockerConfigPath, setDockerConfigPath] = useState('')
  const [awsCredentialsPath, setAwsCredentialsPath] = useState('')
  const [awsConfigPath, setAwsConfigPath] = useState('')
  const [adcPath, setAdcPath] = useState('')
  const [previews, setPreviews] = useState<PreviewRow[]>([])
  const [auditRows, setAuditRows] = useState<ConnectionAuditRow[]>([])
  const [bindingRows, setBindingRows] = useState<ConnectionBindingRow[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [activeSource, setActiveSource] = useState<ConnectSource | null>(null)
  const [testById, setTestById] = useState<Record<string, TestStatus>>({})
  const [createIntegration, setCreateIntegration] = useState('github')
  const [createCredentialRef, setCreateCredentialRef] = useState('')
  const [createStorageMode, setCreateStorageMode] = useState<'copy' | 'reference'>('copy')
  const [grantConsumer, setGrantConsumer] = useState('')
  const [grantPurpose, setGrantPurpose] = useState('')
  const [grantActions, setGrantActions] = useState('github.api')
  const [grantResources, setGrantResources] = useState('github:user')
  const [grantTargetId, setGrantTargetId] = useState('')

  useEffect(() => {
    const workspaceId = workspace?.id
    const listConnections = window.electronAPI?.workgraph?.listConnections
    if (!workspaceId || typeof listConnections !== 'function') {
      setRows([])
      setListError(null)
      return
    }
    let stale = false
    listConnections(workspaceId)
      .then((raw) => {
        if (!stale) {
          setListError(null)
          setRows(sanitizeConnectionRows(raw))
        }
      })
      .catch((err) => {
        if (!stale) {
          setRows([])
          setListError(errorMessage(err))
        }
      })
    return () => {
      stale = true
      setSelected(null)
      setConfirmingId(null)
      setRotatingId(null)
      setConvertingId(null)
      setUnbindingId(null)
    }
  }, [workspace?.id, setSelected])

  useEffect(() => {
    if (tab !== 'audit') return
    const workspaceId = workspace?.id
    const listConnectionAudit = window.electronAPI?.workgraph?.listConnectionAudit
    if (!workspaceId || typeof listConnectionAudit !== 'function') {
      setAuditRows([])
      setAuditError(null)
      return
    }
    let stale = false
    listConnectionAudit({ workspaceId })
      .then((raw) => {
        if (!stale) {
          setAuditError(null)
          setAuditRows(sanitizeConnectionAuditRows(raw))
        }
      })
      .catch((err) => {
        if (!stale) {
          setAuditRows([])
          setAuditError(errorMessage(err))
        }
      })
    return () => {
      stale = true
    }
  }, [tab, workspace?.id])

  useEffect(() => {
    const workspaceId = workspace?.id
    const listConnectionBindings = window.electronAPI?.workgraph?.listConnectionBindings
    if (!workspaceId || typeof listConnectionBindings !== 'function') {
      setBindingRows([])
      return
    }
    let stale = false
    listConnectionBindings({ workspaceId })
      .then((raw) => {
        if (!stale) setBindingRows(sanitizeConnectionBindingRows(raw))
      })
      .catch(() => {
        if (!stale) setBindingRows([])
      })
    return () => {
      stale = true
    }
  }, [workspace?.id])

  const refreshRows = async (workspaceId: string) => {
    const listConnections = window.electronAPI?.workgraph?.listConnections
    if (typeof listConnections !== 'function') return
    try {
      setListError(null)
      setRows(sanitizeConnectionRows(await listConnections(workspaceId)))
    } catch (err) {
      setListError(errorMessage(err))
    }
  }

  const runPreview = async (
    source: PreviewSource,
    load: () => Promise<Array<{ candidateId: string; label: string; maskedSummary: string }>>,
  ) => {
    try {
      setImportError(null)
      const next = await load()
      setPreviews((current) => [
        ...current.filter((row) => row.source !== source),
        ...next.map((row) => ({ ...row, source })),
      ])
    } catch (err) {
      setImportError(errorMessage(err))
      setPreviews((current) => current.filter((row) => row.source !== source))
    }
  }

  const pickImportPath = async (setPath: (path: string) => void) => {
    const openFileDialog = window.electronAPI?.openFileDialog
    if (typeof openFileDialog !== 'function') return
    try {
      const next = firstPickedPath(await openFileDialog())
      if (next) setPath(next)
    } catch (err) {
      setImportError(errorMessage(err))
    }
  }

  const listed = rows ?? []
  const services = tab === 'services' ? listed : []
  const credentialRows = tab === 'credentials' ? listed : []
  const policyRows = tab === 'policies' ? listed : []
  const visiblePreviews = matchesConnectSource(previews, activeSource)

  const confirmRevoke = async (connectionId: string) => {
    const workspaceId = workspace?.id
    const revokeConnection = window.electronAPI?.workgraph?.revokeConnection
    if (!workspaceId || typeof revokeConnection !== 'function') return
    try {
      setListError(null)
      await revokeConnection({ workspaceId, connectionId })
      if (selected?.id === connectionId) setSelected(null)
      setConfirmingId(null)
      await refreshRows(workspaceId)
    } catch (err) {
      setListError(errorMessage(err))
    }
  }

  const confirmRotate = async (connectionId: string) => {
    const workspaceId = workspace?.id
    const rotateConnection = window.electronAPI?.workgraph?.rotateConnection
    if (!workspaceId || typeof rotateConnection !== 'function') return
    try {
      setListError(null)
      await rotateConnection({ workspaceId, connectionId })
      setRotatingId(null)
      await refreshRows(workspaceId)
    } catch (err) {
      setListError(errorMessage(err))
    }
  }

  const runTest = async (connectionId: string) => {
    const workspaceId = workspace?.id
    const testConnection = window.electronAPI?.workgraph?.testConnection
    if (!workspaceId || typeof testConnection !== 'function') return
    try {
      const result = await testConnection({ workspaceId, connectionId })
      setTestById((current) => ({ ...current, [connectionId]: testStatusFromResult(result) }))
    } catch (err) {
      setTestById((current) => ({ ...current, [connectionId]: testStatusFromError(err) }))
    }
  }

  const confirmConvert = async (connectionId: string) => {
    const workspaceId = workspace?.id
    const convertConnection = window.electronAPI?.workgraph?.convertConnection
    if (!workspaceId || typeof convertConnection !== 'function') return
    try {
      setListError(null)
      await convertConnection({ workspaceId, connectionId })
      setConvertingId(null)
      await refreshRows(workspaceId)
    } catch (err) {
      setListError(errorMessage(err))
    }
  }

  const confirmUnbind = async (bindingId: string) => {
    const workspaceId = workspace?.id
    const revokeConnectionBinding = window.electronAPI?.workgraph?.revokeConnectionBinding
    if (!workspaceId || typeof revokeConnectionBinding !== 'function') return
    try {
      setListError(null)
      await revokeConnectionBinding({ workspaceId, bindingId })
      setUnbindingId(null)
      const listConnectionBindings = window.electronAPI?.workgraph?.listConnectionBindings
      if (typeof listConnectionBindings === 'function') {
        setBindingRows(sanitizeConnectionBindingRows(await listConnectionBindings({ workspaceId })))
      }
    } catch (err) {
      setListError(errorMessage(err))
    }
  }

  const runRepair = async (connectionId: string) => {
    const workspaceId = workspace?.id
    const repairConnection = window.electronAPI?.workgraph?.repairConnection
    if (!workspaceId || typeof repairConnection !== 'function') return
    try {
      setListError(null)
      await repairConnection({ workspaceId, connectionId })
      await refreshRows(workspaceId)
    } catch (err) {
      setListError(errorMessage(err))
    }
  }

  const confirmCreate = async () => {
    const workspaceId = workspace?.id
    const createConnection = window.electronAPI?.workgraph?.createConnection
    if (!workspaceId || typeof createConnection !== 'function') return
    try {
      setListError(null)
      await createConnection({
        workspaceId,
        integrationId: createIntegration.trim(),
        credentialRefId: createCredentialRef.trim(),
        storageMode: createStorageMode,
      })
      setCreateCredentialRef('')
      await refreshRows(workspaceId)
    } catch (err) {
      setListError(errorMessage(err))
    }
  }

  const confirmGrant = async () => {
    const workspaceId = workspace?.id
    const grantConnection = window.electronAPI?.workgraph?.grantConnection
    if (!workspaceId || typeof grantConnection !== 'function') return
    const connectionId = grantTargetId.trim() || selected?.id || ''
    const actions = grantActions.split(',').map((item) => item.trim()).filter(Boolean)
    const resources = grantResources.split(',').map((item) => item.trim()).filter(Boolean)
    if (!connectionId) return
    try {
      setListError(null)
      await grantConnection({
        workspaceId,
        connectionId,
        consumerId: grantConsumer.trim(),
        purpose: grantPurpose.trim(),
        actions,
        resources,
      })
      setGrantConsumer('')
      setGrantPurpose('')
      const listConnectionBindings = window.electronAPI?.workgraph?.listConnectionBindings
      if (typeof listConnectionBindings === 'function') {
        setBindingRows(sanitizeConnectionBindingRows(await listConnectionBindings({ workspaceId })))
      }
    } catch (err) {
      setListError(errorMessage(err))
    }
  }

  const pathField = (
    labelKey: string,
    value: string,
    setValue: (path: string) => void,
    placeholder: string,
  ) => (
    <label className="block">
      <span className="text-muted-foreground">{t(labelKey)}</span>
      <div className="mt-1 flex gap-1">
        <input
          className="w-full rounded border bg-transparent px-2 py-1 font-mono text-xs"
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          spellCheck={false}
        />
        <button
          type="button"
          data-testid="connections-pick-path"
          aria-label={t(labelKey)}
          className="rounded border px-2 py-1"
          onClick={() => pickImportPath(setValue)}
        >
          …
        </button>
      </div>
    </label>
  )

  const renderRevokeControls = (row: ConnectionListRow) => (
    confirmingId === row.id ? (
      <div className="flex flex-col items-end gap-1">
        <div className="font-mono text-[11px]" data-testid="connections-confirm-target">
          {formatConfirmTargets(row, consumersForConnection(bindingRows, row.id))}
        </div>
        <div className="flex gap-1">
        <button type="button" className="rounded border px-2 py-1" onClick={() => confirmRevoke(row.id)}>
          {t('connections.revokeConfirm')}
        </button>
        <button type="button" className="rounded border px-2 py-1" onClick={() => setConfirmingId(null)}>
          {t('connections.revokeCancel')}
        </button>
        </div>
      </div>
    ) : (
      <button type="button" className="rounded border px-2 py-1" onClick={() => setConfirmingId(row.id)}>
        {t('connections.revoke')}
      </button>
    )
  )

  const renderRotateControls = (row: ConnectionListRow) => (
    rotatingId === row.id ? (
      <div className="flex flex-col items-end gap-1">
        <div className="font-mono text-[11px]" data-testid="connections-rotate-confirm-target">
          {formatConfirmTargets(row, consumersForConnection(bindingRows, row.id))}
        </div>
        <div className="flex gap-1">
        <button type="button" className="rounded border px-2 py-1" onClick={() => confirmRotate(row.id)}>
          {t('connections.rotateConfirm')}
        </button>
        <button type="button" className="rounded border px-2 py-1" onClick={() => setRotatingId(null)}>
          {t('connections.rotateCancel')}
        </button>
        </div>
      </div>
    ) : (
      <button type="button" className="rounded border px-2 py-1" onClick={() => setRotatingId(row.id)}>
        {t('connections.rotate')}
      </button>
    )
  )

  const empty = (
    <div className="flex flex-1 items-center justify-center">
      {tab === 'audit' && auditError ? (
        <p className="text-sm" data-testid="connections-audit-error">{auditError}</p>
      ) : listError ? (
        <p className="text-sm" data-testid="connections-list-error">{listError}</p>
      ) : (
        <p className="text-sm">{t('connections.empty')}</p>
      )}
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="connections-page">
      <div
        role="tablist"
        aria-label={t('sidebar.connections')}
        className="flex gap-2 border-b px-4 pt-3"
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            setTab(cycleTab(TABS, tab, 1))
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault()
            setTab(cycleTab(TABS, tab, -1))
          }
        }}
      >
        {TABS.map((id) => (
          <button
            key={id}
            id={`connections-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`connections-panel-${id}`}
            className={`rounded-t px-3 py-2 text-sm ${tab === id ? 'bg-accent/10 text-accent' : 'text-muted-foreground'}`}
            onClick={() => setTab(id)}
          >
            {t(`connections.tab.${id}`)}
          </button>
        ))}
        <button
          type="button"
          className="ml-auto rounded border px-3 py-1 text-sm text-foreground"
          onClick={() => setTab('imports')}
        >
          {t('connections.connect')}
        </button>
      </div>
      <div
        role="tabpanel"
        id={`connections-panel-${tab}`}
        aria-labelledby={`connections-tab-${tab}`}
        aria-busy={rows === null}
        className="flex flex-1 min-h-0 flex-col p-6 text-muted-foreground"
      >
        {tab === 'imports' ? (
          <div className="space-y-3 text-sm text-foreground">
            <ul className="flex flex-wrap gap-2 text-xs">
              {CONNECT_SOURCES.map((source) => (
                <li key={source}>
                  <button
                    type="button"
                    data-testid="connections-source-chip"
                    aria-pressed={activeSource === source}
                    className={`rounded border px-2 py-1 ${activeSource === source ? 'bg-accent/10 text-accent' : ''}`}
                    onClick={() => setActiveSource((current) => current === source ? null : source)}
                  >
                    {source}
                  </button>
                </li>
              ))}
            </ul>
            {importError ? (
              <p className="text-sm" data-testid="connections-import-error">{importError}</p>
            ) : null}
            <ImportPanel source="env" active={activeSource}>
              {pathField('connections.import.envPath', envPath, setEnvPath, IMPORT_PLACEHOLDERS.env)}
              <button
                type="button"
                className="rounded border px-3 py-1"
                onClick={async () => {
                  const previewGithubEnv = window.electronAPI?.workgraph?.previewGithubEnv
                  if (typeof previewGithubEnv !== 'function' || !envPath) {
                    setPreviews((current) => current.filter((row) => row.source !== 'env'))
                    return
                  }
                  await runPreview('env', () => previewGithubEnv(envPath))
                }}
              >
                {t('connections.import.discover')}
              </button>
            </ImportPanel>
            <ImportPanel source="git-helper" active={activeSource}>
              {pathField('connections.import.gitConfigPath', gitConfigPath, setGitConfigPath, IMPORT_PLACEHOLDERS.gitConfig)}
              <button
                type="button"
                className="rounded border px-3 py-1"
                onClick={async () => {
                  const previewGitHelper = window.electronAPI?.workgraph?.previewGitHelper
                  if (typeof previewGitHelper !== 'function' || !gitConfigPath) {
                    setPreviews((current) => current.filter((row) => row.source !== 'git-helper'))
                    return
                  }
                  await runPreview('git-helper', () => previewGitHelper(gitConfigPath))
                }}
              >
                {t('connections.import.discoverGitHelper')}
              </button>
            </ImportPanel>
            <ImportPanel source="docker" active={activeSource}>
              {pathField('connections.import.dockerConfigPath', dockerConfigPath, setDockerConfigPath, IMPORT_PLACEHOLDERS.dockerConfig)}
              <button
                type="button"
                className="rounded border px-3 py-1"
                onClick={async () => {
                  const previewDockerHelper = window.electronAPI?.workgraph?.previewDockerHelper
                  if (typeof previewDockerHelper !== 'function' || !dockerConfigPath) {
                    setPreviews((current) => current.filter((row) => row.source !== 'docker'))
                    return
                  }
                  await runPreview('docker', () => previewDockerHelper(dockerConfigPath))
                }}
              >
                {t('connections.import.discoverDocker')}
              </button>
            </ImportPanel>
            <ImportPanel source="aws" active={activeSource}>
              {pathField('connections.import.awsCredentialsPath', awsCredentialsPath, setAwsCredentialsPath, IMPORT_PLACEHOLDERS.awsCredentials)}
              {pathField('connections.import.awsConfigPath', awsConfigPath, setAwsConfigPath, IMPORT_PLACEHOLDERS.awsConfig)}
              <button
                type="button"
                className="rounded border px-3 py-1"
                onClick={async () => {
                  const previewAwsProfiles = window.electronAPI?.workgraph?.previewAwsProfiles
                  if (typeof previewAwsProfiles !== 'function') {
                    setPreviews((current) => current.filter((row) => row.source !== 'aws'))
                    return
                  }
                  await runPreview('aws', () => previewAwsProfiles({ credentialsPath: awsCredentialsPath, configPath: awsConfigPath }))
                }}
              >
                {t('connections.import.discoverAws')}
              </button>
            </ImportPanel>
            <ImportPanel source="keychain" active={activeSource}>
              <button
                type="button"
                className="rounded border px-3 py-1"
                onClick={async () => {
                  const previewKeychain = window.electronAPI?.workgraph?.previewKeychain
                  if (typeof previewKeychain !== 'function') {
                    setPreviews((current) => current.filter((row) => row.source !== 'keychain'))
                    return
                  }
                  await runPreview('keychain', () => previewKeychain())
                }}
              >
                {t('connections.import.discoverKeychain')}
              </button>
            </ImportPanel>
            <ImportPanel source="adc" active={activeSource}>
              {pathField('connections.import.adcPath', adcPath, setAdcPath, IMPORT_PLACEHOLDERS.adc)}
              <button
                type="button"
                className="rounded border px-3 py-1"
                onClick={async () => {
                  const previewAdc = window.electronAPI?.workgraph?.previewAdc
                  if (typeof previewAdc !== 'function' || !adcPath) {
                    setPreviews((current) => current.filter((row) => row.source !== 'adc'))
                    return
                  }
                  await runPreview('adc', () => previewAdc(adcPath))
                }}
              >
                {t('connections.import.discoverAdc')}
              </button>
            </ImportPanel>
            <ImportPanel source="ssh-agent" active={activeSource}>
              <button
                type="button"
                className="rounded border px-3 py-1"
                onClick={async () => {
                  const previewSshAgent = window.electronAPI?.workgraph?.previewSshAgent
                  if (typeof previewSshAgent !== 'function') {
                    setPreviews((current) => current.filter((row) => row.source !== 'ssh-agent'))
                    return
                  }
                  await runPreview('ssh-agent', () => previewSshAgent())
                }}
              >
                {t('connections.import.discoverSshAgent')}
              </button>
            </ImportPanel>
            <ul className="space-y-2">
              {visiblePreviews.map((row) => (
                <li key={`${row.source}:${row.candidateId}`} className="flex items-center justify-between rounded border px-3 py-2">
                  <div>
                    <div className="font-medium">{row.label}</div>
                    <div className="font-mono text-xs text-muted-foreground">{row.source}</div>
                    <div className="font-mono text-xs text-muted-foreground">{row.maskedSummary}</div>
                  </div>
                  <button
                    type="button"
                    className="rounded border px-2 py-1"
                    onClick={async () => {
                      const workspaceId = workspace?.id
                      const api = window.electronAPI?.workgraph
                      if (!workspaceId || !api) return
                      try {
                        setImportError(null)
                        if (row.source === 'env' && api.importGithubEnv) {
                          await api.importGithubEnv({ envPath, candidateId: row.candidateId, workspaceId })
                        } else if (row.source === 'git-helper' && api.importGitHelper) {
                          await api.importGitHelper({ configPath: gitConfigPath, candidateId: row.candidateId, workspaceId })
                        } else if (row.source === 'docker' && api.importDockerHelper) {
                          await api.importDockerHelper({ configPath: dockerConfigPath, candidateId: row.candidateId, workspaceId })
                        } else if (row.source === 'aws' && api.importAwsProfile) {
                          await api.importAwsProfile({ credentialsPath: awsCredentialsPath, configPath: awsConfigPath, candidateId: row.candidateId, workspaceId })
                        } else if (row.source === 'keychain' && api.importKeychain) {
                          await api.importKeychain({ candidateId: row.candidateId, workspaceId })
                        } else if (row.source === 'adc' && api.importAdc) {
                          await api.importAdc({ credentialsPath: adcPath, candidateId: row.candidateId, workspaceId })
                        } else if (row.source === 'ssh-agent' && api.importSshAgent) {
                          await api.importSshAgent({ candidateId: row.candidateId, workspaceId })
                        }
                        setPreviews((current) => removeCommittedPreview(current, row))
                        await refreshRows(workspaceId)
                      } catch (err) {
                        setImportError(errorMessage(err))
                      }
                    }}
                  >
                    {t('connections.import.commit')}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : tab === 'services' && rows === null ? (
          <div data-testid="connections-loading" aria-busy="true" className="flex flex-1" />
        ) : tab === 'services' ? (
          <div className="space-y-4 text-sm text-foreground">
            <div data-testid="connections-create-form" className="space-y-2 rounded border p-3">
              <label className="block">
                <span className="text-muted-foreground">{t('connections.createIntegration')}</span>
                <input
                  className="mt-1 w-full rounded border bg-transparent px-2 py-1 font-mono text-xs"
                  value={createIntegration}
                  onChange={(event) => setCreateIntegration(event.target.value)}
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground">{t('connections.createCredentialRef')}</span>
                <input
                  className="mt-1 w-full rounded border bg-transparent px-2 py-1 font-mono text-xs"
                  value={createCredentialRef}
                  onChange={(event) => setCreateCredentialRef(event.target.value)}
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground">{t('connections.createStorageMode')}</span>
                <select
                  className="mt-1 w-full rounded border bg-transparent px-2 py-1 font-mono text-xs"
                  value={createStorageMode}
                  onChange={(event) => setCreateStorageMode(event.target.value === 'reference' ? 'reference' : 'copy')}
                >
                  <option value="copy">copy</option>
                  <option value="reference">reference</option>
                </select>
              </label>
              <button type="button" className="rounded border px-3 py-1" onClick={() => void confirmCreate()}>
                {t('connections.create')}
              </button>
            </div>
            {listError ? (
              <p className="text-sm" data-testid="connections-list-error">{listError}</p>
            ) : null}
            {services.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('connections.empty')}</p>
            ) : (
          <ul className="space-y-2 text-sm text-foreground">
            {services.map((row) => {
              const status = testById[row.id]
              return (
              <li key={row.id} className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="connections-row"
                  aria-selected={selected?.id === row.id}
                  className={`min-w-0 flex-1 rounded border px-3 py-2 text-left ${selected?.id === row.id ? 'bg-accent/10' : ''}`}
                  onClick={() => setSelected(row)}
                >
                  <div className="font-medium">{row.integrationId}</div>
                  <div className="text-muted-foreground">{row.storageMode}</div>
                  <div className="font-mono text-xs">{row.credentialRefId}</div>
                  {status && status.kind !== 'idle' ? (
                    <div className="font-mono text-xs" data-testid="connections-test-status">
                      {status.kind === 'ok' ? status.login : status.message}
                    </div>
                  ) : null}
                </button>
                <button type="button" className="rounded border px-2 py-1" onClick={() => runTest(row.id)}>
                  {t('connections.test')}
                </button>
                <button type="button" className="rounded border px-2 py-1" onClick={() => runRepair(row.id)}>
                  {t('connections.repair')}
                </button>
                {renderRevokeControls(row)}
                {renderRotateControls(row)}
              </li>
              )
            })}
          </ul>
            )}
          </div>
        ) : tab === 'credentials' && rows === null ? (
          <div data-testid="connections-loading" aria-busy="true" className="flex flex-1" />
        ) : tab === 'credentials' && credentialRows.length > 0 ? (
          <ul className="space-y-2 text-sm text-foreground">
            {credentialRows.map((row) => (
              <li key={row.id} className="flex items-center gap-2 rounded border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{row.integrationId}</div>
                  <div className="font-mono text-xs">{row.credentialRefId}</div>
                  <div className="text-muted-foreground">{row.storageMode}</div>
                </div>
                {row.storageMode === 'copy' ? (
                  convertingId === row.id ? (
                    <div className="flex flex-col items-end gap-1">
                      <div className="font-mono text-[11px]">
                        {formatConfirmTargets(row, consumersForConnection(bindingRows, row.id))}
                      </div>
                      <div className="flex gap-1">
                        <button type="button" className="rounded border px-2 py-1" onClick={() => confirmConvert(row.id)}>
                          {t('connections.convertConfirm')}
                        </button>
                        <button type="button" className="rounded border px-2 py-1" onClick={() => setConvertingId(null)}>
                          {t('connections.convertCancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="rounded border px-2 py-1" onClick={() => setConvertingId(row.id)}>
                      {t('connections.convert')}
                    </button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        ) : tab === 'policies' && rows === null ? (
          <div data-testid="connections-loading" aria-busy="true" className="flex flex-1" />
        ) : tab === 'policies' ? (
          <div className="space-y-4 text-sm text-foreground">
            <div data-testid="connections-grant-form" className="space-y-2 rounded border p-3">
              <label className="block">
                <span className="text-muted-foreground">{t('connections.grantConsumer')}</span>
                <input
                  className="mt-1 w-full rounded border bg-transparent px-2 py-1 font-mono text-xs"
                  value={grantConsumer}
                  onChange={(event) => setGrantConsumer(event.target.value)}
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground">{t('connections.grantPurpose')}</span>
                <input
                  className="mt-1 w-full rounded border bg-transparent px-2 py-1 font-mono text-xs"
                  value={grantPurpose}
                  onChange={(event) => setGrantPurpose(event.target.value)}
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground">{t('connections.grantActions')}</span>
                <input
                  className="mt-1 w-full rounded border bg-transparent px-2 py-1 font-mono text-xs"
                  value={grantActions}
                  onChange={(event) => setGrantActions(event.target.value)}
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground">{t('connections.grantResources')}</span>
                <input
                  className="mt-1 w-full rounded border bg-transparent px-2 py-1 font-mono text-xs"
                  value={grantResources}
                  onChange={(event) => setGrantResources(event.target.value)}
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground">{t('connections.grantTarget')}</span>
                <select
                  className="mt-1 w-full rounded border bg-transparent px-2 py-1 font-mono text-xs"
                  value={grantTargetId || selected?.id || ''}
                  onChange={(event) => setGrantTargetId(event.target.value)}
                >
                  <option value="">—</option>
                  {listed.map((row) => (
                    <option key={row.id} value={row.id}>{row.id}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="rounded border px-3 py-1" onClick={() => void confirmGrant()}>
                {t('connections.grant')}
              </button>
            </div>
            {policyRows.length > 0 ? (
              <ul className="space-y-2">
                {policyRows.map((row) => (
                  <li key={row.id} className="rounded border px-3 py-2">
                    <div className="font-medium">{row.integrationId}</div>
                    <div className="font-mono text-xs">{row.scopes.join(', ') || '—'}</div>
                  </li>
                ))}
              </ul>
            ) : null}
            {bindingRows.length > 0 ? (
              <ul className="space-y-2">
                {bindingRows.map((row) => (
                  <li key={row.id} className="flex items-center gap-2 rounded border px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{row.consumerId}</div>
                      <div className="text-muted-foreground">{row.purpose}</div>
                      <div className="font-mono text-xs">{row.actions.join(', ')}</div>
                    </div>
                    {unbindingId === row.id ? (
                      <div className="flex gap-1">
                        <button type="button" className="rounded border px-2 py-1" onClick={() => confirmUnbind(row.id)}>
                          {t('connections.unbindConfirm')}
                        </button>
                        <button type="button" className="rounded border px-2 py-1" onClick={() => setUnbindingId(null)}>
                          {t('connections.unbindCancel')}
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="rounded border px-2 py-1" onClick={() => setUnbindingId(row.id)}>
                        {t('connections.unbind')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : tab === 'audit' && auditRows.length > 0 ? (
          <ul className="space-y-2 text-sm text-foreground">
            {auditRows.map((row) => (
              <li key={`${row.connectionId}:${row.occurredAt}:${row.payloadDigest}`} className="rounded border px-3 py-2">
                <div className="font-medium">{row.action ?? row.eventType}</div>
                <div className="text-muted-foreground">{row.outcome}</div>
                <div className="text-muted-foreground">{new Date(row.occurredAt).toISOString()}</div>
                <div className="font-mono text-xs">{row.actorId ?? '—'}</div>
                <div className="font-mono text-xs">{row.connectionId}</div>
                <div className="font-mono text-xs">{row.payloadDigest}</div>
              </li>
            ))}
          </ul>
        ) : rows === null && (tab === 'services' || tab === 'credentials' || tab === 'policies') ? (
          <div data-testid="connections-loading" aria-busy="true" className="flex flex-1" />
        ) : (
          empty
        )}
      </div>
    </div>
  )
}
