/**
 * Slack Permission Directive Parser
 *
 * Parses permission directives from Slack message text.
 * Directives: /ask, /allow-all, /safe
 */

import type { SlackPermissionDirective } from './types';

const DIRECTIVE_PATTERN = /^\/?(ask|allow-all|allow|safe)\b\s*/i;

/**
 * Parse permission directive from message text
 *
 * @param text - Raw message text
 * @returns Parsed directive with mode and cleaned text
 */
export function parsePermissionDirective(text: string): SlackPermissionDirective {
  const trimmed = text.trim();
  const match = DIRECTIVE_PATTERN.exec(trimmed);

  if (!match) {
    return {
      mode: 'ask', // Default mode
      cleanedText: trimmed,
    };
  }

  const directive = match[1]?.toLowerCase() ?? 'ask';
  const cleanedText = trimmed.slice(match[0]?.length ?? 0).trim();

  let mode: SlackPermissionDirective['mode'];
  switch (directive) {
    case 'safe':
      mode = 'safe';
      break;
    case 'allow-all':
    case 'allow':
      mode = 'allow-all';
      break;
    case 'ask':
    default:
      mode = 'ask';
      break;
  }

  return { mode, cleanedText };
}

/**
 * Check if text starts with a permission directive
 */
export function hasPermissionDirective(text: string): boolean {
  return DIRECTIVE_PATTERN.test(text.trim());
}
