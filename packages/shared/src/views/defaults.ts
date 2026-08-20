/**
 * Default Views
 *
 * Built-in views provided to new workspaces (or when views.json is missing).
 * Users can modify or remove these — they're just the starting point.
 */

import type { ViewConfig } from './types.ts';

/**
 * Default session views seeded into views.json.
 * Each represents a common session state that users want to see at a glance.
 */
export function getDefaultViews(): ViewConfig[] {
  return [
    {
      id: 'view-new',
      name: 'New',
      description: 'Sessions with unread messages',
      color: 'accent',
      domain: 'sessions',
      expression: 'hasUnread == true',
    },
    {
      id: 'view-plan',
      name: 'Plan',
      description: 'Sessions with a pending plan awaiting approval',
      color: 'info',
      domain: 'sessions',
      expression: 'hasPendingPlan == true',
    },
    {
      id: 'view-explore',
      name: 'Explore',
      description: 'Sessions in Explore (read-only) mode',
      color: 'foreground/50',
      domain: 'sessions',
      expression: 'permissionMode == "safe"',
    },
    {
      id: 'view-processing',
      name: 'Processing',
      description: 'Sessions where the agent is currently running',
      color: 'success',
      domain: 'sessions',
      expression: 'isProcessing == true',
    },
  ];
}

/**
 * Default knowledge views (P5 / K-09 §3.5).
 * Merged by id on load — never overwrites user-edited configs with the same id.
 */
export function getDefaultKnowledgeViews(): ViewConfig[] {
  return [
    {
      id: 'research-needs-review',
      name: 'Research needs review',
      description: 'Research notebook documents with knowledge-workflow_status=needs-review',
      domain: 'knowledge',
      // Structural filter does the work; expression can refine.
      // Attr keys MUST match mutation allowlist names (craft-*|knowledge-*) so
      // viewSetAttribute / setAttribute / attributeSearch share one key path.
      expression: 'true',
      knowledgeFilter: {
        pathPrefix: '/Research',
        attributes: { 'knowledge-workflow_status': 'needs-review' },
      },
      groupBy: 'topic',
      sort: [{ field: 'updated_at', direction: 'desc' }],
      presetActions: [
        { type: 'set_attribute', name: 'knowledge-workflow_status', value: 'approved' },
      ],
    },
    {
      id: 'recently-updated',
      name: 'Recently updated',
      description: 'All knowledge documents, newest first',
      domain: 'knowledge',
      expression: 'true',
      knowledgeFilter: {
        kinds: ['document'],
        query: '',
      },
      sort: [{ field: 'updated_at', direction: 'desc' }],
    },
  ];
}
