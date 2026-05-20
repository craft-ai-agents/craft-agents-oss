import * as React from 'react'
import { toast } from 'sonner'
import { Check, ChevronDown, ExternalLink, FilePlus2, Folder, FolderUp, Loader2, MessageCircle, Minus, MoreHorizontal, Plus, Search, Store, Upload, UserCog, Zap } from 'lucide-react'
import { Markdown, Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useAppShellContext } from '@/context/AppShellContext'
import { strToU8, unzipSync, zipSync } from 'fflate'
import type {
  MarketplaceInstallIntent,
  MarketplaceInstallResult,
  MarketplaceOriginMetadata,
  MarketplaceSkillInstallInput,
  MarketplaceSkillUpdateInput,
  MarketplaceDirectSkillPublishInput,
  MarketplacePublishDirectResult,
  CopawMarketSkill,
  CopawMarketUploadInput,
} from '@craft-agent/shared/skills'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'

// ============================================================================
// Mock switch — set to false to use real API
// ============================================================================

const USE_MOCK_MARKET = true

const MOCK_MARKET_SKILLS: CopawMarketSkill[] = [
  {
    fileKey: 'mock-key-1',
    userName: '张三',
    employeeId: 'MOCK_CURRENT_USER',
    department: '研发部',
    name: 'code-review',
    chineseName: '代码审查助手',
    description: '自动审查代码质量，给出改进建议，支持多种编程语言。',
    tag: 'A',
    hot: 128,
    createdAt: '2024-01-15T08:00:00Z',
    version: '20240115080000',
  },
  {
    fileKey: 'mock-key-2',
    userName: '李四',
    employeeId: 'MOCK_CURRENT_USER',
    department: 'DevOps团队',
    name: 'k8s-deploy',
    chineseName: 'K8s 部署助手',
    description: '一键生成 Kubernetes 部署配置，支持 Deployment、Service、Ingress 等资源。',
    tag: 'B',
    hot: 256,
    createdAt: '2024-02-20T10:00:00Z',
    version: '20240220100000',
  },
  {
    fileKey: 'mock-key-3',
    userName: '王五',
    employeeId: 'EMP003',
    department: '测试部',
    name: 'test-generator',
    chineseName: '单测生成器',
    description: '根据函数签名和逻辑自动生成单元测试用例，覆盖边界条件。',
    tag: 'A',
    hot: 87,
    createdAt: '2024-03-10T14:00:00Z',
    version: '20240310140000',
  },
  {
    fileKey: 'mock-key-4',
    userName: '赵六',
    employeeId: 'EMP004',
    department: 'DevOps团队',
    name: 'ci-pipeline',
    chineseName: 'CI 流水线助手',
    description: '快速生成 Jenkins / GitLab CI / GitHub Actions 流水线配置文件。',
    tag: 'B',
    hot: 312,
    createdAt: '2024-03-22T09:00:00Z',
    version: '20240322090000',
  },
  {
    fileKey: 'mock-key-5',
    userName: '陈七',
    employeeId: 'EMP005',
    department: '研发部',
    name: 'sql-optimizer',
    chineseName: 'SQL 优化器',
    description: '分析慢查询，给出索引优化和 SQL 改写建议。',
    tag: 'A',
    hot: 45,
    createdAt: '2024-04-01T11:00:00Z',
    version: '20240401110000',
  },
  {
    fileKey: 'mock-key-6',
    userName: '周八',
    employeeId: 'EMP006',
    department: 'DevOps团队',
    name: 'docker-builder',
    chineseName: 'Docker 镜像构建',
    description: '智能生成多阶段 Dockerfile，优化镜像体积，支持 Node.js / Python / Java 等常见运行时。',
    tag: 'B',
    hot: 198,
    createdAt: '2024-04-10T09:30:00Z',
    version: '20240410093000',
  },
  {
    fileKey: 'mock-key-7',
    userName: '吴九',
    employeeId: 'EMP007',
    department: '架构组',
    name: 'api-designer',
    chineseName: 'RESTful API 设计师',
    description: '根据业务描述自动生成 OpenAPI 3.0 规范文档，包含请求体、响应体和错误码定义。',
    tag: 'A',
    hot: 163,
    createdAt: '2024-04-18T15:00:00Z',
    version: '20240418150000',
  },
  {
    fileKey: 'mock-key-8',
    userName: '郑十',
    employeeId: 'EMP008',
    department: 'DevOps团队',
    name: 'log-analyzer',
    chineseName: '日志分析助手',
    description: '解析应用日志，自动识别异常模式，定位报错根因，生成排查报告。',
    tag: 'B',
    hot: 74,
    createdAt: '2024-05-02T11:00:00Z',
    version: '20240502110000',
  },
  {
    fileKey: 'mock-key-9',
    userName: '孙十一',
    employeeId: 'EMP009',
    department: '研发部',
    name: 'commit-writer',
    chineseName: 'Git Commit 生成器',
    description: '分析 git diff 内容，自动生成符合 Conventional Commits 规范的提交信息。',
    tag: 'A',
    hot: 221,
    createdAt: '2024-05-15T08:00:00Z',
    version: '20240515080000',
  },
  {
    fileKey: 'mock-key-10',
    userName: '李十二',
    employeeId: 'EMP010',
    department: '研发部',
    name: 'doc-writer',
    chineseName: '技术文档助手',
    description: '根据代码或功能描述自动撰写技术文档、README 和接口说明，支持中英文输出。',
    tag: 'A',
    hot: 309,
    createdAt: '2024-05-20T14:00:00Z',
    version: '20240520140000',
  },
  {
    fileKey: 'mock-key-11',
    userName: '赵十三',
    employeeId: 'EMP011',
    department: 'DevOps团队',
    name: 'infra-cost',
    chineseName: '云资源成本分析',
    description: '扫描 Terraform / CloudFormation 配置，估算月度云资源费用并给出优化建议。',
    tag: 'B',
    hot: 56,
    createdAt: '2024-06-01T10:00:00Z',
    version: '20240601100000',
  },
  {
    fileKey: 'mock-key-12',
    userName: '钱十四',
    employeeId: 'EMP012',
    department: '安全团队',
    name: 'security-scanner',
    chineseName: '代码安全扫描',
    description: '检测代码中的 OWASP Top10 漏洞，包括 SQL 注入、XSS、敏感信息泄露等，输出修复建议。',
    tag: 'A',
    hot: 142,
    createdAt: '2024-06-10T09:00:00Z',
    version: '20240610090000',
  },
]

// ============================================================================
// Types
// ============================================================================

export type MarketplaceInstallState =
  | 'install'
  | 'installed'
  | 'update-available'
  | 'modified-locally'
  | 'unavailable'
  | 'safety-blocked'

export const PRODUCT_MARKETPLACE_CATEGORIES = ['Documentation', 'Product', 'Quality', 'Security'] as const
export const MARKETPLACE_DIRECT_PUBLISH_TABS = ['create', 'remote', 'upload'] as const

export interface MarketplaceSkillListing {
  id: string
  slug: string
  ownerId: string
  basedOn?: MarketplaceOriginMetadata['basedOn']
  icon: string
  iconBg?: string
  name: string
  description: string
  owner: string
  category: string
  tags: string[]
  latestVersion: string
  installCount: number
  installState: MarketplaceInstallState
  publishedAt?: string
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
}

export interface MarketplaceApi {
  listSkills: () => Promise<MarketplaceSkillListing[]>
  getSkillDetail: (slug: string) => Promise<MarketplaceSkillDetail>
  reportSkill: (input: MarketplaceSkillReportInput) => Promise<MarketplaceReportResult>
  unpublishSkill: (input: MarketplaceOwnerUnpublishInput) => Promise<MarketplaceOwnerUnpublishResult>
  createInstallIntent: (detail: MarketplaceSkillDetail, userId: string) => Promise<MarketplaceInstallIntent>
  recordInstallComplete: (intentId: string) => Promise<void>
  createUpdateIntent: (detail: MarketplaceSkillDetail, userId: string) => Promise<MarketplaceInstallIntent>
  recordUpdateComplete: (intentId: string) => Promise<void>
}

export interface MarketplacePublishApi {
  publishSkill: (input: { userId: string; skillSlug: string }) => Promise<MarketplacePublishResult>
}

export type MarketplacePublishResult =
  | { status: 'published'; marketplaceSlug: string }
  | { status: 'slug-conflict'; marketplaceSlug: string; message: string }
  | { status: 'auth-required'; message: string }
  | { status: 'error'; message: string }

export interface MarketplaceSkillReportInput {
  userId: string
  marketplaceId: string
  marketplaceSlug: string
  context: string
}

export interface MarketplaceOwnerUnpublishInput {
  userId: string
  marketplaceId: string
  marketplaceSlug: string
}

export type MarketplaceReportResult =
  | { status: 'submitted'; reportId: string }
  | { status: 'validation-error'; message: string }
  | { status: 'auth-required'; message: string }
  | { status: 'error'; message: string }

export type MarketplaceOwnerUnpublishResult =
  | { status: 'unpublished'; marketplaceSlug: string; message: string }
  | { status: 'auth-required'; message: string }
  | { status: 'forbidden'; message: string }
  | { status: 'error'; message: string }

export interface MarketplaceInstallElectronApi {
  installMarketplaceSkill(workspaceId: string, input: MarketplaceSkillInstallInput): Promise<MarketplaceInstallResult>
}

export interface MarketplaceUpdateElectronApi {
  updateMarketplaceSkill(workspaceId: string, input: MarketplaceSkillUpdateInput): Promise<MarketplaceInstallResult>
}

export interface MarketplaceDirectPublishElectronApi {
  publishDirectMarketplaceSkill(workspaceId: string, input: MarketplaceDirectSkillPublishInput): Promise<MarketplacePublishDirectResult>
}

export interface StaticMarketplaceApiOptions {
  listings?: MarketplaceSkillListing[]
  details?: Record<string, MarketplaceSkillDetail>
  listError?: string
  detailError?: string
}

// ============================================================================
// Mock Data
// ============================================================================

const MOCK_SKILLS: MarketplaceSkillListing[] = [
  {
    id: 'mkt_docker',
    slug: 'docker',
    ownerId: 'owner_mdp',
    icon: 'D',
    iconBg: 'bg-blue-500',
    name: 'Docker',
    description: '管理容器的构建、运行与生命周期，管理容器的构建、运行与生命周期管理容器的构建、运行与生命周期',
    owner: 'MDP Labs',
    category: 'DevOps',
    tags: ['container', 'devops'],
    latestVersion: '1.2.0',
    installCount: 3812,
    installState: 'install',
  },
  {
    id: 'mkt_kubernetes',
    slug: 'kubernetes',
    ownerId: 'owner_mdp',
    icon: 'K8s',
    iconBg: 'bg-indigo-500',
    name: 'Kubernetes',
    description: '自动化部署、扩缩容与集群管理',
    owner: 'MDP Labs',
    category: 'DevOps',
    tags: ['k8s', 'devops', 'cloud'],
    latestVersion: '2.0.1',
    installCount: 2940,
    installState: 'installed',
  },
  {
    id: 'mkt_github_actions',
    slug: 'github-actions',
    ownerId: 'owner_mdp',
    icon: 'GA',
    iconBg: 'bg-gray-700',
    name: 'GitHub Actions',
    description: '构建和管理 CI/CD 工作流',
    owner: 'MDP Labs',
    category: 'DevOps',
    tags: ['ci', 'cd', 'github'],
    latestVersion: '1.5.3',
    installCount: 5120,
    installState: 'install',
  },
  {
    id: 'mkt_terraform',
    slug: 'terraform',
    ownerId: 'owner_mdp',
    icon: 'TF',
    iconBg: 'bg-purple-600',
    name: 'Terraform',
    description: '基础设施即代码，管理云资源',
    owner: 'MDP Labs',
    category: 'DevOps',
    tags: ['iac', 'cloud', 'devops'],
    latestVersion: '1.0.0',
    installCount: 1876,
    installState: 'install',
  },
  {
    id: 'mkt_prometheus',
    slug: 'prometheus',
    ownerId: 'owner_mdp',
    icon: 'PM',
    iconBg: 'bg-orange-500',
    name: 'Prometheus',
    description: '监控指标采集与告警规则管理',
    owner: 'MDP Labs',
    category: 'DevOps',
    tags: ['monitoring', 'metrics'],
    latestVersion: '1.1.2',
    installCount: 1340,
    installState: 'install',
  },
  {
    id: 'mkt_jenkins',
    slug: 'jenkins',
    ownerId: 'owner_mdp',
    icon: 'JK',
    iconBg: 'bg-red-500',
    name: 'Jenkins',
    description: '配置并触发 Jenkins 构建流水线',
    owner: 'MDP Labs',
    category: 'DevOps',
    tags: ['ci', 'build'],
    latestVersion: '1.0.4',
    installCount: 987,
    installState: 'installed',
  },
  {
    id: 'mkt_doc_gen',
    slug: 'doc-generator',
    ownerId: 'owner_community',
    icon: 'DG',
    iconBg: 'bg-emerald-500',
    name: '文档生成器',
    description: '根据代码自动生成技术文档',
    owner: '社区',
    category: '公共',
    tags: ['docs', 'automation'],
    latestVersion: '1.3.0',
    installCount: 2210,
    installState: 'install',
  },
  {
    id: 'mkt_code_review',
    slug: 'code-review',
    ownerId: 'owner_community',
    icon: 'CR',
    iconBg: 'bg-cyan-500',
    name: '代码审查',
    description: '智能分析代码质量与安全问题',
    owner: '社区',
    category: '公共',
    tags: ['review', 'quality'],
    latestVersion: '2.1.0',
    installCount: 3450,
    installState: 'install',
  },
  {
    id: 'mkt_calendar',
    slug: 'calendar-assistant',
    ownerId: 'owner_community',
    icon: 'CA',
    iconBg: 'bg-green-500',
    name: '日历助手',
    description: '管理日程、会议与提醒事项',
    owner: '社区',
    category: '公共',
    tags: ['calendar', 'productivity'],
    latestVersion: '1.0.2',
    installCount: 1560,
    installState: 'installed',
  },
  {
    id: 'mkt_weekly_report',
    slug: 'weekly-report',
    ownerId: 'owner_community',
    icon: 'WR',
    iconBg: 'bg-violet-500',
    name: '周报助手',
    description: '自动整理工作内容，生成周报草稿',
    owner: '社区',
    category: '公共',
    tags: ['report', 'productivity'],
    latestVersion: '1.1.0',
    installCount: 4230,
    installState: 'install',
  },
]

import type { LoadedSkill } from '../../../shared/types'

const MOCK_LOCAL_SKILLS: LoadedSkill[] = [
  // 市场安装的技能（有 marketplaceOrigin）
  {
    slug: 'docker',
    metadata: { name: 'Docker', description: '管理容器的构建、运行与生命周期' },
    content: '',
    path: '/workspace/.agents/docker',
    source: 'workspace',
    marketplaceOrigin: {
      marketplaceId: 'mkt_docker',
      marketplaceSlug: 'docker',
      ownerId: 'owner_devops',
      ownerDisplayName: 'DevOps Team',
      installedVersion: '1.2.0',
      installedAt: '2024-01-10T08:00:00Z',
      lastCheckedAt: '2024-01-10T08:00:00Z',
      modified: false,
      sourceBundleHash: 'abc123',
      safetyStatus: 'ok',
    },
  },
  {
    slug: 'kubernetes',
    metadata: { name: 'Kubernetes', description: '自动化部署、扩缩容与集群管理' },
    content: '',
    path: '/workspace/.agents/kubernetes',
    source: 'workspace',
    marketplaceOrigin: {
      marketplaceId: 'mkt_kubernetes',
      marketplaceSlug: 'kubernetes',
      ownerId: 'owner_devops',
      ownerDisplayName: 'DevOps Team',
      installedVersion: '2.0.1',
      installedAt: '2024-01-12T09:00:00Z',
      lastCheckedAt: '2024-01-12T09:00:00Z',
      modified: false,
      sourceBundleHash: 'def456',
      safetyStatus: 'ok',
    },
  },
  {
    slug: 'github-actions',
    metadata: { name: 'GitHub Actions', description: '构建和管理 CI/CD 工作流' },
    content: '',
    path: '/workspace/.agents/github-actions',
    source: 'workspace',
    marketplaceOrigin: {
      marketplaceId: 'mkt_github_actions',
      marketplaceSlug: 'github-actions',
      ownerId: 'owner_devops',
      ownerDisplayName: 'DevOps Team',
      installedVersion: '1.5.0',
      installedAt: '2024-01-15T10:00:00Z',
      lastCheckedAt: '2024-01-15T10:00:00Z',
      modified: false,
      sourceBundleHash: 'ghi789',
      safetyStatus: 'ok',
    },
  },
  // 本地上传的技能（无 marketplaceOrigin）
  {
    slug: 'code-review',
    metadata: { name: '代码审查', description: '智能分析代码质量与安全问题', author: '张三' },
    content: '',
    path: '/workspace/.agents/code-review',
    source: 'workspace',
  },
  {
    slug: 'weekly-report',
    metadata: { name: '周报助手', description: '自动整理工作内容，生成周报草稿', author: '李四' },
    content: '',
    path: '/workspace/.agents/weekly-report',
    source: 'workspace',
  },
  {
    slug: 'doc-generator',
    metadata: { name: '文档生成器', description: '根据代码自动生成技术文档', author: '王五' },
    content: '',
    path: '/workspace/.agents/doc-generator',
    source: 'workspace',
  },
]

const HERO_SLIDES = [
  { icon: 'D', color: 'bg-blue-500', name: 'Docker', prompt: '帮我分析容器内存占用并优化配置' },
  { icon: 'K8s', color: 'bg-indigo-500', name: 'Kubernetes', prompt: '检查集群状态并扩容 production 命名空间' },
  { icon: 'GA', color: 'bg-gray-700', name: 'GitHub Actions', prompt: '为我的项目生成一个完整的 CI/CD 流水线' },
  { icon: 'WR', color: 'bg-violet-500', name: '周报助手', prompt: '整理本周提交记录并生成工作周报' },
]

// ============================================================================
// createStaticMarketplaceApi
// ============================================================================

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

export function createStaticMarketplaceApi(options?: StaticMarketplaceApiOptions): MarketplaceApi {
  const listings = options?.listings ?? MOCK_SKILLS
  const unpublished = new Set<string>()

  return {
    async listSkills() {
      if (options?.listError) throw new Error(options.listError)
      return listings.filter((l) => !unpublished.has(l.slug))
    },
    async getSkillDetail(slug) {
      if (options?.detailError) throw new Error(options.detailError)
      const l = listings.find((x) => x.slug === slug)
      if (!l) throw new Error('Skill not found.')
      return {
        ...l,
        skillMarkdown: `# ${l.name}\n\n${l.description}`,
        requiredSources: [],
        versions: [{ version: l.latestVersion, publishedAt: new Date().toISOString(), releaseNotes: '' }],
        metadata: {
          marketplaceId: l.id,
          marketplaceSlug: l.slug,
          publishedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }
    },
    async reportSkill(input) {
      return { status: 'submitted', reportId: `report_${input.marketplaceId}` }
    },
    async unpublishSkill(input) {
      unpublished.add(input.marketplaceSlug)
      return { status: 'unpublished', marketplaceSlug: input.marketplaceSlug, message: '已从市场下架。' }
    },
    async createInstallIntent(detail) {
      const bytes = zipSync({ 'SKILL.md': strToU8(detail.skillMarkdown) })
      return { intentId: `intent_${detail.id}`, downloadUrl: `data:application/zip;base64,${toBase64(bytes)}`, expectedSha256: await sha256Hex(bytes) }
    },
    async recordInstallComplete() {},
    async createUpdateIntent(detail) {
      const bytes = zipSync({ 'SKILL.md': strToU8(detail.skillMarkdown) })
      return { intentId: `update_intent_${detail.id}`, downloadUrl: `data:application/zip;base64,${toBase64(bytes)}`, expectedSha256: await sha256Hex(bytes) }
    },
    async recordUpdateComplete() {},
  }
}

const defaultMarketplaceApi = createStaticMarketplaceApi()

// ============================================================================
// CoPaw market skill mapping
// ============================================================================

/** Convert a raw CoPaw market skill to the renderer's MarketplaceSkillListing format. */
const SKILL_ICON_COLORS = [
  'bg-blue-500', 'bg-indigo-500', 'bg-gray-700', 'bg-purple-600',
  'bg-orange-500', 'bg-red-500', 'bg-emerald-500', 'bg-cyan-500',
  'bg-green-500', 'bg-violet-500', 'bg-pink-500', 'bg-teal-500',
  'bg-amber-500', 'bg-sky-500',
]

function skillIconBg(name: string): string {
  const hash = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return SKILL_ICON_COLORS[hash % SKILL_ICON_COLORS.length]
}

function mapCopawSkillToListing(
  skill: CopawMarketSkill,
  localSlugs: Set<string>,
): MarketplaceSkillListing {
  const category = skill.tag === 'B' ? 'DevOps' : '公共'
  const iconBg = skillIconBg(skill.name)
  const displayName = skill.chineseName?.trim() || skill.name
  const installState: MarketplaceInstallState = localSlugs.has(skill.name) ? 'installed' : 'install'

  return {
    id: skill.name,
    slug: skill.name,
    ownerId: skill.employeeId,
    icon: displayName.charAt(0).toUpperCase(),
    iconBg,
    name: displayName,
    description: skill.description,
    owner: skill.userName,
    category,
    tags: [],
    latestVersion: skill.version ?? '1.0.0',
    installCount: skill.hot,
    installState,
    publishedAt: skill.createdAt,
  }
}

// ============================================================================
// Categories
// ============================================================================

const CATEGORIES = ['全部', 'DevOps', '公共'] as const
type Category = typeof CATEGORIES[number]

// ============================================================================
// Sub-components
// ============================================================================

function HeroBanner() {
  const [idx, setIdx] = React.useState(0)

  React.useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % HERO_SLIDES.length), 3500)
    return () => clearInterval(t)
  }, [])

  const slide = HERO_SLIDES[idx]

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-100 via-purple-50 to-indigo-100 dark:from-violet-950/40 dark:via-purple-900/30 dark:to-indigo-900/30">
      <div className="pointer-events-none absolute -left-16 -top-16 h-64 w-64 rounded-full bg-purple-300/30 blur-3xl dark:bg-purple-500/20" />
      <div className="pointer-events-none absolute -bottom-16 -right-16 h-64 w-64 rounded-full bg-indigo-300/30 blur-3xl dark:bg-indigo-500/20" />

      <div className="relative flex flex-col items-center px-8 py-10">
        <div className="mb-6 flex w-full max-w-lg items-center gap-3 rounded-xl bg-white/80 px-5 py-3 shadow-thin backdrop-blur-sm dark:bg-black/30">
          <div className={cn('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white', slide.color)}>
            {slide.icon}
          </div>
          <span className="truncate min-w-0 text-[13px] font-medium text-foreground">
            <span className="mr-1.5 font-semibold text-violet-600 dark:text-violet-400">{slide.name}</span>
            {`${slide.prompt.slice(0, 30)}${slide.prompt.length > 30 ? '...' : ''}`}
          </span>
        </div>

        {/* 在对话中试用 — 暂时隐藏 */}
      </div>

      <div className="absolute right-4 top-1/2 flex -translate-y-1/2 flex-col gap-1.5">
        {HERO_SLIDES.map((_, i) => (
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
  )
}

function SkillIcon({ icon, iconBg }: { icon: string; iconBg?: string }) {
  return (
    <div
      className={cn(
        'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white',
        iconBg ?? 'bg-foreground',
      )}
    >
      {icon}
    </div>
  )
}

function SkillRow({
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

  return (
    <button
      type="button"
      onClick={() => onClick(skill)}
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-foreground/[0.04]"
    >
      <SkillIcon icon={skill.icon} iconBg={skill.iconBg} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-foreground">{skill.name}</p>
        {skill.description.length > 20 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="truncate text-[12px] text-muted-foreground cursor-default">
                {skill.description.slice(0, 20)}...
              </p>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[240px] text-xs">
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
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-rose-300 text-rose-400 opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0 hover:border-rose-500 hover:text-rose-600 dark:border-rose-500/40 dark:text-rose-400/70 dark:hover:border-rose-400 dark:hover:text-rose-400"
              >
                <Minus className="h-3.5 w-3.5" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-xs">删除</TooltipContent>
          </Tooltip>
        )}

        {/* 安装状态 */}
        {installed ? (
          <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
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
            <TooltipContent side="left" className="text-xs">{isInstalling ? '安装中…' : '安装'}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </button>
  )
}

function SkillGrid({
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

function SkillDetailDialog({
  skill,
  onClose,
  onInstall,
  onUninstall,
  currentUserId,
  isInstalling = false,
}: {
  skill: MarketplaceSkillListing | null
  onClose: () => void
  onInstall: (s: MarketplaceSkillListing) => void
  onUninstall: (s: MarketplaceSkillListing) => void
  currentUserId: string | null
  isInstalling?: boolean
}) {
  const [skillContent, setSkillContent] = React.useState<string | null>(null)
  const [contentLoading, setContentLoading] = React.useState(false)

  React.useEffect(() => {
    if (!skill) return
    setSkillContent(null)
    setContentLoading(true)
    if (USE_MOCK_MARKET) {
      const t = setTimeout(() => {
        setSkillContent(null) // 降级到 mockMarkdown
        setContentLoading(false)
      }, 800)
      return () => clearTimeout(t)
    }
    let active = true
    window.electronAPI.fetchMarketSkillContent(skill.slug, skill.latestVersion)
      .then(({ content }) => { if (active) setSkillContent(content) })
      .catch(() => { if (active) setSkillContent(null) })
      .finally(() => { if (active) setContentLoading(false) })
    return () => { active = false }
  }, [skill?.slug])

  if (!skill) return null

  const installed = skill.installState === 'installed'
  const isOwner = Boolean(currentUserId && skill.ownerId === currentUserId)

  const mockMarkdown = `## 概述

${skill.description}

本技能深度集成到 MDP 工作流中，让你通过自然语言即可完成原本需要多步命令行操作的任务，大幅降低操作门槛，提升团队协作效率。

---

## 核心功能

### 1. 自动化任务执行

支持通过对话触发以下操作：

- **构建与部署**：一键触发构建流水线，实时查看日志输出
- **环境管理**：创建、删除、切换运行环境，支持多环境配置
- **资源监控**：实时获取 CPU、内存、磁盘等资源使用情况
- **日志分析**：自动聚合日志并提取关键错误信息

### 2. 智能问题诊断

当任务失败时，技能会自动：

1. 解析错误堆栈，定位根本原因
2. 结合上下文给出修复建议
3. 提供参考文档链接

### 3. 配置文件管理

\`\`\`yaml
# 示例配置文件 .mdp/${skill.slug}.yml
version: "1.0"
settings:
  timeout: 300
  retry: 3
  notify: true
environments:
  - name: production
    region: cn-hangzhou
  - name: staging
    region: cn-beijing
\`\`\`

---

## 快速开始

### 前置条件

在使用本技能前，请确保已满足以下条件：

| 依赖项 | 最低版本 | 说明 |
|--------|---------|------|
| Node.js | 18.0+ | 运行时环境 |
| ${skill.slug} CLI | 2.0+ | 命令行工具 |
| API Token | — | 在账户设置中生成 |

### 安装步骤

\`\`\`bash
# 第一步：安装 CLI 工具
npm install -g @mdp/${skill.slug}-cli

# 第二步：登录认证
${skill.slug} auth login

# 第三步：初始化项目
${skill.slug} init --workspace my-project

# 验证安装
${skill.slug} --version
\`\`\`

### 在 MDP 中激活

安装本技能后，在对话框中直接输入指令即可：

> 「帮我检查一下 production 环境的运行状态」

> 「最近 1 小时有没有报错日志？」

> 「把 staging 的配置同步到 production」

---

## 高级用法

### 批量操作

\`\`\`bash
# 批量重启服务
${skill.slug} restart --env production --service all

# 批量导出配置
${skill.slug} config export --format json --output ./backup/
\`\`\`

### Webhook 集成

你可以配置 Webhook，在特定事件发生时自动通知 MDP：

\`\`\`json
{
  "url": "https://your-mdp-instance/webhook/${skill.slug}",
  "events": ["deploy.success", "deploy.failed", "alert.triggered"],
  "secret": "your-webhook-secret"
}
\`\`\`

### 自定义规则

在 \`SKILL.md\` 中可以覆盖默认行为：

\`\`\`markdown
## Custom Rules

- 所有部署操作前必须先运行测试套件
- production 环境的变更需要二次确认
- 错误日志超过 100 条时自动告警
\`\`\`

---

## 常见问题

**Q：认证 Token 过期后会怎样？**

技能会自动检测 Token 状态，过期时提示重新登录，不会中断当前对话上下文。

**Q：是否支持私有化部署？**

支持。在配置文件中将 \`endpoint\` 指向你的私有服务地址即可。

**Q：操作日志保存多久？**

默认保留 30 天，可在设置中调整为 7 / 30 / 90 / 180 天。

---

## 更新日志

### v${skill.latestVersion}（当前版本）
- 新增批量操作支持
- 优化错误信息展示，更易于定位问题
- 修复在弱网络环境下偶发的超时问题

### v1.0.0
- 初始版本发布
- 支持基础的部署与监控功能`

  const publishedAt = skill.publishedAt
    ? new Date(skill.publishedAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-[660px] sm:max-w-[660px] flex-col gap-0 overflow-hidden p-0">

        {/* 图标 + 标题行 */}
        <div className="flex items-start justify-between px-7 pt-7 pb-1">
          <div className="flex items-center gap-4">
            <div className={cn('flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white', skill.iconBg ?? 'bg-foreground')}>
              {skill.icon}
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <h2 className="text-[18px] font-bold text-foreground">{skill.name}</h2>
                <span className="text-[13px] font-normal text-muted-foreground">Skill</span>
              </div>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{skill.description}</p>
            </div>
          </div>
        </div>

        {/* 作者 + 发布时间 + 安装数 */}
        <div className="flex items-center gap-2 px-7 pb-4 pt-2 text-[12px] text-muted-foreground/55">
          <span>作者：{skill.owner}</span>
          <span>·</span>
          <span>发布于 {publishedAt}</span>
          <span>·</span>
          <span>{skill.installCount.toLocaleString()} 次安装</span>
        </div>

        {/* Markdown 内容区 */}
        <div className="mx-7 mb-5 min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-muted/20 px-6 py-5 text-[13px] leading-relaxed">
          {contentLoading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : (
            <Markdown>{skillContent ?? mockMarkdown}</Markdown>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between border-t border-border px-7 py-4">
          <div>
            {isOwner && (
              <button
                type="button"
                onClick={() => onUninstall(skill)}
                className="rounded-lg bg-rose-100 px-4 py-2 text-[13px] font-medium text-rose-500 transition-colors hover:bg-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:hover:bg-rose-500/25"
              >
                删除
              </button>
            )}
          </div>
          {installed ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 px-4 py-2 text-[13px] font-medium text-emerald-600 dark:border-emerald-500/40 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              已安装
            </span>
          ) : (
            <button
              type="button"
              disabled={isInstalling}
              onClick={() => onInstall(skill)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-50 disabled:cursor-default"
            >
              {isInstalling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {isInstalling ? '安装中…' : '安装'}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// 本地技能专属组件（不复用市场组件）
// ============================================================================

function LocalSkillIcon({ skill }: { skill: LoadedSkill }) {
  const name = skill.metadata?.name ?? skill.slug
  const label = name.slice(0, 2).toUpperCase()
  const colorClass = skillIconBg(skill.slug)

  return (
    <div className={cn('flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white', colorClass)}>
      {label}
    </div>
  )
}


function LocalSkillRow({
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
          <p className="truncate text-[13px] font-semibold text-foreground">{name}</p>
          {author && <span className="flex-shrink-0 text-[11px] text-muted-foreground/70">{author}</span>}
        </div>
        {description.length > 20 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="truncate text-[12px] text-muted-foreground cursor-default">
                {description.slice(0, 20)}...
              </p>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[240px] text-xs">
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
        className="flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border border-foreground/20 text-foreground/50 opacity-0 transition-all group-hover:opacity-100 hover:border-rose-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10"
      >
        <Minus className="h-3.5 w-3.5" />
      </div>
    </button>
  )
}

function LocalSkillGrid({
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

function LocalSkillMoreMenu({ slug, workspaceId }: { slug: string; workspaceId: string }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-[172px] overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-thin">
          <button
            type="button"
            onClick={() => { setOpen(false); window.electronAPI.openSkillInEditor(workspaceId, slug) }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] text-foreground transition-colors hover:bg-foreground/[0.06]"
          >
            <ExternalLink className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            在编辑器中打开
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); window.electronAPI.openSkillInFinder(workspaceId, slug) }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] text-foreground transition-colors hover:bg-foreground/[0.06]"
          >
            <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            在文件夹中显示
          </button>
        </div>
      )}
    </div>
  )
}

// ── 通用确认对话框 ─────────────────────────────────────────────────────────────

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  destructive = true,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onCancel() }}>
      <DialogContent className="w-full max-w-[360px] sm:max-w-[360px] gap-0 p-6">
        <p className="text-[15px] font-semibold text-foreground">{title}</p>
        <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed">{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              'rounded-lg px-4 py-2 text-[13px] font-medium transition-colors',
              destructive
                ? 'bg-rose-500 text-white hover:bg-rose-600'
                : 'bg-foreground text-background hover:opacity-85',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function LocalSkillDetailDialog({
  skill,
  workspaceId,
  onClose,
  onUninstall,
  onPublish,
  isFromMarket = false,
}: {
  skill: LoadedSkill | null
  workspaceId: string
  onClose: () => void
  onUninstall: (s: LoadedSkill) => void
  onPublish: (s: LoadedSkill) => void
  isFromMarket?: boolean
}) {
  if (!skill) return null

  const name = skill.metadata?.name ?? skill.slug
  const description = skill.metadata?.description ?? ''

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-[660px] sm:max-w-[660px] flex-col gap-0 overflow-hidden p-0">

        {/* 图标 + 标题行 */}
        <div className="flex items-start justify-between px-7 pt-7 pb-1">
          <div className="flex items-center gap-4">
            <LocalSkillIcon skill={skill} />
            <div>
              <div className="flex items-baseline gap-2">
                <h2 className="text-[18px] font-bold text-foreground">{name}</h2>
                <span className="text-[13px] font-normal text-muted-foreground">本地</span>
              </div>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{description || '—'}</p>
            </div>
          </div>
          <div className="ml-4 flex flex-shrink-0 items-center gap-2 pt-1">
            <LocalSkillMoreMenu slug={skill.slug} workspaceId={workspaceId} />
          </div>
        </div>

        {/* 路径信息 + 发布到市场 */}
        <div className="flex items-center justify-between px-7 pb-4 pt-2">
          <span className="text-[12px] text-muted-foreground/55">路径：{skill.path}</span>
          {!skill.marketplaceOrigin && !isFromMarket && (
            <button
              type="button"
              onClick={() => { onClose(); onPublish(skill) }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-foreground/[0.04]"
            >
              <Store className="h-3.5 w-3.5" />
              发布到市场
            </button>
          )}
        </div>

        {/* Markdown 内容区 */}
        <div className="mx-7 mb-5 min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-muted/20 px-6 py-5 text-[13px] leading-relaxed">
          {skill.content
            ? <Markdown>{skill.content}</Markdown>
            : <p className="text-muted-foreground">（内容为空）</p>
          }
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between border-t border-border px-7 py-4">
          <button
            type="button"
            onClick={() => onUninstall(skill)}
            className="rounded-lg bg-rose-100 px-4 py-2 text-[13px] font-medium text-rose-500 transition-colors hover:bg-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:hover:bg-rose-500/25"
          >
            卸载
          </button>
          <button
            type="button"
            onClick={() => {
              onClose()
              navigate(routes.action.newSession({ input: `[skill:${skill.slug}] ` }))
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-opacity hover:opacity-85"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            在对话中试用
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type PageTab = 'market' | 'local'
type LocalOriginFilter = '全部' | '市场安装' | '本地上传'
const LOCAL_ORIGIN_OPTIONS: LocalOriginFilter[] = ['全部', '市场安装', '本地上传']

function LocalOriginDropdown({ value, onChange }: { value: LocalOriginFilter; onChange: (v: LocalOriginFilter) => void }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/[0.04]"
      >
        {value}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[110px] overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-thin">
          {LOCAL_ORIGIN_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => { onChange(opt); setOpen(false) }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-[13px] transition-colors hover:bg-foreground/[0.06]',
                opt === value ? 'font-semibold text-foreground' : 'text-foreground/70',
              )}
            >
              <span className="h-3 w-3 flex-shrink-0">{opt === value ? <Check className="h-3 w-3" /> : null}</span>
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// 创建技能弹窗
// ============================================================================

function CreateSkillDialog({
  open,
  workspaceId,
  onClose,
  onCreated,
}: {
  open: boolean
  workspaceId: string
  onClose: () => void
  onCreated: (skill: LoadedSkill) => void
}) {
  const [slug, setSlug] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [content, setContent] = React.useState('')
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  const validate = (): Record<string, string> => {
    const errs: Record<string, string> = {}
    if (!slug.trim()) {
      errs.slug = '请输入技能标识符'
    } else if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug.trim())) {
      errs.slug = '只允许小写字母、数字、下划线和连字符，且以字母或数字开头'
    }
    if (!displayName.trim()) errs.displayName = '请输入展示名称'
    if (!description.trim()) errs.description = '请输入技能描述'
    if (!content.trim()) errs.content = '请输入技能内容'
    return errs
  }

  const handleSubmit = async () => {
    const errs = validate()
    if (Object.keys(errs).length > 0) { setErrors(errs); return }

    const trimmedSlug = slug.trim()
    const metadata = { name: displayName.trim(), description: description.trim() }
    const body = content.trim()

    setSaving(true)
    try {
      const result = await window.electronAPI.createSkill(workspaceId, trimmedSlug, metadata, body, 'global')
      if ('conflict' in result && result.conflict) {
        setErrors({ slug: '此标识符已存在，请更换一个' })
        setSaving(false)
        return
      }
    } catch (err) {
      setErrors({ slug: '创建失败：' + String(err) })
      setSaving(false)
      return
    }
    setSaving(false)
    toast.success(`「${metadata.name}」创建成功`)

    const newSkill: LoadedSkill = {
      slug: trimmedSlug,
      metadata,
      content: body,
      path: `~/.agents/skills/${trimmedSlug}`,
      source: 'global',
      // 无 marketplaceOrigin → 归入「本地上传」分类
    }
    onCreated(newSkill)
    handleClose()
  }

  const handleClose = () => {
    if (saving) return
    setSlug(''); setDisplayName(''); setDescription(''); setContent(''); setErrors({})
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-[580px] sm:max-w-[580px] flex-col gap-0 overflow-hidden p-0">

        {/* 标题 */}
        <div className="flex-shrink-0 border-b border-border px-7 py-5">
          <h2 className="text-[17px] font-semibold text-foreground">创建技能</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">技能将保存到全局目录 <code className="rounded bg-muted px-1 py-0.5 text-[12px]">~/.agents/</code></p>
        </div>

        {/* 表单区 */}
        <div className="flex-1 space-y-4 overflow-y-auto px-7 py-5">

          {/* 标识符 */}
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-foreground">
              标识符 <span className="text-rose-500">*</span>
              <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">小写字母、数字、下划线</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={slug}
                onChange={(e) => { setSlug(e.target.value.toLowerCase()); setErrors((p) => ({ ...p, slug: '' })) }}
                placeholder="例如：code_reviewer"
                maxLength={64}
                className={cn(
                  'h-9 w-full rounded-lg border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
                  errors.slug ? 'border-rose-400' : 'border-border',
                )}
              />
            </div>
            {errors.slug && <p className="mt-1 text-[12px] text-rose-500">{errors.slug}</p>}
          </div>

          {/* 展示名称 */}
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-foreground">
              展示名称 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => { setDisplayName(e.target.value); setErrors((p) => ({ ...p, displayName: '' })) }}
              placeholder="例如：代码审查"
              maxLength={64}
              className={cn(
                'h-9 w-full rounded-lg border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
                errors.displayName ? 'border-rose-400' : 'border-border',
              )}
            />
            {errors.displayName && <p className="mt-1 text-[12px] text-rose-500">{errors.displayName}</p>}
          </div>

          {/* 描述 */}
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-foreground">
              描述 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => { setDescription(e.target.value); setErrors((p) => ({ ...p, description: '' })) }}
              placeholder="简要说明此技能的用途"
              maxLength={200}
              className={cn(
                'h-9 w-full rounded-lg border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
                errors.description ? 'border-rose-400' : 'border-border',
              )}
            />
            {errors.description && <p className="mt-1 text-[12px] text-rose-500">{errors.description}</p>}
          </div>

          {/* 技能内容 */}
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-foreground">
              技能内容 <span className="text-rose-500">*</span>
              <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">描述此技能的行为规则和指令</span>
            </label>
            <div className="relative">
              <textarea
                value={content}
                onChange={(e) => { setContent(e.target.value); setErrors((p) => ({ ...p, content: '' })) }}
                placeholder={`例如：\n\n## 规则\n\n- 审查代码时优先关注安全问题\n- 每次审查都需要给出改进建议\n- 使用中文回复`}
                rows={10}
                className={cn(
                  'w-full resize-none rounded-lg border bg-background px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono',
                  errors.content ? 'border-rose-400' : 'border-border',
                )}
              />
            </div>
            {errors.content && <p className="mt-1 text-[12px] text-rose-500">{errors.content}</p>}
          </div>

        </div>

        {/* 底部操作 */}
        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-border px-7 py-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/[0.04] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            创建
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// 发布 Skill 弹窗
// ============================================================================

/** Wrap a YAML scalar value in double quotes if it contains special characters. */
function yamlScalar(v: string): string {
  return /[:#\[\]{},|>&*!'"?\\]/.test(v) || v.trimStart() !== v || v.trimEnd() !== v
    ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    : v
}

function buildSkillMd(skill: LoadedSkill): string {
  const lines = ['---']
  lines.push(`name: ${yamlScalar(skill.metadata?.name ?? skill.slug)}`)
  lines.push(`description: ${yamlScalar(skill.metadata?.description ?? '')}`)
  if (skill.metadata?.author) lines.push(`author: ${yamlScalar(skill.metadata.author)}`)
  lines.push('---')
  if (skill.content) { lines.push(''); lines.push(skill.content) }
  return lines.join('\n')
}

function PublishSkillDialog({
  open,
  onClose,
  currentUserId,
  sourceSkill,
  onPublished,
}: {
  open: boolean
  onClose: () => void
  currentUserId: string | null
  sourceSkill?: LoadedSkill
  onPublished?: (skillName: string) => void
}) {
  const [name, setName] = React.useState('')
  const [chineseName, setChineseName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [tag, setTag] = React.useState<'A' | 'B'>('B')
  const [tagOpen, setTagOpen] = React.useState(false)
  const [file, setFile] = React.useState<File | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [uploading, setUploading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const tagRef = React.useRef<HTMLDivElement>(null)

  // Pre-fill form when sourceSkill provided (publish from local skill)
  React.useEffect(() => {
    if (!open) return
    if (sourceSkill) {
      setName(sourceSkill.slug.replace(/-/g, '_'))
      setChineseName(sourceSkill.metadata?.name ?? '')
      setDescription(sourceSkill.metadata?.description ?? '')
    } else {
      setName(''); setChineseName(''); setDescription('')
    }
    setTag('B'); setFile(null); setErrors({})
  }, [open, sourceSkill])

  const { ssoUser } = useAppShellContext()
  const displayUser = ssoUser?.userName
    ? `${ssoUser.userName}（${ssoUser.employeeId ?? currentUserId ?? '—'}）`
    : (currentUserId ?? '—')

  const TAG_OPTIONS = [
    { value: 'B' as const, label: 'DevOps（DevOps 相关能力，天眼、乐高等）' },
    { value: 'A' as const, label: '公共（如 PDF）' },
  ]

  React.useEffect(() => {
    if (!tagOpen) return
    const fn = (e: MouseEvent) => { if (tagRef.current && !tagRef.current.contains(e.target as Node)) setTagOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [tagOpen])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.zip')) {
      setErrors((prev) => ({ ...prev, file: '只支持上传 .zip 文件' }))
      return
    }
    setFile(f)
    setErrors((prev) => ({ ...prev, file: '' }))
  }

  const validate = (): Record<string, string> => {
    const errs: Record<string, string> = {}
    if (!name.trim()) {
      errs.name = '请输入 Skill 名称'
    } else if (!/^[a-z0-9_]+$/.test(name.trim())) {
      errs.name = '只允许英文小写字母、数字和下划线'
    }
    if (!description.trim()) errs.description = '请输入 Skill 描述'
    if (!sourceSkill && !file) errs.file = '请选择要上传的 zip 文件'
    return errs
  }

  const handleSubmit = async () => {
    const errs = validate()
    if (Object.keys(errs).length > 0) { setErrors(errs); return }
    setUploading(true)

    try {
      // Determine SKILL.md content to upload
      let skillContent: string
      if (sourceSkill) {
        skillContent = buildSkillMd(sourceSkill)
      } else if (file) {
        const buffer = await file.arrayBuffer()
        const unzipped = unzipSync(new Uint8Array(buffer))
        const skillMdKey = Object.keys(unzipped).find((k) =>
          k.toLowerCase() === 'skill.md' || k.toLowerCase().match(/^[^/]+\/skill\.md$/)
        )
        if (!skillMdKey) {
          setErrors({ file: 'zip 中未找到 SKILL.md 文件' })
          setUploading(false)
          return
        }
        skillContent = new TextDecoder().decode(unzipped[skillMdKey])
      } else {
        setUploading(false)
        return
      }

      const input: CopawMarketUploadInput = {
        name: name.trim(),
        chineseName: chineseName.trim(),
        description: description.trim(),
        tag,
        skillContent,
      }

      const result: import('@craft-agent/shared/skills').CopawMarketUploadResult = USE_MOCK_MARKET
        ? { status: 'published', skill: { fileKey: 'mock', userName: 'mock', employeeId: 'mock', department: null, name: input.name, chineseName: input.chineseName, description: input.description, tag: input.tag, hot: 0, createdAt: new Date().toISOString() } }
        : await window.electronAPI.uploadMarketSkill(input)

      if (result.status === 'conflict') {
        setErrors({ name: result.message })
        setUploading(false)
        return
      }
      if (result.status === 'error') {
        setErrors({ submit: result.message })
        setUploading(false)
        return
      }

      const publishedName = input.chineseName?.trim() || input.name
      setUploading(false)
      toast.success(`「${publishedName}」已成功发布到市场`)
      onPublished?.(input.name)
      handleClose()
    } catch (err) {
      setErrors({ submit: err instanceof Error ? err.message : '发布失败，请稍后重试' })
      setUploading(false)
    }
  }

  const handleClose = () => {
    if (uploading) return
    setName(''); setChineseName(''); setDescription(''); setTag('B')
    setFile(null); setErrors({}); setTagOpen(false)
    onClose()
  }

  // Auto-generate zip info for display when publishing from local skill
  const autoZipName = sourceSkill ? `${sourceSkill.slug}.zip` : null

  const tagLabel = TAG_OPTIONS.find((o) => o.value === tag)?.label ?? ''

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-[520px] sm:max-w-[520px] flex-col gap-0 overflow-hidden p-0">

        {/* 标题 */}
        <div className="flex-shrink-0 border-b border-border px-7 py-5">
          <h2 className="text-[17px] font-semibold text-foreground">上传 Skill 到市场</h2>
        </div>

        {/* 表单区（可滚动） */}
        <div className="flex-1 space-y-5 overflow-y-auto px-7 py-5">

          {/* Skill 名称 */}
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-foreground">
              Skill 名称（英文小写下划线）<span className="ml-0.5 text-rose-500">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: '' })) }}
                placeholder="例如：browser_tool"
                maxLength={36}
                className={cn(
                  'h-9 w-full rounded-lg border bg-background px-3 pr-12 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
                  errors.name ? 'border-rose-400' : 'border-border',
                )}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground/50">{name.length}/36</span>
            </div>
            {errors.name && <p className="mt-1 text-[12px] text-rose-500">{errors.name}</p>}
          </div>

          {/* Skill 展示名称 */}
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-foreground">Skill 展示名称</label>
            <div className="relative">
              <input
                type="text"
                value={chineseName}
                onChange={(e) => setChineseName(e.target.value)}
                placeholder="例如：浏览器工具"
                maxLength={36}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 pr-12 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground/50">{chineseName.length}/36</span>
            </div>
          </div>

          {/* Skill 描述 */}
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-foreground">
              Skill 描述<span className="ml-0.5 text-rose-500">*</span>
            </label>
            <div className="relative">
              <textarea
                value={description}
                onChange={(e) => { setDescription(e.target.value); setErrors((p) => ({ ...p, description: '' })) }}
                placeholder="简要描述 Skill 的功能和使用场景..."
                maxLength={1000}
                rows={3}
                className={cn(
                  'w-full resize-none rounded-lg border bg-background px-3 pb-6 pt-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
                  errors.description ? 'border-rose-400' : 'border-border',
                )}
              />
              <span className="pointer-events-none absolute bottom-2 right-3 text-[11px] text-muted-foreground/50">{description.length}/1000</span>
            </div>
            {errors.description && <p className="mt-1 text-[12px] text-rose-500">{errors.description}</p>}
          </div>

          {/* 分类 */}
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-foreground">
              分类<span className="ml-0.5 text-rose-500">*</span>
            </label>
            <div ref={tagRef} className="relative">
              <button
                type="button"
                onClick={() => setTagOpen((v) => !v)}
                className="inline-flex h-9 w-full items-center justify-between rounded-lg border border-border bg-background px-3 text-[13px] text-foreground transition-colors hover:bg-foreground/[0.04]"
              >
                <span className="truncate text-left">{tagLabel}</span>
                <ChevronDown className="ml-2 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              </button>
              {tagOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-thin">
                  {TAG_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => { setTag(opt.value); setTagOpen(false) }}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2 text-[13px] transition-colors hover:bg-foreground/[0.06]',
                        opt.value === tag ? 'font-semibold text-foreground' : 'text-foreground/70',
                      )}
                    >
                      <span className="h-3 w-3 flex-shrink-0">{opt.value === tag ? <Check className="h-3 w-3" /> : null}</span>
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 上传人信息 */}
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-foreground">上传人信息</label>
            <p className="text-[13px] text-muted-foreground">
              {displayUser}
            </p>
          </div>

          {/* Skill 文件（zip） */}
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-foreground">
              Skill 文件（zip）{!sourceSkill && <span className="ml-0.5 text-rose-500">*</span>}
            </label>
            {sourceSkill ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                <span className="text-[13px] text-foreground">{autoZipName}</span>
                <span className="text-[12px] text-muted-foreground">（自动从本地技能生成）</span>
              </div>
            ) : (
              <>
                <input ref={fileInputRef} type="file" accept=".zip" className="hidden" onChange={handleFileChange} />
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] text-foreground transition-colors hover:bg-foreground/[0.04]"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    选择文件
                  </button>
                  {file ? (
                    <span className="truncate text-[13px] text-foreground">{file.name}（{(file.size / 1024).toFixed(1)} KB）</span>
                  ) : (
                    <span className="text-[13px] text-muted-foreground">未选择文件</span>
                  )}
                </div>
                {errors.file && <p className="mt-1.5 text-[12px] text-rose-500">{errors.file}</p>}
              </>
            )}
          </div>

        </div>

        {/* 底部操作 */}
        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-border px-7 py-4">
          {errors.submit && <p className="mr-auto text-[12px] text-rose-500">{errors.submit}</p>}
          <button
            type="button"
            onClick={handleClose}
            disabled={uploading}
            className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/[0.04] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={uploading}
            className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-50"
          >
            {uploading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            上传
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function LocalCreateDropdown({
  onUpload,
  onCreateSkill,
}: {
  onUpload: () => void
  onCreateSkill: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3.5 py-1.5 text-[13px] font-medium text-foreground shadow-xs transition-colors hover:bg-foreground/[0.04]"
      >
        创建
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-[168px] overflow-hidden rounded-xl border border-border bg-popover py-1.5 shadow-thin">
          <button
            type="button"
            onClick={() => { onUpload(); setOpen(false) }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] text-foreground transition-colors hover:bg-foreground/[0.06]"
          >
            <FolderUp className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            上传本地技能
          </button>
          <button
            type="button"
            onClick={() => { onCreateSkill(); setOpen(false) }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] text-foreground transition-colors hover:bg-foreground/[0.06]"
          >
            <FilePlus2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            创建技能
          </button>
        </div>
      )}
    </div>
  )
}

function CategoryDropdown({ value, onChange }: { value: Category; onChange: (v: Category) => void }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/[0.04]"
      >
        {value}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[120px] overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-thin">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => { onChange(cat); setOpen(false) }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-[13px] transition-colors hover:bg-foreground/[0.06]',
                cat === value ? 'font-semibold text-foreground' : 'text-foreground/70',
              )}
            >
              <span className="h-3 w-3 flex-shrink-0">{cat === value ? <Check className="h-3 w-3" /> : null}</span>
              {cat}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

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

  // Persist CoPaw market-installed skill slugs across sessions via localStorage
  const copawInstalledSlugsRef = React.useRef<Set<string>>(
    (() => {
      try {
        const stored = localStorage.getItem('copaw-installed-slugs')
        return new Set<string>(stored ? JSON.parse(stored) as string[] : [])
      } catch { return new Set<string>() }
    })()
  )
  const addCopawInstalledSlug = React.useCallback((slug: string) => {
    copawInstalledSlugsRef.current.add(slug)
    try {
      localStorage.setItem('copaw-installed-slugs', JSON.stringify([...copawInstalledSlugsRef.current]))
    } catch { /* ignore */ }
  }, [])

  const effectiveCurrentUserId = USE_MOCK_MARKET ? 'MOCK_CURRENT_USER' : currentUserId

  const { skills: ctxSkills = [] } = useAppShellContext()
  const baseLocalSkills = USE_MOCK_MARKET ? (ctxSkills.length > 0 ? ctxSkills : MOCK_LOCAL_SKILLS) : ctxSkills
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
      const unzipped = unzipSync(new Uint8Array(buffer))

      // 找 SKILL.md（支持顶层或一级子目录）
      const skillMdKey = Object.keys(unzipped).find((k) =>
        k.toLowerCase() === 'skill.md' || k.toLowerCase().match(/^[^/]+\/skill\.md$/)
      )
      if (!skillMdKey) {
        setUploadError('zip 中未找到 SKILL.md 文件')
        return
      }

      const rawContent = new TextDecoder().decode(unzipped[skillMdKey])

      // 简单解析 YAML frontmatter
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
      const name = getYamlVal('name') ?? slug
      const description = getYamlVal('description') ?? ''
      const author = getYamlVal('author')

      const parsedMetadata = { name, description, ...(author ? { author } : {}) }
      const newSkill: LoadedSkill = {
        slug,
        metadata: parsedMetadata,
        content: body,
        path: `~/.agents/skills/${slug}`,
        source: 'global',
        // 无 marketplaceOrigin → 自动归入「本地上传」
      }

      // 写入磁盘（覆盖同名技能）
      let diskSaved = true
      try {
        await window.electronAPI.forceWriteSkill(workspaceId, slug, parsedMetadata, body, 'global')
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
        const matchQ = !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.owner.toLowerCase().includes(q)
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
      s.marketplaceOrigin != null || copawInstalledSlugsRef.current.has(s.slug)
    return localSkills.filter((s) => {
      const matchOrigin =
        localOriginFilter === '全部' ||
        (localOriginFilter === '市场安装' && isMarketInstalled(s)) ||
        (localOriginFilter === '本地上传' && !isMarketInstalled(s))
      const matchQ =
        !q ||
        s.slug.toLowerCase().includes(q) ||
        (s.metadata?.name ?? s.slug).toLowerCase().includes(q) ||
        (s.metadata?.description ?? '').toLowerCase().includes(q)
      return matchOrigin && matchQ
    })
  }, [localSkills, localSearch, localOriginFilter])

  const handleInstall = React.useCallback(async (s: MarketplaceSkillListing) => {
    if (installingIds.has(s.id)) return
    setInstallingIds((prev) => new Set([...prev, s.id]))
    try {
      if (USE_MOCK_MARKET) {
        await new Promise((r) => setTimeout(r, 600)) // simulate network
        setInstalledIds((prev) => new Set([...prev, s.id]))
        setSelectedSkill((prev) => prev?.id === s.id ? { ...prev, installState: 'installed' } : prev)
        toast.success(`「${s.name}」安装成功`)
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
            // Clean up copaw-installed marker so the slug can be reused
            copawInstalledSlugsRef.current.delete(s.slug)
            try { localStorage.setItem('copaw-installed-slugs', JSON.stringify([...copawInstalledSlugsRef.current])) } catch { /* ignore */ }
            toast.success(`「${name}」已卸载`)
          })
          .catch((err) => {
            // Revert optimistic removal on failure
            setLocalSkillSlugs((prev) => { const n = new Set(prev); n.delete(s.slug); return n })
            toast.error(`卸载失败：${err instanceof Error ? err.message : '请稍后重试'}`)
          })
      },
    })
  }, [workspaceId])

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
      isFromMarket={selectedLocalSkill ? copawInstalledSlugsRef.current.has(selectedLocalSkill.slug) : false}
    />
    <div className="flex h-full flex-col bg-background">

      {/* Tab 切换 — 固定顶部 */}
      <div className="flex flex-shrink-0 items-center justify-between px-4 pt-3 pb-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTab('market')}
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
            onClick={() => setTab('local')}
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
      <div className="mx-auto w-full max-w-4xl px-8 pb-12 pt-6">

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
                      const fromMarket = s.marketplaceOrigin != null || copawInstalledSlugsRef.current.has(s.slug)
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
          <HeroBanner />
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
