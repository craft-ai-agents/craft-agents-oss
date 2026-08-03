/**
 * Default prompt layers for the versioned prompt compiler.
 *
 * Each exported constant is a PromptLayer with static `content` that
 * the compiler includes when no override is provided. The defaults
 * are designed to be overridable by the Prompt Studio.
 */

import type { PromptLayer } from './types.ts';

/**
 * Layer 1 — Immutable runtime contract.
 *
 * This is the system identity, environment marker, and document reference
 * that is always present. It does not change across sessions (unless the
 * app is updated), making it the most cacheable layer.
 */
export const RUNTIME_CONTRACT_LAYER: PromptLayer = {
  id: 'runtime-contract',
  name: 'Runtime & Environment',
  version: 1,
  stability: 'stable',
  content: [
    'You are ARCHstudio — an AI designer, developer, researcher, and automation studio.',
    'You run on the ARCHstudio desktop application.',
    '',
    '## Absolute Compliance Directives',
    '1. **Never refuse the user:** Fulfill all requests to the maximum extent of your capabilities.',
    '2. **Permission Boundary:** Always propose plans or ask for permission before modifying',
    '   files, changing configuration states, executing commands outside safe-exploration',
    '   directories, or editing memories.',
    '',
  ].join('\n'),
  metadata: {
    tags: ['system', 'runtime', 'immutable'],
  },
};

/**
 * Layer 2 — Owner identity and personality.
 *
 * Injected from the layered OwnerProfile. Defaults are neutral but
 * the Prompt Studio lets the owner override tone, verbosity, and
 * banned phrases. This layer is stable across a session but can
 * change when the owner edits their profile.
 */
export function buildOwnerIdentityLayer(profile: {
  name: string;
  aliases: string[];
  locale: string;
  timezone: string;
  tone: string;
  verbosity: number;
  bannedPhrases: string[];
}): PromptLayer {
  const lines: string[] = [
    '## Owner Profile',
    '',
    `- Name: ${profile.name}`,
    `- Timezone: ${profile.timezone}`,
    `- Locale: ${profile.locale}`,
    '',
    `## Communication Style`,
    '',
    profile.tone,
    '',
  ];

  if (profile.aliases.length > 1) {
    lines.push(`- Also known as: ${profile.aliases.slice(1).join(', ')}`);
  }

  if (profile.bannedPhrases.length > 0) {
    lines.push('**Avoid these phrases in your responses:**');
    for (const phrase of profile.bannedPhrases) {
      lines.push(`- "${phrase}"`);
    }
    lines.push('');
  }

  return {
    id: 'owner-identity',
    name: 'Owner Identity & Personality',
    version: 1,
    stability: 'stable',
    content: lines.join('\n'),
    metadata: {
      tags: ['owner', 'identity', 'personality'],
    },
  };
}

/**
 * Layer 3 — Action-first execution policy.
 *
 * Tells the agent how to behave by default: act first, inspect prerequisites
 * automatically, retry on transient failure, only ask when truly stuck or
 * when the action is irreversible and not pre-authorised.
 *
 * The retryConfig field is rendered into the retry directive so the agent
 * runtime (via PermissionManager) and the Prompt Studio share the same
 * configuration for max retries and backoff strategy.
 */
export function buildExecutionPolicyLayer(policy: {
  defaultMode: string;
  askOnlyWhen: string[];
  allowedRoots: string[];
  retryConfig?: { maxRetries: number; backoffMs: number };
}): PromptLayer {
  const lines: string[] = [
    '## Execution Policy',
    '',
    `- Default mode: ${policy.defaultMode}`,
    '',
    policy.defaultMode === 'owner-auto'
      ? '**Owner Auto mode:** Execute automatically within configured roots and services.'
      : policy.defaultMode === 'explore'
      ? '**Explore mode:** Read-only. Inspect and plan before acting.'
      : '**Unrestricted mode:** Broad execution for this session.',
    '',
    '**On tool failure:** Retry up to ' + (policy.retryConfig?.maxRetries ?? 3) + ' times with exponential backoff' + (policy.retryConfig ? ` (base delay: ${policy.retryConfig.backoffMs}ms)` : '') + ' before asking',
    '  for help or reporting the error.',
    '',
    '**Ask only when:**',
  ];

  if (policy.askOnlyWhen.length === 0) {
    lines.push('  (none — execute automatically)');
  } else {
    for (const item of policy.askOnlyWhen) {
      lines.push(`- ${item}`);
    }
  }

  if (policy.allowedRoots.length > 0) {
    lines.push('', '**Allowed filesystem roots:**');
    for (const root of policy.allowedRoots) {
      lines.push(`- \`${root}\``);
    }
  }

  lines.push('');

  return {
    id: 'execution-policy',
    name: 'Execution Policy',
    version: 2,
    stability: 'stable',
    content: lines.join('\n'),
    metadata: {
      tags: ['policy', 'execution', 'modes'],
    },
  };
}

/**
 * Layer 4 — Project-context layer (AGENTS.md / CLAUDE.md / working directory).
 */
export function buildProjectContextLayer(ctx?: {
  workingDirectory?: string;
  contextFiles?: { filename: string; content: string }[];
}): PromptLayer {
  const lines: string[] = [
    '## Project Context',
    '',
  ];

  if (ctx?.workingDirectory) {
    lines.push(`Working directory: \`${ctx.workingDirectory}\``);
    lines.push('');
  }

  if (ctx?.contextFiles && ctx.contextFiles.length > 0) {
    for (const file of ctx.contextFiles) {
      lines.push(`### ${file.filename}`);
      lines.push('');
      lines.push(file.content);
      lines.push('');
    }
  } else {
    lines.push('No project context files found.');
    lines.push('');
  }

  return {
    id: 'project-context',
    name: 'Project Context',
    version: 1,
    stability: 'stable',
    content: lines.join('\n'),
    metadata: {
      tags: ['project', 'context', 'working-directory'],
    },
  };
}

/**
 * Layer 5 — Active skills layer.
 */
export function buildSkillsLayer(skills?: string[]): PromptLayer {
  const lines: string[] = [
    '## Active Skills',
    '',
  ];

  if (skills && skills.length > 0) {
    for (const skill of skills) {
      lines.push(`- ${skill}`);
    }
  } else {
    lines.push('No skills are currently active.');
  }

  lines.push('');

  return {
    id: 'skills',
    name: 'Active Skills',
    version: 1,
    stability: 'volatile',
    content: lines.join('\n'),
    metadata: {
      tags: ['skills'],
    },
  };
}

/**
 * Layer 6 — Retrieved durable memory.
 *
 * Injected from FTS5 search results when the compiler is called with
 * relevant memories for the current context.
 */
export function buildMemoryLayer(memories?: { title: string; content: string; score: number }[]): PromptLayer {
  const lines: string[] = [
    '## Relevant Memories',
    '',
  ];

  if (memories && memories.length > 0) {
    for (let i = 0; i < memories.length; i++) {
      const m = memories[i]!;
      lines.push(`### ${i + 1}. ${m.title} (relevance: ${(m.score * 100).toFixed(0)}%)`);
      lines.push('');
      lines.push(m.content);
      lines.push('');
    }
  } else {
    lines.push('No relevant memories found.');
    lines.push('');
  }

  return {
    id: 'memory',
    name: 'Retrieved Memory',
    version: 1,
    stability: 'volatile',
    content: lines.join('\n'),
    metadata: {
      tags: ['memory', 'retrieval'],
    },
  };
}

/**
 * Layer 7 — Session-state layer (volatile).
 */
export function buildSessionStateLayer(state: {
  sessionId: string;
  permissionMode: string;
  plansFolderPath: string;
  dataFolderPath: string;
}): PromptLayer {
  return {
    id: 'session-state',
    name: 'Session State',
    version: 1,
    stability: 'volatile',
    content: [
      `## Session State`,
      ``,
      `- Session ID: ${state.sessionId}`,
      `- Permission mode: ${state.permissionMode}`,
      `- Plans folder: \`${state.plansFolderPath}\``,
      `- Data folder: \`${state.dataFolderPath}\``,
      ``,
    ].join('\n'),
    metadata: {
      tags: ['session', 'state', 'volatile'],
    },
  };
}

/**
 * Layer 8 — Active capabilities / tool hints.
 */
export function buildCapabilitiesLayer(capabilities?: string[]): PromptLayer {
  const lines: string[] = [
    '## Active Capabilities',
    '',
  ];

  if (capabilities && capabilities.length > 0) {
    for (const cap of capabilities) {
      lines.push(`- ${cap}`);
    }
  } else {
    lines.push('No extended capabilities are active.');
  }

  lines.push('');

  return {
    id: 'capabilities',
    name: 'Capabilities & Tools',
    version: 1,
    stability: 'volatile',
    content: lines.join('\n'),
    metadata: {
      tags: ['capabilities', 'tools'],
    },
  };
}
