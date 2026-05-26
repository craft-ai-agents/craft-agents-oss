---
name: api-doc
description: Document an API route or MCP tool. Produces a JSDoc block for the handler and appends an entry to docs/api.md (creating it if needed).
---

Document the API route or MCP tool specified by the user.

## Steps

1. Read the target file and locate the handler or tool definition.
2. Infer from the code:
   - Method and path (for HTTP routes)
   - Input schema / parameters
   - Return type and shape
   - Error conditions
3. Write a JSDoc block directly above the handler:
   ```ts
   /**
    * Brief one-line description.
    *
    * @param req - Express request; body: { field: type }
    * @returns { field: type } on success
    * @throws 400 if validation fails
    * @throws 500 on unexpected error
    */
   ```
4. Append a Markdown entry to `docs/api.md` (create with `# API Reference` header if missing):
   ```markdown
   ## METHOD /path
   Description of what this endpoint does.
   **Request body**: `{ field: type }`
   **Response**: `{ field: type }`
   **Errors**: 400 (validation), 500 (server)
   ```
5. For MCP tools (`.mcp.json` or `server/tools/*.ts`), use the tool's `inputSchema` to populate params.

## Conventions

- Keep JSDoc terse — one sentence per tag
- Use TypeScript type names, not descriptions, for `@param` types
- Do not document obvious params like `req`, `res` unless they carry special semantics
