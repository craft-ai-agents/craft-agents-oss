import * as React from 'react'
import { CheckCircle2, ExternalLink, Info, KeyRound, Loader2, Plus, RefreshCcw, Trash2, WalletCards } from 'lucide-react'
import { toast } from 'sonner'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { SettingsCard, SettingsMenuSelect, SettingsSection } from '@/components/settings'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { UserSecretSummary, ZeroStatus } from '../../../shared/types'
import { useAppShellContext } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'secrets',
}

type SecretPreset = {
  group: string
  name: string
  label: string
  description: string
  placeholder?: string
  storage: 'env' | 'source' | 'managed-source'
  sourceSlug?: string
  sourceType?: 'api' | 'mcp' | 'local'
}

const SECRET_PRESETS: SecretPreset[] = [
  {
    group: 'Ads',
    name: 'META_ADS_OAUTH',
    label: 'Meta Ads credential',
    description: 'Managed by the Meta Ads source OAuth flow. Connect it from Tools/Sources, not by pasting a token here.',
    storage: 'managed-source',
    sourceSlug: 'meta-ads',
    sourceType: 'mcp',
  },
  {
    group: 'Ads',
    name: 'GOOGLE_ADS_OAUTH',
    label: 'Google Ads credential',
    description: 'Managed by the Google Ads source setup because it also needs a developer token and optional login customer ID.',
    storage: 'managed-source',
    sourceSlug: 'google-ads',
    sourceType: 'local',
  },
  {
    group: 'Research',
    name: 'YOUTUBE_API_KEY',
    label: 'YouTube Data API key',
    description: 'Saved into the YouTube Research source so source status and the bundled wrapper credential cache stay in sync.',
    placeholder: 'AIza...',
    storage: 'source',
    sourceSlug: 'youtube-research',
    sourceType: 'local',
  },
  {
    group: 'Commerce',
    name: 'SHOPIFY_SHOP',
    label: 'Shopify shop domain',
    description: 'Required by Shopify Agent. Example: mystore.myshopify.com.',
    placeholder: 'mystore.myshopify.com',
    storage: 'env',
  },
  {
    group: 'Commerce',
    name: 'SHOPIFY_ACCESS_TOKEN',
    label: 'Shopify access token',
    description: 'Required by Shopify Agent. Use a custom app token with only needed scopes.',
    placeholder: 'shpat_...',
    storage: 'env',
  },
  {
    group: 'Commerce',
    name: 'SHOPIFY_STORE_DOMAIN',
    label: 'Shopify store domain alias',
    description: 'Alternate name accepted by Shopify tooling. Use this or SHOPIFY_SHOP.',
    placeholder: 'mystore.myshopify.com',
    storage: 'env',
  },
  {
    group: 'Commerce',
    name: 'SHOPIFY_API_VERSION',
    label: 'Shopify API version',
    description: 'Optional. Defaults to 2026-04 when unset.',
    placeholder: '2026-04',
    storage: 'env',
  },
  {
    group: 'Commerce',
    name: 'PRINTIFY_API_TOKEN',
    label: 'Printify API token',
    description: 'Required by Print Agent / Printify source.',
    placeholder: 'Printify token',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'LLM_API_KEY',
    label: 'Generic CLI LLM API key',
    description: 'Fallback for craft-cli run when a provider-specific key is not set.',
    placeholder: 'provider API key',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'OPENAI_API_KEY',
    label: 'OpenAI API key',
    description: 'Generic OpenAI-compatible tooling fallback. LLM connections still have their own credential setup.',
    placeholder: 'sk-...',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'ANTHROPIC_API_KEY',
    label: 'Anthropic API key',
    description: 'Generic Anthropic fallback. Prefer AI settings for main chat connection setup.',
    placeholder: 'sk-ant-...',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'OPENROUTER_API_KEY',
    label: 'OpenRouter API key',
    description: 'Used by OpenRouter-compatible local tools and env fallback credential lookup.',
    placeholder: 'sk-or-...',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'GOOGLE_API_KEY',
    label: 'Google AI API key',
    description: 'Provider alias used by CLI, MCP sandbox env, and Google/Gemini env fallback lookup.',
    placeholder: 'AIza...',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'GEMINI_API_KEY',
    label: 'Gemini API key',
    description: 'Used by Google/Gemini-compatible tools and ad creative generation references.',
    placeholder: 'AIza...',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'DEEPSEEK_API_KEY',
    label: 'DeepSeek API key',
    description: 'Provider alias used by CLI and LLM credential fallback lookup.',
    placeholder: 'sk-...',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'KIMI_API_KEY',
    label: 'Kimi API key',
    description: 'Provider alias used by LLM credential fallback lookup.',
    placeholder: 'Kimi key',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'QWEN_API_KEY',
    label: 'Qwen API key',
    description: 'Provider alias used by LLM credential fallback lookup.',
    placeholder: 'Qwen key',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'ASSEMBLYAI_API_KEY',
    label: 'AssemblyAI API key',
    description: 'Used by speech transcription and audio intelligence workflows.',
    placeholder: 'AssemblyAI key',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'ELEVENLABS_API_KEY',
    label: 'ElevenLabs API key',
    description: 'Used by voice/TTS workflows and env fallback source lookup.',
    placeholder: 'ElevenLabs key',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'INWORLD_API_KEY',
    label: 'Inworld API key',
    description: 'Used by voice/TTS workflows and env fallback source lookup.',
    placeholder: 'Inworld key',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'INWORLD_RUNTIME_KEY',
    label: 'Inworld runtime key',
    description: 'Used by Inworld runtime voice and character workflows.',
    placeholder: 'Inworld runtime key',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'HEYGEN_API_KEY',
    label: 'HeyGen API key',
    description: 'Generic HeyGen key. Squad also supports SQUAD_HEYGEN_API_KEY for isolated Video Director credentials.',
    placeholder: 'HeyGen API key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'SQUAD_OPENAI_API_KEY',
    label: 'Squad OpenAI API key',
    description: 'Optional isolated OpenAI key for Squad director decisions, image prompts, and image evaluation.',
    placeholder: 'sk-...',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'SQUAD_FAL_API_KEY',
    label: 'Squad Fal API key',
    description: 'Required by Squad image generation and used as the Fal video fallback provider.',
    placeholder: 'fal key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'SQUAD_WAVESPEED_API_KEY',
    label: 'Squad WaveSpeed API key',
    description: 'Primary Squad full-production video provider key.',
    placeholder: 'WaveSpeed key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'WAVESPEED_API_KEY',
    label: 'WaveSpeed API key',
    description: 'Generic WaveSpeed fallback accepted by Squad video smoke and production checks.',
    placeholder: 'WaveSpeed key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'SQUAD_HEYGEN_API_KEY',
    label: 'Squad HeyGen API key',
    description: 'Isolated HeyGen key for Squad UGC/avatar video generation.',
    placeholder: 'HeyGen API key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'SQUAD_HEYGEN_AVATAR_ID',
    label: 'Squad HeyGen avatar ID',
    description: 'Required with the HeyGen key for Squad talking-head/avatar video runs.',
    placeholder: 'avatar id',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'SQUAD_HEYGEN_VOICE_ID',
    label: 'Squad HeyGen voice ID',
    description: 'Required with the HeyGen key for Squad talking-head/avatar video runs.',
    placeholder: 'voice id',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'SQUAD_HEYGEN_PERSONA_MAP_JSON',
    label: 'Squad HeyGen persona map',
    description: 'Optional JSON map for selecting HeyGen avatar and voice IDs by persona.',
    placeholder: '{"persona":{"avatar_id":"...","voice_id":"..."}}',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'SQUAD_FISH_TTS_API_KEY',
    label: 'Squad Fish Audio API key',
    description: 'Optional isolated Fish Audio/Fish TTS key for Squad voiceover generation.',
    placeholder: 'Fish Audio key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'FISH_AUDIO_API_KEY',
    label: 'Fish Audio API key',
    description: 'Generic Fish Audio fallback accepted by Squad TTS.',
    placeholder: 'Fish Audio key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'SQUAD_FISH_TTS_REFERENCE_ID',
    label: 'Squad Fish voice reference ID',
    description: 'Optional Fish TTS reference or voice ID for Squad voiceover generation.',
    placeholder: 'reference id',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'SQUAD_INWORLD_TTS_API_KEY',
    label: 'Squad Inworld TTS API key',
    description: 'Optional isolated Inworld TTS key for Squad voiceover generation.',
    placeholder: 'Inworld TTS key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'INWORLD_TTS_API_KEY',
    label: 'Inworld TTS API key',
    description: 'Generic Inworld TTS fallback accepted by Squad voiceover generation.',
    placeholder: 'Inworld TTS key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'SQUAD_INWORLD_TTS_VOICE_ID',
    label: 'Squad Inworld voice ID',
    description: 'Optional Inworld voice ID for Squad voiceover generation.',
    placeholder: 'voice id',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'MUAPI_API_KEY',
    label: 'MuAPI API key',
    description: 'Used by Squad MuAPI workflow execution tools.',
    placeholder: 'MuAPI key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'RUNPOD_API_KEY',
    label: 'RunPod API key',
    description: 'Used by Squad RunPod/LTX video benchmark and hosted worker flows.',
    placeholder: 'RunPod key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'RUNPOD_LTX_ENDPOINT_ID',
    label: 'RunPod LTX endpoint ID',
    description: 'Required with RUNPOD_API_KEY for Squad RunPod/LTX video runs.',
    placeholder: 'endpoint id',
    storage: 'env',
  },
  {
    group: 'Dev / Cloud',
    name: 'GITHUB_TOKEN',
    label: 'GitHub token',
    description: 'Common GitHub token for CLI, MCP, and automation tooling.',
    placeholder: 'ghp_...',
    storage: 'env',
  },
  {
    group: 'Dev / Cloud',
    name: 'GH_TOKEN',
    label: 'GitHub CLI token',
    description: 'GitHub CLI-compatible token alias used by some local tools.',
    placeholder: 'ghp_...',
    storage: 'env',
  },
  {
    group: 'Dev / Cloud',
    name: 'STRIPE_SECRET_KEY',
    label: 'Stripe secret key',
    description: 'Stripe API key for tools that need direct Stripe API access. Webhook secrets stay under Automation.',
    placeholder: 'sk_live_...',
    storage: 'env',
  },
  {
    group: 'Dev / Cloud',
    name: 'AWS_ACCESS_KEY_ID',
    label: 'AWS access key ID',
    description: 'Used by CLI object storage and cloud tooling.',
    placeholder: 'AKIA...',
    storage: 'env',
  },
  {
    group: 'Dev / Cloud',
    name: 'AWS_SECRET_ACCESS_KEY',
    label: 'AWS secret access key',
    description: 'Used with AWS_ACCESS_KEY_ID by CLI object storage and cloud tooling.',
    placeholder: 'AWS secret',
    storage: 'env',
  },
  {
    group: 'Dev / Cloud',
    name: 'AWS_SESSION_TOKEN',
    label: 'AWS session token',
    description: 'Optional temporary AWS session token for short-lived credentials.',
    placeholder: 'AWS session token',
    storage: 'env',
  },
  {
    group: 'Dev / Cloud',
    name: 'NPM_TOKEN',
    label: 'npm token',
    description: 'Used by package publish and registry automation tooling.',
    placeholder: 'npm_...',
    storage: 'env',
  },
  {
    group: 'Dev / Cloud',
    name: 'STITCH_API_KEY',
    label: 'Stitch API key',
    description: 'Used by the bundled stitch-mcp source validation flow.',
    placeholder: 'Stitch API key',
    storage: 'env',
  },
  {
    group: 'MCP / Apps',
    name: 'BRAVE_API_KEY',
    label: 'Brave Search API key',
    description: 'Used by the documented Brave Search MCP server env config.',
    placeholder: 'Brave Search key',
    storage: 'env',
  },
  {
    group: 'MCP / Apps',
    name: 'CANVA_CLIENT_ID',
    label: 'Canva client ID',
    description: 'Optional Canva integration credential when not using ~/.config/runneros/canva/integration.json.',
    placeholder: 'Canva client ID',
    storage: 'env',
  },
  {
    group: 'MCP / Apps',
    name: 'CANVA_CLIENT_SECRET',
    label: 'Canva client secret',
    description: 'Optional Canva integration credential when not using ~/.config/runneros/canva/integration.json.',
    placeholder: 'Canva client secret',
    storage: 'env',
  },
  {
    group: 'Automation',
    name: 'CRAFT_WH_SIGNED_HOOK_SECRET',
    label: 'Webhook signing secret',
    description: 'Use for signed inbound webhook automations. Rename if a specific automation expects another CRAFT_WH_* name.',
    placeholder: 'shared signing secret',
    storage: 'env',
  },
  {
    group: 'Automation',
    name: 'CRAFT_WH_GITHUB_SECRET',
    label: 'GitHub webhook secret',
    description: 'Used by the built-in GitHub external trigger template.',
    placeholder: 'GitHub webhook secret',
    storage: 'env',
  },
  {
    group: 'Automation',
    name: 'CRAFT_WH_STRIPE_SECRET',
    label: 'Stripe webhook secret',
    description: 'Used by the built-in Stripe external trigger template.',
    placeholder: 'whsec_...',
    storage: 'env',
  },
  {
    group: 'Automation',
    name: 'CRAFT_WH_API_TOKEN',
    label: 'Webhook API token',
    description: 'Common bearer token used by webhook action templates.',
    placeholder: 'API token',
    storage: 'env',
  },
  {
    group: 'Automation',
    name: 'CRAFT_WH_SLACK_URL',
    label: 'Slack webhook URL',
    description: 'Common webhook URL used by automation examples and session notification templates.',
    placeholder: 'https://hooks.slack.com/services/...',
    storage: 'env',
  },
  {
    group: 'Automation',
    name: 'CRAFT_WH_CLIENT_ID',
    label: 'Webhook OAuth client ID',
    description: 'Common OAuth client ID used by webhook action templates.',
    placeholder: 'client ID',
    storage: 'env',
  },
  {
    group: 'Automation',
    name: 'CRAFT_WH_CLIENT_SECRET',
    label: 'Webhook OAuth client secret',
    description: 'Common OAuth client secret used by webhook action templates.',
    placeholder: 'client secret',
    storage: 'env',
  },
  {
    group: 'Zero',
    name: 'ZERO_PRIVATE_KEY',
    label: 'Zero wallet private key',
    description: 'Used by Zero CLI before falling back to ~/.zero/config.json.',
    placeholder: '0x...',
    storage: 'env',
  },
]

const SECRET_GROUPS = Array.from(new Set(SECRET_PRESETS.map((preset) => preset.group)))

export default function SecretsSettingsPage() {
  const { activeWorkspaceId } = useAppShellContext()
  const [secrets, setSecrets] = React.useState<UserSecretSummary[]>([])
  const [zero, setZero] = React.useState<ZeroStatus | null>(null)
  const [name, setName] = React.useState('')
  const [value, setValue] = React.useState('')
  const [selectedGroup, setSelectedGroup] = React.useState(SECRET_GROUPS[0] ?? '')
  const [selectedPresetName, setSelectedPresetName] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [installing, setInstalling] = React.useState(false)

  const groupPresets = React.useMemo(
    () => SECRET_PRESETS.filter((preset) => preset.group === selectedGroup),
    [selectedGroup],
  )
  const selectedPreset = React.useMemo(
    () => SECRET_PRESETS.find((preset) => preset.name === selectedPresetName) ?? null,
    [selectedPresetName],
  )
  const isSourcePreset = selectedPreset?.storage === 'source'
  const isManagedSourcePreset = selectedPreset?.storage === 'managed-source'

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
    if (isManagedSourcePreset) {
      openSelectedSource()
      return
    }

    if (isSourcePreset) {
      if (!activeWorkspaceId || !selectedPreset?.sourceSlug) {
        toast.error('Select an active workspace before saving this source credential')
        return
      }
      await window.electronAPI.saveSourceCredentials(activeWorkspaceId, selectedPreset.sourceSlug, value)
      setValue('')
      toast.success(`${selectedPreset.label} saved`)
      await load()
      return
    }

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

  const applyPreset = (presetName: string) => {
    const preset = SECRET_PRESETS.find((candidate) => candidate.name === presetName)
    setSelectedPresetName(presetName)
    if (!preset) return
    setName(preset.storage === 'env' ? preset.name : '')
    setValue('')
  }

  const openSelectedSource = () => {
    if (!selectedPreset?.sourceSlug) return
    if (selectedPreset.sourceType === 'mcp') {
      navigate(routes.view.sourcesMcp(selectedPreset.sourceSlug))
    } else if (selectedPreset.sourceType === 'api') {
      navigate(routes.view.sourcesApi(selectedPreset.sourceSlug))
    } else {
      navigate(routes.view.sourcesLocal(selectedPreset.sourceSlug))
    }
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
              <div className="grid gap-4 p-4 lg:grid-cols-[180px_minmax(260px,1fr)]">
                <SettingsMenuSelect
                  value={selectedGroup}
                  onValueChange={(nextGroup) => {
                    setSelectedGroup(nextGroup)
                    setSelectedPresetName('')
                    setName('')
                    setValue('')
                  }}
                  options={SECRET_GROUPS.map((group) => ({ value: group, label: group }))}
                  placeholder="Category"
                  menuWidth={220}
                  className="h-9 w-full"
                />
                <SettingsMenuSelect
                  value={selectedPresetName}
                  onValueChange={applyPreset}
                  options={groupPresets.map((preset) => ({
                    value: preset.name,
                    label: preset.label,
                    description: preset.storage === 'managed-source'
                      ? 'OAuth / source setup'
                      : preset.storage === 'source'
                        ? 'Source credential'
                        : preset.name,
                  }))}
                  placeholder="Choose credential..."
                  menuWidth={360}
                  className="h-9 w-full"
                />
                {selectedPreset && (
                  <div className="flex gap-2 rounded-md border border-white/[0.06] bg-white/[0.025] p-3 text-xs text-white/45 lg:col-span-2">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/35" />
                    <div>
                      <div className="font-medium text-white/68">
                        {selectedPreset.storage === 'managed-source'
                          ? 'Managed credential'
                          : selectedPreset.storage === 'source'
                            ? 'Source credential'
                            : selectedPreset.name}
                      </div>
                      <div className="mt-1 leading-5">{selectedPreset.description}</div>
                      {selectedPreset.sourceSlug && (
                        <Button variant="outline" size="sm" className="mt-3" onClick={openSelectedSource}>
                          <ExternalLink className="mr-2 h-3.5 w-3.5" />
                          Open source setup
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </SettingsCard>

            <SettingsCard>
              <div className="grid gap-3 p-4 md:grid-cols-[minmax(180px,240px)_1fr_auto]">
                <input
                  value={isSourcePreset ? selectedPreset?.label ?? '' : name}
                  onChange={(event) => setName(event.target.value.toUpperCase())}
                  placeholder={selectedPreset && selectedPreset.storage === 'env' ? selectedPreset.name : 'ZERO_PRIVATE_KEY'}
                  disabled={isSourcePreset || isManagedSourcePreset}
                  className="h-9 rounded-md border border-white/10 bg-black/20 px-3 text-sm outline-none placeholder:text-white/25 disabled:opacity-60"
                />
                <input
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder={selectedPreset && selectedPreset.storage !== 'managed-source' ? selectedPreset.placeholder ?? 'Secret value' : 'Open source setup to connect'}
                  type="password"
                  disabled={isManagedSourcePreset}
                  className="h-9 rounded-md border border-white/10 bg-black/20 px-3 text-sm outline-none placeholder:text-white/25 disabled:opacity-60"
                />
                <Button
                  size="sm"
                  onClick={save}
                  disabled={isManagedSourcePreset ? !selectedPreset?.sourceSlug : isSourcePreset ? !value : !name.trim() || !value}
                >
                  {isManagedSourcePreset ? <ExternalLink className="mr-2 h-3.5 w-3.5" /> : <Plus className="mr-2 h-3.5 w-3.5" />}
                  {isManagedSourcePreset ? 'Open' : 'Save'}
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
