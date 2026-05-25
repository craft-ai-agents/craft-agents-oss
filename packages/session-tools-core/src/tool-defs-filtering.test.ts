import { describe, it, expect } from 'bun:test';
import {
  SESSION_TOOL_DEFS,
  getSessionToolDefs,
  getSessionToolNames,
  getSessionToolRegistry,
  getSessionSafeAllowedToolNames,
  getSessionSafeBlockedToolNames,
  getToolDefsAsJsonSchema,
  CreateAutomationSchema,
} from './tool-defs.ts';

describe('session tool filtering helpers', () => {
  it('excludes developer feedback tool when includeDeveloperFeedback is false', () => {
    const defs = getSessionToolDefs({ includeDeveloperFeedback: false });
    const names = defs.map(d => d.name);

    expect(names.includes('send_developer_feedback')).toBe(false);
  });

  it('includes developer feedback tool when includeDeveloperFeedback is true', () => {
    const defs = getSessionToolDefs({ includeDeveloperFeedback: true });
    const names = defs.map(d => d.name);

    expect(names.includes('send_developer_feedback')).toBe(true);
  });

  it('name set and registry stay aligned for filtered output', () => {
    const names = getSessionToolNames({ includeDeveloperFeedback: false });
    const registry = getSessionToolRegistry({ includeDeveloperFeedback: false });

    expect(registry.has('send_developer_feedback')).toBe(false);
    expect(names.has('send_developer_feedback')).toBe(false);

    for (const name of names) {
      expect(registry.has(name)).toBe(true);
    }
  });

  it('json schema conversion respects includeDeveloperFeedback filter', () => {
    const defs = getToolDefsAsJsonSchema({ includeDeveloperFeedback: false });
    const names = defs.map(d => d.name);

    expect(names.includes('send_developer_feedback')).toBe(false);
  });

  it('all canonical session tools declare safeMode metadata', () => {
    for (const def of SESSION_TOOL_DEFS) {
      expect(def.safeMode === 'allow' || def.safeMode === 'block').toBe(true);
    }
  });

  it('teaches output tools Canvas publishing format rules', () => {
    const createOutput = SESSION_TOOL_DEFS.find((def) => def.name === 'create_output');
    const visualSurface = SESSION_TOOL_DEFS.find((def) => def.name === 'visual_surface');

    expect(createOutput?.description).toContain('Set `showInCanvas: true` when the user asks to see, preview, compare, review, present, open, or iterate');
    expect(createOutput?.description).toContain('Canvas preview format rules');
    expect(createOutput?.description).toContain('Local/generated web: attach the HTML file as the primary file');
    expect(createOutput?.description).toContain('The Output system infers the Canvas web preview');
    expect(createOutput?.description).toContain('Workflow diagrams: `.workflow.json`');
    expect(createOutput?.description).toContain('If an Output already exists, use visual_surface_state and visual_surface');
    expect(visualSurface?.description).toContain('avoid duplicate cards and just reference what is already on Canvas');
  });

  it('safe-mode helper sets classify expected tools', () => {
    const allowed = getSessionSafeAllowedToolNames();
    const blocked = getSessionSafeBlockedToolNames();

    expect(allowed.has('send_developer_feedback')).toBe(true);
    expect(allowed.has('call_llm')).toBe(true);
    expect(allowed.has('browser_tool')).toBe(true);
    expect(allowed.has('script_sandbox')).toBe(true);

    expect(blocked.has('source_oauth_trigger')).toBe(true);
    expect(blocked.has('source_credential_prompt')).toBe(true);
    expect(blocked.has('spawn_session')).toBe(true);
    expect(blocked.has('save_memory')).toBe(true);
    expect(blocked.has('update_memory')).toBe(true);
    expect(blocked.has('forget_memory')).toBe(true);
  });

  it('safe-mode helpers support MCP prefixing', () => {
    const allowedPrefixed = getSessionSafeAllowedToolNames({ prefix: 'mcp__session__' });
    const blockedPrefixed = getSessionSafeBlockedToolNames({ prefix: 'mcp__session__' });

    expect(allowedPrefixed.has('mcp__session__send_developer_feedback')).toBe(true);
    expect(allowedPrefixed.has('mcp__session__call_llm')).toBe(true);
    expect(allowedPrefixed.has('mcp__session__script_sandbox')).toBe(true);
    expect(blockedPrefixed.has('mcp__session__source_oauth_trigger')).toBe(true);
    expect(blockedPrefixed.has('mcp__session__spawn_session')).toBe(true);
  });

  it('create_automation schema matches runtime thinkingLevel and webhook auth fields', () => {
    const valid = CreateAutomationSchema.safeParse({
      eventName: 'WebhookReceive',
      matcher: {
        slug: 'incoming-hook',
        secretEnv: 'CRAFT_WH_INCOMING_HOOK_SECRET',
        allowUnauthenticated: false,
        allowedMethods: ['POST'],
        actions: [{
          type: 'prompt',
          prompt: 'Handle $CRAFT_BODY',
          thinkingLevel: 'xhigh',
        }],
      },
    });
    expect(valid.success).toBe(true);

    const invalidThinking = CreateAutomationSchema.safeParse({
      eventName: 'SchedulerTick',
      matcher: {
        cron: '* * * * *',
        actions: [{ type: 'prompt', prompt: 'run', thinkingLevel: 'disabled' }],
      },
    });
    expect(invalidThinking.success).toBe(false);
  });
});
