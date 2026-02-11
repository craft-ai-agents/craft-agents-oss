/**
 * Sanitize message content for use as session title.
 * Strips XML blocks (e.g. <edit_request>), bracket mentions, and normalizes whitespace.
 */
export function sanitizeForTitle(content: string): string {
  return content
    .replace(/<edit_request>[\s\S]*?<\/edit_request>/g, '') // Strip entire edit_request blocks
    .replace(/<[^>]+>/g, '')                                 // Strip remaining XML/HTML tags
    .replace(/\[skill:(?:[\w-]+:)?[\w-]+\]/g, '')           // [skill:slug] or [skill:ws:slug]
    .replace(/\[source:[\w-]+\]/g, '')                       // [source:slug]
    .replace(/\[file:[^\]]+\]/g, '')                         // [file:path]
    .replace(/\[folder:[^\]]+\]/g, '')                       // [folder:path]
    .replace(/\s+/g, ' ')                                    // Collapse whitespace
    .trim()
}
