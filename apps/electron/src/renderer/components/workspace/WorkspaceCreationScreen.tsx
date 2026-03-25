import { useState, useEffect, useCallback, useMemo } from "react"
import { X } from "lucide-react"
import { motion } from "motion/react"
import { Dithering } from "@paper-design/shaders-react"
import { FullscreenOverlayBase } from "@craft-agent/ui"
import { cn } from "@/lib/utils"
import { overlayTransitionIn } from "@/lib/animations"
import { AddWorkspaceStep_Choice } from "./AddWorkspaceStep_Choice"
import { AddWorkspaceStep_CreateNew } from "./AddWorkspaceStep_CreateNew"
import { AddWorkspaceStep_OpenFolder } from "./AddWorkspaceStep_OpenFolder"
import type { Workspace } from "../../../shared/types"
import type { WorkspaceCreationTarget, RemoteServerProfile } from "../../../shared/types"
import { toast } from "sonner"
import { useTransportConnectionState } from "@/hooks/useTransportConnectionState"
import type { RemoteServerRuntimeState } from "../../../shared/types"

type CreationStep = 'choice' | 'create' | 'open'

interface WorkspaceCreationScreenProps {
  /** Callback when a workspace is created successfully */
  onWorkspaceCreated: (workspace: Workspace) => void
  /** Callback when the screen is dismissed */
  onClose: () => void
  initialTarget?: WorkspaceCreationTarget
  className?: string
}

/**
 * WorkspaceCreationScreen - Full-screen overlay for creating workspaces
 *
 * Obsidian-style flow:
 * 1. Choice: Create new workspace OR Open existing folder
 * 2a. Create: Enter name + choose location (default or custom)
 * 2b. Open: Browse folder OR create new folder at location
 */
export function WorkspaceCreationScreen({
  onWorkspaceCreated,
  onClose,
  initialTarget = { mode: 'local' },
  className
}: WorkspaceCreationScreenProps) {
  const transportState = useTransportConnectionState()
  const [step, setStep] = useState<CreationStep>('choice')
  const [isCreating, setIsCreating] = useState(false)
  const [dimensions, setDimensions] = useState({ width: 1920, height: 1080 })
  const [remoteServers, setRemoteServers] = useState<RemoteServerProfile[]>([])
  const [remoteRuntimeStates, setRemoteRuntimeStates] = useState<Record<string, RemoteServerRuntimeState>>({})
  const isDirectRemoteMode = useMemo(() => {
    return transportState?.mode === 'remote' && Object.keys(remoteRuntimeStates).length === 0
  }, [remoteRuntimeStates, transportState?.mode])
  const [targetMode, setTargetMode] = useState<'local' | 'remote'>(isDirectRemoteMode ? 'remote' : initialTarget.mode)
  const [selectedServerId, setSelectedServerId] = useState<string | null>(initialTarget.serverId ?? null)

  const normalizeServerUrl = useCallback((value: string | null | undefined) => {
    if (!value) return ''
    try {
      const parsed = new URL(value)
      parsed.hash = ''
      parsed.search = ''
      return parsed.toString().replace(/\/+$/, '')
    } catch {
      return value.replace(/\/+$/, '')
    }
  }, [])

  // Track window dimensions for shader
  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight })
    }
    updateDimensions()
    window.addEventListener('resize', updateDimensions)
    return () => window.removeEventListener('resize', updateDimensions)
  }, [])

  useEffect(() => {
    let mounted = true

    const loadServers = async () => {
      try {
        const [profiles, runtimeStates] = await Promise.all([
          window.electronAPI.listRemoteServers(),
          window.electronAPI.getRemoteServerRuntimeStates?.() ?? Promise.resolve({}),
        ])
        if (!mounted) return
        setRemoteRuntimeStates(runtimeStates)
        const selectable = profiles.filter(profile => profile.enabled && profile.hasToken)
        setRemoteServers(selectable)
        const directRemoteProfile = isDirectRemoteMode
          ? selectable.find(profile => normalizeServerUrl(profile.url) === normalizeServerUrl(transportState?.url))
          : null
        setSelectedServerId(prev => {
          if (prev && selectable.some(profile => profile.id === prev)) return prev
          if (directRemoteProfile) return directRemoteProfile.id
          return selectable[0]?.id ?? null
        })
      } catch {
        if (mounted) {
          setRemoteServers([])
          setRemoteRuntimeStates({})
          setSelectedServerId(null)
        }
      }
    }

    void loadServers()
    const unsubscribe = window.electronAPI.onRemoteServersChanged?.(() => {
      void loadServers()
    })

    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [isDirectRemoteMode, normalizeServerUrl, transportState?.url])

  useEffect(() => {
    if (isDirectRemoteMode && targetMode !== 'remote') {
      setTargetMode('remote')
    }
  }, [isDirectRemoteMode, targetMode])

  const currentTarget = useMemo<WorkspaceCreationTarget | null>(() => {
    if (targetMode === 'local' && !isDirectRemoteMode) return { mode: 'local' }
    if (isDirectRemoteMode && targetMode === 'remote') {
      return selectedServerId ? { mode: 'remote', serverId: selectedServerId } : { mode: 'remote' }
    }
    if (!selectedServerId) return null
    return { mode: 'remote', serverId: selectedServerId }
  }, [isDirectRemoteMode, targetMode, selectedServerId])

  const directRemoteProfile = useMemo(() => {
    if (!isDirectRemoteMode) return null
    return remoteServers.find(profile => normalizeServerUrl(profile.url) === normalizeServerUrl(transportState?.url)) ?? null
  }, [isDirectRemoteMode, normalizeServerUrl, remoteServers, transportState?.url])

  // Wrap onClose to prevent closing during creation
  // FullscreenOverlayBase handles ESC key, this wrapper prevents closing when busy
  const handleClose = useCallback(() => {
    if (!isCreating) {
      onClose()
    }
  }, [isCreating, onClose])

  const handleCreateWorkspace = useCallback(async (folderPath: string, name: string, options?: { managedByApp?: boolean }) => {
    if (!currentTarget) {
      toast.error('Select a workspace target first')
      return
    }
    setIsCreating(true)
    try {
      const workspace = await window.electronAPI.createWorkspaceAtTarget(currentTarget, folderPath, name, options)
      onWorkspaceCreated(workspace)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.error('Failed to create workspace', {
        description: message,
      })
    } finally {
      setIsCreating(false)
    }
  }, [currentTarget, onWorkspaceCreated])

  const renderStep = () => {
    const targetStepKey = `${targetMode}:${selectedServerId ?? 'none'}`

    switch (step) {
      case 'choice':
        return (
          <AddWorkspaceStep_Choice
            onCreateNew={() => setStep('create')}
            onOpenFolder={() => setStep('open')}
            targetMode={targetMode}
            onTargetModeChange={setTargetMode}
            remoteServers={remoteServers}
            selectedServerId={selectedServerId}
            onSelectedServerIdChange={setSelectedServerId}
            allowLocalTarget={!isDirectRemoteMode}
            connectedRemoteName={directRemoteProfile?.name ?? 'Connected server'}
            connectedRemoteUrl={directRemoteProfile?.url ?? transportState?.url ?? null}
          />
        )

      case 'create':
        return (
          <AddWorkspaceStep_CreateNew
            key={`create:${targetStepKey}`}
            onBack={() => setStep('choice')}
            onCreate={handleCreateWorkspace}
            isCreating={isCreating}
            targetMode={targetMode}
            target={currentTarget}
            onTargetModeChange={setTargetMode}
            remoteServers={remoteServers}
            selectedServerId={selectedServerId}
            onSelectedServerIdChange={setSelectedServerId}
            allowLocalTarget={!isDirectRemoteMode}
            connectedRemoteName={directRemoteProfile?.name ?? 'Connected server'}
            connectedRemoteUrl={directRemoteProfile?.url ?? transportState?.url ?? null}
          />
        )

      case 'open':
        return (
          <AddWorkspaceStep_OpenFolder
            key={`open:${targetStepKey}`}
            onBack={() => setStep('choice')}
            onCreate={handleCreateWorkspace}
            isCreating={isCreating}
            targetMode={targetMode}
            target={currentTarget}
            onTargetModeChange={setTargetMode}
            remoteServers={remoteServers}
            selectedServerId={selectedServerId}
            onSelectedServerIdChange={setSelectedServerId}
            allowLocalTarget={!isDirectRemoteMode}
            connectedRemoteName={directRemoteProfile?.name ?? 'Connected server'}
            connectedRemoteUrl={directRemoteProfile?.url ?? transportState?.url ?? null}
          />
        )

      default:
        return null
    }
  }

  // Get theme colors from CSS variables for the shader
  const shaderColors = useMemo(() => {
    if (typeof window === 'undefined') return { back: '#00000000', front: '#684e85' }
    const root = document.documentElement
    const isDark = root.classList.contains('dark')
    // Transparent back, accent-tinted front
    return isDark
      ? { back: '#00000000', front: '#9b7bb8' }  // lighter accent for dark mode
      : { back: '#00000000', front: '#684e85' }  // accent color
  }, [])

  // FullscreenOverlayBase handles portal, traffic lights, and ESC key
  return (
    <FullscreenOverlayBase
      isOpen={true}
      onClose={handleClose}
      className={cn("z-splash flex flex-col bg-background", className)}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={overlayTransitionIn}
        className="flex flex-col flex-1"
      >
        {/* Dithering shader background */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.3 }}
          transition={overlayTransitionIn}
          className="absolute inset-0 pointer-events-none"
        >
          <Dithering
            colorBack={shaderColors.back}
            colorFront={shaderColors.front}
            shape="swirl"
            type="8x8"
            size={2}
            speed={1}
            scale={1}
            width={dimensions.width}
            height={dimensions.height}
          />
        </motion.div>

        {/* Header with drag region and close button */}
        <header className="titlebar-drag-region relative h-[50px] shrink-0 flex items-center justify-end px-6">
          {/* Close button - explicitly no-drag */}
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={overlayTransitionIn}
            onClick={(e) => {
              e.stopPropagation()
              handleClose()
            }}
            disabled={isCreating}
            className={cn(
              "titlebar-no-drag flex items-center justify-center p-2 rounded-[6px]",
              "bg-background shadow-minimal hover:bg-foreground-5",
              "text-muted-foreground hover:text-foreground",
              "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "mr-[-8px] mt-2",
              isCreating && "opacity-50 cursor-not-allowed"
            )}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </motion.button>
        </header>

        {/* Main content */}
        <motion.main
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={overlayTransitionIn}
          className="relative flex flex-1 items-center justify-center p-8"
        >
          {renderStep()}
        </motion.main>
      </motion.div>
    </FullscreenOverlayBase>
  )
}
