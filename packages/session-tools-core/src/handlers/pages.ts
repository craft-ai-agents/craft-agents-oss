/**
 * Pages tool handlers — list_pages / get_page / create_page / update_page /
 * write_page_data / delete_page.
 *
 * All storage logic (slug generation, digests, SQLite writes, watcher
 * notifications, unpublish-on-delete) happens behind the injected ctx.pages
 * callbacks where the page primitives live — this package must stay
 * dependency-free of @craft-agent/shared (same rule as create_task).
 */

import type {
  SessionToolContext,
  CreatePageToolInput,
  UpdatePageToolPatch,
  PageDataToolPatch,
} from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

const PAGES_UNAVAILABLE =
  'Pages tools are not available in this context.';

function toError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

// ============================================================
// list_pages
// ============================================================

export interface ListPagesArgs {
  projectId?: string;
}

export async function handleListPages(
  ctx: SessionToolContext,
  args: ListPagesArgs
): Promise<ToolResult> {
  if (!ctx.pages) return errorResponse(PAGES_UNAVAILABLE);

  try {
    let pages = await ctx.pages.listPages();
    if (args.projectId !== undefined) {
      pages = pages.filter(page => page.projectId === args.projectId);
    }
    return successResponse(JSON.stringify({ total: pages.length, pages }, null, 2));
  } catch (error) {
    return errorResponse(`Failed to list pages: ${toError(error)}`);
  }
}

// ============================================================
// get_page
// ============================================================

export interface GetPageArgs {
  slug: string;
  includeContent?: boolean;
}

export async function handleGetPage(
  ctx: SessionToolContext,
  args: GetPageArgs
): Promise<ToolResult> {
  if (!ctx.pages) return errorResponse(PAGES_UNAVAILABLE);
  if (!args.slug?.trim()) return errorResponse('slug is required.');

  try {
    const page = await ctx.pages.getPage(args.slug, { includeContent: args.includeContent === true });
    if (!page) {
      return errorResponse(`Page not found: ${args.slug}. Use list_pages to see available pages.`);
    }
    return successResponse(JSON.stringify(page, null, 2));
  } catch (error) {
    return errorResponse(`Failed to get page: ${toError(error)}`);
  }
}

// ============================================================
// create_page
// ============================================================

export type CreatePageArgs = CreatePageToolInput;

export async function handleCreatePage(
  ctx: SessionToolContext,
  args: CreatePageArgs
): Promise<ToolResult> {
  if (!ctx.pages) return errorResponse(PAGES_UNAVAILABLE);
  if (!args.name?.trim()) return errorResponse('name is required.');

  try {
    const page = await ctx.pages.createPage(args);
    return successResponse(JSON.stringify(page, null, 2));
  } catch (error) {
    return errorResponse(`Failed to create page: ${toError(error)}`);
  }
}

// ============================================================
// update_page
// ============================================================

export interface UpdatePageArgs extends UpdatePageToolPatch {
  slug: string;
}

export async function handleUpdatePage(
  ctx: SessionToolContext,
  args: UpdatePageArgs
): Promise<ToolResult> {
  if (!ctx.pages) return errorResponse(PAGES_UNAVAILABLE);
  if (!args.slug?.trim()) return errorResponse('slug is required.');

  const { slug, ...patch } = args;
  const hasChanges = Object.keys(patch).some(key => (patch as Record<string, unknown>)[key] !== undefined);
  if (!hasChanges) {
    return errorResponse('Nothing to update — provide at least one of name, description, kind, projectId, content, refresh.');
  }

  try {
    const page = await ctx.pages.updatePage(slug, patch);
    return successResponse(JSON.stringify(page, null, 2));
  } catch (error) {
    return errorResponse(`Failed to update page: ${toError(error)}`);
  }
}

// ============================================================
// write_page_data
// ============================================================

export interface WritePageDataArgs extends PageDataToolPatch {
  slug: string;
}

export async function handleWritePageData(
  ctx: SessionToolContext,
  args: WritePageDataArgs
): Promise<ToolResult> {
  if (!ctx.pages) return errorResponse(PAGES_UNAVAILABLE);
  if (!args.slug?.trim()) return errorResponse('slug is required.');

  const { slug, ...patch } = args;
  try {
    const result = await ctx.pages.writePageData(slug, patch);
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    return errorResponse(`Failed to write page data: ${toError(error)}`);
  }
}

// ============================================================
// delete_page
// ============================================================

export interface DeletePageArgs {
  slug: string;
}

export async function handleDeletePage(
  ctx: SessionToolContext,
  args: DeletePageArgs
): Promise<ToolResult> {
  if (!ctx.pages) return errorResponse(PAGES_UNAVAILABLE);
  if (!args.slug?.trim()) return errorResponse('slug is required.');

  try {
    const result = await ctx.pages.deletePage(args.slug);
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    return errorResponse(`Failed to delete page: ${toError(error)}`);
  }
}
