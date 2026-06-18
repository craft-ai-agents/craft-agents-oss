import { describe, it, expect } from 'bun:test';
import { SESSION_BACKEND_TOOL_NAMES } from '@craft-agent/session-tools-core';
import { CLAUDE_BACKEND_SESSION_TOOL_NAMES } from '../../session-scoped-tools.ts';

describe('Claude backend session tool parity', () => {
  it('implements all backend-mode session tools from core registry', () => {
    const missing = [...SESSION_BACKEND_TOOL_NAMES].filter(
      (toolName) => !CLAUDE_BACKEND_SESSION_TOOL_NAMES.has(toolName),
    );

    expect(missing).toEqual([]);
  });
});
