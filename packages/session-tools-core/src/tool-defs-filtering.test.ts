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
      const pages = ['list_pages', 'get_page', 'create_page', 'update_page', 'write_page_data', 'delete_page'];
      const prTools = ['pr_status', 'pr_bind', 'pr_unbind', 'pr_set_auto_merge'];
      expect(names({ profile: 'coding' })).toEqual([
        'SubmitPlan', 'mermaid_validate', 'source_test', 'transform_data', 'send_developer_feedback', 'call_llm', 'spawn_session',
        'browser_tool', ...pages, ...prTools, 'get_session_info', 'list_sessions', 'list_background_tasks',
      ]);
      expect(names({ profile: 'coding', includeDeveloperFeedback: false })).toEqual(names({ profile: 'coding' }).filter(name => name !== 'send_developer_feedback'));
    });

    it('keeps the browser behind its setting', () => {
      expect(names({ profile: 'coding', includeBrowser: false })).not.toContain('browser_tool');
      expect(names({ profile: 'coding', includeBrowser: false })).toContain('create_page');
    });

    it('adds the other source tools only with enabled sources, project memory only with a project', () => {
      const withSources = names({ profile: 'coding', hasEnabledSources: true });
      expect(withSources).toContain('source_oauth_trigger');
      expect(withSources).toContain('source_list_resources');
      expect(withSources).not.toContain('project_memory_append');

      const withProject = names({ profile: 'coding', hasProject: true });
      expect(withProject).toContain('project_memory_append');
      expect(withProject).not.toContain('source_oauth_trigger');
      // source_test loads a source enabled after the session's tools were fixed, so it can't wait for one
      expect(withProject).toContain('source_test');
    });

    it('drops desktop-workflow tools even when their own flags are on', () => {
      const coding = names({ profile: 'coding', includeDecide: true, includeBrowser: true, hasEnabledSources: true, hasProject: true });
      for (const dropped of ['set_session_labels', 'set_session_status', 'archive_session', 'create_task', 'send_agent_message', 'decide', 'update_user_preferences', 'render_template', 'script_sandbox', 'config_validate']) {
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
      expect(pi).toEqual(names({ profile: 'coding' }).map(name => `mcp__session__${name}`));
    });
  });

  it('hides browser_tool when includeBrowser is false', () => {
    expect(getSessionToolDefs().some(d => d.name === 'browser_tool')).toBe(true);
    expect(getSessionToolDefs({ includeBrowser: false }).some(d => d.name === 'browser_tool')).toBe(false);
  });
});
