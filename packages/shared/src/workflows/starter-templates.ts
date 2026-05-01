/**
 * Starter workflow templates seeded into the global library on first run.
 *
 * Each entry maps to a `WORKFLOW.md` written under `~/.workflows/<slug>/`.
 * Seeding is idempotent: existing files are never overwritten, and tombstoned
 * starters stay deleted (`.deleted-workflows.json`). They are starters, not
 * load-bearing built-ins — `ensureRequiredWorkflows` should NOT include them.
 */

import type { WorkflowMetadata } from './types.ts';

export const WEEKLY_CONTENT_PIPELINE_SLUG = 'weekly-content-pipeline';
export const EMAIL_TRIAGE_SLUG = 'email-triage';

const weeklyContentPipeline = {
  slug: WEEKLY_CONTENT_PIPELINE_SLUG,
  metadata: {
    name: 'Weekly Content Pipeline',
    description: 'Research a topic, draft a post, critique it, revise, hand off for human approval.',
    avatar: '📝',
    trigger: {
      type: 'manual' as const,
      inputs: [
        {
          name: 'topic',
          type: 'string',
          required: true,
          description: 'What you want to write about (one sentence)',
        },
        { name: 'word_count', type: 'number', default: 600 },
        { name: 'audience', type: 'string', default: 'experienced practitioners' },
      ],
    },
    steps: [
      {
        id: 'research',
        agent: 'researcher',
        input:
          'Research "{{trigger.topic}}". Prefer primary sources. Return:\n' +
          '- 3-sentence TL;DR\n' +
          '- 4-6 key findings, each with a citation\n' +
          '- 2-3 open questions\n' +
          '- Numbered source list\n',
      },
      {
        id: 'draft',
        agent: 'writer',
        input:
          'Write a {{trigger.word_count}}-word blog post for {{trigger.audience}}.\n' +
          'Direct, specific voice. No throat-clearing.\n\n' +
          'Source material:\n' +
          '{{steps.research.output}}\n',
      },
      {
        id: 'critique',
        agent: 'critic',
        input:
          'Review this draft. Honest, not nice. Single highest-leverage change.\n\n' +
          '{{steps.draft.output}}\n',
      },
      {
        id: 'revise',
        agent: 'writer',
        input:
          'Revise the draft based on this critique. Keep the word count close to {{trigger.word_count}}.\n\n' +
          'Original draft:\n' +
          '{{steps.draft.output}}\n\n' +
          'Critique:\n' +
          '{{steps.critique.output}}\n',
      },
    ],
  } satisfies WorkflowMetadata,
  body:
    '# Weekly Content Pipeline\n\n' +
    'Run this when you have a half-formed topic and want a clean draft to start from.\n\n' +
    '**Tips:**\n' +
    '- Spend the most prompt budget on the topic — vague topics produce vague research.\n' +
    '- The critique step is intentionally harsh. If the revised draft still feels weak, fork this workflow and tweak the critic\'s prompt to be even more specific.\n',
};

const emailTriage = {
  slug: EMAIL_TRIAGE_SLUG,
  metadata: {
    name: 'Email Triage',
    description: 'Classify an email, decide on next action, optionally draft a reply.',
    avatar: '📥',
    trigger: {
      type: 'manual' as const,
      inputs: [
        { name: 'from', type: 'string', required: true },
        { name: 'subject', type: 'string', required: true },
        { name: 'body', type: 'string', required: true },
      ],
    },
    steps: [
      {
        id: 'classify',
        agent: 'triager',
        input:
          'Classify this email. Return:\n' +
          '- urgency: now | today | this week | later | drop\n' +
          '- category: question | sales | newsletter | bug-report | personal | other\n' +
          '- one-line summary\n' +
          '- action: reply | forward | delete | nothing\n\n' +
          'From: {{trigger.from}}\n' +
          'Subject: {{trigger.subject}}\n\n' +
          'Body:\n' +
          '{{trigger.body}}\n',
      },
      {
        id: 'draft_reply',
        agent: 'writer',
        input:
          'Draft a short, direct reply to this email. Match my voice (clear, no fluff).\n\n' +
          'Triage notes: {{steps.classify.output}}\n\n' +
          'Original:\n' +
          'From: {{trigger.from}}\n' +
          'Subject: {{trigger.subject}}\n' +
          'Body: {{trigger.body}}\n',
      },
    ],
  } satisfies WorkflowMetadata,
  body:
    '# Email Triage\n\n' +
    'Pair this with the eventual EmailReceive trigger (Phase 4 + future external trigger from `docs/future-external-triggers.md`).\n\n' +
    'Until then, paste an email manually to test the routing logic.\n',
};

export const STARTER_WORKFLOWS: ReadonlyArray<{
  slug: string;
  metadata: WorkflowMetadata;
  body: string;
}> = [weeklyContentPipeline, emailTriage];

export const STARTER_WORKFLOW_SLUGS: readonly string[] = STARTER_WORKFLOWS.map((w) => w.slug);
