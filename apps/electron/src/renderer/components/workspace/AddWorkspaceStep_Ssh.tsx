import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { ArrowLeft, Plus, Server, Pencil, Trash2, Download, Loader2, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "../ui/input"
import {
  AddWorkspaceContainer,
  AddWorkspaceStepHeader,
  AddWorkspacePrimaryButton,
  AddWorkspaceSecondaryButton,
} from "./primitives"
import { prepareRemoteWorkspace } from "./remote-workspace-create"
import { DEFAULT_SSH_PORT, DEFAULT_REMOTE_SERVER_PORT } from "../../../shared/types"
import type {
  SshHostConfig,
  SshHostInput,
  SshConfigImportSuggestion,
  SshBootstrapPhase,
} from "../../../shared/types"

interface AddWorkspaceStep_SshProps {
  onBack: () => void
  /** Programmatic workspace creation — the happy-path completion. */
  onCreate: (
    folderPath: string,
    name: string,
    remoteServer: { url: string; token: string; remoteWorkspaceId: string; sshHostId?: string },
  ) => Promise<void>
}

/** Ordered bootstrap phases we surface as a progress list. */
const PROGRESS_STEPS: SshBootstrapPhase[] = [
  "checking-server",
  "detecting-os",
  "building-server",
  "uploading-server",
  "installing-server",
  "starting-server",
  "waiting-for-server",
  "connecting-tunnel",
  "creating-workspace",
]

const EMPTY_FORM: SshHostInput = {
  label: "",
  host: "",
  user: "",
  identityFile: "",
}

export function AddWorkspaceStep_Ssh({ onBack, onCreate }: AddWorkspaceStep_SshProps) {
  const { t } = useTranslation()
  const [hosts, setHosts] = useState<SshHostConfig[]>([])
  const [editing, setEditing] = useState<SshHostConfig | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<SshHostInput>(EMPTY_FORM)
  const [portStr, setPortStr] = useState(String(DEFAULT_SSH_PORT))
  const [remotePortStr, setRemotePortStr] = useState(String(DEFAULT_REMOTE_SERVER_PORT))
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<SshConfigImportSuggestion[]>([])
  // One-click bootstrap state for the host currently being connected.
  const [bootstrapping, setBootstrapping] = useState<{
    hostId: string
    hostLabel: string
    phase: SshBootstrapPhase
    detail?: string
  } | null>(null)

  const refresh = useCallback(async () => {
    setHosts(await window.electronAPI.sshListHosts())
  }, [])

  useEffect(() => {
    void refresh()
    const offProgress = window.electronAPI.onSshBootstrapProgress((p) => {
      setBootstrapping((prev) =>
        prev && prev.hostId === p.hostId ? { ...prev, phase: p.phase, detail: p.detail } : prev,
      )
    })
    return () => {
      offProgress()
    }
  }, [refresh])

  const openAddForm = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setPortStr(String(DEFAULT_SSH_PORT))
    setRemotePortStr(String(DEFAULT_REMOTE_SERVER_PORT))
    setShowForm(true)
  }

  const openEditForm = (host: SshHostConfig) => {
    setEditing(host)
    setForm({
      label: host.label,
      host: host.host,
      user: host.user,
      identityFile: host.identityFile ?? "",
    })
    setPortStr(String(host.port))
    setRemotePortStr(String(host.remotePort))
    setShowForm(true)
  }

  const saveForm = async () => {
    const payload: SshHostInput = {
      ...form,
      port: parseInt(portStr, 10) || DEFAULT_SSH_PORT,
      remotePort: parseInt(remotePortStr, 10) || DEFAULT_REMOTE_SERVER_PORT,
      identityFile: form.identityFile?.trim() || undefined,
    }
    if (editing) {
      await window.electronAPI.sshUpdateHost(editing.id, payload)
    } else {
      await window.electronAPI.sshAddHost(payload)
    }
    setShowForm(false)
    await refresh()
  }

  const removeHost = async (id: string) => {
    await window.electronAPI.sshDeleteHost(id)
    await refresh()
  }

  const importFromConfig = async () => {
    const found = await window.electronAPI.sshImportFromConfig()
    // Filter out hosts already saved (by host+user).
    const existing = new Set(hosts.map((h) => `${h.user}@${h.host}:${h.port}`))
    setSuggestions(found.filter((s) => !existing.has(`${s.user ?? ""}@${s.host}:${s.port}`)))
  }

  const addSuggestion = async (s: SshConfigImportSuggestion) => {
    await window.electronAPI.sshAddHost({
      id: s.alias,
      label: s.alias,
      host: s.host,
      user: s.user ?? "",
      port: s.port,
      identityFile: s.identityFile,
      imported: true,
    })
    setSuggestions((prev) => prev.filter((x) => x !== s))
    await refresh()
  }

  /** One-click: bootstrap the managed server, then create the workspace programmatically. */
  const connect = async (host: SshHostConfig) => {
    setError(null)
    setBootstrapping({ hostId: host.id, hostLabel: host.label, phase: "checking-server" })
    try {
      const { url, token } = await window.electronAPI.sshBootstrapConnect(host.id)
      if (!url || !token) throw new Error(t("ssh.error.noUrl"))
      const homeDir = await window.electronAPI.getHomeDir()
      const prepared = await prepareRemoteWorkspace({
        url,
        token,
        name: host.label,
        homeDir,
        sshHostId: host.id,
      })
      await onCreate(prepared.folderPath, prepared.name, prepared.remoteServer)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBootstrapping(null)
    }
  }

  // Progress overlay while bootstrapping a host.
  if (bootstrapping) {
    const activeIndex = PROGRESS_STEPS.indexOf(bootstrapping.phase)
    return (
      <AddWorkspaceContainer>
        <AddWorkspaceStepHeader
          title={t("ssh.bootstrap.title", { host: bootstrapping.hostLabel })}
          description={t("ssh.bootstrap.description")}
        />
        <div className="mt-6 w-full space-y-2">
          {PROGRESS_STEPS.map((phase, i) => {
            const done = activeIndex > i
            const active = activeIndex === i
            return (
              <div
                key={phase}
                className={cn(
                  "flex items-center gap-2 text-sm",
                  done ? "opacity-60" : active ? "opacity-100" : "opacity-40",
                )}
              >
                <span className="flex h-4 w-4 items-center justify-center">
                  {done ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : active ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-foreground/30" />
                  )}
                </span>
                <span>{t(`ssh.bootstrap.phase.${phase}`)}</span>
              </div>
            )
          })}
        </div>
        {bootstrapping.detail && (
          <pre className="mt-4 max-h-40 w-full overflow-auto whitespace-pre-wrap rounded-[10px] bg-foreground/5 p-3 text-[11px] opacity-70">
            {bootstrapping.detail}
          </pre>
        )}
      </AddWorkspaceContainer>
    )
  }

  if (showForm) {
    const valid = form.label.trim() && form.host.trim() && form.user.trim()
    return (
      <AddWorkspaceContainer>
        <BackHeader
          onBack={() => setShowForm(false)}
          title={editing ? t("ssh.editHost") : t("ssh.addHost")}
        />
        <div className="mt-6 w-full space-y-3">
          <Field label={t("ssh.field.label")}>
            <Input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="My server"
            />
          </Field>
          <div className="flex gap-2">
            <Field label={t("ssh.field.host")} className="flex-1">
              <Input
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                placeholder="example.com"
              />
            </Field>
            <Field label={t("ssh.field.port")} className="w-24">
              <Input value={portStr} onChange={(e) => setPortStr(e.target.value)} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Field label={t("ssh.field.user")} className="flex-1">
              <Input
                value={form.user}
                onChange={(e) => setForm({ ...form, user: e.target.value })}
                placeholder="deploy"
              />
            </Field>
            <Field label={t("ssh.field.remotePort")} className="w-28">
              <Input value={remotePortStr} onChange={(e) => setRemotePortStr(e.target.value)} />
            </Field>
          </div>
          <Field label={t("ssh.field.identityFile")}>
            <Input
              value={form.identityFile ?? ""}
              onChange={(e) => setForm({ ...form, identityFile: e.target.value })}
              placeholder="~/.ssh/id_ed25519"
            />
          </Field>
        </div>
        <div className="mt-6 w-full">
          <AddWorkspacePrimaryButton onClick={saveForm} disabled={!valid}>
            {t("common.save")}
          </AddWorkspacePrimaryButton>
        </div>
      </AddWorkspaceContainer>
    )
  }

  return (
    <AddWorkspaceContainer>
      <BackHeader onBack={onBack} title={t("ssh.title")} />
      <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
        {t("ssh.description")}
      </p>

      {error && (
        <div className="mt-4 w-full rounded-[10px] bg-red-500/10 p-3 text-xs text-red-500">
          {error}
        </div>
      )}

      <div className="mt-6 w-full space-y-2">
        {hosts.length === 0 && (
          <div className="rounded-[10px] bg-foreground/5 p-4 text-center text-xs opacity-70">
            {t("ssh.empty")}
          </div>
        )}
        {hosts.map((host) => {
          return (
            <div
              key={host.id}
              className="flex items-center gap-3 rounded-[10px] bg-foreground/5 p-3"
            >
              <Server className="h-4 w-4 shrink-0 opacity-60" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{host.label}</div>
                <div className="truncate text-xs opacity-70">
                  {host.user}@{host.host}
                  {host.port !== 22 ? `:${host.port}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <IconBtn title={t("common.edit")} onClick={() => openEditForm(host)}>
                  <Pencil className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn title={t("common.delete")} onClick={() => removeHost(host.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconBtn>
                <AddWorkspaceSecondaryButton onClick={() => connect(host)}>
                  {t("ssh.connect")}
                </AddWorkspaceSecondaryButton>
              </div>
            </div>
          )
        })}
      </div>

      {suggestions.length > 0 && (
        <div className="mt-4 w-full">
          <div className="mb-1 text-xs opacity-70">{t("ssh.importSuggestions")}</div>
          <div className="space-y-1">
            {suggestions.map((s) => (
              <button
                key={`${s.alias}-${s.host}`}
                onClick={() => addSuggestion(s)}
                className="flex w-full items-center gap-2 rounded-[10px] bg-foreground/5 p-2 text-left hover:bg-foreground/10"
              >
                <Plus className="h-3.5 w-3.5 opacity-60" />
                <span className="text-sm">{s.alias}</span>
                <span className="text-xs opacity-70">
                  {s.user ? `${s.user}@` : ""}
                  {s.host}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 flex w-full gap-2">
        <AddWorkspaceSecondaryButton className="flex-1" onClick={openAddForm}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t("ssh.addHost")}
        </AddWorkspaceSecondaryButton>
        <AddWorkspaceSecondaryButton className="flex-1" onClick={importFromConfig}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          {t("ssh.importFromConfig")}
        </AddWorkspaceSecondaryButton>
      </div>
    </AddWorkspaceContainer>
  )
}

function BackHeader({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className="flex w-full items-center">
      <button
        onClick={onBack}
        className="flex h-8 w-8 items-center justify-center rounded-[10px] hover:bg-foreground/5"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <div className="flex-1">
        <AddWorkspaceStepHeader title={title} />
      </div>
      <div className="w-8" />
    </div>
  )
}

function Field({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-xs opacity-70">{label}</span>
      {children}
    </label>
  )
}

function IconBtn({
  children,
  title,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-[10px] text-foreground/60 hover:bg-foreground/10 hover:text-foreground disabled:opacity-40"
    >
      {children}
    </button>
  )
}
