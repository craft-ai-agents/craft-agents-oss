/** Generate a URL/filesystem-safe slug from a name; falls back to `fallback` when it reduces to empty. */
export function generateSlug(name: string, fallback = 'workspace'): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);

  return slug || fallback;
}
