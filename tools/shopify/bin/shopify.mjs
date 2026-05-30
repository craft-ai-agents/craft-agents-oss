#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';

const DEFAULT_API_VERSION = '2026-04';

function hasFlag(args, flag) {
  return args.includes(flag);
}

function valueFor(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function jsonOut(payload, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = exitCode;
}

function normalizeShop(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let shop = raw.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (shop && !shop.includes('.')) shop = `${shop}.myshopify.com`;
  return shop.toLowerCase();
}

function authState() {
  const shop = normalizeShop(process.env.SHOPIFY_SHOP || process.env.SHOPIFY_STORE_DOMAIN);
  const token = process.env.SHOPIFY_ACCESS_TOKEN?.trim() || '';
  const apiVersion = process.env.SHOPIFY_API_VERSION?.trim() || DEFAULT_API_VERSION;
  return {
    shop,
    token,
    apiVersion,
    configured: Boolean(shop && token),
    endpoint: shop ? `https://${shop}/admin/api/${apiVersion}/graphql.json` : '',
  };
}

function readJsonInput(args, flag = '--input') {
  const raw = valueFor(args, flag);
  if (!raw) throw new Error(`${flag} is required`);
  if (existsSync(raw)) return JSON.parse(readFileSync(raw, 'utf8'));
  return JSON.parse(raw);
}

async function graphqlRequest({ query, variables = {} }) {
  const auth = authState();
  if (!auth.configured) {
    return {
      ok: false,
      error: 'shopify auth missing',
      fix: 'Save SHOPIFY_SHOP and SHOPIFY_ACCESS_TOKEN in RunnerOS Settings -> Secrets.',
      auth: { shopConfigured: Boolean(auth.shop), tokenConfigured: Boolean(auth.token), apiVersion: auth.apiVersion },
    };
  }

  const response = await fetch(auth.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': auth.token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: 'shopify api request failed',
      body,
    };
  }

  if (body.errors?.length) {
    return { ok: false, error: 'shopify graphql errors', errors: body.errors, data: body.data ?? null };
  }

  const userErrors = collectUserErrors(body.data);
  if (userErrors.length > 0) {
    return { ok: false, error: 'shopify user errors', userErrors, data: body.data };
  }

  return { ok: true, data: body.data };
}

function collectUserErrors(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const item of value) collectUserErrors(item, found);
    return found;
  }
  if (Array.isArray(value.userErrors)) {
    for (const err of value.userErrors) {
      if (err?.message) found.push(err);
    }
  }
  for (const child of Object.values(value)) collectUserErrors(child, found);
  return found;
}

function approvalPacket({ operation, query, variables, rerun }) {
  return {
    ok: true,
    requiresApproval: true,
    operation,
    message: 'No Shopify changes were made. Review and approve before rerunning with --confirm.',
    query,
    variables,
    approveCommand: rerun,
  };
}

function asProductId(id) {
  if (!id) throw new Error('product id is required');
  return String(id).startsWith('gid://') ? String(id) : `gid://shopify/Product/${id}`;
}

function productListQuery() {
  return `
    query RunnerProducts($first: Int!) {
      products(first: $first, sortKey: UPDATED_AT, reverse: true) {
        edges {
          cursor
          node {
            id
            title
            handle
            status
            vendor
            productType
            totalInventory
            createdAt
            updatedAt
            onlineStoreUrl
            featuredImage { url altText }
            variants(first: 10) {
              edges {
                node {
                  id
                  title
                  sku
                  price
                  inventoryQuantity
                }
              }
            }
          }
        }
      }
    }
  `;
}

function productGetQuery() {
  return `
    query RunnerProduct($id: ID!) {
      product(id: $id) {
        id
        title
        handle
        status
        descriptionHtml
        vendor
        productType
        tags
        totalInventory
        createdAt
        updatedAt
        onlineStoreUrl
        featuredImage { url altText }
        media(first: 20) {
          edges { node { mediaContentType alt status preview { image { url } } } }
        }
        variants(first: 50) {
          edges {
            node {
              id
              title
              sku
              price
              compareAtPrice
              inventoryQuantity
              selectedOptions { name value }
            }
          }
        }
      }
    }
  `;
}

function productCreateMutation() {
  return `
    mutation RunnerProductCreate($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product { id title handle status onlineStoreUrl updatedAt }
        userErrors { field message }
      }
    }
  `;
}

function productUpdateMutation() {
  return `
    mutation RunnerProductUpdate($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id title handle status onlineStoreUrl updatedAt }
        userErrors { field message }
      }
    }
  `;
}

function usage() {
  return {
    ok: false,
    error: 'unknown command',
    commands: [
      'doctor --agent',
      'products list --first 10 --agent',
      'products get <productId> --agent',
      'products create --input <json-or-file> [--confirm] --agent',
      'products update <productId> --input <json-or-file> [--confirm] --agent',
      'graphql --query <graphql>|--query-file <file> [--variables <json-or-file>] [--write] [--confirm] --agent',
    ],
  };
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const subcommand = args[1];
  const confirmed = hasFlag(args, '--confirm');
  const auth = authState();

  if (command === 'doctor') {
    jsonOut({
      ok: auth.configured,
      tool: 'runner-shopify',
      apiVersion: auth.apiVersion,
      shopConfigured: Boolean(auth.shop),
      tokenConfigured: Boolean(auth.token),
      endpointConfigured: Boolean(auth.endpoint),
      connectionStatus: auth.configured ? 'ready' : 'needs_auth',
      fix: auth.configured ? undefined : 'Save SHOPIFY_SHOP and SHOPIFY_ACCESS_TOKEN in RunnerOS Settings -> Secrets.',
    }, auth.configured ? 0 : 1);
    return;
  }

  if (command === 'products' && subcommand === 'list') {
    const first = Math.min(Math.max(Number(valueFor(args, '--first') || 10), 1), 100);
    jsonOut(await graphqlRequest({ query: productListQuery(), variables: { first } }));
    return;
  }

  if (command === 'products' && subcommand === 'get') {
    const id = args[2];
    jsonOut(await graphqlRequest({ query: productGetQuery(), variables: { id: asProductId(id) } }));
    return;
  }

  if (command === 'products' && subcommand === 'create') {
    const input = readJsonInput(args);
    if (!input.status) input.status = 'DRAFT';
    const query = productCreateMutation();
    const variables = { product: input };
    if (!confirmed) {
      jsonOut(approvalPacket({
        operation: 'products.create',
        query,
        variables,
        rerun: 'node bin/shopify.mjs products create --input <same-json-or-file> --confirm --agent',
      }));
      return;
    }
    jsonOut(await graphqlRequest({ query, variables }));
    return;
  }

  if (command === 'products' && subcommand === 'update') {
    const productId = asProductId(args[2]);
    const input = { ...readJsonInput(args), id: productId };
    const query = productUpdateMutation();
    const variables = { product: input };
    if (!confirmed) {
      jsonOut(approvalPacket({
        operation: 'products.update',
        query,
        variables,
        rerun: 'node bin/shopify.mjs products update <productId> --input <same-json-or-file> --confirm --agent',
      }));
      return;
    }
    jsonOut(await graphqlRequest({ query, variables }));
    return;
  }

  if (command === 'graphql') {
    const query = valueFor(args, '--query-file')
      ? readFileSync(valueFor(args, '--query-file'), 'utf8')
      : valueFor(args, '--query');
    if (!query) throw new Error('--query or --query-file is required');
    const variables = valueFor(args, '--variables') ? readJsonInput(args, '--variables') : {};
    const isWrite = hasFlag(args, '--write') || /^\s*mutation\b/i.test(query);
    if (isWrite && !confirmed) {
      jsonOut(approvalPacket({
        operation: 'graphql.mutation',
        query,
        variables,
        rerun: 'node bin/shopify.mjs graphql --query-file <file> --variables <json-or-file> --write --confirm --agent',
      }));
      return;
    }
    jsonOut(await graphqlRequest({ query, variables }));
    return;
  }

  jsonOut(usage(), 1);
}

main().catch((error) => {
  jsonOut({ ok: false, error: error?.message || String(error) }, 1);
});
