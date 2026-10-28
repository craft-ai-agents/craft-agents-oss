import { describe, it, expect } from 'bun:test';
import {
  SESSION_TOOL_DEFS,
  getSessionToolDefs,
  getSessionToolNames,
  getSessionToolRegistry,
  getSessionSafeAllowedToolNames,
  getSessionSafeBlockedToolNames,
  getToolDefsAsJsonSchema,
  CODING_PROFILE_TOOLS,
  CODING_ONLY_TOOLS,
  SpawnSessionSchema,
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

  it('hides the decide tool unless includeDecide is true', () => {
    expect(getSessionToolDefs().some(d => d.name === 'decide')).toBe(false);
    expect(getSessionToolDefs({ includeDeveloperFeedback: true }).some(d => d.name === 'decide')).toBe(false);
    expect(getSessionToolDefs({ includeDecide: false }).some(d => d.name === 'decide')).toBe(false);
    expect(getSessionToolDefs({ includeDecide: true }).some(d => d.name === 'decide')).toBe(true);
    expect(getToolDefsAsJsonSchema({ prefix: 'mcp__session__' }).some(d => d.name === 'mcp__session__decide')).toBe(false);
    expect(getToolDefsAsJsonSchema({ prefix: 'mcp__session__', includeDecide: true }).some(d => d.name === 'mcp__session__decide')).toBe(true);
    // Unfiltered constants still know the tool so backends can execute it once advertised.
    expect(SESSION_TOOL_DEFS.some(d => d.name === 'decide' && d.executionMode === 'registry' && d.readOnly === true)).toBe(true);
  });

  it('accepts an explicit codingMode on spawn_session', () => {
    expect(SpawnSessionSchema.parse({ prompt: 'edit the code', codingMode: true })).toMatchObject({
      prompt: 'edit the code',
      codingMode: true,
    });
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

  it('safe-mode helper sets classify expected tools', () => {
    const allowed = getSessionSafeAllowedToolNames();
    const blocked = getSessionSafeBlockedToolNames();

    expect(allowed.has('send_developer_feedback')).toBe(true);
    expect(allowed.has('call_llm')).toBe(true);
    expect(allowed.has('browser_tool')).toBe(true);
    expect(allowed.has('script_sandbox')).toBe(true);
    // decide only reads and judges; Explore-safe once it is advertised
    expect(getSessionSafeAllowedToolNames({ includeDecide: true }).has('decide')).toBe(true);

    expect(blocked.has('source_oauth_trigger')).toBe(true);
    expect(blocked.has('source_credential_prompt')).toBe(true);
    expect(blocked.has('spawn_session')).toBe(true);
    // Writes the project's MEMORY.md
    expect(blocked.has('project_memory_append')).toBe(true);

    // Pages: reads are Explore-safe, mutations are not
    expect(allowed.has('list_pages')).toBe(true);
    expect(allowed.has('get_page')).toBe(true);
    expect(blocked.has('create_page')).toBe(true);
    expect(blocked.has('update_page')).toBe(true);
    expect(blocked.has('write_page_data')).toBe(true);
    expect(blocked.has('delete_page')).toBe(true);
  });

  it('MCP source resource and prompt tools are read-only and Explore-safe', () => {
    const allowed = getSessionSafeAllowedToolNames({ prefix: 'mcp__session__' });
    for (const name of ['source_list_resources', 'source_read_resource', 'source_list_prompts', 'source_get_prompt']) {
      expect(allowed.has(`mcp__session__${name}`)).toBe(true);
      expect(SESSION_TOOL_DEFS.some(d => d.name === name && d.executionMode === 'registry' && d.readOnly === true)).toBe(true);
    }
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

  describe('agent profile', () => {
    const names = (options?: Parameters<typeof getSessionToolDefs>[0]) => getSessionToolDefs(options).map(d => d.name);

    it('default profile: every tool except the Coding-only PR tools', () => {
      expect(names({ profile: 'default' })).toEqual(names());
      expect(names({ profile: 'default', includeDecide: true })).toEqual(names({ includeDecide: true }));
      expect(names({ includeDecide: true })).toEqual(SESSION_TOOL_DEFS.map(d => d.name).filter(name => !CODING_ONLY_TOOLS.has(name)));
      expect([...CODING_ONLY_TOOLS]).toEqual(['pr_status', 'pr_bind', 'pr_unbind', 'pr_set_auto_merge']);
      for (const name of CODING_ONLY_TOOLS) {
        expect(names()).not.toContain(name);
        expect(CODING_PROFILE_TOOLS[name]).toBe('always'); // offered in every Coding session instead
      }
    });

    it('keeps only the always-on coding tools in a bare coding session', () => {
      expect(names({ profile: 'coding' })).toEqual(['SubmitPlan', 'send_developer_feedback', 'set_session_labels', 'set_session_status', 'pr_status', 'pr_bind', 'pr_unbind', 'pr_set_auto_merge', 'list_background_tasks']);
      expect(names({ profile: 'coding', includeDeveloperFeedback: false })).toEqual(['SubmitPlan', 'set_session_labels', 'set_session_status', 'pr_status', 'pr_bind', 'pr_unbind', 'pr_set_auto_merge', 'list_background_tasks']);
    });

    it('adds source tools only with enabled sources, project memory only with a project', () => {
      const withSources = names({ profile: 'coding', hasEnabledSources: true });
      expect(withSources).toContain('source_test');
      expect(withSources).toContain('source_oauth_trigger');
      expect(withSources).not.toContain('project_memory_append');

      const withProject = names({ profile: 'coding', hasProject: true });
      expect(withProject).toContain('project_memory_append');
      expect(withProject).not.toContain('source_test');
    });

    it('drops desktop-workflow tools even when their own flags are on', () => {
      const coding = names({ profile: 'coding', includeDecide: true, includeBrowser: true, hasEnabledSources: true, hasProject: true });
      for (const dropped of ['browser_tool', 'create_page', 'spawn_session', 'get_session_info', 'list_sessions', 'call_llm', 'decide', 'transform_data', 'update_user_preferences']) {
        expect(coding).not.toContain(dropped);
      }
      expect(coding.every(name => name in CODING_PROFILE_TOOLS)).toBe(true);
    });

    it('lists only tools that exist in the registry', () => {
      const registered = new Set(SESSION_TOOL_DEFS.map(d => d.name));
      expect(Object.keys(CODING_PROFILE_TOOLS).filter(name => !registered.has(name))).toEqual([]);
    });

    it('applies the same filter to the JSON Schema view (Pi)', () => {
      const pi = getToolDefsAsJsonSchema({ prefix: 'mcp__session__', profile: 'coding' }).map(d => d.name);
      expect(pi).toEqual(['mcp__session__SubmitPlan', 'mcp__session__send_developer_feedback', 'mcp__session__set_session_labels', 'mcp__session__set_session_status', 'mcp__session__pr_status', 'mcp__session__pr_bind', 'mcp__session__pr_unbind', 'mcp__session__pr_set_auto_merge', 'mcp__session__list_background_tasks']);
    });
  });

  it('hides browser_tool when includeBrowser is false', () => {
    expect(getSessionToolDefs().some(d => d.name === 'browser_tool')).toBe(true);
    expect(getSessionToolDefs({ includeBrowser: false }).some(d => d.name === 'browser_tool')).toBe(false);
  });
});
