/**
 * buildResearchSpec — deep-research prompt-pack generator.
 *
 * Turns a user's topic into the prepared subtask pack that a "Провести
 * доп. рисёрч" run executes in the cloud (PRD docs/cloud-runs-prd.md).
 * Product logic, provider-agnostic; subtask ids are stable for resume.
 */
import type { RunSpec } from './types.ts';

export interface ResearchPackOptions {
  /** Run id from the caller (idempotency key); default derived from topic+time. */
  id?: string;
  /** Session/session-context metadata merged into spec.metadata. */
  metadata?: Record<string, string>;
  model?: { connectionSlug?: string; modelId?: string };
  limits?: RunSpec['limits'];
  language?: 'en' | 'ru';
  /** Preset pack; default 'research'. */
  kind?: ResearchPackKind;
  /** F22: persona expansion — each subtask runs once per persona. */
  personas?: { id: string; systemPrompt: { en: string; ru: string } }[];
  /** F6: cheap model for draft-heavy subtasks (landscape, alternatives). */
  cheapModelId?: string;
}

interface SubtaskTemplate {
  id: string;
  title: { en: string; ru: string };
  prompt: { en: string; ru: string };
}

const RESEARCH_SUBTASKS: SubtaskTemplate[] = [
  {
    id: 'landscape',
    title: { en: 'Topic landscape', ru: 'Общая карта темы' },
    prompt: {
      en: 'Map the landscape of this topic: key concepts, taxonomy, main players/projects, and how they relate. Topic: "%s". Output structured markdown.',
      ru: 'Составь карту темы: ключевые понятия, таксономия, основные игроки/проекты и их взаимосвязи. Тема: "%s". Результат — структурированный markdown на русском.',
    },
  },
  {
    id: 'state-of-the-art',
    title: { en: 'State of the art', ru: 'Текущее состояние' },
    prompt: {
      en: 'What is the current state of the art on this topic as of 2025-2026: recent developments, benchmarks, notable releases. Topic: "%s". Be specific with dates and versions where known.',
      ru: 'Каково текущее состояние темы на 2025-2026: свежие разработки, бенчмарки, заметные релизы. Тема: "%s". Конкретика: даты и версии, где известны.',
    },
  },
  {
    id: 'tradeoffs',
    title: { en: 'Tradeoffs and criticism', ru: 'Компромиссы и критика' },
    prompt: {
      en: 'Analyze tradeoffs, limitations, and criticism around this topic: known failure modes, costs, risks, counterarguments. Topic: "%s".',
      ru: 'Проанализируй компромиссы, ограничения и критику по теме: известные сбои, издержки, риски, контраргументы. Тема: "%s".',
    },
  },
  {
    id: 'alternatives',
    title: { en: 'Alternatives and comparisons', ru: 'Альтернативы и сравнения' },
    prompt: {
      en: 'Compare the main alternatives/competitors for this topic: decision matrix, when to choose which. Topic: "%s".',
      ru: 'Сравни основные альтернативы/конкурентов по теме: матрица решений, когда что выбирать. Тема: "%s".',
    },
  },
  {
    id: 'outlook',
    title: { en: 'Outlook and open questions', ru: 'Перспективы и открытые вопросы' },
    prompt: {
      en: 'Outline the outlook for this topic: trends, unresolved questions, what to watch next. Topic: "%s".',
      ru: 'Опиши перспективы темы: тренды, нерешённые вопросы, за чем следить дальше. Тема: "%s".',
    },
  },
];



// ---------------------------------------------------------------------------
// Presets (F10): topic packs beyond the default deep research.
// ---------------------------------------------------------------------------

const COMPETITOR_SUBTASKS: SubtaskTemplate[] = [
  {
    id: 'landscape',
    title: { en: 'Competitors landscape', ru: 'Карта конкурентов' },
    prompt: {
      en: 'List the main competitors for this product/company: who they are, positioning, target segments. Subject: "%s". Structured markdown.',
      ru: 'Перечисли основных конкурентов продукта/компании: кто они, позиционирование, целевые сегменты. Объект: "%s". Структурированный markdown.',
    },
  },
  {
    id: 'pricing',
    title: { en: 'Pricing comparison', ru: 'Сравнение цен' },
    prompt: {
      en: 'Compare pricing of these competitors: plans, price points, free tiers, hidden limits. Subject: "%s". Table format.',
      ru: 'Сравни цены конкурентов: планы, ценовые уровни, бесплатные тарифы, скрытые лимиты. Объект: "%s". Формат — таблица.',
    },
  },
  {
    id: 'weaknesses',
    title: { en: 'Weaknesses', ru: 'Слабые места' },
    prompt: {
      en: 'Analyze weaknesses of these competitors: user complaints, missing features, friction points. Subject: "%s".',
      ru: 'Разбери слабые места конкурентов: жалобы пользователей, недостающие фичи, точки трения. Объект: "%s".',
    },
  },
  {
    id: 'swot',
    title: { en: 'SWOT', ru: 'SWOT' },
    prompt: {
      en: 'Build a SWOT matrix for the subject relative to this competitive field. Subject: "%s".',
      ru: 'Построй SWOT-матрицу объекта относительно конкурентного поля. Объект: "%s".',
    },
  },
  {
    id: 'outlook',
    title: { en: 'Outlook', ru: 'Перспективы' },
    prompt: {
      en: 'Where is this competitive field heading: trends, who wins/loses, what to watch. Subject: "%s".',
      ru: 'Куда движется конкурентное поле: тренды, кто выигрывает/проигрывает, за чем следить. Объект: "%s".',
    },
  },
];

const LITERATURE_SUBTASKS: SubtaskTemplate[] = [
  {
    id: 'surveys',
    title: { en: 'Key surveys', ru: 'Обзорные работы' },
    prompt: {
      en: 'List the key survey/review works on this topic with short annotations. Topic: "%s".',
      ru: 'Перечисли ключевые обзорные работы по теме с короткими аннотациями. Тема: "%s".',
    },
  },
  {
    id: 'methods',
    title: { en: 'Methods', ru: 'Методы' },
    prompt: {
      en: 'What methods/approaches dominate current research on this topic: compare with tradeoffs. Topic: "%s".',
      ru: 'Какие методы/подходы доминируют в текущих исследованиях по теме: сравни с компромиссами. Тема: "%s".',
    },
  },
  {
    id: 'gaps',
    title: { en: 'Research gaps', ru: 'Пробелы' },
    prompt: {
      en: 'Identify research gaps and underexplored angles on this topic. Topic: "%s".',
      ru: 'Определи пробелы и неисследованные направления по теме. Тема: "%s".',
    },
  },
  {
    id: 'future',
    title: { en: 'Future directions', ru: 'Будущие направления' },
    prompt: {
      en: 'What are the promising future research directions on this topic. Topic: "%s".',
      ru: 'Какие перспективные направления исследований по теме. Тема: "%s".',
    },
  },
];

const VENDOR_SUBTASKS: SubtaskTemplate[] = [
  {
    id: 'capabilities',
    title: { en: 'Capabilities', ru: 'Возможности' },
    prompt: {
      en: 'Evaluate this vendor capability map: offering, coverage, maturity. Vendor: "%s".',
      ru: 'Оцени карту возможностей вендора: предложение, покрытие, зрелость. Вендор: "%s".',
    },
  },
  {
    id: 'pricing',
    title: { en: 'Pricing & TCO', ru: 'Цены и TCO' },
    prompt: {
      en: 'Analyze vendor pricing and total cost of ownership drivers: licenses, egress, ops overhead. Vendor: "%s".',
      ru: 'Разбери цены вендора и драйверы полной стоимости владения: лицензии, egress, накладные. Вендор: "%s".',
    },
  },
  {
    id: 'lockin',
    title: { en: 'Lock-in risks', ru: 'Риски lock-in' },
    prompt: {
      en: 'Assess lock-in risks: proprietary APIs, data portability, exit costs, preview GA status. Vendor: "%s".',
      ru: 'Оцени риски lock-in: проприетарные API, портируемость данных, стоимость выхода, статус GA. Вендор: "%s".',
    },
  },
  {
    id: 'references',
    title: { en: 'References', ru: 'Референсы' },
    prompt: {
      en: 'Gather public references and production-adoption evidence for this vendor. Vendor: "%s".',
      ru: 'Собери публичные референсы и факты прод-использования вендора. Вендор: "%s".',
    },
  },
  {
    id: 'recommendation',
    title: { en: 'Recommendation', ru: 'Рекомендация' },
    prompt: {
      en: 'Formulate a pragmatic adopt/pilot/reject recommendation for this vendor with conditions. Vendor: "%s".',
      ru: 'Сформулируй прагматичную рекомендацию adopt/pilot/reject по вендору с условиями. Вендор: "%s".',
    },
  },
];

export type ResearchPackKind = 'research' | 'competitor' | 'literature' | 'vendor';

const PACKS: Record<ResearchPackKind, SubtaskTemplate[]> = {
  research: RESEARCH_SUBTASKS,
  competitor: COMPETITOR_SUBTASKS,
  literature: LITERATURE_SUBTASKS,
  vendor: VENDOR_SUBTASKS,
};

export const DEFAULT_PERSONAS: NonNullable<ResearchPackOptions['personas']> = [
  {
    id: 'analyst',
    systemPrompt: {
      en: 'You are a sober industry analyst: data first, no hype.',
      ru: 'Ты трезвый отраслевой аналитик: сначала данные, без ажиотажа.',
    },
  },
  {
    id: 'skeptic',
    systemPrompt: {
      en: 'You are a skeptic: challenge claims, hunt failure modes and costs.',
      ru: 'Ты скептик: оспаривай утверждения, ищи слабые места и издержки.',
    },
  },
  {
    id: 'optimist',
    systemPrompt: {
      en: 'You are an optimist: seek upside, momentum and opportunities.',
      ru: 'Ты оптимист: ищи апсайд, динамику и возможности.',
    },
  },
];

const CHEAP_SUBTASK_IDS = new Set(['landscape', 'alternatives', 'surveys', 'references']);

export function buildResearchSpec(topic: string, opts: ResearchPackOptions = {}): RunSpec {
  const trimmed = topic.trim();
  if (!trimmed) throw new Error('research topic must not be empty');
  const lang = opts.language ?? 'ru';
  return {
    id: opts.id ?? `research-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: lang === 'ru' ? `Рисёрч: ${trimmed.slice(0, 60)}` : `Research: ${trimmed.slice(0, 60)}`,
    subtasks: (opts.personas ?? []).length > 0
      ? PACKS[opts.kind ?? 'research'].flatMap((t) =>
          opts.personas!.map((p) => ({
            id: `${p.id}--${t.id}`,
            title: `${t.title[lang]} — ${p.id}`,
            prompt: `${p.systemPrompt[lang]} ${t.prompt[lang].replace('%s', trimmed)}`,
            model: opts.cheapModelId && CHEAP_SUBTASK_IDS.has(t.id) ? { modelId: opts.cheapModelId } : opts.model,
          })),
        )
      : PACKS[opts.kind ?? 'research'].map((t) => ({
          id: t.id,
          title: t.title[lang],
          prompt: t.prompt[lang].replace('%s', trimmed),
          model: opts.cheapModelId && CHEAP_SUBTASK_IDS.has(t.id) ? { modelId: opts.cheapModelId } : opts.model,
        })),
    model: opts.model,
    limits: opts.limits,
    metadata: { kind: opts.kind ?? 'research', topic: trimmed, ...opts.metadata },
  };
}
