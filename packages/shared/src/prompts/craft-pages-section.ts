import { FEATURE_FLAGS } from '../feature-flags.ts';

/**
 * Craft Pages capability announcement for the system prompt.
 *
 * Deliberately short. The system prompt is static per session and kept small to
 * preserve prompt caching, so this states only what the model cannot discover
 * on its own — that the tool exists, and the handful of constraints that fail
 * SILENTLY. Everything else lives in the `craft-pages` skill, which the model
 * reads on demand.
 *
 * Returns '' when the feature is off, so the model is never told about a tool
 * that is not registered.
 */
export function getCraftPagesPromptSection(): string {
  if (!FEATURE_FLAGS.craftPages) return '';

  return `
## Craft Pages

You can build a real webpage that runs locally and show it to the user, using
\`craft_page\`. A page is a folder of files served over HTTP, so multi-page
sites, relative links and images work normally.

Pages run sandboxed. These constraints fail **silently** — no error, just a page
that renders wrong:

- Scripts must be external files. No inline \`<script>\`, and \`type="module"\` does not run.
- Styles must be an external stylesheet. No \`<style>\` blocks, no \`style="..."\` attributes. Style from JS with \`el.style.prop = …\`.
- \`fetch()\` is unavailable, including for the page's own files. Ship data as a script that assigns a global.
- \`localStorage\` throws, and \`<form>\` submission is blocked — use a button click handler.
- No external resources: no CDNs, web fonts or remote images.

Read the \`craft-pages\` skill before building one; it covers the tool contract,
editing with \`expectedRev\`, and layout defaults.

After \`create\`/\`update\`, emit the \`craft-page\` block the tool returns — that
is what shows the page to the user.
`;
}
