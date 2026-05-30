#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

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

function firstNumber(args, flag, fallback, max = 100) {
  return Math.min(Math.max(Number(valueFor(args, flag) || fallback), 1), max);
}

function optionalString(args, flag) {
  const value = valueFor(args, flag);
  return value && value.trim() ? value.trim() : undefined;
}

function writeReceiptIfRequested(args, payload) {
  const receiptPath = valueFor(args, '--receipt');
  if (!receiptPath) return payload;
  const absolutePath = resolve(receiptPath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(payload, null, 2)}\n`);
  return { ...payload, receiptPath: absolutePath };
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

function asOrderId(id) {
  if (!id) throw new Error('order id is required');
  return String(id).startsWith('gid://') ? String(id) : `gid://shopify/Order/${id}`;
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

function orderListQuery() {
  return `
    query RunnerOrders($first: Int!, $query: String) {
      orders(first: $first, query: $query, sortKey: UPDATED_AT, reverse: true) {
        edges {
          cursor
          node {
            id
            name
            createdAt
            updatedAt
            displayFinancialStatus
            displayFulfillmentStatus
            currentTotalPriceSet { shopMoney { amount currencyCode } }
            customer { id displayName email }
            lineItems(first: 10) {
              edges {
                node {
                  id
                  title
                  quantity
                  sku
                  variant { id title sku }
                }
              }
            }
          }
        }
      }
    }
  `;
}

function orderGetQuery() {
  return `
    query RunnerOrder($id: ID!) {
      order(id: $id) {
        id
        name
        createdAt
        updatedAt
        displayFinancialStatus
        displayFulfillmentStatus
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        subtotalPriceSet { shopMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } }
        totalTaxSet { shopMoney { amount currencyCode } }
        customer { id displayName email }
        shippingAddress { name city province country zip }
        billingAddress { name city province country zip }
        lineItems(first: 50) {
          edges {
            node {
              id
              title
              quantity
              sku
              discountedTotalSet { shopMoney { amount currencyCode } }
              variant { id title sku inventoryItem { id sku tracked } }
            }
          }
        }
      }
    }
  `;
}

function collectionListQuery() {
  return `
    query RunnerCollections($first: Int!, $query: String) {
      collections(first: $first, query: $query, sortKey: UPDATED_AT, reverse: true) {
        edges {
          cursor
          node {
            id
            title
            handle
            updatedAt
            sortOrder
            productsCount { count }
            ruleSet { appliedDisjunctively rules { column relation condition } }
          }
        }
      }
    }
  `;
}

function collectionCreateMutation() {
  return `
    mutation RunnerCollectionCreate($input: CollectionInput!) {
      collectionCreate(input: $input) {
        collection {
          id
          title
          descriptionHtml
          handle
          updatedAt
          productsCount { count }
        }
        userErrors { field message }
      }
    }
  `;
}

function locationListQuery() {
  return `
    query RunnerLocations($first: Int!) {
      locations(first: $first, sortKey: NAME) {
        edges {
          node {
            id
            name
            fulfillsOnlineOrders
            hasActiveInventory
            deactivatedAt
          }
        }
      }
    }
  `;
}

function inventoryItemListQuery() {
  return `
    query RunnerInventoryItems($first: Int!, $query: String) {
      inventoryItems(first: $first, query: $query) {
        edges {
          cursor
          node {
            id
            sku
            tracked
            updatedAt
            locationsCount { count }
            inventoryLevels(first: 10) {
              edges {
                node {
                  id
                  location { id name }
                  quantities(names: ["available", "on_hand", "committed"]) {
                    name
                    quantity
                  }
                }
              }
            }
          }
        }
      }
    }
  `;
}

function inventoryAdjustMutation() {
  return `
    mutation RunnerInventoryAdjust($input: InventoryAdjustQuantitiesInput!, $idempotencyKey: String!) {
      inventoryAdjustQuantities(input: $input) @idempotent(key: $idempotencyKey) {
        inventoryAdjustmentGroup {
          createdAt
          reason
          referenceDocumentUri
          changes { name delta }
        }
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
      'orders list --first 10 [--query <search>] --agent',
      'orders get <orderId> --agent',
      'collections list --first 20 [--query <search>] --agent',
      'collections create --input <json-or-file> [--confirm] --agent',
      'locations list --first 50 --agent',
      'inventory items --first 20 [--query "sku:ABC"] --agent',
      'inventory adjust --input <json-or-file> [--confirm] [--receipt <file>] --agent',
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
    const first = firstNumber(args, '--first', 10);
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
      jsonOut(writeReceiptIfRequested(args, approvalPacket({
        operation: 'products.create',
        query,
        variables,
        rerun: 'node bin/shopify.mjs products create --input <same-json-or-file> --confirm --agent',
      })));
      return;
    }
    jsonOut(writeReceiptIfRequested(args, await graphqlRequest({ query, variables })));
    return;
  }

  if (command === 'products' && subcommand === 'update') {
    const productId = asProductId(args[2]);
    const input = { ...readJsonInput(args), id: productId };
    const query = productUpdateMutation();
    const variables = { product: input };
    if (!confirmed) {
      jsonOut(writeReceiptIfRequested(args, approvalPacket({
        operation: 'products.update',
        query,
        variables,
        rerun: 'node bin/shopify.mjs products update <productId> --input <same-json-or-file> --confirm --agent',
      })));
      return;
    }
    jsonOut(writeReceiptIfRequested(args, await graphqlRequest({ query, variables })));
    return;
  }

  if (command === 'orders' && subcommand === 'list') {
    const first = firstNumber(args, '--first', 10);
    jsonOut(await graphqlRequest({ query: orderListQuery(), variables: { first, query: optionalString(args, '--query') } }));
    return;
  }

  if (command === 'orders' && subcommand === 'get') {
    jsonOut(await graphqlRequest({ query: orderGetQuery(), variables: { id: asOrderId(args[2]) } }));
    return;
  }

  if (command === 'collections' && subcommand === 'list') {
    const first = firstNumber(args, '--first', 20);
    jsonOut(await graphqlRequest({ query: collectionListQuery(), variables: { first, query: optionalString(args, '--query') } }));
    return;
  }

  if (command === 'collections' && subcommand === 'create') {
    const input = readJsonInput(args);
    const query = collectionCreateMutation();
    const variables = { input };
    if (!confirmed) {
      jsonOut(writeReceiptIfRequested(args, approvalPacket({
        operation: 'collections.create',
        query,
        variables,
        rerun: 'node bin/shopify.mjs collections create --input <same-json-or-file> --confirm --agent',
      })));
      return;
    }
    jsonOut(writeReceiptIfRequested(args, await graphqlRequest({ query, variables })));
    return;
  }

  if (command === 'locations' && subcommand === 'list') {
    const first = firstNumber(args, '--first', 50);
    jsonOut(await graphqlRequest({ query: locationListQuery(), variables: { first } }));
    return;
  }

  if (command === 'inventory' && subcommand === 'items') {
    const first = firstNumber(args, '--first', 20);
    jsonOut(await graphqlRequest({ query: inventoryItemListQuery(), variables: { first, query: optionalString(args, '--query') } }));
    return;
  }

  if (command === 'inventory' && subcommand === 'adjust') {
    const input = readJsonInput(args);
    const query = inventoryAdjustMutation();
    const variables = { input, idempotencyKey: valueFor(args, '--idempotency-key') || randomUUID() };
    if (!confirmed) {
      jsonOut(writeReceiptIfRequested(args, approvalPacket({
        operation: 'inventory.adjust',
        query,
        variables,
        rerun: 'node bin/shopify.mjs inventory adjust --input <same-json-or-file> --idempotency-key <same-key> --confirm --agent',
      })));
      return;
    }
    jsonOut(writeReceiptIfRequested(args, await graphqlRequest({ query, variables })));
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
      jsonOut(writeReceiptIfRequested(args, approvalPacket({
        operation: 'graphql.mutation',
        query,
        variables,
        rerun: 'node bin/shopify.mjs graphql --query-file <file> --variables <json-or-file> --write --confirm --agent',
      })));
      return;
    }
    jsonOut(writeReceiptIfRequested(args, await graphqlRequest({ query, variables })));
    return;
  }

  jsonOut(usage(), 1);
}

main().catch((error) => {
  jsonOut({ ok: false, error: error?.message || String(error) }, 1);
});
