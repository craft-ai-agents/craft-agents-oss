export interface ToolStatusInfo {
  message: string;
}

// Claude Code-style status messages for tools
const TOOL_STATUS: Record<string, ToolStatusInfo> = {
  // SDK built-in tools
  WebSearch: { message: 'Searching the web' },
  WebFetch: { message: 'Fetching webpage' },
  Bash: { message: 'Running command' },
  TaskOutput: { message: 'Reading output' },
  Read: { message: 'Reading file' },
  Edit: { message: 'Editing file' },
  Write: { message: 'Writing file' },
  Grep: { message: 'Searching code' },
  Glob: { message: 'Finding files' },
  MultiEdit: { message: 'Editing files' },
  NotebookEdit: { message: 'Editing notebook' },
  // Preferences
  update_user_preferences: { message: 'Remembering that' },
  // Docs server tools
  SearchCraftAgents: { message: 'Searching documentation' },
};

/**
 * Get a user-friendly status message for a tool (Claude Code style)
 */
export function getToolStatusMessage(toolName: string): string {
  // Check known tools first
  const known = TOOL_STATUS[toolName];
  if (known) {
    return `${known.message}...`;
  }

  // Handle MCP tools - extract the actual tool name
  // Format: mcp__servername__toolname or craft__toolname
  if (toolName.includes('__')) {
    const parts = toolName.split('__');
    const actualToolName = parts[parts.length - 1] || toolName;
    return getToolStatusMessage(actualToolName); // Recursive lookup
  }

  // Format tool name for display
  const formattedName = formatToolName(toolName);

  // Use action-oriented messages based on common patterns
  const lowerName = toolName.toLowerCase();
  if (lowerName.includes('search')) return 'Searching...';
  if (lowerName.includes('get') || lowerName.includes('fetch') || lowerName.includes('read')) return `Reading ${formattedName}...`;
  if (lowerName.includes('create') || lowerName.includes('add')) return `Creating ${formattedName}...`;
  if (lowerName.includes('update') || lowerName.includes('edit')) return `Updating ${formattedName}...`;
  if (lowerName.includes('delete') || lowerName.includes('remove')) return `Removing ${formattedName}...`;
  if (lowerName.includes('list')) return `Listing ${formattedName}...`;

  // Default fallback
  return `${formattedName}...`;
}

/**
 * Format a tool name to be more human-readable
 */
function formatToolName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
