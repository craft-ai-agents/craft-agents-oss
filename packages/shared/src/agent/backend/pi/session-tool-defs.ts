/**
 * Pi Session Tool Proxy Definitions
 *
 * Thin wrapper around the canonical tool definitions in @craft-agent/session-tools-core.
 * Adds the `mcp__session__` prefix that the Pi SDK expects.
 */

import {
  getToolDefsAsJsonSchema,
  SESSION_TOOL_NAMES,
  type JsonSchemaToolDef,
} from '@craft-agent/session-tools-core';
import { FEATURE_FLAGS } from '../../../feature-flags.ts';
import { isDecisionFeatureActive } from '../../../decisions/resolve.ts';
import { getBrowserToolEnabled } from '../../../config/storage.ts';
import type { SessionToolProfileOptions } from '../../session-scoped-tools.ts';

export type SessionToolProxyDef = JsonSchemaToolDef;

export { SESSION_TOOL_NAMES };

export function getSessionToolProxyDefs(profileOptions?: SessionToolProfileOptions): SessionToolProxyDef[] {
  return getToolDefsAsJsonSchema({
    prefix: 'mcp__session__',
    includeDeveloperFeedback: FEATURE_FLAGS.developerFeedback,
    // Same gates as the Claude path (session-scoped-tools.ts): advertise `decide`
    // only while the decision layer is on, `browser_tool` only while the built-in
    // browser is enabled.
    includeDecide: isDecisionFeatureActive('decideTool'),
    includeBrowser: getBrowserToolEnabled(),
    ...profileOptions,
  });
}
