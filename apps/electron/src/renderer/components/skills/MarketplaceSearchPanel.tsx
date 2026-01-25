/**
 * MarketplaceSearchPanel
 *
 * Browse and install skills from skills.sh marketplace.
 * Features search with debounce, install buttons, and skill selection.
 */

import * as React from 'react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, Download, Loader2, Package, Globe, Github } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { MarketplaceSkill, MarketplaceSource } from '../../../shared/types'

export interface MarketplaceSearchPanelProps {
  onInstalled: () => void
  onSkillSelect?: (skill: MarketplaceSkill) => void
  selectedSkillId?: string | null
  className?: string
}

export function MarketplaceSearchPanel({
  onInstalled,
  onSkillSelect,
  selectedSkillId,
  className,
}: MarketplaceSearchPanelProps) {
  const [query, setQuery] = useState('')
  const [skills, setSkills] = useState<MarketplaceSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [activeSource, setActiveSource] = useState<MarketplaceSource | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const lastErrorsRef = useRef<string>('')  // Track last shown errors to avoid duplicate toasts

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const result = await window.electronAPI.marketplaceSearch(query)
        setSkills(result.skills || [])
        setHasMore(result.hasMore || false)
        setErrors(result.errors || [])
      } catch (error) {
        console.error('Search failed:', error)
        setSkills([])
        setErrors([])
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [query])

  // Show toast when sources fail (avoid duplicate toasts)
  useEffect(() => {
    if (errors.length > 0) {
      const errorKey = errors.join(',')
      if (errorKey !== lastErrorsRef.current) {
        lastErrorsRef.current = errorKey
        toast.warning('Some sources unavailable', {
          description: errors.join(', '),
        })
      }
    }
  }, [errors])

  // Filter skills by active source
  const filteredSkills = activeSource
    ? skills.filter(s => s.source === activeSource)
    : skills

  // Handle skill installation
  const handleInstall = useCallback(async (skill: MarketplaceSkill, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent row click
    setInstalling(skill.id)
    const toastId = toast.loading(`Installing ${skill.name}...`)

    try {
      const result = await window.electronAPI.marketplaceInstall(skill.topSource)

      if (result.success) {
        toast.success(`Installed ${skill.name}`, { id: toastId })
        onInstalled()
      } else {
        toast.error(`Failed to install ${skill.name}`, {
          id: toastId,
          description: result.error,
        })
      }
    } catch (error) {
      toast.error(`Failed to install ${skill.name}`, {
        id: toastId,
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setInstalling(null)
    }
  }, [onInstalled])

  // Handle skill click (for detail view)
  const handleSkillClick = useCallback((skill: MarketplaceSkill) => {
    onSkillSelect?.(skill)
  }, [onSkillSelect])

  // Format install count (e.g., 1234 -> 1.2k)
  const formatInstalls = (count: number) => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
    return count.toString()
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Search input */}
      <div className="p-3 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search marketplace..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Source filter badges */}
      <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b">
        <Badge
          variant={activeSource === null ? 'default' : 'outline'}
          className="cursor-pointer text-xs"
          onClick={() => setActiveSource(null)}
        >
          All
        </Badge>
        <Badge
          variant={activeSource === 'skills.sh' ? 'default' : 'outline'}
          className="cursor-pointer text-xs"
          onClick={() => setActiveSource('skills.sh')}
        >
          <Globe className="w-3 h-3 mr-1" />
          skills.sh
        </Badge>
        <Badge
          variant={activeSource === 'anthropics/skills' ? 'default' : 'outline'}
          className="cursor-pointer text-xs"
          onClick={() => setActiveSource('anthropics/skills')}
        >
          <Github className="w-3 h-3 mr-1" />
          anthropics
        </Badge>
        <Badge
          variant={activeSource === 'ComposioHQ/awesome-claude-skills' ? 'default' : 'outline'}
          className="cursor-pointer text-xs"
          onClick={() => setActiveSource('ComposioHQ/awesome-claude-skills')}
        >
          <Github className="w-3 h-3 mr-1" />
          ComposioHQ
        </Badge>
      </div>

      {/* Skills list */}
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center px-4">
            <Package className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {query ? 'No skills found' : 'Search for skills to install'}
            </p>
          </div>
        ) : (
          <div className="pb-2 pt-2">
            {filteredSkills.map((skill, index) => (
              <SkillRow
                key={skill.id}
                skill={skill}
                isSelected={selectedSkillId === skill.id}
                isFirst={index === 0}
                installing={installing === skill.id}
                onInstall={(e) => handleInstall(skill, e)}
                onClick={() => handleSkillClick(skill)}
                formatInstalls={formatInstalls}
              />
            ))}
            {hasMore && (
              <div className="px-4 py-3 text-center">
                <p className="text-xs text-muted-foreground">
                  Showing first results. Refine your search for more.
                </p>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

interface SkillRowProps {
  skill: MarketplaceSkill
  isSelected: boolean
  isFirst: boolean
  installing: boolean
  onInstall: (e: React.MouseEvent) => void
  onClick: () => void
  formatInstalls: (count: number) => string
}

function SkillRow({
  skill,
  isSelected,
  isFirst,
  installing,
  onInstall,
  onClick,
  formatInstalls,
}: SkillRowProps) {
  return (
    <div className="skill-item" data-selected={isSelected || undefined}>
      {/* Separator - only show if not first */}
      {!isFirst && (
        <div className="skill-separator pl-4 pr-4">
          <Separator />
        </div>
      )}
      {/* Row content */}
      <div
        className={cn(
          'flex items-center justify-between px-4 py-3 cursor-pointer transition-all rounded-[8px] mx-2',
          isSelected
            ? 'bg-foreground/5 hover:bg-foreground/7'
            : 'hover:bg-foreground/2'
        )}
        onClick={onClick}
      >
        <div className="flex flex-col gap-0.5 min-w-0 flex-1 pr-3">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-sm truncate">{skill.name}</span>
            {/* Source indicator */}
            <span className="text-muted-foreground shrink-0">
              {skill.source === 'skills.sh' ? (
                <Globe className="w-3 h-3" />
              ) : (
                <Github className="w-3 h-3" />
              )}
            </span>
          </div>
          <span className="text-xs text-muted-foreground truncate">
            {skill.topSource}{skill.installs != null ? ` · ${formatInstalls(skill.installs)} installs` : ''}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={installing}
          onClick={onInstall}
          className="shrink-0"
        >
          {installing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <>
              <Download className="h-3.5 w-3.5 mr-1" />
              Install
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
