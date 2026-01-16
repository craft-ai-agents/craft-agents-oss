import { useState, useEffect, useCallback, useMemo } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { motion } from "motion/react"
import { Dithering } from "@paper-design/shaders-react"
import { cn } from "@/lib/utils"
import { overlayTransitionIn, overlayTransitionOut } from "@/lib/animations"
import { AddWorkspaceStep_Choice } from "./AddWorkspaceStep_Choice"
import { AddWorkspaceStep_CreateNew } from "./AddWorkspaceStep_CreateNew"
import { AddWorkspaceStep_OpenFolder } from "./AddWorkspaceStep_OpenFolder"
import type { Workspace } from "../../../shared/types"

type CreationStep = 'choice' | 'create' | 'open'

interface WorkspaceCreationScreenProps {
  /** Callback when a workspace is created successfully */
  onWorkspaceCreated: (workspace: Workspace) => void
  /** Callback when the screen is dismissed */
  onClose: () => void
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
  className
}: WorkspaceCreationScreenProps) {
  const [step, setStep] = useState<CreationStep>('choice')
  const [isCreating, setIsCreating] = useState(false)
  const [dimensions, setDimensions] = useState({ width: 1920, height: 1080 })

  // Track window dimensions for shader
  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight })
    }
    updateDimensions()
    window.addEventListener('resize', updateDimensions)
    return () => window.removeEventListener('resize', updateDimensions)
  }, [])

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isCreating) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, isCreating])

  const handleCreateWorkspace = useCallback(async (folderPath: string, name: string) => {
    setIsCreating(true)
    try {
      const workspace = await window.electronAPI.createWorkspace(folderPath, name)
      onWorkspaceCreated(workspace)
    } finally {
      setIsCreating(false)
    }
  }, [onWorkspaceCreated])

  const renderStep = () => {
    switch (step) {
      case 'choice':
        return (
          <AddWorkspaceStep_Choice
            onCreateNew={() => setStep('create')}
            onOpenFolder={() => setStep('open')}
          />
        )

      case 'create':
        return (
          <AddWorkspaceStep_CreateNew
            onBack={() => setStep('choice')}
            onCreate={handleCreateWorkspace}
            isCreating={isCreating}
          />
        )

      case 'open':
        return (
          <AddWorkspaceStep_OpenFolder
            onBack={() => setStep('choice')}
            onCreate={handleCreateWorkspace}
            isCreating={isCreating}
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

  // Render via portal to escape any parent transforms (like AppShell scale-back)
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={overlayTransitionIn}
      className={cn(
        "fixed inset-0 z-splash flex flex-col bg-background",
        className
      )}
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
            console.log('[WorkspaceCreationScreen] Close button clicked', { isCreating })
            e.stopPropagation()
            onClose()
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
    </motion.div>,
    document.body
  )
}
