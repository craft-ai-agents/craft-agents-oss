import * as React from 'react'
import { AlertTriangle, CheckCircle2, Download, Flag, Search, ShieldAlert, Store, UserCog } from 'lucide-react'

export type MarketplaceInstallState =
  | 'install'
  | 'installed'
  | 'update-available'
  | 'modified-locally'
  | 'unavailable'
  | 'safety-blocked'

export const PRODUCT_MARKETPLACE_CATEGORIES = ['Documentation', 'Product', 'Quality', 'Security'] as const

export interface MarketplaceSkillListing {
  id: string
  slug: string
  icon: string
  name: string
  description: string
  owner: string
  category: string
  tags: string[]
  latestVersion: string
  installCount: number
  installState: MarketplaceInstallState
}

export interface MarketplaceSkillVersion {
  version: string
  publishedAt: string
  releaseNotes: string
}

export interface MarketplaceSkillDetail extends MarketplaceSkillListing {
  skillMarkdown: string
  requiredSources: string[]
  versions: MarketplaceSkillVersion[]
  metadata: {
    marketplaceId: string
    marketplaceSlug: string
    publishedAt: string
    updatedAt: string
  }
}

export interface MarketplaceCatalogFilters {
  search?: string
  category?: string
  tag?: string
}

export interface MarketplaceApi {
  listSkills: () => Promise<MarketplaceSkillListing[]>
  getSkillDetail: (slug: string) => Promise<MarketplaceSkillDetail>
}

export type MarketplaceCatalogState =
  | {
      status: 'ready'
      listings: MarketplaceSkillListing[]
      availableCategories: string[]
      availableTags: string[]
    }
  | { status: 'error'; message: string }

export type MarketplaceDetailState =
  | { status: 'ready'; detail: MarketplaceSkillDetail }
  | { status: 'error'; message: string }

const DEFAULT_MARKETPLACE_LISTINGS: MarketplaceSkillListing[] = [
  {
    id: 'mkt_skill_test_writer',
    slug: 'test-writer',
    icon: 'TW',
    name: 'Test Writer',
    description: 'Creates focused regression tests for bug fixes and feature slices.',
    owner: 'Craft Labs',
    category: 'Quality',
    tags: ['ci', 'testing', 'automation'],
    latestVersion: '1.4.2',
    installCount: 1284,
    installState: 'install',
  },
  {
    id: 'mkt_skill_api-docs',
    slug: 'api-docs',
    icon: 'AD',
    name: 'API Docs Companion',
    description: 'Keeps endpoint references and examples aligned with source changes.',
    owner: 'Docs Guild',
    category: 'Documentation',
    tags: ['api', 'docs'],
    latestVersion: '2.1.0',
    installCount: 847,
    installState: 'installed',
  },
  {
    id: 'mkt_skill_release-notes',
    slug: 'release-notes',
    icon: 'RN',
    name: 'Release Notes',
    description: 'Turns merged changes into concise release notes for product teams.',
    owner: 'Launch Team',
    category: 'Product',
    tags: ['release', 'writing'],
    latestVersion: '1.8.0',
    installCount: 2319,
    installState: 'update-available',
  },
  {
    id: 'mkt_skill_security-review',
    slug: 'security-review',
    icon: 'SR',
    name: 'Security Review',
    description: 'Checks code and configuration changes for common security risks.',
    owner: 'Secure Build',
    category: 'Security',
    tags: ['audit', 'security'],
    latestVersion: '3.0.1',
    installCount: 642,
    installState: 'safety-blocked',
  },
]

const DEFAULT_MARKETPLACE_DETAILS: Record<string, MarketplaceSkillDetail> = {
  'test-writer': {
    ...DEFAULT_MARKETPLACE_LISTINGS[0],
    skillMarkdown: [
      '---',
      'name: Test Writer',
      'description: Creates focused regression tests for bug fixes and feature slices.',
      '---',
      '',
      '# Test Writer',
      '',
      'Use this skill to add behavior-first regression tests before changing implementation code.',
    ].join('\n'),
    requiredSources: ['GitHub repository', 'Local workspace files'],
    versions: [
      { version: '1.4.2', publishedAt: '2026-05-01', releaseNotes: 'Adds CI-focused assertion guidance.' },
      { version: '1.3.0', publishedAt: '2026-04-12', releaseNotes: 'Improves integration test examples.' },
      { version: '1.0.0', publishedAt: '2026-03-18', releaseNotes: 'Initial public release.' },
    ],
    metadata: {
      marketplaceId: 'mkt_skill_test_writer',
      marketplaceSlug: 'test-writer',
      publishedAt: '2026-03-18',
      updatedAt: '2026-05-01',
    },
  },
  'api-docs': {
    ...DEFAULT_MARKETPLACE_LISTINGS[1],
    skillMarkdown: [
      '---',
      'name: API Docs Companion',
      'description: Keeps endpoint references and examples aligned with source changes.',
      '---',
      '',
      '# API Docs Companion',
      '',
      'Review changed handlers, schemas, and public examples before updating documentation.',
    ].join('\n'),
    requiredSources: ['API source files', 'Documentation directory'],
    versions: [
      { version: '2.1.0', publishedAt: '2026-04-28', releaseNotes: 'Adds schema drift checks.' },
      { version: '2.0.0', publishedAt: '2026-04-03', releaseNotes: 'Refreshes endpoint grouping.' },
    ],
    metadata: {
      marketplaceId: 'mkt_skill_api-docs',
      marketplaceSlug: 'api-docs',
      publishedAt: '2026-04-03',
      updatedAt: '2026-04-28',
    },
  },
  'release-notes': {
    ...DEFAULT_MARKETPLACE_LISTINGS[2],
    skillMarkdown: [
      '---',
      'name: Release Notes',
      'description: Turns merged changes into concise release notes for product teams.',
      '---',
      '',
      '# Release Notes',
      '',
      'Summarize completed work by user-visible outcome and include migration notes when needed.',
    ].join('\n'),
    requiredSources: ['Git history', 'Issue tracker'],
    versions: [
      { version: '1.8.0', publishedAt: '2026-05-03', releaseNotes: 'Adds owner-facing changelog sections.' },
      { version: '1.7.1', publishedAt: '2026-04-20', releaseNotes: 'Fixes duplicate bullet grouping.' },
    ],
    metadata: {
      marketplaceId: 'mkt_skill_release-notes',
      marketplaceSlug: 'release-notes',
      publishedAt: '2026-02-22',
      updatedAt: '2026-05-03',
    },
  },
  'security-review': {
    ...DEFAULT_MARKETPLACE_LISTINGS[3],
    skillMarkdown: [
      '---',
      'name: Security Review',
      'description: Checks code and configuration changes for common security risks.',
      '---',
      '',
      '# Security Review',
      '',
      'Inspect changed authentication, credential, network, and filesystem paths before release.',
    ].join('\n'),
    requiredSources: ['Changed code', 'Security policy docs'],
    versions: [
      { version: '3.0.1', publishedAt: '2026-04-30', releaseNotes: 'Safety blocked pending marketplace review.' },
      { version: '3.0.0', publishedAt: '2026-04-21', releaseNotes: 'Adds credential exposure checks.' },
    ],
    metadata: {
      marketplaceId: 'mkt_skill_security-review',
      marketplaceSlug: 'security-review',
      publishedAt: '2026-01-15',
      updatedAt: '2026-04-30',
    },
  },
}

export function createStaticMarketplaceApi(options?: {
  listings?: MarketplaceSkillListing[]
  details?: Record<string, MarketplaceSkillDetail>
  listError?: string
  detailError?: string
}): MarketplaceApi {
  const listings = options?.listings ?? DEFAULT_MARKETPLACE_LISTINGS
  const details = options?.details ?? DEFAULT_MARKETPLACE_DETAILS

  return {
    async listSkills() {
      if (options?.listError) throw new Error(options.listError)
      return listings
    },
    async getSkillDetail(slug) {
      if (options?.detailError) throw new Error(options.detailError)
      const detail = details[slug]
      if (!detail) throw new Error('Marketplace Skill not found.')
      return detail
    },
  }
}

export function filterMarketplaceListings(
  listings: MarketplaceSkillListing[],
  filters: MarketplaceCatalogFilters,
): MarketplaceSkillListing[] {
  const search = filters.search?.trim().toLowerCase() ?? ''
  const category = filters.category?.trim()
  const tag = filters.tag?.trim().toLowerCase()

  return listings.filter((listing) => {
    const matchesSearch = !search
      || listing.name.toLowerCase().includes(search)
      || listing.description.toLowerCase().includes(search)
      || listing.owner.toLowerCase().includes(search)
      || listing.tags.some((candidate) => candidate.toLowerCase().includes(search))
    const matchesCategory = !category || listing.category === category
    const matchesTag = !tag || listing.tags.some((candidate) => candidate.toLowerCase() === tag)

    return matchesSearch && matchesCategory && matchesTag
  })
}

export async function loadMarketplaceCatalog(
  api: MarketplaceApi,
  filters: MarketplaceCatalogFilters,
): Promise<MarketplaceCatalogState> {
  try {
    const listings = await api.listSkills()
    return {
      status: 'ready',
      listings: filterMarketplaceListings(listings, filters),
      availableCategories: [...PRODUCT_MARKETPLACE_CATEGORIES],
      availableTags: uniqueSorted(listings.flatMap((listing) => listing.tags)),
    }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'The Marketplace is unavailable.',
    }
  }
}

export async function loadMarketplaceDetail(
  api: MarketplaceApi,
  slug: string,
): Promise<MarketplaceDetailState> {
  try {
    return { status: 'ready', detail: await api.getSkillDetail(slug) }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'The Marketplace detail is unavailable.',
    }
  }
}

const defaultMarketplaceApi = createStaticMarketplaceApi()

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
}

function formatInstallCount(count: number): string {
  return new Intl.NumberFormat(undefined, { notation: count >= 10000 ? 'compact' : 'standard' }).format(count)
}

function installStateLabel(state: MarketplaceInstallState): string {
  switch (state) {
    case 'installed':
      return 'Installed'
    case 'update-available':
      return 'Update available'
    case 'modified-locally':
      return 'Modified locally'
    case 'unavailable':
      return 'Unavailable'
    case 'safety-blocked':
      return 'Safety blocked'
    case 'install':
      return 'Install'
  }
}

function installStateClassName(state: MarketplaceInstallState): string {
  switch (state) {
    case 'installed':
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    case 'update-available':
      return 'border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300'
    case 'modified-locally':
      return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    case 'unavailable':
    case 'safety-blocked':
      return 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300'
    case 'install':
      return 'border-border bg-background text-muted-foreground'
  }
}

function disabledActionLabel(state: MarketplaceInstallState): string {
  if (state === 'installed') return 'Installed'
  if (state === 'update-available') return 'Update placeholder'
  if (state === 'modified-locally') return 'Update placeholder'
  if (state === 'unavailable') return 'Unavailable'
  if (state === 'safety-blocked') return 'Safety blocked'
  return 'Install placeholder'
}

export function SkillMarketplacePage({ api = defaultMarketplaceApi }: { api?: MarketplaceApi }) {
  const [search, setSearch] = React.useState('')
  const [category, setCategory] = React.useState('')
  const [tag, setTag] = React.useState('')
  const [catalogState, setCatalogState] = React.useState<MarketplaceCatalogState | { status: 'loading' }>({ status: 'loading' })
  const [selectedSlug, setSelectedSlug] = React.useState<string | null>(null)
  const [detailState, setDetailState] = React.useState<MarketplaceDetailState | { status: 'idle' | 'loading' }>({ status: 'idle' })

  const refreshCatalog = React.useCallback(() => {
    setCatalogState({ status: 'loading' })
    void loadMarketplaceCatalog(api, { search, category, tag }).then(setCatalogState)
  }, [api, category, search, tag])

  const refreshDetail = React.useCallback((slug: string) => {
    setDetailState({ status: 'loading' })
    void loadMarketplaceDetail(api, slug).then(setDetailState)
  }, [api])

  React.useEffect(() => {
    refreshCatalog()
  }, [refreshCatalog])

  React.useEffect(() => {
    if (!selectedSlug) {
      setDetailState({ status: 'idle' })
      return
    }
    refreshDetail(selectedSlug)
  }, [refreshDetail, selectedSlug])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Store className="h-4 w-4" />
              <span>Marketplace</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Browse public Marketplace Skills anonymously. Install, update, report, and owner actions are placeholders in this slice.
            </p>
          </div>
          <button
            type="button"
            disabled
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-muted px-3 text-xs font-medium text-muted-foreground"
          >
            <UserCog className="h-3.5 w-3.5" />
            Publish Skill
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(300px,420px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col border-r border-border">
          <div className="space-y-3 border-b border-border p-4">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search Marketplace Skills"
                className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-sm outline-none focus:border-foreground/30"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-foreground/30"
              >
                <option value="">All categories</option>
                {catalogState.status === 'ready' && catalogState.availableCategories.map((candidate) => (
                  <option key={candidate} value={candidate}>{candidate}</option>
                ))}
              </select>
              <select
                value={tag}
                onChange={(event) => setTag(event.target.value)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-foreground/30"
              >
                <option value="">All tags</option>
                {catalogState.status === 'ready' && catalogState.availableTags.map((candidate) => (
                  <option key={candidate} value={candidate}>{candidate}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {catalogState.status === 'loading' && (
              <p className="p-3 text-sm text-muted-foreground">Loading Marketplace Skills...</p>
            )}
            {catalogState.status === 'error' && (
              <MarketplaceError message={catalogState.message} onRetry={refreshCatalog} />
            )}
            {catalogState.status === 'ready' && catalogState.listings.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">No Marketplace Skills match these filters.</p>
            )}
            {catalogState.status === 'ready' && catalogState.listings.map((listing) => (
              <MarketplaceListingCard
                key={listing.id}
                listing={listing}
                selected={listing.slug === selectedSlug}
                onSelect={() => setSelectedSlug(listing.slug)}
              />
            ))}
          </div>
        </section>

        <section className="min-h-0 overflow-y-auto">
          {detailState.status === 'idle' && (
            <div className="flex h-full items-center justify-center p-6 text-center text-muted-foreground">
              <div className="max-w-sm">
                <Store className="mx-auto h-5 w-5" />
                <p className="mt-2 text-sm font-medium text-foreground">Select a Marketplace Skill</p>
                <p className="mt-1 text-xs">Open a listing to inspect its published SKILL.md, version history, release notes, required sources, and metadata.</p>
              </div>
            </div>
          )}
          {detailState.status === 'loading' && (
            <p className="p-5 text-sm text-muted-foreground">Loading Marketplace Skill detail...</p>
          )}
          {detailState.status === 'error' && (
            <div className="p-5">
              <MarketplaceError message={detailState.message} onRetry={() => selectedSlug && refreshDetail(selectedSlug)} />
            </div>
          )}
          {detailState.status === 'ready' && (
            <MarketplaceDetail detail={detailState.detail} />
          )}
        </section>
      </div>
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
      className={`mb-2 flex w-full min-w-0 flex-col gap-2 rounded-lg border p-3 text-left transition-colors ${
        selected ? 'border-foreground/40 bg-muted/60' : 'border-border hover:bg-muted/40'
      }`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-foreground text-xs font-semibold text-background">
          {listing.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{listing.name}</span>
          <span className="line-clamp-2 text-xs text-muted-foreground">{listing.description}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>{listing.owner}</span>
        <span>v{listing.latestVersion}</span>
        <span>{formatInstallCount(listing.installCount)} installs</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Pill>{listing.category}</Pill>
        {listing.tags.map((tag) => <Pill key={tag}>{tag}</Pill>)}
        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${installStateClassName(listing.installState)}`}>
          {installStateLabel(listing.installState)}
        </span>
      </div>
    </button>
  )
}

export function MarketplaceDetail({
  detail,
}: {
  detail: MarketplaceSkillDetail
}) {
  const isBlocked = detail.installState === 'safety-blocked' || detail.installState === 'unavailable'

  return (
    <div className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-foreground text-sm font-semibold text-background">
            {detail.icon}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{detail.name}</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{detail.description}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Pill>{detail.owner}</Pill>
              <Pill>{detail.category}</Pill>
              {detail.tags.map((tag) => <Pill key={tag}>{tag}</Pill>)}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <DisabledAction icon={<Download className="h-3.5 w-3.5" />} label={disabledActionLabel(detail.installState)} />
          <DisabledAction icon={<Flag className="h-3.5 w-3.5" />} label="Report placeholder" />
          <DisabledAction icon={<UserCog className="h-3.5 w-3.5" />} label="Owner actions" />
        </div>
      </div>

      {isBlocked && (
        <div className="flex gap-2 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{installStateLabel(detail.installState)} prevents Marketplace install and update distribution. Existing Local Skills remain separate.</span>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
        <section>
          <SectionTitle>Published SKILL.md</SectionTitle>
          <pre className="mt-2 max-h-[520px] overflow-auto rounded-md border border-border bg-muted/40 p-4 text-xs leading-relaxed text-foreground">
            {detail.skillMarkdown}
          </pre>
        </section>

        <aside className="space-y-5">
          <section>
            <SectionTitle>Listing Metadata</SectionTitle>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
              <dt className="text-muted-foreground">Marketplace ID</dt>
              <dd className="truncate">{detail.metadata.marketplaceId}</dd>
              <dt className="text-muted-foreground">Slug</dt>
              <dd>{detail.metadata.marketplaceSlug}</dd>
              <dt className="text-muted-foreground">Latest version</dt>
              <dd>v{detail.latestVersion}</dd>
              <dt className="text-muted-foreground">Installs</dt>
              <dd>{formatInstallCount(detail.installCount)}</dd>
              <dt className="text-muted-foreground">State</dt>
              <dd>{installStateLabel(detail.installState)}</dd>
            </dl>
          </section>

          <section>
            <SectionTitle>Required Sources</SectionTitle>
            <ul className="mt-2 space-y-1 text-xs">
              {detail.requiredSources.map((source) => (
                <li key={source} className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{source}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <SectionTitle>Version History</SectionTitle>
            <ol className="mt-2 space-y-3">
              {detail.versions.map((version) => (
                <li key={version.version} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium">v{version.version}</span>
                    <span className="text-muted-foreground">{version.publishedAt}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{version.releaseNotes}</p>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  )
}

export function MarketplaceError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
      <div className="flex gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">Marketplace is unavailable</p>
          <p className="mt-1 text-xs">{message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded-md border border-current px-2 py-1 text-xs font-medium"
          >
            Retry Marketplace
          </button>
        </div>
      </div>
    </div>
  )
}

function DisabledAction({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      disabled
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-muted px-3 text-xs font-medium text-muted-foreground"
    >
      {icon}
      {label}
    </button>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
      {children}
    </span>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold">{children}</h3>
}
