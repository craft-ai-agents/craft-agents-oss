# Google Stitch

Google Stitch MCP server for data integration and warehousing. Authenticated via `X-Goog-Api-Key` header stored in the credential store.

## Scope

- Access to Google Stitch data integration tools via MCP
- Used in CI to validate MCP header-based authentication (`headerNames`)

## Authentication

- Auth type: custom header (`X-Goog-Api-Key`)
- The API key is stored in the credential store, not in config.json
- Header name is declared in `config.json` via `headerNames: ["X-Goog-Api-Key"]`

## Guidelines

- This source is primarily used for CI validation of the `headerNames` credential-store pattern
- Use available MCP tools to list capabilities and verify connectivity
- Do not hardcode API keys in config — they belong in the credential store
