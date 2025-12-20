/**
 * Centralized filtering utilities for menus and auto-completion.
 * Used by both hint display (Input.tsx) and command resolution (App.tsx).
 */

export interface FilterMatch<T> {
  matches: T[];
  singleMatch: T | null;
  query: string;
}

/**
 * Generic prefix filter function
 */
export function filterByPrefix<T>(
  items: T[],
  query: string,
  getKey: (item: T) => string
): FilterMatch<T> {
  const lowerQuery = query.toLowerCase();
  const matches = items.filter(item =>
    getKey(item).toLowerCase().startsWith(lowerQuery)
  );

  return {
    matches,
    singleMatch: matches.length === 1 ? matches[0]! : null,
    query,
  };
}

// ============================================
// Command definitions (single source of truth)
// Order matters for tab completion - heavier/common commands first
// Used by both filtering/autocomplete AND HelpPanel
// ============================================

export type CommandCategory =
  | 'General'
  | 'Planning Mode'
  | 'AI & Billing'
  | 'Configuration'
  | 'Space'
  | 'Sub-Agents'
  | 'Attaching Files'
  | 'Troubleshooting';

export interface CommandDefinition {
  command: string;
  description: string;
  category: CommandCategory;
}

/**
 * Primary commands with descriptions and categories.
 * Order determines tab completion priority (first match wins).
 * Heavier commands (agent, workspace, model) are prioritized.
 */
export const COMMANDS: CommandDefinition[] = [
  // Heavy/common commands first (for tab completion priority)
  { command: '/agent', description: 'Manage sub-agents (list, info, refresh, clear)', category: 'Sub-Agents' },
  { command: '/plan', description: 'Enter planning mode for complex tasks', category: 'Planning Mode' },
  { command: '/workspace', description: 'Switch Craft space (add, rename, remove)', category: 'Space' },
  { command: '/model', description: 'Show or change model (e.g., /model opus)', category: 'AI & Billing' },

  // General
  { command: '/help', description: 'Show help and available commands', category: 'General' },
  { command: '/clear', description: 'Clear conversation history', category: 'General' },
  { command: '/new', description: 'Start a new session', category: 'General' },
  { command: '/resume', description: 'View and resume previous sessions', category: 'General' },
  { command: '/exit', description: 'Exit the application (or Ctrl+C)', category: 'General' },

  // AI & Billing
  { command: '/credits', description: 'View billing method and manage credits', category: 'AI & Billing' },
  { command: '/tools', description: 'List available tools (-v for details)', category: 'AI & Billing' },

  // Configuration
  { command: '/settings', description: 'Open settings menu', category: 'Configuration' },
  { command: '/prefs', description: 'Your personalisation (name, timezone, etc.)', category: 'Configuration' },
  { command: '/logout', description: 'Clear all settings and credentials', category: 'Configuration' },

  // Attaching Files
  { command: '/paste', description: 'Paste files/images from clipboard', category: 'Attaching Files' },

  // Troubleshooting
  { command: '/debug', description: 'Show debug info and file paths', category: 'Troubleshooting' },
  { command: '/feedback', description: 'Send feedback email with session transcript', category: 'Troubleshooting' },
];

/** Category display order for HelpPanel */
export const CATEGORY_ORDER: CommandCategory[] = [
  'General',
  'Planning Mode',
  'AI & Billing',
  'Configuration',
  'Space',
  'Sub-Agents',
  'Attaching Files',
  'Troubleshooting',
];

/** Get commands grouped by category (for HelpPanel) */
export function getCommandsByCategory(): Map<CommandCategory, CommandDefinition[]> {
  const map = new Map<CommandCategory, CommandDefinition[]>();
  for (const cmd of COMMANDS) {
    const existing = map.get(cmd.category) || [];
    existing.push(cmd);
    map.set(cmd.category, existing);
  }
  return map;
}

/** Command lookup map for descriptions (derived) */
export const COMMAND_MAP: Record<string, string> = Object.fromEntries(
  COMMANDS.map(c => [c.command, c.description])
);

/** Ordered list of primary commands for filtering/completion (derived) */
export const PRIMARY_COMMANDS: string[] = COMMANDS.map(c => c.command);

/** Aliases that map to primary commands (exact match only, no partial matching) */
export const COMMAND_ALIASES: Record<string, string> = {
  '/?': '/help',
  '/q': '/exit',
  '/quit': '/exit',
  '/image': '/paste',
  '/preferences': '/prefs',
  '/w': '/workspace',
};

export const SUBCOMMANDS: Record<string, Record<string, string>> = {
  '/workspace': {
    'add': 'Add a new Craft space',
    'rename': 'Rename current space',
    'remove': 'Remove a Craft space',
  },
  '/agent': {
    'list': 'List available sub-agents',
    'create': 'Create a new sub-agent',
    'clear': 'Return to main assistant',
    'reload': 'Reload agent instructions',
    'reset': 'Clear all data and exit (re-select to restart setup)',
    'refresh': 'Re-scan Agents folder',
    'info': 'Show active agent details',
  },
  '/plan': {
    'start': 'Start planning a complex task',
    'plans': 'View, load, or delete saved plans',
    'view': 'View current plan',
    'cancel': 'Cancel current plan',
  },
};

// ============================================
// Command filtering
// ============================================

/**
 * Filter commands by prefix for hint display
 */
export function filterCommands(input: string): FilterMatch<string> {
  const cmd = input.toLowerCase().trim();
  return filterByPrefix(PRIMARY_COMMANDS, cmd, c => c);
}

/**
 * Filter subcommands by prefix
 */
export function filterSubcommands(
  baseCmd: string,
  subInput: string,
  subcommands?: Record<string, string>
): FilterMatch<string> {
  const subs = subcommands ?? SUBCOMMANDS[baseCmd];
  if (!subs) {
    return { matches: [], singleMatch: null, query: subInput };
  }

  const subNames = Object.keys(subs);
  return filterByPrefix(subNames, subInput, s => s);
}

/**
 * Resolve a partial command input to a full command.
 * Resolves to the first match if there are multiple matches.
 */
export function resolveCommand(input: string): string {
  const parts = input.toLowerCase().trim().split(/\s+/);
  let command = parts[0] ?? '';

  // Check if it's an alias (exact match required) - resolve to primary command
  const aliasTarget = COMMAND_ALIASES[command];
  if (aliasTarget) {
    parts[0] = aliasTarget;
    return parts.join(' ');
  }

  // Check if it's already a primary command
  if (PRIMARY_COMMANDS.includes(command)) {
    // Check for subcommand resolution
    const subInput = parts[1];
    if (subInput && SUBCOMMANDS[command]) {
      const subMatch = filterSubcommands(command, subInput);
      // Resolve to first match
      if (subMatch.matches.length > 0) {
        parts[1] = subMatch.matches[0]!;
        return parts.join(' ');
      }
    }
    return input;
  }

  // Try partial matching on primary commands - resolve to first match
  const match = filterByPrefix(PRIMARY_COMMANDS, command, c => c);
  if (match.matches.length > 0) {
    const firstMatch = match.matches[0]!;
    parts[0] = firstMatch;

    // Also resolve subcommands if present
    const subInput = parts[1];
    if (subInput && SUBCOMMANDS[firstMatch]) {
      const subMatch = filterSubcommands(firstMatch, subInput);
      if (subMatch.matches.length > 0) {
        parts[1] = subMatch.matches[0]!;
      }
    }

    return parts.join(' ');
  }

  return input;
}

// ============================================
// Agent filtering
// ============================================

/**
 * Filter agents for hint display and resolution
 * Prefers prefix matches, falls back to contains matches
 * Includes special entries: 'main' (return to main assistant) and 'agent' (open agent menu)
 */
export function filterAgents(query: string, agents: string[]): FilterMatch<string> {
  const allAgents = ['main', 'agent', ...agents];
  const lowerQuery = query.toLowerCase();

  // First: prefix matches
  const prefixMatches = allAgents.filter(a =>
    a.toLowerCase().startsWith(lowerQuery)
  );

  if (prefixMatches.length > 0) {
    return {
      matches: prefixMatches,
      singleMatch: prefixMatches.length === 1 ? prefixMatches[0]! : null,
      query,
    };
  }

  // Fallback: contains matches
  const containsMatches = allAgents.filter(a =>
    a.toLowerCase().includes(lowerQuery)
  );

  return {
    matches: containsMatches,
    singleMatch: containsMatches.length === 1 ? containsMatches[0]! : null,
    query,
  };
}

/**
 * Resolve a partial agent mention to a full agent name.
 * Returns the first matching agent name or null if no matches.
 */
export function resolveAgentMention(query: string, agents: string[]): string | null {
  if (!query) return null;

  const match = filterAgents(query, agents);
  return match.matches.length > 0 ? match.matches[0]! : null;
}

// ============================================
// Tab completion (for Input.tsx)
// ============================================

/**
 * Get tab completion for the current input.
 * Returns the completed string or null if no completion available.
 * Completes to the first match if there are multiple matches.
 */
export function getTabCompletion(input: string, agents: string[]): string | null {
  const trimmed = input.trim();

  // Handle @mention completion
  if (trimmed.startsWith('@')) {
    const query = trimmed.slice(1);
    const match = filterAgents(query, agents);
    // Complete to first match if any
    if (match.matches.length > 0) {
      const firstMatch = match.matches[0]!;
      return `@${firstMatch} `;
    }
    return null;
  }

  // Handle slash command completion
  if (trimmed.startsWith('/')) {
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0]?.toLowerCase() ?? '';

    // Check if we're completing a subcommand
    if (parts.length >= 2 && SUBCOMMANDS[cmd]) {
      const subInput = parts[1] ?? '';
      const subMatch = filterSubcommands(cmd, subInput);
      // Complete to first match if any
      if (subMatch.matches.length > 0) {
        return `${cmd} ${subMatch.matches[0]} `;
      }
      return null;
    }

    // Complete the main command - use first match if any
    const match = filterByPrefix(PRIMARY_COMMANDS, cmd, c => c);
    if (match.matches.length > 0) {
      const firstMatch = match.matches[0]!;
      return `${firstMatch} `;
    }
    return null;
  }

  return null;
}

// ============================================
// Hint data (for Input.tsx)
// ============================================

export interface HintData {
  /** The item that will be selected on Enter (first match) */
  selected: string | null;
  /** Description for the selected item */
  description: string | null;
  /** Other matching items (not selected) */
  others: string[];
}

/**
 * Get hint data for slash commands
 */
export function getCommandHint(input: string): HintData {
  const cmd = input.toLowerCase().trim();

  if (cmd === '/') {
    // Show overview, no selection
    return {
      selected: null,
      description: null,
      others: ['/agent', '/workspace', '/model', '/help', '/clear', '/tools', '/credits', '/exit'],
    };
  }

  // Check for subcommand matching (e.g., "/workspace r" -> "rename")
  const parts = cmd.split(/\s+/);
  if (parts.length >= 2 && parts[0]) {
    const baseCmd = parts[0];
    const subInput = parts[1] || '';
    const subs = SUBCOMMANDS[baseCmd];

    if (subs) {
      const subMatch = filterSubcommands(baseCmd, subInput, subs);

      if (subMatch.matches.length > 0) {
        const first = subMatch.matches[0]!;
        return {
          selected: `${baseCmd} ${first}`,
          description: subs[first] ?? null,
          others: subMatch.matches.slice(1).map(sub => `${baseCmd} ${sub}`),
        };
      }
    }
  }

  // Find matching commands
  const match = filterCommands(cmd);

  if (match.matches.length > 0) {
    const first = match.matches[0]!;
    return {
      selected: first,
      description: COMMAND_MAP[first] ?? null,
      others: match.matches.slice(1).slice(0, 3), // Show up to 3 others
    };
  }

  return { selected: null, description: null, others: [] };
}

/**
 * Get hint data for @mentions
 */
/**
 * Get description for a specific hint (command or agent mention)
 */
export function getHintDescription(hint: string): string | null {
  // Command hints
  if (hint.startsWith('/')) {
    return COMMAND_MAP[hint] ?? null;
  }
  // Agent hints
  if (hint.startsWith('@')) {
    const name = hint.slice(1);
    if (name === 'main') return 'Return to main assistant';
    if (name === 'agent') return 'Open agent menu';
    if (name.includes('/')) return `Activate ${name.split('/').pop()} agent`;
    return 'Activate sub-agent';
  }
  return null;
}

export function getAgentHint(query: string, agents: string[]): HintData {
  // Empty @ shows all options
  if (query === '') {
    const allAgents = ['main', 'agent', ...agents.slice(0, 2)];
    return {
      selected: null,
      description: null,
      others: allAgents.map(a => `@${a}`),
    };
  }

  const match = filterAgents(query, agents);

  if (match.matches.length > 0) {
    const first = match.matches[0]!;
    const description = first === 'main'
      ? 'Return to main assistant'
      : first === 'agent'
        ? 'Open agent menu'
        : first.includes('/')
          ? `Activate ${first.split('/').pop()} agent`
          : 'Activate sub-agent';
    return {
      selected: `@${first}`,
      description,
      others: match.matches.slice(1).slice(0, 3).map(a => `@${a}`),
    };
  }

  return { selected: null, description: null, others: [] };
}
