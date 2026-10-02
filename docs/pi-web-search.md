# Pi web search

Pi connections use the built-in `web_search` tool. Automatic routing selects
OpenAI, ChatGPT, OpenRouter or Google search when the connection supports it,
and otherwise uses DuckDuckGo. Failed searches fall back to DuckDuckGo.

To opt in to Parallel's free, keyless Search MCP, quit Craft Agents and add
`"searchProvider": "parallel"` to the chosen Pi connection in the
`llmConnections` array of `~/.craft-agent/config.json`. For example, add the field
to your existing connection, leaving its other fields intact:

```json
{
  "slug": "my-pi-connection",
  "searchProvider": "parallel"
}
```

Restart Craft Agents and select that connection. Ask the agent to use `web_search`
for a current fact or documentation lookup. Results are attributed to Parallel
and keep the native titles, URLs and snippets. No Parallel API key, MCP source
setup or additional credentials are needed. The endpoint is
https://search.parallel.ai/mcp and queries are sent to Parallel when selected.
Anonymous usage is subject to the service's free-tier limits.

Remove `searchProvider` or set it to `"auto"` to restore automatic routing.
Existing connections without the field retain their behavior. The setting applies
to the Pi backend in both the desktop app and headless server, whose Pi subprocess
uses JSONL over stdio. Other backends and the existing `web_fetch` tool keep their
current behavior. Search failures use the existing DuckDuckGo fallback; cancelled
Parallel requests do not start a fallback search. Each MCP search has a 30-second
deadline covering connection, discovery and execution.
