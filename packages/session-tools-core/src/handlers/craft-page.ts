/**
 * Craft Pages — agent-facing tool handlers.
 *
 * Registry-mode, so both the Claude and Pi backends pick these up with no
 * backend-specific code (ADR 0001). Everything here is portable Node + fs; the
 * only non-portable capability — the serialized page catalog — arrives as an
 * optional context callback and the handler degrades gracefully without it.
 *
 * Two tools, not one, on purpose: `safeMode` is a single value per tool def
 * (tool-defs.ts), so folding delete into `craft_page` (safeMode 'allow') would
 * make destructive deletion reachable in Explore — the read-only mode.
 */

import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';
import {
  createPage, updatePage, readPage, listPages, deletePage,
  PageStoreError, type PageFileInput,
} from '../pages/store.ts';

export interface CraftPageArgs {
  command: 'create' | 'update' | 'read' | 'list';
  slug?: string;
  title?: string;
  files?: PageFileInput[];
  replaceAll?: boolean;
  expectedRev?: number;
  filePath?: string;
  /**
   * Live-data queries to REQUEST for this page. A request, not access: each one
   * has to be approved by the user before the page can run it.
   */
  queries?: unknown;
}

/**
 * Tell the model, unmissably, that requesting is not having.
 *
 * Without this the model reports "your dashboard is showing unread mail" the
 * moment the tool succeeds, and the user opens an empty page.
 */
function pendingApprovalNote(queries: Array<{ name: string; sourceSlug: string; toolName: string }>): string[] {
  if (queries.length === 0) return [];
  return [
    '',
    `Requested ${queries.length} ${queries.length === 1 ? 'query' : 'queries'}, pending the user's approval:`,
    ...queries.map(q => `  - ${q.name}: ${q.sourceSlug}.${q.toolName}`),
    'The page CANNOT read any of this until the user approves it. Tell them it is',
    'waiting on them, and do not describe the page as showing live data yet.',
  ];
}

export interface CraftPageDeleteArgs {
  slug: string;
  confirm: boolean;
}

/** Pages live under the session data dir — safe mode already permits writes there. */
function pagesRootFor(ctx: SessionToolContext): string | null {
  if (!ctx.dataPath) return null;
  const root = join(ctx.dataPath, 'pages');
  mkdirSync(root, { recursive: true });
  return root;
}

function fenceHint(pageId: string, rev: number): string {
  // rev is part of the fence because the renderer keys the preview on
  // pageId:rev. Without it an edited page re-renders the cached revision and
  // the change appears to do nothing (plan.md WS5).
  return [
    'Show it to the user by emitting this block:',
    '```craft-page',
    JSON.stringify({ pageId, rev }, null, 2),
    '```',
  ].join('\n');
}

export async function handleCraftPage(
  ctx: SessionToolContext,
  args: CraftPageArgs,
): Promise<ToolResult> {
  const root = pagesRootFor(ctx);
  if (!root) return errorResponse('craft_page requires dataPath in context.');

  try {
    switch (args.command) {
      case 'create': {
        if (!args.slug) return errorResponse('create requires "slug".');
        if (!args.title) return errorResponse('create requires "title".');
        if (!args.files?.length) return errorResponse('create requires "files" (must include index.html).');

        const r = createPage(root, {
          slug: args.slug, title: args.title, files: args.files, queries: args.queries,
        });
        await ctx.pageCatalog?.register({
          pageId: r.pageId, sessionId: ctx.sessionId, slug: args.slug, title: args.title,
        });
        return successResponse([
          `Created page "${args.slug}" (revision ${r.rev}).`,
          `pageId: ${r.pageId}`,
          `Files: ${r.files.join(', ')}`,
          ...pendingApprovalNote(r.requestedQueries),
          '',
          fenceHint(r.pageId, r.rev),
        ].join('\n'));
      }

      case 'update': {
        if (!args.slug) return errorResponse('update requires "slug".');
        if (!args.files?.length) return errorResponse('update requires "files".');

        const r = updatePage(root, {
          slug: args.slug,
          files: args.files,
          replaceAll: args.replaceAll,
          expectedRev: args.expectedRev,
          title: args.title,
          queries: args.queries,
        });
        return successResponse([
          `Updated page "${args.slug}" to revision ${r.rev}.`,
          `Files: ${r.files.join(', ')}`,
          ...(args.queries === undefined ? [] : pendingApprovalNote(r.requestedQueries)),
          '',
          fenceHint(r.pageId, r.rev),
        ].join('\n'));
      }

      case 'read': {
        if (!args.slug) return errorResponse('read requires "slug".');
        const r = readPage(root, args.slug, args.filePath);
        if (args.filePath) {
          return successResponse(
            `${args.slug}/${args.filePath} (revision ${r.rev}):\n\n${r.content}`,
          );
        }
        const requested = r.manifest.requestedQueries;
        return successResponse([
          `Page "${args.slug}" — "${r.manifest.title}", revision ${r.rev}`,
          `pageId: ${r.manifest.id}`,
          `Files: ${r.files.join(', ')}`,
          ...(requested.length > 0
            ? [
              'Requested queries (approval is the user\'s to give):',
              ...requested.map(q => `  - ${q.name}: ${q.sourceSlug}.${q.toolName}`),
            ]
            : []),
          '',
          'Pass "filePath" to read one file.',
        ].join('\n'));
      }

      case 'list': {
        const pages = listPages(root);
        if (pages.length === 0) {
          return successResponse('No pages in this session yet. Use command "create".');
        }
        return successResponse([
          `${pages.length} page(s) in this session:`,
          '',
          ...pages.map(p => `- ${p.slug} — "${p.title}" (revision ${p.rev}, ${p.files.length} files)`),
        ].join('\n'));
      }

      default:
        return errorResponse(`Unknown command "${String(args.command)}".`);
    }
  } catch (err) {
    if (err instanceof PageStoreError) return errorResponse(err.message);
    return errorResponse(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Separate tool so it can carry safeMode: 'block'.
 * Deletion is irreversible — every revision goes with the page — so it also
 * requires an explicit `confirm`, which stops a single malformed tool call from
 * destroying work.
 */
export async function handleCraftPageDelete(
  ctx: SessionToolContext,
  args: CraftPageDeleteArgs,
): Promise<ToolResult> {
  const root = pagesRootFor(ctx);
  if (!root) return errorResponse('craft_page_delete requires dataPath in context.');

  if (!args.slug) return errorResponse('delete requires "slug".');
  if (args.confirm !== true) {
    return errorResponse(
      `Refusing to delete "${args.slug}" without confirm: true. ` +
      'This removes the page and every revision of it, permanently.',
    );
  }

  try {
    const r = deletePage(root, args.slug);
    await ctx.pageCatalog?.unregister(r.pageId);
    return successResponse(`Deleted page "${args.slug}" and all of its revisions.`);
  } catch (err) {
    if (err instanceof PageStoreError) return errorResponse(err.message);
    return errorResponse(err instanceof Error ? err.message : String(err));
  }
}
