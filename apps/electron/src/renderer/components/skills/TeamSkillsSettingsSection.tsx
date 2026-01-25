/**
 * Team Skills Settings Section
 *
 * Configure team skills sync from a private GitHub repository.
 * Skills are synced to ~/.vesper/team-skills/ and take precedence after workspace skills.
 */

import { useEffect, useState } from 'react'
import { RefreshCw, CheckCircle2, FolderGit2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
} from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface TeamSkillsStatus {
  configured: boolean
  repoUrl: string | null
  hasToken: boolean
  skillCount: number
}

export function TeamSkillsSettingsSection() {
  const [status, setStatus] = useState<TeamSkillsStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [repoUrl, setRepoUrl] = useState('')
  const [token, setToken] = useState('')

  // Load status on mount
  useEffect(() => {
    loadStatus()
  }, [])

  const loadStatus = async () => {
    if (!window.electronAPI?.getTeamSkillsStatus) return
    setIsLoading(true)
    try {
      const result = await window.electronAPI.getTeamSkillsStatus()
      setStatus(result)
      if (result.repoUrl) {
        setRepoUrl(result.repoUrl)
      }
    } catch (error) {
      console.error('Failed to load team skills status:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSaveConfig = async () => {
    if (!window.electronAPI?.setTeamSkillsConfig) return
    if (!repoUrl.trim() || !token.trim()) {
      toast.error('Please enter both repo URL and GitHub token')
      return
    }

    setIsLoading(true)
    try {
      const result = await window.electronAPI.setTeamSkillsConfig({
        repoUrl: repoUrl.trim(),
        token: token.trim(),
      })

      if (result.success) {
        toast.success('Team skills configuration saved')
        setToken('') // Clear token from UI after saving
        setShowConfig(false)
        await loadStatus()
        // Auto-sync after saving config
        await handleSync()
      } else {
        toast.error(result.error || 'Failed to save configuration')
      }
    } catch (error) {
      console.error('Failed to save team skills config:', error)
      toast.error('Failed to save configuration')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSync = async () => {
    if (!window.electronAPI?.syncTeamSkills) return

    setIsSyncing(true)
    try {
      const result = await window.electronAPI.syncTeamSkills()

      if (result.success) {
        toast.success(`Synced ${result.syncedCount} team skills`)
        await loadStatus()
      } else {
        toast.error(result.error || 'Failed to sync team skills')
      }
    } catch (error) {
      console.error('Failed to sync team skills:', error)
      toast.error('Failed to sync team skills')
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <SettingsSection
      title="Team Skills"
      description="Sync shared skills from a private GitHub repository"
    >
      <SettingsCard>
        {isLoading ? (
          <SettingsRow
            label="Loading..."
            description="Checking team skills configuration"
          />
        ) : status?.configured ? (
          <>
            <SettingsRow
              label="Repository"
              description={status.repoUrl || 'Not configured'}
              action={
                <div className="flex items-center gap-2">
                  <span className="text-sm text-foreground/60">
                    {status.skillCount} skills
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSync}
                    disabled={isSyncing}
                    className="h-8 px-3"
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
                    {isSyncing ? 'Syncing...' : 'Sync'}
                  </Button>
                </div>
              }
            />
            <SettingsRow
              label="Status"
              description="Connected and ready to sync"
              action={
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowConfig(true)}
                    className="h-8 px-3"
                  >
                    Update
                  </Button>
                </div>
              }
            />
          </>
        ) : (
          <SettingsRow
            label="Not Configured"
            description="Connect to a GitHub repository to sync team skills"
            action={
              <Button
                variant="default"
                size="sm"
                onClick={() => setShowConfig(true)}
                className="h-8 px-3"
              >
                <FolderGit2 className="w-4 h-4 mr-2" />
                Configure
              </Button>
            }
          />
        )}

        {/* Configuration Form */}
        {showConfig && (
          <div className="p-4 border-t border-foreground/[0.06] space-y-4">
            <div className="space-y-2">
              <Label htmlFor="team-skills-repo">Repository URL</Label>
              <Input
                id="team-skills-repo"
                placeholder="owner/repo or https://github.com/owner/repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
              />
              <p className="text-xs text-foreground/50">
                Private GitHub repository containing SKILL.md files
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="team-skills-token">GitHub Personal Access Token</Label>
              <Input
                id="team-skills-token"
                type="password"
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <p className="text-xs text-foreground/50">
                PAT with <code className="px-1 py-0.5 bg-foreground/5 rounded">repo</code> scope for private repos
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowConfig(false)
                  setToken('')
                }}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleSaveConfig}
                disabled={!repoUrl.trim() || !token.trim()}
              >
                Save & Sync
              </Button>
            </div>
          </div>
        )}
      </SettingsCard>
    </SettingsSection>
  )
}
