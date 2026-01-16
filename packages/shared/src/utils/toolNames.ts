/**
 * User-friendly display names for tools.
 *
 * Internal tool names are developer-facing and can be cryptic.
 * This mapping provides cleaner names for the UI.
 */

/**
 * Display names for specific tools that need custom names
 */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  // Documentation tools
  'SearchCraftAgents': 'Search Documentation',
};

/**
 * Tools that should be hidden from the UI (purely internal state changes)
 */
export const HIDDEN_TOOLS = new Set<string>([
  // Currently empty - safe mode is toggled via UI, not tools
]);

/**
 * Format tool name for display (snake_case to Title Case)
 * Generic fallback for tools without explicit mappings
 */
function formatToolName(name: string): string {
  // Handle MCP tools (mcp__server__tool)
  if (name.startsWith('mcp__')) {
    const parts = name.split('__');
    const tool = parts[2] || parts[1] || name;
    return tool.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Handle api_* tools
  if (name.startsWith('api_')) {
    const apiName = name.slice(4); // Remove 'api_' prefix
    return `API: ${apiName.charAt(0).toUpperCase() + apiName.slice(1)}`;
  }

  // Default: convert to title case
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Get user-friendly display name for a tool.
 *
 * @param toolName - The internal tool name (e.g., "mcp__linear__list_issues")
 * @returns User-friendly display name
 */
export function getToolDisplayName(toolName: string): string {
  // Check explicit mappings first (full name)
  if (TOOL_DISPLAY_NAMES[toolName]) {
    return TOOL_DISPLAY_NAMES[toolName];
  }

  // For MCP tools, also check mapping with just the base tool name
  // e.g., "mcp__linear__list_issues" -> check "list_issues"
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__');
    const baseName = parts[parts.length - 1] || toolName;
    if (baseName && TOOL_DISPLAY_NAMES[baseName]) {
      return TOOL_DISPLAY_NAMES[baseName];
    }
  }

  // Fallback to generic formatting
  return formatToolName(toolName);
}

/**
 * Check if a tool should be hidden from the UI
 */
export function shouldHideTool(toolName: string): boolean {
  // Check full name first
  if (HIDDEN_TOOLS.has(toolName)) {
    return true;
  }

  // For MCP tools, also check the base name
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__');
    const baseName = parts[parts.length - 1] || '';
    return HIDDEN_TOOLS.has(baseName);
  }

  return false;
}
