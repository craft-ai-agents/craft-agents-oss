# Shopify Agent Spec

## Goal

Create a Shopify-specialist agent that can inspect stores and prepare real store changes while protecting every write behind explicit approval.

## First Slice

- Built-in source: `shopify`
- Bundled skill: `shopify-commerce`
- Local tool: `tools/shopify/bin/shopify.mjs`
- Agent: `shopify-agent`

## Auth

Secrets:

- `SHOPIFY_SHOP` or `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_ACCESS_TOKEN`
- `SHOPIFY_API_VERSION` optional, default `2026-04`

Users create a Shopify custom app and grant only the scopes needed for their store work.

## Tool Contract

Reads execute directly:

- `doctor`
- `products list`
- `products get`
- `orders list`
- `orders get`
- `collections list`
- `locations list`
- `inventory items`
- `graphql` query

Writes are preview-only unless `--confirm` is present:

- `products create`
- `products update`
- `collections create`
- `inventory adjust`
- `graphql` mutation or `--write`

Without `--confirm`, the tool returns:

- `requiresApproval: true`
- operation name
- GraphQL mutation
- variables
- approval command
- optional receipt file path when `--receipt <file>` is used

## Agent Behavior

- Start read-only.
- Diagnose before changing.
- Draft products as `DRAFT` by default.
- Ask before live mutations.
- Show clear before/after changes and risk.
- Use Canvas outputs for audits, product plans, CSV/JSON exports, receipts, and previewable files.
- Prefer convenience commands before generic GraphQL.
- Keep inventory idempotency keys stable between approval and confirmed execution.

## Later Slices

- OAuth/custom-app setup helper in Settings.
- Customer/discount convenience commands.
- Bulk product import/update workflow with diff receipts.
- Shopify media upload helper.
- Storefront/theme audit mode.
