import { describe, expect, it } from 'bun:test';
import { shouldAllowToolInMode } from '../mode-manager.ts';

// Explore used to allow every tool it had no rule for, so tools Claude Code added with its releases
// ran there unchecked: EnterWorktree created git worktrees, CronCreate scheduled prompts. It now runs
// only the tools it knows to be read-only.
const explore = (toolName: string, input: Record<string, unknown> = {}) => shouldAllowToolInMode(toolName, input, 'safe');

describe('Explore tool allow-list', () => {
  it('allows the read-only tools of both backends', () => {
    const tools = [
      'Read', 'Glob', 'Grep', 'LSP', 'Find', 'Ls', 'WebFetch', 'WebSearch', 'ToolSearch',
      'ListMcpResourcesTool', 'ReadMcpResourceTool', 'ListAgents', 'TaskStop',
      'TodoWrite', 'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'CronList',
      'ReportFindings', 'StructuredOutput', 'SubmitPlan', 'mcp__session__SubmitPlan', 'browser_tool', 'mcp__session__browser_tool',
    ];
    for (const tool of tools) expect([tool, explore(tool)]).toEqual([tool, { allowed: true }]);
  });

  it('blocks a tool it does not know', () => {
    for (const tool of ['EnterWorktree', 'ExitWorktree', 'CronCreate', 'CronDelete', 'ScheduleWakeup', 'RemoteTrigger', 'SomeFutureTool']) {
      expect([tool, explore(tool)]).toEqual([tool, {
        allowed: false,
        reason: `${tool} is blocked in Explore. Switch to Ask or Allow All mode (SHIFT+TAB) to use this tool.`,
      }]);
    }
  });

  it('runs subagents, but not in another copy of the repository', () => {
    expect(explore('Agent', { prompt: 'Find the callers', subagent_type: 'Explore' })).toEqual({ allowed: true });
    expect(explore('Task', { prompt: 'Find the callers' })).toEqual({ allowed: true });
    for (const isolation of ['worktree', 'remote']) {
      const result = explore('Agent', { prompt: 'Fix it', isolation });
      expect(result.allowed).toBe(false);
      expect(!result.allowed && result.reason).toContain(`\`isolation: ${isolation}\` is blocked in Explore`);
    }
  });

  it('blocks SendMessage and Workflow, saying what to use instead', () => {
    const sendMessage = explore('SendMessage', { to: 'other-session', message: 'Run the migration' });
    expect(!sendMessage.allowed && sendMessage.reason).toContain('other Claude sessions on this machine');
    const workflow = explore('Workflow', { script: 'export const meta = {}' });
    expect(!workflow.allowed && workflow.reason).toContain('Use Agent instead');
  });

  it('checks a source tool named like an allowed tool as any other MCP tool', () => {
    for (const tool of ['mcp__tracker__Task', 'mcp__docs__WebFetch', 'mcp__chat__SendMessage', 'mcp__tracker__TaskCreate']) {
      expect([tool, explore(tool)]).toEqual([tool, {
        allowed: false,
        reason: 'MCP write operations are blocked in Explore. Switch to Ask or Allow All mode (SHIFT+TAB) to make changes.',
      }]);
    }
  });

  it('leaves the other modes as they were', () => {
    for (const mode of ['ask', 'allow-all'] as const) {
      expect(shouldAllowToolInMode('EnterWorktree', {}, mode)).toEqual({ allowed: true });
      expect(shouldAllowToolInMode('Agent', { prompt: 'Fix it', isolation: 'worktree' }, mode)).toEqual({ allowed: true });
    }
  });
});
