import { describe, expect, it } from 'bun:test';
import { CRAFT_AUTOMATION_SEED_VERSION } from './default-seeds.ts';
import { AutomationsConfigSchema } from './schemas.ts';
import {
  automationGraphRevision,
  buildAutomationGraphSave,
  compileAutomationGraph,
  createDefaultAutomationGraph,
  getAutomationGraphProjection,
  projectAutomationsToGraph,
} from './graph.ts';

const schedulerConfig = {
  version: 2,
  automations: {
    SchedulerTick: [{
      id: 'morning',
      name: 'Morning plan',
      cron: '0 9 * * 1-5',
      timezone: 'Europe/Moscow',
      permissionMode: 'safe' as const,
      labels: ['scheduled'],
      actions: [
        { type: 'prompt' as const, prompt: 'Prepare today\'s priorities.' },
        { type: 'webhook' as const, url: 'https://hooks.example.test/summary', method: 'POST' as const },
      ],
    }],
  },
};

describe('automation graph compiler', () => {
  it('round-trips a current SchedulerTick matcher through graph metadata', () => {
    const graph = projectAutomationsToGraph(schedulerConfig);

    expect(compileAutomationGraph(graph).automations).toEqual(schedulerConfig.automations);
  });

  it('uses the existing seeded SchedulerTick prompt flow only as a pure missing-config projection', () => {
    const graph = createDefaultAutomationGraph();
    const compiled = compileAutomationGraph(graph);

    expect(graph.nodes.some((node) => node.kind === 'trigger' && node.data.event === 'SchedulerTick')).toBe(true);
    expect(compiled.automations.SchedulerTick?.[0]?.actions[0]).toMatchObject({ type: 'prompt' });
    expect(getAutomationGraphProjection(null).isDefault).toBe(true);
  });

  it('preserves an explicit user-empty configuration instead of projecting a seed', () => {
    const explicitEmpty = {
      version: 2,
      craftSeedVersion: CRAFT_AUTOMATION_SEED_VERSION,
      automations: {},
    };
    const projection = getAutomationGraphProjection(explicitEmpty);

    expect(projection.isDefault).toBe(false);
    expect(projection.graph.nodes).toEqual([]);
    expect(projection.graph.edges).toEqual([]);

    const saved = buildAutomationGraphSave(explicitEmpty, {
      workspaceId: 'workspace',
      graph: projection.graph,
      baseRevision: automationGraphRevision(explicitEmpty),
    });
    expect(saved.config).toMatchObject({
      craftSeedVersion: CRAFT_AUTOMATION_SEED_VERSION,
      automations: {},
    });
  });

  it('preserves broad legacy schema acceptance but rejects a graph projection that would drop it', () => {
    const legacyConfig = {
      version: 2,
      automations: {
        SchedulerTick: [{
          actions: [{ type: 'legacy.action', preserved: true }],
        }],
      },
    };

    expect(AutomationsConfigSchema.safeParse(legacyConfig).success).toBe(true);
    expect(() => projectAutomationsToGraph(legacyConfig)).toThrow(/legacy\.action/);
  });

  it('rejects an unmapped custom metadata node on an executable path', () => {
    const graph = projectAutomationsToGraph(schedulerConfig);
    const matcher = graph.nodes.find((node) => node.kind === 'matcher');
    expect(matcher).toBeDefined();

    graph.nodes.push({
      id: 'decision:manual',
      kind: 'decision',
      position: { x: 460, y: 0 },
      data: { expression: 'Only run when reviewed' },
    });
    graph.edges.push({
      id: 'edge:matcher:decision',
      source: matcher!.id,
      target: 'decision:manual',
      kind: 'flow',
    });

    expect(() => compileAutomationGraph(graph)).toThrow(/Unmapped executable path/);
  });

  it('rejects an unknown custom node instead of accepting unvalidated executable JSON', () => {
    const graph = projectAutomationsToGraph(schedulerConfig);
    const customGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          id: 'custom:unmapped',
          kind: 'custom',
          position: { x: 0, y: 240 },
          data: { runtime: 'shell' },
        },
      ],
    };

    expect(() => compileAutomationGraph(customGraph)).toThrow(/Invalid automation graph/);
  });

  it('rejects dangling and cyclic executable paths', () => {
    const dangling = projectAutomationsToGraph(schedulerConfig);
    dangling.edges[0]!.target = 'missing-node';
    expect(() => compileAutomationGraph(dangling)).toThrow(/Dangling edge/);

    const cyclic = projectAutomationsToGraph(schedulerConfig);
    const matcher = cyclic.nodes.find((node) => node.kind === 'matcher');
    const lastAction = cyclic.nodes.filter((node) => node.kind === 'prompt' || node.kind === 'webhook').at(-1);
    expect(matcher).toBeDefined();
    expect(lastAction).toBeDefined();
    cyclic.edges.push({
      id: 'edge:cycle',
      source: lastAction!.id,
      target: matcher!.id,
      kind: 'flow',
    });

    expect(() => compileAutomationGraph(cyclic)).toThrow(/Cyclic executable path/);
  });
});
