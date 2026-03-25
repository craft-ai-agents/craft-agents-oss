import { HardDrive, Server } from "lucide-react"
import { SettingsSegmentedControl } from "@/components/settings"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { RemoteServerProfile } from "../../../shared/types"
import type { SettingsSegmentedOption } from "@/components/settings/SettingsSegmentedControl"

interface WorkspaceTargetSelectorProps {
  targetMode: 'local' | 'remote'
  onTargetModeChange: (mode: 'local' | 'remote') => void
  remoteServers: RemoteServerProfile[]
  selectedServerId: string | null
  onSelectedServerIdChange: (serverId: string | null) => void
  allowLocalTarget?: boolean
  connectedRemoteName?: string | null
  connectedRemoteUrl?: string | null
  disabled?: boolean
}

export function WorkspaceTargetSelector({
  targetMode,
  onTargetModeChange,
  remoteServers,
  selectedServerId,
  onSelectedServerIdChange,
  allowLocalTarget = true,
  connectedRemoteName,
  connectedRemoteUrl,
  disabled = false,
}: WorkspaceTargetSelectorProps) {
  const selectedServer = remoteServers.find((server) => server.id === selectedServerId) ?? null
  const remoteOnly = !allowLocalTarget
  const showConnectedRemote = remoteOnly && targetMode === 'remote' && !selectedServer && remoteServers.length === 0
  const targetOptions: SettingsSegmentedOption<'local' | 'remote'>[] = [
    ...(allowLocalTarget
      ? [{ value: 'local', label: 'Local', icon: <HardDrive className="h-3.5 w-3.5" /> } satisfies SettingsSegmentedOption<'local' | 'remote'>]
      : []),
    { value: 'remote', label: 'Remote', icon: <Server className="h-3.5 w-3.5" /> } satisfies SettingsSegmentedOption<'local' | 'remote'>,
  ]

  return (
    <div className="w-full space-y-3 rounded-2xl border border-border/50 bg-muted/35 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">Workspace target</div>
          <p className="mt-1 text-xs text-muted-foreground">
            {targetMode === 'remote'
              ? 'Create or open this workspace on a configured server.'
              : 'Create or open this workspace on this device.'
            }
          </p>
        </div>
        <SettingsSegmentedControl
          value={targetMode}
          onValueChange={onTargetModeChange}
          size="sm"
          className="shrink-0 rounded-xl bg-background/80 p-1 shadow-minimal"
          options={targetOptions}
        />
      </div>

      <div className="min-h-[88px] space-y-1.5">
        <label className="block text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {targetMode === 'remote' ? 'Server' : 'Location'}
        </label>

        {targetMode === 'remote' ? (
          <>
            {showConnectedRemote ? (
              <>
                <div className="flex h-9 w-full items-center rounded-md border border-foreground/15 bg-background/80 px-3 text-sm shadow-minimal">
                  {connectedRemoteName ?? 'Connected server'}
                </div>
                <p className="truncate pl-1 text-xs text-muted-foreground">
                  {connectedRemoteUrl ?? 'The currently connected remote server.'}
                </p>
              </>
            ) : (
              <>
                <Select
                  value={selectedServerId ?? ''}
                  onValueChange={(value) => onSelectedServerIdChange(value || null)}
                  disabled={disabled || remoteServers.length === 0}
                >
                  <SelectTrigger className="w-full bg-background/80 shadow-minimal">
                    <SelectValue placeholder="Select a remote server" />
                  </SelectTrigger>
                  <SelectContent>
                    {remoteServers.map((server) => (
                      <SelectItem key={server.id} value={server.id}>{server.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedServer ? (
                  <p className="truncate pl-1 text-xs text-muted-foreground">
                    {selectedServer.url}
                  </p>
                ) : remoteServers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No enabled remote servers with tokens are available yet. Add one in Settings.
                  </p>
                ) : (
                  <p className="pl-1 text-xs text-muted-foreground">
                    Choose the server where this workspace should live.
                  </p>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <div className="flex h-9 w-full items-center rounded-md border border-foreground/15 bg-background/80 px-3 text-sm shadow-minimal">
              This device
            </div>
            <p className="pl-1 text-xs text-muted-foreground">
              Workspaces and sessions stay on your current machine.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
