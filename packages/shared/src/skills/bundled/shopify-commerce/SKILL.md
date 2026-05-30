---
name: shopify-commerce
description: Operate Shopify stores with read-first workflows and approval-gated Admin GraphQL writes through RunnerOS' bundled Shopify source.
requiredSources:
  - shopify
tags: [commerce, shopify, ecommerce, products, inventory]
---

# Shopify Commerce

Use this skill when the user asks to inspect or operate a Shopify store: products, listings, copy, pricing, collections, inventory, orders, customers, discounts, or store diagnostics.

## Source

Use the bundled `shopify` source. It exposes a repo-owned local tool:

```bash
cd tools/shopify
node bin/shopify.mjs <command> --agent
```

## First Checks

```bash
cd tools/shopify && node bin/shopify.mjs doctor --agent
cd tools/shopify && node bin/shopify.mjs products list --first 10 --agent
```

If auth is missing, tell the user to open Settings -> Secrets and add:

- `SHOPIFY_SHOP` or `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_ACCESS_TOKEN`
- optional `SHOPIFY_API_VERSION`

The access token should come from a Shopify custom app with only the scopes needed for the requested work.

## Read Workflows

Start read-only. Useful commands:

```bash
cd tools/shopify && node bin/shopify.mjs products list --first 20 --agent
cd tools/shopify && node bin/shopify.mjs products get <productId> --agent
cd tools/shopify && node bin/shopify.mjs graphql --query-file query.graphql --variables '{"first":20}' --agent
```

Summarize what matters. Do not dump raw API output unless the user asks.

## Write Workflow

All writes must be previewed first:

```bash
cd tools/shopify && node bin/shopify.mjs products create --input product.json --agent
cd tools/shopify && node bin/shopify.mjs products update <productId> --input patch.json --agent
cd tools/shopify && node bin/shopify.mjs graphql --query-file mutation.graphql --variables variables.json --write --agent
```

The tool returns an approval packet and makes no store changes.

Only after explicit user approval in the current conversation, rerun with `--confirm`:

```bash
cd tools/shopify && node bin/shopify.mjs products update <productId> --input patch.json --confirm --agent
```

## Safety Rules

- Never publish, delete, refund, fulfill, cancel, change inventory, or edit live products without explicit approval.
- Product creation defaults to `DRAFT`; do not create active products unless the user approves that status.
- For every proposed mutation, show product/order/customer id, current value when known, proposed value, reason, risk, and exact approval command.
- Do not print access tokens, private app credentials, customer PII, or raw order exports unless needed.
- Publish CSV, JSON, HTML, image, or receipt files as RunnerOS outputs when they should appear on Canvas.
