/**
 * Markdown → Discord message formatting.
 *
 * Discord messages use a Markdown dialect very close to CommonMark for the
 * subset agents emit (bold, italic, inline code, fenced code, links, lists,
 * blockquotes), so this is a near-passthrough. The only active transform is
 * stripping ATX heading markers (`#`, `##`, …): Discord DOES render headings
 * now, but agent output frequently over-uses them for short labels, which
 * renders as oversized text in a chat bubble. We downgrade them to bold so
 * the emphasis survives without the visual noise.
 *
 * Anything we don't explicitly handle is passed through unchanged — Discord's
 * renderer tolerates unknown Markdown gracefully.
 */

/**
 * Convert an agent Markdown string into Discord-friendly text.
 *
 * - `# Heading` / `## Heading` / … → `**Heading**`
 * - Everything else passes through.
 *
 * Fenced code blocks are left untouched so heading-like lines inside code
 * are not rewritten.
 */
export function formatForDiscord(text: string): string {
  const lines = text.split('\n')
  let inFence = false
  const out: string[] = []

  for (const line of lines) {
    const fenceMatch = /^\s*```/.test(line)
    if (fenceMatch) {
      inFence = !inFence
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const content = heading[2]!.trim()
      out.push(content.length > 0 ? `**${content}**` : '')
      continue
    }
    out.push(line)
  }

  return out.join('\n')
}
