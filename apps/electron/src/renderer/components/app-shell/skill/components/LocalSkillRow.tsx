import * as React from 'react'
import { Minus } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { skillIconBg } from '../copaw-mapping'
import type { LoadedSkill } from '../../../../../shared/types'

export function LocalSkillIcon({ skill }: { skill: LoadedSkill }) {
  const label = skill.slug.slice(0, 1).toUpperCase()
  const colorClass = skillIconBg(skill.slug)

  return (
    <div className={cn('flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white', colorClass)}>
      {label}
    </div>
  )
}

export function LocalSkillRow({
  skill,
  onUninstall,
  onClick,
}: {
  skill: LoadedSkill
  onUninstall: (s: LoadedSkill) => void
  onClick: (s: LoadedSkill) => void
}) {
  const name = skill.metadata?.name ?? skill.slug
  const description = skill.metadata?.description ?? ''
  const author = skill.marketplaceOrigin?.ownerDisplayName ?? skill.metadata?.author

  return (
    <button
      type="button"
      onClick={() => onClick(skill)}
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-foreground/[0.04]"
    >
      <LocalSkillIcon skill={skill} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="truncate text-[14px] font-semibold text-foreground">{name}</p>
          {author && <span className="flex-shrink-0 text-[11px] text-muted-foreground/70">{author}</span>}
        </div>
        {description.length > 20 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="truncate text-[12px] text-muted-foreground cursor-default">
                {description.slice(0, 20)}...
              </p>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[240px] text-sm">
              {description}
            </TooltipContent>
          </Tooltip>
        ) : (
          <p className="truncate text-[12px] text-muted-foreground">{description || '—'}</p>
        )}
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); onUninstall(skill) }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onUninstall(skill) } }}
        className="flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border border-foreground/20 text-foreground/50 opacity-0 transition-all group-hover:opacity-100 hover:border-red-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
      >
        <Minus className="h-3.5 w-3.5" />
      </div>
    </button>
  )
}

export function LocalSkillGrid({
  skills,
  onUninstall,
  onClick,
}: {
  skills: LoadedSkill[]
  onUninstall: (s: LoadedSkill) => void
  onClick: (s: LoadedSkill) => void
}) {
  if (skills.length === 0) return null

  const left = skills.filter((_, i) => i % 2 === 0)
  const right = skills.filter((_, i) => i % 2 === 1)

  return (
    <div className="grid grid-cols-2 gap-x-6">
      <div className="divide-y divide-border/50">
        {left.map((s) => <LocalSkillRow key={s.slug} skill={s} onUninstall={onUninstall} onClick={onClick} />)}
      </div>
      <div className="divide-y divide-border/50">
        {right.map((s) => <LocalSkillRow key={s.slug} skill={s} onUninstall={onUninstall} onClick={onClick} />)}
      </div>
    </div>
  )
}
