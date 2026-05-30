---
name: printify-commerce
description: Operate Printify POD workflows through RunnerOS' wrapped Printing Press Printify CLI with approval-gated writes.
requiredSources:
  - printify
tags: [commerce, printify, pod, products, uploads]
---

# Printify Commerce

Use this skill when the user asks for Printify print-on-demand work: catalog research, print providers, variants, artwork uploads, product creation, personalization, placement proofing, order checks, fulfillment risk, or webhooks.

## Source

Use the bundled `printify` source. It exposes a RunnerOS wrapper:

```bash
cd tools/printify
node bin/printify.mjs <command> --agent
```

The wrapper calls `printify-pp-cli` when installed or bundled.

## First Checks

```bash
cd tools/printify && node bin/printify.mjs doctor --agent
cd tools/printify && node bin/printify.mjs shops-json --agent --select id,title
```

If setup is missing:

- Save `PRINTIFY_API_TOKEN` in Settings -> Secrets.
- Install the CLI if needed: `npx -y @mvanhorn/printing-press-library install printify --cli-only`.

## Read / Planning Commands

```bash
cd tools/printify && node bin/printify.mjs shops-json --agent --select id,title
cd tools/printify && node bin/printify.mjs catalog retrieves-list-of-blueprints-in-the --agent --select id,title
cd tools/printify && node bin/printify.mjs catalog retrieve-alist-of-all-print-providers-that-fulfill-orders-for-aspecific-blueprint <blueprintId> --agent --select id,title
cd tools/printify && node bin/printify.mjs catalog retrieve-alist-of-variants-of-ablueprint-from-aspecific-print-provider <blueprintId> <providerId> --agent
cd tools/printify && node bin/printify.mjs catalog-margin-matrix --variants-file variants.json --shipping-file shipping.json --target-price 24.99 --agent
```

## Proofing Commands

```bash
cd tools/printify && node bin/printify.mjs personalization-batch --template template-product.json --csv rows.csv --out generated-manifests --agent
cd tools/printify && node bin/printify.mjs placement-matrix --product-file product.json --uploads-file uploads.json --agent --select variant_id,print_area,image_id,x,y,scale,angle
cd tools/printify && node bin/printify.mjs product-drift --product-file current-product.json --manifest intended-manifest.json --agent
cd tools/printify && node bin/printify.mjs asset-reuse --products-file products.json --uploads-file uploads.json --agent
cd tools/printify && node bin/printify.mjs fulfillment-risk --orders-file orders.json --products-file products.json --agent
```

## Write Workflow

The RunnerOS wrapper blocks write-like commands unless they include either:

- `--dry-run` for provider preview, or
- `--confirm-runner` after explicit approval.

Examples:

```bash
cd tools/printify && node bin/printify.mjs uploads an-image --body-json '{"file_name":"front.png","contents":"data:image/png;base64,..."}' --dry-run --agent
cd tools/printify && node bin/printify.mjs shops products-json create-anew-product <shopId> --title Sample --blueprint-id 384 --print-provider-id 1 --variants '[]' --print-areas '[]' --agent
cd tools/printify && node bin/printify.mjs shops products-json create-anew-product <shopId> --title Sample --blueprint-id 384 --print-provider-id 1 --variants '[]' --print-areas '[]' --confirm-runner --agent
```

## Safety Rules

- Start read-only.
- Use `shops-json` before shop-scoped commands.
- Use manifest/proofing workflows before product creation.
- Never upload artwork, create/update/publish/delete products, submit orders, manage shops, or manage webhooks without explicit approval.
- Use `--dry-run` before any approval request when the upstream command supports it.
- Use `--select` to keep large API responses tight.
- Do not print access tokens, private customer data, or raw order exports unless needed.
- Publish product plans, placement matrices, drift reports, fulfillment-risk reports, and receipts as RunnerOS outputs when they should appear on Canvas.
