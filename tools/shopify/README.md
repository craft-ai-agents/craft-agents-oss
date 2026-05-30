# RunnerOS Shopify Tool

Repo-owned Shopify Admin GraphQL wrapper for RunnerOS agents.

```bash
node bin/shopify.mjs doctor --agent
node bin/shopify.mjs products list --first 10 --agent
node bin/shopify.mjs orders list --first 10 --agent
node bin/shopify.mjs collections list --first 20 --agent
node bin/shopify.mjs locations list --agent
node bin/shopify.mjs inventory items --query "sku:ABC" --agent
node bin/shopify.mjs products create --input '{"title":"Draft product"}' --agent
node bin/shopify.mjs products create --input '{"title":"Draft product"}' --confirm --agent
node bin/shopify.mjs inventory adjust --input inventory-adjust.json --receipt receipts/inventory.json --agent
```

Auth comes from RunnerOS Secrets or environment variables:

- `SHOPIFY_SHOP` or `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_ACCESS_TOKEN`
- `SHOPIFY_API_VERSION` optional, default `2026-04`

Write commands do not execute unless `--confirm` is present.

Use `--receipt <file>` on approval-gated commands to write a JSON approval or execution receipt for Canvas.
