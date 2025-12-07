export interface ToolInfo {
  name: string;
  description: string;
  category: 'read' | 'write' | 'organize' | 'destructive';
}

export const CRAFT_TOOLS: ToolInfo[] = [
  // Read-only tools
  {
    name: 'blocks_get',
    description: 'Fetch blocks from documents with hierarchical content',
    category: 'read',
  },
  {
    name: 'document_search',
    description: 'Search content within a single document',
    category: 'read',
  },
  {
    name: 'dailyNotes_search',
    description: 'Search content across all daily notes',
    category: 'read',
  },
  {
    name: 'documents_search',
    description: 'Search across multiple documents (multi-doc mode)',
    category: 'read',
  },
  {
    name: 'collections_list',
    description: 'List all collections with their schemas',
    category: 'read',
  },
  {
    name: 'collectionSchema_get',
    description: 'Get JSON schema for a collection',
    category: 'read',
  },
  {
    name: 'collectionItems_get',
    description: 'Get all items from a collection',
    category: 'read',
  },
  {
    name: 'tasks_get',
    description: 'Query tasks with scope filtering',
    category: 'read',
  },
  {
    name: 'documents_list',
    description: 'List all documents (multi-doc mode)',
    category: 'read',
  },
  {
    name: 'connection_time_get',
    description: 'Get current time and timezone for the connection',
    category: 'read',
  },

  // Write tools (mutating)
  {
    name: 'blocks_add',
    description: 'Insert new blocks at a specified position',
    category: 'write',
  },
  {
    name: 'blocks_update',
    description: 'Update existing block content',
    category: 'write',
  },
  {
    name: 'markdown_add',
    description: 'Insert blocks via markdown input',
    category: 'write',
  },
  {
    name: 'collections_create',
    description: 'Create a new collection with schema',
    category: 'write',
  },
  {
    name: 'collectionSchema_update',
    description: 'Update a collection schema',
    category: 'write',
  },
  {
    name: 'collectionItems_add',
    description: 'Add new items to a collection',
    category: 'write',
  },
  {
    name: 'collectionItems_update',
    description: 'Update items in a collection',
    category: 'write',
  },
  {
    name: 'tasks_add',
    description: 'Create new tasks',
    category: 'write',
  },
  {
    name: 'tasks_update',
    description: 'Update task content and status',
    category: 'write',
  },
  {
    name: 'uploadLink_generate',
    description: 'Generate pre-signed URL for file upload',
    category: 'write',
  },

  // Organize tools
  {
    name: 'blocks_move',
    description: 'Move blocks to a different position',
    category: 'organize',
  },

  // Destructive tools
  {
    name: 'blocks_delete',
    description: 'Delete blocks from documents',
    category: 'destructive',
  },
  {
    name: 'collectionItems_delete',
    description: 'Delete items from a collection',
    category: 'destructive',
  },
  {
    name: 'tasks_delete',
    description: 'Delete tasks',
    category: 'destructive',
  },
];

export function getToolsByCategory(category: ToolInfo['category']): ToolInfo[] {
  return CRAFT_TOOLS.filter(tool => tool.category === category);
}

export function formatToolsHelp(): string {
  const categories = ['read', 'write', 'organize', 'destructive'] as const;
  const categoryLabels = {
    read: 'Read-only',
    write: 'Write',
    organize: 'Organize',
    destructive: 'Destructive',
  };

  let output = 'Available Craft MCP Tools:\n\n';

  for (const category of categories) {
    const tools = getToolsByCategory(category);
    output += `${categoryLabels[category]}:\n`;
    for (const tool of tools) {
      output += `  - ${tool.name}: ${tool.description}\n`;
    }
    output += '\n';
  }

  return output;
}
