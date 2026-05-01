# NotebookLM

This source runs the [`notebooklm-mcp`](https://github.com/PleasePrompto/notebooklm-mcp) local MCP server so agents can query Google NotebookLM notebooks for grounded, citation-backed answers from the user's uploaded sources.

## Scope

- Local stdio MCP server launched with `npx -y notebooklm-mcp@latest`.
- Uses local Chrome/browser automation to access NotebookLM.
- Supports querying notebooks, selecting notebooks, listing/searching saved notebook links, and health/session management depending on the server's configured tool profile.
- Authentication is handled by the MCP server's own browser flow; the Craft source itself uses `authType: none`.

## Guidelines

- For first-time setup, ask the user to log in to NotebookLM via the MCP server (for example: "Log me in to NotebookLM" or use the auth setup tool if exposed). A Chrome window should open for Google login.
- Prefer asking NotebookLM research questions before coding against unfamiliar libraries, internal docs, or fast-moving APIs.
- NotebookLM answers are constrained to the notebook's sources; if the notebook does not know, ask the user to add the missing documents rather than guessing.
- Free NotebookLM accounts may have daily usage limits.
- The upstream project recommends a dedicated Google account for browser automation.
- Tool profiles can be configured outside Craft with:
  - `npx notebooklm-mcp config set profile minimal`
  - `npx notebooklm-mcp config set profile standard`
  - `npx notebooklm-mcp config set profile full`

## Common Usage

- "Show our NotebookLM notebooks."
- "Use the React notebook for this task."
- "Ask NotebookLM how this API handles authentication, then implement it."
- "Add this shared NotebookLM link to the library tagged `docs, api`."
- "Research this in NotebookLM before coding."

## Notes

- Upstream package: `notebooklm-mcp` on npm.
- Upstream repository: https://github.com/PleasePrompto/notebooklm-mcp
- Generic MCP config equivalent:

```json
{
  "mcpServers": {
    "notebooklm": {
      "command": "npx",
      "args": ["-y", "notebooklm-mcp@latest"]
    }
  }
}
```
