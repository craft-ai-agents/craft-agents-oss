/**
 * useAddWorkspace Hook
 *
 * Simple state machine for adding a new workspace.
 * Separate from onboarding - handles only the "add another space" flow.
 *
 * Flow: Loading → (Login if needed) → Select Space → Complete
 */
import { useState, useCallback, useEffect } from 'react'
import type { SpaceCategory, CraftSpace } from '@/components/onboarding'
import type { CraftMcpLink, CraftSpace as ApiCraftSpace } from '../../shared/types'

export type AddWorkspaceStep = 'loading' | 'login' | 'select-space' | 'saving' | 'complete' | 'error'

export interface AddWorkspaceState {
  step: AddWorkspaceStep
  selectedSpaceId: string | null
  selectedSpaceName: string | null
  errorMessage?: string
}

interface UseAddWorkspaceOptions {
  onComplete: () => void
  onCancel: () => void
}

interface UseAddWorkspaceReturn {
  state: AddWorkspaceState
  spaceCategories: SpaceCategory[]

  // Actions
  handleLogin: () => void
  handleSelectSpace: (spaceId: string, spaceName: string) => void
  handleContinue: () => void
  handleBack: () => void
  handleCancel: () => void
}

export function useAddWorkspace({
  onComplete,
  onCancel,
}: UseAddWorkspaceOptions): UseAddWorkspaceReturn {
  const [state, setState] = useState<AddWorkspaceState>({
    step: 'loading',
    selectedSpaceId: null,
    selectedSpaceName: null,
  })

  const [spaceCategories, setSpaceCategories] = useState<SpaceCategory[]>([])
  const [craftToken, setCraftToken] = useState<string | null>(null)
  const [selectedMcpLink, setSelectedMcpLink] = useState<CraftMcpLink | null>(null)

  // Categorize spaces into groups
  const categorizeSpaces = useCallback((
    spaces: ApiCraftSpace[],
    teams: Array<{ id: string; name: string; isPrivate: boolean; role: string }>,
    userId: string
  ): SpaceCategory[] => {
    const personalSpace = spaces.find(s => s.id === userId)
    const teamSpaces = spaces.filter(s => s.id !== userId && s.teamId)
    const otherSpaces = spaces.filter(s => s.id !== userId && !s.teamId)

    const categories: SpaceCategory[] = []

    if (personalSpace) {
      categories.push({
        name: 'Recommended',
        spaces: [{
          id: personalSpace.id,
          name: personalSpace.name,
          type: 'personal',
        }],
      })
    }

    if (teamSpaces.length > 0) {
      categories.push({
        name: 'Your Spaces',
        spaces: teamSpaces.map(s => ({
          id: s.id,
          name: s.name,
          type: 'team' as const,
        })),
      })
    }

    if (otherSpaces.length > 0) {
      categories.push({
        name: 'Other Spaces',
        spaces: otherSpaces.map(s => ({
          id: s.id,
          name: s.name,
          type: 'shared' as const,
        })),
      })
    }

    return categories
  }, [])

  // On mount, check for existing Craft auth
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const result = await window.electronAPI.getCraftProfile()

        if (result.success && result.token && result.profile) {
          // Already authenticated - go to space selection
          setCraftToken(result.token)
          const categories = categorizeSpaces(
            result.profile.spaces,
            result.profile.teams,
            result.profile.userId
          )
          setSpaceCategories(categories)
          setState(s => ({ ...s, step: 'select-space' }))
        } else {
          // Need to login
          setState(s => ({ ...s, step: 'login' }))
        }
      } catch (error) {
        console.error('[AddWorkspace] Failed to check auth:', error)
        setState(s => ({ ...s, step: 'login' }))
      }
    }

    checkAuth()
  }, [categorizeSpaces])

  // Start Craft OAuth login
  const handleLogin = useCallback(async () => {
    setState(s => ({ ...s, step: 'loading', errorMessage: undefined }))

    try {
      const result = await window.electronAPI.startCraftOAuth()

      if (result.success && result.token && result.profile) {
        setCraftToken(result.token)
        const categories = categorizeSpaces(
          result.profile.spaces,
          result.profile.teams,
          result.profile.userId
        )
        setSpaceCategories(categories)
        setState(s => ({ ...s, step: 'select-space' }))
      } else {
        setState(s => ({
          ...s,
          step: 'login',
          errorMessage: result.error || 'Login failed',
        }))
      }
    } catch (error) {
      setState(s => ({
        ...s,
        step: 'login',
        errorMessage: error instanceof Error ? error.message : 'Login failed',
      }))
    }
  }, [categorizeSpaces])

  // Select a space
  const handleSelectSpace = useCallback((spaceId: string, spaceName: string) => {
    setState(s => ({
      ...s,
      selectedSpaceId: spaceId,
      selectedSpaceName: spaceName,
    }))
  }, [])

  // Continue to next step / save workspace
  const handleContinue = useCallback(async () => {
    if (state.step === 'select-space' && state.selectedSpaceId && craftToken) {
      setState(s => ({ ...s, step: 'saving' }))

      try {
        // Fetch or create MCP link for the selected space
        const links = await window.electronAPI.getMcpLinks(state.selectedSpaceId, craftToken)
        const existingLink = links.find(l => l.mcpUrl)

        let mcpLink: typeof existingLink
        if (existingLink) {
          mcpLink = existingLink
        } else {
          mcpLink = await window.electronAPI.createMcpLink(state.selectedSpaceId, craftToken)
        }
        setSelectedMcpLink(mcpLink)

        const mcpUrl = mcpLink?.mcpUrl || ''

        // Try MCP OAuth if needed
        let mcpCredentials: { accessToken: string; clientId?: string } | undefined
        if (mcpUrl) {
          try {
            const mcpResult = await window.electronAPI.startWorkspaceMcpOAuth(mcpUrl)
            if (mcpResult.success && mcpResult.accessToken) {
              mcpCredentials = {
                accessToken: mcpResult.accessToken,
                clientId: mcpResult.clientId,
              }
            }
          } catch {
            console.log('[AddWorkspace] MCP OAuth not required or failed')
          }
        }

        // Save workspace (without changing billing config)
        const result = await window.electronAPI.saveOnboardingConfig({
          workspace: {
            name: state.selectedSpaceName!,
            mcpUrl,
          },
          mcpCredentials,
        })

        if (result.success) {
          setState(s => ({ ...s, step: 'complete' }))
        } else {
          setState(s => ({
            ...s,
            step: 'error',
            errorMessage: result.error || 'Failed to save workspace',
          }))
        }
      } catch (error) {
        console.error('[AddWorkspace] Failed to save:', error)
        setState(s => ({
          ...s,
          step: 'error',
          errorMessage: error instanceof Error ? error.message : 'Failed to save workspace',
        }))
      }
    } else if (state.step === 'complete') {
      onComplete()
    }
  }, [state.step, state.selectedSpaceId, state.selectedSpaceName, craftToken, onComplete])

  // Go back
  const handleBack = useCallback(() => {
    if (state.step === 'select-space') {
      onCancel()
    }
  }, [state.step, onCancel])

  // Cancel
  const handleCancel = useCallback(() => {
    onCancel()
  }, [onCancel])

  return {
    state,
    spaceCategories,
    handleLogin,
    handleSelectSpace,
    handleContinue,
    handleBack,
    handleCancel,
  }
}
