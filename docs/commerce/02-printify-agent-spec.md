# Printify Agent Spec

## Goal

Create a Printify specialist agent for POD product work: catalog research, artwork uploads, product manifests, personalization proofing, order checks, fulfillment risk, and approval-gated writes.

## Architecture

Use Printing Press `printify-pp-cli` as the core engine and RunnerOS as the control layer.

Why CLI-first:

- It covers Printify catalog, shops, products, uploads, orders, and webhooks.
- It adds agent-native workflows: placement matrix, product drift, personalization batch, margin matrix, asset reuse, fulfillment risk.
- It supports `--agent`, `--dry-run`, `--select`, provenance envelopes, and `--deliver file:`.

RunnerOS owns:

- Secrets setup through `PRINTIFY_API_TOKEN`.
- Built-in source and agent routing.
- Write approval gates.
- Canvas receipts and output publishing.

## First Slice

- Tool wrapper: `tools/printify/bin/printify.mjs`
- Built-in source: `printify`
- Bundled skill: `printify-commerce`
- Starter agent: `printify-agent`
- Bundled asset workflow skill: `print-product-assets`
- User-facing store agent: `print-agent`

## Auth

Secret:

- `PRINTIFY_API_TOKEN`

The wrapper also mirrors it into `PRINTIFY_BEARER_AUTH` for MCP/Printing Press compatibility.

## Safety Contract

Write-like Printify commands are blocked unless:

- `--dry-run` is present, or
- `--confirm-runner` is present after explicit user approval.

Blocked commands return an approval packet and do not call the upstream CLI.

Write-like areas:

- uploads
- product create/update/publish/delete
- orders write/submit
- shop management
- webhook install/update/delete

## Agent Behavior

- Start with `doctor`.
- List shops with `shops-json --agent --select id,title`.
- Use catalog/margin tools before product creation.
- Upload artwork only after confirming files and target products.
- Create manifests before product writes.
- Run placement/personality/drift audits before trusting product creation.
- Use `--dry-run` first for write-capable commands.
- Require explicit approval before `--confirm-runner`.
- Publish receipts/reports to Canvas when useful.

## Live Verification Gate

Add to the external integration live verification backlog before merge-to-main:

- Printify token persists after app restart.
- `doctor` passes with real token.
- `shops-json` returns shops.
- catalog read succeeds.
- upload dry-run is gated/previewed.
- one safe live upload or draft product create succeeds only after approval.
