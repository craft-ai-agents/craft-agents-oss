/**
 * Stable taxonomy and deterministic classification helpers for skills.
 */

export const SKILL_CATEGORIES = [
  { id: 'founder', label: 'Founder' },
  { id: 'developer', label: 'Developer' },
  { id: 'research-analysis', label: 'Research & Analysis' },
  { id: 'content-generation', label: 'Content Generation' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'posting-publishing', label: 'Posting & Publishing' },
  { id: 'automation-workflows', label: 'Automation & Workflows' },
  { id: 'data-documents', label: 'Data & Documents' },
  { id: 'media-design', label: 'Media & Design' },
  { id: 'operations', label: 'Operations' },
  { id: 'uncategorized', label: 'Uncategorized' },
] as const;

export type SkillCategoryId = (typeof SKILL_CATEGORIES)[number]['id'];

export const UNCATEGORIZED_SKILL_CATEGORY_ID: SkillCategoryId = 'uncategorized';

export const SKILL_CATEGORY_IDS: readonly SkillCategoryId[] = SKILL_CATEGORIES.map(
  (category) => category.id
);

export const SKILL_CATEGORY_LABELS = Object.fromEntries(
  SKILL_CATEGORIES.map((category) => [category.id, category.label])
) as Record<SkillCategoryId, string>;

const SKILL_CATEGORY_ID_SET: ReadonlySet<string> = new Set(SKILL_CATEGORY_IDS);

const CATEGORY_ALIASES: ReadonlyMap<string, SkillCategoryId> = new Map([
  ...SKILL_CATEGORIES.flatMap((category): Array<[string, SkillCategoryId]> => [
    [normalizeCategoryToken(category.id), category.id],
    [normalizeCategoryToken(category.label), category.id],
  ]),
  ['research', 'research-analysis'],
  ['analysis', 'research-analysis'],
  ['content', 'content-generation'],
  ['writing', 'content-generation'],
  ['publishing', 'posting-publishing'],
  ['posting', 'posting-publishing'],
  ['automation', 'automation-workflows'],
  ['workflow', 'automation-workflows'],
  ['workflows', 'automation-workflows'],
  ['data', 'data-documents'],
  ['documents', 'data-documents'],
  ['document', 'data-documents'],
  ['media', 'media-design'],
  ['design', 'media-design'],
  ['ops', 'operations'],
  ['startup', 'founder'],
  ['founders', 'founder'],
  ['business', 'founder'],
  ['gtm', 'founder'],
]);

const CATEGORY_KEYWORDS: Record<SkillCategoryId, readonly string[]> = {
  founder: [
    '100m',
    'business',
    'customer development',
    'founder',
    'founders',
    'growth',
    'lean startup',
    'market',
    'monetizing',
    'offer',
    'positioning',
    'pricing',
    'product market fit',
    'sales',
    'startup',
    'startups',
    'traction',
    'validation',
  ],
  developer: [
    'api',
    'build',
    'ci',
    'cli',
    'code',
    'coding',
    'commit',
    'debug',
    'developer',
    'development',
    'git',
    'github',
    'javascript',
    'programming',
    'pull request',
    'python',
    'refactor',
    'repo',
    'review',
    'sdk',
    'test',
    'typescript',
  ],
  'research-analysis': [
    'analysis',
    'analyze',
    'benchmark',
    'citation',
    'cite',
    'competitive',
    'evaluate',
    'findings',
    'insight',
    'investigate',
    'market research',
    'paper',
    'report',
    'reports',
    'research',
    'summarize',
  ],
  'content-generation': [
    'article',
    'blog',
    'content',
    'copy',
    'draft',
    'edit',
    'newsletter',
    'prose',
    'script',
    'story',
    'write',
    'writing',
  ],
  marketing: [
    'ad',
    'ads',
    'audience',
    'brand',
    'campaign',
    'conversion',
    'funnel',
    'landing',
    'lead',
    'marketing',
    'persona',
    'sales',
    'seo',
  ],
  'posting-publishing': [
    'cms',
    'facebook',
    'instagram',
    'linkedin',
    'post',
    'posting',
    'publish',
    'publishing',
    'release',
    'social',
    'thread',
    'twitter',
  ],
  'automation-workflows': [
    'agent',
    'automate',
    'automation',
    'cron',
    'integration',
    'n8n',
    'orchestration',
    'pipeline',
    'process',
    'schedule',
    'trigger',
    'workflow',
    'workflows',
    'zapier',
  ],
  'data-documents': [
    'chart',
    'csv',
    'data',
    'database',
    'document',
    'documents',
    'docx',
    'excel',
    'form',
    'pdf',
    'record',
    'sheet',
    'sheets',
    'spreadsheet',
    'spreadsheets',
    'sql',
    'table',
    'xlsx',
  ],
  'media-design': [
    'audio',
    'canva',
    'design',
    'figma',
    'graphic',
    'image',
    'images',
    'logo',
    'media',
    'photo',
    'presentation',
    'slide',
    'slides',
    'video',
    'videos',
    'visual',
    'visuals',
  ],
  operations: [
    'admin',
    'billing',
    'calendar',
    'customer',
    'email',
    'finance',
    'incident',
    'inbox',
    'meeting',
    'operations',
    'ops',
    'runbook',
    'support',
    'triage',
  ],
  uncategorized: [],
};

export interface SkillCategoryClassificationInput {
  slug?: string;
  name?: string;
  description?: string;
  tags?: readonly string[];
  category?: unknown;
}

export function isSkillCategoryId(value: unknown): value is SkillCategoryId {
  return typeof value === 'string' && SKILL_CATEGORY_ID_SET.has(value);
}

export function normalizeSkillCategory(value: unknown): SkillCategoryId | undefined {
  if (typeof value !== 'string') return undefined;
  return CATEGORY_ALIASES.get(normalizeCategoryToken(value));
}

export function normalizeSkillTags(value: unknown): string[] | undefined {
  const values = typeof value === 'string'
    ? value.split(',')
    : Array.isArray(value)
      ? value.flatMap((entry) => typeof entry === 'string' ? entry.split(',') : [])
      : undefined;

  if (!values) return undefined;

  const normalized = Array.from(new Set(
    values
      .map(normalizeTag)
      .filter(Boolean)
  ));

  return normalized.length > 0 ? normalized : undefined;
}

export function classifySkillCategory(input: SkillCategoryClassificationInput): SkillCategoryId {
  const explicitCategory = normalizeSkillCategory(input.category);
  if (explicitCategory) return explicitCategory;

  const searchableText = normalizeSearchText([
    input.slug,
    input.name,
    input.description,
    ...(input.tags ?? []),
  ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0).join(' '));

  let bestCategory: SkillCategoryId = UNCATEGORIZED_SKILL_CATEGORY_ID;
  let bestScore = 0;

  for (const category of SKILL_CATEGORIES) {
    if (category.id === UNCATEGORIZED_SKILL_CATEGORY_ID) continue;

    const score = scoreCategory(searchableText, CATEGORY_KEYWORDS[category.id]);
    if (score > bestScore) {
      bestCategory = category.id;
      bestScore = score;
    }
  }

  return bestCategory;
}

function normalizeCategoryToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeTag(value: string): string {
  return normalizeCategoryToken(value);
}

function normalizeSearchText(value: string): string {
  return ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

function scoreCategory(searchableText: string, keywords: readonly string[]): number {
  let score = 0;
  for (const keyword of keywords) {
    const normalizedKeyword = normalizeSearchText(keyword).trim();
    if (!normalizedKeyword) continue;
    if (searchableText.includes(` ${normalizedKeyword} `)) {
      score += normalizedKeyword.includes(' ') ? 2 : 1;
    }
  }
  return score;
}
