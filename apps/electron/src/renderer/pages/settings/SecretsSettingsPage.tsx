import * as React from 'react'
import { CheckCircle2, KeyRound, Loader2, Plus, RefreshCcw, Trash2, WalletCards } from 'lucide-react'
import { toast } from 'sonner'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { SettingsCard, SettingsSection } from '@/components/settings'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { UserSecretSummary, ZeroStatus } from '../../../shared/types'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'secrets',
}

export default function SecretsSettingsPage() {
  const [secrets, setSecrets] = React.useState<UserSecretSummary[]>([])
  const [zero, setZero] = React.useState<ZeroStatus | null>(null)
  const [name, setName] = React.useState('')
  const [value, setValue] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [installing, setInstalling] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [secretRows, zeroStatus] = await Promise.all([
        window.electronAPI.listSecrets(),
        window.electronAPI.getZeroStatus(),
      ])
      setSecrets(secretRows)
      setZero(zeroStatus)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    const result = await window.electronAPI.saveSecret(name, value)
    if (!result.success) {
      toast.error(result.error || 'Could not save secret')
      return
    }
    setName('')
    setValue('')
    toast.success('Secret saved')
    await load()
  }

  const remove = async (secretName: string) => {
    await window.electronAPI.deleteSecret(secretName)
    toast.success('Secret deleted')
    await load()
  }

  const installZero = async () => {
    setInstalling(true)
    try {
      const result = await window.electronAPI.installZero()
      if (!result.success) {
        toast.error(result.error || 'Zero install failed')
        return
      }
      toast.success('Zero installed')
      await load()
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Secrets" />
      <ScrollArea className="flex-1">
        <div className="space-y-6 p-6">
          <SettingsSection title="Zero">
            <SettingsCard>
              <div className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <WalletCards className="h-4 w-4 text-white/55" />
                    Zero CLI
                  </div>
                  <div className="mt-2 grid gap-1 text-xs text-white/45">
                    <span>{zero?.installed ? `Installed${zero.version ? ` · ${zero.version}` : ''}` : 'Not installed'}</span>
                    {zero?.path && <span className="truncate">{zero.path}</span>}
                    <span>{zero?.walletConfigured ? 'Wallet ready' : 'Wallet missing'}</span>
                    {zero?.balance && <span className="truncate">{zero.balance}</span>}
                    {zero?.error && <span className="text-amber-300/80">{zero.error}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                  </Button>
                  {!zero?.installed && (
                    <Button size="sm" onClick={installZero} disabled={installing}>
                      {installing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                      Install
                    </Button>
                  )}
                </div>
              </div>
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title="Environment Secrets">
            <SettingsCard>
              <div className="grid gap-3 p-4 md:grid-cols-[minmax(180px,240px)_1fr_auto]">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value.toUpperCase())}
                  placeholder="ZERO_PRIVATE_KEY"
                  className="h-9 rounded-md border border-white/10 bg-black/20 px-3 text-sm outline-none placeholder:text-white/25"
                />
                <input
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder="Secret value"
                  type="password"
                  className="h-9 rounded-md border border-white/10 bg-black/20 px-3 text-sm outline-none placeholder:text-white/25"
                />
                <Button size="sm" onClick={save} disabled={!name.trim() || !value}>
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Save
                </Button>
              </div>
            </SettingsCard>

            <SettingsCard>
              <div className="divide-y divide-white/[0.06]">
                {secrets.length === 0 ? (
                  <div className="p-4 text-sm text-white/38">No secrets saved.</div>
                ) : secrets.map((secret) => (
                  <div key={secret.name} className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <KeyRound className="h-3.5 w-3.5 text-white/45" />
                        <span>{secret.name}</span>
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400/80" />
                      </div>
                      <div className="mt-1 text-xs text-white/35">{secret.maskedValue}</div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => remove(secret.name)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </SettingsCard>
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  )
}
