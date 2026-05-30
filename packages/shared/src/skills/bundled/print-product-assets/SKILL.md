---
name: print-product-assets
description: Turn local image folders into print-ready product artwork plans, placement specs, manifests, and QA checks for apparel and POD products.
requiredSources:
  - printify
tags: [print, pod, artwork, placement, apparel]
---

# Print Product Assets

Use this skill when the user gives a folder of images, asks to place artwork on shirts/products, wants batch product drafts, or needs QA before uploading to Printify.

## First Move

1. Identify the asset folder and list image files.
2. Separate production assets from notes, screenshots, mockups, and exports.
3. Ask only for missing business choices that block placement: product type, target shop, front/back/sleeve placement, colorways, sizes, price, and publish status.
4. If the user gave enough direction, proceed with a conservative draft plan.

## Asset Intake

Use shell/file tools to inspect the folder. Prefer structured manifests over ad hoc notes.

Create a working manifest with:

- source file path
- intended product type
- print area: front, back, left sleeve, right sleeve, label, or all-over
- placement anchor: center chest, left chest, full front, full back, sleeve center, etc.
- scale intent: subtle, standard, oversized, full area
- background handling: transparent, remove background needed, light garment only, dark garment only
- warnings: low resolution, bad crop, text too close to edge, non-transparent background, possible trademark issue, unreadable contrast

## Placement Rules

- Do not stretch artwork to fit. Preserve aspect ratio.
- Center art unless user says otherwise.
- For shirts, default to full-front center or left-chest only when the user asks for a small mark.
- Keep important text away from trim/edge zones.
- Use transparent PNG assets for apparel when possible.
- If an image is low-res, recommend fixing/upscaling before upload rather than silently using it.
- For dark garments, check contrast. For light garments, check washed-out whites.
- Never invent exact physical dimensions unless product template data is available.

## Printify Workflow

Use the bundled Printify wrapper for account/catalog/upload/product work:

```bash
cd tools/printify && node bin/printify.mjs doctor --agent
cd tools/printify && node bin/printify.mjs shops-json --agent --select id,title
cd tools/printify && node bin/printify.mjs catalog retrieves-list-of-blueprints-in-the --agent --select id,title
cd tools/printify && node bin/printify.mjs placement-matrix --product-file product.json --uploads-file uploads.json --agent --select variant_id,print_area,image_id,x,y,scale,angle
cd tools/printify && node bin/printify.mjs product-drift --product-file current-product.json --manifest intended-manifest.json --agent
```

Write-capable commands must go through the RunnerOS approval gate:

```bash
cd tools/printify && node bin/printify.mjs uploads an-image --body-json '{"file_name":"front.png","contents":"data:image/png;base64,..."}' --dry-run --agent
cd tools/printify && node bin/printify.mjs shops products-json create-anew-product <shopId> --title Sample --blueprint-id <blueprintId> --print-provider-id <providerId> --variants '[]' --print-areas '[]' --agent
```

Only rerun with `--confirm-runner` after explicit user approval in the current conversation.

## Output Shape

For each batch, produce:

1. `asset-inventory` listing accepted/rejected files.
2. `product-plan` with shop, product, provider, variants, pricing, and garment colors.
3. `placement-spec` showing each asset and intended print area.
4. `approval-needed` commands for uploads/product creation/publishing.
5. `qa-notes` with image, placement, margin, fulfillment, and publish risks.

Publish the inventory, placement spec, product manifest, QA report, and receipts as RunnerOS outputs when they should appear on Canvas.

## Safety

- Start read-only.
- Do not upload artwork without approval.
- Do not create, update, publish, archive, or delete products without approval.
- Do not submit orders or manage webhooks without approval.
- Do not print access tokens, private customer data, or raw order exports unless required.
- If a folder contains many files, process a sample first and ask before bulk action.
