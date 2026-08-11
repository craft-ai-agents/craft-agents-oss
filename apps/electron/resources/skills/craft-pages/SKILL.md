---
name: Craft Pages
description: Build a local webpage or small interactive app the user can view. Use for websites, dashboards, landing pages, reports, or anything that should look like a real page rather than chat output.
icon: 🌱
---

# Craft Pages

You can build a real webpage that runs locally on the user's machine and open it
for them. Use the `craft_page` tool.

A page is a **folder of real files** served over HTTP — so multi-page sites,
relative links, images, and stylesheets all work normally.

## The rules that matter

Pages run in a locked-down sandbox. **Every rule below fails SILENTLY** — no
error, no console message, just a page that renders wrong. They are not style
preferences; each one was measured against Chrome and Safari.

### Scripts

- **External files only.** `<script src="app.js">`.
- **No inline `<script>`.** Blocked.
- **No `type="module"`.** It does not run, and reports no error. Module scripts
  fetch in CORS mode, which fails from the page's sandboxed origin. Use plain
  classic scripts and ordinary function scope.

### Styles

- **External stylesheet only.** `<link rel="stylesheet" href="styles.css">`.
- **No inline `<style>` blocks.** Blocked.
- **No `style="..."` attributes.** Blocked — including
  `el.setAttribute('style', …)`.
- **For dynamic styling, assign properties:** `el.style.color = '#a4552f'`.
  That works. This is the only way to style from JavaScript.

### Data

- **`fetch()` does not work at all** — not even for the page's own files.
- **Ship data as JavaScript** that assigns a global:

  ```js
  // data.js
  window.PAGE_DATA = { items: [...] }
  ```

  ```html
  <script src="data.js"></script>
  <script src="app.js"></script>
  ```

### Storage and forms

- **`localStorage` throws.** Wrap any use in `try/catch`, or just keep state in
  a variable. The page has no persistent storage.
- **`<form>` submission is blocked.** Use a `<button type="button">` with a
  click handler instead. Never rely on submit.

### Network

- **No external resources.** No CDNs, no Google Fonts, no remote images, no
  third-party APIs. Inline or bundle everything into the page's own files.
- System fonts work well: `font-family: ui-sans-serif, system-ui, sans-serif`.

## Using the tool

```
craft_page  command=create  slug=pottery-studio  title="Wildflower Pottery"
            files=[{path:"index.html", content:"…"}, …]
```

- `slug` — lowercase letters, digits, hyphens. Keep it short.
- Must include `index.html` at the root.
- Binary assets (images, fonts) use `encoding: "base64"`.

**Editing a page:** use `command=update`. It patches the files you name and
leaves the rest alone, so you can change one stylesheet without resending the
whole site. Pass `expectedRev` (the revision from your last call) so a
concurrent edit is caught instead of silently overwritten. Only pass
`replaceAll: true` when you genuinely mean "delete everything not in this list".

**Showing it:** after `create` or `update`, emit the fenced block the tool hands
back. It carries the page id and revision, and the revision is what makes an
edited page actually re-render:

````
```craft-page
{"pageId":"…","rev":2,"title":"Wildflower Pottery"}
```
````

**Deleting** is a separate tool, `craft_page_delete`, and requires
`confirm: true`. Only use it when the user explicitly asks. Prefer `update`.

## Checking your work

You cannot see the page. If the browser tool is available, open the page URL and
take a screenshot — that is the only way to catch a layout that is wrong rather
than merely valid. Look for: unstyled text (a blocked stylesheet), an empty list
(data not loaded), or nothing at all (a script that did not run).

## Good defaults

- Multi-page sites: `index.html`, `about.html`, `contact.html`, plus a nav.
- Directory URLs work: `en/index.html` is reachable as `/en/` and `/en`.
- Keep total size modest; this is a local page, not a bundle.
- Write real content, not lorem ipsum. Ask the user for the details you need.
