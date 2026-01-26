/**
 * ProfileList Component
 *
 * Displays a list of Claude profiles with an add button.
 */

import * as React from 'react'
import { Plus, Loader2 } from 'lucide-react'
import { ProfileCard } from './ProfileCard'
import { Button } from '@/components/ui/button'
import type { ClaudeProfile } from '../../../shared/types'

interface ProfileListProps {
  profiles: ClaudeProfile[]
  activeId: string | null
  isLoading: boolean
  onAddProfile: () => void
  onSetActive: (profileId: string) => void
  onSetDefault: (profileId: string) => void
  onDelete: (profileId: string) => void
  onRename: (profileId: string, newName: string) => void
}

export function ProfileList({
  profiles,
  activeId,
  isLoading,
  onAddProfile,
  onSetActive,
  onSetDefault,
  onDelete,
  onRename,
}: ProfileListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Profile list */}
      {profiles.length > 0 && (
        <div className="space-y-2">
          {profiles.map((profile) => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              isActive={profile.id === activeId}
              onSetActive={() => onSetActive(profile.id)}
              onSetDefault={() => onSetDefault(profile.id)}
              onDelete={() => onDelete(profile.id)}
              onRename={(name) => onRename(profile.id, name)}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {profiles.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <p className="text-sm mb-4">No Claude accounts connected yet.</p>
          <p className="text-xs">Add accounts to enable automatic switching when usage limits are reached.</p>
        </div>
      )}

      {/* Add button */}
      <Button
        variant="outline"
        size="sm"
        onClick={onAddProfile}
        className="w-full mt-3"
      >
        <Plus className="w-4 h-4 mr-2" />
        Add Claude Account
      </Button>
    </div>
  )
}
