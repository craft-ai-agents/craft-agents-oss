import * as React from 'react'
import { toast } from 'sonner'
import { Search, Store, UserCog, Zap } from 'lucide-react'
import { unzipSync } from 'fflate'
import { useAppShellContext } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import type {
  MarketplaceOriginMetadata,
  CopawMarketSkill,
} from '@craft-agent/shared/skills'

import type { MarketplaceApi, MarketplaceSkillListing, MarketplaceInstallState, MarketplaceCatalogFilters, MarketplacePublishResult } from './types'
import { USE_MOCK_MARKET, MOCK_MARKET_SKILLS, MOCK_LOCAL_SKILLS } from './mock-data'
import { mapCopawSkillToListing } from './copaw-mapping'
import { defaultMarketplaceApi } from './marketplace-api'
import { ConfirmDialog } from './components/ConfirmDialog'
import { HeroBanner } from './components/HeroBanner'
import { SkillGrid } from './components/MarketSkillRow'
import { SkillDetailDialog } from './components/SkillDetailDialog'
import { LocalSkillGrid } from './components/LocalSkillRow'
import { LocalSkillDetailDialog } from './components/LocalSkillDetailDialog'
import { CreateSkillDialog } from './components/CreateSkillDialog'
import { PublishSkillDialog } from './components/PublishSkillDialog'
import { CategoryDropdown, LocalOriginDropdown, LocalCreateDropdown } from './components/Dropdowns'
import type { PageTab, LocalOriginFilter } from './components/Dropdowns'
import type { Category } from './copaw-mapping'
import type { LoadedSkill } from '../../../../shared/types'

// ============================================================================
// Main Page
// ============================================================================

export function SkillMarketplacePage({
  workspaceId,
  currentUserId,
  api = defaultMarketplaceApi,
  onSkillClick,
}: {
  workspaceId: string
  currentUserId: string | null
  api?: MarketplaceApi
  onSkillClick?: (skill: MarketplaceSkillListing) => void
}) {
  const [tab, setTab] = React.useState<PageTab>('market')
  const [marketSearch, setMarketSearch] = React.useState('')
  const [localSearch, setLocalSearch] = React.useState('')
  const [category, setCategory] = React.useState<Category>('DevOps')
  const [marketSkills, setMarketSkills] = React.useState<MarketplaceSkillListing[]>([])
  const [installedIds, setInstalledIds] = React.useState<Set<string>>(new Set())
  const [installingIds, setInstallingIds] = React.useState<Set<string>>(new Set())
  const [selectedSkill, setSelectedSkill] = React.useState<MarketplaceSkillListing | null>(null)
  const [selectedLocalSkill, setSelectedLocalSkill] = React.useState<LoadedSkill | null>(null)
  const [localSkillSlugs, setLocalSkillSlugs] = React.useState<Set<string>>(new Set())
  const [localOriginFilter, setLocalOriginFilter] = React.useState<LocalOriginFilter>('全部')
  const [publishOpen, setPublishOpen] = React.useState(false)
  const [publishSourceSkill, setPublishSourceSkill] = React.useState<LoadedSkill | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [uploadedSkills, setUploadedSkills] = React.useState<LoadedSkill[]>([])
  const [confirmDialog, setConfirmDialog] = React.useState<{
    title: string
    description: string
    onConfirm: () => void
  } | null>(null)
  const [uploadError, setUploadError] = React.useState<string | null>(null)
  const uploadZipInputRef = React.useRef<HTMLInputElement>(null)

  // Persist CoPaw market-installed skill slugs across sessions via localStorage.
  // useState (not useRef) so that updates trigger re-renders and filteredLocal re-classifies immediately.
  const [copawInstalledSlugs, setCopawInstalledSlugs] = React.useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('copaw-installed-slugs')
      return new Set<string>(stored ? JSON.parse(stored) as string[] : [])
    } catch { return new Set<string>() }
  })
  const addCopawInstalledSlug = React.useCallback((slug: string) => {
    setCopawInstalledSlugs((prev) => {
      const next = new Set(prev)
      next.add(slug)
      try { localStorage.setItem('copaw-installed-slugs', JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }, [])
  const removeCopawInstalledSlug = React.useCallback((slug: string) => {
    setCopawInstalledSlugs((prev) => {
      const next = new Set(prev)
      next.delete(slug)
      try { localStorage.setItem('copaw-installed-slugs', JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }, [])

  const effectiveCurrentUserId = USE_MOCK_MARKET ? 'MOCK_CURRENT_USER' : currentUserId

  const { skills: ctxSkills = [] } = useAppShellContext()

  // Local fetch state: populated by direct getSkills calls, bypasses context/cache
  const [fetchedSkills, setFetchedSkills] = React.useState<LoadedSkill[] | null>(null)

  const fetchSkills = React.useCallback(() => {
    window.electronAPI?.getSkills(workspaceId).then((loaded) => {
      if (!loaded) return
      setFetchedSkills(loaded)
      const loadedSlugs = new Set(loaded.map((s) => s.slug))
      setUploadedSkills((prev) => prev.filter((s) => loadedSlugs.has(s.slug)))
    }).catch(() => {})
  }, [workspaceId])

  // Fetch on mount and when workspaceId changes
  React.useEffect(() => { fetchSkills() }, [workspaceId])

  const effectiveSkills = fetchedSkills ?? ctxSkills
  const baseLocalSkills = USE_MOCK_MARKET ? (effectiveSkills.length > 0 ? effectiveSkills : MOCK_LOCAL_SKILLS) : effectiveSkills
  const localSkills = React.useMemo(() => {
    const ctxSlugs = new Set(baseLocalSkills.map((s) => s.slug))
    const uniqueUploaded = uploadedSkills.filter((s) => !ctxSlugs.has(s.slug))
    return [...baseLocalSkills, ...uniqueUploaded]
  }, [baseLocalSkills, uploadedSkills])

  const handleUploadZip = React.useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploadError(null)


    if (!file.name.toLowerCase().endsWith('.zip')) {
      setUploadError('只支持 .zip 文件')
      return
    }

    try {
      const buffer = await file.arrayBuffer()
      const zipBytes = new Uint8Array(buffer)
      const unzipped = unzipSync(zipBytes)

      // 找 SKILL.md（支持顶层或一级子目录）
      const skillMdKey = Object.keys(unzipped).find((k) =>
        k.toLowerCase() === 'skill.md' || k.toLowerCase().match(/^[^/]+\/skill\.md$/)
      )
      if (!skillMdKey) {
        setUploadError('zip 中未找到 SKILL.md 文件')
        return
      }

      const rawContent = new TextDecoder().decode(unzipped[skillMdKey])

      // 只读取 name/display_name/description 用于 UI 显示，不用于写磁盘
      const fmMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
      const body = fmMatch ? fmMatch[2].trim() : rawContent
      const yamlStr = fmMatch ? fmMatch[1] : ''
      const getYamlVal = (key: string) => {
        const m = yamlStr.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
        return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : undefined
      }

      // Sanitize: strip non-slug characters so the directory name is always valid
      const slug = file.name
        .replace(/\.zip$/i, '')
        .toLowerCase()
        .replace(/[\s]+/g, '-')
        .replace(/[^a-z0-9_-]/g, '')
        .replace(/^[-_]+|[-_]+$/g, '') // trim leading/trailing separators
        || 'skill'
      const name = getYamlVal('display_name') ?? getYamlVal('name') ?? slug
      const description = getYamlVal('description') ?? ''

      const parsedMetadata = { name, description }
      const newSkill: LoadedSkill = {
        slug,
        metadata: parsedMetadata,
        content: body,
        path: `~/.agents/skills/${slug}`,
        source: 'global',
        // 无 marketplaceOrigin → 自动归入「本地上传」
      }

      // 写入磁盘：原样解压所有文件，保留 SKILL.md 全部字段（不做 matter.stringify 格式化）
      let diskSaved = true
      try {
        await window.electronAPI.installLocalZip(workspaceId, slug, zipBytes)
      } catch {
        diskSaved = false
      }

      setUploadedSkills((prev) => {
        // 如果 slug 已存在则替换
        const exists = prev.findIndex((s) => s.slug === slug)
        if (exists >= 0) {
          const next = [...prev]
          next[exists] = newSkill
          return next
        }
        return [...prev, newSkill]
      })
      // Clear from optimistic-hide set so a previously uninstalled skill with the same slug reappears
      setLocalSkillSlugs((prev) => { const n = new Set(prev); n.delete(slug); return n })
      if (diskSaved) {
        toast.success(`「${name}」上传成功`)
      } else {
        toast.warning(`「${name}」已加载，但保存到磁盘失败，重启后将丢失`)
      }
      setTab('local')
    } catch {
      setUploadError('解析 zip 失败，请检查文件格式')
    }
  }, [workspaceId])

  const localSlugs = React.useMemo(() => new Set(localSkills.map((s) => s.slug)), [localSkills])
  const rawMarketSkillsRef = React.useRef<CopawMarketSkill[]>([])

  // Fetch once on mount
  React.useEffect(() => {
    const load = USE_MOCK_MARKET
      ? Promise.resolve(MOCK_MARKET_SKILLS)
      : window.electronAPI.listMarketSkills()
    load
      .then((raw) => {
        rawMarketSkillsRef.current = raw
        setMarketSkills(raw.map((s) => mapCopawSkillToListing(s, localSlugs)))
      })
      .catch(console.error)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-map install states when local skills change, without re-fetching
  React.useEffect(() => {
    if (rawMarketSkillsRef.current.length > 0) {
      setMarketSkills(rawMarketSkillsRef.current.map((s) => mapCopawSkillToListing(s, localSlugs)))
    }
  }, [localSlugs])

  const filtered = React.useMemo(() => {
    const q = marketSearch.trim().toLowerCase()
    return marketSkills
      .filter((s) => {
        const matchCat = category === '全部' || s.category === category
        const matchQ = !q || s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.owner.toLowerCase().includes(q)
        return matchCat && matchQ
      })
      .map((s) => ({
        ...s,
        installState: (installedIds.has(s.id) ? 'installed' : s.installState) as MarketplaceInstallState,
      }))
      .sort((a, b) => b.installCount - a.installCount)
  }, [marketSkills, category, marketSearch, installedIds])

  const filteredLocal = React.useMemo(() => {
    const q = localSearch.trim().toLowerCase()
    const isMarketInstalled = (s: LoadedSkill) =>
      s.marketplaceOrigin != null || copawInstalledSlugs.has(s.slug)
    return localSkills.filter((s) => {
      const matchOrigin =
        localOriginFilter === '全部' ||
        (localOriginFilter === '市场安装' && isMarketInstalled(s)) ||
        (localOriginFilter === '本地上传' && !isMarketInstalled(s))
      const matchQ =
        !q ||
        s.slug.toLowerCase().includes(q) ||
        (s.metadata?.name ?? s.slug).toLowerCase().includes(q) ||
        (s.metadata?.description ?? '').toLowerCase().includes(q) ||
        (s.metadata?.author ?? '').toLowerCase().includes(q)
      return matchOrigin && matchQ
    })
  }, [localSkills, localSearch, localOriginFilter, copawInstalledSlugs])

  const handleInstall = React.useCallback(async (s: MarketplaceSkillListing, onInstalled?: () => void) => {
    if (installingIds.has(s.id)) return
    setInstallingIds((prev) => new Set([...prev, s.id]))
    try {
      if (USE_MOCK_MARKET) {
        await new Promise((r) => setTimeout(r, 600)) // simulate network
        setInstalledIds((prev) => new Set([...prev, s.id]))
        setSelectedSkill((prev) => prev?.id === s.id ? { ...prev, installState: 'installed' } : prev)
        toast.success(`「${s.name}」安装成功`)
        onInstalled?.()
        return
      }
      const result = await window.electronAPI.installMarketSkill(
        workspaceId,
        s.slug,
        s.name,          // chineseName (已由 mapCopawSkillToListing 取 chineseName ?? name)
        s.description,
        s.latestVersion,
      )
      if (result.conflicts.length > 0 && result.count === 0) {
        const conflictNames = result.conflicts.map((c) => c.skill_name).join('、')
        toast.warning(`安装冲突，与本地已有技能冲突：${conflictNames}`)
        return
      }
      addCopawInstalledSlug(s.slug)
      setInstalledIds((prev) => new Set([...prev, s.id]))
      // Clear from optimistic-hide set in case the user is reinstalling a previously uninstalled skill
      setLocalSkillSlugs((prev) => { const n = new Set(prev); n.delete(s.slug); return n })
      setSelectedSkill((prev) => prev?.id === s.id ? { ...prev, installState: 'installed' } : prev)
      toast.success(`「${s.name}」安装成功`)
      onInstalled?.()
    } catch (err) {
      toast.error(`安装失败：${err instanceof Error ? err.message : '请稍后重试'}`)
    } finally {
      setInstallingIds((prev) => { const n = new Set(prev); n.delete(s.id); return n })
    }
  }, [workspaceId, installingIds, addCopawInstalledSlug])

  const handleUninstall = React.useCallback((s: MarketplaceSkillListing) => {
    setConfirmDialog({
      title: '删除技能',
      description: `确定要从市场删除「${s.name}」吗？此操作不可撤销。`,
      onConfirm: async () => {
        setConfirmDialog(null)
        if (!USE_MOCK_MARKET) {
          try {
            await window.electronAPI.deleteMarketSkill(s.slug)
          } catch (err) {
            toast.error(`删除失败：${err instanceof Error ? err.message : '请稍后重试'}`)
            return
          }
        }
        // Remove from market list
        rawMarketSkillsRef.current = rawMarketSkillsRef.current.filter((r) => r.name !== s.slug)
        setMarketSkills((prev) => prev.filter((m) => m.id !== s.id))
        setSelectedSkill(null)
        toast.success(`「${s.name}」已从市场删除`)
      },
    })
  }, [])

  const handleClick = React.useCallback((s: MarketplaceSkillListing) => {
    setSelectedSkill(s)
    onSkillClick?.(s)
  }, [onSkillClick])

  const handleLocalUninstall = React.useCallback((s: LoadedSkill) => {
    const name = s.metadata?.name ?? s.slug
    setConfirmDialog({
      title: '卸载技能',
      description: `确定要卸载本地技能「${name}」吗？`,
      onConfirm: () => {
        setConfirmDialog(null)
        setLocalSkillSlugs((prev) => new Set([...prev, s.slug]))
        setSelectedLocalSkill(null)
        window.electronAPI.deleteSkill(workspaceId, s.slug, s.source, s.path)
          .then(() => {
            removeCopawInstalledSlug(s.slug)
            // Clear from installedIds so the market tab shows the skill as not-installed
            setInstalledIds((prev) => { const n = new Set(prev); n.delete(s.slug); return n })
            // Clear from uploadedSkills so it doesn't resurrect via the de-dup logic in localSkills
            setUploadedSkills((prev) => prev.filter((u) => u.slug !== s.slug))
            toast.success(`「${name}」已卸载`)
          })
          .catch((err) => {
            // Revert optimistic removal on failure
            setLocalSkillSlugs((prev) => { const n = new Set(prev); n.delete(s.slug); return n })
            toast.error(`卸载失败：${err instanceof Error ? err.message : '请稍后重试'}`)
          })
      },
    })
  }, [workspaceId, removeCopawInstalledSlug])

  const handleMarketRefresh = React.useCallback(() => {
    if (USE_MOCK_MARKET) return
    window.electronAPI.listMarketSkills()
      .then((raw) => {
        rawMarketSkillsRef.current = raw
        setMarketSkills(raw.map((s) => mapCopawSkillToListing(s, localSlugs)))
      })
      .catch(console.error)
  }, [localSlugs])

  const displayedLocalSkills = React.useMemo(
    () => filteredLocal.filter((s) => !localSkillSlugs.has(s.slug)),
    [filteredLocal, localSkillSlugs],
  )

  // Derive selectedSkill from filtered so it stays in sync with marketSkills re-maps
  const derivedSelectedSkill = React.useMemo(
    () => selectedSkill ? (filtered.find((s) => s.id === selectedSkill.id) ?? selectedSkill) : null,
    [filtered, selectedSkill],
  )

  return (
    <>
    <ConfirmDialog
      open={Boolean(confirmDialog)}
      title={confirmDialog?.title ?? ''}
      description={confirmDialog?.description ?? ''}
      confirmLabel={confirmDialog?.title?.includes('卸载') ? '卸载' : '删除'}
      onConfirm={confirmDialog?.onConfirm ?? (() => {})}
      onCancel={() => setConfirmDialog(null)}
    />
    <CreateSkillDialog
      open={createOpen}
      workspaceId={workspaceId}
      onClose={() => setCreateOpen(false)}
      onCreated={(skill) => {
        setUploadedSkills((prev) => {
          const exists = prev.findIndex((s) => s.slug === skill.slug)
          if (exists >= 0) { const next = [...prev]; next[exists] = skill; return next }
          return [...prev, skill]
        })
        setTab('local')
      }}
    />
    <PublishSkillDialog
      open={publishOpen}
      onClose={() => { setPublishOpen(false); setPublishSourceSkill(null) }}
      workspaceId={workspaceId}
      currentUserId={effectiveCurrentUserId}
      sourceSkill={publishSourceSkill ?? undefined}
      onPublished={handleMarketRefresh}
    />
    <SkillDetailDialog
      skill={derivedSelectedSkill}
      onClose={() => setSelectedSkill(null)}
      onInstall={handleInstall}
      onUninstall={handleUninstall}
      currentUserId={effectiveCurrentUserId}
      isInstalling={selectedSkill ? installingIds.has(selectedSkill.id) : false}
    />
    <LocalSkillDetailDialog
      skill={selectedLocalSkill}
      workspaceId={workspaceId}
      onClose={() => setSelectedLocalSkill(null)}
      onUninstall={handleLocalUninstall}
      onPublish={(s) => { setSelectedLocalSkill(null); setPublishSourceSkill(s); setPublishOpen(true) }}
      isFromMarket={selectedLocalSkill ? copawInstalledSlugs.has(selectedLocalSkill.slug) : false}
    />
    <div className="flex h-full flex-col bg-background">

      {/* Tab 切换 — 固定顶部 */}
      <div className="flex flex-shrink-0 items-center justify-between px-4 pt-3 pb-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => { setTab('market'); fetchSkills() }}
            className={cn(
              'rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
              tab === 'market'
                ? 'bg-foreground/[0.08] text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            市场
          </button>
          <button
            type="button"
            onClick={() => { setTab('local'); fetchSkills() }}
            className={cn(
              'rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
              tab === 'local'
                ? 'bg-foreground/[0.08] text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            本地
          </button>
        </div>
        {tab === 'market' && (
          <button
            type="button"
            onClick={() => { setPublishSourceSkill(null); setPublishOpen(true) }}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3.5 py-1.5 text-[13px] font-medium text-foreground shadow-xs transition-colors hover:bg-foreground/[0.04]"
          >
            发布技能
          </button>
        )}
        {tab === 'local' && (
          <LocalCreateDropdown
            onUpload={() => { setUploadError(null); uploadZipInputRef.current?.click() }}
            onCreateSkill={() => setCreateOpen(true)}
          />
        )}
        <input ref={uploadZipInputRef} type="file" accept=".zip" className="hidden" onChange={handleUploadZip} />
      </div>

      <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-8 pb-12 pt-6">

        {tab === 'local' ? (
          /* ── 本地技能 Tab ── */
          <div>
            {/* 搜索 */}
            <div className="mb-5 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={localSearch}
                  onChange={(e) => setLocalSearch(e.target.value)}
                  placeholder="搜索本地技能"
                  className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <LocalOriginDropdown value={localOriginFilter} onChange={setLocalOriginFilter} />
            </div>
            {uploadError && <p className="mt-2 text-[12px] text-rose-500">{uploadError}</p>}

            {/* 空状态：完全没有本地技能 */}
            {localSkills.length === 0 && !localSearch && (
              <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
                <Zap className="h-8 w-8 opacity-30" />
                <p className="text-sm">还没有本地技能，前往市场安装吧</p>
                <button
                  type="button"
                  onClick={() => setTab('market')}
                  className="mt-1 rounded-lg bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-opacity hover:opacity-85"
                >
                  前往市场
                </button>
              </div>
            )}

            {/* 技能列表（有技能时） */}
            {displayedLocalSkills.length > 0 && (
              localOriginFilter === '全部' ? (
                // 全部：本地上传在上，市场安装在下
                <>
                  {(['本地上传', '市场安装'] as const).map((section) => {
                    const sectionSkills = displayedLocalSkills.filter((s) => {
                      const fromMarket = s.marketplaceOrigin != null || copawInstalledSlugs.has(s.slug)
                      return section === '市场安装' ? fromMarket : !fromMarket
                    })
                    if (sectionSkills.length === 0) return null
                    return (
                      <div key={section} className="mb-8">
                        <h2 className="mb-3 text-[15px] font-semibold text-foreground">
                          {section}
                          <span className="ml-2 text-[13px] font-normal text-muted-foreground">{sectionSkills.length}</span>
                        </h2>
                        <LocalSkillGrid
                          skills={sectionSkills}
                          onUninstall={handleLocalUninstall}
                          onClick={setSelectedLocalSkill}
                        />
                      </div>
                    )
                  })}
                </>
              ) : (
                <>
                  <h2 className="mb-3 text-[15px] font-semibold text-foreground">
                    {localOriginFilter}
                    <span className="ml-2 text-[13px] font-normal text-muted-foreground">{displayedLocalSkills.length}</span>
                  </h2>
                  <LocalSkillGrid
                    skills={displayedLocalSkills}
                    onUninstall={handleLocalUninstall}
                    onClick={setSelectedLocalSkill}
                  />
                </>
              )
            )}

            {/* 空状态：有技能但当前搜索/筛选无结果 */}
            {displayedLocalSkills.length === 0 && (localSkills.length > 0 || localSearch) && (
              <div className="py-12 text-center text-[13px] text-muted-foreground">
                {localSearch ? '没有匹配的技能' : '当前分类下没有技能'}
              </div>
            )}
          </div>
        ) : (
          /* ── 市场 Tab ── */
          <>
        {/* 标题 */}
        <h1 className="mb-6 text-center text-[26px] font-semibold tracking-tight text-foreground">
          让 MDP 按你的方式工作
        </h1>

        {/* 搜索 + 类别筛选 */}
        <div className="mb-5 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={marketSearch}
              onChange={(e) => setMarketSearch(e.target.value)}
              placeholder="搜索技能"
              className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <CategoryDropdown value={category} onChange={setCategory} />
        </div>

        {/* Hero */}
        <div className="mb-8">
          <HeroBanner
            listings={marketSkills}
            installedIds={installedIds}
            installingIds={installingIds}
            onInstall={handleInstall}
          />
        </div>

        {/* 技能列表 */}
        {filtered.length === 0 ? (
          <p className="py-12 text-center text-[13px] text-muted-foreground">
            {marketSearch.trim() ? '没有匹配的技能' : '暂无技能'}
          </p>
        ) : category === '全部' ? (
          <>
            {(['DevOps', '公共'] as const).map((cat) => {
              const catSkills = filtered.filter((s) => s.category === cat)
              if (catSkills.length === 0) return null
              return (
                <div key={cat} className="mb-8">
                  <h2 className="mb-3 text-[15px] font-semibold text-foreground">{cat}</h2>
                  <SkillGrid skills={catSkills} onInstall={handleInstall} onDelete={handleUninstall} onClick={handleClick} currentUserId={effectiveCurrentUserId} installingIds={installingIds} />
                </div>
              )
            })}
          </>
        ) : (
          <div>
            <h2 className="mb-3 text-[15px] font-semibold text-foreground">{category}</h2>
            <SkillGrid skills={filtered} onInstall={handleInstall} onDelete={handleUninstall} onClick={handleClick} currentUserId={effectiveCurrentUserId} installingIds={installingIds} />
          </div>
        )}
          </>
        )}
      </div>
      </div>
    </div>
    </>
  )
}

// ============================================================================
// 兼容性导出（被其他文件依赖）
// ============================================================================

export function SkillMarketplacePageHeader({
  currentUserId,
  serviceEnvironmentLabel,
  onPublishClick,
}: {
  currentUserId: string | null
  serviceEnvironmentLabel: string
  onPublishClick?: () => void
}) {
  const canPublish = Boolean(currentUserId)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <Store className="h-4 w-4" />
        <span>技能市场</span>
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {serviceEnvironmentLabel}
        </span>
      </div>
      <button
        type="button"
        disabled={!canPublish}
        onClick={onPublishClick}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
      >
        <UserCog className="h-3.5 w-3.5" />
        {canPublish ? '发布技能' : '登录后发布'}
      </button>
    </div>
  )
}

export function MarketplaceEmptyState({ canPublish, onPublishClick }: { canPublish: boolean; onPublishClick: () => void }) {
  return (
    <div className="p-3 text-sm text-muted-foreground">
      <p>暂无匹配的技能</p>
      <button
        type="button"
        disabled={!canPublish}
        onClick={onPublishClick}
        className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
      >
        <UserCog className="h-3.5 w-3.5" />
        {canPublish ? '发布技能' : '登录后发布'}
      </button>
    </div>
  )
}

export function MarketplaceListingCard({
  listing,
  selected,
  onSelect,
}: {
  listing: MarketplaceSkillListing
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'mb-2 flex w-full min-w-0 items-center gap-3 rounded-lg border p-3 text-left transition-colors',
        selected ? 'border-foreground/40 bg-muted/60' : 'border-border hover:bg-muted/40',
      )}
    >
      <div className={cn('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white', listing.iconBg ?? 'bg-foreground')}>
        {listing.icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{listing.name}</p>
        <p className="truncate text-xs text-muted-foreground">{listing.description}</p>
      </div>
    </button>
  )
}

export function LocalSkillMarketplaceStatus({
  metadata,
  publishState = { status: 'idle' },
}: {
  metadata?: MarketplaceOriginMetadata | null
  publishState?: MarketplacePublishResult | { status: 'idle' | 'publishing' }
}) {
  if (publishState.status === 'publishing') {
    return <div className="rounded-md border border-border bg-muted/30 p-3 text-sm font-medium">正在发布到技能市场...</div>
  }
  if (publishState.status === 'published') {
    return (
      <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200">
        <span className="font-medium">已发布到技能市场</span>
        <span className="ml-2">/{publishState.marketplaceSlug}</span>
      </div>
    )
  }
  if (publishState.status === 'auth-required' || publishState.status === 'error' || publishState.status === 'slug-conflict') {
    return <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">{publishState.message}</div>
  }
  if (!metadata) {
    return <div className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">尚未发布到技能市场</div>
  }
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">已关联技能市场</span>
        <span className="text-muted-foreground">/{metadata.marketplaceSlug}</span>
        <span className="text-muted-foreground">v{metadata.installedVersion}</span>
        {metadata.modified && (
          <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-200">
            有未发布的改动
          </span>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">市场 ID：{metadata.marketplaceId}</p>
    </div>
  )
}

export function filterMarketplaceListings(
  listings: MarketplaceSkillListing[],
  filters: MarketplaceCatalogFilters,
): MarketplaceSkillListing[] {
  const q = filters.search?.trim().toLowerCase() ?? ''
  return listings.filter((l) => {
    const matchQ = !q || l.name.toLowerCase().includes(q) || l.description.toLowerCase().includes(q)
    const matchCat = !filters.category || l.category === filters.category
    return matchQ && matchCat
  })
}

export function MarketplacePublishSkillDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  currentUserId: string | null
  onPublished: (slug: string) => void
}) {
  if (!open) return null
  return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-modal-small">
        <h2 className="mb-4 text-base font-semibold">发布技能</h2>
        <p className="text-sm text-muted-foreground">发布功能开发中。</p>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

// Re-export values for backward compatibility
export { PRODUCT_MARKETPLACE_CATEGORIES, MARKETPLACE_DIRECT_PUBLISH_TABS } from './types'

// Re-export all types for backward compatibility
export type {
  MarketplaceInstallState,
  MarketplaceSkillListing,
  MarketplaceSkillVersion,
  MarketplaceSkillDetail,
  MarketplaceCatalogFilters,
  MarketplaceApi,
  MarketplacePublishApi,
  MarketplacePublishResult,
  MarketplaceSkillReportInput,
  MarketplaceOwnerUnpublishInput,
  MarketplaceReportResult,
  MarketplaceOwnerUnpublishResult,
  MarketplaceInstallElectronApi,
  MarketplaceUpdateElectronApi,
  MarketplaceDirectPublishElectronApi,
  StaticMarketplaceApiOptions,
} from './types'
export type { MarketplaceInstallIntent } from '@craft-agent/shared/skills'

// Re-export createStaticMarketplaceApi for backward compatibility
export { createStaticMarketplaceApi } from './marketplace-api'
