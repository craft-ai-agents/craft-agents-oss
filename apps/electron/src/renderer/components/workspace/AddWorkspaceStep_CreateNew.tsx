import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { slugify } from "@/lib/slugify"
import { Input } from "../ui/input"
import { Button } from "../ui/button"
import { AddWorkspaceContainer, AddWorkspaceStepHeader, AddWorkspaceSecondaryButton, AddWorkspacePrimaryButton } from "./primitives"
import { AddWorkspace_RadioOption } from "./AddWorkspace_RadioOption"
import { useDirectoryPicker } from "@/hooks/useDirectoryPicker"
import { ServerDirectoryBrowser } from "@/components/ServerDirectoryBrowser"
import type { OrganizationWithMembers } from "@craft-agent/shared/orgs"

const MAX_ORGANIZATION_NAME_LENGTH = 120


type LocationOption = 'default' | 'custom'

interface AddWorkspaceStep_CreateNewProps {
  onBack: () => void
  onCreate: (folderPath: string, name: string, orgId: string) => Promise<void>
  isCreating: boolean
}

/**
 * AddWorkspaceStep_CreateNew - Create a new workspace
 *
 * Fields:
 * - Workspace name (required)
 * - Location: Default (~/.craft-agent/workspaces/) or Custom
 */
export function AddWorkspaceStep_CreateNew({
  onBack,
  onCreate,
  isCreating
}: AddWorkspaceStep_CreateNewProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [locationOption, setLocationOption] = useState<LocationOption>('default')
  const [customPath, setCustomPath] = useState<string | null>(null)
  const [homeDir, setHomeDir] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [organizations, setOrganizations] = useState<OrganizationWithMembers[]>([])
  const [selectedOrgId, setSelectedOrgId] = useState('')
  const [isLoadingOrganizations, setIsLoadingOrganizations] = useState(true)
  const [organizationError, setOrganizationError] = useState<string | null>(null)
  const [showOrganizationCreator, setShowOrganizationCreator] = useState(false)
  const [newOrganizationName, setNewOrganizationName] = useState('')
  const [isCreatingOrganization, setIsCreatingOrganization] = useState(false)


  // Get home directory on mount
  useEffect(() => {
    window.electronAPI.getHomeDir().then(setHomeDir)
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadOrganizations = async () => {
      setIsLoadingOrganizations(true)
      setOrganizationError(null)
      try {
        const listed = await window.electronAPI.listOrganizations()
        if (cancelled) return
        setOrganizations(listed)
        setSelectedOrgId((current) =>
          current && listed.some((organization) => organization.id === current)
            ? current
            : listed[0]?.id ?? '',
        )
        setShowOrganizationCreator(listed.length === 0)
      } catch {
        if (cancelled) return
        setOrganizationError(t('settings.orgs.loadFailed'))
        setShowOrganizationCreator(true)
      } finally {
        if (!cancelled) setIsLoadingOrganizations(false)
      }
    }

    void loadOrganizations()
    return () => {
      cancelled = true
    }
  }, [t])

  const slug = slugify(name)
  const defaultBasePath = homeDir ? `${homeDir}/.craft-agent/workspaces` : null
  const finalPath = locationOption === 'default'
    ? (defaultBasePath && slug ? `${defaultBasePath}/${slug}` : null)
    : customPath && slug
      ? `${customPath}/${slug}`
      : null

  // Validate slug uniqueness when name changes
  useEffect(() => {
    if (!slug) {
      setError(null)
      return
    }

    const validateSlug = async () => {
      setIsValidating(true)
      try {
        const result = await window.electronAPI.checkWorkspaceSlug(slug)
        if (result.exists) {
          setError(`A workspace named "${slug}" already exists`)
        } else {
          setError(null)
        }
      } catch (err) {
        console.error('Failed to validate workspace slug:', err)
      } finally {
        setIsValidating(false)
      }
    }

    // Debounce validation
    const timeout = setTimeout(validateSlug, 300)
    return () => clearTimeout(timeout)
  }, [slug])

  const handleCreateOrganization = useCallback(async () => {
    const organizationName = newOrganizationName.trim()
    if (!organizationName || isCreatingOrganization) return

    setIsCreatingOrganization(true)
    setOrganizationError(null)
    try {
      const organization = await window.electronAPI.createOrganization({ name: organizationName })
      setOrganizations((current) => [...current, organization])
      setSelectedOrgId(organization.id)
      setNewOrganizationName('')
      setShowOrganizationCreator(false)
    } catch {
      setOrganizationError(t('settings.orgs.createFailed'))
    } finally {
      setIsCreatingOrganization(false)
    }
  }, [isCreatingOrganization, newOrganizationName, t])

  const handleFolderSelected = useCallback((path: string) => {
    setCustomPath(path)
  }, [])

  const {
    pickDirectory,
    showServerBrowser,
    serverBrowserMode,
    cancelServerBrowser,
    confirmServerBrowser,
  } = useDirectoryPicker(handleFolderSelected)

  const selectedOrganization = organizations.find((organization) => organization.id === selectedOrgId)
  const selectedOrganizationId = selectedOrganization?.id.trim() ?? ''

  const handleCreate = useCallback(async () => {
    if (!name.trim() || !finalPath || error || !selectedOrganizationId) return
    await onCreate(finalPath, name.trim(), selectedOrganizationId)
  }, [name, finalPath, error, onCreate, selectedOrganizationId])

  const busy = isCreating || isCreatingOrganization
  const canCreate =
    Boolean(name.trim()) &&
    Boolean(finalPath) &&
    Boolean(selectedOrganizationId) &&
    !error &&
    !isValidating &&
    !isLoadingOrganizations &&
    !busy


  return (
    <AddWorkspaceContainer>
      {/* Back button */}
      <button
        onClick={onBack}
        disabled={busy}
        className={cn(
          "self-start flex items-center gap-1 text-sm text-muted-foreground",
          "hover:text-foreground transition-colors mb-4",
          busy && "opacity-50 cursor-not-allowed"
        )}
      >
        <ArrowLeft className="h-4 w-4" />
        {t("common.back")}
      </button>

      <AddWorkspaceStepHeader
        title={t("workspace.teamSpace")}
        description={t("workspace.teamSpaceCreateDesc")}
      />

      <div className="mt-6 w-full space-y-6">
        {/* Workspace name */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground mb-2.5">
            {t("workspace.nameLabel")}
          </label>
          <div className="bg-background shadow-minimal rounded-lg">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("workspace.myWorkspace")}
              disabled={busy}
              autoFocus
              className="border-0 bg-transparent shadow-none"
            />
          </div>
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor="team-space-organization"
              className="block text-sm font-medium text-foreground"
            >
              {t("workspace.organization")}
            </label>
            {organizations.length > 0 && !showOrganizationCreator && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowOrganizationCreator(true)}
                disabled={busy}
                className="h-7 px-2 text-xs"
              >
                {t("settings.orgs.create")}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("workspace.organizationRequired")}
          </p>
          <select
            id="team-space-organization"
            value={selectedOrgId}
            onChange={(event) => setSelectedOrgId(event.target.value)}
            disabled={busy || isLoadingOrganizations || organizations.length === 0}
            className="h-9 w-full rounded-md border border-foreground/15 bg-background px-3 text-sm shadow-minimal focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">
              {isLoadingOrganizations
                ? t("common.loading")
                : t("workspace.organizationSelect")}
            </option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
          {organizations.length === 0 && !isLoadingOrganizations && (
            <p className="text-xs text-muted-foreground">
              {t("workspace.organizationEmpty")}
            </p>
          )}
          {organizationError && (
            <p role="alert" className="text-xs text-destructive">
              {organizationError}
            </p>
          )}
          {showOrganizationCreator && (
            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
              <Input
                value={newOrganizationName}
                onChange={(event) =>
                  setNewOrganizationName(
                    event.target.value.slice(0, MAX_ORGANIZATION_NAME_LENGTH),
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleCreateOrganization()
                }}
                placeholder={t("settings.orgs.orgNamePlaceholder")}
                disabled={busy}
                maxLength={MAX_ORGANIZATION_NAME_LENGTH}
                aria-label={t("settings.orgs.orgName")}
                className="bg-background"
              />
              <div className="flex justify-end gap-2">
                {organizations.length > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowOrganizationCreator(false)}
                    disabled={busy}
                  >
                    {t("common.cancel")}
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleCreateOrganization()}
                  disabled={!newOrganizationName.trim() || busy}
                >
                  {isCreatingOrganization ? t("common.creating") : t("common.create")}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Location selection */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-foreground mb-2.5">
            {t("workspace.locationLabel")}
          </label>

          {/* Default location option */}
          <AddWorkspace_RadioOption
            name="location"
            checked={locationOption === 'default'}
            onChange={() => setLocationOption('default')}
            disabled={busy}
            title={t("workspace.defaultLocation")}
            subtitle={t("workspace.underDefaultFolder")}
          />

          {/* Custom location option */}
          <AddWorkspace_RadioOption
            name="location"
            checked={locationOption === 'custom'}
            onChange={() => setLocationOption('custom')}
            disabled={busy}
            title={t("workspace.chooseLocation")}
            subtitle={customPath || t("workspace.pickLocation")}
            action={locationOption === 'custom' ? (
              <AddWorkspaceSecondaryButton
                onClick={(e) => {
                  e.preventDefault()
                  pickDirectory()
                }}
                disabled={busy}
              >
                {t("common.browse")}
              </AddWorkspaceSecondaryButton>
            ) : undefined}
          />
        </div>

        {/* Create button */}
        <AddWorkspacePrimaryButton
          onClick={handleCreate}
          disabled={!canCreate}
          loading={isCreating}
          loadingText={t("workspace.creating")}
        >
          {t("common.create")}
        </AddWorkspacePrimaryButton>
      </div>
      <ServerDirectoryBrowser
        open={showServerBrowser}
        mode={serverBrowserMode}
        onSelect={confirmServerBrowser}
        onCancel={cancelServerBrowser}
      />
    </AddWorkspaceContainer>
  )
}
