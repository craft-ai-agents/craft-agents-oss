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
// ============================================

/**
 * Primary commands with descriptions.
 * Order determines tab completion priority (first match wins).
 * Heavier commands (agent, workspace, model) are prioritized.
 */
export const COMMANDS: [string, string][] = [
  // Heavy/common commands first
  ['/agent', 'Manage sub-agents (list, create, clear, info)'],
  ['/workspace', 'Switch workspace (add, rename, remove)'],
  ['/model', 'Show or change the Claude model'],
  // Standard commands
  ['/help', 'Show help and available commands'],
  ['/clear', 'Clear conversation history'],
  ['/tools', 'List available Craft MCP tools'],
  ['/config', 'Show current configuration'],
  ['/cost', 'Show token usage and estimated cost'],
  ['/compact', 'Toggle compact mode for tool output'],
  // Feature toggles
  ['/web', 'Toggle web search capability'],
  ['/fetch', 'Toggle web fetch capability'],
  ['/bash', 'Toggle bash/shell execution'],
  // File operations
  ['/paste', 'Paste files/images from clipboard'],
  // Settings
  ['/prefs', 'Show user preferences'],
  ['/setup', 'Reconfigure API keys and MCP settings'],
  ['/apikey', 'Change Anthropic API key'],
  // Debug/exit
  ['/debug', 'Show conversation file path'],
  ['/exit', 'Exit the application'],
];

/** Command lookup map for descriptions */
export const COMMAND_MAP: Record<string, string> = Object.fromEntries(COMMANDS);

/** Ordered list of primary commands (for filtering/completion) */
export const PRIMARY_COMMANDS: string[] = COMMANDS.map(([cmd]) => cmd);

/** Aliases that map to primary commands (exact match only, no partial matching) */
export const COMMAND_ALIASES: Record<string, string> = {
  '/?': '/help',
  '/q': '/exit',
  '/quit': '/exit',
  '/image': '/paste',
  '/preferences': '/prefs',
  '/websearch': '/web',
  '/webfetch': '/fetch',
  '/w': '/workspace',
};

export const SUBCOMMANDS: Record<string, Record<string, string>> = {
  '/workspace': {
    'add': 'Add a new workspace',
    'rename': 'Rename current workspace',
    'remove': 'Remove a workspace',
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
 * Filter agents by prefix for hint display and resolution
 * Includes special entries: 'main' (return to main assistant) and 'agent' (open agent menu)
 */
export function filterAgents(query: string, agents: string[]): FilterMatch<string> {
  const allAgents = ['main', 'agent', ...agents];
  return filterByPrefix(allAgents, query, a => a);
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
      others: ['/agent', '/workspace', '/model', '/help', '/clear', '/tools', '/web', '/cost', '/exit'],
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
        : 'Activate sub-agent';
    return {
      selected: `@${first}`,
      description,
      others: match.matches.slice(1).slice(0, 3).map(a => `@${a}`),
    };
  }

  return { selected: null, description: null, others: [] };
}
