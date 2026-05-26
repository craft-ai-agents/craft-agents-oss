import * as React from 'react'
import { Check, Loader2, Minus, Plus } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import type { MarketplaceSkillListing } from '../types'

export function SkillIcon({ icon, iconBg }: { icon: string; iconBg?: string }) {
  return (
    <div
      className={cn(
        'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white',
        iconBg ?? 'bg-foreground',
      )}
    >
      {icon}
    </div>
  )
}

export function SkillRow({
  skill,
  onInstall,
  onDelete,
  onClick,
  currentUserId,
  isInstalling = false,
}: {
  skill: MarketplaceSkillListing
  onInstall: (s: MarketplaceSkillListing) => void
  onDelete: (s: MarketplaceSkillListing) => void
  onClick: (s: MarketplaceSkillListing) => void
  currentUserId: string | null
  isInstalling?: boolean
}) {
  const installed = skill.installState === 'installed'
  const isOwner = Boolean(currentUserId && skill.ownerId === currentUserId)
  const isNew = skill.publishedAt
    ? Date.now() - new Date(skill.publishedAt).getTime() < 7 * 24 * 60 * 60 * 1000
    : false

  return (
    <button
      type="button"
      onClick={() => onClick(skill)}
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-foreground/[0.04]"
    >
      <SkillIcon icon={skill.icon} iconBg={skill.iconBg} />

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-[14px] font-semibold text-foreground">
          <span className="truncate">{skill.name}</span>
          {isNew && (
            <span className="flex-shrink-0 rounded px-1 py-0.5 text-[10px] font-medium leading-none bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">NEW</span>
          )}
        </p>
        {skill.description.length > 20 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="truncate text-[12px] text-muted-foreground cursor-default">
                {skill.description.slice(0, 20)}...
              </p>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[240px] text-sm">
              {skill.description}
            </TooltipContent>
          </Tooltip>
        ) : (
          <p className="truncate text-[12px] text-muted-foreground">{skill.description}</p>
        )}
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground/70">
          <span>{skill.owner}</span>
          <span>·</span>
          <span>{skill.installCount.toLocaleString()} 次安装</span>
        </div>
      </div>

      {/* 操作按钮区：横排，删除从左侧淡入 */}
      <div className="flex flex-shrink-0 items-center gap-1.5">
        {/* 删除按钮 — 仅上传人可见，hover 时从左侧淡入 */}
        {isOwner && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onDelete(skill) }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onDelete(skill) } }}
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-red-300 text-red-400 opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0 hover:border-red-500 hover:text-red-600 dark:border-red-500/40 dark:text-red-400/70 dark:hover:border-red-400 dark:hover:text-red-400"
              >
                <Minus className="h-3.5 w-3.5" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-sm">删除</TooltipContent>
          </Tooltip>
        )}

        {/* 安装状态 */}
        {installed ? (
          <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <Check className="h-3 w-3" />
            已安装
          </span>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                role="button"
                tabIndex={0}
                onClick={(e) => { if (isInstalling) return; e.stopPropagation(); onInstall(skill) }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { if (isInstalling) return; e.stopPropagation(); onInstall(skill) } }}
                className={cn(
                  'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border transition-colors',
                  isInstalling
                    ? 'cursor-default border-foreground/10 text-foreground/30'
                    : 'cursor-pointer border-foreground/20 text-foreground/50 hover:border-foreground/50 hover:text-foreground',
                )}
              >
                {isInstalling
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Plus className="h-3.5 w-3.5" />}
              </div>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-sm">{isInstalling ? '安装中…' : '安装'}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </button>
  )
}

export function SkillGrid({
  skills,
  onInstall,
  onDelete,
  onClick,
  currentUserId,
  installingIds = new Set(),
}: {
  skills: MarketplaceSkillListing[]
  onInstall: (s: MarketplaceSkillListing) => void
  onDelete: (s: MarketplaceSkillListing) => void
  onClick: (s: MarketplaceSkillListing) => void
  currentUserId: string | null
  installingIds?: Set<string>
}) {
  if (skills.length === 0) return null

  const left = skills.filter((_, i) => i % 2 === 0)
  const right = skills.filter((_, i) => i % 2 === 1)

  return (
    <div className="grid grid-cols-2 gap-x-6">
      <div className="divide-y divide-border/50">
        {left.map((s) => <SkillRow key={s.id} skill={s} onInstall={onInstall} onDelete={onDelete} onClick={onClick} currentUserId={currentUserId} isInstalling={installingIds.has(s.id)} />)}
      </div>
      <div className="divide-y divide-border/50">
        {right.map((s) => <SkillRow key={s.id} skill={s} onInstall={onInstall} onDelete={onDelete} onClick={onClick} currentUserId={currentUserId} isInstalling={installingIds.has(s.id)} />)}
      </div>
    </div>
  )
}
