# Notion

Official Notion MCP server providing access to your Notion workspace through the hosted MCP endpoint.

## Scope

This source provides access to:
- **Pages**: Read, create, update, and search pages across your workspace
- **Databases**: Query, filter, and manage database entries
- **Blocks**: Access and modify page content blocks
- **Comments**: Read and create comments on pages
- **Search**: Full-text search across your workspace content

## Capabilities

### Reading Content
- Search for pages and databases by title or content
- Retrieve page content including all blocks and formatting
- Query databases with filters and sorting
- Read comments and discussions

### Writing Content
- Create new pages and subpages
- Update existing page content
- Add database entries with properties
- Create comments and mentions
- Append blocks to pages

### Data Sources (API v2025-09-03+)
Notion's latest API uses "data sources" as the primary abstraction for databases, making it easier to query and filter database content.

## Guidelines

### Best Practices
- **Search first**: Use search to find pages before creating new ones to avoid duplicates
- **Respect structure**: Maintain existing page hierarchies and database schemas
- **Use properties**: Leverage database properties (status, tags, dates) for organization
- **Page IDs**: Keep track of page IDs for efficient updates

### Rate Limits
- The hosted MCP server handles rate limiting automatically
- For bulk operations, process items in batches
- Search queries are optimized for performance

### Common Patterns

**Finding a page:**
```
Search for pages with title containing "Project Plan"
```

**Reading page content:**
```
Get the content of page [page-id] including all blocks
```

**Creating a page:**
```
Create a new page titled "Meeting Notes" under [parent-page-id]
```

**Querying a database:**
```
Query the database [database-id] filtered by status = "In Progress"
```

**Adding database entry:**
```
Add a new task to database [database-id] with title "Review PR" and status "To Do"
```

## Authentication

This source uses OAuth authentication through Notion's hosted MCP server. You'll be prompted to:
1. Sign in to your Notion account
2. Select which workspace(s) to grant access to
3. Authorize the connection

## Tips

- **Page links**: Use Notion page IDs or URLs when referencing specific pages
- **Database views**: Remember that MCP accesses the full database, not specific views
- **Nested content**: Pages can have deeply nested structures - use block IDs to navigate
- **Workspace scope**: Make sure you grant access to the workspaces you want to use
