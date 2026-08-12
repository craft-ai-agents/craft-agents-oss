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

${FEATURE_FLAGS.craftPagesLiveData ? LIVE_DATA_SECTION : ''}
Read the \`craft-pages\` skill before building one; it covers the tool contract,
editing with \`expectedRev\`, and layout defaults.

After \`create\`/\`update\`, emit the \`craft-page\` block the tool returns — that
is what shows the page to the user.
`;
}

/**
 * Only included when live data is enabled.
 *
 * Teaching this while the feature is off produces pages that request queries no
 * dialog will ever show the user — the page then sits there permanently empty.
 */
const LIVE_DATA_SECTION = `
### Live data

A page can read the user's connected sources, but only what they approve. Pass
\`queries\` to \`craft_page\` to REQUEST access:

\`\`\`json
{"name": "unread", "sourceSlug": "gmail", "toolName": "list_messages",
 "fixedArgs": {"maxResults": 25},
 "paramSchema": {"q": {"type": "string", "maxLength": 64}}}
\`\`\`

The page loads \`<script src="/w-assets/craft-query.js">\` (served by the app,
not a file you create) and then calls \`craftQuery('unread', {q: 'is:unread'})\`,
which returns a promise resolving to \`{data}\` or \`{error}\`. This is not
\`fetch\` — the page still cannot make requests of its own; the trusted wrapper
runs the approved query on its behalf.

**Requesting is not having.** Nothing works until the user approves it, so say
the page is waiting on them rather than describing it as showing live data.
Ask for the fewest queries that do the job: every one is a separate decision the
user has to make, and a long list is one they cannot meaningfully read.
`;
