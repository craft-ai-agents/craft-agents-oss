import { describe, it, expect } from 'bun:test';
import {
  SESSION_TOOL_DEFS,
  getSessionToolDefs,
  getSessionToolNames,
  getSessionToolRegistry,
  getSessionSafeAllowedToolNames,
  getSessionSafeBlockedToolNames,
  getToolDefsAsJsonSchema,
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
});

/**
 * A disabled feature must not be VISIBLE to the model, not merely inert.
 *
 * The runtime already refuses to start with the flag off, so no listener binds
 * and no catalog exists. But the tool being callable anyway is worse than
 * either extreme: `craft_page` succeeds, writes files, and returns a fence —
 * while catalog registration is skipped, because the handler degrades
 * gracefully by design. The model then tells the user their page is ready and
 * the preview resolves to nothing.
 */
describe('craft_page visibility follows the feature flag', () => {
  const PAGE_TOOLS = ['craft_page', 'craft_page_delete'];

  it('hides both page tools when craft pages are disabled', () => {
    const names = getSessionToolDefs({ includeCraftPages: false }).map(d => d.name);
    for (const t of PAGE_TOOLS) expect(names).not.toContain(t);
  });

  it('exposes both page tools when enabled', () => {
    const names = getSessionToolDefs({ includeCraftPages: true }).map(d => d.name);
    for (const t of PAGE_TOOLS) expect(names).toContain(t);
  });

  it('hides the DESTRUCTIVE one too, not just the authoring one', () => {
    // craft_page_delete is a separate tool precisely so it can carry
    // safeMode 'block'. Leaving it exposed while hiding the other would keep
    // the one tool that can destroy work.
    const names = getSessionToolDefs({ includeCraftPages: false }).map(d => d.name);
    expect(names).not.toContain('craft_page_delete');
  });

  it('keeps the name set, registry and JSON schema aligned when hidden', () => {
    // Three surfaces derive from the same list. If any one of them forgets the
    // filter, a backend still advertises a tool the others do not implement.
    const opts = { includeCraftPages: false };
    const names = getSessionToolNames(opts);
    const registry = getSessionToolRegistry(opts);
    const schema = getToolDefsAsJsonSchema(opts);

    for (const t of PAGE_TOOLS) {
      expect(names).not.toContain(t);
      expect(Object.keys(registry)).not.toContain(t);
      expect(schema.map((s: { name: string }) => s.name)).not.toContain(t);
    }
  });

  it('leaves every other tool alone', () => {
    const on = getSessionToolDefs({ includeCraftPages: true }).map(d => d.name);
    const off = getSessionToolDefs({ includeCraftPages: false }).map(d => d.name);
    expect(on.filter(n => !PAGE_TOOLS.includes(n))).toEqual(off);
  });

  it('defaults to hidden, so a caller that forgets the option ships it disabled', () => {
    // The feature is off by default. A default of "visible" would mean every
    // backend that has not been updated leaks the tool.
    const names = getSessionToolDefs().map(d => d.name);
    for (const t of PAGE_TOOLS) expect(names).not.toContain(t);
  });
});
