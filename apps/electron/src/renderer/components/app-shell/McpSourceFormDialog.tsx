import * as React from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, CheckCircle2 } from 'lucide-react'
import i18n from 'i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type {
  McpImportBatchCreateResult,
  McpImportCandidate,
  McpImportCandidateAction,
  McpImportCreateResult,
  McpImportFieldError,
  McpImportSecretHandling,
  McpManualAuthCredentialInput,
  McpManualSourceInput,
} from '@craft-agent/shared/sources'
import type { LoadedSource } from '../../../../shared/types'

type McpFormMode = 'streamable_http' | 'stdio' | 'json'
type McpFormAuthType = 'none' | 'oauth' | 'bearer' | 'api-key'

interface McpSourceFormDialogProps {
  workspaceId: string
  trigger?: ReactNode
  /** When set, the dialog opens in edit mode with pre-filled form */
  editSource?: LoadedSource
  /** Called when edit completes or dialog is dismissed */
  onEditComplete?: () => void
}

export function McpSourceFormDialog({ workspaceId, trigger, editSource, onEditComplete }: McpSourceFormDialogProps) {
  const { t } = useTranslation()
  const isEditMode = !!editSource
  const [localOpen, setLocalOpen] = React.useState(false)
  const [mode, setMode] = React.useState<McpFormMode>('streamable_http')
  const [name, setName] = React.useState('')
  const [provider, setProvider] = React.useState('')
  const [icon, setIcon] = React.useState('')
  const [enabled, setEnabled] = React.useState(true)
  const [enableInWorkspace, setEnableInWorkspace] = React.useState(true)
  const [url, setUrl] = React.useState('')
  const [authType, setAuthType] = React.useState<McpFormAuthType>('none')
  const [bearerToken, setBearerToken] = React.useState('')
  const [apiKeyHeader, setApiKeyHeader] = React.useState('X-API-Key')
  const [apiKeyValue, setApiKeyValue] = React.useState('')
  const [headersText, setHeadersText] = React.useState('')
  const [command, setCommand] = React.useState('')
  const [argsText, setArgsText] = React.useState('')
  const [envText, setEnvText] = React.useState('')
  const [jsonText, setJsonText] = React.useState('')
  const [jsonErrors, setJsonErrors] = React.useState<McpImportFieldError[]>([])
  const [candidates, setCandidates] = React.useState<McpImportCandidate[]>([])
  const [selectedCandidateKeys, setSelectedCandidateKeys] = React.useState<Set<string>>(new Set())
  const [importResult, setImportResult] = React.useState<McpImportBatchCreateResult | null>(null)
  const [isParsingJson, setIsParsingJson] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const isRemote = mode === 'streamable_http'
  const canSubmit = mode !== 'json' && Boolean(name.trim() && provider.trim() && (isRemote ? url.trim() : command.trim()))
  const selectedImportCandidates = candidates.filter((candidate) => selectedCandidateKeys.has(candidate.key) && candidate.errors.length === 0)

  // Dialog open state: controlled by parent in edit mode, internal otherwise
  const open = isEditMode ? true : localOpen
  const handleOpenChange = (newOpen: boolean) => {
    if (isEditMode) {
      if (!newOpen) onEditComplete?.()
    } else {
      setLocalOpen(newOpen)
    }
  }

  // Pre-fill form when entering edit mode
  React.useEffect(() => {
    if (!editSource) return
    const config = editSource.config
    const mcp = config.mcp ?? {}
    const transport = mcp.transport ?? 'streamable_http'

    setMode(transport === 'stdio' ? 'stdio' : 'streamable_http')
    setName(config.name)
    setProvider(config.provider ?? '')
    setIcon(config.icon ?? '')
    setEnabled(config.enabled ?? true)
    setEnableInWorkspace(true)
    setUrl(mcp.url ?? '')

    // Determine auth type from existing config
    if (mcp.authType === 'bearer') {
      setAuthType('bearer')
    } else if (mcp.authType === 'oauth') {
      setAuthType('oauth')
    } else if (mcp.headerNames && mcp.headerNames.length > 0) {
      setAuthType('api-key')
      setApiKeyHeader(mcp.headerNames[0])
    } else {
      setAuthType('none')
    }

    // Sensitive fields: NOT pre-filled
    setBearerToken('')
    setApiKeyValue('')

    setHeadersText(objectToLines(mcp.headers))
    setCommand(mcp.command ?? '')
    setArgsText(mcp.args ? mcp.args.join('\n') : '')
    setEnvText(objectToLines(mcp.env))

    // Reset JSON import state
    setJsonText('')
    setJsonErrors([])
    setCandidates([])
    setSelectedCandidateKeys(new Set())
    setImportResult(null)
    setError(null)
  }, [editSource])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (mode === 'json') return
    if (!canSubmit || isSubmitting) return

    setIsSubmitting(true)
    setError(null)
    try {
      const authCredential = buildAuthCredential(authType, bearerToken, apiKeyHeader, apiKeyValue)

      if (isEditMode && editSource) {
        await window.electronAPI.updateSource(workspaceId, editSource.config.slug, {
          name: name.trim(),
          provider: provider.trim(),
          type: 'mcp',
          enabled,
          icon: icon.trim() || undefined,
          mcp: buildMcpPayload(mode, {
            url,
            authType,
            headersText,
            command,
            argsText,
            envText,
          }),
          ...(authCredential ? { authCredential } : {}),
        })
        resetForm()
        onEditComplete?.()
        return
      }

      await window.electronAPI.createSource(workspaceId, {
        name: name.trim(),
        provider: provider.trim(),
        type: 'mcp',
        enabled,
        enableInWorkspace,
        icon: icon.trim() || undefined,
        mcp: buildMcpPayload(mode, {
          url,
          authType,
          headersText,
          command,
          argsText,
          envText,
        }),
        authCredential,
      })
      resetForm()
      setLocalOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetForm = () => {
    setMode('streamable_http')
    setName('')
    setProvider('')
    setIcon('')
    setEnabled(true)
    setEnableInWorkspace(true)
    setUrl('')
    setAuthType('none')
    setBearerToken('')
    setApiKeyHeader('X-API-Key')
    setApiKeyValue('')
    setHeadersText('')
    setCommand('')
    setArgsText('')
    setEnvText('')
    setJsonText('')
    setJsonErrors([])
    setCandidates([])
    setSelectedCandidateKeys(new Set())
    setImportResult(null)
    setError(null)
  }

  const handleParseJson = async () => {
    if (!jsonText.trim() || isParsingJson) return

    setIsParsingJson(true)
    setError(null)
    setImportResult(null)
    try {
      const result = await window.electronAPI.parseMcpJsonImport(workspaceId, jsonText)
      setJsonErrors(result.errors)
      setCandidates(result.candidates)
      setSelectedCandidateKeys(new Set(result.candidates.filter((candidate) => candidate.errors.length === 0).map((candidate) => candidate.key)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsParsingJson(false)
    }
  }

  const handleImportJson = async () => {
    if (selectedImportCandidates.length === 0 || isSubmitting) return

    setIsSubmitting(true)
    setError(null)
    try {
      const result = await window.electronAPI.importMcpJsonCandidates(workspaceId, selectedImportCandidates)
      setImportResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  const updateCandidate = (key: string, update: (candidate: McpImportCandidate) => McpImportCandidate) => {
    setCandidates((current) => current.map((candidate) => {
      if (candidate.key !== key) return candidate
      const next = update(candidate)
      return { ...next, errors: validateImportCandidate(next) }
    }))
  }

  const toggleCandidate = (key: string, selected: boolean) => {
    setSelectedCandidateKeys((current) => {
      const next = new Set(current)
      if (selected) {
        next.add(key)
      } else {
        next.delete(key)
      }
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!isEditMode && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-4xl">
        <form onSubmit={handleSubmit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>{isEditMode ? t('mcpForm.editTitle') : t('mcpForm.title')}</DialogTitle>
            <DialogDescription>{t('mcpForm.description')}</DialogDescription>
          </DialogHeader>

          <Tabs value={mode} onValueChange={isEditMode ? undefined : (value) => setMode(value as McpFormMode)}>
            <TabsList className="grid w-full grid-cols-3" title={isEditMode ? t('mcpForm.transportLocked') : undefined}>
              <TabsTrigger value="streamable_http" disabled={isEditMode && mode !== 'streamable_http'}>
                Streamable HTTP
              </TabsTrigger>
              <TabsTrigger value="stdio" disabled={isEditMode && mode !== 'stdio'}>
                Command
              </TabsTrigger>
              <TabsTrigger value="json" disabled={isEditMode}>JSON</TabsTrigger>
            </TabsList>

            <TabsContent value="streamable_http" className="space-y-4">
              <ManualDetails
                name={name}
                setName={setName}
                provider={provider}
                setProvider={setProvider}
                icon={icon}
                setIcon={setIcon}
                enabled={enabled}
                setEnabled={setEnabled}
                enableInWorkspace={enableInWorkspace}
                setEnableInWorkspace={setEnableInWorkspace}
              />
              <RemoteFields
                url={url}
                setUrl={setUrl}
                authType={authType}
                setAuthType={setAuthType}
                bearerToken={bearerToken}
                setBearerToken={setBearerToken}
                apiKeyHeader={apiKeyHeader}
                setApiKeyHeader={setApiKeyHeader}
                apiKeyValue={apiKeyValue}
                setApiKeyValue={setApiKeyValue}
                headersText={headersText}
                setHeadersText={setHeadersText}
                isEditMode={isEditMode}
                isAuthenticated={editSource?.config.isAuthenticated}
              />
            </TabsContent>

            <TabsContent value="stdio" className="space-y-4">
              <ManualDetails
                name={name}
                setName={setName}
                provider={provider}
                setProvider={setProvider}
                icon={icon}
                setIcon={setIcon}
                enabled={enabled}
                setEnabled={setEnabled}
                enableInWorkspace={enableInWorkspace}
                setEnableInWorkspace={setEnableInWorkspace}
              />
              <Field label={t('mcpForm.command')}>
                <Input value={command} onChange={(event) => setCommand(event.target.value)} placeholder={t('mcpForm.commandPlaceholder')} />
              </Field>
              <Field label={t('mcpForm.args')}>
                <Textarea value={argsText} onChange={(event) => setArgsText(event.target.value)} rows={4} placeholder={t('mcpForm.argsPlaceholder')} />
              </Field>
              <Field label={t('mcpForm.env')}>
                <Textarea value={envText} onChange={(event) => setEnvText(event.target.value)} rows={4} placeholder={t('mcpForm.envPlaceholder')} />
              </Field>
            </TabsContent>

            {!isEditMode && (
            <TabsContent value="json" className="space-y-4">
              <Field label={t('mcpForm.jsonLabel')}>
                <Textarea
                  value={jsonText}
                  onChange={(event) => setJsonText(event.target.value)}
                  rows={8}
                  placeholder={t('mcpForm.jsonPlaceholder')}
                />
              </Field>
              <div className="flex items-center gap-2">
                <Button type="button" onClick={handleParseJson} disabled={!jsonText.trim() || isParsingJson}>
                  {isParsingJson && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('mcpForm.parseJson')}
                </Button>
                <Button type="button" variant="secondary" onClick={handleImportJson} disabled={selectedImportCandidates.length === 0 || isSubmitting}>
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('mcpForm.importSelected')}
                </Button>
                <span className="text-xs text-muted-foreground">{t('mcpForm.selectedCount', { count: selectedImportCandidates.length })}</span>
              </div>
              {jsonErrors.length > 0 && (
                <FieldErrors fieldErrors={jsonErrors} />
              )}
              {candidates.length > 0 && (
                <div className="space-y-3">
                  {candidates.map((candidate) => (
                    <McpJsonCandidatePreview
                      key={candidate.key}
                      candidate={candidate}
                      selected={selectedCandidateKeys.has(candidate.key)}
                      onSelectedChange={(selected) => toggleCandidate(candidate.key, selected)}
                      onChange={(update) => updateCandidate(candidate.key, update)}
                    />
                  ))}
                </div>
              )}
              {importResult && (
                <ImportResults result={importResult} />
              )}
            </TabsContent>
            )}
          </Tabs>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>{t('common.cancel')}</Button>
            {mode !== 'json' && (
              <Button type="submit" disabled={!canSubmit || isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {isEditMode ? t('common.save') : t('common.create')}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ManualDetails(props: {
  name: string
  setName: (value: string) => void
  provider: string
  setProvider: (value: string) => void
  icon: string
  setIcon: (value: string) => void
  enabled: boolean
  setEnabled: (value: boolean) => void
  enableInWorkspace: boolean
  setEnableInWorkspace: (value: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <Field label={t('common.name')}>
          <Input value={props.name} onChange={(event) => props.setName(event.target.value)} placeholder="Linear" required />
        </Field>
        <Field label={t('mcpForm.provider')}>
          <Input value={props.provider} onChange={(event) => props.setProvider(event.target.value)} placeholder="linear" required />
        </Field>
        <Field label={t('mcpForm.icon')}>
          <Input className="w-20" value={props.icon} onChange={(event) => props.setIcon(event.target.value)} placeholder="icon" />
        </Field>
      </div>
      <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
        <span>{t('mcpForm.enabled')}</span>
        <Switch checked={props.enabled} onCheckedChange={props.setEnabled} />
      </label>
      <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
        <span>{t('mcpForm.enableInWorkspace')}</span>
        <Switch checked={props.enableInWorkspace} onCheckedChange={props.setEnableInWorkspace} />
      </label>
    </>
  )
}

function McpJsonCandidatePreview(props: {
  candidate: McpImportCandidate
  selected: boolean
  onSelectedChange: (selected: boolean) => void
  onChange: (update: (candidate: McpImportCandidate) => McpImportCandidate) => void
}) {
  const { candidate } = props
  const isValid = candidate.errors.length === 0
  const mcp = candidate.input.mcp ?? {}
  const isRemote = mcp.transport !== 'stdio'

  return (
    <section className="rounded-md border border-border/70 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <label className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={props.selected}
            disabled={!isValid}
            onChange={(event) => props.onSelectedChange(event.target.checked)}
          />
          <span className="truncate">{candidate.key}</span>
        </label>
        <span className={isValid ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>
          {isValid ? 'Ready' : 'Blocked'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input
            value={candidate.input.name}
            onChange={(event) => props.onChange((current) => ({
              ...current,
              input: { ...current.input, name: event.target.value },
            }))}
          />
        </Field>
        <Field label="Transport">
          <Select
            value={mcp.transport ?? 'streamable_http'}
            onValueChange={(value) => props.onChange((current) => ({
              ...current,
              input: {
                ...current.input,
                mcp: buildCandidateMcpForTransport(current, value as Exclude<McpFormMode, 'json'>),
              },
            }))}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="streamable_http">Streamable HTTP</SelectItem>
              <SelectItem value="stdio">Command</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {isRemote ? (
          <Field label="URL">
            <Input
              value={mcp.url ?? ''}
              onChange={(event) => props.onChange((current) => ({
                ...current,
                input: { ...current.input, mcp: { ...current.input.mcp, url: event.target.value } },
              }))}
            />
          </Field>
        ) : (
          <>
            <Field label="Command">
              <Input
                value={mcp.command ?? ''}
                onChange={(event) => props.onChange((current) => ({
                  ...current,
                  input: { ...current.input, mcp: { ...current.input.mcp, command: event.target.value } },
                }))}
              />
            </Field>
            <Field label="Args">
              <Textarea
                rows={3}
                value={(mcp.args ?? []).join('\n')}
                onChange={(event) => props.onChange((current) => ({
                  ...current,
                  input: { ...current.input, mcp: { ...current.input.mcp, args: parseListLines(event.target.value) ?? [] } },
                }))}
              />
            </Field>
          </>
        )}
        <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
          <span>Enabled</span>
          <Switch
            checked={candidate.input.enabled ?? true}
            onCheckedChange={(enabled) => props.onChange((current) => ({
              ...current,
              input: { ...current.input, enabled },
            }))}
          />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
          <span>Enable in workspace</span>
          <Switch
            checked={candidate.enableInWorkspace ?? true}
            onCheckedChange={(enableInWorkspace) => props.onChange((current) => ({
              ...current,
              enableInWorkspace,
            }))}
          />
        </label>
      </div>

      {candidate.secrets && candidate.secrets.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Secret handling</div>
          {candidate.secrets.map((secret) => (
            <div key={secret.id} className="grid grid-cols-1 gap-2 rounded-md bg-muted/40 p-2 text-xs sm:grid-cols-[1fr_auto]">
              <span>{secret.location}:{secret.name} = {secret.previewValue}</span>
              <Select
                value={secret.handling}
                onValueChange={(value) => props.onChange((current) => updateSecretHandling(current, secret.id, value as McpImportSecretHandling))}
              >
                <SelectTrigger className="h-7 w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="credential-store">Credential store</SelectItem>
                  <SelectItem value="config">Keep in config</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      )}

      {candidate.duplicate && (
        <div className="mt-3 space-y-2 rounded-md bg-muted/40 p-2 text-xs">
          <div>Duplicate of {candidate.duplicate.sourceName}: {candidate.duplicate.reasons.join(', ')}</div>
          <Select
            value={actionValue(candidate.action)}
            onValueChange={(value) => props.onChange((current) => ({
              ...current,
              action: parseActionValue(value, current.availableActions ?? [{ type: 'create' }, { type: 'skip' }]),
            }))}
          >
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(candidate.availableActions ?? []).map((action) => (
                <SelectItem key={actionValue(action)} value={actionValue(action)}>
                  {actionLabel(action)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {candidate.errors.length > 0 && (
        <FieldErrors fieldErrors={candidate.errors} />
      )}
    </section>
  )
}

function FieldErrors({ fieldErrors }: { fieldErrors: McpImportFieldError[] }) {
  return (
    <ul className="mt-2 space-y-1 text-xs text-destructive">
      {fieldErrors.map((fieldError, index) => (
        <li key={`${fieldError.field}:${index}`}>{fieldError.field}: {fieldError.message}</li>
      ))}
    </ul>
  )
}

function ImportResults({ result }: { result: McpImportBatchCreateResult }) {
  return (
    <div className="rounded-md border border-border/70 p-3 text-sm">
      <div className="mb-2 font-medium">Import results</div>
      <ul className="space-y-1">
        {result.results.map((item) => (
          <li key={item.key}>{formatImportResult(item)}</li>
        ))}
      </ul>
    </div>
  )
}

function formatImportResult(item: McpImportCreateResult): string {
  if (!item.success) {
    return `${item.key}: ${item.errors.map((error) => error.message).join(', ')}`
  }
  if ('skipped' in item) {
    return `${item.key}: skipped`
  }
  return `${item.key}: created ${item.sourceSlug}`
}

function actionValue(action: McpImportCandidateAction | undefined): string {
  if (!action) return 'create'
  return action.type === 'replace' ? `replace:${action.sourceSlug}` : action.type
}

function actionLabel(action: McpImportCandidateAction): string {
  if (action.type === 'create') return 'Create new source'
  if (action.type === 'replace') return 'Replace existing source'
  return 'Skip'
}

function parseActionValue(value: string, availableActions: McpImportCandidateAction[]): McpImportCandidateAction {
  return availableActions.find((action) => actionValue(action) === value) ?? { type: 'create' }
}

function updateSecretHandling(
  candidate: McpImportCandidate,
  secretId: string,
  handling: McpImportSecretHandling,
): McpImportCandidate {
  const secret = candidate.secrets?.find((item) => item.id === secretId)
  if (!secret) return candidate

  const previewValue = handling === 'config' ? secret.value : '••••••••'
  const secrets = (candidate.secrets ?? []).map((item) => (
    item.id === secretId ? { ...item, handling, previewValue } : item
  ))
  const mcp = { ...candidate.input.mcp }
  if (secret.location === 'env' && mcp.env) {
    mcp.env = { ...mcp.env, [secret.name]: previewValue }
  }
  if (secret.location === 'header' && mcp.headers) {
    mcp.headers = { ...mcp.headers, [secret.name]: previewValue }
  }
  return {
    ...candidate,
    secrets,
    input: {
      ...candidate.input,
      mcp,
    },
  }
}

function buildCandidateMcpForTransport(
  candidate: McpImportCandidate,
  transport: Exclude<McpFormMode, 'json'>,
): McpManualSourceInput['mcp'] {
  const current = candidate.input.mcp ?? {}
  if (transport === 'stdio') {
    return {
      transport,
      command: current.command,
      args: current.args,
      env: current.env,
    }
  }
  return {
    transport,
    url: current.url,
    authType: current.authType,
    clientId: current.clientId,
    headers: current.headers,
    headerNames: current.headerNames,
  }
}

function validateImportCandidate(candidate: McpImportCandidate): McpImportFieldError[] {
  const errors: McpImportFieldError[] = []
  const mcp = candidate.input.mcp
  if (!candidate.input.name.trim()) {
    errors.push({ field: 'name', message: 'MCP source name is required.' })
  }
  if (!mcp) {
    errors.push({ field: 'mcp', message: 'MCP config is required.' })
    return errors
  }
  if (mcp.transport === 'stdio') {
    if (!mcp.command?.trim()) {
      errors.push({ field: 'command', message: 'Stdio MCP servers require a command string.' })
    }
  } else if (mcp.transport === 'streamable_http' || !mcp.transport) {
    if (!mcp.url?.trim()) {
      errors.push({ field: 'url', message: 'Streamable HTTP MCP servers require a URL string.' })
    }
  } else {
    errors.push({ field: 'transport', message: 'Transport must be one of: stdio, streamable_http.' })
  }
  return errors
}

function CredentialConfiguredBadge() {
  const { t } = useTranslation()
  return (
    <span className="ml-2 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-success/10 text-success">
      <CheckCircle2 className="h-3 w-3" />
      {t('mcpForm.credentialConfigured')}
    </span>
  )
}

function RemoteFields(props: {
  url: string
  setUrl: (value: string) => void
  authType: McpFormAuthType
  setAuthType: (value: McpFormAuthType) => void
  bearerToken: string
  setBearerToken: (value: string) => void
  apiKeyHeader: string
  setApiKeyHeader: (value: string) => void
  apiKeyValue: string
  setApiKeyValue: (value: string) => void
  headersText: string
  setHeadersText: (value: string) => void
  /** When true, sensitive fields show a credential configured badge instead of pre-filled values */
  isEditMode?: boolean
  isAuthenticated?: boolean
}) {
  const { t } = useTranslation()
  return (
    <>
      <Field label="URL">
        <Input value={props.url} onChange={(event) => props.setUrl(event.target.value)} placeholder="https://example.com/mcp" />
      </Field>
      <Field label="Auth Type">
        <Select value={props.authType} onValueChange={(value) => props.setAuthType(value as McpFormAuthType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="oauth">OAuth</SelectItem>
            <SelectItem value="bearer">Bearer</SelectItem>
            <SelectItem value="api-key">API Key Header</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {props.authType === 'bearer' && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Bearer Token
            {props.isEditMode && props.isAuthenticated && !props.bearerToken && (
              <CredentialConfiguredBadge />
            )}
          </Label>
          <Input type="password" value={props.bearerToken} onChange={(event) => props.setBearerToken(event.target.value)} />
        </div>
      )}
      {props.authType === 'api-key' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Header Name">
            <Input value={props.apiKeyHeader} onChange={(event) => props.setApiKeyHeader(event.target.value)} />
          </Field>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Header Value
              {props.isEditMode && props.isAuthenticated && !props.apiKeyValue && (
                <CredentialConfiguredBadge />
              )}
            </Label>
            <Input type="password" value={props.apiKeyValue} onChange={(event) => props.setApiKeyValue(event.target.value)} />
          </div>
        </div>
      )}
      <Field label="Headers">
        <Textarea value={props.headersText} onChange={(event) => props.setHeadersText(event.target.value)} rows={4} placeholder="X-Custom-Header=value" />
      </Field>
    </>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

function parseListLines(value: string): string[] | undefined {
  const items = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return items.length > 0 ? items : undefined
}

function objectToLines(obj: Record<string, string> | undefined): string {
  return obj ? Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n') : ''
}

function parseKeyValueLines(value: string): Record<string, string> | undefined {
  const entries = value.split(/\r?\n/).map((line) => {
    const separator = line.indexOf('=')
    if (separator < 0) return null
    const key = line.slice(0, separator).trim()
    const itemValue = line.slice(separator + 1).trim()
    return key ? [key, itemValue] as const : null
  }).filter((entry): entry is readonly [string, string] => entry !== null)
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function buildMcpPayload(
  mode: Exclude<McpFormMode, 'json'>,
  values: {
    url: string
    authType: McpFormAuthType
    headersText: string
    command: string
    argsText: string
    envText: string
  },
): McpManualSourceInput['mcp'] {
  if (mode === 'stdio') {
    return {
      transport: 'stdio',
      command: values.command.trim(),
      args: parseListLines(values.argsText),
      env: parseKeyValueLines(values.envText),
    }
  }

  return {
    transport: mode,
    url: values.url.trim(),
    authType: values.authType === 'oauth' || values.authType === 'bearer' ? values.authType : 'none',
    headers: parseKeyValueLines(values.headersText),
  }
}

function buildAuthCredential(
  authType: McpFormAuthType,
  bearerToken: string,
  apiKeyHeader: string,
  apiKeyValue: string,
): McpManualAuthCredentialInput | undefined {
  if (authType === 'bearer' && bearerToken.trim()) {
    return { kind: 'bearer', value: bearerToken.trim() }
  }
  if (authType === 'api-key' && apiKeyHeader.trim() && apiKeyValue.trim()) {
    return { kind: 'api-key', headerName: apiKeyHeader.trim(), value: apiKeyValue.trim() }
  }
  return undefined
}
