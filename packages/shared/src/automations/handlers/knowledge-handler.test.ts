/**
 * Tests for KnowledgeHandler
 */

import { describe, it, expect, beforeEach, afterEach, jest } from 'bun:test';
import { WorkspaceEventBus } from '../event-bus.ts';
import {
  KnowledgeHandler,
  type KnowledgeActionExecutor,
  type KnowledgeHandlerOptions,
  type CloudRunSubmitExecutor,
} from './knowledge-handler.ts';
import type { AutomationsConfigProvider } from './types.ts';
import type { AutomationMatcher, AutomationEvent, KnowledgeAutomationAction, CloudRunSubmitAction } from '../types.ts';

function createMockConfigProvider(
  matchersByEvent: Partial<Record<AutomationEvent, AutomationMatcher[]>> = {},
): AutomationsConfigProvider {
  return {
    getConfig: () => ({ automations: matchersByEvent }),
    getMatchersForEvent: (event: AutomationEvent) => matchersByEvent[event] ?? [],
  };
}

function createKnowledgeExecutor(
  impl?: KnowledgeActionExecutor['execute'],
): KnowledgeActionExecutor & { execute: jest.Mock } {
  return {
    execute: jest.fn(impl ?? (async () => ({ ok: true, proposalId: 'prop-1' }))),
  };
}

function createCloudRunExecutor(
  impl?: CloudRunSubmitExecutor['submit'],
): CloudRunSubmitExecutor & { submit: jest.Mock } {
  return {
    submit: jest.fn(impl ?? (async () => ({ ok: true, runId: 'run-1' }))),
  };
}

function createOptions(
  overrides: Partial<KnowledgeHandlerOptions> & {
    knowledgeExecutor: KnowledgeActionExecutor;
  },
): KnowledgeHandlerOptions {
  return {
    workspaceId: 'ws-1',
    workspaceRootPath: '/tmp/ws',
    ...overrides,
  };
}

describe('KnowledgeHandler', () => {
  let bus: WorkspaceEventBus;

  beforeEach(() => {
    bus = new WorkspaceEventBus('test-workspace');
  });

  afterEach(() => {
    bus.dispose();
  });

  describe('event matching and executor calls', () => {
    it('calls knowledge executor for KnowledgeAttributeChanged matcher', async () => {
      const executor = createKnowledgeExecutor();
      const configProvider = createMockConfigProvider({
        KnowledgeAttributeChanged: [
          {
            id: 'a1b2c3',
            name: 'needs-research → cloud run',
            conditions: [
              { condition: 'state', field: 'newValue', value: 'needs-research' },
            ],
            actions: [
              {
                type: 'knowledge',
                op: 'set_attribute',
                name: 'workflow_status',
                value: 'review',
                targetRef: { scheme: 'siyuan', kind: 'block', id: 'row-1' },
              },
            ],
          },
        ],
      });

      const handler = new KnowledgeHandler(createOptions({ knowledgeExecutor: executor }), configProvider);
      handler.subscribe(bus);

      await bus.emit('KnowledgeAttributeChanged', {
        workspaceId: 'ws-1',
        timestamp: Date.now(),
        newValue: 'needs-research',
        oldValue: 'open',
        attribute: { name: 'workflow_status' },
        rowId: 'row-1',
        ref: { scheme: 'siyuan', kind: 'block', id: 'row-1' },
      });

      expect(executor.execute).toHaveBeenCalledTimes(1);
      const [action, ctx] = executor.execute.mock.calls[0] as [
        KnowledgeAutomationAction,
        { automationName: string; matcherId?: string; workspaceId: string },
      ];
      expect(action).toMatchObject({
        type: 'knowledge',
        op: 'set_attribute',
        name: 'workflow_status',
        value: 'review',
      });
      expect(ctx.automationName).toBe('needs-research → cloud run');
      expect(ctx.matcherId).toBe('a1b2c3');
      expect(ctx.workspaceId).toBe('ws-1');

      handler.dispose();
    });

    it('calls cloud_run.submit executor on matching event', async () => {
      const knowledgeExecutor = createKnowledgeExecutor();
      const cloudExecutor = createCloudRunExecutor();
      const configProvider = createMockConfigProvider({
        KnowledgeAttributeChanged: [
          {
            id: 'a1',
            name: 'kick research',
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
      });

      const handler = new KnowledgeHandler(
        createOptions({ knowledgeExecutor, cloudRunSubmitExecutor: cloudExecutor }),
        configProvider,
      );
      handler.subscribe(bus);

      await bus.emit('KnowledgeAttributeChanged', {
        workspaceId: 'ws-1',
        timestamp: Date.now(),
        title: 'Topic A',
        rowId: 'row-42',
        newValue: 'needs-research',
      });

      expect(cloudExecutor.submit).toHaveBeenCalledTimes(1);
      const [action] = cloudExecutor.submit.mock.calls[0] as [CloudRunSubmitAction];
      expect(action).toMatchObject({
        type: 'cloud_run.submit',
        skillSlug: 'deep-research',
        topic: 'Topic A',
        callbackTag: 'row-42',
        labels: ['knowledge-triggered'],
      });
      expect(knowledgeExecutor.execute).not.toHaveBeenCalled();

      handler.dispose();
    });

    it('runs CloudRunCompleted success path actions (publish + link + set_attribute)', async () => {
      const knowledgeExecutor = createKnowledgeExecutor(async (action) => {
        if (action.op === 'link_session') return { ok: true, linkId: 'link-1' };
        return { ok: true, proposalId: `prop-${action.op}` };
      });
      const configProvider = createMockConfigProvider({
        CloudRunCompleted: [
          {
            id: 'd4e5f6',
            name: 'research report → SiYuan + status review',
            attributeAllowList: ['workflow_status'],
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
      });

      const results: Array<{ ok: boolean; proposalId?: string; linkId?: string }> = [];
      const handler = new KnowledgeHandler(
        createOptions({
          knowledgeExecutor,
          onKnowledgeResults: (r) => results.push(...r),
        }),
        configProvider,
      );
      handler.subscribe(bus);

      await bus.emit('CloudRunCompleted', {
        workspaceId: 'ws-1',
        timestamp: Date.now(),
        runId: 'run-99',
        callbackTag: 'row-7',
        state: 'done',
        labels: ['knowledge-triggered'],
      });

      expect(knowledgeExecutor.execute).toHaveBeenCalledTimes(3);

      const ops = knowledgeExecutor.execute.mock.calls.map(
        (c) => (c[0] as KnowledgeAutomationAction).op,
      );
      expect(ops).toEqual(['publish_run', 'link_session', 'set_attribute']);

      const publishAction = knowledgeExecutor.execute.mock.calls[0]![0] as KnowledgeAutomationAction;
      expect(publishAction.runId).toBe('run-99');
      expect(publishAction.review).toBe('required');

      const linkAction = knowledgeExecutor.execute.mock.calls[1]![0] as KnowledgeAutomationAction;
      expect(linkAction.knowledgeRef).toEqual({ scheme: 'siyuan', kind: 'block', id: 'row-7' });
      expect(linkAction.craftRef).toEqual({ scheme: 'craft', kind: 'run', id: 'run-99' });

      const setAction = knowledgeExecutor.execute.mock.calls[2]![0] as KnowledgeAutomationAction;
      expect(setAction.targetRef).toEqual({ scheme: 'siyuan', kind: 'block', id: 'row-7' });
      expect(setAction.name).toBe('workflow_status');
      expect(setAction.value).toBe('review');

      const setCtx = knowledgeExecutor.execute.mock.calls[2]![1] as { attributeAllowList?: string[] };
      expect(setCtx.attributeAllowList).toEqual(['workflow_status']);

      expect(results).toHaveLength(3);
      handler.dispose();
    });

    it('does not fire when matcher conditions fail', async () => {
      const executor = createKnowledgeExecutor();
      const configProvider = createMockConfigProvider({
        KnowledgeAttributeChanged: [
          {
            actions: [{ type: 'knowledge', op: 'set_attribute', name: 'x', value: 'y' }],
            conditions: [{ condition: 'state', field: 'newValue', value: 'needs-research' }],
          },
        ],
      });

      const handler = new KnowledgeHandler(createOptions({ knowledgeExecutor: executor }), configProvider);
      handler.subscribe(bus);

      await bus.emit('KnowledgeAttributeChanged', {
        workspaceId: 'ws-1',
        timestamp: Date.now(),
        newValue: 'open',
      });

      expect(executor.execute).not.toHaveBeenCalled();
      handler.dispose();
    });

    it('ignores non-knowledge App events', async () => {
      const executor = createKnowledgeExecutor();
      const configProvider = createMockConfigProvider({
        LabelAdd: [
          {
            actions: [{ type: 'knowledge', op: 'set_attribute', name: 'x', value: 'y' }],
          },
        ],
      });

      const handler = new KnowledgeHandler(createOptions({ knowledgeExecutor: executor }), configProvider);
      handler.subscribe(bus);

      await bus.emit('LabelAdd', {
        workspaceId: 'ws-1',
        timestamp: Date.now(),
        label: 'Publish',
      });

      expect(executor.execute).not.toHaveBeenCalled();
      handler.dispose();
    });

    it('expands $VAR env templates in action fields', async () => {
      const executor = createKnowledgeExecutor();
      const configProvider = createMockConfigProvider({
        KnowledgeDocumentCreated: [
          {
            actions: [
              {
                type: 'knowledge',
                op: 'append_block',
                markdown: 'Created in $CRAFT_WORKSPACE_ID',
                parentRef: { scheme: 'siyuan', kind: 'document', id: 'doc-1' },
              },
            ],
          },
        ],
      });

      const handler = new KnowledgeHandler(createOptions({ knowledgeExecutor: executor }), configProvider);
      handler.subscribe(bus);

      await bus.emit('KnowledgeDocumentCreated', {
        workspaceId: 'ws-1',
        timestamp: Date.now(),
        ref: { scheme: 'siyuan', kind: 'document', id: 'doc-1' },
      });

      const [action] = executor.execute.mock.calls[0] as [KnowledgeAutomationAction];
      expect(action.markdown).toBe('Created in ws-1');
      handler.dispose();
    });
  });

  describe('dispose', () => {
    it('unsubscribes from the event bus', () => {
      const executor = createKnowledgeExecutor();
      const handler = new KnowledgeHandler(
        createOptions({ knowledgeExecutor: executor }),
        createMockConfigProvider(),
      );

      handler.subscribe(bus);
      expect(bus.getHandlerCount()).toBe(1);

      handler.dispose();
      expect(bus.getHandlerCount()).toBe(0);
    });

    it('does not process events after disposal', async () => {
      const executor = createKnowledgeExecutor();
      const configProvider = createMockConfigProvider({
        KnowledgeAttributeChanged: [
          {
            actions: [{ type: 'knowledge', op: 'set_attribute', name: 'x', value: 'y' }],
          },
        ],
      });

      const handler = new KnowledgeHandler(createOptions({ knowledgeExecutor: executor }), configProvider);
      handler.subscribe(bus);
      handler.dispose();

      await bus.emit('KnowledgeAttributeChanged', {
        workspaceId: 'ws-1',
        timestamp: Date.now(),
        newValue: 'needs-research',
      });

      expect(executor.execute).not.toHaveBeenCalled();
    });
  });
});
