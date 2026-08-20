/**
 * Tests for the P3 knowledge mutation-pipeline permission gate
 * (packages/shared/src/agent/knowledge-permissions.ts).
 *
 * Covers spec 05 §3.6 mode matrix and the gate #7 / §4 invariant:
 * no mode bypasses the proposal pipeline and this module exposes no
 * auto-approve or direct-write API.
 */
import { describe, it, expect } from 'bun:test';
import { isErrorCode } from '../../protocol/types.ts';
import * as moduleSurface from '../knowledge-permissions.ts';
import defaultAssert, {
  assertKnowledgeActionAllowed,
  KNOWLEDGE_PERMISSION_DENIED_CODE,
  type KnowledgeAction,
  type KnowledgeActionContext,
} from '../knowledge-permissions.ts';

const ALL_ACTIONS: readonly KnowledgeAction[] = [
  'knowledge.propose',
  'knowledge.approve',
  'knowledge.apply',
];

/**
 * Assert the gate throws a typed denial. Follows the repo's wire convention:
 * branch on `err.code` (transport reconstructs plain errors), plus same-process
 * sanity checks on the error class and the knowledge-specific reason text.
 */
function expectDenied(action: KnowledgeAction, ctx?: KnowledgeActionContext): void {
  let thrown: unknown;
  try {
    assertKnowledgeActionAllowed(action, ctx);
  } catch (err) {
    thrown = err;
  }
  if (thrown === undefined) {
    throw new Error(`expected '${action}' to be denied, but the gate returned`);
  }
  if (!(thrown instanceof Error)) {
    throw new Error(`gate threw a non-Error: ${String(thrown)}`);
  }
  expect(thrown.name).toBe('CodedError');
  expect(thrown.message).toContain(action);
  expect(thrown.message).toContain('permission mode');
  const code = 'code' in thrown ? thrown.code : undefined;
  expect(code).toBe(KNOWLEDGE_PERMISSION_DENIED_CODE);
}

describe('assertKnowledgeActionAllowed — spec 05 §3.6 mode matrix', () => {
  describe('safe (Explore) mode: proposal pipeline denied, fail-closed', () => {
    for (const action of ALL_ACTIONS) {
      it(`denies ${action} with a typed CodedError`, () => {
        expectDenied(action, { mode: 'safe' });
      });
    }

    it('denies with workspaceId set (workspace scope is not a bypass)', () => {
      for (const action of ALL_ACTIONS) {
        expectDenied(action, { mode: 'safe', workspaceId: 'ws-1' });
      }
    });

    it('omitted mode behaves as safe (fail-closed default)', () => {
      for (const action of ALL_ACTIONS) {
        expectDenied(action, undefined);
        expectDenied(action, {});
        expectDenied(action, { workspaceId: 'ws-1' });
      }
    });
  });

  describe('ask (Ask to Edit) mode: mode gate passes; human clicks enforced by state machine', () => {
    for (const action of ALL_ACTIONS) {
      it(`allows ${action}`, () => {
        expect(() =>
          assertKnowledgeActionAllowed(action, { mode: 'ask', workspaceId: 'ws-1' }),
        ).not.toThrow();
      });
    }
  });

  describe('allow-all (Auto) mode: same pipeline as ask — NEVER auto-approved', () => {
    for (const action of ALL_ACTIONS) {
      it(`allows ${action} through the mode gate only`, () => {
        expect(() =>
          assertKnowledgeActionAllowed(action, { mode: 'allow-all', workspaceId: 'ws-1' }),
        ).not.toThrow();
      });
    }
  });
});

describe('module surface invariants (gate #7, spec 05 §4 + §6.5)', () => {
  it('exposes exactly the gate surface and nothing resembling auto-approve', () => {
    const exportNames = Object.keys(moduleSurface);
    for (const name of exportNames) {
      // No auto-approve, no direct write, no bypass surface — spec 05 §4
      expect(name).not.toMatch(/auto.?approv/i);
      expect(name).not.toMatch(/direct.?write/i);
      expect(name).not.toMatch(/bypass/i);
    }
    expect(exportNames).toContain('assertKnowledgeActionAllowed');
    expect(exportNames).toContain('KNOWLEDGE_PERMISSION_DENIED_CODE');
    expect(typeof assertKnowledgeActionAllowed).toBe('function');
  });

  it('default export is the same single gate function (bridge-service DI default)', () => {
    expect(defaultAssert).toBe(assertKnowledgeActionAllowed);
  });

  it('denial code is a valid protocol ErrorCode member', () => {
    expect(isErrorCode(KNOWLEDGE_PERMISSION_DENIED_CODE)).toBe(true);
  });
});
