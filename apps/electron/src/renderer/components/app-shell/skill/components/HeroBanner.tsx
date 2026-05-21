import * as React from 'react'
import { Loader2, MessageCircle, Plus } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import type { MarketplaceSkillListing } from '../types'

export const HERO_BANNER_COUNT = 5

export function HeroBanner({
  listings,
  installedIds,
  installingIds,
  onInstall,
}: {
  listings: MarketplaceSkillListing[]
  installedIds: Set<string>
  installingIds: Set<string>
  onInstall: (s: MarketplaceSkillListing, onInstalled?: () => void) => void
}) {
  const slides = React.useMemo(() => {
    if (listings.length === 0) return []
    const pool = [...listings]
    // Fisher-Yates shuffle, take first HERO_BANNER_COUNT
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]]
    }
    return pool.slice(0, HERO_BANNER_COUNT)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings.length === 0])  // only re-pick when list goes from empty→populated

  const [idx, setIdx] = React.useState(0)
  const [installPrompt, setInstallPrompt] = React.useState<MarketplaceSkillListing | null>(null)

  React.useEffect(() => {
    if (slides.length === 0) return
    const t = setInterval(() => setIdx((i) => (i + 1) % slides.length), 3500)
    return () => clearInterval(t)
  }, [slides.length])

  if (slides.length === 0) return null

  const slide = slides[idx]
  const isInstalled = (s: MarketplaceSkillListing) =>
    installedIds.has(s.id) || s.installState === 'installed'

  const handleUseClick = () => {
    if (isInstalled(slide)) {
      navigate(routes.action.newSession({ input: `[skill:${slide.slug}] ` }))
    } else {
      setInstallPrompt(slide)
    }
  }

  const promptSkill = installPrompt
  const promptInstalling = promptSkill ? installingIds.has(promptSkill.id) : false
  const promptInstalled = promptSkill ? isInstalled(promptSkill) : false

  return (
    <>
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-100 via-purple-50 to-indigo-100 dark:from-violet-950/40 dark:via-purple-900/30 dark:to-indigo-900/30">
        <div className="pointer-events-none absolute -left-16 -top-16 h-64 w-64 rounded-full bg-purple-300/30 blur-3xl dark:bg-purple-500/20" />
        <div className="pointer-events-none absolute -bottom-16 -right-16 h-64 w-64 rounded-full bg-indigo-300/30 blur-3xl dark:bg-indigo-500/20" />

        <div className="relative flex flex-col items-center px-8 py-10">
          <div className="mb-4 flex w-full max-w-lg items-center gap-3 rounded-xl bg-white/80 px-5 py-3 shadow-thin backdrop-blur-sm dark:bg-black/30">
            <div className={cn('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white', slide.iconBg ?? 'bg-foreground')}>
              {slide.icon}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-foreground">{slide.name}</p>
              {slide.description && (
                <p className="truncate text-[12px] text-muted-foreground">{slide.description}</p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={handleUseClick}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-85"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            在对话中试用
          </button>
        </div>

        <div className="absolute right-4 top-1/2 flex -translate-y-1/2 flex-col gap-1.5">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIdx(i)}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === idx ? 'w-3 bg-amber-500' : 'w-1.5 bg-foreground/20 hover:bg-foreground/40',
              )}
            />
          ))}
        </div>
      </div>

      {/* 安装确认弹窗 */}
      <Dialog open={installPrompt !== null} onOpenChange={(open) => { if (!open) setInstallPrompt(null) }}>
        <DialogContent className="max-w-sm p-0 overflow-hidden">
          {promptSkill && (
            <div className="flex flex-col items-center px-8 py-8">
              {/* 图标 */}
              <div className={cn('mb-5 flex h-16 w-16 items-center justify-center rounded-2xl text-xl font-bold text-white', promptSkill.iconBg ?? 'bg-foreground')}>
                {promptSkill.icon}
              </div>

              {/* 标题 */}
              <h2 className="mb-1 text-[18px] font-semibold text-foreground">
                {promptInstalled ? '在对话中使用' : `安装 ${promptSkill.name}`}
              </h2>
              {promptSkill.owner && (
                <p className="mb-5 text-[13px] text-muted-foreground">由 {promptSkill.owner} 开发</p>
              )}

              {/* 描述 */}
              {promptSkill.description && (
                <p className="mb-6 text-center text-[13px] text-muted-foreground leading-relaxed">
                  {promptSkill.description}
                </p>
              )}

              {/* 主操作按钮 */}
              {promptInstalled ? (
                <button
                  type="button"
                  onClick={() => {
                    setInstallPrompt(null)
                    navigate(routes.action.newSession({ input: `[skill:${promptSkill.slug}] ` }))
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-3 text-[14px] font-semibold text-white transition-opacity hover:opacity-85"
                >
                  <MessageCircle className="h-4 w-4" />
                  在对话中试用
                </button>
              ) : (
                <button
                  type="button"
                  disabled={promptInstalling}
                  onClick={() => {
                    onInstall(promptSkill, () => {
                      // onInstalled: 安装成功后关闭弹窗并导航
                      setInstallPrompt(null)
                      navigate(routes.action.newSession({ input: `[skill:${promptSkill.slug}] ` }))
                    })
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-foreground py-3 text-[14px] font-semibold text-background transition-opacity hover:opacity-85 disabled:opacity-50"
                >
                  {promptInstalling
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Plus className="h-4 w-4" />
                  }
                  {promptInstalling ? '安装中...' : `安装 ${promptSkill.name}`}
                </button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
