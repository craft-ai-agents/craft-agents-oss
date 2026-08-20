/**
 * Tests for knowledge automation events, actions, and schemas (P6)
 */

import { describe, it, expect } from 'bun:test';
import {
  APP_EVENTS,
  type KnowledgeAutomationAction,
  type CloudRunSubmitAction,
} from './types.ts';
import {
  AutomationsConfigSchema,
  KnowledgeAutomationActionSchema,
  CloudRunSubmitActionSchema,
  KnowledgeAutomationOpSchema,
  ActionDefinitionSchema,
  VALID_EVENTS,
} from './schemas.ts';
import { validateAutomationsConfig } from './validation.ts';
import { deriveAutomationName } from './name-utils.ts';

describe('P6 knowledge automation types/schemas', () => {
  describe('APP_EVENTS', () => {
    it('includes all knowledge + CloudRunCompleted events', () => {
      const required = [
        'KnowledgeDocumentCreated',
        'KnowledgeDocumentUpdated',
        'KnowledgeAttributeChanged',
        'KnowledgeDatabaseRowChanged',
        'KnowledgeDocumentStale',
        'CloudRunCompleted',
      ] as const;
      for (const event of required) {
        expect(APP_EVENTS).toContain(event);
        expect(VALID_EVENTS).toContain(event);
      }
    });

    it('keeps legacy App events', () => {
      expect(APP_EVENTS).toContain('LabelAdd');
      expect(APP_EVENTS).toContain('SchedulerTick');
    });
  });

  describe('KnowledgeAutomationActionSchema', () => {
    it('accepts all knowledge ops', () => {
      const ops = KnowledgeAutomationOpSchema.options;
      expect(ops).toEqual([
        'create_document',
        'append_block',
        'propose_patch',
        'set_attribute',
        'link_session',
        'publish_run',
      ]);

      for (const op of ops) {
        const result = KnowledgeAutomationActionSchema.safeParse({
          type: 'knowledge',
          op,
        });
        expect(result.success).toBe(true);
      }
    });

    it('accepts full set_attribute action', () => {
      const action: KnowledgeAutomationAction = {
        type: 'knowledge',
        op: 'set_attribute',
        targetRef: { scheme: 'siyuan', kind: 'block', id: 'row-1' },
        name: 'workflow_status',
        value: 'review',
        autoApply: false,
      };
      const result = KnowledgeAutomationActionSchema.safeParse(action);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toMatchObject(action);
      }
    });

    it('accepts string refs (env-expandable)', () => {
      const result = KnowledgeAutomationActionSchema.safeParse({
        type: 'knowledge',
        op: 'link_session',
        knowledgeRef: 'siyuan/block/{{event.callbackTag}}',
        craftRef: { scheme: 'craft', kind: 'run', id: '{{event.runId}}' },
        relation: 'researched-by',
      });
      expect(result.success).toBe(true);
    });

    it('rejects unknown op', () => {
      const result = KnowledgeAutomationActionSchema.safeParse({
        type: 'knowledge',
        op: 'delete_everything',
      });
      expect(result.success).toBe(false);
    });

    it('rejects wrong type literal', () => {
      const result = KnowledgeAutomationActionSchema.safeParse({
        type: 'prompt',
        op: 'set_attribute',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('CloudRunSubmitActionSchema', () => {
    it('accepts cloud_run.submit action', () => {
      const action: CloudRunSubmitAction = {
        type: 'cloud_run.submit',
        skillSlug: 'deep-research',
        topic: '{{event.title}}',
        labels: ['knowledge-triggered'],
        callbackTag: '{{event.rowId}}',
      };
      const result = CloudRunSubmitActionSchema.safeParse(action);
      expect(result.success).toBe(true);
    });
  });

  describe('ActionDefinitionSchema', () => {
    it('accepts knowledge and cloud_run.submit via union', () => {
      expect(
        ActionDefinitionSchema.safeParse({
          type: 'knowledge',
          op: 'propose_patch',
          targetRef: { scheme: 'siyuan', kind: 'document', id: 'd1' },
          patchMarkdown: '# patched',
          baseHash: 'abc',
        }).success,
      ).toBe(true);

      expect(
        ActionDefinitionSchema.safeParse({
          type: 'cloud_run.submit',
          skillSlug: 'deep-research',
        }).success,
      ).toBe(true);

      // existing still work
      expect(
        ActionDefinitionSchema.safeParse({ type: 'prompt', prompt: 'hi' }).success,
      ).toBe(true);
      expect(
        ActionDefinitionSchema.safeParse({
          type: 'webhook',
          url: 'https://example.com/hook',
        }).success,
      ).toBe(true);
    });
  });

  describe('validateAutomationsConfig reference scenario', () => {
    it('accepts K-10 needs-research → cloud run → review automations.json', () => {
      const config = {
        automations: {
          KnowledgeAttributeChanged: [
            {
              id: 'a1b2c3',
              name: 'needs-research → cloud run',
              enabled: true,
              permissionMode: 'ask',
              conditions: [
                { condition: 'state', field: 'newValue', value: 'needs-research' },
              ],
              actions: [
                {
                  type: 'cloud_run.submit',
                  skillSlug: 'deep-research',
                  topic: '{{event.title}}',
                  labels: ['knowledge-triggered'],
                  callbackTag: '{{event.rowId}}',
                },
              ],
            },
          ],
          CloudRunCompleted: [
            {
              id: 'd4e5f6',
              name: 'research report → SiYuan + status review',
              enabled: true,
              attributeAllowList: ['workflow_status', 'valid_until'],
              conditions: [
                { condition: 'state', field: 'labels', contains: 'knowledge-triggered' },
              ],
              actions: [
                {
                  type: 'knowledge',
                  op: 'publish_run',
                  runId: '{{event.runId}}',
                  targetNotebook: 'Research',
                  targetPath: '/Research/Reports',
                  review: 'required',
                },
                {
                  type: 'knowledge',
                  op: 'link_session',
                  knowledgeRef: { scheme: 'siyuan', kind: 'block', id: '{{event.callbackTag}}' },
                  craftRef: { scheme: 'craft', kind: 'run', id: '{{event.runId}}' },
                  relation: 'researched-by',
                },
                {
                  type: 'knowledge',
                  op: 'set_attribute',
                  targetRef: { scheme: 'siyuan', kind: 'block', id: '{{event.callbackTag}}' },
                  name: 'workflow_status',
                  value: 'review',
                },
              ],
            },
          ],
        },
      };

      const result = validateAutomationsConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.config?.automations.KnowledgeAttributeChanged).toHaveLength(1);
      expect(result.config?.automations.CloudRunCompleted).toHaveLength(1);
      expect(result.config?.automations.CloudRunCompleted?.[0]?.attributeAllowList).toEqual([
        'workflow_status',
        'valid_until',
      ]);
      expect(result.config?.automations.CloudRunCompleted?.[0]?.actions).toHaveLength(3);
    });

    it('parses via AutomationsConfigSchema directly', () => {
      const parsed = AutomationsConfigSchema.safeParse({
        automations: {
          KnowledgeDocumentStale: [
            {
              actions: [
                {
                  type: 'knowledge',
                  op: 'create_document',
                  notebook: 'Research',
                  path: '/Research/Stale',
                  markdown: '# stale note',
                },
              ],
            },
          ],
        },
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe('deriveAutomationName', () => {
    it('names knowledge and cloud_run actions', () => {
      expect(
        deriveAutomationName('CloudRunCompleted', {
          actions: [{ type: 'knowledge', op: 'publish_run', runId: 'r1' }],
        }),
      ).toBe('knowledge.publish_run');

      expect(
        deriveAutomationName('KnowledgeAttributeChanged', {
          actions: [{ type: 'cloud_run.submit', skillSlug: 'deep-research' }],
        }),
      ).toBe('cloud_run.submit deep-research');
    });
  });
});
