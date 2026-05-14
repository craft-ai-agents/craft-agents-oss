import * as React from 'react'
import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
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
import type { McpManualAuthCredentialInput, McpTransport } from '@craft-agent/shared/sources'

type McpFormMode = 'http' | 'sse' | 'stdio'
type McpFormAuthType = 'none' | 'oauth' | 'bearer' | 'api-key'

interface McpSourceFormDialogProps {
  workspaceId: string
  trigger: ReactNode
}

export function McpSourceFormDialog({ workspaceId, trigger }: McpSourceFormDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [mode, setMode] = React.useState<McpFormMode>('http')
  const [name, setName] = React.useState('')
  const [provider, setProvider] = React.useState('')
  const [icon, setIcon] = React.useState('')
  const [enabled, setEnabled] = React.useState(true)
  const [url, setUrl] = React.useState('')
  const [authType, setAuthType] = React.useState<McpFormAuthType>('none')
  const [bearerToken, setBearerToken] = React.useState('')
  const [apiKeyHeader, setApiKeyHeader] = React.useState('X-API-Key')
  const [apiKeyValue, setApiKeyValue] = React.useState('')
  const [headersText, setHeadersText] = React.useState('')
  const [command, setCommand] = React.useState('')
  const [argsText, setArgsText] = React.useState('')
  const [envText, setEnvText] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const isRemote = mode === 'http' || mode === 'sse'
  const canSubmit = name.trim() && provider.trim() && (isRemote ? url.trim() : command.trim())

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSubmit || isSubmitting) return

    setIsSubmitting(true)
    setError(null)
    try {
      const authCredential = buildAuthCredential(authType, bearerToken, apiKeyHeader, apiKeyValue)
      await window.electronAPI.createSource(workspaceId, {
        name: name.trim(),
        provider: provider.trim(),
        type: 'mcp',
        enabled,
        icon: icon.trim() || undefined,
        mcp: isRemote
          ? {
              transport: mode as McpTransport,
              url: url.trim(),
              authType: authType === 'oauth' || authType === 'bearer' ? authType : 'none',
              headers: parseKeyValueLines(headersText),
            }
          : {
              transport: 'stdio',
              command: command.trim(),
              args: parseListLines(argsText),
              env: parseKeyValueLines(envText),
            },
        authCredential,
      })
      resetForm()
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetForm = () => {
    setMode('http')
    setName('')
    setProvider('')
    setIcon('')
    setEnabled(true)
    setUrl('')
    setAuthType('none')
    setBearerToken('')
    setApiKeyHeader('X-API-Key')
    setApiKeyValue('')
    setHeadersText('')
    setCommand('')
    setArgsText('')
    setEnvText('')
    setError(null)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Add MCP Server</DialogTitle>
            <DialogDescription>Create a remote or command-based MCP source.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Field label="Name">
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Linear" required />
            </Field>
            <Field label="Provider">
              <Input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="linear" required />
            </Field>
            <Field label="Icon">
              <Input className="w-20" value={icon} onChange={(event) => setIcon(event.target.value)} placeholder="icon" />
            </Field>
          </div>

          <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
            <span>Enabled</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </label>

          <Tabs value={mode} onValueChange={(value) => setMode(value as McpFormMode)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="http">HTTP</TabsTrigger>
              <TabsTrigger value="sse">SSE</TabsTrigger>
              <TabsTrigger value="stdio">Command</TabsTrigger>
            </TabsList>

            <TabsContent value="http" className="space-y-4">
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
              />
            </TabsContent>

            <TabsContent value="sse" className="space-y-4">
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
              />
            </TabsContent>

            <TabsContent value="stdio" className="space-y-4">
              <Field label="Command">
                <Input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="npx" />
              </Field>
              <Field label="Args">
                <Textarea value={argsText} onChange={(event) => setArgsText(event.target.value)} rows={4} placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;/path with spaces" />
              </Field>
              <Field label="Env">
                <Textarea value={envText} onChange={(event) => setEnvText(event.target.value)} rows={4} placeholder="API_TOKEN=..." />
              </Field>
            </TabsContent>
          </Tabs>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
}) {
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
        <Field label="Bearer Token">
          <Input type="password" value={props.bearerToken} onChange={(event) => props.setBearerToken(event.target.value)} />
        </Field>
      )}
      {props.authType === 'api-key' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Header Name">
            <Input value={props.apiKeyHeader} onChange={(event) => props.setApiKeyHeader(event.target.value)} />
          </Field>
          <Field label="Header Value">
            <Input type="password" value={props.apiKeyValue} onChange={(event) => props.setApiKeyValue(event.target.value)} />
          </Field>
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
